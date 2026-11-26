import { REACTION_IDS, REACTION_LABELS, REACTION_PROMPT_HINT } from "./reactions";
import { DEFAULT_SYSTEM_PROMPT, apiChatCompletion, readChatImage } from "./store";
import type {
  AppSettings,
  Character,
  ChatMessage,
  GroupResponseLength,
} from "./store";

const MAX_RECENT_MESSAGES = 24;
const MAX_RECENT_CHARS = 12000;
const SUMMARY_MAX_CHARS = 1800;
const SUMMARY_SOURCE_MESSAGES = 60;
const SUMMARY_SOURCE_CHARS = 14000;
const SUMMARY_MAX_TOKENS = 240;
const KEYWORD_SNIPPETS = 5;
const SNIPPET_MAX_CHARS = 220;

const STOP_WORDS = new Set([
  "это", "как", "что", "чий", "чью", "был", "была", "были", "быть", "был", "есть",
  "для", "при", "про", "без", "из-за", "если", "тогда", "чтобы", "когда", "очень",
  "ещё", "уже", "бы", "же", "ли", "не", "ни", "ну", "вот", "так", "там", "тут",
  "меня", "тебя", "его", "её", "нас", "вас", "них", "мне", "тебе", "ему", "ей",
  "нам", "вам", "им", "себя", "свой", "своя", "свои", "все", "всё", "этот", "эта",
  "эти", "тот", "та", "те", "один", "одна", "одно", "много", "мало", "больше",
  "меньше", "может", "можно", "нужно", "хоть", "пусть", "давай", "давайте",
  "the", "and", "for", "with", "that", "this", "have", "just", "from", "were",
  "was", "are", "but", "not", "you", "your", "ours", "their", "what", "when",
  "where", "which", "while", "about", "into", "then", "than", "very", "much",
]);

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string };
};

export type ChatRequest = {
  settings: AppSettings;
  character: Character;
  history: ChatMessage[];
  summary?: string;
  signal: AbortSignal;
};

export type SummaryRequest = {
  settings: AppSettings;
  character: Character;
  messages: ChatMessage[];
  signal: AbortSignal;
};

export type GroupChatRequest = {
  settings: AppSettings;
  characters: [Character, Character];
  history: ChatMessage[];
  summary?: string;
  signal: AbortSignal;
};

export type GroupSummaryRequest = {
  settings: AppSettings;
  characters: [Character, Character];
  messages: ChatMessage[];
  signal: AbortSignal;
};

type ChatTurn = { role: "user" | "assistant"; content: string };

type GroupConfig = {
  rules: string;
  responseLength: GroupResponseLength;
  reactions: boolean;
  useExamples: boolean;
  historyDepth: number;
};

function groupConfig(settings: AppSettings): GroupConfig {
  const group = settings.group;
  return {
    rules: typeof group?.rules === "string" ? group.rules.trim() : "",
    responseLength: group?.responseLength ?? "normal",
    reactions: group?.reactions ?? true,
    useExamples: group?.useExamples ?? false,
    historyDepth: Math.max(4, Math.min(200, group?.historyDepth ?? 24)),
  };
}

function groupFormatHint(settings: AppSettings): string {
  const { responseLength, reactions } = groupConfig(settings);
  const lengthHint =
    responseLength === "short"
      ? "Отвечай коротко: по 1–2 предложения на персонажа."
      : responseLength === "detailed"
        ? "Отвечай подробно: по 3–5 предложений на персонажа."
        : "Отвечай в меру подробно, по 2–3 предложения на персонажа.";
  const reactionHint = reactions
    ? `В конце каждой секции отдельной строкой ровно один тег [[reaction:...]]. Допустимые значения: ${REACTION_IDS.map((id) => `${id} (${REACTION_LABELS[id].toLowerCase()})`).join(", ")}. Выбирай тег под тон фразы, neutral — только для спокойных нейтральных реплик. Добавляй тег всегда. После тега ничего не пиши.`
    : "Не добавляй reaction-теги.";
  const hiddenHint = reactions
    ? "Метки и теги не являются частью видимого ответа."
    : "Метки не являются частью видимого ответа.";
  return `Отвечай строго в формате:

[[speaker:0]]
реплика первого персонажа${reactions ? "\n[[reaction:happy]]" : ""}

[[speaker:1]]
реплика второго персонажа${reactions ? "\n[[reaction:neutral]]" : ""}

Выведи ровно две реплики — по одной от каждого персонажа, в любом порядке. Каждая секция начинается с метки [[speaker:0]] или [[speaker:1]]. ${lengthHint} ${reactionHint} ${hiddenHint}`;
}

