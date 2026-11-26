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
import { applyTheme, isTheme, listenThemeChanges, writeTheme } from "./theme";
import {
  startSystemAudio,
  stopSystemAudio,
  systemAudioStatus,
  type SystemAudioStatus,
} from "./systemAudio";
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
  type Theme,
} from "./store";
import {
  NAVBAR_BUTTONS,
  isNavbarButtonVisible,
  isLockedNavbarButton,
  normalizeHiddenNavbarButtons,
  type NavbarButtonId,
} from "./navbarButtons";
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

const SECTIONS: Array<{ id: SectionId; label: string; description: string }> = [
  {
    id: "general",
    label: "Общее",
    description: "Внешний вид, запуск и поведение приложения.",
  },
  {
    id: "model",
    label: "Модель",
    description: "Локальная модель и подключение к API.",
  },
  {
    id: "vrm",
    label: "VRM модели",
    description: "Библиотека моделей. Загружайте сколько угодно и закрепляйте за персонажами.",
  },
  {
    id: "backgrounds",
    label: "Фоны",
    description:
      "Общая библиотека фонов. Закрепляйте их за персонажами в разделе «Персонажи».",
  },
  {
    id: "characters",
    label: "Персонажи",
    description: "Профили, модели, фоны и промпты.",
  },
  {
    id: "persona",
    label: "Персона",
    description: "Как приложение обращается к вам в диалоге.",
  },
  {
    id: "group",
    label: "Беседа",
    description: "Правила совместного диалога двух персонажей.",
  },
  {
    id: "speech",
    label: "Речь",
    description: "Микрофон, движки распознавания и проверка.",
  },
  {
    id: "credits",
    label: "Благодарности",
    description: "Проекты и лицензии, используемые в приложении.",
  },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="settings-label">{children}</span>;
}

function Helper({
  children,
  tone = "muted",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warning" | "error" | "success";
  className?: string;
}) {
  return <p className={`settings-help is-${tone} ${className}`}>{children}</p>;
}

