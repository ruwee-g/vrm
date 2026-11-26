import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isLocalSpeechSupported,
  LocalMicRecorder,
  type LocalCaptureStats,
} from "./localSpeech";
import {
  collectFinalText,
  describeSpeechError,
  getSpeechRecognitionConstructor,
  type Recognition,
} from "./speech";
import { IS_PRERELEASE } from "./channel";
import {
  checkForUpdates,
  currentAppVersion,
  installAvailableUpdate,
  startUpdateWatcher,
  subscribeToUpdates,
  type UpdateInfo,
} from "./updates";
import {
  DEFAULT_BACKGROUND_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_PERSONA_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_SYSTEM_PROMPT,
  apiChatCompletion,
  apiListModels,
  base64ToArrayBuffer,
  cancelSpeechDownload,
  characterModelIds,
  clearChat,
  dataUrlBytes,
  deleteBackground,
  deleteSpeechModel,
  deleteVrmModel,
  downloadSpeechModel,
  emptyCharacterBackgrounds,
  listBackgrounds,
  listGroupChats,
  listVrmModels,
  modelStatus,
  normalizeCharacterBackgrounds,
  openDataDir,
  readBackground,
  readCharacters,
  readVrmModelBase64,
  readVrmPreview,
  readCharacterBackgrounds,
  readSettings,
  renameBackground,
  renameVrmModel,
  saveBackground,
  saveVrmModel,
  saveVrmPreview,
  setActiveCharacter,
  speechDebug,
  speechModelInfo,
  speechRuntimeInfo,
  startModel,
  sttStart,
  sttStatus,
  sttStop,
  stopModel,
  transcribeAudio,
  validateGguf,
  validateRunner,
  writeCharacterBackgrounds,
  writeCharacters,
  writeSettings,
  type ApiSettings,
  type AppSettings,
  type BackgroundInfo,
  type Character,
  type CharacterBackgrounds,
  type ChatAppearance,
  type GroupChatInfo,
  type GroupResponseLength,
  type GroupSettings,
  type IdleIntensity,
  type KvCache,
  type ModelMode,
  type ModelStatus,
  type NavbarVisibility,
  type PersonaSettings,
  type Reasoning,
  type SpeechDownloadProgress,
  type SpeechEngine,
  type SpeechModelInfo,
  type SpeechQuant,
  type SpeechRuntimeInfo,
  type SpeechSettings,
} from "./store";
import { renderVrmPreview } from "./vrmPreview";

const CONTEXT_SIZES = [2048, 4096, 8192, 16384, 32768, 65536];
const KV_CACHES: KvCache[] = ["f16", "q8_0"];
const REASONINGS: Reasoning[] = ["off", "low", "medium", "high"];
const GROUP_LENGTHS: GroupResponseLength[] = ["short", "normal", "detailed"];
const GROUP_LENGTH_LABELS: Record<GroupResponseLength, string> = {
  short: "Коротко",
  normal: "Обычно",
  detailed: "Подробно",
};
const MODEL_MODES: ModelMode[] = ["local", "api"];
const MODEL_MODE_LABELS: Record<ModelMode, string> = {
  local: "Локальная модель",
  api: "API",
};
const API_PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Kimi / Moonshot", baseUrl: "https://api.moonshot.ai/v1", model: "" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "" },
  {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
  },
  { label: "Локальный сервер", baseUrl: "http://127.0.0.1:11434/v1", model: "" },
  { label: "Другой", baseUrl: "", model: "" },
];
const AVATAR_OUTPUT_W = 486;
const AVATAR_OUTPUT_H = 864;
const AVATAR_CROP_W = 243;
const AVATAR_CROP_H = 432;
const SPEECH_LANGUAGES = [
  { value: "ru-RU", label: "Русский" },
  { value: "bg-BG", label: "Български" },
  { value: "hr-HR", label: "Hrvatski" },
  { value: "cs-CZ", label: "Čeština" },
  { value: "da-DK", label: "Dansk" },
  { value: "nl-NL", label: "Nederlands" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "et-EE", label: "Eesti" },
  { value: "fi-FI", label: "Suomi" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "el-GR", label: "Ελληνικά" },
  { value: "hu-HU", label: "Magyar" },
  { value: "it-IT", label: "Italiano" },
  { value: "ja-JP", label: "日本語" },
  { value: "lv-LV", label: "Latviešu" },
  { value: "lt-LT", label: "Lietuvių" },
  { value: "pl-PL", label: "Polski" },
  { value: "pt-PT", label: "Português" },
  { value: "ro-RO", label: "Română" },
  { value: "sk-SK", label: "Slovenčina" },
  { value: "sl-SI", label: "Slovenščina" },
  { value: "es-ES", label: "Español" },
  { value: "sv-SE", label: "Svenska" },
  { value: "uk-UA", label: "Українська" },
];
const PARAKEET_LANGUAGES = new Set([
  "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt",
  "pl", "pt", "ro", "sk", "sl", "es", "sv", "uk",
]);
const SPEECH_ENGINES: Array<{ value: SpeechEngine; label: string }> = [
  { value: "webSpeech", label: "Web Speech" },
  { value: "localParakeet", label: "Локальный Parakeet" },
];
const SPEECH_QUANTS: Array<{ value: SpeechQuant; label: string; size: string }> = [
  { value: "q4_k", label: "Q4_K", size: "402 МБ" },
  { value: "q8_0", label: "Q8_0", size: "674 МБ" },
  { value: "f16", label: "F16", size: "1.26 ГБ" },
];

function languageCode(value: string): string {
  return value.split(/[-_]/)[0].toLowerCase();
}

