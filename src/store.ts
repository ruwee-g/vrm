import { invoke } from "@tauri-apps/api/core";
import { IS_PRERELEASE } from "./channel";

export type KvCache = "f16" | "q8_0";
export type Reasoning = "off" | "low" | "medium" | "high";
export type ModelMode = "local" | "api";

export type ApiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};
export type SpeechEngine = "webSpeech" | "localParakeet";
export type SpeechQuant = "q4_k" | "q8_0" | "f16";
export type GroupResponseLength = "short" | "normal" | "detailed";
export type ChatAppearance = "default" | "glass" | "bubbles";
export type NavbarVisibility = "always" | "hover" | "hidden";

export type IdleIntensity = "low" | "medium" | "high";
export type ViewMode = "default" | "overlay" | "fullscreen";

export type GroupSettings = {
  rules: string;
  responseLength: GroupResponseLength;
  reactions: boolean;
  useExamples: boolean;
  historyDepth: number;
  summaryThreshold: number;
};

export type PersonaSettings = {
  name: string;
  description: string;
};

export type SpeechSettings = {
  enabled: boolean;
  language: string;
  continuous: boolean;
  autoSend: boolean;
  autoRestart: boolean;
  showStatus: boolean;
  engine: SpeechEngine;
  localQuant: SpeechQuant;
  sttPort: number;
};

export type AppSettings = {
  ggufPath: string;
  contextSize: number;
  runnerPath: string;
  port: number;
  kvCache: KvCache;
  reasoning: Reasoning;
  activeCharacterId: string;
  windowHeight: number;
  chatWidth: number;
  chatAppearance: ChatAppearance;
  navbarVisibility: NavbarVisibility;
  viewMode: ViewMode;
  manualMusic?: boolean;
  launchAtLogin: boolean;
  startWithChat: boolean;
  startWithModel: boolean;
  startLocalModel: boolean;
  localVision: boolean;
  apiVision: boolean;
  mmprojPath: string;
  speech: SpeechSettings;
  group: GroupSettings;
  persona: PersonaSettings;
  modelMode: ModelMode;
  api: ApiSettings;
};

export type ModelStatus = {
  status: "idle" | "loading" | "loaded" | "error";
  message: string;
};

export type Character = {
  id: string;
  name: string;
  systemPrompt: string;
  prompt: string;
  examples: string;
  modelId: string;
  modelIds?: string[];
  avatar?: string | null;
  realTime: boolean;
  idleActivity?: boolean;
  idleIntensity?: IdleIntensity;
  musicReactivity?: boolean;
  interactionResponses?: boolean;
};

export type CharacterActivitySettings = {
  idleActivity: boolean;
  idleIntensity: IdleIntensity;
  musicReactivity: boolean;
  interactionResponses: boolean;
};

export const characterActivitySettings = (
  character?: Character | null,
): CharacterActivitySettings => ({
  idleActivity: character?.idleActivity ?? true,
  idleIntensity: character?.idleIntensity ?? "medium",
  musicReactivity: character?.musicReactivity ?? true,
  interactionResponses: character?.interactionResponses ?? true,
});

export type ChatMessage = {
  id: string;
  text: string;
  from: "bot" | "user";
  reaction?: string;
  pending?: boolean;
  speakerId?: string;
  createdAt?: number;
  imageFile?: string;
};

export type ChatSummary = {
  text: string;
  upToMessageId: string;
  updatedAt: number;
};

export type GroupChatInfo = {
  key: string;
  messageCount: number;
  lastAt: number;
};

export type ViewTransform = {
  yaw: number;
  pitch: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
};

export type BackgroundInfo = {
  id: string;
  fileName: string;
  name: string;
};

export type CharacterBackgrounds = {
  activeId: string;
  attachedIds: string[];
};

export const DEFAULT_VIEW_TRANSFORM: ViewTransform = {
  yaw: 0,
  pitch: 0,
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
};

export const DEFAULT_MODEL_ID = IS_PRERELEASE ? "Haruhi_school.vrm" : "builtin";
export const DEFAULT_CHARACTER_ID = "default";
export const DEFAULT_BACKGROUND_ID = "default";

export const DEFAULT_SYSTEM_PROMPT = `You are not an AI or assistant. You are this person, speaking right now. Stay in character completely.

Output only spoken dialogue. No narration, stage directions, asterisks or italics for actions, no descriptions of gestures, expressions, thoughts, or the other person. Never speak for the user. Do not summarize or explain the conversation. Show hesitation through word choice and punctuation, not description.

Sound human and imperfect, in your own voice. No AI filler or clichés.

A technical tag may be requested after the reply. Output it exactly as instructed and treat it as outside the dialogue.`;

export function characterModelIds(character: Character): string[] {
  const attached = (character.modelIds ?? []).filter(
    (id) => Boolean(id) && id !== DEFAULT_MODEL_ID,
  );
  if (character.modelId !== DEFAULT_MODEL_ID && !attached.includes(character.modelId)) {
    attached.unshift(character.modelId);
  }
  return attached;
}