function stripReasoning(content: string, keepReactions = true): string {
  const result = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
  return keepReactions ? result : result.replace(/\[\[reaction:[^\]]+\]\]/gi, "").trim();
}

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return Array.from(
    new Set(words.filter((word) => !STOP_WORDS.has(word))),
  ).slice(-8);
}

function formatSnippet(message: ChatMessage, settings: AppSettings): string {
  const speaker = message.from === "user" ? personaName(settings) : "Персонаж";
  return `${speaker}: ${resolveUserTag(
    message.text.slice(0, SNIPPET_MAX_CHARS),
    settings,
  )}`;
}

function keywordSnippets(
  history: ChatMessage[],
  recentCount: number,
  settings: AppSettings,
): string[] {
  if (recentCount <= 0) return [];
  const older = history.slice(0, Math.max(0, history.length - recentCount));
  const lastUser = [...history].reverse().find((message) => message.from === "user");
  const keywords = extractKeywords(lastUser?.text ?? "");
  if (!older.length || !keywords.length) return [];

  return older
    .map((message, index) => {
      const lower = message.text.toLowerCase();
      const score = keywords.reduce(
        (total, keyword) => total + (lower.includes(keyword) ? 1 : 0),
        0,
      );
      return { message, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, KEYWORD_SNIPPETS)
    .sort((a, b) => a.index - b.index)
    .map((item) => formatSnippet(item.message, settings));
}

function trimRecent(
  history: ChatMessage[],
  maxMessages = MAX_RECENT_MESSAGES,
): ChatMessage[] {
  const all = history.slice(-Math.max(1, maxMessages));
  const recent: ChatMessage[] = [];
  let used = 0;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const message = all[index];
    if (used + message.text.length > MAX_RECENT_CHARS && recent.length) break;
    recent.unshift(message);
    used += message.text.length;
  }
  if (!recent.length && all.length) {
    const last = all[all.length - 1];
    recent.push({ ...last, text: last.text.slice(-MAX_RECENT_CHARS) });
  }
  return recent;
}

const FALLBACK_USER_NAME = "User";

function personaName(settings: AppSettings): string {
  return settings.persona?.name?.trim() || FALLBACK_USER_NAME;
}

function resolveUserTag(text: string, settings: AppSettings): string {
  const name = personaName(settings);
  return text.replace(/\{\{\s*user\s*\}\}/gi, () => name);
}

function personaSystemBlock(settings: AppSettings): string {
  const description = settings.persona?.description?.trim();
  if (!description) return "";
  return [
    "USER PROFILE",
    `Name: ${personaName(settings)}`,
    `Information: ${resolveUserTag(description, settings)}`,
  ].join("\n");
}

function characterSystemText(character: Character, settings: AppSettings): string {
  const system = character.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const description = character.prompt?.trim() ?? "";
  return resolveUserTag(
    [system.trim(), description].filter(Boolean).join("\n\n"),
    settings,
  );
}

function realTimeSystemBlock(character: Character): string {
  if (character.realTime === false) return "";
  const now = new Date();
  const date = now.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = now.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const hour = now.getHours();
  const period =
    hour < 5 ? "ночь" : hour < 12 ? "утро" : hour < 17 ? "день" : hour < 22 ? "вечер" : "ночь";
  return `Сейчас ${date}, ${time} по локальному времени (${period}).`;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function parseExampleTurns(
  raw: string | undefined,
  names: string[],
  group: boolean,
  settings: AppSettings,
): ChatTurn[] {
  if (!raw?.trim()) return [];
  const knownNames = names.map((name) => name.trim()).filter(Boolean);
  const userLabels = new Set([
    "пользователь",
    "user",
    normalizedName(personaName(settings)),
  ]);
  const turns: ChatTurn[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^([^:]{1,80}):\s*(.*)$/);
    if (!match) {
      if (turns.length) {
        turns[turns.length - 1].content += `\n${trimmed}`;
      }
      continue;
    }

    const label = resolveUserTag(match[1].trim(), settings);
    const text = match[2].trim();
    const labelKey = normalizedName(label);

    if (userLabels.has(labelKey)) {
      turns.push({ role: "user", content: text });
      continue;
    }

    if (!group) {
      turns.push({ role: "assistant", content: text });
      continue;
    }

    const speaker = knownNames.find((name) => normalizedName(name) === labelKey);
    if (!speaker) continue;
    turns.push({ role: "assistant", content: `${speaker}: ${text}` });
  }

  return turns
    .map((turn) => ({
      role: turn.role,
      content: resolveUserTag(turn.content, settings),
    }))
    .filter((turn) => turn.content.trim());
}

async function fetchChatCompletion(
  settings: AppSettings,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `http://127.0.0.1:${settings.port}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "local-model", stream: false, ...body }),
      signal,
    },
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  if (data.error?.message) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

async function requestViaApi(
  settings: AppSettings,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  const api = settings.api;
  const baseUrl = api?.baseUrl?.trim() ?? "";
  const model = api?.model?.trim() ?? "";
  if (!baseUrl || !model) {
    throw new Error("Укажите Base URL и модель API в настройках");
  }
  if (signal.aborted) throw new Error("Запрос отменён");
  // API: temperature: 1 безопасен для OpenAI-совместимых провайдеров и обязателен для Kimi.
  const content = await apiChatCompletion(baseUrl, api.apiKey ?? "", model, {
    ...body,
    temperature: 1,
  });
  if (signal.aborted) throw new Error("Запрос отменён");
  return content;
}

async function postChatCompletion(
  settings: AppSettings,
  body: Record<string, unknown>,
  signal: AbortSignal,
  keepReactions = true,
): Promise<string> {
  const content =
    settings.modelMode === "api"
      ? await requestViaApi(settings, body, signal)
      : await fetchChatCompletion(settings, body, signal);
  const text = stripReasoning(content, keepReactions);
  if (!text) throw new Error("Модель вернула пустой ответ");
  return text;
}

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

type MessageTurn = { role: "user" | "assistant"; content: ChatContent };

function visionEnabled(settings: AppSettings): boolean {
  return settings.modelMode === "api"
    ? Boolean(settings.apiVision)
    : Boolean(settings.localVision);
}

function visibleImageIds(history: ChatMessage[], settings: AppSettings): Set<string> {
  const ids = new Set<string>();
  if (!visionEnabled(settings)) return ids;
  for (const message of [...history].reverse()) {
    if (message.from === "user" && message.imageFile && ids.size < 2) {
      ids.add(message.id);
    }
  }
  return ids;
}

async function withImageContent(
  message: ChatMessage,
  text: string,
  imageIds: Set<string>,
): Promise<ChatContent> {
  if (!imageIds.has(message.id) || !message.imageFile) return text;
  const dataUrl = await readChatImage(message.imageFile).catch(() => "");
  if (!dataUrl) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}

async function historyTurns(
  history: ChatMessage[],
  settings: AppSettings,
): Promise<MessageTurn[]> {
  const imageIds = visibleImageIds(history, settings);
  return Promise.all(
    history.map(async (message) => ({
      role: message.from === "bot" ? ("assistant" as const) : ("user" as const),
      content: await withImageContent(
        message,
        resolveUserTag(message.text, settings),
        imageIds,
      ),
    })),
  );
}

export async function requestChatReply({
  settings,
  character,
  history,
  summary,
  signal,
}: ChatRequest): Promise<string> {
  const recent = trimRecent(history);
  const snippets = keywordSnippets(history, recent.length, settings);
  const systemText = characterSystemText(character, settings);
  const systemParts: string[] = [];
  if (systemText) systemParts.push(systemText);
  const personaBlock = personaSystemBlock(settings);
  if (personaBlock) systemParts.push(personaBlock);
  const timeBlock = realTimeSystemBlock(character);
  if (timeBlock) systemParts.push(timeBlock);

  if (summary?.trim()) {
    systemParts.push(
      `Краткое резюме более ранней части беседы:\n${summary.trim().slice(0, SUMMARY_MAX_CHARS)}`,
    );
  }
  if (snippets.length) {
    systemParts.push(
      `Выдержки из более старых сообщений, которые могут пригодиться:\n${snippets
        .map((snippet) => `- ${snippet}`)
        .join("\n")}`,
    );
  }
  systemParts.push(REACTION_PROMPT_HINT);
  const examples = parseExampleTurns(
    character.examples,
    [character.name],
    false,
    settings,
  );

  return postChatCompletion(
    settings,
    {
      messages: [
        { role: "system", content: systemParts.join("\n\n") },
        ...examples,
        ...(await historyTurns(recent, settings)),
      ],
      temperature: 0.7,
    },
    signal,
  );
}

export async function requestChatSummary({
  settings,
  character,
  messages,
  signal,
}: SummaryRequest): Promise<string> {
  const source = messages
    .slice(-SUMMARY_SOURCE_MESSAGES)
    .map((message) => formatSnippet(message, settings))
    .join("\n")
    .slice(-SUMMARY_SOURCE_CHARS);
  const system = [
    characterSystemText(character, settings),
    personaSystemBlock(settings),
    "Сделай краткое резюме диалога: ключевые факты, темы, имена и договорённости. Не отвечай на реплики, не добавляй reaction-теги, пиши только резюме.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return postChatCompletion(
    settings,
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: source },
      ],
      temperature: 0.2,
      max_tokens: SUMMARY_MAX_TOKENS,
    },
    signal,
    false,
  );
}

function groupCharacterDescription(
  character: Character,
  index: number,
  settings: AppSettings,
): string {
  const details = characterSystemText(character, settings);
  return `Персонаж ${index} — ${character.name}${details ? `. ${details}` : "."}`;
}

function groupSystemParts(
  characters: [Character, Character],
  settings: AppSettings,
): string[] {
  const [first, second] = characters;
  const parts = [
    "Ты ведёшь общую беседу от лица двух персонажей и пользователя. Отвечай только от лица персонажей, не пиши за пользователя.",
  ];
  const personaBlock = personaSystemBlock(settings);
  if (personaBlock) parts.push(personaBlock);
  parts.push(
    groupCharacterDescription(first, 0, settings),
    groupCharacterDescription(second, 1, settings),
  );
  const rules = resolveUserTag(groupConfig(settings).rules, settings);
  if (rules) parts.push(`Правила беседы:\n${rules}`);
  return parts;
}

async function groupHistory(
  history: ChatMessage[],
  characters: [Character, Character],
  maxMessages: number,
  settings: AppSettings,
): Promise<MessageTurn[]> {
  const userName = personaName(settings);
  const trimmed = trimRecent(history, maxMessages);
  const imageIds = visibleImageIds(history, settings);
  return Promise.all(
    trimmed.map(async (message) => {
      const text = resolveUserTag(message.text, settings);
      const isUser = message.from === "user";
      const name = characters.find((item) => item.id === message.speakerId)?.name;
      const content = isUser
        ? `${userName}: ${text}`
        : name
          ? `${name}: ${text}`
          : text;
      return {
        role: isUser ? ("user" as const) : ("assistant" as const),
        content: await withImageContent(message, content, imageIds),
      };
    }),
  );
}

export async function requestGroupChatReply({
  settings,
  characters,
  history,
  summary,
  signal,
}: GroupChatRequest): Promise<string> {
  const config = groupConfig(settings);
  const recent = trimRecent(history, config.historyDepth);
  const snippets = keywordSnippets(history, recent.length, settings);
  const systemParts = groupSystemParts(characters, settings);
  const timeCharacter = characters.find((item) => item.realTime !== false);
  if (timeCharacter) {
    const timeBlock = realTimeSystemBlock(timeCharacter);
    if (timeBlock) systemParts.push(timeBlock);
  }

  if (summary?.trim()) {
    systemParts.push(
      `Краткое резюме более ранней части беседы:\n${summary.trim().slice(0, SUMMARY_MAX_CHARS)}`,
    );
  }
  if (snippets.length) {
    systemParts.push(
      `Выдержки из более старых сообщений, которые могут пригодиться:\n${snippets
        .map((snippet) => `- ${snippet}`)
        .join("\n")}`,
    );
  }
  systemParts.push(groupFormatHint(settings));
  const names = characters.map((character) => character.name);
  const examples = config.useExamples
    ? [
        ...parseExampleTurns(characters[0].examples, names, true, settings),
        ...parseExampleTurns(characters[1].examples, names, true, settings),
      ]
    : [];

  return postChatCompletion(
    settings,
    {
      messages: [
        { role: "system", content: systemParts.join("\n\n") },
        ...examples,
        ...(await groupHistory(history, characters, config.historyDepth, settings)),
      ],
      temperature: 0.7,
    },
    signal,
    config.reactions,
  );
}

export async function requestGroupChatSummary({
  settings,
  characters,
  messages,
  signal,
}: GroupSummaryRequest): Promise<string> {
  const userName = personaName(settings);
  const source = messages
    .slice(-SUMMARY_SOURCE_MESSAGES)
    .map((message) => {
      const text = resolveUserTag(
        message.text.slice(0, SNIPPET_MAX_CHARS),
        settings,
      );
      if (message.from === "user") return `${userName}: ${text}`;
      const name = characters.find((item) => item.id === message.speakerId)?.name ?? "Персонаж";
      return `${name}: ${text}`;
    })
    .join("\n")
    .slice(-SUMMARY_SOURCE_CHARS);
  const system = [
    ...groupSystemParts(characters, settings),
    "Сделай краткое резюме беседы: ключевые факты, темы, имена и договорённости. Не отвечай на реплики, не добавляй метки speaker и reaction-теги, пиши только резюме.",
  ].join("\n\n");

  return postChatCompletion(
    settings,
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: source },
      ],
      temperature: 0.2,
      max_tokens: SUMMARY_MAX_TOKENS,
    },
    signal,
    false,
  );
}