function isParakeetLanguage(value: string): boolean {
  return PARAKEET_LANGUAGES.has(languageCode(value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function estimatePromptTokens(value: string): number {
  const text = (value ?? "").trim();
  if (!text) return 0;
  const parts = text.match(/[\p{L}\p{N}]+|[^\s]/gu) ?? [];
  const newlineTokens = (text.match(/\n/g) ?? []).length;
  return (
    parts.reduce((total, part) => {
      if (/^\p{N}+$/u.test(part)) {
        return total + Math.max(1, Math.ceil(part.length / 3));
      }
      if (/^\p{L}+$/u.test(part)) {
        const cyrillic = /[\u0400-\u04FF]/u.test(part);
        return total + Math.max(1, Math.ceil(part.length / (cyrillic ? 3 : 4)));
      }
      return total + 1;
    }, 0) + newlineTokens
  );
}

function tokenNoun(count: number): string {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return "токен";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "токена";
  return "токенов";
}

function PromptTokenCount({ value }: { value: string }) {
  const count = estimatePromptTokens(value);
  return (
    <p className="mt-1 text-[10px] leading-[14px] text-neutral-400">
      ≈ {count} {tokenNoun(count)}
    </p>
  );
}

type SectionId =
  | "general"
  | "model"
  | "vrm"
  | "backgrounds"
  | "characters"
  | "persona"
  | "group"
  | "speech"
  | "credits";

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: "general", label: "Общее" },
  { id: "model", label: "Модель" },
  { id: "vrm", label: "VRM модели" },
  { id: "backgrounds", label: "Фоны" },
  { id: "characters", label: "Персонажи" },
  { id: "persona", label: "Персона" },
  { id: "group", label: "Беседа" },
  { id: "speech", label: "Речь" },
  { id: "credits", label: "Благодарности" },
];

function Segmented<T extends string>({
  values,
  value,
  onChange,
  labels,
}: {
  values: T[];
  value: T;
  onChange: (next: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div className="flex gap-1">
      {values.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`rounded-md border px-3 py-1 text-[12px] ${
            value === item
              ? "border-neutral-800 bg-neutral-800 text-white"
              : "border-neutral-300 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          {labels?.[item] ?? item}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-[12px] text-neutral-800">{label}</span>
        <span className="block text-[11px] leading-[15px] text-neutral-500">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-800"
      />
    </label>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [previewProgress, setPreviewProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [modelNotice, setModelNotice] = useState("");
  const [renamingModel, setRenamingModel] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [backgrounds, setBackgrounds] = useState<BackgroundInfo[]>([]);
  const [backgroundUrls, setBackgroundUrls] = useState<Record<string, string>>({});
  const [backgroundNotice, setBackgroundNotice] = useState("");
  const [renamingBackground, setRenamingBackground] = useState<string | null>(null);
  const [backgroundRenameDraft, setBackgroundRenameDraft] = useState("");
  const [charBackgrounds, setCharBackgrounds] = useState<
    Record<string, CharacterBackgrounds>
  >({});
  const [backgroundCropSource, setBackgroundCropSource] = useState<string | null>(null);
  const [backgroundCropSize, setBackgroundCropSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [backgroundCropZoom, setBackgroundCropZoom] = useState(1);
  const [backgroundCropPos, setBackgroundCropPos] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("general");
  const [ggufExists, setGgufExists] = useState<boolean | null>(null);
  const [runnerExists, setRunnerExists] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ModelStatus>({ status: "idle", message: "" });
  const [loading, setLoading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [dataDirError, setDataDirError] = useState("");
  const [chatNotice, setChatNotice] = useState("");
  const [groupChats, setGroupChats] = useState<GroupChatInfo[]>([]);
  const [groupNotice, setGroupNotice] = useState("");
  const [avatarCropSource, setAvatarCropSource] = useState<string | null>(null);
  const [avatarCropSize, setAvatarCropSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [avatarCropZoom, setAvatarCropZoom] = useState(1);
  const [avatarCropPos, setAvatarCropPos] = useState({ x: 0, y: 0 });
  const [speechTestState, setSpeechTestState] = useState<
    "idle" | "listening" | "done" | "error"
  >("idle");
  const [speechTestText, setSpeechTestText] = useState("");
  const [speechTestError, setSpeechTestError] = useState("");
  const [speechRuntime, setSpeechRuntime] = useState<SpeechRuntimeInfo | null>(null);
  const [speechModel, setSpeechModel] = useState<SpeechModelInfo | null>(null);
  const [speechDownload, setSpeechDownload] = useState<SpeechDownloadProgress | null>(null);
  const [speechNotice, setSpeechNotice] = useState("");
  const [apiModels, setApiModels] = useState<string[]>([]);
  const [apiNotice, setApiNotice] = useState("");
  const [apiBusy, setApiBusy] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateNotice, setUpdateNotice] = useState("");
  const [sttState, setSttState] = useState<ModelStatus>({ status: "idle", message: "" });
  const [sttBusy, setSttBusy] = useState(false);
  const vrmFileInputRef = useRef<HTMLInputElement>(null);
  const previewRequestedRef = useRef<Set<string>>(new Set());
  const previewFailedRef = useRef<Set<string>>(new Set());
  const previewUrlsRef = useRef<Record<string, string>>({});
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);
  const backgroundUrlsRef = useRef<Record<string, string>>({});
  const backgroundPreviewRequestedRef = useRef<Set<string>>(new Set());
  const backgroundCropDragRef = useRef<{ x: number; y: number } | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const avatarDragRef = useRef<{ x: number; y: number } | null>(null);
  const speechTestRef = useRef<Recognition | null>(null);
  const speechTestTextRef = useRef("");
  const speechTestRunRef = useRef(0);
  const localTestRecorderRef = useRef<LocalMicRecorder | null>(null);
  const personaPreviewName = settings.persona?.name?.trim() || "User";

  useEffect(() => {
    if (section !== "group") return;
    void listGroupChats()
      .then(setGroupChats)
      .catch(() => setGroupChats([]));
  }, [section]);

  useEffect(() => {
    let active = true;
    void currentAppVersion()
      .then((version) => {
        if (active) setAppVersion(version);
      })
      .catch(() => undefined);
    const unsubscribe = subscribeToUpdates(setUpdateInfo);
    void startUpdateWatcher();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refreshSpeechState = async (quant: SpeechQuant) => {
    const [runtime, model, status] = await Promise.all([
      speechRuntimeInfo().catch(() => null),
      speechModelInfo(quant).catch(() => null),
      sttStatus().catch(() => null),
    ]);
    if (runtime) setSpeechRuntime(runtime);
    if (model) setSpeechModel(model);
    if (status) setSttState(status);
  };

  useEffect(() => {
    void readSettings()
      .then((value) => setSettings(value))
      .catch(() => {});
    void readCharacters()
      .then(async (list) => {
        setCharacters(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
        const entries = await Promise.all(
          list.map(async (character) => {
            const state = normalizeCharacterBackgrounds(
              await readCharacterBackgrounds(character.id).catch(() =>
                emptyCharacterBackgrounds(),
              ),
            );
            return [character.id, state] as const;
          }),
        );
        setCharBackgrounds(Object.fromEntries(entries));
      })
      .catch(() => {});
    void listVrmModels()
      .then(setCustomModels)
      .catch(() => {});
    void listBackgrounds()
      .then(setBackgrounds)
      .catch(() => {});
    void modelStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  const setPreviewUrl = (modelId: string, url: string) => {
    const old = previewUrlsRef.current[modelId];
    if (old && old !== url) URL.revokeObjectURL(old);
    previewUrlsRef.current = { ...previewUrlsRef.current, [modelId]: url };
    setPreviews((current) => ({ ...current, [modelId]: url }));
  };

  const loadCachedPreview = async (modelId: string): Promise<boolean> => {
    if (previewUrlsRef.current[modelId]) return true;
    try {
      const bytes = await readVrmPreview(modelId);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      );
      setPreviewUrl(modelId, url);
      return true;
    } catch {
      return false;
    }
  };

  const persistPreview = async (modelId: string, buffer: ArrayBuffer) => {
    const dataUrl = await renderVrmPreview(buffer);
    const bytes = await dataUrlBytes(dataUrl);
    await saveVrmPreview(modelId, bytes);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
    );
    setPreviewUrl(modelId, url);
  };

  const readPreviewSource = async (modelId: string): Promise<ArrayBuffer> => {
    if (!IS_PRERELEASE && modelId === DEFAULT_MODEL_ID) {
      const response = await fetch("/vrm/model.vrm");
      if (!response.ok) throw new Error("Не удалось прочитать базовую модель");
      return response.arrayBuffer();
    }
    return base64ToArrayBuffer(await readVrmModelBase64(modelId));
  };

  const regeneratePreview = async (modelId: string) => {
    if (previewRequestedRef.current.has(modelId)) return;
    previewRequestedRef.current.add(modelId);
    previewFailedRef.current.delete(modelId);
    setPreviewErrors((current) => {
      const next = { ...current };
      delete next[modelId];
      return next;
    });
    try {
      await persistPreview(modelId, await readPreviewSource(modelId));
    } catch (error) {
      previewFailedRef.current.add(modelId);
      setPreviewErrors((current) => ({
        ...current,
        [modelId]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      previewRequestedRef.current.delete(modelId);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const modelId of Array.from(new Set([DEFAULT_MODEL_ID, ...customModels]))) {
        if (cancelled) break;
        if (previewUrlsRef.current[modelId]) continue;
        await loadCachedPreview(modelId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customModels]);

  useEffect(
    () => () => {
      for (const url of Object.values(previewUrlsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  useEffect(() => {
    if (section !== "vrm") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const missing = Array.from(new Set([DEFAULT_MODEL_ID, ...customModels])).filter(
          (id) =>
            !previewUrlsRef.current[id] &&
            !previewRequestedRef.current.has(id) &&
            !previewFailedRef.current.has(id),
        );
        if (missing.length === 0) return;
        setPreviewProgress({ done: 0, total: missing.length });
        for (const [index, modelId] of missing.entries()) {
          if (cancelled) break;
          await regeneratePreview(modelId);
          if (!cancelled) {
            setPreviewProgress({ done: index + 1, total: missing.length });
          }
        }
        if (!cancelled) setPreviewProgress(null);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [section, customModels]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const urls = { ...backgroundUrlsRef.current };
      for (const item of backgrounds) {
        if (cancelled || urls[item.id]) continue;
        try {
          const bytes = await readBackground(item.fileName);
          if (cancelled) break;
          urls[item.id] = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
          );
          backgroundUrlsRef.current = urls;
          setBackgroundUrls({ ...urls });
        } catch {
          // фон может быть временно недоступен
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backgrounds]);

  useEffect(
    () => () => {
      for (const url of Object.values(backgroundUrlsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  useEffect(() => {
    if (!backgroundCropSource) {
      setBackgroundCropSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setBackgroundCropSize({ width: img.naturalWidth, height: img.naturalHeight });
      setBackgroundCropZoom(1);
      setBackgroundCropPos({ x: 0, y: 0 });
    };
    img.src = backgroundCropSource;
  }, [backgroundCropSource]);

  useEffect(() => {
    if (status.status === "loading") return;
    const timer = window.setInterval(() => {
      void modelStatus()
        .then((next) => {
          setStatus((current) =>
            current.status === "loading"
              ? current
              : current.status === next.status && current.message === next.message
                ? current
                : next,
          );
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [status.status]);

  useEffect(() => {
    void refreshSpeechState(settings.speech.localQuant);
  }, [settings.speech.localQuant]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<SpeechDownloadProgress>("speech-download-progress", ({ payload }) => {
      setSpeechDownload(payload);
      if (payload.done) void refreshSpeechState(payload.quant);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!settings.ggufPath) {
      setGgufExists(null);
      return;
    }
    void validateGguf(settings.ggufPath)
      .then(setGgufExists)
      .catch(() => setGgufExists(false));
  }, [settings.ggufPath]);

  useEffect(() => {
    if (!settings.runnerPath) {
      setRunnerExists(null);
      return;
    }
    void validateRunner(settings.runnerPath)
      .then(setRunnerExists)
      .catch(() => setRunnerExists(false));
  }, [settings.runnerPath]);

  useEffect(() => {
    if (!avatarCropSource) {
      setAvatarCropSize(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      setAvatarCropSize({ width: image.naturalWidth, height: image.naturalHeight });
      setAvatarCropZoom(1);
      setAvatarCropPos({ x: 0, y: 0 });
    };
    image.onerror = () => setAvatarError("Не удалось открыть изображение");
    image.src = avatarCropSource;
  }, [avatarCropSource]);

  useEffect(
    () => () => {
      try {
        speechTestRef.current?.stop();
      } catch {
        // тест мог уже завершиться
      }
      speechTestRef.current = null;
      localTestRecorderRef.current?.cancel();
      localTestRecorderRef.current = null;
    },
    [],
  );

  const stopSpeechTest = () => {
    speechTestRunRef.current += 1;
    try {
      speechTestRef.current?.stop();
    } catch {
      // тест мог уже завершиться
    }
    speechTestRef.current = null;
    localTestRecorderRef.current?.cancel();
    localTestRecorderRef.current = null;
    setSpeechTestState("idle");
  };

  const startSpeechTest = async () => {
    const runId = ++speechTestRunRef.current;
    const debug = (message: string) => {
      void speechDebug(message).catch(() => {});
    };
    try {
      speechTestRef.current?.stop();
    } catch {
      // тест мог уже завершиться
    }
    speechTestRef.current = null;
    localTestRecorderRef.current?.cancel();
    localTestRecorderRef.current = null;

    setSpeechTestText("");
    speechTestTextRef.current = "";
    setSpeechTestError("");
    setSpeechTestState("listening");

    if (settings.speech.engine === "localParakeet") {
      try {
        const stt = await sttStart();
        debug(`test stt status=${stt.status} message=${stt.message}`);
        if (stt.status === "error") {
          throw new Error(stt.message || "Не удалось запустить локальный STT");
        }
        if (runId !== speechTestRunRef.current) return;
        setSttState(stt);

        const recorder = new LocalMicRecorder();
        localTestRecorderRef.current = recorder;
        const wav = await recorder.record({
          onStats: (stats: LocalCaptureStats) => {
            debug(
              `test capture sourceRate=${stats.sourceRate} duration=${stats.durationMs}ms voice=${stats.voiceMs}ms peak=${stats.peakRms.toFixed(4)} last=${stats.lastRms.toFixed(4)} threshold=${stats.threshold.toFixed(4)} wavPeak=${stats.wavPeak.toFixed(4)} wav=${stats.wavBytes}`,
            );
          },
        });
        localTestRecorderRef.current = null;
        if (runId !== speechTestRunRef.current) return;
        if (!wav.byteLength) {
          throw new Error("Речь не распознана, попробуйте ещё раз");
        }

        const text = await transcribeAudio(wav, settings.speech.language);
        debug(`test result text=${JSON.stringify(text)}`);
        if (runId !== speechTestRunRef.current) return;
        if (text) {
          speechTestTextRef.current = text;
          setSpeechTestText(text);
          setSpeechTestState("done");
        } else {
          throw new Error("Речь не распознана, попробуйте ещё раз");
        }
      } catch (error) {
        if (runId !== speechTestRunRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        debug(`test error=${message}`);
        setSpeechTestError(message);
        setSpeechTestState("error");
      }
      return;
    }

    const RecognitionImpl = getSpeechRecognitionConstructor();
    if (!RecognitionImpl) {
      setSpeechTestError("Распознавание речи недоступно в этом окне");
      setSpeechTestState("error");
      return;
    }

    const recognition = new RecognitionImpl();
    recognition.lang = settings.speech.language || "ru-RU";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      if (runId === speechTestRunRef.current) setSpeechTestState("listening");
    };
    recognition.onresult = (event) => {
      if (runId !== speechTestRunRef.current) return;
      const text = collectFinalText(event);
      if (text) {
        speechTestTextRef.current = speechTestTextRef.current
          ? `${speechTestTextRef.current} ${text}`
          : text;
        setSpeechTestText(speechTestTextRef.current);
      }
    };
    recognition.onerror = (event) => {
      if (runId !== speechTestRunRef.current) return;
      const message = describeSpeechError(event.error);
      setSpeechTestError(message);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setSpeechTestState("error");
      }
    };
    recognition.onend = () => {
      if (runId !== speechTestRunRef.current) return;
      speechTestRef.current = null;
      setSpeechTestState((current) =>
        current === "error" ? current : speechTestTextRef.current ? "done" : "idle",
      );
    };

    speechTestRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setSpeechTestError("Не удалось запустить распознавание речи");
      setSpeechTestState("error");
    }
  };

  const updateSettings = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void writeSettings(next).catch((error) =>
      console.error("Не удалось сохранить настройки", error),
    );
  };

  const updateSpeech = (patch: Partial<SpeechSettings>): Promise<void> => {
    const next = {
      ...settings,
      speech: { ...settings.speech, ...patch },
    };
    setSettings(next);
    return writeSettings(next).catch((error) =>
      console.error("Не удалось сохранить настройки речи", error),
    );
  };

  const updateGroup = (patch: Partial<GroupSettings>): Promise<void> => {
    const next = {
      ...settings,
      group: { ...settings.group, ...patch },
    };
    setSettings(next);
    return writeSettings(next).catch((error) =>
      console.error("Не удалось сохранить настройки беседы", error),
    );
  };

  const updatePersona = (patch: Partial<PersonaSettings>): Promise<void> => {
    const next = {
      ...settings,
      persona: { ...DEFAULT_PERSONA_SETTINGS, ...settings.persona, ...patch },
    };
    setSettings(next);
    return writeSettings(next).catch((error) =>
      console.error("Не удалось сохранить персону", error),
    );
  };

  const updateApi = (patch: Partial<ApiSettings>): Promise<void> => {
    const next = {
      ...settings,
      api: { ...settings.api, ...patch },
    };
    setSettings(next);
    return writeSettings(next).catch((error) =>
      console.error("Не удалось сохранить настройки API", error),
    );
  };

  const runApiCheck = async (listModels: boolean) => {
    const baseUrl = settings.api.baseUrl.trim();
    const model = settings.api.model.trim();
    if (!baseUrl) {
      setApiNotice("Укажите Base URL API");
      return;
    }
    setApiBusy(true);
    setApiNotice("");
    try {
      if (listModels) {
        const models = await apiListModels(baseUrl, settings.api.apiKey);
        setApiModels(models);
        setApiNotice(
          models.length ? `Найдено моделей: ${models.length}` : "Модели не найдены",
        );
      } else {
        if (!model) {
          setApiNotice("Укажите модель API");
          setApiBusy(false);
          return;
        }
        const reply = await apiChatCompletion(baseUrl, settings.api.apiKey, model, {
          messages: [{ role: "user", content: "Ответь одним словом: готов" }],
        });
        const preview = reply.trim().slice(0, 80) || "пустой ответ";
        setApiNotice(`Подключение работает: ${preview}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setApiNotice(`Ошибка: ${detail}`);
    } finally {
      setApiBusy(false);
    }
  };

  const selectEngine = async (engine: SpeechEngine) => {
    const patch: Partial<SpeechSettings> = { engine };
    if (engine === "localParakeet" && !isParakeetLanguage(settings.speech.language)) {
      patch.language = "en-US";
    }
    await updateSpeech(patch);
    if (engine === "webSpeech") {
      setSttBusy(true);
      try {
        setSttState(await sttStop());
      } catch {
        // сервер мог быть уже остановлен
      } finally {
        setSttBusy(false);
      }
    }
  };

  const startStt = async () => {
    setSttBusy(true);
    try {
      setSttState(await sttStart());
    } catch (error) {
      setSttState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSttBusy(false);
    }
  };

  const stopStt = async () => {
    setSttBusy(true);
    try {
      setSttState(await sttStop());
    } catch (error) {
      setSttState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSttBusy(false);
    }
  };

  const downloadModel = async () => {
    const quant = settings.speech.localQuant;
    setSpeechNotice("");
    try {
      await downloadSpeechModel(quant);
      await refreshSpeechState(quant);
      await selectEngine("localParakeet");
      setSpeechNotice("Модель установлена. Включён локальный Parakeet.");
    } catch (error) {
      setSpeechNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const removeModel = async () => {
    const quant = settings.speech.localQuant;
    try {
      await deleteSpeechModel(quant);
      await refreshSpeechState(quant);
      setSpeechNotice("Модель удалена");
    } catch (error) {
      setSpeechNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const selectQuant = async (quant: SpeechQuant) => {
    if (quant === settings.speech.localQuant) return;
    await updateSpeech({ localQuant: quant });
    if (sttState.status !== "idle") await stopStt();
    setSpeechNotice("Версия модели изменена. Сервер перезапустится при следующем включении микрофона.");
  };

  const updateCharacter = (patch: Partial<Character>) => {
    if (!selectedId) return;
    const next = characters.map((character) =>
      character.id === selectedId ? { ...character, ...patch } : character,
    );
    setCharacters(next);
    void writeCharacters(next).catch((error) =>
      console.error("Не удалось сохранить персонажей", error),
    );
  };

  const addCharacter = () => {
    const character: Character = {
      id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: "Новый персонаж",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      prompt: "",
      examples: "",
      modelId: DEFAULT_MODEL_ID,
      modelIds: [],
      avatar: null,
      realTime: true,
      idleActivity: true,
      idleIntensity: "medium",
      musicReactivity: true,
      interactionResponses: true,
    };
    const next = [...characters, character];
    setCharacters(next);
    setSelectedId(character.id);
    setAvatarError("");
    setChatNotice("");
    void writeCharacters(next).catch((error) =>
      console.error("Не удалось сохранить персонажей", error),
    );
  };

  const deleteCharacter = () => {
    if (!selectedId || characters.length <= 1) return;
    const next = characters.filter((character) => character.id !== selectedId);
    setCharacters(next);
    setSelectedId(next[0].id);
    setAvatarError("");
    setChatNotice("");
    void writeCharacters(next).catch((error) =>
      console.error("Не удалось сохранить персонажей", error),
    );
    if (settings.activeCharacterId === selectedId) {
      setSettings((current) => ({ ...current, activeCharacterId: next[0].id }));
      void setActiveCharacter(next[0].id).catch((error) =>
        console.error("Не удалось сменить активного персонажа", error),
      );
    }
  };

  const pickGguf = async () => {
    try {
      const path = await open({
        multiple: false,
        title: "Выбрать модель GGUF",
        filters: [{ name: "GGUF модели", extensions: ["gguf"] }],
      });
      if (typeof path === "string") updateSettings({ ggufPath: path });
    } catch (error) {
      console.error("Не удалось выбрать файл модели", error);
    }
  };

  const pickRunner = async () => {
    try {
      const path = await open({
        multiple: false,
        title: "Выбрать llama-server",
      });
      if (typeof path === "string") updateSettings({ runnerPath: path });
    } catch (error) {
      console.error("Не удалось выбрать llama-server", error);
    }
  };

  const pickMmproj = async () => {
    try {
      const path = await open({
        multiple: false,
        title: "Выбрать mmproj (vision projector)",
        filters: [{ name: "Модели зрения", extensions: ["gguf"] }],
      });
      if (typeof path === "string") updateSettings({ mmprojPath: path });
    } catch (error) {
      console.error("Не удалось выбрать файл mmproj", error);
    }
  };

  const loadModel = async () => {
    setLoading(true);
    setStatus({ status: "loading", message: "Загрузка модели…" });
    try {
      setStatus(await startModel());
    } catch (error) {
      setStatus({ status: "error", message: String(error) });
    } finally {
      setLoading(false);
    }
  };

  const unloadModel = async () => {
    setLoading(true);
    try {
      setStatus(await stopModel());
    } catch (error) {
      setStatus({ status: "error", message: String(error) });
    } finally {
      setLoading(false);
    }
  };

  const refreshVrmModels = async () => {
    const names = await listVrmModels();
    setCustomModels(names);
    const active = new Set([DEFAULT_MODEL_ID, ...names]);
    const urls = { ...previewUrlsRef.current };
    for (const [name, url] of Object.entries(urls)) {
      if (!active.has(name)) {
        URL.revokeObjectURL(url);
        delete urls[name];
      }
    }
    previewUrlsRef.current = urls;
    setPreviews({ ...urls });
    setPreviewErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([name]) => active.has(name))),
    );
    for (const name of Array.from(previewRequestedRef.current)) {
      if (!active.has(name)) previewRequestedRef.current.delete(name);
    }
    for (const name of Array.from(previewFailedRef.current)) {
      if (!active.has(name)) previewFailedRef.current.delete(name);
    }
  };

  const addVrmModels = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setModelNotice("");
    const sources: Array<{ id: string; buffer: ArrayBuffer }> = [];
    try {
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const id = await saveVrmModel(file.name, Array.from(new Uint8Array(buffer)));
        previewRequestedRef.current.add(id);
        previewFailedRef.current.delete(id);
        sources.push({ id, buffer });
      }
      await refreshVrmModels();
      setPreviewProgress({ done: 0, total: sources.length });
      for (const [index, source] of sources.entries()) {
        setModelNotice(`Готовим превью ${index + 1} из ${sources.length}…`);
        try {
          await persistPreview(source.id, source.buffer);
          previewFailedRef.current.delete(source.id);
          setPreviewErrors((current) => {
            const next = { ...current };
            delete next[source.id];
            return next;
          });
        } catch (error) {
          previewFailedRef.current.add(source.id);
          setPreviewErrors((current) => ({
            ...current,
            [source.id]: error instanceof Error ? error.message : String(error),
          }));
        } finally {
          previewRequestedRef.current.delete(source.id);
        }
        setPreviewProgress({ done: index + 1, total: sources.length });
      }
      setPreviewProgress(null);
      setModelNotice(
        sources.length === 1
          ? `Модель «${sources[0].id.replace(/\.vrm$/i, "")}» загружена`
          : `Загружено моделей: ${sources.length}`,
      );
    } catch (error) {
      for (const source of sources) previewRequestedRef.current.delete(source.id);
      setPreviewProgress(null);
      setModelNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const commitRename = async (oldName: string) => {
    const nextName = renameDraft.trim();
    if (!nextName || nextName === oldName.replace(/\.vrm$/i, "")) {
      setRenamingModel(null);
      return;
    }
    try {
      const result = await renameVrmModel(oldName, nextName);
      if (result !== oldName) {
        const oldUrl = previewUrlsRef.current[oldName];
        if (oldUrl) {
          URL.revokeObjectURL(oldUrl);
          const urls = { ...previewUrlsRef.current };
          delete urls[oldName];
          previewUrlsRef.current = urls;
          setPreviews({ ...urls });
        }
        previewRequestedRef.current.delete(oldName);
        previewRequestedRef.current.delete(result);
        previewFailedRef.current.delete(oldName);
        previewFailedRef.current.delete(result);
        await loadCachedPreview(result);
      }
      await refreshVrmModels();
      await readCharacters().then(setCharacters).catch(() => {});
      setModelNotice(
        result === oldName
          ? "Имя модели не изменилось"
          : `Модель переименована в «${result.replace(/\.vrm$/i, "")}»`,
      );
    } catch (error) {
      setModelNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamingModel(null);
    }
  };

  const removeVrmModel = async (name: string) => {
    if (
      !window.confirm(
        `Удалить модель «${name.replace(/\.vrm$/i, "")}»? Она будет откреплена от всех персонажей.`,
      )
    ) {
      return;
    }
    try {
      await deleteVrmModel(name);
      await refreshVrmModels();
      await readCharacters().then(setCharacters).catch(() => {});
      setModelNotice("Модель удалена");
    } catch (error) {
      setModelNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleCharacterModel = (fileName: string) => {
    if (!selected) return;
    const attached = characterModelIds(selected);
    const nextAttached = attached.includes(fileName)
      ? attached.filter((id) => id !== fileName)
      : [...attached, fileName];
    const patch: Partial<Character> = { modelIds: nextAttached };
    if (selected.modelId === fileName && !nextAttached.includes(fileName)) {
      patch.modelId = DEFAULT_MODEL_ID;
    }
    updateCharacter(patch);
  };

  const attachCharacterModel = (fileName: string) => {
    if (!selected || characterModelIds(selected).includes(fileName)) return;
    updateCharacter({
      modelIds: [...characterModelIds(selected), fileName],
    });
  };

  const refreshBackgrounds = async () => {
    const list = await listBackgrounds();
    setBackgrounds(list);
    setCharBackgrounds(
      Object.fromEntries(
        await Promise.all(
          characters.map(async (character) => {
            const state = normalizeCharacterBackgrounds(
              await readCharacterBackgrounds(character.id).catch(() =>
                emptyCharacterBackgrounds(),
              ),
            );
            return [character.id, state] as const;
          }),
        ),
      ),
    );

    const activeIds = new Set(list.map((item) => item.id));
    const urls = { ...backgroundUrlsRef.current };
    for (const [id, url] of Object.entries(urls)) {
      if (!activeIds.has(id)) {
        URL.revokeObjectURL(url);
        delete urls[id];
      }
    }
    backgroundUrlsRef.current = urls;
    setBackgroundUrls(urls);
    for (const id of Array.from(backgroundPreviewRequestedRef.current)) {
      if (!activeIds.has(id)) backgroundPreviewRequestedRef.current.delete(id);
    }
  };

  const commitCharacterBackground = async (
    characterId: string,
    state: CharacterBackgrounds,
  ) => {
    const next = normalizeCharacterBackgrounds(state);
    setCharBackgrounds((current) => ({ ...current, [characterId]: next }));
    try {
      await writeCharacterBackgrounds(characterId, next);
    } catch (error) {
      console.error("Не удалось сохранить фоны персонажа", error);
      setBackgroundNotice("Не удалось сохранить фоны персонажа");
    }
  };

  const handleBackgroundFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setBackgroundNotice("");
    const reader = new FileReader();
    reader.onload = () => setBackgroundCropSource(String(reader.result));
    reader.readAsDataURL(file);
  };

  const backgroundCropCover = backgroundCropSize
    ? Math.max(
        AVATAR_CROP_W / backgroundCropSize.width,
        AVATAR_CROP_H / backgroundCropSize.height,
      )
    : 0;
  const backgroundCropDisplayW = backgroundCropSize
    ? backgroundCropSize.width * backgroundCropCover * backgroundCropZoom
    : 0;
  const backgroundCropDisplayH = backgroundCropSize
    ? backgroundCropSize.height * backgroundCropCover * backgroundCropZoom
    : 0;

  const clampBackgroundCropPos = (
    zoom: number,
    pos: { x: number; y: number },
  ): { x: number; y: number } => {
    if (!backgroundCropSize) return pos;
    const cover = Math.max(
      AVATAR_CROP_W / backgroundCropSize.width,
      AVATAR_CROP_H / backgroundCropSize.height,
    );
    const w = backgroundCropSize.width * cover * zoom;
    const h = backgroundCropSize.height * cover * zoom;
    return {
      x: clamp(pos.x, -Math.max(0, (w - AVATAR_CROP_W) / 2), Math.max(0, (w - AVATAR_CROP_W) / 2)),
      y: clamp(pos.y, -Math.max(0, (h - AVATAR_CROP_H) / 2), Math.max(0, (h - AVATAR_CROP_H) / 2)),
    };
  };

  const applyBackgroundCrop = () => {
    if (!backgroundCropSource || !backgroundCropSize) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_OUTPUT_W;
      canvas.height = AVATAR_OUTPUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#f4f4f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const cover = Math.max(
        AVATAR_CROP_W / img.naturalWidth,
        AVATAR_CROP_H / img.naturalHeight,
      );
      const displayW = img.naturalWidth * cover * backgroundCropZoom;
      const displayH = img.naturalHeight * cover * backgroundCropZoom;
      ctx.drawImage(
        img,
        ((AVATAR_CROP_W - displayW) / 2 + backgroundCropPos.x) * 2,
        ((AVATAR_CROP_H - displayH) / 2 + backgroundCropPos.y) * 2,
        displayW * 2,
        displayH * 2,
      );
      void (async () => {
        try {
          const bytes = await dataUrlBytes(canvas.toDataURL("image/jpeg", 0.82));
          await saveBackground("Новый фон", bytes);
          await refreshBackgrounds();
          setBackgroundNotice("Фон добавлен в библиотеку");
          setBackgroundCropSource(null);
        } catch (error) {
          setBackgroundNotice(error instanceof Error ? error.message : String(error));
        }
      })();
    };
    img.src = backgroundCropSource;
  };

  const commitBackgroundRename = async (id: string) => {
    const name = backgroundRenameDraft.trim();
    if (!name) {
      setRenamingBackground(null);
      return;
    }
    try {
      const next = await renameBackground(id, name);
      await refreshBackgrounds();
      setBackgroundNotice(`Фон переименован в «${next}»`);
    } catch (error) {
      setBackgroundNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamingBackground(null);
    }
  };

  const removeBackground = async (item: BackgroundInfo) => {
    if (
      !window.confirm(
        `Удалить фон «${item.name || "Без имени"}»? Он будет откреплён от всех персонажей.`,
      )
    ) {
      return;
    }
    try {
      await deleteBackground(item.id);
      await refreshBackgrounds();
      setBackgroundNotice("Фон удалён из библиотеки");
    } catch (error) {
      setBackgroundNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleCharacterBackground = (id: string) => {
    if (!selected) return;
    const state = normalizeCharacterBackgrounds(
      charBackgrounds[selected.id] ?? emptyCharacterBackgrounds(),
    );
    void commitCharacterBackground(selected.id, {
      activeId: state.activeId === id ? DEFAULT_BACKGROUND_ID : state.activeId,
      attachedIds: state.attachedIds.includes(id)
        ? state.attachedIds.filter((value) => value !== id)
        : [...state.attachedIds, id],
    });
  };

  const activateCharacterBackground = (id: string) => {
    if (!selected) return;
    void commitCharacterBackground(selected.id, {
      ...normalizeCharacterBackgrounds(
        charBackgrounds[selected.id] ?? emptyCharacterBackgrounds(),
      ),
      activeId: id,
    });
  };

  const uploadAvatar = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedId) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Нужен файл изображения");
      return;
    }
    setAvatarError("");

    const reader = new FileReader();
    reader.onerror = () => setAvatarError("Не удалось прочитать файл");
    reader.onload = () => setAvatarCropSource(String(reader.result));
    reader.readAsDataURL(file);
  };

  const avatarCover = avatarCropSize
    ? Math.max(
        AVATAR_CROP_W / avatarCropSize.width,
        AVATAR_CROP_H / avatarCropSize.height,
      )
    : 0;
  const avatarDisplayW = avatarCropSize ? avatarCropSize.width * avatarCover * avatarCropZoom : 0;
  const avatarDisplayH = avatarCropSize ? avatarCropSize.height * avatarCover * avatarCropZoom : 0;

  const clampAvatarPos = (zoom: number, pos: { x: number; y: number }) => {
    if (!avatarCropSize) return pos;
    const cover = Math.max(
      AVATAR_CROP_W / avatarCropSize.width,
      AVATAR_CROP_H / avatarCropSize.height,
    );
    const width = avatarCropSize.width * cover * zoom;
    const height = avatarCropSize.height * cover * zoom;
    return {
      x: clamp(pos.x, -Math.max(0, (width - AVATAR_CROP_W) / 2), Math.max(0, (width - AVATAR_CROP_W) / 2)),
      y: clamp(pos.y, -Math.max(0, (height - AVATAR_CROP_H) / 2), Math.max(0, (height - AVATAR_CROP_H) / 2)),
    };
  };

  const applyAvatarCrop = () => {
    if (!avatarCropSource || !avatarCropSize) return;
    const image = new Image();
    image.onerror = () => setAvatarError("Не удалось подготовить аватарку");
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_OUTPUT_W;
      canvas.height = AVATAR_OUTPUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setAvatarError("Не удалось подготовить аватарку");
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, AVATAR_OUTPUT_W, AVATAR_OUTPUT_H);

      const cover = Math.max(
        AVATAR_CROP_W / image.naturalWidth,
        AVATAR_CROP_H / image.naturalHeight,
      );
      const displayW = image.naturalWidth * cover * avatarCropZoom;
      const displayH = image.naturalHeight * cover * avatarCropZoom;
      const scaleX = AVATAR_OUTPUT_W / AVATAR_CROP_W;
      const scaleY = AVATAR_OUTPUT_H / AVATAR_CROP_H;
      ctx.drawImage(
        image,
        ((AVATAR_CROP_W - displayW) / 2 + avatarCropPos.x) * scaleX,
        ((AVATAR_CROP_H - displayH) / 2 + avatarCropPos.y) * scaleY,
        displayW * scaleX,
        displayH * scaleY,
      );

      updateCharacter({ avatar: canvas.toDataURL("image/jpeg", 0.86) });
      setAvatarCropSource(null);
    };
    image.src = avatarCropSource;
  };

  const clearSelectedChat = async () => {
    if (!selectedId) return;
    const name = characters.find((item) => item.id === selectedId)?.name ?? "персонажа";
    if (!window.confirm(`Полностью удалить историю чата «${name}»?`)) return;
    try {
      await clearChat(selectedId);
      setChatNotice("История чата очищена");
    } catch (error) {
      console.error("Не удалось очистить чат", error);
      setChatNotice("Не удалось очистить чат");
    }
  };

  const deleteGroupChat = async (key: string) => {
    if (!window.confirm("Удалить историю этой беседы?")) return;
    try {
      await clearChat(key);
      setGroupChats((current) => current.filter((item) => item.key !== key));
      setGroupNotice("История беседы удалена");
    } catch (error) {
      console.error("Не удалось удалить беседу", error);
      setGroupNotice("Не удалось удалить беседу");
    }
  };

  const manualUpdateCheck = async () => {
    setUpdateBusy(true);
    setUpdateNotice("");
    try {
      const info = await checkForUpdates();
      setUpdateNotice(info ? `Доступна версия ${info.version}` : "Обновлений нет");
    } catch (error) {
      setUpdateNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setUpdateBusy(true);
    setUpdateNotice("");
    try {
      await installAvailableUpdate();
      setUpdateNotice("Обновление установлено. Перезапустите приложение.");
    } catch (error) {
      setUpdateNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const selected = characters.find((character) => character.id === selectedId) ?? null;
  const characterBackgroundState = selected
    ? normalizeCharacterBackgrounds(
        charBackgrounds[selected.id] ?? emptyCharacterBackgrounds(),
      )
    : emptyCharacterBackgrounds();
  const selectedModelIds = selected ? characterModelIds(selected) : [];
  const attachedBackgrounds = backgrounds.filter((item) =>
    characterBackgroundState.attachedIds.includes(item.id),
  );
  const fileName = settings.ggufPath.split(/[\\/]/).pop() || settings.ggufPath;
  const localEngine = settings.speech.engine === "localParakeet";
  const visibleLanguages = localEngine
    ? SPEECH_LANGUAGES.filter((item) => isParakeetLanguage(item.value))
    : SPEECH_LANGUAGES;

  return (
    <div className="flex h-screen bg-white text-[13px] text-neutral-800">
      <aside className="flex w-[150px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 px-2 py-4">
        <h1 className="px-2 pb-4 text-[15px] font-semibold">Настройки</h1>
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`rounded-md px-2 py-2 text-left text-[12px] transition ${
                section === item.id
                  ? "bg-neutral-200 font-medium text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-4">
          <button
            type="button"
            title="Открыть папку с данными приложения"
            onClick={() => {
              setDataDirError("");
              void openDataDir().catch(() =>
                setDataDirError("Не удалось открыть папку"),
              );
            }}
            className="w-full rounded-md px-2 py-2 text-left text-[11px] text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800"
          >
            Папка данных
          </button>
          {dataDirError && (
            <p className="px-2 pt-1 text-[10px] text-rose-600">{dataDirError}</p>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
        {section === "general" && (
          <section>
            <h2 className="mb-3 text-[14px] font-semibold">Общее</h2>
            {IS_PRERELEASE && (
              <div className="mb-3 rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold">Обновления</h3>
                  <span className="text-[11px] text-neutral-500">
                    Текущая версия: {appVersion || "…"}
                  </span>
                </div>
                {updateInfo ? (
                  <div className="mt-2 rounded-[10px] border border-rose-200 bg-rose-50/70 px-2.5 py-2">
                    <p className="text-[12px] font-medium text-rose-700">
                      Доступна версия {updateInfo.version}
                    </p>
                    {updateInfo.notes && (
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-[15px] text-rose-700/80">
                        {updateInfo.notes}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-neutral-500">
                    У вас актуальная версия.
                  </p>
                )}
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void manualUpdateCheck()}
                    disabled={updateBusy}
                    className="rounded-[10px] border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Проверить
                  </button>
                  <button
                    type="button"
                    onClick={() => void installUpdate()}
                    disabled={updateBusy || !updateInfo}
                    className="rounded-[10px] bg-rose-600 px-2.5 py-1.5 text-[11px] text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Скачать и установить
                  </button>
                </div>
                {updateNotice && (
                  <p className="mt-2 text-[11px] leading-[15px] text-neutral-500">
                    {updateNotice}
                  </p>
                )}
              </div>
            )}
            <div className="rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
              <label className="mb-1.5 block text-[12px] text-neutral-500">
                Внешний вид чата
              </label>
              <Segmented
                values={["default", "glass", "bubbles"] as ChatAppearance[]}
                value={settings.chatAppearance ?? "default"}
                onChange={(next) => void updateSettings({ chatAppearance: next })}
                labels={{
                  default: "Дефолт",
                  glass: "Стекло",
                  bubbles: "Только баблы",
                }}
              />
              <p className="mt-1.5 text-[11px] leading-[15px] text-neutral-500">
                Дефолт — белая карточка чата. Стекло — полупрозрачная карточка с размытием.
                Только баблы — прозрачная область, видны сообщения и поле ввода.
              </p>

              <label className="mb-1.5 mt-4 block text-[12px] text-neutral-500">
                Видимость навбара
              </label>
              <Segmented
                values={["always", "hover", "hidden"] as NavbarVisibility[]}
                value={settings.navbarVisibility ?? "always"}
                onChange={(next) => void updateSettings({ navbarVisibility: next })}
                labels={{
                  always: "Всегда",
                  hover: "По ховеру",
                  hidden: "Скрыть",
                }}
              />
              <p className="mt-1.5 text-[11px] leading-[15px] text-neutral-500">
                Всегда — navbar виден постоянно. По ховеру — появляется при движении мыши
                и скрывается через 15 секунд. Скрыть — открывается кнопкой «три точки»,
                скрывается через 35 секунд или при уходе курсора.
              </p>

              <div className="mt-4 border-t border-neutral-200 pt-3">
                <ToggleRow
                  label="Ручной режим музыки"
                  description="Включает танцевальное состояние для живой модели. Пока системный звук macOS не подключён, этот переключатель служит источником audioLevel."
                  checked={settings.manualMusic ?? false}
                  onChange={(value) => void updateSettings({ manualMusic: value })}
                />
              </div>
            </div>

            <div className="mt-3 rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
              <h3 className="mb-2.5 text-[12px] font-semibold">Параметры запуска</h3>
              <div className="space-y-3">
                <ToggleRow
                  label="Запускать при старте системы"
                  description="Регистрирует приложение в автозапуске macOS"
                  checked={settings.launchAtLogin ?? false}
                  onChange={(value) => void updateSettings({ launchAtLogin: value })}
                />
                <ToggleRow
                  label="Запускать с открытым чатом"
                  description="Сразу показывает панель чата"
                  checked={settings.startWithChat ?? false}
                  onChange={(value) => void updateSettings({ startWithChat: value })}
                />
                <ToggleRow
                  label="Запускать с 3д моделью"
                  description="То же, что запуск без ИИ: жёлтая кнопка питания"
                  checked={settings.startWithModel ?? false}
                  onChange={(value) =>
                    void updateSettings(
                      value
                        ? { startWithModel: true, startLocalModel: false }
                        : { startWithModel: false },
                    )
                  }
                />
                <ToggleRow
                  label="Запускать локальную модель при старте приложения"
                  description="Загружает GGUF локальным раннером (взаимоисключающе с «3д моделью»)"
                  checked={settings.startLocalModel ?? false}
                  onChange={(value) =>
                    void updateSettings(
                      value
                        ? { startLocalModel: true, startWithModel: false }
                        : { startLocalModel: false },
                    )
                  }
                />
              </div>
            </div>
          </section>
        )}

        {section === "model" && (
          <section>
            <h2 className="mb-3 text-[14px] font-semibold">Модель и API</h2>
            <label className="mb-1.5 block text-[12px] text-neutral-500">
              Использовать
            </label>
            <Segmented
              values={MODEL_MODES}
              value={settings.modelMode ?? "local"}
              labels={MODEL_MODE_LABELS}
              onChange={(modelMode) => updateSettings({ modelMode })}
            />

            <div
              className={`mt-4 rounded-xl border p-3 ${
                (settings.modelMode ?? "local") === "local"
                  ? "border-neutral-800/35 bg-neutral-50/60"
                  : "border-neutral-200"
              }`}
            >
              <h3 className="mb-3 text-[13px] font-semibold">Локальная модель</h3>
              <label className="mb-1 block text-[12px] text-neutral-500">Файл GGUF</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={fileName}
                  placeholder="Модель не выбрана"
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] text-neutral-700 outline-none focus:border-neutral-400"
                />
                <button
                  type="button"
                  onClick={() => void pickGguf()}
                  className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100"
                >
                  Выбрать…
                </button>
              </div>
              {settings.ggufPath && (
                <p
                  className={`mt-1.5 text-[11px] ${
                    ggufExists ? "text-emerald-600" : "text-rose-500"
                  }`}
                >
                  {ggufExists ? "Файл найден" : "Файл не найден"}
                </p>
              )}

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">
                Размер контекста
              </label>
              <select
                value={settings.contextSize}
                onChange={(event) =>
                  updateSettings({ contextSize: Number(event.target.value) })
                }
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-neutral-400"
              >
                {CONTEXT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size.toLocaleString("ru-RU")} токенов
                  </option>
                ))}
              </select>

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">
                Путь к llama-server
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={settings.runnerPath}
                  title={settings.runnerPath}
                  placeholder="Укажите бинарник llama-server"
                  className="min-w-0 flex-1 truncate rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] text-neutral-700 outline-none focus:border-neutral-400"
                />
                <button
                  type="button"
                  onClick={() => void pickRunner()}
                  className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100"
                >
                  Выбрать…
                </button>
              </div>
              {settings.runnerPath && (
                <p
                  className={`mt-1.5 text-[11px] ${
                    runnerExists ? "text-emerald-600" : "text-rose-500"
                  }`}
                >
                  {runnerExists ? "Бинарник найден" : "Бинарник не найден"}
                </p>
              )}

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">Порт</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={settings.port}
                onChange={(event) =>
                  updateSettings({ port: Number(event.target.value) || 8081 })
                }
                className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
              />

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">KV-кэш</label>
              <Segmented
                values={KV_CACHES}
                value={settings.kvCache}
                onChange={(kvCache) => updateSettings({ kvCache })}
              />

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">
                Размышления
              </label>
              <Segmented
                values={REASONINGS}
                value={settings.reasoning}
                onChange={(reasoning) => updateSettings({ reasoning })}
              />

              <div className="mt-4">
                <ToggleRow
                  label="Поддержка изображений (vision)"
                  description="Включает отправку скриншотов в локальную модель"
                  checked={settings.localVision ?? false}
                  onChange={(value) => void updateSettings({ localVision: value })}
                />
              </div>
              {settings.localVision && (
                <>
                  <label className="mb-1 mt-3 block text-[12px] text-neutral-500">
                    Файл mmproj (vision projector)
                  </label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={settings.mmprojPath ?? ""}
                      title={settings.mmprojPath ?? ""}
                      placeholder="Выберите mmproj-файл"
                      className="min-w-0 flex-1 truncate rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] text-neutral-700 outline-none focus:border-neutral-400"
                    />
                    <button
                      type="button"
                      onClick={() => void pickMmproj()}
                      className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100"
                    >
                      Выбрать…
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] leading-[14px] text-neutral-400">
                    Передаётся llama-server через --mmproj. После выбора перезагрузите модель.
                  </p>
                </>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadModel()}
                  disabled={loading || !settings.ggufPath || !runnerExists}
                  className="rounded-md border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-[12px] text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {status.status === "loaded" ? "Перезагрузить" : "Загрузить"}
                </button>
                {status.status !== "idle" && (
                  <button
                    type="button"
                    onClick={() => void unloadModel()}
                    disabled={loading}
                    className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100 disabled:opacity-50"
                  >
                    Остановить
                  </button>
                )}
              </div>
              {(status.message || status.status !== "idle") && (
                <p
                  className={`mt-2 whitespace-pre-wrap text-[11px] ${
                    status.status === "error"
                      ? "text-rose-600"
                      : status.status === "loaded"
                        ? "text-emerald-600"
                        : "text-neutral-500"
                  }`}
                >
                  {status.status === "idle" ? "Модель не загружена" : status.message}
                </p>
              )}
            </div>

            <div
              className={`mt-4 rounded-xl border p-3 ${
                (settings.modelMode ?? "local") === "api"
                  ? "border-neutral-800/35 bg-neutral-50/60"
                  : "border-neutral-200"
              }`}
            >
              <h3 className="mb-3 text-[13px] font-semibold">Подключение по API</h3>

              <label className="mb-1 block text-[12px] text-neutral-500">Пресет</label>
              <select
                value=""
                onChange={(event) => {
                  const preset = API_PRESETS.find(
                    (item) => item.label === event.target.value,
                  );
                  if (!preset) return;
                  void updateApi({ baseUrl: preset.baseUrl, model: preset.model });
                  setApiModels([]);
                  setApiNotice("");
                }}
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-neutral-400"
              >
                <option value="">Выбрать провайдера…</option>
                {API_PRESETS.map((item) => (
                  <option key={item.label} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">
                Base URL
              </label>
              <input
                value={settings.api?.baseUrl ?? ""}
                onChange={(event) => void updateApi({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
              />
              <p className="mt-1 text-[10px] leading-[14px] text-neutral-400">
                Суффикс /chat/completions добавляется автоматически.
              </p>

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">
                Модель
              </label>
              {apiModels.length > 0 && (
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) void updateApi({ model: event.target.value });
                  }}
                  className="mb-2 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-neutral-400"
                >
                  <option value="">Выбрать из списка…</option>
                  {apiModels.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={settings.api?.model ?? ""}
                onChange={(event) => void updateApi({ model: event.target.value })}
                placeholder="gpt-4o-mini"
                className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
              />

              <label className="mb-1 mt-4 block text-[12px] text-neutral-500">
                API-ключ
              </label>
              <div className="flex gap-2">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={settings.api?.apiKey ?? ""}
                  onChange={(event) => void updateApi({ apiKey: event.target.value })}
                  placeholder="sk-…"
                  className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((value) => !value)}
                  className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100"
                >
                  {showApiKey ? "Скрыть" : "Показать"}
                </button>
              </div>
              <p className="mt-1 text-[10px] leading-[14px] text-neutral-400">
                Для локальных серверов ключ можно оставить пустым. Хранится в settings.json.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    apiBusy ||
                    !settings.api?.baseUrl?.trim() ||
                    !settings.api?.model?.trim()
                  }
                  onClick={() => void runApiCheck(false)}
                  className="rounded-md border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-[12px] text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Проверить подключение
                </button>
                <button
                  type="button"
                  disabled={apiBusy || !settings.api?.baseUrl?.trim()}
                  onClick={() => void runApiCheck(true)}
                  className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Получить модели
                </button>
              </div>
              {apiNotice && (
                <p
                  className={`mt-2 text-[11px] ${
                    apiNotice.startsWith("Ошибка") ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  {apiNotice}
                </p>
              )}

              <div className="mt-4">
                <ToggleRow
                  label="Поддержка изображений (vision)"
                  description="Отправлять скриншоты в модель через API"
                  checked={settings.apiVision ?? false}
                  onChange={(value) => void updateSettings({ apiVision: value })}
                />
              </div>
            </div>
          </section>
        )}

        {section === "vrm" && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold">VRM модели</h2>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Библиотека моделей. Загружайте сколько угодно и закрепляйте за персонажами.
                </p>
              </div>
              <button
                type="button"
                onClick={() => vrmFileInputRef.current?.click()}
                className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100"
              >
                Загрузить…
              </button>
            </div>
            <input
              ref={vrmFileInputRef}
              type="file"
              accept=".vrm"
              multiple
              className="hidden"
              onChange={addVrmModels}
            />
            {modelNotice && (
              <p className="mb-2 text-[11px] text-neutral-500">{modelNotice}</p>
            )}
            {previewProgress && (
              <p className="mb-2 text-[11px] text-neutral-500">
                Готовим превью {previewProgress.done}/{previewProgress.total}…
              </p>
            )}

            <div className="grid grid-cols-3 gap-3">
              {Array.from(new Set([DEFAULT_MODEL_ID, ...customModels])).map((name) => {
                const builtin = name === DEFAULT_MODEL_ID;
                const label = builtin ? "Базовая модель" : name.replace(/\.vrm$/i, "");
                const preview = previews[name];
                const error = previewErrors[name];
                const usage = builtin
                  ? 0
                  : characters.filter((character) =>
                      characterModelIds(character).includes(name),
                    ).length;
                return (
                  <div
                    key={name}
                    className="overflow-hidden rounded-xl border border-neutral-200 bg-white/70"
                  >
                    <div className="relative aspect-[9/16] w-full overflow-hidden bg-neutral-100">
                      {preview ? (
                        <img
                          src={preview}
                          alt={label}
                          draggable={false}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-neutral-400">
                          {previewProgress ? "Рендер…" : "Нет превью"}
                        </div>
                      )}
                      {error && (
                        <button
                          type="button"
                          onClick={() => void regeneratePreview(name)}
                          className="absolute bottom-1 right-1 rounded-full bg-neutral-800/75 px-1.5 py-0.5 text-[9px] text-white hover:bg-neutral-800"
                          title={error}
                        >
                          Повторить
                        </button>
                      )}
                      {usage > 0 && (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-neutral-800/80 px-1.5 py-0.5 text-[9px] text-white">
                          {usage} перс.
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      {renamingModel === name ? (
                        <>
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void commitRename(name);
                              if (event.key === "Escape") setRenamingModel(null);
                            }}
                            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-[11px] outline-none focus:border-neutral-400"
                          />
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => void commitRename(name)}
                              className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[10px] hover:bg-neutral-100"
                            >
                              Ок
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingModel(null)}
                              className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50"
                            >
                              Отмена
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="truncate text-[11px] font-medium text-neutral-800" title={label}>
                            {label}
                          </div>
                          {!builtin && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingModel(name);
                                  setRenameDraft(label);
                                }}
                                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-50"
                              >
                                Имя
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeVrmModel(name)}
                                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50"
                              >
                                Удалить
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {customModels.length === 0 && (
              <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
                Загрузите VRM-файлы — они появятся здесь и будут доступны каждому персонажу.
              </p>
            )}
          </section>
        )}

        {section === "backgrounds" && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold">Фоны</h2>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Общая библиотека фонов. Закрепляйте их за персонажами в разделе «Персонажи».
                </p>
              </div>
              <button
                type="button"
                onClick={() => backgroundFileInputRef.current?.click()}
                className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] hover:bg-neutral-100"
              >
                Загрузить…
              </button>
            </div>
            <input
              ref={backgroundFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleBackgroundFileChange}
            />
            {backgroundNotice && (
              <p className="mb-2 text-[11px] text-neutral-500">{backgroundNotice}</p>
            )}

            <div className="grid grid-cols-3 gap-3">
              {backgrounds.map((item) => {
                const usage = Object.values(charBackgrounds).filter((state) =>
                  state.attachedIds.includes(item.id),
                ).length;
                const url = backgroundUrls[item.id];
                return (
                  <div
                    key={item.id}
                    className="overflow-hidden rounded-xl border border-neutral-200 bg-white/70"
                  >
                    <div className="relative aspect-[9/16] w-full overflow-hidden bg-neutral-100">
                      {url ? (
                        <img
                          src={url}
                          alt={item.name}
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-400">
                          Загрузка…
                        </div>
                      )}
                      {usage > 0 && (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-neutral-800/80 px-1.5 py-0.5 text-[9px] text-white">
                          {usage} перс.
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      {renamingBackground === item.id ? (
                        <>
                          <input
                            autoFocus
                            value={backgroundRenameDraft}
                            onChange={(event) => setBackgroundRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void commitBackgroundRename(item.id);
                              if (event.key === "Escape") setRenamingBackground(null);
                            }}
                            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-[11px] outline-none focus:border-neutral-400"
                          />
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => void commitBackgroundRename(item.id)}
                              className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-[10px] hover:bg-neutral-100"
                            >
                              Ок
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingBackground(null)}
                              className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-50"
                            >
                              Отмена
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            className="truncate text-[11px] font-medium text-neutral-800"
                            title={item.name}
                          >
                            {item.name || "Без имени"}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingBackground(item.id);
                                setBackgroundRenameDraft(item.name);
                              }}
                              className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-50"
                            >
                              Имя
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeBackground(item)}
                              className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50"
                            >
                              Удалить
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {backgrounds.length === 0 && (
              <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
                Загрузите изображение — оно появится здесь и будет доступно каждому персонажу.
              </p>
            )}
          </section>
        )}

        {section === "characters" && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Персонажи</h2>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">
                {characters.length}
              </span>
            </div>

            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
              {characters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(character.id);
                    setAvatarError("");
                    setChatNotice("");
                  }}
                  className={`flex w-[78px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border p-1.5 transition ${
                    selectedId === character.id
                      ? "border-neutral-800 bg-neutral-100/80"
                      : "border-neutral-200 bg-white/70 hover:border-neutral-300 hover:bg-white"
                  }`}
                  title={character.name}
                >
                  <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-neutral-100">
                    {character.avatar ? (
                      <img
                        src={character.avatar}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[24px] font-semibold text-neutral-300">
                        {character.name.slice(0, 1).toUpperCase() || "?"}
                      </span>
                    )}
                    {settings.activeCharacterId === character.id && (
                      <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 shadow-sm" />
                    )}
                  </div>
                  <span
                    className={`w-full truncate text-center text-[11px] ${
                      selectedId === character.id
                        ? "font-medium text-neutral-900"
                        : "text-neutral-600"
                    }`}
                  >
                    {character.name}
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={addCharacter}
                className="flex w-[78px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-dashed border-neutral-300 p-1.5 text-neutral-400 transition hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-neutral-50 text-[26px] font-light">
                  +
                </span>
                <span className="w-full truncate text-center text-[11px]">Добавить</span>
              </button>
            </div>

            {selected && (
              <div className="mt-1 space-y-3">
                <div className="rounded-2xl border border-neutral-200 bg-white/60 p-3">
                  <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Основное
                  </div>

                  <label className="mb-1 block text-[11px] text-neutral-500">Имя</label>
                  <input
                    value={selected.name}
                    onChange={(event) => updateCharacter({ name: event.target.value })}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
                  />

                  <label className="mb-1.5 mt-3 block text-[11px] text-neutral-500">
                    Аватарка
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100">
                      {selected.avatar ? (
                        <img
                          src={selected.avatar}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[26px] font-semibold text-neutral-300">
                          {selected.name.slice(0, 1).toUpperCase() || "?"}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <button
                        type="button"
                        onClick={() => avatarFileInputRef.current?.click()}
                        className="rounded-lg border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 text-[11px] hover:bg-neutral-100"
                      >
                        Загрузить…
                      </button>
                      {selected.avatar && (
                        <button
                          type="button"
                          onClick={() => {
                            updateCharacter({ avatar: null });
                            setAvatarError("");
                          }}
                          className="text-[10px] text-rose-600 hover:underline"
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={uploadAvatar}
                  />
                  {avatarError && (
                    <p className="mt-1 text-[10px] text-rose-600">{avatarError}</p>
                  )}

                  <label className="mt-3 flex items-center gap-2 text-[11px] text-neutral-700">
                    <input
                      type="checkbox"
                      checked={selected.realTime ?? true}
                      onChange={(event) =>
                        updateCharacter({ realTime: event.target.checked })
                      }
                      className="h-3.5 w-3.5 shrink-0 accent-neutral-800"
                    />
                    Реальное время
                  </label>
                  <p className="mt-0.5 text-[10px] leading-[14px] text-neutral-500">
                    Добавляет в промпт текущее время и время суток.
                  </p>

                  <div className="mt-3 border-t border-neutral-200 pt-3">
                    <h3 className="mb-2 text-[11px] font-semibold text-neutral-700">
                      Живая модель
                    </h3>
                    <label className="flex items-center gap-2 text-[11px] text-neutral-700">
                      <input
                        type="checkbox"
                        checked={selected.idleActivity ?? true}
                        onChange={(event) =>
                          updateCharacter({ idleActivity: event.target.checked })
                        }
                        className="h-3.5 w-3.5 shrink-0 accent-neutral-800"
                      />
                      Автономная активность в простое
                    </label>
                    <p className="mt-0.5 text-[10px] leading-[14px] text-neutral-500">
                      Дыхание, покачивание, случайный взгляд и короткие действия без чата.
                    </p>

                    <label className="mb-1 mt-2.5 block text-[10px] text-neutral-500">
                      Интенсивность
                    </label>
                    <Segmented
                      values={["low", "medium", "high"] as IdleIntensity[]}
                      value={selected.idleIntensity ?? "medium"}
                      onChange={(next) => updateCharacter({ idleIntensity: next })}
                      labels={{ low: "Тихо", medium: "Средне", high: "Активно" }}
                    />

                    <label className="mt-3 flex items-center gap-2 text-[11px] text-neutral-700">
                      <input
                        type="checkbox"
                        checked={selected.musicReactivity ?? true}
                        onChange={(event) =>
                          updateCharacter({ musicReactivity: event.target.checked })
                        }
                        className="h-3.5 w-3.5 shrink-0 accent-neutral-800"
                      />
                      Танцевать под музыку
                    </label>
                    <p className="mt-0.5 text-[10px] leading-[14px] text-neutral-500">
                      Использует ручной режим музыки из раздела «Общее» или будущий системный audioLevel.
                    </p>

                    <label className="mt-2.5 flex items-center gap-2 text-[11px] text-neutral-700">
                      <input
                        type="checkbox"
                        checked={selected.interactionResponses ?? true}
                        onChange={(event) =>
                          updateCharacter({ interactionResponses: event.target.checked })
                        }
                        className="h-3.5 w-3.5 shrink-0 accent-neutral-800"
                      />
                      Реагировать на курсор и клики
                    </label>
                    <p className="mt-0.5 text-[10px] leading-[14px] text-neutral-500">
                      Взгляд при наведении и короткая реакция при клике по модели.
                    </p>
                  </div>

                  <label className="mb-1 mt-3 block text-[11px] text-neutral-500">
                    Системный промпт
                  </label>
                  <textarea
                    value={selected.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}
                    onChange={(event) =>
                      updateCharacter({ systemPrompt: event.target.value })
                    }
                    rows={6}
                    placeholder="Общие правила речи персонажа..."
                    className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[12px] leading-[18px] outline-none focus:border-neutral-400"
                  />
                  <PromptTokenCount value={selected.systemPrompt ?? DEFAULT_SYSTEM_PROMPT} />
                  <p className="mt-1 text-[10px] leading-[14px] text-neutral-500">
                    Только живой диалог: без описаний действий, narration и AI-канцелярита.
                  </p>

                  <label className="mb-1 mt-3 block text-[11px] text-neutral-500">
                    Описание персонажа
                  </label>
                  <textarea
                    value={selected.prompt}
                    onChange={(event) => updateCharacter({ prompt: event.target.value })}
                    rows={5}
                    placeholder="Кто этот персонаж и какой у него характер..."
                    className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[12px] leading-[18px] outline-none focus:border-neutral-400"
                  />
                  <PromptTokenCount value={selected.prompt} />

                  <label className="mb-1 mt-3 block text-[11px] text-neutral-500">
                    Примеры сообщений
                  </label>
                  <textarea
                    value={selected.examples ?? ""}
                    onChange={(event) => updateCharacter({ examples: event.target.value })}
                    rows={5}
                    placeholder={`Пользователь: привет\n${selected.name}: Что у нас на сегодня?`}
                    className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[12px] leading-[18px] outline-none focus:border-neutral-400"
                  />
                  <PromptTokenCount value={selected.examples ?? ""} />
                  <p className="mt-1 text-[10px] leading-[14px] text-neutral-500">
                    По одной реплике на строку: «Пользователь: ...» или «Имя персонажа: ...».
                    Пустое поле — примеры не используются.
                  </p>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white/60 p-3">
                  <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                    Внешний вид
                  </div>

                  <label className="mb-1.5 block text-[11px] text-neutral-500">
                    VRM модели
                  </label>
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => updateCharacter({ modelId: DEFAULT_MODEL_ID })}
                      className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left text-[11px] ${
                        selected.modelId === DEFAULT_MODEL_ID
                          ? "border-neutral-400 bg-neutral-100 font-medium text-neutral-900"
                          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      <span>Базовая модель</span>
                      {selected.modelId === DEFAULT_MODEL_ID && (
                        <span className="text-[10px] text-emerald-600">Активная</span>
                      )}
                    </button>

                    {selectedModelIds.map((fileName) => (
                      <div
                        key={fileName}
                        className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-1.5"
                      >
                        <input
                          type="checkbox"
                          checked
                          aria-label={`Открепить ${fileName}`}
                          onChange={() => toggleCharacterModel(fileName)}
                          className="h-3.5 w-3.5 accent-neutral-700"
                        />
                        {previews[fileName] ? (
                          <img
                            src={previews[fileName]}
                            alt=""
                            draggable={false}
                            className="h-8 w-5 shrink-0 rounded object-contain"
                          />
                        ) : (
                          <span className="flex h-8 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[9px] text-neutral-300">
                            3D
                          </span>
                        )}
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] text-neutral-700"
                          title={fileName}
                        >
                          {fileName.replace(/\.vrm$/i, "")}
                        </span>
                        {selected.modelId === fileName ? (
                          <span className="shrink-0 text-[10px] text-emerald-600">
                            Активная
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateCharacter({ modelId: fileName })}
                            className="shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-50"
                          >
                            Выбрать
                          </button>
                        )}
                      </div>
                    ))}

                    {selectedModelIds.length === 0 && (
                      <p className="text-[10px] text-neutral-400">
                        Нет закреплённых моделей — используется базовая.
                      </p>
                    )}

                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) attachCharacterModel(event.target.value);
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-neutral-400"
                    >
                      <option value="">Прикрепить модель…</option>
                      {customModels
                        .filter((name) => !selectedModelIds.includes(name))
                        .map((name) => (
                          <option key={name} value={name}>
                            {name.replace(/\.vrm$/i, "")}
                          </option>
                        ))}
                    </select>
                  </div>

                  <label className="mb-1.5 mt-3 block text-[11px] text-neutral-500">
                    Фоны
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <div
                      className={`group relative overflow-hidden rounded-xl border ${
                        characterBackgroundState.activeId === DEFAULT_BACKGROUND_ID
                          ? "border-neutral-800 ring-2 ring-neutral-800/10"
                          : "border-neutral-200 hover:border-neutral-400"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => activateCharacterBackground(DEFAULT_BACKGROUND_ID)}
                        className="block w-full text-left"
                        title="Стандартный серый"
                      >
                        <div className="aspect-[9/16] w-full bg-[#f4f4f5]" />
                        <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/45 to-transparent px-1.5 pb-1 pt-3 text-[9px] text-white">
                          Серый
                        </div>
                        {characterBackgroundState.activeId === DEFAULT_BACKGROUND_ID && (
                          <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800/80 text-[10px] text-white">
                            ✓
                          </span>
                        )}
                      </button>
                    </div>

                    {attachedBackgrounds.map((item) => {
                      const active = characterBackgroundState.activeId === item.id;
                      const url = backgroundUrls[item.id];
                      return (
                        <div
                          key={item.id}
                          className={`group relative overflow-hidden rounded-xl border ${
                            active
                              ? "border-neutral-800 ring-2 ring-neutral-800/10"
                              : "border-neutral-200 hover:border-neutral-400"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => activateCharacterBackground(item.id)}
                            className="block w-full text-left"
                            title={item.name}
                          >
                            <div className="aspect-[9/16] w-full bg-neutral-100">
                              {url ? (
                                <img
                                  src={url}
                                  alt=""
                                  draggable={false}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[9px] text-neutral-400">
                                  …
                                </div>
                              )}
                            </div>
                            <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-3 text-[9px] text-white">
                              {item.name || "Фон"}
                            </div>
                            {active && (
                              <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-800/80 text-[10px] text-white">
                                ✓
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`Открепить фон ${item.name || item.id}`}
                            title="Открепить фон"
                            onClick={() => toggleCharacterBackground(item.id)}
                            className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-neutral-800/75 text-[11px] leading-none text-white group-hover:flex"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}

                    {attachedBackgrounds.length === 0 && (
                      <p className="col-span-3 text-[10px] text-neutral-400">
                        Нет закреплённых фонов — используется стандартный.
                      </p>
                    )}
                  </div>

                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) toggleCharacterBackground(event.target.value);
                    }}
                    className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-neutral-400"
                  >
                    <option value="">Прикрепить фон…</option>
                    {backgrounds
                      .filter(
                        (item) => !characterBackgroundState.attachedIds.includes(item.id),
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name || "Без имени"}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            {selected && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 bg-neutral-50/80 px-3 py-2">
                <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      settings.activeCharacterId === selected.id
                        ? "bg-emerald-500"
                        : "bg-neutral-300"
                    }`}
                  />
                  {settings.activeCharacterId === selected.id
                    ? "Активный персонаж"
                    : "Не активен"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSettings((current) => ({
                        ...current,
                        activeCharacterId: selected.id,
                      }));
                      void setActiveCharacter(selected.id).catch((error) =>
                        console.error("Не удалось сменить активного персонажа", error),
                      );
                    }}
                    disabled={settings.activeCharacterId === selected.id}
                    className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] hover:bg-neutral-100 disabled:opacity-50"
                  >
                    {settings.activeCharacterId === selected.id
                      ? "Активный"
                      : "Сделать активным"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearSelectedChat()}
                    className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
                  >
                    Очистить чат
                  </button>
                  <button
                    type="button"
                    onClick={deleteCharacter}
                    disabled={characters.length <= 1}
                    className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            )}

            {chatNotice && (
              <p className="mt-2 text-[11px] text-neutral-500">{chatNotice}</p>
            )}
          </section>
        )}

        {section === "persona" && (
          <section>
            <h2 className="mb-3 text-[14px] font-semibold">Персона</h2>
            <div className="rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
              <label className="mb-1.5 block text-[12px] text-neutral-500">
                Имя
              </label>
              <input
                value={settings.persona?.name ?? ""}
                onChange={(event) => void updatePersona({ name: event.target.value })}
                placeholder="User"
                className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[12px] outline-none focus:border-neutral-400"
              />
              <p className="mt-1 text-[11px] leading-[15px] text-neutral-500">
                Подставляется вместо тега <code>{'{{user}}'}</code> в промптах. Если имя
                пустое, используется <code>User</code>.
              </p>

              <label className="mb-1.5 mt-4 block text-[12px] text-neutral-500">
                Описание
              </label>
              <textarea
                value={settings.persona?.description ?? ""}
                onChange={(event) =>
                  void updatePersona({ description: event.target.value })
                }
                rows={8}
                placeholder="Например: любит кофе, работает дизайнером, не любит громкие компании"
                className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[12px] leading-[18px] outline-none focus:border-neutral-400"
              />
              <PromptTokenCount value={settings.persona?.description ?? ""} />
              <p className="mt-1 text-[11px] leading-[15px] text-neutral-500">
                Эта информация добавляется в системное сообщение всем персонажам и
                участникам беседы.
              </p>

              <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Пример подстановки
                </p>
                <p className="mt-1 text-[11px] leading-[17px] text-neutral-600">
                  <code>{'You are a good friend of {{user}}'}</code>
                  <span className="mx-2 text-neutral-400">→</span>
                  <code>{`You are a good friend of ${personaPreviewName}`}</code>
                </p>
              </div>
            </div>
          </section>
        )}

        {section === "group" && (
          <section>
            <h2 className="mb-3 text-[14px] font-semibold">Беседа</h2>
            <div className="rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
              <label className="mb-1.5 block text-[12px] text-neutral-500">
                Правила беседы
              </label>
              <textarea
                value={settings.group.rules}
                onChange={(event) => void updateGroup({ rules: event.target.value })}
                rows={4}
                placeholder="Например: говорите коротко, не отвечайте за пользователя, используйте имена друг друга"
                className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[12px] leading-[18px] outline-none focus:border-neutral-400"
              />
              <PromptTokenCount value={settings.group.rules} />
              <p className="mt-1 text-[11px] leading-[15px] text-neutral-500">
                Добавляется в общий промпт обоих персонажей.
              </p>

              <div className="mt-3 border-t border-neutral-100 pt-3">
                <label className="mb-1.5 block text-[12px] text-neutral-500">
                  Длина ответов
                </label>
                <Segmented
                  values={GROUP_LENGTHS}
                  value={settings.group.responseLength}
                  labels={GROUP_LENGTH_LABELS}
                  onChange={(responseLength) => void updateGroup({ responseLength })}
                />
              </div>

              <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
                <ToggleRow
                  label="Реакции в беседе"
                  description="Разрешить персонажам отправлять эмоции через reaction-теги"
                  checked={settings.group.reactions}
                  onChange={(value) => void updateGroup({ reactions: value })}
                />
                <ToggleRow
                  label="Примеры сообщений в беседе"
                  description="Использовать примеры обоих персонажей перед историей беседы"
                  checked={settings.group.useExamples}
                  onChange={(value) => void updateGroup({ useExamples: value })}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3">
                <label className="block">
                  <span className="mb-1 block text-[12px] text-neutral-500">
                    Глубина истории
                  </span>
                  <input
                    type="number"
                    min={4}
                    max={200}
                    value={settings.group.historyDepth}
                    onBlur={(event) =>
                      void updateGroup({
                        historyDepth: clamp(Number(event.target.value) || 24, 4, 200),
                      })
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] text-neutral-500">
                    Порог резюмирования
                  </span>
                  <input
                    type="number"
                    min={25}
                    max={200}
                    value={settings.group.summaryThreshold}
                    onBlur={(event) =>
                      void updateGroup({
                        summaryThreshold: clamp(Number(event.target.value) || 32, 25, 200),
                      })
                    }
                    className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
                  />
                </label>
              </div>
            </div>

            <h3 className="mb-2 mt-5 text-[13px] font-semibold">История бесед</h3>
            <div className="overflow-hidden rounded-xl border border-neutral-200">
              {groupChats.length ? (
                <div className="divide-y divide-neutral-100">
                  {groupChats.map((item) => {
                    const ids = item.key.slice("group:".length).split(":");
                    const names = ids.map(
                      (id) =>
                        characters.find((character) => character.id === id)?.name ??
                        "Удалённый персонаж",
                    );
                    const date = item.lastAt
                      ? new Date(item.lastAt).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—";
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px]">{names.join(" + ")}</p>
                          <p className="text-[10px] text-neutral-500">
                            {item.messageCount} сообщ. · {date}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteGroupChat(item.key)}
                          className="shrink-0 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] text-rose-600 hover:bg-rose-50"
                        >
                          Удалить
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 py-3 text-[11px] text-neutral-500">
                  Сохранённых бесед пока нет.
                </p>
              )}
            </div>
            {groupNotice && (
              <p className="mt-2 text-[11px] text-neutral-500">{groupNotice}</p>
            )}
          </section>
        )}

        {section === "speech" && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Речь</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  localEngine
                    ? speechRuntime?.available && isLocalSpeechSupported()
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                    : getSpeechRecognitionConstructor()
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                }`}
              >
                {localEngine
                  ? speechRuntime?.available && isLocalSpeechSupported()
                    ? "Parakeet готов"
                    : "Parakeet недоступен"
                  : getSpeechRecognitionConstructor()
                    ? "Web Speech доступен"
                    : "Web Speech недоступен"}
              </span>
            </div>

            <div className="rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
              <ToggleRow
                label="Микрофон"
                description="Разрешить кнопку микрофона в главном окне"
                checked={settings.speech.enabled}
                onChange={(value) => void updateSpeech({ enabled: value })}
              />
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <label className="mb-1.5 block text-[12px] text-neutral-500">Движок</label>
                <Segmented
                  values={SPEECH_ENGINES.map((item) => item.value)}
                  value={settings.speech.engine}
                  onChange={(value) => void selectEngine(value)}
                />
                <div className="mt-2 text-[11px] leading-[16px] text-neutral-500">
                  {localEngine
                    ? "Распознавание выполняется локально через встроенный CrispASR."
                    : "Web Speech может использовать сервисы Apple и требует доступ к сети."}
                </div>
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <label className="mb-1.5 block text-[12px] text-neutral-500">Язык распознавания</label>
                <select
                  value={settings.speech.language}
                  onChange={(event) => void updateSpeech({ language: event.target.value })}
                  className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-neutral-400"
                >
                  {visibleLanguages.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {localEngine && (
                  <p className="mt-1.5 text-[11px] leading-[15px] text-amber-700">
                    Parakeet-redux не поддерживает русский и японский. Для этих языков остаётся
                    Web Speech.
                  </p>
                )}
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <ToggleRow
                  label="Непрерывное распознавание"
                  description="Не останавливаться после первой фразы"
                  checked={settings.speech.continuous}
                  onChange={(value) => void updateSpeech({ continuous: value })}
                />
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <ToggleRow
                  label="Отправлять сразу"
                  description="Включено — текст уходит в чат; выключено — попадает в поле ввода"
                  checked={settings.speech.autoSend}
                  onChange={(value) => void updateSpeech({ autoSend: value })}
                />
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <ToggleRow
                  label="Автоповтор"
                  description="Повторять распознавание после паузы или ошибки"
                  checked={settings.speech.autoRestart}
                  onChange={(value) => void updateSpeech({ autoRestart: value })}
                />
              </div>
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <ToggleRow
                  label="Статус на модели"
                  description="Показывать состояние микрофона в области персонажа"
                  checked={settings.speech.showStatus}
                  onChange={(value) => void updateSpeech({ showStatus: value })}
                />
              </div>
            </div>

            {localEngine && (
              <div className="mt-3 rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[12px] font-medium">Локальная модель</div>
                  <div className="text-[11px] text-neutral-500">
                    {(speechRuntime?.version ?? "—")}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {SPEECH_QUANTS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => void selectQuant(item.value)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] ${
                        settings.speech.localQuant === item.value
                          ? "border-neutral-800 bg-neutral-800 text-white"
                          : "border-neutral-300 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
                      }`}
                    >
                      {item.label} · {item.size}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-[16px] text-neutral-500">
                  {speechModel?.exists
                    ? speechModel.valid
                      ? `Файл найден: ${speechModel.fileName}`
                      : `Размер файла не совпадает: ${speechModel.size} / ${speechModel.expectedSize}`
                    : "Модель ещё не скачана"}
                </p>
                {speechDownload && !speechDownload.done && (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-neutral-800 transition-[width] duration-200"
                        style={{ width: `${speechDownload.percent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {speechDownload.percent}% · {Math.round(speechDownload.loaded / 1024 / 1024)} /{" "}
                      {Math.round(speechDownload.total / 1024 / 1024)} МБ
                    </p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!!speechDownload && !speechDownload.done}
                    onClick={() => void downloadModel()}
                    className="rounded-full bg-neutral-800/85 px-3.5 py-1.5 text-[12px] text-white transition hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Скачать модель
                  </button>
                  {speechDownload && !speechDownload.done && (
                    <button
                      type="button"
                      onClick={() => void cancelSpeechDownload()}
                      className="rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
                    >
                      Отменить
                    </button>
                  )}
                  {speechModel?.exists && (
                    <button
                      type="button"
                      onClick={() => void removeModel()}
                      className="rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            )}

            {localEngine && (
              <div className="mt-3 rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[12px] font-medium">Локальный STT-сервер</div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      sttState.status === "loaded"
                        ? "bg-emerald-50 text-emerald-700"
                        : sttState.status === "error"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {sttState.status}
                  </span>
                </div>
                <p className="mb-3 text-[11px] leading-[16px] text-neutral-500">
                  {sttState.message || "Сервер запускается при первом нажатии микрофона."}
                </p>
                <label className="mb-3 flex items-center gap-2 text-[11px] text-neutral-500">
                  Порт
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={settings.speech.sttPort}
                    onChange={(event) =>
                      void updateSpeech({
                        sttPort: clamp(Number(event.target.value) || 8082, 1024, 65535),
                      })
                    }
                    className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-[12px] text-neutral-800 outline-none focus:border-neutral-400"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={sttBusy}
                    onClick={() => void startStt()}
                    className="rounded-full bg-neutral-800/85 px-3.5 py-1.5 text-[12px] text-white transition hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Запустить
                  </button>
                  <button
                    type="button"
                    disabled={sttBusy}
                    onClick={() => void stopStt()}
                    className="rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    Остановить
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 rounded-[16px] border border-neutral-200 bg-white/70 p-3.5">
              <div className="mb-2 text-[12px] font-medium">Проверка микрофона</div>
              <p className="mb-3 text-[11px] leading-[16px] text-neutral-500">
                Распознанный текст появится здесь и не будет отправлен в чат.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={speechTestState === "listening" ? stopSpeechTest : () => void startSpeechTest()}
                  className="rounded-full bg-neutral-800/85 px-3.5 py-1.5 text-[12px] text-white transition hover:bg-neutral-800"
                >
                  {speechTestState === "listening" ? "Остановить" : "Проверить"}
                </button>
                {speechTestText && (
                  <button
                    type="button"
                    onClick={() => {
                      speechTestTextRef.current = "";
                      setSpeechTestText("");
                    }}
                    className="rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-50"
                  >
                    Очистить
                  </button>
                )}
              </div>
              {speechTestText && (
                <p className="mt-2 rounded-lg bg-neutral-50 px-2.5 py-2 text-[12px] text-neutral-800">
                  {speechTestText}
                </p>
              )}
              {speechTestError && (
                <p className="mt-2 text-[11px] text-rose-600">{speechTestError}</p>
              )}
            </div>

            {speechNotice && (
              <p className="mt-3 text-[11px] leading-[16px] text-neutral-500">{speechNotice}</p>
            )}
            {!localEngine && (
              <p className="mt-3 text-[11px] leading-[16px] text-neutral-500">
                Web Speech через WebView macOS может использовать сервисы Apple. Если доступа
                нет, проверьте Системные настройки → Конфиденциальность и безопасность →
                Микрофон и Распознавание речи.
              </p>
            )}
          </section>
        )}

        {section === "credits" && (
          <section>
            <h2 className="mb-3 text-[14px] font-semibold">Благодарности</h2>
            <div className="space-y-1 text-[11px] leading-[17px] text-neutral-500">
              <p>Character animation credits to pixiv Inc.&apos;s VRoid Project</p>
              <p>キャラクターアニメーション: ピクシブ株式会社 VRoidプロジェクト</p>
              <p>
                Idle: pixiv/ChatVRM (MIT). Дополнительные анимации: tk256ailab/vrm-viewer
                (MIT).
              </p>
              <p>
                Локальное распознавание речи: CrispASR (MIT), ggml и Silero — по лицензиям
                проекта.
              </p>
              <p>Модель parakeet-redux-GGUF: cstr, CC BY 4.0.</p>
            </div>
          </section>
        )}
      </main>

      {backgroundCropSource && (
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
              style={{ width: AVATAR_CROP_W, height: AVATAR_CROP_H }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                backgroundCropDragRef.current = {
                  x: event.clientX - backgroundCropPos.x,
                  y: event.clientY - backgroundCropPos.y,
                };
              }}
              onPointerMove={(event) => {
                if (!backgroundCropDragRef.current) return;
                setBackgroundCropPos(
                  clampBackgroundCropPos(backgroundCropZoom, {
                    x: event.clientX - backgroundCropDragRef.current.x,
                    y: event.clientY - backgroundCropDragRef.current.y,
                  }),
                );
              }}
              onPointerUp={() => {
                backgroundCropDragRef.current = null;
              }}
              onPointerCancel={() => {
                backgroundCropDragRef.current = null;
              }}
            >
              <img
                src={backgroundCropSource}
                alt=""
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{
                  left: (AVATAR_CROP_W - backgroundCropDisplayW) / 2 + backgroundCropPos.x,
                  top: (AVATAR_CROP_H - backgroundCropDisplayH) / 2 + backgroundCropPos.y,
                  width: backgroundCropDisplayW,
                  height: backgroundCropDisplayH,
                  maxWidth: "none",
                  maxHeight: "none",
                }}
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] text-neutral-500">Масштаб</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={backgroundCropZoom}
                onChange={(event) => {
                  const zoom = Number(event.target.value);
                  setBackgroundCropZoom(zoom);
                  setBackgroundCropPos((pos) => clampBackgroundCropPos(zoom, pos));
                }}
                className="h-1 flex-1 accent-neutral-800"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setBackgroundCropSource(null)}
                className="flex-1 rounded-full bg-white/70 px-3 py-2 text-[12px] text-neutral-600 transition hover:bg-white"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={applyBackgroundCrop}
                disabled={!backgroundCropSize}
                className="flex-1 rounded-full bg-neutral-800/85 px-3 py-2 text-[12px] text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                Применить
              </button>
            </div>
          </div>
        </div>
      )}

      {avatarCropSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="rounded-[24px] bg-[#f7f7f8]/95 p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-neutral-800">
                Обрезка аватарки
              </span>
              <span className="text-[11px] text-neutral-500">9:16</span>
            </div>

            <div
              className="relative cursor-grab touch-none overflow-hidden rounded-[18px] bg-neutral-200 active:cursor-grabbing"
              style={{ width: AVATAR_CROP_W, height: AVATAR_CROP_H }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                avatarDragRef.current = {
                  x: event.clientX - avatarCropPos.x,
                  y: event.clientY - avatarCropPos.y,
                };
              }}
              onPointerMove={(event) => {
                if (!avatarDragRef.current) return;
                setAvatarCropPos(
                  clampAvatarPos(avatarCropZoom, {
                    x: event.clientX - avatarDragRef.current.x,
                    y: event.clientY - avatarDragRef.current.y,
                  }),
                );
              }}
              onPointerUp={() => {
                avatarDragRef.current = null;
              }}
              onPointerCancel={() => {
                avatarDragRef.current = null;
              }}
            >
              <img
                src={avatarCropSource}
                alt=""
                draggable={false}
                className="pointer-events-none absolute select-none"
                style={{
                  left: (AVATAR_CROP_W - avatarDisplayW) / 2 + avatarCropPos.x,
                  top: (AVATAR_CROP_H - avatarDisplayH) / 2 + avatarCropPos.y,
                  width: avatarDisplayW,
                  height: avatarDisplayH,
                  maxWidth: "none",
                  maxHeight: "none",
                }}
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] text-neutral-500">Масштаб</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={avatarCropZoom}
                onChange={(event) => {
                  const zoom = Number(event.target.value);
                  setAvatarCropZoom(zoom);
                  setAvatarCropPos((pos) => clampAvatarPos(zoom, pos));
                }}
                className="h-1 flex-1 accent-neutral-800"
              />
            </div>

            {avatarError && (
              <p className="mt-2 text-[11px] text-rose-600">{avatarError}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAvatarCropSource(null);
                  setAvatarError("");
                }}
                className="flex-1 rounded-full bg-white/70 px-3 py-2 text-[12px] text-neutral-600 transition hover:bg-white"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={applyAvatarCrop}
                disabled={!avatarCropSize}
                className="flex-1 rounded-full bg-neutral-800/85 px-3 py-2 text-[12px] text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                Применить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