export function normalizeCharacterBackgrounds(
  state: CharacterBackgrounds,
): CharacterBackgrounds {
  const attached = state.attachedIds ?? [];
  const next = attached.filter((id) => Boolean(id) && id !== DEFAULT_BACKGROUND_ID);
  if (
    state.activeId !== DEFAULT_BACKGROUND_ID &&
    !next.includes(state.activeId)
  ) {
    next.unshift(state.activeId);
  }
  return {
    activeId: state.activeId || DEFAULT_BACKGROUND_ID,
    attachedIds: Array.from(new Set(next)),
  };
}

export function emptyCharacterBackgrounds(): CharacterBackgrounds {
  return { activeId: DEFAULT_BACKGROUND_ID, attachedIds: [] };
}
export const DEFAULT_RUNNER_PATH = IS_PRERELEASE
  ? ""
  : import.meta.env.VITE_DEV_RUNNER_PATH ?? "";

export const DEFAULT_API_SETTINGS: ApiSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
};

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  rules: "",
  responseLength: "normal",
  reactions: true,
  useExamples: false,
  historyDepth: 24,
  summaryThreshold: 32,
};

export const DEFAULT_PERSONA_SETTINGS: PersonaSettings = {
  name: "",
  description: "",
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: true,
  language: "ru-RU",
  continuous: true,
  autoSend: true,
  autoRestart: false,
  showStatus: true,
  engine: "webSpeech",
  localQuant: "q4_k",
  sttPort: 8082,
};

export type SpeechModelInfo = {
  quant: SpeechQuant;
  fileName: string;
  path: string;
  exists: boolean;
  size: number;
  expectedSize: number;
  valid: boolean;
};

export type SpeechRuntimeInfo = {
  available: boolean;
  binaryPath: string;
  version: string;
};

export type SpeechDownloadProgress = {
  quant: SpeechQuant;
  loaded: number;
  total: number;
  percent: number;
  done: boolean;
  cancelled: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  ggufPath: "",
  contextSize: 8192,
  runnerPath: DEFAULT_RUNNER_PATH,
  port: 8081,
  kvCache: "f16",
  reasoning: "off",
  activeCharacterId: DEFAULT_CHARACTER_ID,
  windowHeight: 680,
  chatWidth: 324,
  chatAppearance: "default",
  navbarVisibility: "always",
  viewMode: "default",
  manualMusic: false,
  launchAtLogin: false,
  startWithChat: false,
  startWithModel: false,
  startLocalModel: false,
  localVision: false,
  apiVision: false,
  mmprojPath: "",
  speech: DEFAULT_SPEECH_SETTINGS,
  group: DEFAULT_GROUP_SETTINGS,
  persona: DEFAULT_PERSONA_SETTINGS,
  modelMode: "local",
  api: DEFAULT_API_SETTINGS,
};

export async function readSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("read_settings");
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await invoke("write_settings", { settings });
}

export async function apiChatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<string> {
  return invoke<string>("api_chat_completion", { baseUrl, apiKey, model, body });
}

export async function apiListModels(
  baseUrl: string,
  apiKey: string,
): Promise<string[]> {
  return invoke<string[]>("api_list_models", { baseUrl, apiKey });
}

export async function writeLayoutSettings(
  windowHeight: number,
  chatWidth: number,
): Promise<void> {
  await invoke("write_layout_settings", { windowHeight, chatWidth });
}

export async function openDataDir(): Promise<void> {
  await invoke("open_data_dir");
}

export async function setActiveCharacter(characterId: string): Promise<void> {
  await invoke("set_active_character", { characterId });
}

export async function readCharacters(): Promise<Character[]> {
  return invoke<Character[]>("read_characters");
}

export async function writeCharacters(characters: Character[]): Promise<void> {
  await invoke("write_characters", { characters });
}

export async function readChat(characterId: string): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>("read_chat", { characterId });
}

export async function appendChatMessage(
  characterId: string,
  message: ChatMessage,
): Promise<void> {
  await invoke("append_chat_message", {
    characterId,
    message,
  });
}

export async function clearChat(characterId: string): Promise<void> {
  await invoke("clear_chat", { characterId });
}

export async function listGroupChats(): Promise<GroupChatInfo[]> {
  return invoke<GroupChatInfo[]>("list_group_chats");
}

export async function markChatMessagesRead(
  characterId: string,
  ids: string[],
): Promise<void> {
  await invoke("mark_chat_messages_read", { characterId, ids });
}

export async function readChatSummary(characterId: string): Promise<ChatSummary> {
  return invoke<ChatSummary>("read_chat_summary", { characterId });
}

export async function writeChatSummary(
  characterId: string,
  summary: ChatSummary,
): Promise<void> {
  await invoke("write_chat_summary", { characterId, summary });
}

export const viewTransformKey = (characterId: string, viewMode: ViewMode) =>
  viewMode === "default" ? characterId : `${characterId}:${viewMode}`;