function Card({
  title,
  description,
  action,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`settings-card ${className}`}>
      {(title || action) && (
        <div className="settings-card-head">
          <div className="min-w-0">
            {title && <h3 className="settings-card-title">{title}</h3>}
            {description && <p className="settings-card-description">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={`settings-card-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

function Button({
  variant = "secondary",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button type="button" {...props} className={`settings-button is-${variant} ${className}`}>
      {children}
    </button>
  );
}

function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  small = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`settings-switch${checked ? " is-on" : ""}${small ? " is-small" : ""}`}
    >
      <span className="settings-switch-knob" />
    </button>
  );
}

function SwitchTrack({
  checked,
  small = false,
}: {
  checked: boolean;
  small?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`settings-switch${checked ? " is-on" : ""}${small ? " is-small" : ""}`}
    >
      <span className="settings-switch-knob" />
    </span>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="settings-toggle-row"
    >
      <span className="min-w-0 block">
        <span className="settings-toggle-label">{label}</span>
        <span className="settings-help is-muted">{description}</span>
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}

function InlineToggle({
  label,
  checked,
  onChange,
  disabled = false,
  note,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="settings-inline-toggle"
    >
      <SwitchTrack checked={checked} small />
      <span>{label}</span>
      {note && <span className="settings-note">{note}</span>}
    </button>
  );
}

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
    <div className="settings-segmented" role="group">
      {values.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={value === item}
          onClick={() => onChange(item)}
          className={`settings-segment${value === item ? " is-active" : ""}`}
        >
          {labels?.[item] ?? item}
        </button>
      ))}
    </div>
  );
}

type NoticeTone = "neutral" | "warning" | "error" | "success";

function Notice({
  tone = "neutral",
  children,
}: {
  tone?: NoticeTone;
  children: React.ReactNode;
}) {
  return <div className={`settings-notice is-${tone}`}>{children}</div>;
}

function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: NoticeTone;
  children: React.ReactNode;
}) {
  return <span className={`settings-chip is-${tone}`}>{children}</span>;
}

function SectionHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
}) {
  return (
    <header className="settings-topbar">
      <div className="settings-topbar-inner">
        <div className="min-w-0">
          <h2 className="settings-section-title">{title}</h2>
          <p className="settings-section-subtitle">{description}</p>
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
    </header>
  );
}

const DIALOG_FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function useDialogFocus(
  active: boolean,
  onCancel: () => void,
): React.RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE) ?? [],
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);

    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (!dialogRef.current?.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [active]);

  return dialogRef;
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
  const [systemAudioState, setSystemAudioState] = useState<SystemAudioStatus | null>(null);
  const systemAudioChunksRef = useRef(0);
  const systemAudioChunkAtRef = useRef(Date.now());
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
  const backgroundCropDialogRef = useDialogFocus(Boolean(backgroundCropSource), () => {
    setBackgroundCropSource(null);
  });
  const avatarCropDialogRef = useDialogFocus(Boolean(avatarCropSource), () => {
    setAvatarCropSource(null);
    setAvatarError("");
  });
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
      .then((value) => {
        setSettings(value);
        applyTheme(isTheme(value.theme) ? value.theme : "light");
      })
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

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void listenThemeChanges((theme) => {
      if (active) setSettings((current) => ({ ...current, theme }));
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
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

  useEffect(() => {
    if (!settings.systemAudioDance) return;
    let active = true;
    const refresh = () => {
      void systemAudioStatus()
        .then((next) => {
          if (!active) return;
          if (next.chunks !== systemAudioChunksRef.current) {
            systemAudioChunksRef.current = next.chunks;
            systemAudioChunkAtRef.current = Date.now();
          }
          setSystemAudioState(next);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [settings.systemAudioDance]);

  const toggleNavbarButton = (id: NavbarButtonId, visible: boolean) => {
    if (isLockedNavbarButton(id)) return;
    const hidden = normalizeHiddenNavbarButtons(settings.hiddenNavbarButtons);
    updateSettings({
      hiddenNavbarButtons: visible
        ? hidden.filter((item) => item !== id)
        : normalizeHiddenNavbarButtons([...hidden, id]),
    });
  };

  const toggleSystemAudioDance = async (enabled: boolean) => {
    updateSettings({ systemAudioDance: enabled });
    try {
      setSystemAudioState(null);
      systemAudioChunksRef.current = 0;
      systemAudioChunkAtRef.current = Date.now();
      if (enabled) await startSystemAudio();
      else await stopSystemAudio();
      setSystemAudioState(await systemAudioStatus());
    } catch (error) {
      setSystemAudioState({
        running: false,
        error: error instanceof Error ? error.message : String(error),
        chunks: 0,
        sampleRate: 24000,
      });
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
      ctx.fillStyle = "#f2f2f7";
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

  const activeSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const sectionBadge =
    section === "characters" ? (
      <StatusChip>{characters.length}</StatusChip>
    ) : section === "speech" ? (
      <StatusChip
        tone={
          localEngine
            ? speechRuntime?.available && isLocalSpeechSupported()
              ? "success"
              : "error"
            : getSpeechRecognitionConstructor()
              ? "success"
              : "error"
        }
      >
        {localEngine
          ? speechRuntime?.available && isLocalSpeechSupported()
            ? "Parakeet готов"
            : "Parakeet недоступен"
          : getSpeechRecognitionConstructor()
            ? "Web Speech доступен"
            : "Web Speech недоступен"}
      </StatusChip>
    ) : null;

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <span className="settings-brand-mark" aria-hidden="true" />
          <h1 className="settings-brand-title">Настройки</h1>
        </div>

        <nav className="settings-nav" aria-label="Разделы настроек">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => setSection(item.id)}
              className={`settings-nav-item${section === item.id ? " is-active" : ""}`}
            >
              <span className="settings-nav-dot" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-sidebar-footer">
          <Button
            variant="ghost"
            className="settings-data-button"
            title="Открыть папку с данными приложения"
            onClick={() => {
              setDataDirError("");
              void openDataDir().catch(() =>
                setDataDirError("Не удалось открыть папку"),
              );
            }}
          >
            Папка данных
          </Button>
          {dataDirError && <p className="settings-error-text">{dataDirError}</p>}
          <span className="settings-version">
            {appVersion ? `Версия ${appVersion}` : "Версия …"}
          </span>
        </div>
      </aside>

      <main className="settings-main settings-scroll">
        <SectionHeader
          title={section === "model" ? "Модель и API" : activeSection.label}
          description={activeSection.description}
          badge={sectionBadge}
        />

        <div className="settings-content">
          {section === "general" && (
            <div className="settings-stack">
              {IS_PRERELEASE && (
                <Card
                  title="Обновления"
                  description={`Текущая версия: ${appVersion || "…"}`}
                  action={
                    <Button
                      variant="secondary"
                      disabled={updateBusy}
                      onClick={() => void manualUpdateCheck()}
                    >
                      Проверить
                    </Button>
                  }
                >
                  {updateInfo ? (
                    <Notice tone="error">
                      <p className="settings-notice-title">
                        Доступна версия {updateInfo.version}
                      </p>
                      {updateInfo.notes && (
                        <p className="settings-notice-text">{updateInfo.notes}</p>
                      )}
                    </Notice>
                  ) : (
                    <Helper>У вас актуальная версия.</Helper>
                  )}
                  <div className="settings-actions mt-3">
                    <Button
                      variant="danger"
                      disabled={updateBusy || !updateInfo}
                      onClick={() => void installUpdate()}
                    >
                      Скачать и установить
                    </Button>
                  </div>
                  {updateNotice && <div className="mt-3"><Notice>{updateNotice}</Notice></div>}
                </Card>
              )}

              <Card title="Внешний вид" description="Чат, навбар и поведение модели.">
                <FieldLabel>Тема</FieldLabel>
                <Segmented
                  values={["light", "dark"] as Theme[]}
                  value={settings.theme ?? "light"}
                  onChange={(next) => {
                    setSettings((current) => ({ ...current, theme: next }));
                    void writeTheme(next).catch((error) =>
                      console.error("Не удалось сохранить тему", error),
                    );
                  }}
                  labels={{ light: "Светлая", dark: "Тёмная" }}
                />
                <Helper className="mt-2">
                  Светлая тема используется по умолчанию. Выбор применяется ко всем окнам.
                </Helper>

                <div className="settings-divider" />

                <FieldLabel>Внешний вид чата</FieldLabel>
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
                <Helper className="mt-2">
                  Дефолт — белая карточка чата. Стекло — полупрозрачная карточка с размытием.
                  Только баблы — прозрачная область, видны сообщения и поле ввода.
                </Helper>

                <div className="settings-divider" />

                <FieldLabel>Видимость навбара</FieldLabel>
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
                <Helper className="mt-2">
                  Всегда — navbar виден постоянно. По ховеру — появляется при движении мыши
                  и скрывается через 15 секунд. Скрыть — открывается кнопкой «три точки»,
                  скрывается через 35 секунд или при уходе курсора.
                </Helper>

                <div className="settings-divider" />

                <FieldLabel>Кнопки навбара</FieldLabel>
                <div className="settings-toggle-grid mt-2">
                  {NAVBAR_BUTTONS.map((button) => {
                    const locked = isLockedNavbarButton(button.id);
                    const checked = isNavbarButtonVisible(
                      button.id,
                      settings.hiddenNavbarButtons ?? [],
                    );
                    return (
                      <InlineToggle
                        key={button.id}
                        label={button.label}
                        checked={checked}
                        disabled={locked}
                        note={locked ? "всегда" : undefined}
                        onChange={(value) => toggleNavbarButton(button.id, value)}
                      />
                    );
                  })}
                </div>
                <Helper className="mt-2">
                  Чат, настройки и питание модели остаются доступными всегда.
                </Helper>

                <div className="settings-divider" />

                <div className="settings-toggle-list">
                  <div>
                    <ToggleRow
                      label="Танцевать по системному звуку"
                      description="Слушает звук других приложений через macOS и включает танец только при устойчивом ритме. Видео не записывается."
                      checked={settings.systemAudioDance ?? false}
                      onChange={(value) => void toggleSystemAudioDance(value)}
                    />
                    {settings.systemAudioDance && (
                      <Notice
                        tone={
                          systemAudioState?.error ||
                          (systemAudioState?.running &&
                            Date.now() - systemAudioChunkAtRef.current > 8000)
                            ? "error"
                            : "neutral"
                        }
                      >
                        {systemAudioState?.error
                          ? `Ошибка: ${systemAudioState.error}. Возможно, нужно разрешить «Запись экрана» в настройках macOS и перезапустить приложение.`
                          : systemAudioState?.running &&
                              Date.now() - systemAudioChunkAtRef.current > 8000
                            ? "Подключено, но звук не поступает. Проверьте разрешение «Запись экрана и системного звука» в настройках macOS."
                            : systemAudioState?.running
                              ? `Слушает системный звук (чанков: ${systemAudioState.chunks}).`
                              : "Подключение к системному звуку…"}
                      </Notice>
                    )}
                  </div>
                  <ToggleRow
                    label="Ручной режим музыки"
                    description="Принудительно включает танцевальное состояние для живой модели. Полезно для проверки анимации."
                    checked={settings.manualMusic ?? false}
                    onChange={(value) => void updateSettings({ manualMusic: value })}
                  />
                </div>
              </Card>

              <Card title="Параметры запуска" description="Что происходит при старте приложения.">
                <div className="settings-toggle-list">
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
              </Card>
            </div>
          )}

          {section === "model" && (
            <div className="settings-stack">
              <Card title="Использовать" description="Выберите источник ответов.">
                <Segmented
                  values={MODEL_MODES}
                  value={settings.modelMode ?? "local"}
                  labels={MODEL_MODE_LABELS}
                  onChange={(modelMode) => updateSettings({ modelMode })}
                />
              </Card>

              <Card
                title="Локальная модель"
                description="Файлы, раннер и параметры генерации."
                className={(settings.modelMode ?? "local") === "local" ? "is-current" : ""}
              >
                <FieldLabel>Файл GGUF</FieldLabel>
                <div className="settings-field-row">
                  <input
                    readOnly
                    value={fileName}
                    placeholder="Модель не выбрана"
                    className="settings-input"
                  />
                  <Button onClick={() => void pickGguf()}>Выбрать…</Button>
                </div>
                {settings.ggufPath && (
                  <Helper tone={ggufExists ? "success" : "error"}>
                    {ggufExists ? "Файл найден" : "Файл не найден"}
                  </Helper>
                )}

                <div className="settings-divider" />

                <FieldLabel>Размер контекста</FieldLabel>
                <select
                  value={settings.contextSize}
                  onChange={(event) =>
                    updateSettings({ contextSize: Number(event.target.value) })
                  }
                  className="settings-select"
                >
                  {CONTEXT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size.toLocaleString("ru-RU")} токенов
                    </option>
                  ))}
                </select>

                <div className="settings-divider" />

                <FieldLabel>Путь к llama-server</FieldLabel>
                <div className="settings-field-row">
                  <input
                    readOnly
                    value={settings.runnerPath}
                    title={settings.runnerPath}
                    placeholder="Укажите бинарник llama-server"
                    className="settings-input"
                  />
                  <Button onClick={() => void pickRunner()}>Выбрать…</Button>
                </div>
                {settings.runnerPath && (
                  <Helper tone={runnerExists ? "success" : "error"}>
                    {runnerExists ? "Бинарник найден" : "Бинарник не найден"}
                  </Helper>
                )}

                <div className="settings-divider" />

                <FieldLabel>Порт</FieldLabel>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={settings.port}
                  onChange={(event) =>
                    updateSettings({ port: Number(event.target.value) || 8081 })
                  }
                  className="settings-input"
                />

                <div className="settings-divider" />

                <FieldLabel>KV-кэш</FieldLabel>
                <Segmented
                  values={KV_CACHES}
                  value={settings.kvCache}
                  onChange={(kvCache) => updateSettings({ kvCache })}
                />

                <div className="settings-divider" />

                <FieldLabel>Размышления</FieldLabel>
                <Segmented
                  values={REASONINGS}
                  value={settings.reasoning}
                  onChange={(reasoning) => updateSettings({ reasoning })}
                />

                <div className="settings-divider" />

                <ToggleRow
                  label="Поддержка изображений (vision)"
                  description="Включает отправку скриншотов в локальную модель"
                  checked={settings.localVision ?? false}
                  onChange={(value) => void updateSettings({ localVision: value })}
                />
                {settings.localVision && (
                  <div className="mt-3">
                    <FieldLabel>Файл mmproj (vision projector)</FieldLabel>
                    <div className="settings-field-row">
                      <input
                        readOnly
                        value={settings.mmprojPath ?? ""}
                        title={settings.mmprojPath ?? ""}
                        placeholder="Выберите mmproj-файл"
                        className="settings-input"
                      />
                      <Button onClick={() => void pickMmproj()}>Выбрать…</Button>
                    </div>
                    <Helper className="mt-1">
                      Передаётся llama-server через --mmproj. После выбора перезагрузите модель.
                    </Helper>
                  </div>
                )}

                <div className="settings-actions mt-4">
                  <Button
                    variant="primary"
                    disabled={loading || !settings.ggufPath || !runnerExists}
                    onClick={() => void loadModel()}
                  >
                    {status.status === "loaded" ? "Перезагрузить" : "Загрузить"}
                  </Button>
                  {status.status !== "idle" && (
                    <Button disabled={loading} onClick={() => void unloadModel()}>
                      Остановить
                    </Button>
                  )}
                </div>
                {(status.message || status.status !== "idle") && (
                  <Notice
                    tone={
                      status.status === "error"
                        ? "error"
                        : status.status === "loaded"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {status.status === "idle" ? "Модель не загружена" : status.message}
                  </Notice>
                )}
              </Card>

              <Card
                title="Подключение по API"
                description="Провайдер, ключ и проверка соединения."
                className={(settings.modelMode ?? "local") === "api" ? "is-current" : ""}
              >
                <FieldLabel>Пресет</FieldLabel>
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
                  className="settings-select"
                >
                  <option value="">Выбрать провайдера…</option>
                  {API_PRESETS.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <div className="settings-divider" />

                <FieldLabel>Base URL</FieldLabel>
                <input
                  value={settings.api?.baseUrl ?? ""}
                  onChange={(event) => void updateApi({ baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="settings-input"
                />
                <Helper className="mt-1">
                  Суффикс /chat/completions добавляется автоматически.
                </Helper>

                <div className="settings-divider" />

                <FieldLabel>Модель</FieldLabel>
                {apiModels.length > 0 && (
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) void updateApi({ model: event.target.value });
                    }}
                    className="settings-select mb-2"
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
                  className="settings-input"
                />

                <div className="settings-divider" />

                <FieldLabel>API-ключ</FieldLabel>
                <div className="settings-field-row">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={settings.api?.apiKey ?? ""}
                    onChange={(event) => void updateApi({ apiKey: event.target.value })}
                    placeholder="sk-…"
                    className="settings-input"
                  />
                  <Button onClick={() => setShowApiKey((value) => !value)}>
                    {showApiKey ? "Скрыть" : "Показать"}
                  </Button>
                </div>
                <Helper className="mt-1">
                  Для локальных серверов ключ можно оставить пустым. Хранится в settings.json.
                </Helper>

                <div className="settings-actions mt-4">
                  <Button
                    variant="primary"
                    disabled={
                      apiBusy ||
                      !settings.api?.baseUrl?.trim() ||
                      !settings.api?.model?.trim()
                    }
                    onClick={() => void runApiCheck(false)}
                  >
                    Проверить подключение
                  </Button>
                  <Button
                    disabled={apiBusy || !settings.api?.baseUrl?.trim()}
                    onClick={() => void runApiCheck(true)}
                  >
                    Получить модели
                  </Button>
                </div>
                {apiNotice && (
                  <Notice tone={apiNotice.startsWith("Ошибка") ? "error" : "success"}>
                    {apiNotice}
                  </Notice>
                )}

                <div className="settings-divider" />

                <ToggleRow
                  label="Поддержка изображений (vision)"
                  description="Отправлять скриншоты в модель через API"
                  checked={settings.apiVision ?? false}
                  onChange={(value) => void updateSettings({ apiVision: value })}
                />
              </Card>
            </div>
          )}

          {section === "vrm" && (
            <div className="settings-stack">
              <Card
                title="Библиотека моделей"
                action={<Button onClick={() => vrmFileInputRef.current?.click()}>Загрузить…</Button>}
              >
                <input
                  ref={vrmFileInputRef}
                  type="file"
                  accept=".vrm"
                  multiple
                  className="hidden"
                  onChange={addVrmModels}
                />
                {modelNotice && <Notice>{modelNotice}</Notice>}
                {previewProgress && (
                  <Helper>Готовим превью {previewProgress.done}/{previewProgress.total}…</Helper>
                )}

                <div className="settings-media-grid">
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
                      <div className="settings-media-card" key={name}>
                        <div className="settings-media-preview">
                          {preview ? (
                            <img
                              src={preview}
                              alt={label}
                              draggable={false}
                              className="settings-media-image is-contain"
                            />
                          ) : (
                            <div className="settings-media-placeholder">
                              {previewProgress ? "Рендер…" : "Нет превью"}
                            </div>
                          )}
                          {error && (
                            <button
                              type="button"
                              onClick={() => void regeneratePreview(name)}
                              className="settings-media-badge is-action"
                              title={error}
                            >
                              Повторить
                            </button>
                          )}
                          {usage > 0 && (
                            <span className="settings-media-badge">{usage} перс.</span>
                          )}
                        </div>
                        <div className="settings-media-footer">
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
                                className="settings-input is-compact"
                              />
                              <div className="settings-mini-actions">
                                <Button
                                  variant="secondary"
                                  onClick={() => void commitRename(name)}
                                >
                                  Ок
                                </Button>
                                <Button variant="ghost" onClick={() => setRenamingModel(null)}>
                                  Отмена
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="settings-media-name" title={label}>
                                {label}
                              </div>
                              {!builtin && (
                                <div className="settings-mini-actions">
                                  <Button
                                    variant="ghost"
                                    onClick={() => {
                                      setRenamingModel(name);
                                      setRenameDraft(label);
                                    }}
                                  >
                                    Имя
                                  </Button>
                                  <Button
                                    variant="danger"
                                    onClick={() => void removeVrmModel(name)}
                                  >
                                    Удалить
                                  </Button>
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
                  <Notice>
                    Загрузите VRM-файлы — они появятся здесь и будут доступны каждому персонажу.
                  </Notice>
                )}
              </Card>
            </div>
          )}

          {section === "backgrounds" && (
            <div className="settings-stack">
              <Card
                title="Библиотека фонов"
                action={
                  <Button onClick={() => backgroundFileInputRef.current?.click()}>
                    Загрузить…
                  </Button>
                }
              >
                <input
                  ref={backgroundFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleBackgroundFileChange}
                />
                {backgroundNotice && <Notice>{backgroundNotice}</Notice>}

                <div className="settings-media-grid">
                  {backgrounds.map((item) => {
                    const usage = Object.values(charBackgrounds).filter((state) =>
                      state.attachedIds.includes(item.id),
                    ).length;
                    const url = backgroundUrls[item.id];
                    return (
                      <div className="settings-media-card" key={item.id}>
                        <div className="settings-media-preview">
                          {url ? (
                            <img
                              src={url}
                              alt={item.name}
                              draggable={false}
                              className="settings-media-image"
                            />
                          ) : (
                            <div className="settings-media-placeholder">Загрузка…</div>
                          )}
                          {usage > 0 && (
                            <span className="settings-media-badge">{usage} перс.</span>
                          )}
                        </div>
                        <div className="settings-media-footer">
                          {renamingBackground === item.id ? (
                            <>
                              <input
                                autoFocus
                                value={backgroundRenameDraft}
                                onChange={(event) =>
                                  setBackgroundRenameDraft(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void commitBackgroundRename(item.id);
                                  if (event.key === "Escape") setRenamingBackground(null);
                                }}
                                className="settings-input is-compact"
                              />
                              <div className="settings-mini-actions">
                                <Button
                                  variant="secondary"
                                  onClick={() => void commitBackgroundRename(item.id)}
                                >
                                  Ок
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => setRenamingBackground(null)}
                                >
                                  Отмена
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="settings-media-name" title={item.name}>
                                {item.name || "Без имени"}
                              </div>
                              <div className="settings-mini-actions">
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setRenamingBackground(item.id);
                                    setBackgroundRenameDraft(item.name);
                                  }}
                                >
                                  Имя
                                </Button>
                                <Button
                                  variant="danger"
                                  onClick={() => void removeBackground(item)}
                                >
                                  Удалить
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {backgrounds.length === 0 && (
                  <Notice>
                    Загрузите изображение — оно появится здесь и будет доступно каждому персонажу.
                  </Notice>
                )}
              </Card>
            </div>
          )}

          {section === "characters" && (
            <div className="settings-stack">
              <Card title="Персонажи" description="Выберите профиль для редактирования.">
                <div className="settings-character-strip">
                  {characters.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(character.id);
                        setAvatarError("");
                        setChatNotice("");
                      }}
                      className={`settings-character-chip${
                        selectedId === character.id ? " is-active" : ""
                      }`}
                      title={character.name}
                    >
                      <span className="settings-character-avatar">
                        {character.avatar ? (
                          <img
                            src={character.avatar}
                            alt=""
                            draggable={false}
                            className="settings-media-image"
                          />
                        ) : (
                          <span className="settings-character-initial">
                            {character.name.slice(0, 1).toUpperCase() || "?"}
                          </span>
                        )}
                        {settings.activeCharacterId === character.id && (
                          <span className="settings-avatar-active" aria-hidden="true" />
                        )}
                      </span>
                      <span className="settings-character-name">{character.name}</span>
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={addCharacter}
                    className="settings-character-chip is-add"
                  >
                    <span className="settings-character-avatar">
                      <span className="settings-character-add">+</span>
                    </span>
                    <span className="settings-character-name">Добавить</span>
                  </button>
                </div>
              </Card>

              {selected && (
                <Card title="Основное" description="Имя, аватар и поведение персонажа.">
                  <FieldLabel>Имя</FieldLabel>
                  <input
                    value={selected.name}
                    onChange={(event) => updateCharacter({ name: event.target.value })}
                    className="settings-input"
                  />

                  <div className="settings-divider" />

                  <FieldLabel>Аватарка</FieldLabel>
                  <div className="settings-avatar-row">
                    <div className="settings-avatar-preview">
                      {selected.avatar ? (
                        <img
                          src={selected.avatar}
                          alt=""
                          className="settings-media-image"
                          draggable={false}
                        />
                      ) : (
                        <span className="settings-character-initial">
                          {selected.name.slice(0, 1).toUpperCase() || "?"}
                        </span>
                      )}
                    </div>
                    <div className="settings-avatar-actions">
                      <Button onClick={() => avatarFileInputRef.current?.click()}>
                        Загрузить…
                      </Button>
                      {selected.avatar && (
                        <Button
                          variant="danger"
                          onClick={() => {
                            updateCharacter({ avatar: null });
                            setAvatarError("");
                          }}
                        >
                          Удалить
                        </Button>
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
                  {avatarError && <Helper tone="error">{avatarError}</Helper>}

                  <div className="settings-divider" />

                  <ToggleRow
                    label="Реальное время"
                    description="Добавляет в промпт текущее время и время суток."
                    checked={selected.realTime ?? true}
                    onChange={(value) => updateCharacter({ realTime: value })}
                  />

                  <div className="settings-divider" />

                  <div className="settings-subhead">Живая модель</div>
                  <ToggleRow
                    label="Автономная активность в простое"
                    description="Дыхание, покачивание, случайный взгляд и короткие действия без чата."
                    checked={selected.idleActivity ?? true}
                    onChange={(value) => updateCharacter({ idleActivity: value })}
                  />
                  <div className="settings-field-block">
                    <FieldLabel>Интенсивность</FieldLabel>
                    <Segmented
                      values={["low", "medium", "high"] as IdleIntensity[]}
                      value={selected.idleIntensity ?? "medium"}
                      onChange={(next) => updateCharacter({ idleIntensity: next })}
                      labels={{ low: "Тихо", medium: "Средне", high: "Активно" }}
                    />
                  </div>
                  <div className="settings-toggle-list">
                    <ToggleRow
                      label="Танцевать под музыку"
                      description="Использует системный звук macOS или ручной режим музыки из раздела «Общее»."
                      checked={selected.musicReactivity ?? true}
                      onChange={(value) => updateCharacter({ musicReactivity: value })}
                    />
                    <ToggleRow
                      label="Реагировать на курсор и клики"
                      description="Взгляд при наведении и короткая реакция при клике по модели."
                      checked={selected.interactionResponses ?? true}
                      onChange={(value) => updateCharacter({ interactionResponses: value })}
                    />
                  </div>

                  <div className="settings-divider" />

                  <FieldLabel>Системный промпт</FieldLabel>
                  <textarea
                    value={selected.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}
                    onChange={(event) =>
                      updateCharacter({ systemPrompt: event.target.value })
                    }
                    rows={6}
                    placeholder="Общие правила речи персонажа..."
                    className="settings-textarea"
                  />
                  <PromptTokenCount value={selected.systemPrompt ?? DEFAULT_SYSTEM_PROMPT} />
                  <Helper className="mt-1">
                    Только живой диалог: без описаний действий, narration и AI-канцелярита.
                  </Helper>

                  <div className="settings-field-block">
                    <FieldLabel>Описание персонажа</FieldLabel>
                    <textarea
                      value={selected.prompt}
                      onChange={(event) => updateCharacter({ prompt: event.target.value })}
                      rows={5}
                      placeholder="Кто этот персонаж и какой у него характер..."
                      className="settings-textarea"
                    />
                    <PromptTokenCount value={selected.prompt} />
                  </div>

                  <div className="settings-field-block">
                    <FieldLabel>Примеры сообщений</FieldLabel>
                    <textarea
                      value={selected.examples ?? ""}
                      onChange={(event) => updateCharacter({ examples: event.target.value })}
                      rows={5}
                      placeholder={`Пользователь: привет\n${selected.name}: Что у нас на сегодня?`}
                      className="settings-textarea"
                    />
                    <PromptTokenCount value={selected.examples ?? ""} />
                    <Helper className="mt-1">
                      По одной реплике на строку: «Пользователь: ...» или «Имя персонажа: ...».
                      Пустое поле — примеры не используются.
                    </Helper>
                  </div>
                </Card>
              )}

              {selected && (
                <Card title="Внешний вид" description="Модели и фоны этого персонажа.">
                  <FieldLabel>VRM модели</FieldLabel>
                  <div className="settings-field-stack">
                    <button
                      type="button"
                      onClick={() => updateCharacter({ modelId: DEFAULT_MODEL_ID })}
                      className={`settings-select-row${
                        selected.modelId === DEFAULT_MODEL_ID ? " is-selected" : ""
                      }`}
                    >
                      <span>Базовая модель</span>
                      {selected.modelId === DEFAULT_MODEL_ID && (
                        <StatusChip tone="success">Активная</StatusChip>
                      )}
                    </button>

                    {selectedModelIds.map((fileName) => (
                      <div className="settings-select-row" key={fileName}>
                        <Switch
                          checked
                          label={`Открепить ${fileName}`}
                          onChange={() => toggleCharacterModel(fileName)}
                          small
                        />
                        {previews[fileName] ? (
                          <img
                            src={previews[fileName]}
                            alt=""
                            draggable={false}
                            className="settings-model-thumb"
                          />
                        ) : (
                          <span className="settings-model-thumb is-empty">3D</span>
                        )}
                        <span className="settings-row-name" title={fileName}>
                          {fileName.replace(/\.vrm$/i, "")}
                        </span>
                        {selected.modelId === fileName ? (
                          <StatusChip tone="success">Активная</StatusChip>
                        ) : (
                          <Button
                            variant="ghost"
                            className="settings-mini"
                            onClick={() => updateCharacter({ modelId: fileName })}
                          >
                            Выбрать
                          </Button>
                        )}
                      </div>
                    ))}

                    {selectedModelIds.length === 0 && (
                      <Helper>Нет закреплённых моделей — используется базовая.</Helper>
                    )}

                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) attachCharacterModel(event.target.value);
                      }}
                      className="settings-select"
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

                  <div className="settings-divider" />

                  <FieldLabel>Фоны</FieldLabel>
                  <div className="settings-background-grid">
                    <div
                      className={`settings-background-tile${
                        characterBackgroundState.activeId === DEFAULT_BACKGROUND_ID
                          ? " is-active"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => activateCharacterBackground(DEFAULT_BACKGROUND_ID)}
                        className="settings-background-button"
                        title="Стандартный серый"
                      >
                        <span className="settings-background-image is-default" />
                        <span className="settings-background-label">Серый</span>
                        {characterBackgroundState.activeId === DEFAULT_BACKGROUND_ID && (
                          <span className="settings-background-check" aria-hidden="true" />
                        )}
                      </button>
                    </div>

                    {attachedBackgrounds.map((item) => {
                      const active = characterBackgroundState.activeId === item.id;
                      const url = backgroundUrls[item.id];
                      return (
                        <div
                          key={item.id}
                          className={`settings-background-tile${active ? " is-active" : ""}`}
                        >
                          <button
                            type="button"
                            onClick={() => activateCharacterBackground(item.id)}
                            className="settings-background-button"
                            title={item.name}
                          >
                            <span className="settings-background-image">
                              {url ? (
                                <img
                                  src={url}
                                  alt=""
                                  draggable={false}
                                  className="settings-media-image"
                                />
                              ) : (
                                <span className="settings-media-placeholder">…</span>
                              )}
                            </span>
                            <span className="settings-background-label">
                              {item.name || "Фон"}
                            </span>
                            {active && (
                              <span className="settings-background-check" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`Открепить фон ${item.name || item.id}`}
                            title="Открепить фон"
                            onClick={() => toggleCharacterBackground(item.id)}
                            className="settings-background-detach"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}

                    {attachedBackgrounds.length === 0 && (
                      <Helper className="col-span-3">
                        Нет закреплённых фонов — используется стандартный.
                      </Helper>
                    )}
                  </div>

                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) toggleCharacterBackground(event.target.value);
                    }}
                    className="settings-select mt-2"
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
                </Card>
              )}

              {selected && (
                <div className="settings-card settings-actions-card">
                  <span className="settings-inline-status">
                    <span
                      className={`settings-status-dot${
                        settings.activeCharacterId === selected.id ? " is-active" : ""
                      }`}
                      aria-hidden="true"
                    />
                    {settings.activeCharacterId === selected.id
                      ? "Активный персонаж"
                      : "Не активен"}
                  </span>
                  <div className="settings-actions">
                    <Button
                      disabled={settings.activeCharacterId === selected.id}
                      onClick={() => {
                        setSettings((current) => ({
                          ...current,
                          activeCharacterId: selected.id,
                        }));
                        void setActiveCharacter(selected.id).catch((error) =>
                          console.error("Не удалось сменить активного персонажа", error),
                        );
                      }}
                    >
                      {settings.activeCharacterId === selected.id
                        ? "Активный"
                        : "Сделать активным"}
                    </Button>
                    <Button variant="ghost" onClick={() => void clearSelectedChat()}>
                      Очистить чат
                    </Button>
                    <Button
                      variant="danger"
                      disabled={characters.length <= 1}
                      onClick={deleteCharacter}
                    >
                      Удалить
                    </Button>
                  </div>
                </div>
              )}

              {chatNotice && <Notice>{chatNotice}</Notice>}
            </div>
          )}

          {section === "persona" && (
            <div className="settings-stack">
              <Card title="Профиль пользователя" description="Подстановка в промпты персонажей.">
                <FieldLabel>Имя</FieldLabel>
                <input
                  value={settings.persona?.name ?? ""}
                  onChange={(event) => void updatePersona({ name: event.target.value })}
                  placeholder="User"
                  className="settings-input"
                />
                <Helper className="mt-1">
                  Подставляется вместо тега <code className="settings-code">{'{{user}}'}</code> в
                  промптах. Если имя пустое, используется{" "}
                  <code className="settings-code">User</code>.
                </Helper>

                <div className="settings-divider" />

                <FieldLabel>Описание</FieldLabel>
                <textarea
                  value={settings.persona?.description ?? ""}
                  onChange={(event) =>
                    void updatePersona({ description: event.target.value })
                  }
                  rows={8}
                  placeholder="Например: любит кофе, работает дизайнером, не любит громкие компании"
                  className="settings-textarea"
                />
                <PromptTokenCount value={settings.persona?.description ?? ""} />
                <Helper className="mt-1">
                  Эта информация добавляется в системное сообщение всем персонажам и
                  участникам беседы.
                </Helper>

                <div className="settings-highlight">
                  <div className="settings-subhead">Пример подстановки</div>
                  <p className="settings-highlight-text">
                    <code className="settings-code">{'You are a good friend of {{user}}'}</code>
                    <span className="settings-arrow" aria-hidden="true">→</span>
                    <code className="settings-code">{`You are a good friend of ${personaPreviewName}`}</code>
                  </p>
                </div>
              </Card>
            </div>
          )}

          {section === "group" && (
            <div className="settings-stack">
              <Card title="Правила беседы" description="Общие настройки диалога двух персонажей.">
                <FieldLabel>Правила беседы</FieldLabel>
                <textarea
                  value={settings.group.rules}
                  onChange={(event) => void updateGroup({ rules: event.target.value })}
                  rows={4}
                  placeholder="Например: говорите коротко, не отвечайте за пользователя, используйте имена друг друга"
                  className="settings-textarea"
                />
                <PromptTokenCount value={settings.group.rules} />
                <Helper className="mt-1">Добавляется в общий промпт обоих персонажей.</Helper>

                <div className="settings-divider" />

                <FieldLabel>Длина ответов</FieldLabel>
                <Segmented
                  values={GROUP_LENGTHS}
                  value={settings.group.responseLength}
                  labels={GROUP_LENGTH_LABELS}
                  onChange={(responseLength) => void updateGroup({ responseLength })}
                />

                <div className="settings-divider" />

                <div className="settings-toggle-list">
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

                <div className="settings-divider" />

                <div className="settings-number-grid">
                  <label className="block">
                    <span className="settings-label">Глубина истории</span>
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
                      className="settings-input"
                    />
                  </label>
                  <label className="block">
                    <span className="settings-label">Порог резюмирования</span>
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
                      className="settings-input"
                    />
                  </label>
                </div>
              </Card>

              <Card title="История бесед" description="Сохранённые диалоги между персонажами.">
                {groupChats.length ? (
                  <div className="settings-history-list">
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
                        <div className="settings-history-row" key={item.key}>
                          <div className="min-w-0">
                            <p className="settings-history-name">{names.join(" + ")}</p>
                            <p className="settings-history-meta">
                              {item.messageCount} сообщ. · {date}
                            </p>
                          </div>
                          <Button
                            variant="danger"
                            className="settings-mini"
                            onClick={() => void deleteGroupChat(item.key)}
                          >
                            Удалить
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Helper>Сохранённых бесед пока нет.</Helper>
                )}
                {groupNotice && <Notice>{groupNotice}</Notice>}
              </Card>
            </div>
          )}

          {section === "speech" && (
            <div className="settings-stack">
              <Card title="Микрофон" description="Основные параметры распознавания речи.">
                <ToggleRow
                  label="Микрофон"
                  description="Разрешить кнопку микрофона в главном окне"
                  checked={settings.speech.enabled}
                  onChange={(value) => void updateSpeech({ enabled: value })}
                />

                <div className="settings-divider" />

                <FieldLabel>Движок</FieldLabel>
                <Segmented
                  values={SPEECH_ENGINES.map((item) => item.value)}
                  value={settings.speech.engine}
                  onChange={(value) => void selectEngine(value)}
                />
                <Helper className="mt-2">
                  {localEngine
                    ? "Распознавание выполняется локально через встроенный CrispASR."
                    : "Web Speech может использовать сервисы Apple и требует доступ к сети."}
                </Helper>

                <div className="settings-divider" />

                <FieldLabel>Язык распознавания</FieldLabel>
                <select
                  value={settings.speech.language}
                  onChange={(event) => void updateSpeech({ language: event.target.value })}
                  className="settings-select"
                >
                  {visibleLanguages.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {localEngine && (
                  <Helper tone="warning" className="mt-2">
                    Parakeet-redux не поддерживает русский и японский. Для этих языков остаётся
                    Web Speech.
                  </Helper>
                )}

                <div className="settings-divider" />

                <div className="settings-toggle-list">
                  <ToggleRow
                    label="Непрерывное распознавание"
                    description="Не останавливаться после первой фразы"
                    checked={settings.speech.continuous}
                    onChange={(value) => void updateSpeech({ continuous: value })}
                  />
                  <ToggleRow
                    label="Отправлять сразу"
                    description="Включено — текст уходит в чат; выключено — попадает в поле ввода"
                    checked={settings.speech.autoSend}
                    onChange={(value) => void updateSpeech({ autoSend: value })}
                  />
                  <ToggleRow
                    label="Автоповтор"
                    description="Повторять распознавание после паузы или ошибки"
                    checked={settings.speech.autoRestart}
                    onChange={(value) => void updateSpeech({ autoRestart: value })}
                  />
                  <ToggleRow
                    label="Статус на модели"
                    description="Показывать состояние микрофона в области персонажа"
                    checked={settings.speech.showStatus}
                    onChange={(value) => void updateSpeech({ showStatus: value })}
                  />
                </div>
              </Card>

              {localEngine && (
                <Card
                  title="Локальная модель"
                  description={`Версия раннера: ${speechRuntime?.version ?? "—"}`}
                >
                  <FieldLabel>Квантование</FieldLabel>
                  <div className="settings-segmented is-wrap">
                    {SPEECH_QUANTS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        aria-pressed={settings.speech.localQuant === item.value}
                        onClick={() => void selectQuant(item.value)}
                        className={`settings-segment${
                          settings.speech.localQuant === item.value ? " is-active" : ""
                        }`}
                      >
                        {item.label} · {item.size}
                      </button>
                    ))}
                  </div>
                  <Helper className="mt-2">
                    {speechModel?.exists
                      ? speechModel.valid
                        ? `Файл найден: ${speechModel.fileName}`
                        : `Размер файла не совпадает: ${speechModel.size} / ${speechModel.expectedSize}`
                      : "Модель ещё не скачана"}
                  </Helper>
                  {speechDownload && !speechDownload.done && (
                    <div className="mt-3">
                      <div className="settings-progress">
                        <div
                          className="settings-progress-fill"
                          style={{ width: `${speechDownload.percent}%` }}
                        />
                      </div>
                      <Helper className="mt-1">
                        {speechDownload.percent}% ·{" "}
                        {Math.round(speechDownload.loaded / 1024 / 1024)} /{" "}
                        {Math.round(speechDownload.total / 1024 / 1024)} МБ
                      </Helper>
                    </div>
                  )}
                  <div className="settings-actions mt-3">
                    <Button
                      variant="primary"
                      disabled={!!speechDownload && !speechDownload.done}
                      onClick={() => void downloadModel()}
                    >
                      Скачать модель
                    </Button>
                    {speechDownload && !speechDownload.done && (
                      <Button variant="ghost" onClick={() => void cancelSpeechDownload()}>
                        Отменить
                      </Button>
                    )}
                    {speechModel?.exists && (
                      <Button variant="danger" onClick={() => void removeModel()}>
                        Удалить
                      </Button>
                    )}
                  </div>
                </Card>
              )}

              {localEngine && (
                <Card title="Локальный STT-сервер" description="Управление локальным сервером.">
                  <div className="settings-card-inline-head">
                    <Helper>
                      {sttState.message || "Сервер запускается при первом нажатии микрофона."}
                    </Helper>
                    <StatusChip
                      tone={
                        sttState.status === "loaded"
                          ? "success"
                          : sttState.status === "error"
                            ? "error"
                            : "neutral"
                      }
                    >
                      {sttState.status}
                    </StatusChip>
                  </div>
                  <label className="settings-inline-field">
                    <span className="settings-label">Порт</span>
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
                      className="settings-input is-narrow"
                    />
                  </label>
                  <div className="settings-actions mt-3">
                    <Button variant="primary" disabled={sttBusy} onClick={() => void startStt()}>
                      Запустить
                    </Button>
                    <Button disabled={sttBusy} onClick={() => void stopStt()}>
                      Остановить
                    </Button>
                  </div>
                </Card>
              )}

              <Card title="Проверка микрофона" description="Тест не отправляет текст в чат.">
                <Helper>
                  Распознанный текст появится здесь и не будет отправлен в чат.
                </Helper>
                <div className="settings-actions mt-3">
                  <Button
                    variant="primary"
                    onClick={
                      speechTestState === "listening" ? stopSpeechTest : () => void startSpeechTest()
                    }
                  >
                    {speechTestState === "listening" ? "Остановить" : "Проверить"}
                  </Button>
                  {speechTestText && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        speechTestTextRef.current = "";
                        setSpeechTestText("");
                      }}
                    >
                      Очистить
                    </Button>
                  )}
                </div>
                {speechTestText && (
                  <div className="settings-highlight is-result">{speechTestText}</div>
                )}
                {speechTestError && <Notice tone="error">{speechTestError}</Notice>}
              </Card>

              {speechNotice && <Notice>{speechNotice}</Notice>}
              {!localEngine && (
                <Helper>
                  Web Speech через WebView macOS может использовать сервисы Apple. Если доступа
                  нет, проверьте Системные настройки → Конфиденциальность и безопасность →
                  Микрофон и Распознавание речи.
                </Helper>
              )}
            </div>
          )}

          {section === "credits" && (
            <div className="settings-stack">
              <Card title="Благодарности" description="Проекты и лицензии.">
                <div className="settings-credits">
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
              </Card>
            </div>
          )}
        </div>
      </main>

      {backgroundCropSource && (
        <div className="settings-modal-backdrop">
          <div
            ref={backgroundCropDialogRef}
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Обрезка фона"
          >
            <div className="settings-modal-head">
              <span className="settings-modal-title">Обрезка фона</span>
              <StatusChip>9:16</StatusChip>
            </div>
            <div
              className="settings-crop-frame"
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
                className="settings-crop-image"
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
            <label className="settings-zoom-row">
              <span className="settings-label">Масштаб</span>
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
                className="settings-range"
              />
            </label>
            <div className="settings-modal-actions">
              <Button variant="ghost" onClick={() => setBackgroundCropSource(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                disabled={!backgroundCropSize}
                onClick={applyBackgroundCrop}
              >
                Применить
              </Button>
            </div>
          </div>
        </div>
      )}

      {avatarCropSource && (
        <div className="settings-modal-backdrop">
          <div
            ref={avatarCropDialogRef}
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Обрезка аватарки"
          >
            <div className="settings-modal-head">
              <span className="settings-modal-title">Обрезка аватарки</span>
              <StatusChip>9:16</StatusChip>
            </div>
            <div
              className="settings-crop-frame"
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
                className="settings-crop-image"
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
            <label className="settings-zoom-row">
              <span className="settings-label">Масштаб</span>
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
                className="settings-range"
              />
            </label>
            {avatarError && <Notice tone="error">{avatarError}</Notice>}
            <div className="settings-modal-actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setAvatarCropSource(null);
                  setAvatarError("");
                }}
              >
                Отмена
              </Button>
              <Button
                variant="primary"
                disabled={!avatarCropSize}
                onClick={applyAvatarCrop}
              >
                Применить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
