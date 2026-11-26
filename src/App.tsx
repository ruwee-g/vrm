import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import Settings from "./Settings";
import VrmStage, { type VrmStageHandle } from "./VrmStage";
import {
  startUpdateWatcher,
  subscribeToUpdates,
  type UpdateInfo,
} from "./updates";
import {
  requestChatReply,
  requestChatSummary,
  requestGroupChatReply,
  requestGroupChatSummary,
} from "./llm";
import { LocalMicRecorder, type LocalCaptureStats } from "./localSpeech";
import {
  collectFinalText,
  describeSpeechError,
  getSpeechRecognitionConstructor,
  type Recognition,
} from "./speech";
import {
  REACTIONS,
  REACTION_IDS,
  REACTION_LABELS,
  parseReaction,
  type ReactionId,
} from "./reactions";
import {
  DEFAULT_BACKGROUND_ID,
  DEFAULT_CHARACTER_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_SETTINGS,
  appendChatMessage,
  captureScreen,
  characterActivitySettings,
  characterModelIds,
  dataUrlBytes,
  emptyCharacterBackgrounds,
  listBackgrounds,
  listVrmModels,
  markChatMessagesRead,
  modelStatus,
  normalizeCharacterBackgrounds,
  openChatImage,
  readChatImage,
  readBackground,
  readCharacters,
  readChat,
  readChatSummary,
  readCharacterBackgrounds,
  readSettings,
  readViewTransform,
  saveBackground,
  saveChatImage,
  setActiveCharacter,
  speechDebug,
  startModel,
  sttStart,
  stopModel,
  transcribeAudio,
  writeChatSummary,
  writeCharacterBackgrounds,
  writeCharacters,
  writeLayoutSettings,
  writeSettings,
  writeViewTransform,
  DEFAULT_VIEW_TRANSFORM,
  type AppSettings,
  type BackgroundInfo,
  type Character,
  type CharacterBackgrounds,
  type ChatMessage,
  type ChatSummary,
  type ModelMode,
  type ModelStatus,
  type ViewMode,
  type ViewTransform,
} from "./store";

type CustomBackground = { id: string; dataUrl: string };
type MicPhase = "off" | "starting" | "listening" | "error";

const BUTTONS = [
  { id: "chat", icon: "/icons/nav/chat.svg?v=3", label: "Чат" },
  { id: "group", icon: "/icons/nav/group.svg?v=1", label: "Беседа" },
  { id: "screen", icon: "/icons/nav/screen.svg?v=1", label: "Поделиться экраном" },
  { id: "bg", icon: "/icons/nav/bg.svg?v=3", label: "Фон" },
  { id: "reactions", icon: "/icons/nav/reactions.svg?v=1", label: "Эмоции" },
  { id: "mic", icon: "/icons/nav/mic.svg?v=3", label: "Микрофон" },
  { id: "view", icon: "/icons/nav/view.svg?v=3", label: "Редактировать вид" },
  { id: "display", icon: "/icons/nav/view-mode.svg?v=1", label: "Режим отображения" },
  { id: "user", icon: "/icons/nav/user.svg?v=3", label: "Персонажи" },
  { id: "outfit", icon: "/icons/nav/arrows.svg?v=1", label: "Одежда" },
  { id: "settings", icon: "/icons/nav/settings.svg?v=3", label: "Настройки" },
  { id: "power", icon: "/icons/nav/power.svg?v=1", label: "Питание модели" },
];

const VIEW_MODE_OPTIONS: { id: ViewMode; icon: string; label: string }[] = [
  { id: "default", icon: "/icons/nav/view-mode-default.svg?v=1", label: "Обычный" },
  { id: "overlay", icon: "/icons/nav/view-mode-overlay.svg?v=1", label: "Поверх экрана" },
  { id: "fullscreen", icon: "/icons/nav/view-mode-fullscreen.svg?v=1", label: "Фулскрин" },
];

const BACKGROUND_STORAGE_KEY = "vrm.backgrounds.v1";
const BACKGROUND_MIGRATED_KEY = "vrm.backgrounds.migrated.v2";
const DEFAULT_WINDOW_WIDTH = 470;
const MIN_WINDOW_HEIGHT = 340;
const MAX_WINDOW_HEIGHT = 680;
const MIN_CHAT_WIDTH = 324;
const MAX_CHAT_WIDTH = 824;
const NAV_BUTTON_SIZE = 44;
const NAV_GAP = 8;
const ANIMATION_MS = 360;
const MAX_PENDING_REPLY = 5;
const RECENT_WINDOW = 24;
const SUMMARY_MIN_MESSAGES = RECENT_WINDOW + 8;
const SUMMARY_NEW_MESSAGES = 24;
const SUMMARY_SOURCE_MAX = 60;
const CROP_W = 243;
const CROP_H = 432;
const NAV_A_IDS = ["screen", "bg", "outfit", "view", "display"];
const NAV_B_IDS = [
  "chat",
  "group",
  "bg",
  "outfit",
  "view",
  "display",
  "reactions",
  "mic",
  "user",
  "settings",
  "power",
];

const groupKeyFor = (primaryId: string, partnerId: string) =>
  `group:${[primaryId, partnerId].sort().join(":")}`;

const isSettingsWindow = (() => {
  try {
    return getCurrentWindow().label === "settings";
  } catch {
    return false;
  }
})();

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function loadLegacyBackgrounds(): {
  activeId: string;
  customs: CustomBackground[];
} {
  const empty = { activeId: DEFAULT_BACKGROUND_ID, customs: [] as CustomBackground[] };
  try {
    if (localStorage.getItem(BACKGROUND_MIGRATED_KEY)) return empty;
    const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as {
      activeId?: unknown;
      customs?: unknown;
    };
    const customs = Array.isArray(parsed.customs)
      ? (parsed.customs.filter(
          (item): item is CustomBackground =>
            !!item &&
            typeof item === "object" &&
            typeof (item as CustomBackground).id === "string" &&
            typeof (item as CustomBackground).dataUrl === "string",
        ) as CustomBackground[])
      : [];
    return {
      activeId:
        typeof parsed.activeId === "string" ? parsed.activeId : DEFAULT_BACKGROUND_ID,
      customs,
    };
  } catch {
    return empty;
  }
}

function bubbleClass(from: ChatMessage["from"], partner = false) {
  if (from === "user") {
    return "max-w-[86%] self-end rounded-2xl rounded-tr-md bg-neutral-800/85 px-3 py-2 text-[13px] leading-[19px] text-white";
  }
  if (partner) {
    return "max-w-[86%] self-start rounded-2xl rounded-tl-md bg-sky-100/90 px-3 py-2 text-[13px] leading-[19px] text-sky-900";
  }
  return "max-w-[86%] self-start rounded-2xl rounded-tl-md bg-white/85 px-3 py-2 text-[13px] leading-[19px] text-neutral-700";
}

function modelLabel(modelId: string) {
  return modelId === DEFAULT_MODEL_ID
    ? "Базовая"
    : modelId.replace(/\.vrm$/i, "");
}

export default function App() {
  return isSettingsWindow ? <Settings /> : <MainApp />;
}