export async function readViewTransform(
  characterId: string,
  viewMode: ViewMode = "default",
): Promise<ViewTransform> {
  return invoke<ViewTransform>("read_view_transform", {
    characterId: viewTransformKey(characterId, viewMode),
  });
}

export async function writeViewTransform(
  characterId: string,
  transform: ViewTransform,
  viewMode: ViewMode = "default",
): Promise<void> {
  await invoke("write_view_transform", {
    characterId: viewTransformKey(characterId, viewMode),
    transform,
  });
}

export async function validateGguf(path: string): Promise<boolean> {
  return invoke<boolean>("validate_gguf", { path });
}

export async function validateRunner(path: string): Promise<boolean> {
  return invoke<boolean>("validate_runner", { path });
}

export async function startModel(): Promise<ModelStatus> {
  return invoke<ModelStatus>("start_model");
}

export async function stopModel(): Promise<ModelStatus> {
  return invoke<ModelStatus>("stop_model");
}

export async function modelStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("model_status");
}

export async function speechModelInfo(quant: SpeechQuant): Promise<SpeechModelInfo> {
  return invoke<SpeechModelInfo>("speech_model_info", { quant });
}

export async function speechRuntimeInfo(): Promise<SpeechRuntimeInfo> {
  return invoke<SpeechRuntimeInfo>("speech_runtime_info");
}

export async function downloadSpeechModel(quant: SpeechQuant): Promise<string> {
  return invoke<string>("download_speech_model", { quant });
}

export async function cancelSpeechDownload(): Promise<void> {
  await invoke("cancel_speech_download");
}

export async function deleteSpeechModel(quant: SpeechQuant): Promise<void> {
  await invoke("delete_speech_model", { quant });
}

export async function sttStatus(): Promise<ModelStatus> {
  return invoke<ModelStatus>("stt_status");
}

export async function sttStart(): Promise<ModelStatus> {
  return invoke<ModelStatus>("stt_start");
}

export async function sttStop(): Promise<ModelStatus> {
  return invoke<ModelStatus>("stt_stop");
}

export async function transcribeAudio(bytes: Uint8Array, language: string): Promise<string> {
  return invoke<string>("transcribe_audio", {
    bytes: Array.from(bytes),
    language,
  });
}

export async function speechDebug(message: string): Promise<void> {
  await invoke("speech_debug", { message });
}

export async function listVrmModels(): Promise<string[]> {
  return invoke<string[]>("list_vrm_models");
}

export async function saveVrmModel(name: string, bytes: number[]): Promise<string> {
  return invoke<string>("save_vrm_model", { name, bytes });
}

export async function readVrmModel(fileName: string): Promise<number[]> {
  return invoke<number[]>("read_vrm_model", { fileName });
}

export async function readVrmModelBase64(fileName: string): Promise<string> {
  return invoke<string>("read_vrm_model_base64", { fileName });
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function saveVrmPreview(modelId: string, bytes: number[]): Promise<void> {
  await invoke("save_vrm_preview", { modelId, bytes });
}

export async function readVrmPreview(modelId: string): Promise<number[]> {
  return invoke<number[]>("read_vrm_preview", { modelId });
}

export async function renameVrmModel(
  oldName: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_vrm_model", { oldName, newName });
}

export async function deleteVrmModel(fileName: string): Promise<void> {
  await invoke("delete_vrm_model", { fileName });
}

export async function dataUrlBytes(dataUrl: string): Promise<number[]> {
  const response = await fetch(dataUrl);
  const buffer = await response.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

export async function captureScreen(): Promise<string> {
  return invoke<string>("capture_screen");
}

export async function saveChatImage(name: string, bytes: number[]): Promise<void> {
  await invoke("save_chat_image", { name, bytes });
}

export async function readChatImage(fileName: string): Promise<string> {
  return invoke<string>("read_chat_image", { fileName });
}

export async function openChatImage(fileName: string): Promise<void> {
  await invoke("open_chat_image", { fileName });
}

export async function listBackgrounds(): Promise<BackgroundInfo[]> {
  return invoke<BackgroundInfo[]>("list_backgrounds");
}

export async function saveBackground(
  name: string,
  bytes: number[],
): Promise<BackgroundInfo> {
  return invoke<BackgroundInfo>("save_background", { name, bytes });
}

export async function readBackground(fileName: string): Promise<number[]> {
  return invoke<number[]>("read_background", { fileName });
}

export async function renameBackground(
  id: string,
  name: string,
): Promise<string> {
  return invoke<string>("rename_background", { id, name });
}

export async function deleteBackground(id: string): Promise<void> {
  await invoke("delete_background", { id });
}

export async function readCharacterBackgrounds(
  characterId: string,
): Promise<CharacterBackgrounds> {
  return invoke<CharacterBackgrounds>("read_character_backgrounds", { characterId });
}

export async function writeCharacterBackgrounds(
  characterId: string,
  state: CharacterBackgrounds,
): Promise<void> {
  await invoke("write_character_backgrounds", { characterId, state });
}