function MainApp() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputBRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const localRecorderRef = useRef<LocalMicRecorder | null>(null);
  const micOnRef = useRef(false);
  const micRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micRetryRef = useRef(0);
  const fillDraftRef = useRef<(text: string) => void>(() => {});
  const primaryStageRef = useRef<VrmStageHandle>(null);
  const partnerStageRef = useRef<VrmStageHandle>(null);
  const sendUserMessageRef = useRef<((text: string) => void) | null>(null);
  const activeCharacterIdRef = useRef(DEFAULT_CHARACTER_ID);
  const groupPartnerIdRef = useRef<string | null>(null);
  const chatKeyRef = useRef(DEFAULT_CHARACTER_ID);
  const customModelsRef = useRef<string[]>([]);
  const characterBackgroundRef = useRef<CharacterBackgrounds>(emptyCharacterBackgrounds());
  const partnerBackgroundRef = useRef<CharacterBackgrounds>(emptyCharacterBackgrounds());
  const backgroundLibraryRef = useRef<BackgroundInfo[]>([]);
  const backgroundUrlsRef = useRef<Record<string, string>>({});
  const backgroundMigrationRef = useRef(false);
  const charactersRef = useRef<Character[]>([]);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const viewModeRef = useRef<ViewMode>(DEFAULT_SETTINGS.viewMode);
  const changeViewModeRef = useRef<(mode: ViewMode) => void>(() => {});
  const modelModeRef = useRef<ModelMode>(DEFAULT_SETTINGS.modelMode);
  const apiDisabledRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const generationRef = useRef<{
    controller: AbortController;
    requestId: number;
  } | null>(null);
  const generationRequestIdRef = useRef(0);
  const llmQueueRef = useRef<Promise<void>>(Promise.resolve());
  const summaryAbortRef = useRef<AbortController | null>(null);
  const summaryBusyRef = useRef(false);
  const drainPendingRef = useRef<(characterId?: string) => Promise<void>>(async () => {});
  const didInitRef = useRef(false);
  const navbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [backgroundsOpen, setBackgroundsOpen] = useState(false);
  const [backgroundsBOpen, setBackgroundsBOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [groupPanelOpen, setGroupPanelOpen] = useState(false);
  const [groupPartnerId, setGroupPartnerId] = useState<string | null>(null);
  const [outfitOpen, setOutfitOpen] = useState(false);
  const [outfitBOpen, setOutfitBOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [activeReaction, setActiveReaction] = useState<ReactionId | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micPhase, setMicPhase] = useState<MicPhase>("off");
  const [micError, setMicError] = useState("");
  const [speech, setSpeech] = useState(DEFAULT_SETTINGS.speech);
  const [modelMode, setModelMode] = useState<ModelMode>(DEFAULT_SETTINGS.modelMode);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [apiDisabled, setApiDisabled] = useState(false);
  const [modelState, setModelState] = useState<ModelStatus>({ status: "idle", message: "" });
  const [modelLoading, setModelLoading] = useState(false);
  const [modelOnly, setModelOnly] = useState(false);
  const [powerMenu, setPowerMenu] = useState<{ x: number; y: number } | null>(null);
  const [viewModeMenu, setViewModeMenu] = useState<{ x: number; y: number } | null>(null);
  const [windowHeight, setWindowHeight] = useState(DEFAULT_SETTINGS.windowHeight);
  const [chatWidth, setChatWidth] = useState(DEFAULT_SETTINGS.chatWidth);
  const [chatAppearance, setChatAppearance] = useState(DEFAULT_SETTINGS.chatAppearance);
  const [navbarVisibility, setNavbarVisibility] = useState(DEFAULT_SETTINGS.navbarVisibility);
  const [navbarTemporarilyShown, setNavbarTemporarilyShown] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_SETTINGS.viewMode);
  const [localVision, setLocalVision] = useState(DEFAULT_SETTINGS.localVision);
  const [apiVision, setApiVision] = useState(DEFAULT_SETTINGS.apiVision);
  const [manualMusic, setManualMusic] = useState(DEFAULT_SETTINGS.manualMusic ?? false);
  const [chatImageUrls, setChatImageUrls] = useState<Record<string, string>>({});
  const chatImageFailedRef = useRef<Set<string>>(new Set());
  const [resizing, setResizing] = useState(false);
  const [modelWaking, setModelWaking] = useState(false);
  const [modelRevealing, setModelRevealing] = useState(false);
  const [editView, setEditView] = useState(false);
  const [partnerEditView, setPartnerEditView] = useState(false);
  const [viewTransform, setViewTransform] = useState<ViewTransform>(DEFAULT_VIEW_TRANSFORM);
  const [partnerViewTransform, setPartnerViewTransform] = useState<ViewTransform>(
    DEFAULT_VIEW_TRANSFORM,
  );
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState(DEFAULT_CHARACTER_ID);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [modelsReady, setModelsReady] = useState(false);
  const [backgroundLibrary, setBackgroundLibrary] = useState<BackgroundInfo[]>([]);
  const [backgroundUrls, setBackgroundUrls] = useState<Record<string, string>>({});
  const [backgroundNotice, setBackgroundNotice] = useState("");
  const [characterBackground, setCharacterBackground] = useState<CharacterBackgrounds>(
    emptyCharacterBackgrounds,
  );
  const [partnerBackground, setPartnerBackground] = useState<CharacterBackgrounds>(
    emptyCharacterBackgrounds,
  );
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<"primary" | "partner">("primary");
  const [cropImageSize, setCropImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 });
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowWidthRef = useRef(0);
  const windowHeightRef = useRef(DEFAULT_SETTINGS.windowHeight);
  const chatWidthRef = useRef(DEFAULT_SETTINGS.chatWidth);
  const resizeDragRef = useRef<{
    kind: "window" | "chat";
    pointerId: number;
    start: number;
    value: number;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToUpdates(setUpdateInfo);
    void startUpdateWatcher();
    return unsubscribe;
  }, []);

  useEffect(() => {
    activeCharacterIdRef.current = activeCharacterId;
    chatKeyRef.current =
      groupPartnerIdRef.current && activeCharacterId !== groupPartnerIdRef.current
        ? groupKeyFor(activeCharacterId, groupPartnerIdRef.current)
        : activeCharacterId;
  }, [activeCharacterId]);

  useEffect(() => {
    groupPartnerIdRef.current = groupPartnerId;
    chatKeyRef.current =
      groupPartnerId && activeCharacterIdRef.current !== groupPartnerId
        ? groupKeyFor(activeCharacterIdRef.current, groupPartnerId)
        : activeCharacterIdRef.current;
  }, [groupPartnerId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    characterBackgroundRef.current = characterBackground;
  }, [characterBackground]);

  useEffect(() => {
    partnerBackgroundRef.current = partnerBackground;
  }, [partnerBackground]);

  useEffect(() => {
    backgroundLibraryRef.current = backgroundLibrary;
  }, [backgroundLibrary]);

  useEffect(
    () => () => {
      generationRef.current?.controller.abort();
      summaryAbortRef.current?.abort();
      if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      if (micRestartTimerRef.current) clearTimeout(micRestartTimerRef.current);
    },
    [],
  );

  const triggerReaction = (id: ReactionId, target: "primary" | "partner" = "primary") => {
    if (target === "partner") partnerStageRef.current?.react(id);
    else primaryStageRef.current?.react(id);
    setActiveReaction(id);
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = setTimeout(
      () => setActiveReaction(null),
      (REACTIONS[id].duration + 0.6) * 1000,
    );
  };

  useEffect(
    () => () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    },
    [],
  );

  const enqueueLlm = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = llmQueueRef.current.then(task, task);
    llmQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const currentChatKey = () => chatKeyRef.current;

  const apiIsConfigured = (source = settingsRef.current) =>
    Boolean(source.api?.baseUrl?.trim() && source.api?.model?.trim());

  const aiAvailable = () =>
    (settingsRef.current.modelMode ?? "local") === "api"
      ? apiIsConfigured() && !apiDisabledRef.current
      : modelState.status === "loaded";

  const currentGroupCharacters = (): [Character, Character] | null => {
    const partnerId = groupPartnerIdRef.current;
    if (!partnerId || partnerId === activeCharacterIdRef.current) return null;
    const primary = charactersRef.current.find(
      (item) => item.id === activeCharacterIdRef.current,
    );
    const partner = charactersRef.current.find((item) => item.id === partnerId);
    return primary && partner ? [primary, partner] : null;
  };

  const readLocalChat = async (chatId: string): Promise<ChatMessage[]> =>
    readChat(chatId).catch(() => (chatId === chatKeyRef.current ? messagesRef.current : []));

  const applyReadIds = (chatId: string, ids: string[]) => {
    if (!ids.length || chatId !== chatKeyRef.current) return;
    const next = messagesRef.current.map((message) =>
      ids.includes(message.id) ? { ...message, pending: false } : message,
    );
    messagesRef.current = next;
    setMessages(next);
  };

  const sendBotMessage = (
    rawText: string,
    options: { speakerId?: string; chatId?: string } = {},
  ) => {
    const { text, reaction } = parseReaction(rawText);
    const chatId = options.chatId ?? chatKeyRef.current;
    const grouped = chatId.startsWith("group:");
    const speakerId = options.speakerId ?? activeCharacterIdRef.current;
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      text,
      from: "bot",
      createdAt: Date.now(),
      ...(reaction ? { reaction } : {}),
      ...(grouped ? { speakerId } : {}),
    };
    if (chatId === chatKeyRef.current) {
      const next = [...messagesRef.current, message];
      messagesRef.current = next;
      setMessages(next);
    }
    void appendChatMessage(chatId, message).catch((error) =>
      console.error("Не удалось сохранить сообщение", error),
    );
    if (reaction && chatId === chatKeyRef.current) {
      triggerReaction(
        reaction,
        speakerId === groupPartnerIdRef.current ? "partner" : "primary",
      );
    }
  };

  const splitGroupReply = (
    raw: string,
    characters: [Character, Character],
  ): Array<{ raw: string; speakerId: string }> => {
    const markers = Array.from(raw.matchAll(/\[\[speaker:\s*([01])\s*\]\]/gi));
    if (!markers.length) return [{ raw, speakerId: characters[0].id }];
    const parts: Array<{ raw: string; speakerId: string }> = [];
    for (const [index, marker] of markers.entries()) {
      const start = (marker.index ?? 0) + marker[0].length;
      const end = index + 1 < markers.length ? (markers[index + 1].index ?? raw.length) : raw.length;
      const body = raw.slice(start, end).trim();
      if (!body) continue;
      parts.push({
        raw: body,
        speakerId: characters[marker[1] === "1" ? 1 : 0].id,
      });
    }
    return parts.length ? parts : [{ raw, speakerId: characters[0].id }];
  };

  const ensureSummary = async (chatId: string) => {
    if (summaryBusyRef.current) return;
    const group = currentGroupCharacters();
    const grouped = chatId.startsWith("group:") && group;
    const character = grouped
      ? null
      : charactersRef.current.find((item) => item.id === chatId);
    if (!grouped && !character) return;

    const summaryThreshold = grouped
      ? Math.max(
          RECENT_WINDOW + 1,
          settingsRef.current.group?.summaryThreshold ?? SUMMARY_MIN_MESSAGES,
        )
      : SUMMARY_MIN_MESSAGES;

    const [messages, summary] = await Promise.all([
      readLocalChat(chatId),
      readChatSummary(chatId).catch(
        () => ({ text: "", upToMessageId: "", updatedAt: 0 } as ChatSummary),
      ),
    ]);
    if (messages.length < summaryThreshold) return;

    const upToIndex = summary.upToMessageId
      ? messages.findIndex((message) => message.id === summary.upToMessageId)
      : -1;
    if (summary.upToMessageId && upToIndex === -1) return;

    const unsummarized = upToIndex >= 0 ? messages.slice(upToIndex + 1) : messages;
    const source = unsummarized.slice(
      0,
      Math.max(0, unsummarized.length - RECENT_WINDOW),
    );
    const needsFirst = !summary.text && messages.length >= summaryThreshold;
    const needsUpdate = !!summary.text && source.length >= SUMMARY_NEW_MESSAGES;
    if ((!needsFirst && !needsUpdate) || !source.length) return;

    summaryBusyRef.current = true;
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    try {
      const withPrevious = summary.text
        ? [
            {
              id: "summary-previous",
              text: `Предыдущее резюме: ${summary.text}`,
              from: "bot" as const,
            },
            ...source,
          ]
        : source;
      const text = await enqueueLlm(() =>
        grouped
          ? requestGroupChatSummary({
              settings: settingsRef.current,
              characters: group,
              messages: withPrevious.slice(-SUMMARY_SOURCE_MAX),
              signal: controller.signal,
            })
          : requestChatSummary({
              settings: settingsRef.current,
              character: character!,
              messages: withPrevious.slice(-SUMMARY_SOURCE_MAX),
              signal: controller.signal,
            }),
      );
      if (!controller.signal.aborted) {
        await writeChatSummary(chatId, {
          text,
          upToMessageId: source[source.length - 1].id,
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Не удалось обновить резюме чата", error);
      }
    } finally {
      summaryBusyRef.current = false;
      if (summaryAbortRef.current === controller) summaryAbortRef.current = null;
    }
  };

  const performChatRequest = async ({
    chatId,
    history,
    pendingIds = [],
  }: {
    chatId: string;
    history: ChatMessage[];
    pendingIds?: string[];
  }) => {
    const group = currentGroupCharacters();
    const grouped = chatId.startsWith("group:") && group;
    const character = grouped ? null : charactersRef.current.find((item) => item.id === chatId);
    if (!grouped && !character) return;

    const controller = new AbortController();
    const requestId = ++generationRequestIdRef.current;
    generationRef.current = { controller, requestId };
    setGenerating(true);
    setChatError("");
    setChatNotice("");

    try {
      const summary = await readChatSummary(chatId).catch(
        () => ({ text: "", upToMessageId: "", updatedAt: 0 } as ChatSummary),
      );
      if (controller.signal.aborted) return;

      const reply = await enqueueLlm(() =>
        grouped
          ? requestGroupChatReply({
              settings: settingsRef.current,
              characters: group,
              history,
              summary: summary.text,
              signal: controller.signal,
            })
          : requestChatReply({
              settings: settingsRef.current,
              character: character!,
              history,
              summary: summary.text,
              signal: controller.signal,
            }),
      );
      if (controller.signal.aborted) return;

      if (grouped) {
        for (const part of splitGroupReply(reply, group)) {
          sendBotMessage(part.raw, { speakerId: part.speakerId, chatId });
        }
      } else {
        sendBotMessage(reply, { chatId });
      }
      if (pendingIds.length) {
        await markChatMessagesRead(chatId, pendingIds).catch((error) =>
          console.error("Не удалось отметить сообщения прочитанными", error),
        );
        applyReadIds(chatId, pendingIds);
      }
      void ensureSummary(chatId);
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : String(error);
        setChatError(`Не удалось получить ответ: ${detail}`);
      }
    } finally {
      if (generationRef.current?.requestId === requestId) {
        generationRef.current = null;
        setGenerating(false);
      }
    }
  };

  const drainPending = async (chatId = currentChatKey()) => {
    if (generationRef.current) return;
    const group = currentGroupCharacters();
    if (chatId.startsWith("group:") && !group) return;
    if (!chatId.startsWith("group:") && !charactersRef.current.some((item) => item.id === chatId)) {
      return;
    }

    const all = await readLocalChat(chatId);
    const pending = all.filter((message) => message.from === "user" && message.pending);
    if (!pending.length) return;

    const selected = pending.slice(-MAX_PENDING_REPLY);
    const skipped = pending.slice(0, pending.length - selected.length);
    const skippedIds = skipped.map((message) => message.id);
    if (skippedIds.length) {
      await markChatMessagesRead(chatId, skippedIds).catch((error) =>
        console.error("Не удалось отметить старые сообщения прочитанными", error),
      );
      applyReadIds(chatId, skippedIds);
    }

    const history = all.filter((message) => !skippedIds.includes(message.id));
    await performChatRequest({
      chatId,
      history,
      pendingIds: selected.map((message) => message.id),
    });
  };
  drainPendingRef.current = drainPending;

  const sendUserMessage = async (rawText: string, imageFile?: string) => {
    const text = (rawText ?? "").trim();
    if (!text && !imageFile) return;

    const chatId = currentChatKey();
    if (chatId.startsWith("group:") && !currentGroupCharacters()) {
      setChatError("Персонажи беседы не найдены");
      return;
    }
    if (!chatId.startsWith("group:") && !charactersRef.current.some((item) => item.id === chatId)) {
      setChatError("Персонаж не найден");
      return;
    }

    generationRef.current?.controller.abort();
    generationRef.current = null;
    setGenerating(false);
    setDraft("");
    setChatError("");
    setChatNotice("");

    let status: Awaited<ReturnType<typeof modelStatus>> | null = null;
    try {
      status = await modelStatus();
    } catch {
      status = null;
    }
    if (currentChatKey() !== chatId) return;

    const offline =
      (settingsRef.current.modelMode ?? "local") === "api"
        ? !aiAvailable()
        : !status || status.status !== "loaded";
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      text,
      from: "user",
      createdAt: Date.now(),
      ...(imageFile ? { imageFile } : {}),
      ...(offline ? { pending: true } : {}),
    };
    const withUser = [...messagesRef.current, message];
    messagesRef.current = withUser;
    setMessages(withUser);
    void appendChatMessage(chatId, message).catch((error) =>
      console.error("Не удалось сохранить сообщение", error),
    );

    if (offline) {
      setChatNotice(
        "Модель выключена — сообщение сохранено и будет отправлено после включения.",
      );
      return;
    }

    await performChatRequest({ chatId, history: withUser });
  };
  sendUserMessageRef.current = (text) => void sendUserMessage(text);
  fillDraftRef.current = (text) => {
    setChatOpen(true);
    setDraft((current) => (current.trim()) ? `${current.trim()} ${text}` : text);
    setChatNotice("Распознанный текст добавлен в поле ввода");
  };

  const shareScreen = async () => {
    if (!visionEnabled) return;
    setChatError("");
    try {
      const dataUrl = await captureScreen();
      setChatOpen(true);
      const pngBytes = await dataUrlBytes(dataUrl);
      const blobUrl = URL.createObjectURL(
        new Blob([new Uint8Array(pngBytes)], { type: "image/png" }),
      );
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Не удалось прочитать снимок экрана"));
        image.src = blobUrl;
      });
      const scale = Math.min(
        1,
        1600 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось обработать снимок экрана");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);
      const jpeg = canvas.toDataURL("image/jpeg", 0.8);
      const fileName = `screen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await saveChatImage(fileName, await dataUrlBytes(jpeg));
      const caption = draft;
      await sendUserMessage(caption, fileName);
      setDraft("");
    } catch (error) {
      setChatOpen(true);
      setChatError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    const names = Array.from(
      new Set(messages.map((message) => message.imageFile).filter(Boolean)),
    ).filter((name): name is string => name !== undefined && !chatImageFailedRef.current.has(name));
    if (!names.length) return;
    let cancelled = false;
    void Promise.all(
      names.map(async (name) => {
        if (chatImageUrls[name]) return null;
        const url = await readChatImage(name).catch(() => "");
        if (!url) chatImageFailedRef.current.add(name);
        return url ? ([name, url] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next = entries.filter(Boolean) as Array<readonly [string, string]>;
      if (next.length) {
        setChatImageUrls((current) => ({ ...current, ...Object.fromEntries(next) }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [messages, chatImageUrls]);

  const loadBackgroundLibrary = async (chars: Character[]) => {
    let library = await listBackgrounds().catch(() => [] as BackgroundInfo[]);
    const legacy = loadLegacyBackgrounds();

    if (
      library.length === 0 &&
      legacy.customs.length > 0 &&
      !backgroundMigrationRef.current
    ) {
      backgroundMigrationRef.current = true;
      const created: BackgroundInfo[] = [];
      const idMap: Record<string, string> = {};
      for (const [index, item] of legacy.customs.entries()) {
        try {
          const bytes = await dataUrlBytes(item.dataUrl);
          const info = await saveBackground(`Фон ${index + 1}`, bytes);
          created.push(info);
          idMap[item.id] = info.id;
        } catch (error) {
          console.error("Не удалось перенести старый фон", error);
        }
      }
      const activeId =
        legacy.activeId === DEFAULT_BACKGROUND_ID
          ? DEFAULT_BACKGROUND_ID
          : (idMap[legacy.activeId] ?? DEFAULT_BACKGROUND_ID);
      for (const character of chars) {
        await writeCharacterBackgrounds(character.id, {
          activeId,
          attachedIds: created.map((item) => item.id),
        }).catch((error) => console.error("Не удалось перенести фон персонажа", error));
      }
      try {
        localStorage.setItem(BACKGROUND_MIGRATED_KEY, "1");
        localStorage.removeItem(BACKGROUND_STORAGE_KEY);
      } catch {
        // localStorage может быть недоступен
      }
      library = await listBackgrounds().catch(() => [] as BackgroundInfo[]);
    }

    setBackgroundLibrary(library);
    const urls: Record<string, string> = { ...backgroundUrlsRef.current };
    const activeIds = new Set(library.map((item) => item.id));
    for (const [id, url] of Object.entries(urls)) {
      if (!activeIds.has(id)) {
        URL.revokeObjectURL(url);
        delete urls[id];
      }
    }
    for (const item of library) {
      if (urls[item.id]) continue;
      try {
        const bytes = await readBackground(item.fileName);
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
        );
        urls[item.id] = url;
      } catch {
        // фон может быть временно недоступен
      }
    }
    backgroundUrlsRef.current = urls;
    setBackgroundUrls(urls);
  };

  const loadCharacterBackgroundState = async (id: string, target: "primary" | "partner" = "primary") => {
    const state = normalizeCharacterBackgrounds(
      await readCharacterBackgrounds(id).catch(() => emptyCharacterBackgrounds()),
    );
    if (target === "partner") {
      partnerBackgroundRef.current = state;
      setPartnerBackground(state);
    } else {
      characterBackgroundRef.current = state;
      setCharacterBackground(state);
    }
  };

  useEffect(() => {
    const refresh = async () => {
      try {
        const [nextSettings, nextCharacters, vrmList, nextModelState] = await Promise.all([
          readSettings().catch(() => DEFAULT_SETTINGS),
          readCharacters().catch(() => [] as Character[]),
          listVrmModels().catch(() => [] as string[]),
          modelStatus().catch(() => ({ status: "idle", message: "" } as ModelStatus)),
        ]);
        let activeModelState = nextModelState;

        const id = nextCharacters.some((item) => item.id === nextSettings.activeCharacterId)
          ? nextSettings.activeCharacterId
          : nextCharacters[0]?.id ?? DEFAULT_CHARACTER_ID;
        const isFirstInit = !didInitRef.current;
        const characterChanged =
          didInitRef.current && id !== activeCharacterIdRef.current;

        if (characterChanged) {
          generationRef.current?.controller.abort();
          generationRef.current = null;
          setGenerating(false);
          summaryAbortRef.current?.abort();
          setChatNotice("");
        }

        const nextHeight = clamp(
          nextSettings.windowHeight || DEFAULT_SETTINGS.windowHeight,
          MIN_WINDOW_HEIGHT,
          MAX_WINDOW_HEIGHT,
        );
        const nextChatWidth = clamp(
          nextSettings.chatWidth || DEFAULT_SETTINGS.chatWidth,
          MIN_CHAT_WIDTH,
          MAX_CHAT_WIDTH,
        );
        windowHeightRef.current = nextHeight;
        chatWidthRef.current = nextChatWidth;
        setWindowHeight(nextHeight);
        setChatWidth(nextChatWidth);
        setChatAppearance(nextSettings.chatAppearance ?? "default");
        setNavbarVisibility(nextSettings.navbarVisibility ?? "always");
        const nextViewMode = nextSettings.viewMode ?? "default";
        viewModeRef.current = nextViewMode;
        setViewMode(nextViewMode);
        setLocalVision(nextSettings.localVision ?? false);
        setApiVision(nextSettings.apiVision ?? false);
        setManualMusic(nextSettings.manualMusic ?? false);

        customModelsRef.current = vrmList;
        charactersRef.current = nextCharacters;
        settingsRef.current = nextSettings;

        const nextMode = nextSettings.modelMode ?? "local";
        const nextApiConfigured = Boolean(
          nextSettings.api?.baseUrl?.trim() && nextSettings.api?.model?.trim(),
        );
        const modeChanged = didInitRef.current && nextMode !== modelModeRef.current;
        if (modeChanged) {
          generationRef.current?.controller.abort();
          generationRef.current = null;
          setGenerating(false);
          summaryAbortRef.current?.abort();
          setChatNotice("");
          setChatError("");
          if (modelModeRef.current === "local" && nextModelState.status === "loaded") {
            activeModelState = await stopModel();
          }
          apiDisabledRef.current = false;
          setApiDisabled(false);
          setModelOnly(false);
        }
        modelModeRef.current = nextMode;
        setModelMode(nextMode);
        setApiConfigured(nextApiConfigured);

        setSpeech((current) =>
          JSON.stringify(current) === JSON.stringify(nextSettings.speech)
            ? current
            : nextSettings.speech,
        );
        activeCharacterIdRef.current = id;
        setModelState(activeModelState);
        setCharacters(nextCharacters);
        setActiveCharacterId(id);
        await loadBackgroundLibrary(nextCharacters);
        await loadCharacterBackgroundState(id);
        const nextMessages = await readChat(id).catch(() => [] as ChatMessage[]);
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        if (!didInitRef.current || characterChanged) {
          setViewTransform(
            await readViewTransform(id, viewModeRef.current).catch(() => DEFAULT_VIEW_TRANSFORM),
          );
        }
        didInitRef.current = true;
        setModelsReady(true);

        if (isFirstInit) {
          if (nextSettings.startWithChat) setChatOpen(true);

          if (nextSettings.startWithModel) {
            apiDisabledRef.current = true;
            setApiDisabled(true);
            if (activeModelState.status === "loaded") {
              const stopped = await stopModel();
              activeModelState = stopped;
              setModelState(stopped);
            }
            setModelOnly(true);
            beginWake();
            scheduleReveal();
          } else if (nextSettings.startLocalModel && nextMode === "local") {
            if (activeModelState.status === "loaded") {
              setModelOnly(false);
              apiDisabledRef.current = false;
              setApiDisabled(false);
            } else {
              setModelLoading(true);
              try {
                beginWake();
                const started = await startModel();
                activeModelState = started;
                setModelState(started);
                if (started.status === "error") {
                  finishWake();
                  setChatError(started.message || "Не удалось запустить модель");
                } else if (started.status === "loaded") {
                  setModelOnly(false);
                  setChatNotice("");
                  scheduleReveal();
                } else {
                  finishWake();
                }
              } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                activeModelState = { status: "error", message: detail };
                setModelState(activeModelState);
                finishWake();
                setChatError(detail);
              } finally {
                setModelLoading(false);
              }
            }
          }
        }

        if (
          nextMode === "api"
            ? nextApiConfigured && !apiDisabledRef.current
            : activeModelState.status === "loaded"
        ) {
          void drainPendingRef.current(id);
        }
      } catch (error) {
        console.error("Не удалось загрузить состояние", error);
      }
    };

    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const changeViewMode = (mode: ViewMode) => {
    if (viewModeRef.current === mode) return;
    viewModeRef.current = mode;
    setViewMode(mode);
    const next = { ...settingsRef.current, viewMode: mode };
    settingsRef.current = next;
    void writeSettings(next).catch((error) =>
      console.error("Не удалось сохранить режим отображения", error),
    );
    void readViewTransform(activeCharacterIdRef.current, mode)
      .then(setViewTransform)
      .catch(() => setViewTransform(DEFAULT_VIEW_TRANSFORM));
    const partnerId = groupPartnerIdRef.current;
    if (partnerId) {
      void readViewTransform(partnerId, mode)
        .then(setPartnerViewTransform)
        .catch(() => setPartnerViewTransform(DEFAULT_VIEW_TRANSFORM));
    }
  };
  changeViewModeRef.current = changeViewMode;

  useEffect(() => {
    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      return;
    }
    void win.setFullscreen(viewMode === "fullscreen").catch((error) =>
      console.error("Не удалось переключить полноэкранный режим", error),
    );
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "fullscreen") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt < 1500) return;
      void getCurrentWindow()
        .isFullscreen()
        .then((active) => {
          if (!active) changeViewModeRef.current("default");
        })
        .catch(() => {});
    }, 700);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      changeViewModeRef.current("default");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [viewMode]);

  useEffect(() => {
    if (modelLoading) return;
    const sync = () => {
      void modelStatus()
        .then((next) => {
          setModelState((current) =>
            current.status === next.status && current.message === next.message ? current : next,
          );
        })
        .catch(() => {});
    };
    const timer = window.setInterval(sync, 3000);
    return () => window.clearInterval(timer);
  }, [modelLoading]);

  useEffect(() => {
    windowHeightRef.current = windowHeight;
    if (viewMode === "fullscreen") return;
    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      // в обычном браузере менять размер окна нечем
    }
    if (win) {
      const width = windowWidthRef.current || DEFAULT_WINDOW_WIDTH;
      void win.setSize(new LogicalSize(width, windowHeight)).catch(() => {});
    }
  }, [windowHeight, viewMode]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      // в обычном браузере менять размер окна нечем
    }

    const applySize = (width: number) => {
      if (viewModeRef.current === "fullscreen") return;
      const next = Math.max(1, Math.ceil(width));
      windowWidthRef.current = next;
      if (win) {
        void win.setSize(new LogicalSize(next, windowHeightRef.current)).catch(() => {});
      }
    };

    const sync = (force = false) => {
      const width = root.getBoundingClientRect().width;
      if (!width) return;
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (force || width > windowWidthRef.current) {
        applySize(width);
      } else if (width < windowWidthRef.current) {
        resizeTimerRef.current = setTimeout(() => {
          const latest = root.getBoundingClientRect().width;
          if (latest) applySize(latest);
        }, ANIMATION_MS);
      }
    };

    const observer = new ResizeObserver(() => sync());
    observer.observe(root);
    const frame = requestAnimationFrame(() => sync(true));

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      if (navbarTimerRef.current) clearTimeout(navbarTimerRef.current);
    };
  }, []);

  const activeCharacter = characters.find((item) => item.id === activeCharacterId) ?? null;
  const groupPartner = characters.find((item) => item.id === groupPartnerId) ?? null;
  const groupActive = Boolean(groupPartner);
  const targetModelId = activeCharacter?.modelId ?? DEFAULT_MODEL_ID;
  const partnerModelId = groupPartner?.modelId ?? DEFAULT_MODEL_ID;
  const apiMode = modelMode === "api";
  const isFullscreen = viewMode === "fullscreen";
  const immersive = viewMode === "fullscreen" || viewMode === "overlay";
  const stageTransparent = viewMode === "overlay";
  const visionEnabled = apiMode ? apiVision : localVision;
  const apiReady = apiMode && apiConfigured && !apiDisabled;
  const llmLoaded = apiMode ? apiReady : modelState.status === "loaded";
  const modelShown = llmLoaded || modelOnly;
  const avatarVisible = !modelShown || (modelWaking && !modelRevealing);
  const stageBlurred = modelWaking && !modelRevealing;
  const stageRevealing = modelWaking && modelRevealing;
  const modelVisible = modelShown && (!modelWaking || modelRevealing);
  const chatPanelClass =
    chatAppearance === "glass"
      ? "border border-white/60 bg-white/45 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150"
      : chatAppearance === "bubbles"
        ? "bg-transparent"
        : "bg-white shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)]";
  const navbarVisible = navbarVisibility === "always" || navbarTemporarilyShown;
  const avatarSource = activeCharacter?.avatar ?? null;
  const avatarName = activeCharacter?.name ?? "Персонаж";
  const partnerAvatarSource = groupPartner?.avatar ?? null;
  const partnerAvatarName = groupPartner?.name ?? "Персонаж";
  const primaryModelId =
    targetModelId === DEFAULT_MODEL_ID || customModelsRef.current.includes(targetModelId)
      ? targetModelId
      : DEFAULT_MODEL_ID;
  const partnerStageModelId =
    partnerModelId === DEFAULT_MODEL_ID || customModelsRef.current.includes(partnerModelId)
      ? partnerModelId
      : DEFAULT_MODEL_ID;
  const navCompact = (count: number) =>
    windowHeight * 0.88 < count * NAV_BUTTON_SIZE + (count - 1) * NAV_GAP;
  const navWidthFor = (count: number) =>
    navCompact(count) ? NAV_BUTTON_SIZE * 2 + NAV_GAP : NAV_BUTTON_SIZE;

  useEffect(() => {
    micOnRef.current = micOn;
    if (!micOn) {
      localRecorderRef.current?.cancel();
      localRecorderRef.current = null;
      return;
    }

    const fail = (message: string) => {
      localRecorderRef.current?.cancel();
      localRecorderRef.current = null;
      micOnRef.current = false;
      setMicOn(false);
      setMicError(message);
      setMicPhase("error");
    };

    if (!speech.enabled) {
      fail("Микрофон отключён в настройках");
      return;
    }

    setMicError("");
    setMicPhase("starting");
    micRetryRef.current = 0;

    let disposed = false;
    const debug = (message: string) => {
      void speechDebug(message).catch(() => {});
    };

    const deliverText = (text: string) => {
      if (!text || disposed || !micOnRef.current) return;
      micRetryRef.current = 0;
      if (speech.autoSend) {
        sendUserMessageRef.current?.(text);
      } else {
        fillDraftRef.current?.(text);
      }
    };

    const stopListening = () => {
      micOnRef.current = false;
      setMicOn(false);
      setMicPhase("off");
    };

    const scheduleRestart = (delay: number, next: () => void) => {
      if (disposed || !micOnRef.current) return;
      if (micRestartTimerRef.current) clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = setTimeout(() => {
        micRestartTimerRef.current = null;
        next();
      }, delay);
    };

    if (speech.engine === "localParakeet") {
      async function runLocal() {
        if (disposed || !micOnRef.current) return;
        setMicError("");
        setMicPhase("starting");
        try {
          const stt = await sttStart();
          debug(`stt status=${stt.status} message=${stt.message}`);
          if (stt.status === "error") {
            throw new Error(stt.message || "Не удалось запустить локальный STT");
          }
          if (disposed || !micOnRef.current) return;

          const recorder = new LocalMicRecorder();
          localRecorderRef.current = recorder;
          setMicPhase("listening");
          const wav = await recorder.record({
            silenceMs: 900,
            maxMs: 15000,
            onStats: (stats: LocalCaptureStats) => {
              debug(
                `capture sourceRate=${stats.sourceRate} duration=${stats.durationMs}ms voice=${stats.voiceMs}ms peak=${stats.peakRms.toFixed(4)} last=${stats.lastRms.toFixed(4)} threshold=${stats.threshold.toFixed(4)} wavPeak=${stats.wavPeak.toFixed(4)} wav=${stats.wavBytes}`,
              );
            },
          });
          localRecorderRef.current = null;
          if (disposed || !micOnRef.current) return;
          if (!wav.byteLength) {
            throw new Error("Речь не распознана, попробуйте ещё раз");
          }

          setMicPhase("starting");
          const text = await transcribeAudio(wav, speech.language);
          debug(`result text=${JSON.stringify(text)}`);
          if (disposed || !micOnRef.current) return;

          if (text) {
            deliverText(text);
            if (speech.continuous) {
              scheduleRestart(250, () => void runLocal());
              return;
            }
            stopListening();
            return;
          }
          throw new Error("Речь не распознана, попробуйте ещё раз");
        } catch (error) {
          if (disposed || !micOnRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          debug(`error=${message}`);
          setMicError(message);
          const noSpeech = message.includes("Речь не распознана");
          if (noSpeech && speech.autoRestart && micRetryRef.current < 5) {
            micRetryRef.current += 1;
            scheduleRestart(500, () => void runLocal());
            return;
          }
          fail(message);
        }
      }

      void runLocal();
      return () => {
        disposed = true;
        if (micRestartTimerRef.current) clearTimeout(micRestartTimerRef.current);
        micRestartTimerRef.current = null;
        localRecorderRef.current?.cancel();
        localRecorderRef.current = null;
      };
    }

    const RecognitionImpl = getSpeechRecognitionConstructor();
    if (!RecognitionImpl) {
      fail("Распознавание речи недоступно в этом окне");
      return;
    }

    const recognition = new RecognitionImpl();
    recognition.lang = speech.language || "ru-RU";
    recognition.continuous = speech.continuous;
    recognition.interimResults = false;

    let fatalError = false;

    const start = () => {
      try {
        recognition.start();
      } catch {
        fatalError = true;
        fail("Не удалось запустить распознавание речи");
      }
    };

    recognition.onstart = () => {
      micRetryRef.current = 0;
      setMicError("");
      setMicPhase("listening");
    };

    recognition.onresult = (event) => {
      deliverText(collectFinalText(event));
    };

    recognition.onerror = (event) => {
      const code = event.error;
      setMicError(describeSpeechError(code));
      if (code === "aborted" || code === "no-speech") return;
      fatalError = true;
      fail(describeSpeechError(code));
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (fatalError || !micOnRef.current) {
        if (!fatalError) setMicPhase("off");
        return;
      }
      if (speech.autoRestart && micRetryRef.current < 5) {
        micRetryRef.current += 1;
        scheduleRestart(500, start);
        return;
      }
      stopListening();
    };

    recognitionRef.current = recognition;
    start();

    return () => {
      disposed = true;
      if (micRestartTimerRef.current) clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = null;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
      try {
        recognition.stop();
      } catch {
        // распознавание могло уже завершиться
      }
    };
  }, [micOn, speech]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, chatOpen, generating, chatError, chatNotice]);

  useEffect(() => {
    if (!cropSource) {
      setCropImageSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setCropImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setCropZoom(1);
      setCropPos({ x: 0, y: 0 });
    };
    img.src = cropSource;
  }, [cropSource]);

  const resetConversationState = async (characterId: string) => {
    generationRef.current?.controller.abort();
    generationRef.current = null;
    setGenerating(false);
    summaryAbortRef.current?.abort();
    setChatError("");
    setChatNotice("");
    chatKeyRef.current = characterId;
    const nextMessages = await readChat(characterId).catch(() => [] as ChatMessage[]);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setViewTransform(
      await readViewTransform(characterId, viewModeRef.current).catch(() => DEFAULT_VIEW_TRANSFORM),
    );
    await loadCharacterBackgroundState(characterId);
    if (aiAvailable()) void drainPendingRef.current(characterId);
  };

  const selectCharacter = async (id: string) => {
    beginWake();
    if (groupPartnerId) {
      groupPartnerIdRef.current = null;
      setGroupPartnerId(null);
      setGroupPanelOpen(false);
      setPartnerEditView(false);
      setBackgroundsBOpen(false);
      setOutfitBOpen(false);
    }
    activeCharacterIdRef.current = id;
    setActiveCharacterId(id);
    setCharactersOpen(false);
    await resetConversationState(id);
    try {
      await setActiveCharacter(id);
    } catch (error) {
      console.error("Не удалось сохранить активного персонажа", error);
    }
    scheduleReveal();
  };

  const selectGroupPartner = async (id: string) => {
    if (!id || id === activeCharacterIdRef.current) return;
    groupPartnerIdRef.current = id;
    setGroupPartnerId(id);
    setGroupPanelOpen(false);
    setCharactersOpen(false);
    setBackgroundsOpen(false);
    setBackgroundsBOpen(false);
    setOutfitOpen(false);
    setOutfitBOpen(false);
    setPartnerEditView(false);
    setChatOpen(true);
    setChatError("");
    setChatNotice("");
    generationRef.current?.controller.abort();
    generationRef.current = null;
    setGenerating(false);
    const key = groupKeyFor(activeCharacterIdRef.current, id);
    chatKeyRef.current = key;
    const nextMessages = await readChat(key).catch(() => [] as ChatMessage[]);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setPartnerViewTransform(
      await readViewTransform(id, viewModeRef.current).catch(() => DEFAULT_VIEW_TRANSFORM),
    );
    await loadCharacterBackgroundState(id, "partner");
    if (aiAvailable()) void drainPendingRef.current(key);
  };

  const endGroup = async () => {
    groupPartnerIdRef.current = null;
    setGroupPartnerId(null);
    setGroupPanelOpen(false);
    setBackgroundsBOpen(false);
    setOutfitBOpen(false);
    setPartnerEditView(false);
    await resetConversationState(activeCharacterIdRef.current);
  };

  const selectOutfit = (modelId: string, target: "primary" | "partner" = "primary") => {
    const id =
      target === "partner" ? groupPartnerIdRef.current : activeCharacterIdRef.current;
    if (!id) return;
    const next = charactersRef.current.map((character) =>
      character.id === id ? { ...character, modelId } : character,
    );
    charactersRef.current = next;
    setCharacters(next);
    void writeCharacters(next).catch((error) =>
      console.error("Не удалось сохранить модель персонажа", error),
    );
  };

  const commitCharacterBackground = async (
    state: CharacterBackgrounds,
    target: "primary" | "partner" = "primary",
  ) => {
    const next = normalizeCharacterBackgrounds(state);
    const id =
      target === "partner" ? groupPartnerIdRef.current : activeCharacterIdRef.current;
    if (!id) return;
    if (target === "partner") {
      partnerBackgroundRef.current = next;
      setPartnerBackground(next);
    } else {
      characterBackgroundRef.current = next;
      setCharacterBackground(next);
    }
    try {
      await writeCharacterBackgrounds(id, next);
    } catch (error) {
      console.error("Не удалось сохранить фон персонажа", error);
      setBackgroundNotice("Не удалось сохранить фон");
    }
  };

  const selectBackground = (id: string, target: "primary" | "partner" = "primary") => {
    setBackgroundNotice("");
    const current =
      target === "partner" ? partnerBackgroundRef.current : characterBackgroundRef.current;
    void commitCharacterBackground({ ...current, activeId: id }, target);
  };

  const detachBackground = (id: string, target: "primary" | "partner" = "primary") => {
    setBackgroundNotice("");
    const current =
      target === "partner" ? partnerBackgroundRef.current : characterBackgroundRef.current;
    void commitCharacterBackground(
      {
        activeId: current.activeId === id ? DEFAULT_BACKGROUND_ID : current.activeId,
        attachedIds: current.attachedIds.filter((value) => value !== id),
      },
      target,
    );
  };

  const clearWakeTimers = () => {
    if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    wakeTimerRef.current = null;
    revealTimerRef.current = null;
  };

  const finishWake = () => {
    clearWakeTimers();
    setModelWaking(false);
    setModelRevealing(false);
  };

  const beginWake = () => {
    clearWakeTimers();
    setModelRevealing(false);
    setModelWaking(true);
  };

  const scheduleReveal = () => {
    clearWakeTimers();
    wakeTimerRef.current = setTimeout(() => {
      setModelRevealing(true);
      revealTimerRef.current = setTimeout(finishWake, 900);
    }, 5000);
  };

  const clearNavbarTimer = () => {
    if (navbarTimerRef.current) clearTimeout(navbarTimerRef.current);
    navbarTimerRef.current = null;
  };

  const closeNavPanels = () => {
    setBackgroundsOpen(false);
    setBackgroundsBOpen(false);
    setOutfitOpen(false);
    setOutfitBOpen(false);
    setCharactersOpen(false);
    setReactionsOpen(false);
    setGroupPanelOpen(false);
    setChatOpen(false);
    setPowerMenu(null);
  };

  const hideNavbar = () => {
    clearNavbarTimer();
    setNavbarTemporarilyShown(false);
    closeNavPanels();
  };

  const showNavbarFor = (durationMs: number) => {
    clearNavbarTimer();
    setNavbarTemporarilyShown(true);
    navbarTimerRef.current = setTimeout(() => {
      navbarTimerRef.current = null;
      setNavbarTemporarilyShown(false);
      closeNavPanels();
    }, durationMs);
  };

  const handlePointerActivity = () => {
    if (navbarVisibility === "hover") {
      showNavbarFor(15000);
    } else if (navbarVisibility === "hidden" && navbarTemporarilyShown) {
      showNavbarFor(35000);
    }
  };

  const handlePointerLeave = () => {
    if (navbarVisibility !== "always") hideNavbar();
  };

  useEffect(() => {
    clearNavbarTimer();
    setNavbarTemporarilyShown(false);
    if (navbarVisibility !== "always") closeNavPanels();
  }, [navbarVisibility]);

  const stopAi = async () => {
    finishWake();
    generationRef.current?.controller.abort();
    generationRef.current = null;
    setGenerating(false);
    summaryAbortRef.current?.abort();
    return stopModel();
  };

  const toggleModel = async () => {
    if (modelLoading) return;
    setPowerMenu(null);
    setModelLoading(true);
    setChatError("");
    try {
      if (settingsRef.current.modelMode === "api") {
        if (!apiIsConfigured()) {
          setChatError("Укажите Base URL и модель API в настройках");
          finishWake();
          return;
        }
        if (apiDisabledRef.current) {
          apiDisabledRef.current = false;
          setApiDisabled(false);
          setModelOnly(false);
          setChatNotice("");
          beginWake();
          void drainPendingRef.current(currentChatKey());
          scheduleReveal();
        } else {
          apiDisabledRef.current = true;
          setApiDisabled(true);
          generationRef.current?.controller.abort();
          generationRef.current = null;
          setGenerating(false);
          summaryAbortRef.current?.abort();
          finishWake();
        }
        return;
      }

      const isLoaded = modelState.status === "loaded";
      if (isLoaded) {
        const next = await stopAi();
        setModelState(next);
        setModelOnly(false);
        if (next.status === "error") {
          setChatError(next.message || "Не удалось выключить модель");
        }
      } else {
        const wasModelOnly = modelOnly;
        if (!wasModelOnly) beginWake();
        const next = await startModel();
        setModelState(next);
        if (next.status === "error") {
          finishWake();
          setChatError(next.message || "Не удалось запустить модель");
        } else if (next.status === "loaded") {
          setModelOnly(false);
          setChatNotice("");
          void drainPendingRef.current(currentChatKey());
          if (!wasModelOnly) scheduleReveal();
        } else if (next.status !== "loading") {
          finishWake();
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setModelState({ status: "error", message: detail });
      finishWake();
      setChatError(detail);
    } finally {
      setModelLoading(false);
    }
  };

  const startAi = async () => {
    if (modelLoading) return;
    setPowerMenu(null);
    if (settingsRef.current.modelMode === "api") {
      if (apiDisabledRef.current) await toggleModel();
      else setModelOnly(false);
      return;
    }
    if (modelState.status === "loaded") {
      setModelOnly(false);
      return;
    }
    await toggleModel();
  };

  const startModelOnly = async () => {
    if (modelLoading) return;
    setPowerMenu(null);
    setModelLoading(true);
    setChatError("");
    try {
      if (settingsRef.current.modelMode === "api") {
        apiDisabledRef.current = true;
        setApiDisabled(true);
        generationRef.current?.controller.abort();
        generationRef.current = null;
        setGenerating(false);
        summaryAbortRef.current?.abort();
        setModelOnly(true);
        beginWake();
        scheduleReveal();
        return;
      }
      if (modelState.status === "loaded") {
        const next = await stopAi();
        setModelState(next);
      }
      setModelOnly(true);
      beginWake();
      scheduleReveal();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setChatError(detail);
    } finally {
      setModelLoading(false);
    }
  };

  const beginResize = (
    kind: "window" | "chat",
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizeDragRef.current = {
      kind,
      pointerId: event.pointerId,
      start: kind === "window" ? event.clientY : event.clientX,
      value: kind === "window" ? windowHeightRef.current : chatWidthRef.current,
    };
    setResizing(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // pointer capture не всегда доступен
    }
  };

  const moveResize = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "window") {
      const next = clamp(
        Math.round(drag.value + event.clientY - drag.start),
        MIN_WINDOW_HEIGHT,
        MAX_WINDOW_HEIGHT,
      );
      if (next !== windowHeightRef.current) {
        windowHeightRef.current = next;
        setWindowHeight(next);
      }
    } else {
      const next = clamp(
        Math.round(drag.value + event.clientX - drag.start),
        MIN_CHAT_WIDTH,
        MAX_CHAT_WIDTH,
      );
      if (next !== chatWidthRef.current) {
        chatWidthRef.current = next;
        setChatWidth(next);
      }
    }
  };

  const endResize = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeDragRef.current = null;
    setResizing(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture не всегда доступен
    }
    void writeLayoutSettings(windowHeightRef.current, chatWidthRef.current).catch(
      (error) => console.error("Не удалось сохранить размеры окна", error),
    );
  };

  useEffect(() => {
    if (!powerMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPowerMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [powerMenu]);

  const toggleMic = () => {
    if (micOn || micPhase === "starting") {
      micOnRef.current = false;
      setMicOn(false);
      setMicPhase("off");
      setMicError("");
      return;
    }
    if (!speech.enabled) {
      setMicError("Микрофон отключён в настройках");
      setMicPhase("error");
      return;
    }
    setMicError("");
    setMicPhase("starting");
    micOnRef.current = true;
    setMicOn(true);
  };

  const openSettings = async () => {
    try {
      let existing: WebviewWindow | null = null;
      try {
        existing = await WebviewWindow.getByLabel("settings");
      } catch {
        // окно ещё не создано
      }
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      new WebviewWindow("settings", {
        url: "?window=settings",
        title: "Настройки",
        width: 760,
        height: 640,
        center: true,
        resizable: true,
        decorations: true,
        transparent: false,
      });
    } catch (error) {
      console.error("Не удалось открыть настройки", error);
    }
  };

  const persistView = (next: ViewTransform) => {
    setViewTransform(next);
    void writeViewTransform(activeCharacterIdRef.current, next, viewModeRef.current).catch((error) =>
      console.error("Не удалось сохранить вид модели", error),
    );
  };

  const persistPartnerView = (next: ViewTransform) => {
    setPartnerViewTransform(next);
    const id = groupPartnerIdRef.current;
    if (!id) return;
    void writeViewTransform(id, next, viewModeRef.current).catch((error) =>
      console.error("Не удалось сохранить вид модели напарника", error),
    );
  };

  const activeBackgroundUrl = backgroundUrls[characterBackground.activeId];
  const modelBackgroundStyle = activeBackgroundUrl
    ? {
        backgroundColor: "#f4f4f5",
        backgroundImage: `url("${activeBackgroundUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: "#f4f4f5" };
  const partnerBackgroundUrl = backgroundUrls[partnerBackground.activeId];
  const partnerModelBackgroundStyle = partnerBackgroundUrl
    ? {
        backgroundColor: "#f4f4f5",
        backgroundImage: `url("${partnerBackgroundUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: "#f4f4f5" };

  const cropCover = cropImageSize
    ? Math.max(CROP_W / cropImageSize.width, CROP_H / cropImageSize.height)
    : 0;
  const cropDisplayW = cropImageSize ? cropImageSize.width * cropCover * cropZoom : 0;
  const cropDisplayH = cropImageSize ? cropImageSize.height * cropCover * cropZoom : 0;

  const clampCropPos = (zoom: number, pos: { x: number; y: number }) => {
    if (!cropImageSize) return pos;
    const cover = Math.max(CROP_W / cropImageSize.width, CROP_H / cropImageSize.height);
    const w = cropImageSize.width * cover * zoom;
    const h = cropImageSize.height * cover * zoom;
    return {
      x: clamp(pos.x, -Math.max(0, (w - CROP_W) / 2), Math.max(0, (w - CROP_W) / 2)),
      y: clamp(pos.y, -Math.max(0, (h - CROP_H) / 2), Math.max(0, (h - CROP_H) / 2)),
    };
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    target: "primary" | "partner" = "primary",
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setCropTarget(target);
    setBackgroundNotice("");
    const reader = new FileReader();
    reader.onload = () => setCropSource(String(reader.result));
    reader.readAsDataURL(file);
  };

  const applyCrop = () => {
    if (!cropSource || !cropImageSize) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CROP_W * 2;
      canvas.height = CROP_H * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#f4f4f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cover = Math.max(CROP_W / img.naturalWidth, CROP_H / img.naturalHeight);
      const displayW = img.naturalWidth * cover * cropZoom;
      const displayH = img.naturalHeight * cover * cropZoom;
      ctx.drawImage(
        img,
        ((CROP_W - displayW) / 2 + cropPos.x) * 2,
        ((CROP_H - displayH) / 2 + cropPos.y) * 2,
        displayW * 2,
        displayH * 2,
      );

      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      void (async () => {
        try {
          const bytes = await dataUrlBytes(dataUrl);
          const info = await saveBackground("Новый фон", bytes);
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
          );
          backgroundUrlsRef.current = { ...backgroundUrlsRef.current, [info.id]: url };
          setBackgroundUrls(backgroundUrlsRef.current);
          const nextLibrary = [...backgroundLibraryRef.current, info];
          backgroundLibraryRef.current = nextLibrary;
          setBackgroundLibrary(nextLibrary);
          const current =
            cropTarget === "partner"
              ? partnerBackgroundRef.current
              : characterBackgroundRef.current;
          await commitCharacterBackground(
            {
              activeId: info.id,
              attachedIds: [...current.attachedIds, info.id],
            },
            cropTarget,
          );
          setBackgroundNotice("");
          setCropSource(null);
        } catch (error) {
          setBackgroundNotice(error instanceof Error ? error.message : String(error));
        }
      })();
    };
    img.src = cropSource;
  };

  const renderNavButton = (b: (typeof BUTTONS)[number], side: "A" | "B") => {
    const isB = side === "B";
    const micActive = b.id === "mic" && micPhase === "listening";
    const micStarting = b.id === "mic" && micPhase === "starting";
    const micError = b.id === "mic" && micPhase === "error";
    const viewActive = b.id === "view" && (isB ? partnerEditView : editView);
    const displayActive = b.id === "display" && viewMode !== "default";
    const powerActive = b.id === "power" && llmLoaded;
    const powerYellow = b.id === "power" && modelOnly && !llmLoaded;
    const panelActive =
      (b.id === "chat" && chatOpen) ||
      (b.id === "bg" && (isB ? backgroundsBOpen : backgroundsOpen)) ||
      (b.id === "outfit" && (isB ? outfitBOpen : outfitOpen)) ||
      (b.id === "reactions" && reactionsOpen) ||
      (b.id === "user" && charactersOpen) ||
      (b.id === "group" && groupPanelOpen);
    const tone = micActive || viewActive || powerActive || displayActive
      ? "bg-emerald-400/60 text-emerald-950 hover:bg-emerald-400/75"
      : powerYellow || micStarting
        ? "bg-amber-300/60 text-amber-950 hover:bg-amber-300/75"
        : micError
          ? "bg-rose-300/55 text-rose-950 hover:bg-rose-300/70"
          : `${panelActive ? "bg-neutral-300/55" : "bg-neutral-300/40"} text-neutral-700 hover:bg-neutral-300/60`;
    const closePanels = () => {
      setBackgroundsOpen(false);
      setBackgroundsBOpen(false);
      setOutfitOpen(false);
      setOutfitBOpen(false);
      setCharactersOpen(false);
      setReactionsOpen(false);
      setGroupPanelOpen(false);
    };

    return (
      <button
        key={`${side}-${b.id}`}
        type="button"
        title={b.label}
        aria-label={b.label}
        onContextMenu={
          b.id === "power"
            ? (event) => {
                event.preventDefault();
                setPowerMenu({ x: event.clientX, y: event.clientY });
              }
            : undefined
        }
        aria-pressed={
          b.id === "chat"
            ? chatOpen
            : b.id === "bg"
              ? isB ? backgroundsBOpen : backgroundsOpen
              : b.id === "outfit"
                ? isB ? outfitBOpen : outfitOpen
                : b.id === "view"
                  ? isB ? partnerEditView : editView
                  : b.id === "display"
                    ? viewMode !== "default"
                    : b.id === "group"
                    ? groupPanelOpen
                    : b.id === "reactions"
                      ? reactionsOpen
                      : b.id === "mic"
                        ? micOn || micPhase === "starting"
                        : b.id === "user"
                          ? charactersOpen
                          : b.id === "power"
                            ? modelShown
                            : undefined
        }
        onClick={(event) => {
          if (b.id === "chat") setChatOpen((value) => !value);
          else if (b.id === "bg") {
            const setOpen = isB ? setBackgroundsBOpen : setBackgroundsOpen;
            const wasOpen = isB ? backgroundsBOpen : backgroundsOpen;
            closePanels();
            setOpen(!wasOpen);
          } else if (b.id === "outfit") {
            const setOpen = isB ? setOutfitBOpen : setOutfitOpen;
            const wasOpen = isB ? outfitBOpen : outfitOpen;
            closePanels();
            setOpen(!wasOpen);
          } else if (b.id === "view") {
            const setEdit = isB ? setPartnerEditView : setEditView;
            closePanels();
            setEdit((value) => !value);
          } else if (b.id === "display") {
            setPowerMenu(null);
            setViewModeMenu({ x: event.clientX, y: event.clientY });
          } else if (b.id === "reactions") {
            closePanels();
            setReactionsOpen((value) => !value);
          } else if (b.id === "user") {
            closePanels();
            setCharactersOpen((value) => !value);
          } else if (b.id === "group") {
            closePanels();
            setGroupPanelOpen((value) => !value);
          } else if (b.id === "mic") toggleMic();
          else if (b.id === "screen") void shareScreen();
          else if (b.id === "settings") void openSettings();
          else if (b.id === "power") void toggleModel();
        }}
        disabled={
          (b.id === "power" && modelLoading) || (b.id === "screen" && !visionEnabled)
        }
        className={`group relative flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-2xl backdrop-saturate-150 transition duration-200 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 ${tone}`}
      >
        <img
          src={b.icon}
          alt=""
          draggable={false}
          className={`h-5 w-5 object-contain transition-opacity duration-200 ${micActive || micStarting || micError || viewActive || displayActive || powerActive || powerYellow ? "opacity-100" : "opacity-80 group-hover:opacity-100"}`}
        />
        {b.id === "settings" && updateInfo && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white/70" />
        )}
      </button>
    );
  };

  const renderNavbar = (ids: string[], compact: boolean, side: "A" | "B", order?: number) => (
    <div
      className={`${compact ? "grid grid-cols-2 auto-rows-min gap-2" : "flex flex-col gap-2"} shrink-0 self-start ${groupActive && side === "A" ? "mr-3" : ""}`}
      style={order === undefined ? undefined : { order }}
    >
      {BUTTONS.filter((item) => ids.includes(item.id)).map((item) =>
        renderNavButton(item, side),
      )}
    </div>
  );

  const renderBackgroundPanel = (
    target: "primary" | "partner",
    open: boolean,
    setOpen: (value: boolean) => void,
    inputRef: React.RefObject<HTMLInputElement | null>,
    order?: number,
  ) => {
    const state = target === "partner" ? partnerBackground : characterBackground;
    return (
      <div
        className={`shrink-0 overflow-hidden transition-[width] duration-[360ms] ease-in-out ${open ? "w-[250px]" : "w-0"}`}
        style={order === undefined ? undefined : { order }}
      >
        <div
          inert={!open}
          className={`mx-3 max-h-[88vh] w-[226px] overflow-y-auto rounded-[24px] bg-[#fafafa]/85 p-3 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-[opacity,transform] duration-[360ms] ease-in-out ${open ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"}`}
        >
          <div className="mb-3 flex items-center justify-between px-1 pt-1">
            <span className="text-[13px] font-semibold text-neutral-800">Фон</span>
            <button
              type="button"
              aria-label="Закрыть панель фонов"
              title="Закрыть панель фонов"
              onClick={() => setOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[18px] leading-none text-neutral-500 transition hover:bg-white/70 hover:text-neutral-800"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-label="Добавить фон"
              title="Добавить фон"
              onClick={() => inputRef.current?.click()}
              className="flex aspect-[4/3] items-center justify-center rounded-xl bg-white/55 text-[26px] font-light text-neutral-500 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:bg-white/80 hover:text-neutral-800"
            >
              +
            </button>

            <button
              type="button"
              aria-label="Стандартный цвет"
              title="Стандартный цвет"
              onClick={() => selectBackground(DEFAULT_BACKGROUND_ID, target)}
              className="relative aspect-[4/3] rounded-xl bg-[#f4f4f5] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:scale-[1.03]"
            >
              {state.activeId === DEFAULT_BACKGROUND_ID && (
                <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800/80 text-[10px] text-white">
                  ✓
                </span>
              )}
            </button>

            {backgroundLibrary
              .filter((item) => state.attachedIds.includes(item.id))
              .map((item) => (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    aria-label={item.name || "Фон"}
                    title={item.name || "Фон"}
                    onClick={() => selectBackground(item.id, target)}
                    className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-200 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:scale-[1.03]"
                    style={{
                      backgroundImage: backgroundUrls[item.id]
                        ? `url("${backgroundUrls[item.id]}")`
                        : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  >
                    {state.activeId === item.id && (
                      <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800/80 text-[10px] text-white">
                        ✓
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Открепить фон"
                    title="Открепить фон"
                    onClick={() => detachBackground(item.id, target)}
                    className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-800/80 text-[12px] leading-none text-white group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>

          {state.attachedIds.length === 0 && (
            <p className="mt-2 px-1 text-[10px] leading-[14px] text-neutral-400">
              Закрепите фоны в настройках персонажа или добавьте новый через «+».
            </p>
          )}
          {backgroundNotice && (
            <p className="mt-2 px-1 text-[10px] text-rose-600">{backgroundNotice}</p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => handleFileChange(event, target)}
          />
        </div>
      </div>
    );
  };

  const renderOutfitPanel = (
    target: "primary" | "partner",
    open: boolean,
    setOpen: (value: boolean) => void,
    character: Character | null,
    modelId: string,
    name: string,
    order?: number,
  ) => (
    <div
      className={`shrink-0 overflow-hidden transition-[width] duration-[360ms] ease-in-out ${open ? "w-[250px]" : "w-0"}`}
      style={order === undefined ? undefined : { order }}
    >
      <div
        inert={!open}
        className={`mx-3 max-h-[88vh] w-[226px] overflow-y-auto rounded-[24px] bg-[#fafafa]/85 p-3 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-[opacity,transform] duration-[360ms] ease-in-out ${open ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"}`}
      >
        <div className="mb-2 flex items-center justify-between px-1 pt-1">
          <span className="text-[13px] font-semibold text-neutral-800">Одежда</span>
          <button
            type="button"
            aria-label="Закрыть выбор модели"
            title="Закрыть выбор модели"
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[18px] leading-none text-neutral-500 transition hover:bg-white/70 hover:text-neutral-800"
          >
            ×
          </button>
        </div>
        <p className="mb-2 truncate px-1 text-[10px] text-neutral-500">{name}</p>
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => selectOutfit(DEFAULT_MODEL_ID, target)}
            className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-[11px] transition ${
              modelId === DEFAULT_MODEL_ID
                ? "bg-neutral-800/85 text-white"
                : "bg-white/60 text-neutral-700 hover:bg-white/90"
            }`}
          >
            <span>Базовая модель</span>
            {modelId === DEFAULT_MODEL_ID && <span>✓</span>}
          </button>

          {character &&
            characterModelIds(character).map((fileName) => (
              <button
                key={fileName}
                type="button"
                title={fileName}
                onClick={() => selectOutfit(fileName, target)}
                className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] transition ${
                  modelId === fileName
                    ? "bg-neutral-800/85 text-white"
                    : "bg-white/60 text-neutral-700 hover:bg-white/90"
                }`}
              >
                <span className="min-w-0 truncate">{modelLabel(fileName)}</span>
                {modelId === fileName && <span>✓</span>}
              </button>
            ))}

          {(!character || characterModelIds(character).length === 0) && (
            <p className="px-1 text-[10px] leading-[14px] text-neutral-400">
              Закрепите модели для персонажа в настройках.
            </p>
          )}

          <button
            type="button"
            onClick={() => void openSettings()}
            className="mt-1 rounded-md border border-neutral-300 bg-white/60 px-2 py-1.5 text-[11px] text-neutral-600 hover:bg-white/90"
          >
            Настроить модели…
          </button>
        </div>
      </div>
    </div>
  );

  const renderCharactersPanel = (order?: number) => (
    <div
      className={`shrink-0 overflow-hidden transition-[width] duration-[360ms] ease-in-out ${charactersOpen ? "w-[250px]" : "w-0"}`}
      style={order === undefined ? undefined : { order }}
    >
      <div
        inert={!charactersOpen}
        className={`mx-3 max-h-[88vh] w-[226px] overflow-y-auto rounded-[24px] bg-[#fafafa]/85 p-3 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-[opacity,transform] duration-[360ms] ease-in-out ${charactersOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"}`}
      >
        <div className="mb-3 flex items-center justify-between px-1 pt-1">
          <span className="text-[13px] font-semibold text-neutral-800">Персонажи</span>
          <button
            type="button"
            aria-label="Закрыть список персонажей"
            title="Закрыть список персонажей"
            onClick={() => setCharactersOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[18px] leading-none text-neutral-500 transition hover:bg-white/70 hover:text-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-label="Управление персонажами"
            title="Управление персонажами"
            onClick={() => void openSettings()}
            className="flex aspect-[4/3] items-center justify-center rounded-xl bg-white/55 text-[26px] font-light text-neutral-500 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:bg-white/80 hover:text-neutral-800"
          >
            +
          </button>

          {characters.map((character) => (
            <button
              key={character.id}
              type="button"
              aria-label={character.name}
              title={character.name}
              onClick={() => void selectCharacter(character.id)}
              className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-300 px-1 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:scale-[1.03]"
            >
              <span className="max-w-full truncate text-[11px] text-neutral-700">
                {character.name}
              </span>
              <span className="max-w-full truncate text-[10px] text-neutral-400">
                {modelLabel(character.modelId)}
              </span>
              {activeCharacterId === character.id && (
                <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800/80 text-[10px] text-white">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderReactionsPanel = (order?: number) => (
    <div
      className={`shrink-0 overflow-hidden transition-[width] duration-[360ms] ease-in-out ${reactionsOpen ? "w-[250px]" : "w-0"}`}
      style={order === undefined ? undefined : { order }}
    >
      <div
        inert={!reactionsOpen}
        className={`mx-3 max-h-[88vh] w-[226px] overflow-y-auto rounded-[24px] bg-[#fafafa]/85 p-3 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-[opacity,transform] duration-[360ms] ease-in-out ${reactionsOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"}`}
      >
        <div className="mb-3 flex items-center justify-between px-1 pt-1">
          <span className="text-[13px] font-semibold text-neutral-800">Эмоции</span>
          <button
            type="button"
            aria-label="Закрыть панель эмоций"
            title="Закрыть панель эмоций"
            onClick={() => setReactionsOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[18px] leading-none text-neutral-500 transition hover:bg-white/70 hover:text-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {REACTION_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-label={REACTION_LABELS[id]}
              title={REACTION_LABELS[id]}
              onClick={() => triggerReaction(id)}
              className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:scale-[1.03] ${
                activeReaction === id
                  ? "bg-emerald-300/70 text-emerald-950"
                  : "bg-white/55 text-neutral-700 hover:bg-white/80"
              }`}
            >
              <span className="text-[11px] font-medium leading-tight">
                {REACTION_LABELS[id]}
              </span>
              <span className="text-[9px] leading-tight text-neutral-400">
                {`[[reaction:${id}]]`}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-3 px-1 text-[10px] leading-[14px] text-neutral-500">
          Нажми эмоцию, чтобы посмотреть анимацию. В чате сообщения не добавляются.
        </p>
      </div>
    </div>
  );

  const renderGroupPanel = (order?: number) => (
    <div
      className={`shrink-0 overflow-hidden transition-[width] duration-[360ms] ease-in-out ${groupPanelOpen ? "w-[250px]" : "w-0"}`}
      style={order === undefined ? undefined : { order }}
    >
      <div
        inert={!groupPanelOpen}
        className={`mx-3 max-h-[88vh] w-[226px] overflow-y-auto rounded-[24px] bg-[#fafafa]/85 p-3 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-[opacity,transform] duration-[360ms] ease-in-out ${groupPanelOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"}`}
      >
        <div className="mb-3 flex items-center justify-between px-1 pt-1">
          <span className="text-[13px] font-semibold text-neutral-800">Беседа</span>
          <button
            type="button"
            aria-label="Закрыть выбор беседы"
            title="Закрыть выбор беседы"
            onClick={() => setGroupPanelOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[18px] leading-none text-neutral-500 transition hover:bg-white/70 hover:text-neutral-800"
          >
            ×
          </button>
        </div>

        {groupActive && (
          <button
            type="button"
            onClick={() => void endGroup()}
            className="mb-3 w-full rounded-full bg-rose-200/70 px-3 py-2 text-[11px] font-medium text-rose-900 transition hover:bg-rose-200"
          >
            Завершить беседу
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          {characters
            .filter((character) => character.id !== activeCharacterId)
            .map((character) => (
              <button
                key={character.id}
                type="button"
                aria-label={character.name}
                title={character.name}
                onClick={() => void selectGroupPartner(character.id)}
                className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-300 px-1 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition hover:scale-[1.03]"
              >
                <span className="max-w-full truncate text-[11px] text-neutral-700">
                  {character.name}
                </span>
                <span className="max-w-full truncate text-[10px] text-neutral-400">
                  {modelLabel(character.modelId)}
                </span>
                {groupPartnerId === character.id && (
                  <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800/80 text-[10px] text-white">
                    ✓
                  </span>
                )}
              </button>
            ))}
        </div>

        <p className="mt-3 px-1 text-[10px] leading-[14px] text-neutral-500">
          Выбери второго персонажа — он появится справа от чата.
        </p>
      </div>
    </div>
  );

  const micStatusNode = speech.showStatus && micPhase !== "off" && (
    <div
      className={`mic-status pointer-events-none absolute right-3 top-3 z-30 max-w-[190px] rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-medium text-neutral-700 backdrop-blur-2xl backdrop-saturate-150 ${micPhase}`}
    >
      <span className="mic-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" />
      <span className="align-middle">
        {micPhase === "starting"
          ? "микрофон..."
          : micPhase === "listening"
            ? "слушаю"
            : micError || "ошибка микрофона"}
      </span>
    </div>
  );

  const windowResizeHandle = (
    <div
      role="separator"
      aria-label="Изменить высоту окна"
      title="Изменить высоту окна"
      onPointerDown={(event) => beginResize("window", event)}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      className="absolute inset-x-0 bottom-0 z-30 h-2 cursor-ns-resize"
      style={{ touchAction: "none" }}
    />
  );

  const activityAudioLevel = manualMusic ? 0.75 : 0;
  const stageListening = micPhase === "listening";
  const primaryActivitySettings = characterActivitySettings(activeCharacter);
  const partnerActivitySettings = characterActivitySettings(groupPartner);

  const renderPrimaryStage = (immersiveMode: boolean) => (
    <VrmStage
      ref={primaryStageRef}
      modelId={primaryModelId}
      modelsReady={modelsReady}
      viewTransform={viewTransform}
      onViewTransformChange={persistView}
      editView={editView}
      visible={modelVisible}
      blurred={stageBlurred}
      revealing={stageRevealing}
      backgroundStyle={modelBackgroundStyle}
      avatarSource={avatarSource}
      avatarName={avatarName}
      avatarVisible={avatarVisible}
      offline={!llmLoaded}
      generating={generating}
      listening={stageListening}
      audioLevel={activityAudioLevel}
      activitySettings={primaryActivitySettings}
      micStatus={micStatusNode}
      showResetButton={editView}
      onResetView={() => persistView(DEFAULT_VIEW_TRANSFORM)}
      chrome={!immersiveMode}
      transparent={immersiveMode && stageTransparent}
      fill={immersiveMode}
      style={immersiveMode ? undefined : groupActive ? { order: -1 } : undefined}
    >
      {!immersiveMode && windowResizeHandle}
    </VrmStage>
  );

  const renderPartnerStage = (immersiveMode: boolean) => (
    <VrmStage
      ref={partnerStageRef}
      modelId={partnerStageModelId}
      modelsReady={modelsReady}
      viewTransform={partnerViewTransform}
      onViewTransformChange={persistPartnerView}
      editView={partnerEditView}
      visible={modelVisible}
      blurred={stageBlurred}
      revealing={stageRevealing}
      backgroundStyle={partnerModelBackgroundStyle}
      avatarSource={partnerAvatarSource}
      avatarName={partnerAvatarName}
      avatarVisible={avatarVisible}
      offline={!llmLoaded}
      generating={generating}
      listening={stageListening}
      audioLevel={activityAudioLevel}
      activitySettings={partnerActivitySettings}
      micStatus={micStatusNode}
      showResetButton={partnerEditView}
      onResetView={() => persistPartnerView(DEFAULT_VIEW_TRANSFORM)}
      chrome={!immersiveMode}
      transparent={immersiveMode && stageTransparent}
      fill={immersiveMode}
      style={immersiveMode ? undefined : { order: 1 }}
    />
  );

  const renderChatPanel = (immersiveMode: boolean) => {
    const fullscreenChat = immersiveMode && isFullscreen;
    const chatStyle: CSSProperties = {
      width: chatOpen ? chatWidth : 0,
      right:
        fullscreenChat && !groupActive
          ? 12 + navWidthFor(BUTTONS.length) + 8
          : undefined,
      order: !immersiveMode && groupActive ? 0 : undefined,
    };
    return (
      <div
        className={
          fullscreenChat
            ? `absolute bottom-3 right-3 top-3 z-30 overflow-hidden ${
                resizing ? "" : "transition-[width] duration-[360ms] ease-in-out"
              }`
            : `relative shrink-0 overflow-hidden ${immersiveMode ? "p-3" : ""} ${
                resizing ? "" : "transition-[width] duration-[360ms] ease-in-out"
              }`
        }
        style={chatStyle}
      >
        {chatOpen && !immersiveMode && (
          <div
            role="separator"
            aria-label="Изменить ширину чата"
            title="Изменить ширину чата"
            onPointerDown={(event) => beginResize("chat", event)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="absolute right-0 top-0 z-30 h-full w-2 cursor-ew-resize"
            style={{ touchAction: "none" }}
          />
        )}
        <aside
          inert={!chatOpen}
          className={`flex flex-col rounded-[24px] ${immersiveMode ? "h-full w-full" : "mx-3 h-[88vh]"} ${chatPanelClass} transition-[opacity,transform] duration-[360ms] ease-in-out ${chatOpen ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-3 opacity-0"}`}
          style={immersiveMode ? undefined : { width: chatWidth - 24 }}
        >
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2 pt-4">
            {messages.map((message) => {
              const isPartner = groupActive && message.speakerId === groupPartnerId;
              const speakerName = isPartner
                ? groupPartner?.name ?? "Персонаж"
                : activeCharacter?.name ?? "Персонаж";
              const imageFile = message.imageFile;
              const imageUrl = imageFile ? chatImageUrls[imageFile] : undefined;
              return (
                <div
                  key={message.id}
                  className={`flex flex-col ${message.from === "user" ? "items-end" : "items-start"}`}
                >
                  {groupActive && message.from === "bot" && (
                    <span className="mb-1 px-1 text-[9px] font-medium text-neutral-400">
                      {speakerName}
                    </span>
                  )}
                  <div
                    className={`chat-message relative ${message.from === "user" ? "chat-message-user" : "chat-message-bot"} ${bubbleClass(message.from, isPartner)}`}
                  >
                    {imageFile && imageUrl && (
                      <button
                        type="button"
                        title="Открыть полный размер"
                        onClick={() =>
                          void openChatImage(imageFile).catch((error) =>
                            setChatError(
                              error instanceof Error ? error.message : String(error),
                            ),
                          )
                        }
                        className="mb-2 block w-full overflow-hidden rounded-lg"
                      >
                        <img
                          src={imageUrl}
                          alt="Скриншот экрана"
                          className="max-h-[180px] w-full object-cover"
                        />
                      </button>
                    )}
                    {message.text}
                    {message.pending && (
                      <span
                        title="Ожидает ответа"
                        className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white/90"
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {generating && (
              <div
                aria-label="думает"
                className={`chat-message chat-message-bot ${bubbleClass("bot")} flex items-center gap-1`}
              >
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
                <span className="chat-typing-dot" />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className="flex flex-col gap-1 px-3 pb-3 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              void sendUserMessage(draft);
            }}
          >
            {chatError && (
              <p className="chat-error px-1 text-[11px] leading-[15px] text-rose-600">{chatError}</p>
            )}
            {chatNotice && (
              <p className="chat-notice px-1 text-[11px] leading-[15px] text-amber-700">
                {chatNotice}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                aria-label="Сообщение"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Написать сообщение..."
                className="chat-input min-w-0 flex-1 rounded-full bg-neutral-300/40 px-4 py-2 text-[12px] text-neutral-700 outline-none backdrop-blur-2xl backdrop-saturate-150 placeholder:text-neutral-500"
              />
              <button
                type="submit"
                aria-label="Отправить сообщение"
                disabled={!draft.trim() || generating}
                className="chat-send flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-300/55 text-[15px] text-neutral-700 backdrop-blur-2xl backdrop-saturate-150 hover:bg-neutral-300/70 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↑
              </button>
            </div>
          </form>
        </aside>
      </div>
    );
  };

  const modelAreaStyle: CSSProperties | undefined = immersive
    ? isFullscreen
      ? { width: groupActive ? "50%" : "100%" }
      : { flex: "1 1 auto", minWidth: 0 }
    : undefined;
  const partnerAreaStyle: CSSProperties | undefined = immersive
    ? isFullscreen
      ? { width: "50%" }
      : { flex: "1 1 auto", minWidth: 0 }
    : undefined;
  const fullscreenNavbarOffset =
    isFullscreen && groupActive && chatOpen ? { right: chatWidth + 24 } : undefined;

  return (
    <div
      ref={rootRef}
      onPointerMove={handlePointerActivity}
      onPointerLeave={handlePointerLeave}
      className={
        immersive
          ? "relative flex h-screen w-screen items-stretch justify-start overflow-hidden bg-transparent"
          : "flex h-screen w-max items-start justify-start bg-transparent pb-[7vh] pl-[31px] pr-[31px] pt-[5vh]"
      }
    >
      <div
        className={immersive ? "relative h-full overflow-hidden" : "contents"}
        style={modelAreaStyle}
      >
        {renderPrimaryStage(immersive)}
        {immersive && (groupActive || isFullscreen) && navbarVisible && (
          <div className="absolute top-3 z-30" style={{ right: 12, ...fullscreenNavbarOffset }}>
            {renderNavbar(
              groupActive ? NAV_A_IDS : BUTTONS.map((item) => item.id),
              navCompact(groupActive ? NAV_A_IDS.length : BUTTONS.length),
              "A",
            )}
          </div>
        )}
      </div>

      {renderChatPanel(immersive)}

      {immersive && !isFullscreen && !groupActive && navbarVisible &&
        renderNavbar(
          BUTTONS.map((item) => item.id),
          navCompact(BUTTONS.length),
          "A",
        )}

      {groupActive && (
        <div
          className={immersive ? "relative h-full overflow-hidden" : "contents"}
          style={partnerAreaStyle}
        >
          {renderPartnerStage(immersive)}
          {immersive && navbarVisible && (
            <div className="absolute top-3 z-30" style={{ right: 12, ...fullscreenNavbarOffset }}>
              {renderNavbar(NAV_B_IDS, navCompact(NAV_B_IDS.length), "B")}
            </div>
          )}
        </div>
      )}

      <div
        className={
          immersive
            ? "pointer-events-none absolute left-3 top-3 z-40 flex items-start gap-2 [&>*]:pointer-events-auto"
            : "contents"
        }
      >
        {groupActive && renderBackgroundPanel("primary", backgroundsOpen, setBackgroundsOpen, fileInputRef, immersive ? undefined : -4)}
        {groupActive && renderOutfitPanel("primary", outfitOpen, setOutfitOpen, activeCharacter, targetModelId, avatarName, immersive ? undefined : -3)}
        {groupActive &&
          navbarVisible &&
          !immersive &&
          renderNavbar(NAV_A_IDS, navCompact(NAV_A_IDS.length), "A", -2)}
        {!groupActive &&
          navbarVisible &&
          !immersive &&
          renderNavbar(
            BUTTONS.map((item) => item.id),
            navCompact(BUTTONS.length),
            "A",
          )}
        {!groupActive &&
          renderBackgroundPanel("primary", backgroundsOpen, setBackgroundsOpen, fileInputRef)}
        {groupActive &&
          renderBackgroundPanel("partner", backgroundsBOpen, setBackgroundsBOpen, fileInputBRef, immersive ? undefined : 3)}
        {renderCharactersPanel(immersive ? undefined : groupActive ? 5 : undefined)}
        {!groupActive &&
          renderOutfitPanel("primary", outfitOpen, setOutfitOpen, activeCharacter, targetModelId, avatarName)}
        {groupActive &&
          renderOutfitPanel(
            "partner",
            outfitBOpen,
            setOutfitBOpen,
            groupPartner,
            partnerModelId,
            partnerAvatarName,
            immersive ? undefined : 4,
          )}
        {renderReactionsPanel(immersive ? undefined : groupActive ? 6 : undefined)}
        {renderGroupPanel(immersive ? undefined : groupActive ? 7 : undefined)}
      </div>

      {cropSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="rounded-[24px] bg-[#f7f7f8]/95 p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-neutral-800">
                Обрезка фона
              </span>
              <span className="text-[11px] text-neutral-500">9:16</span>
            </div>

            <div
              className="relative touch-none cursor-grab overflow-hidden rounded-[18px] bg-neutral-200 active:cursor-grabbing"
              style={{ width: CROP_W, height: CROP_H }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragStartRef.current = {
                  x: event.clientX - cropPos.x,
                  y: event.clientY - cropPos.y,
                };
              }}
              onPointerMove={(event) => {
                if (!dragStartRef.current) return;
                setCropPos(
                  clampCropPos(cropZoom, {
                    x: event.clientX - dragStartRef.current.x,
                    y: event.clientY - dragStartRef.current.y,
                  }),
                );
              }}
              onPointerUp={() => {
                dragStartRef.current = null;
              }}
              onPointerCancel={() => {
                dragStartRef.current = null;
              }}
            >
              {cropSource && (
                <img
                  src={cropSource}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute select-none"
                  style={{
                    left: (CROP_W - cropDisplayW) / 2 + cropPos.x,
                    top: (CROP_H - cropDisplayH) / 2 + cropPos.y,
                    width: cropDisplayW,
                    height: cropDisplayH,
                    maxWidth: "none",
                    maxHeight: "none",
                  }}
                />
              )}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] text-neutral-500">Масштаб</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropZoom}
                onChange={(event) => {
                  const zoom = Number(event.target.value);
                  setCropZoom(zoom);
                  setCropPos((pos) => clampCropPos(zoom, pos));
                }}
                className="h-1 flex-1 accent-neutral-800"
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCropSource(null)}
                className="flex-1 rounded-full bg-white/70 px-3 py-2 text-[12px] text-neutral-600 transition hover:bg-white"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={applyCrop}
                disabled={!cropImageSize}
                className="flex-1 rounded-full bg-neutral-800/85 px-3 py-2 text-[12px] text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                Применить
              </button>
            </div>
          </div>
        </div>
      )}

      {powerMenu && (
        <>
          <div
            className="fixed inset-0 z-[80]"
            onPointerDown={() => setPowerMenu(null)}
          />
          <div
            className="fixed z-[81] w-[176px] rounded-xl bg-white/90 p-1 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150"
            style={{
              left: clamp(powerMenu.x, 8, Math.max(8, window.innerWidth - 184)),
              top: clamp(powerMenu.y, 8, Math.max(8, window.innerHeight - 92)),
            }}
          >
            <button
              type="button"
              onClick={() => void startAi()}
              className="w-full rounded-lg px-3 py-2 text-left text-[12px] text-neutral-700 transition hover:bg-neutral-200/70"
            >
              Запустить
            </button>
            <button
              type="button"
              onClick={() => void startModelOnly()}
              className="w-full rounded-lg px-3 py-2 text-left text-[12px] text-amber-800 transition hover:bg-amber-100/70"
            >
              Запустить без ИИ
            </button>
          </div>
        </>
      )}

      {viewModeMenu && (
        <>
          <div
            className="fixed inset-0 z-[80]"
            onPointerDown={() => setViewModeMenu(null)}
          />
          <div
            className="fixed z-[81] w-[196px] rounded-xl bg-white/90 p-1 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150"
            style={{
              left: clamp(viewModeMenu.x, 8, Math.max(8, window.innerWidth - 204)),
              top: clamp(viewModeMenu.y, 8, Math.max(8, window.innerHeight - 152)),
            }}
          >
            {VIEW_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  changeViewMode(option.id);
                  setViewModeMenu(null);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] transition ${
                  viewMode === option.id
                    ? "bg-neutral-200/80 text-neutral-900"
                    : "text-neutral-700 hover:bg-neutral-200/70"
                }`}
              >
                <img src={option.icon} alt="" draggable={false} className="h-4 w-4 shrink-0" />
                <span>{option.label}</span>
                {viewMode === option.id && <span className="ml-auto text-[11px]">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {navbarVisibility === "hidden" && (
        <button
          type="button"
          aria-label={navbarTemporarilyShown ? "Скрыть меню" : "Показать меню"}
          title={navbarTemporarilyShown ? "Скрыть меню" : "Показать меню"}
          onClick={() => {
            if (navbarTemporarilyShown) hideNavbar();
            else showNavbarFor(35000);
          }}
          className="fixed right-3 top-3 z-[82] flex h-8 w-8 items-center justify-center rounded-full bg-neutral-300/45 text-neutral-700 backdrop-blur-2xl backdrop-saturate-150 transition hover:scale-105 hover:bg-neutral-300/65"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="8" r="1.35" />
            <circle cx="8" cy="8" r="1.35" />
            <circle cx="13" cy="8" r="1.35" />
          </svg>
        </button>
      )}
    </div>
  );
}
