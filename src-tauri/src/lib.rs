// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use futures_util::StreamExt;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const SETTINGS_FILE: &str = "settings.json";
const CHARACTERS_FILE: &str = "characters.json";
const CHARACTERS_BACKUP_FILE: &str = "characters.json.bak";
const AVATARS_DIR: &str = "avatars";
const SCREENSHOTS_DIR: &str = "screenshots";
const CHATS_FILE: &str = "chats.json";
const SUMMARIES_FILE: &str = "summaries.json";
const VIEWS_FILE: &str = "views.json";
const BACKGROUNDS_FILE: &str = "background_library.json";
const CHARACTER_BACKGROUNDS_FILE: &str = "character_backgrounds.json";
const MODEL_LOG_FILE: &str = "llama-server.log";
const MODEL_PID_FILE: &str = "model_process.json";
const STT_LOG_FILE: &str = "crispasr-stt.log";
const STT_DEBUG_FILE: &str = "speech-debug.log";
const STT_PID_FILE: &str = "stt_process.json";
const IS_PRERELEASE: bool = cfg!(feature = "prerelease");
const DEFAULT_MODEL_ID: &str = if IS_PRERELEASE {
    "Haruhi_school.vrm"
} else {
    "builtin"
};
const DEFAULT_SYSTEM_PROMPT: &str = "You are not an AI or assistant. You are this person, speaking right now. Stay in character completely.\n\nOutput only spoken dialogue. No narration, stage directions, asterisks or italics for actions, no descriptions of gestures, expressions, thoughts, or the other person. Never speak for the user. Do not summarize or explain the conversation. Show hesitation through word choice and punctuation, not description.\n\nSound human and imperfect, in your own voice. No AI filler or clichés.\n\nA technical tag may be requested after the reply. Output it exactly as instructed and treat it as outside the dialogue.";
const DEFAULT_CHARACTER_ID: &str = "default";
const DEFAULT_BACKGROUND_ID: &str = "default";
const DEFAULT_RUNNER_PATH: &str = "";
const DEFAULT_WINDOW_HEIGHT: u16 = 680;
const MIN_WINDOW_HEIGHT: u16 = 340;
const DEFAULT_CHAT_WIDTH: u16 = 324;
const MAX_CHAT_WIDTH: u16 = 824;
const DEFAULT_PORT: u16 = 8081;
const DEFAULT_STT_PORT: u16 = 8082;
const PARAKEET_REPO: &str = "cstr/parakeet-redux-GGUF";
const CRISPASR_VERSION: &str = "0.8.55";

static SPEECH_DOWNLOAD_ACTIVE: AtomicBool = AtomicBool::new(false);
static SPEECH_DOWNLOAD_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum KvCache {
    F16,
    Q8_0,
}

impl Default for KvCache {
    fn default() -> Self {
        Self::F16
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Reasoning {
    Off,
    Low,
    Medium,
    High,
}

impl Default for Reasoning {
    fn default() -> Self {
        Self::Off
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum GroupResponseLength {
    Short,
    Normal,
    Detailed,
}

impl Default for GroupResponseLength {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ModelMode {
    Local,
    Api,
}

impl Default for ModelMode {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ChatAppearance {
    Default,
    Glass,
    Bubbles,
}

impl Default for ChatAppearance {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum NavbarVisibility {
    Always,
    Hover,
    Hidden,
}

impl Default for NavbarVisibility {
    fn default() -> Self {
        Self::Always
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ViewMode {
    Default,
    Overlay,
    Fullscreen,
}

impl Default for ViewMode {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApiSettings {
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
}

impl Default for ApiSettings {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SpeechEngine {
    WebSpeech,
    LocalParakeet,
}

impl Default for SpeechEngine {
    fn default() -> Self {
        Self::WebSpeech
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
enum SpeechQuant {
    #[serde(rename = "q4_k")]
    Q4K,
    #[serde(rename = "q8_0")]
    Q8_0,
    #[serde(rename = "f16")]
    F16,
}

impl SpeechQuant {
    fn file_name(self) -> &'static str {
        match self {
            Self::Q4K => "parakeet-redux-q4_k.gguf",
            Self::Q8_0 => "parakeet-redux-q8_0.gguf",
            Self::F16 => "parakeet-redux-f16.gguf",
        }
    }

    fn expected_size(self) -> u64 {
        match self {
            Self::Q4K => 402_226_496,
            Self::Q8_0 => 674_342_400,
            Self::F16 => 1_255_338_880,
        }
    }

    fn sha256(self) -> &'static str {
        match self {
            Self::Q4K => "c07c7a0c76aa573334df88afc3a0c3bed45f90a35f09c22979e811078be30e6d",
            Self::Q8_0 => "606135796d55fd64b5baeb21966b3fcb469b61e6950ba2e0f9269c49cc734ff2",
            Self::F16 => "0b4fe28c72447fd4012ed6072c60887e69b36f6c54bc4c35069cb316acc1c113",
        }
    }
}

impl Default for SpeechQuant {
    fn default() -> Self {
        Self::Q4K
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeechSettings {
    enabled: bool,
    language: String,
    continuous: bool,
    auto_send: bool,
    auto_restart: bool,
    show_status: bool,
    #[serde(default)]
    engine: SpeechEngine,
    #[serde(default)]
    local_quant: SpeechQuant,
    #[serde(default = "default_stt_port")]
    stt_port: u16,
}

impl Default for SpeechSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            language: "ru-RU".to_string(),
            continuous: true,
            auto_send: true,
            auto_restart: false,
            show_status: true,
            engine: SpeechEngine::default(),
            local_quant: SpeechQuant::default(),
            stt_port: default_stt_port(),
        }
    }
}

fn default_stt_port() -> u16 {
    DEFAULT_STT_PORT
}

fn default_system_prompt() -> String {
    DEFAULT_SYSTEM_PROMPT.to_string()
}

fn default_group_reactions() -> bool {
    true
}

fn default_group_use_examples() -> bool {
    false
}

fn default_true() -> bool {
    true
}

fn default_group_history_depth() -> u32 {
    24
}

fn default_group_summary_threshold() -> u32 {
    32
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GroupSettings {
    #[serde(default)]
    rules: String,
    #[serde(default)]
    response_length: GroupResponseLength,
    #[serde(default = "default_group_reactions")]
    reactions: bool,
    #[serde(default = "default_group_use_examples")]
    use_examples: bool,
    #[serde(default = "default_group_history_depth")]
    history_depth: u32,
    #[serde(default = "default_group_summary_threshold")]
    summary_threshold: u32,
}

impl Default for GroupSettings {
    fn default() -> Self {
        Self {
            rules: String::new(),
            response_length: GroupResponseLength::default(),
            reactions: default_group_reactions(),
            use_examples: default_group_use_examples(),
            history_depth: default_group_history_depth(),
            summary_threshold: default_group_summary_threshold(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PersonaSettings {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
}

impl Default for PersonaSettings {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    gguf_path: String,
    context_size: u32,
    #[serde(default = "default_runner_path")]
    runner_path: String,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default)]
    kv_cache: KvCache,
    #[serde(default)]
    reasoning: Reasoning,
    active_character_id: String,
    #[serde(default = "default_window_height")]
    window_height: u16,
    #[serde(default = "default_chat_width")]
    chat_width: u16,
    #[serde(default)]
    chat_appearance: ChatAppearance,
    #[serde(default)]
    navbar_visibility: NavbarVisibility,
    #[serde(default)]
    view_mode: ViewMode,
    #[serde(default)]
    launch_at_login: bool,
    #[serde(default)]
    start_with_chat: bool,
    #[serde(default)]
    start_with_model: bool,
    #[serde(default)]
    start_local_model: bool,
    #[serde(default)]
    local_vision: bool,
    #[serde(default)]
    api_vision: bool,
    #[serde(default)]
    mmproj_path: String,
    #[serde(default)]
    speech: SpeechSettings,
    #[serde(default)]
    group: GroupSettings,
    #[serde(default)]
    persona: PersonaSettings,
    #[serde(default)]
    model_mode: ModelMode,
    #[serde(default)]
    api: ApiSettings,
}

fn default_runner_path() -> String {
    DEFAULT_RUNNER_PATH.to_string()
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_window_height() -> u16 {
    DEFAULT_WINDOW_HEIGHT
}

fn default_chat_width() -> u16 {
    DEFAULT_CHAT_WIDTH
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gguf_path: String::new(),
            context_size: 8192,
            runner_path: default_runner_path(),
            port: default_port(),
            kv_cache: KvCache::default(),
            reasoning: Reasoning::default(),
            active_character_id: DEFAULT_CHARACTER_ID.to_string(),
            window_height: DEFAULT_WINDOW_HEIGHT,
            chat_width: DEFAULT_CHAT_WIDTH,
            chat_appearance: ChatAppearance::default(),
            navbar_visibility: NavbarVisibility::default(),
            view_mode: ViewMode::default(),
            launch_at_login: false,
            start_with_chat: false,
            start_with_model: false,
            start_local_model: false,
            local_vision: false,
            api_vision: false,
            mmproj_path: String::new(),
            speech: SpeechSettings::default(),
            group: GroupSettings::default(),
            persona: PersonaSettings::default(),
            model_mode: ModelMode::default(),
            api: ApiSettings::default(),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModelStatus {
    status: String,
    message: String,
}

struct ModelProcess {
    child: Option<Child>,
    status: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct ModelPid {
    pid: u32,
    port: u16,
}

struct SttProcess {
    child: Option<Child>,
    status: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct SttPid {
    pid: u32,
    port: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeechModelInfo {
    quant: SpeechQuant,
    file_name: String,
    path: String,
    exists: bool,
    size: u64,
    expected_size: u64,
    valid: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeechRuntimeInfo {
    available: bool,
    binary_path: String,
    version: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SpeechDownloadProgress {
    quant: SpeechQuant,
    loaded: u64,
    total: u64,
    percent: u32,
    done: bool,
    cancelled: bool,
}

impl Default for SttProcess {
    fn default() -> Self {
        Self {
            child: None,
            status: "idle".to_string(),
            message: String::new(),
        }
    }
}

impl SttProcess {
    fn status(&self) -> ModelStatus {
        ModelStatus {
            status: self.status.clone(),
            message: self.message.clone(),
        }
    }
}

impl Default for ModelProcess {
    fn default() -> Self {
        Self {
            child: None,
            status: "idle".to_string(),
            message: String::new(),
        }
    }
}

impl ModelProcess {
    fn status(&self) -> ModelStatus {
        ModelStatus {
            status: self.status.clone(),
            message: self.message.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Character {
    id: String,
    name: String,
    #[serde(default = "default_system_prompt")]
    system_prompt: String,
    #[serde(default)]
    prompt: String,
    #[serde(default)]
    examples: String,
    model_id: String,
    #[serde(default)]
    model_ids: Vec<String>,
    #[serde(default)]
    avatar: Option<String>,
    #[serde(default = "default_true")]
    real_time: bool,
}

impl Default for Character {
    fn default() -> Self {
        Self {
            id: DEFAULT_CHARACTER_ID.to_string(),
            name: "Персонаж".to_string(),
            system_prompt: default_system_prompt(),
            prompt: String::new(),
            examples: String::new(),
            model_id: DEFAULT_MODEL_ID.to_string(),
            model_ids: Vec::new(),
            avatar: None,
            real_time: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredCharacter {
    id: String,
    name: String,
    #[serde(default)]
    system_prompt: Option<String>,
    #[serde(default)]
    prompt: String,
    #[serde(default)]
    examples: Option<String>,
    model_id: String,
    #[serde(default)]
    model_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    avatar_file: Option<String>,
    #[serde(default = "default_true")]
    real_time: bool,
}

impl From<&Character> for StoredCharacter {
    fn from(character: &Character) -> Self {
        Self {
            id: character.id.clone(),
            name: character.name.clone(),
            system_prompt: Some(character.system_prompt.clone()),
            prompt: character.prompt.clone(),
            examples: Some(character.examples.clone()),
            model_id: character.model_id.clone(),
            model_ids: character.model_ids.clone(),
            avatar: character.avatar.clone(),
            avatar_file: None,
            real_time: character.real_time,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrereleaseCharacterSeed {
    id: String,
    name: String,
    #[serde(default = "default_system_prompt")]
    system_prompt: String,
    #[serde(default)]
    prompt: String,
    #[serde(default)]
    examples: String,
    model_id: String,
    model_ids: Vec<String>,
    avatar_file: String,
    #[serde(default = "default_true")]
    real_time: bool,
}

fn normalize_character_models(characters: &mut [StoredCharacter]) {
    for character in characters.iter_mut() {
        if character.system_prompt.is_none() {
            character.system_prompt = Some(default_system_prompt());
        }
        if character.examples.is_none() {
            character.examples = Some(String::new());
        }
        if character.model_id.is_empty() {
            character.model_id = DEFAULT_MODEL_ID.to_string();
        }
        if character.model_id != DEFAULT_MODEL_ID
            && !character.model_ids.contains(&character.model_id)
        {
            character.model_ids.insert(0, character.model_id.clone());
        }
        let mut seen = HashSet::new();
        character
            .model_ids
            .retain(|id| id != DEFAULT_MODEL_ID && seen.insert(id.clone()));
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BackgroundInfo {
    #[serde(default)]
    id: String,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    name: String,
}

#[derive(Serialize, Deserialize, Default)]
struct BackgroundLibrary {
    #[serde(default)]
    items: Vec<BackgroundInfo>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct CharacterBackgrounds {
    #[serde(default = "default_background_id")]
    active_id: String,
    #[serde(default)]
    attached_ids: Vec<String>,
}

fn default_background_id() -> String {
    DEFAULT_BACKGROUND_ID.to_string()
}

fn normalize_character_backgrounds(state: &mut CharacterBackgrounds) {
    if state.active_id.is_empty() {
        state.active_id = DEFAULT_BACKGROUND_ID.to_string();
    }
    if state.active_id != DEFAULT_BACKGROUND_ID
        && !state.attached_ids.contains(&state.active_id)
    {
        state.attached_ids.insert(0, state.active_id.clone());
    }
    let mut seen = HashSet::new();
    state.attached_ids.retain(|id| {
        id != DEFAULT_BACKGROUND_ID && !id.is_empty() && seen.insert(id.clone())
    });
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum MessageFrom {
    Bot,
    User,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    text: String,
    from: MessageFrom,
    #[serde(default)]
    reaction: Option<String>,
    #[serde(default)]
    pending: bool,
    #[serde(default)]
    speaker_id: Option<String>,
    #[serde(default)]
    created_at: Option<u64>,
    #[serde(default)]
    image_file: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChatSummary {
    text: String,
    up_to_message_id: String,
    updated_at: u64,
}

impl Default for ChatSummary {
    fn default() -> Self {
        Self {
            text: String::new(),
            up_to_message_id: String::new(),
            updated_at: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ViewTransform {
    yaw: f64,
    pitch: f64,
    offset_x: f64,
    offset_y: f64,
    zoom: f64,
}

impl Default for ViewTransform {
    fn default() -> Self {
        Self {
            yaw: 0.0,
            pitch: 0.0,
            offset_x: 0.0,
            offset_y: 0.0,
            zoom: 1.0,
        }
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
}

fn prerelease_resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("prerelease"));
        candidates.push(resource_dir.join("prerelease"));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("resources/prerelease"));
    }

    for candidate in candidates {
        if candidate.join("default-character.json").is_file()
            && candidate.join("settings.json").is_file()
        {
            return Ok(candidate);
        }
    }
    Err("Не найдены ресурсы пре-релиза".to_string())
}

fn json_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(name))
}

fn read_json<T: DeserializeOwned>(app: &AppHandle, name: &str, default: T) -> Result<T, String> {
    let path = json_path(app, name)?;
    if !path.exists() {
        return Ok(default);
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn write_json<T: Serialize + ?Sized>(app: &AppHandle, name: &str, value: &T) -> Result<(), String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let raw = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(json_path(app, name)?, raw).map_err(|error| error.to_string())
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("vrm_models"))
}

fn vrm_previews_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("vrm_previews"))
}

fn vrm_preview_file_name(model_id: &str) -> String {
    let safe = safe_file_name(model_id);
    if safe.to_ascii_lowercase().ends_with(".vrm") {
        format!("{}.jpg", &safe[..safe.len() - 4])
    } else {
        format!("{safe}.jpg")
    }
}

fn backgrounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("backgrounds"))
}

fn avatars_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(AVATARS_DIR))
}

fn avatar_extension(mime: &str) -> Option<&'static str> {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn avatar_mime(file_name: &str) -> Option<&'static str> {
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
    } else {
        None
    }
}

fn safe_avatar_file_name(character_id: &str, extension: &str) -> String {
    let stem: String = character_id
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' {
                char
            } else {
                '_'
            }
        })
        .collect();
    let stem = if stem.is_empty() {
        "avatar".to_string()
    } else {
        stem
    };
    format!("{stem}.{extension}")
}

fn parse_avatar_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| "Некорректный формат аватара".to_string())?;
    let (mime, payload) = rest
        .split_once(";base64,")
        .ok_or_else(|| "Некорректный формат аватара".to_string())?;
    let extension = avatar_extension(mime)
        .ok_or_else(|| "Неподдерживаемый формат аватара".to_string())?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, payload)
        .map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("Пустой файл аватара".to_string());
    }
    Ok((extension.to_string(), bytes))
}

fn write_avatar_bytes(
    app: &AppHandle,
    character_id: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let dir = avatars_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let file_name = safe_avatar_file_name(character_id, extension);
    let path = dir.join(&file_name);
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    let written = fs::read(&path).map_err(|error| error.to_string())?;
    if written != bytes {
        return Err("Не удалось проверить файл аватара".to_string());
    }
    Ok(file_name)
}

fn write_avatar_data_url(
    app: &AppHandle,
    character_id: &str,
    data_url: &str,
) -> Result<String, String> {
    let (extension, bytes) = parse_avatar_data_url(data_url)?;
    write_avatar_bytes(app, character_id, &extension, &bytes)
}

fn read_avatar_data_url(app: &AppHandle, file_name: &str) -> Option<String> {
    let safe = safe_avatar_file_name_from_existing(file_name)?;
    let mime = avatar_mime(&safe)?;
    let bytes = fs::read(avatars_dir(app).ok()?.join(&safe)).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
    ))
}

fn safe_avatar_file_name_from_existing(file_name: &str) -> Option<String> {
    let safe: String = file_name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
                char
            } else {
                '_'
            }
        })
        .collect();
    if safe.contains("..") || safe.is_empty() || safe == "." {
        return None;
    }
    Some(safe)
}

fn remove_avatar_file(app: &AppHandle, file_name: &str) {
    if let (Some(safe), Ok(dir)) = (safe_avatar_file_name_from_existing(file_name), avatars_dir(app))
    {
        let _ = fs::remove_file(dir.join(safe));
    }
}

fn screenshots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(SCREENSHOTS_DIR))
}

fn safe_screenshot_file_name(file_name: &str) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
                char
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() || safe == "." || safe.contains("..") {
        return Err("Некорректное имя файла снимка".to_string());
    }
    Ok(safe)
}

#[tauri::command]
fn capture_screen() -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let tmp = std::env::temp_dir().join(format!("vrm-screen-{}-{stamp}.png", std::process::id()));
    let output = Command::new("/usr/sbin/screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg(&tmp)
        .output()
        .map_err(|error| format!("Не удалось сделать снимок экрана: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&tmp);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "Не удалось сделать снимок экрана: {}",
            if detail.is_empty() {
                output.status.to_string()
            } else {
                detail
            }
        ));
    }
    let bytes = fs::read(&tmp).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&tmp);
    Ok(format!(
        "data:image/png;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
    ))
}

#[tauri::command]
fn save_chat_image(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<(), String> {
    let safe = safe_screenshot_file_name(&name)?;
    let dir = screenshots_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    fs::write(dir.join(&safe), &bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_chat_image(app: AppHandle, file_name: String) -> Result<String, String> {
    let safe = safe_screenshot_file_name(&file_name)?;
    let bytes = fs::read(screenshots_dir(&app)?.join(&safe)).map_err(|error| error.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
    ))
}

#[tauri::command]
fn open_chat_image(app: AppHandle, file_name: String) -> Result<(), String> {
    let safe = safe_screenshot_file_name(&file_name)?;
    let path = screenshots_dir(&app)?.join(safe);
    if !path.exists() {
        return Err("Файл снимка не найден".to_string());
    }
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn prune_avatar_files(app: &AppHandle, keep: &HashSet<String>) -> Result<(), String> {
    let dir = avatars_dir(app)?;
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !keep.contains(&name) {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn backup_characters(app: &AppHandle) -> Result<(), String> {
    let source = json_path(app, CHARACTERS_FILE)?;
    let backup = json_path(app, CHARACTERS_BACKUP_FILE)?;
    if source.exists() && !backup.exists() {
        fs::copy(source, backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn persist_characters(app: &AppHandle, characters: &[StoredCharacter]) -> Result<(), String> {
    write_json(app, CHARACTERS_FILE, characters)
}

fn speech_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("speech_models").join("parakeet-redux"))
}

fn speech_model_path(app: &AppHandle, quant: SpeechQuant) -> Result<PathBuf, String> {
    Ok(speech_models_dir(app)?.join(quant.file_name()))
}

fn crispasr_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let binary_name = "crispasr";
    let dylib_name = "libc2pa_c.dylib";
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("crispasr-macos-arm64"));
        candidates.push(resource_dir.join("crispasr-macos-arm64"));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("resources/crispasr-macos-arm64"));
    }

    for candidate in candidates {
        if candidate.join(binary_name).is_file() && candidate.join(dylib_name).is_file() {
            return Ok(candidate);
        }
    }

    Err("Встроенный CrispASR не найден".to_string())
}

fn safe_file_name(name: &str) -> String {
    let mut result: String = name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
                char
            } else {
                '_'
            }
        })
        .collect();

    while result.contains("..") {
        result = result.replace("..", ".");
    }
    if result.is_empty() || result == "." {
        result = "model".to_string();
    }
    if !result.to_ascii_lowercase().ends_with(".vrm") {
        result.push_str(".vrm");
    }
    result
}

fn safe_background_file_name(name: &str) -> String {
    let mut result: String = name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' || char == '_' || char == '.' {
                char
            } else {
                '_'
            }
        })
        .collect();
    while result.contains("..") {
        result = result.replace("..", ".");
    }
    if result.is_empty() || result == "." {
        result = "background.jpg".to_string();
    }
    result
}

fn unique_file_name(dir: &Path, name: &str) -> String {
    let base = safe_file_name(name);
    let stem = if base.to_ascii_lowercase().ends_with(".vrm") {
        base[..base.len() - 4].to_string()
    } else {
        base.clone()
    };
    let mut candidate = base;
    let mut index = 1;

    while dir.join(&candidate).exists() {
        candidate = format!("{}-{}.vrm", stem, index);
        index += 1;
    }
    candidate
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn seed_prerelease_settings(app: &AppHandle) -> Result<(), String> {
    let dir = prerelease_resources_dir(app)?;
    let raw = fs::read_to_string(dir.join("settings.json")).map_err(|error| error.to_string())?;
    let settings: AppSettings =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    write_json(app, SETTINGS_FILE, &settings)
}

fn seed_prerelease_characters(app: &AppHandle) -> Result<Vec<StoredCharacter>, String> {
    let dir = prerelease_resources_dir(app)?;
    let raw = fs::read_to_string(dir.join("default-character.json"))
        .map_err(|error| error.to_string())?;
    let seed: PrereleaseCharacterSeed =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;

    let avatar_bytes = fs::read(dir.join(&seed.avatar_file)).map_err(|error| error.to_string())?;
    let avatar_file = write_avatar_bytes(app, &seed.id, "jpg", &avatar_bytes)?;

    let destination = models_dir(app)?;
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    for file_name in &seed.model_ids {
        let source = dir.join(file_name);
        let target = destination.join(safe_file_name(file_name));
        if source.is_file() && !target.exists() {
            fs::copy(source, target).map_err(|error| error.to_string())?;
        }
    }

    let mut characters = vec![StoredCharacter {
        id: if seed.id.is_empty() {
            DEFAULT_CHARACTER_ID.to_string()
        } else {
            seed.id
        },
        name: seed.name,
        system_prompt: Some(seed.system_prompt),
        prompt: seed.prompt,
        examples: Some(seed.examples),
        model_id: seed.model_id,
        model_ids: seed.model_ids,
        avatar: None,
        avatar_file: Some(avatar_file),
        real_time: seed.real_time,
    }];
    normalize_character_models(&mut characters);
    Ok(characters)
}

#[tauri::command]
fn read_settings(app: AppHandle) -> Result<AppSettings, String> {
    if IS_PRERELEASE && !json_path(&app, SETTINGS_FILE)?.exists() {
        if let Err(error) = seed_prerelease_settings(&app) {
            eprintln!("Не удалось загрузить настройки пре-релиза: {error}");
        }
    }
    read_json(&app, SETTINGS_FILE, AppSettings::default())
}

#[cfg(desktop)]
fn sync_autostart(app: &AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(error) = result {
        eprintln!("Не удалось синхронизировать автозапуск: {error}");
    }
}

#[tauri::command]
fn write_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    write_json(&app, SETTINGS_FILE, &settings)?;
    #[cfg(desktop)]
    sync_autostart(&app, settings.launch_at_login);
    Ok(())
}

#[tauri::command]
async fn api_chat_completion(
    base_url: String,
    api_key: String,
    model: String,
    body: serde_json::Value,
) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Не указан Base URL API".to_string());
    }
    if model.trim().is_empty() {
        return Err("Не указана модель API".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client
        .post(format!("{base}/chat/completions"))
        .header("Content-Type", "application/json");
    if !api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key.trim()));
    }

    let mut payload = body;
    if !payload.is_object() {
        payload = serde_json::json!({});
    }
    if let Some(map) = payload.as_object_mut() {
        map.insert(
            "model".to_string(),
            serde_json::Value::String(model.trim().to_string()),
        );
    }

    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Ошибка запроса к API: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        let preview: String = raw.chars().take(300).collect();
        return Err(format!("HTTP {status}: {preview}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Не удалось разобрать ответ API: {error}"))?;
    if let Some(message) = data
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|value| value.as_str())
    {
        return Err(message.to_string());
    }
    let content = data
        .get("choices")
        .and_then(|value| value.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    Ok(content)
}

#[tauri::command]
async fn api_list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Не указан Base URL API".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(format!("{base}/models"));
    if !api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key.trim()));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Ошибка запроса к API: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        let preview: String = raw.chars().take(300).collect();
        return Err(format!("HTTP {status}: {preview}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Не удалось разобрать список моделей: {error}"))?;
    if let Some(message) = data
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|value| value.as_str())
    {
        return Err(message.to_string());
    }
    let models = data
        .get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .map(|id| id.to_string())
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

#[tauri::command]
fn write_layout_settings(
    app: AppHandle,
    window_height: u16,
    chat_width: u16,
) -> Result<(), String> {
    let mut settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    settings.window_height = window_height.clamp(MIN_WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT);
    settings.chat_width = chat_width.clamp(DEFAULT_CHAT_WIDTH, MAX_CHAT_WIDTH);
    write_json(&app, SETTINGS_FILE, &settings)
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_active_character(app: AppHandle, character_id: String) -> Result<(), String> {
    let mut settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    settings.active_character_id = character_id;
    write_json(&app, SETTINGS_FILE, &settings)
}

#[tauri::command]
fn read_characters(app: AppHandle) -> Result<Vec<Character>, String> {
    let mut stored = read_json::<Vec<StoredCharacter>>(&app, CHARACTERS_FILE, Vec::new())?;
    if stored.is_empty() {
        let seeded = if IS_PRERELEASE {
            match seed_prerelease_characters(&app) {
                Ok(characters) => characters,
                Err(error) => {
                    eprintln!("Не удалось загрузить персонажа пре-релиза: {error}");
                    vec![StoredCharacter::from(&Character::default())]
                }
            }
        } else {
            vec![StoredCharacter::from(&Character::default())]
        };
        persist_characters(&app, &seeded)?;
        stored = seeded;
    }

    let before = serde_json::to_value(&stored).ok();
    normalize_character_models(&mut stored);
    let mut changed = before != serde_json::to_value(&stored).ok();

    let mut avatars: Vec<Option<String>> = Vec::new();
    for item in &mut stored {
        if let Some(file_name) = item.avatar_file.as_deref() {
            let resolved = read_avatar_data_url(&app, file_name);
            if resolved.is_none() {
                eprintln!("Не найден файл аватара: {file_name}");
            }
            avatars.push(resolved);
        } else if let Some(data_url) = item.avatar.clone() {
            match write_avatar_data_url(&app, &item.id, &data_url) {
                Ok(file_name) => {
                    item.avatar_file = Some(file_name);
                    item.avatar = None;
                    changed = true;
                    avatars.push(Some(data_url));
                }
                Err(error) => {
                    eprintln!("Не удалось перенести аватар файлом: {error}");
                    avatars.push(Some(data_url));
                }
            }
        } else {
            avatars.push(None);
        }
    }

    if changed {
        if let Err(error) = backup_characters(&app) {
            eprintln!("Не удалось сделать резервную копию персонажей: {error}");
        }
        persist_characters(&app, &stored)?;
    }

    Ok(stored
        .iter()
        .zip(avatars.into_iter())
        .map(|(item, avatar)| Character {
            id: item.id.clone(),
            name: item.name.clone(),
            system_prompt: item
                .system_prompt
                .clone()
                .unwrap_or_else(default_system_prompt),
            prompt: item.prompt.clone(),
            examples: item.examples.clone().unwrap_or_default(),
            model_id: item.model_id.clone(),
            model_ids: item.model_ids.clone(),
            avatar,
            real_time: item.real_time,
        })
        .collect())
}

#[tauri::command]
fn write_characters(app: AppHandle, characters: Vec<Character>) -> Result<(), String> {
    if characters.is_empty() {
        return Err("Нужен хотя бы один персонаж".to_string());
    }

    let previous = read_json::<Vec<StoredCharacter>>(&app, CHARACTERS_FILE, Vec::new())?;
    let mut previous_by_id: HashMap<String, StoredCharacter> =
        previous.into_iter().map(|item| (item.id.clone(), item)).collect();

    let mut next: Vec<StoredCharacter> = Vec::new();
    for character in &characters {
        let old = previous_by_id.remove(&character.id);
        let existing_file = old.as_ref().and_then(|item| item.avatar_file.clone());
        let existing_url = existing_file
            .as_deref()
            .and_then(|file_name| read_avatar_data_url(&app, file_name));

        let mut stored = StoredCharacter::from(character);
        stored.avatar = None;

        match character.avatar.as_deref() {
            Some(url) if Some(url) == existing_url.as_deref() => {
                stored.avatar_file = existing_file;
            }
            Some(url) => match write_avatar_data_url(&app, &character.id, url) {
                Ok(file_name) => {
                    if let Some(old_file) = existing_file.as_ref() {
                        if old_file != &file_name {
                            remove_avatar_file(&app, old_file);
                        }
                    }
                    stored.avatar_file = Some(file_name);
                }
                Err(error) => {
                    eprintln!("Не удалось сохранить аватар файлом: {error}");
                    if old.as_ref().and_then(|item| item.avatar_file.clone()).is_some() {
                        stored.avatar_file = existing_file;
                    } else {
                        stored.avatar = character.avatar.clone();
                    }
                }
            },
            None => {
                if let Some(old_file) = existing_file.as_ref() {
                    remove_avatar_file(&app, old_file);
                }
            }
        }

        next.push(stored);
    }

    normalize_character_models(&mut next);
    let keep: HashSet<String> = next
        .iter()
        .filter_map(|item| item.avatar_file.clone())
        .collect();
    if let Err(error) = prune_avatar_files(&app, &keep) {
        eprintln!("Не удалось удалить лишние файлы аватаров: {error}");
    }
    backup_characters(&app)?;
    persist_characters(&app, &next)
}

#[tauri::command]
fn read_chat(app: AppHandle, character_id: String) -> Result<Vec<ChatMessage>, String> {
    let chats = read_json::<HashMap<String, Vec<ChatMessage>>>(&app, CHATS_FILE, HashMap::new())?;
    Ok(chats.get(&character_id).cloned().unwrap_or_default())
}

#[tauri::command]
fn append_chat_message(
    app: AppHandle,
    character_id: String,
    message: ChatMessage,
) -> Result<(), String> {
    let mut chats =
        read_json::<HashMap<String, Vec<ChatMessage>>>(&app, CHATS_FILE, HashMap::new())?;
    chats.entry(character_id).or_default().push(message);
    write_json(&app, CHATS_FILE, &chats)
}

#[tauri::command]
fn clear_chat(app: AppHandle, character_id: String) -> Result<(), String> {
    let mut chats =
        read_json::<HashMap<String, Vec<ChatMessage>>>(&app, CHATS_FILE, HashMap::new())?;
    chats.remove(&character_id);
    write_json(&app, CHATS_FILE, &chats)?;

    let mut summaries =
        read_json::<HashMap<String, ChatSummary>>(&app, SUMMARIES_FILE, HashMap::new())?;
    summaries.remove(&character_id);
    write_json(&app, SUMMARIES_FILE, &summaries)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GroupChatInfo {
    key: String,
    message_count: usize,
    last_at: u64,
}

#[tauri::command]
fn list_group_chats(app: AppHandle) -> Result<Vec<GroupChatInfo>, String> {
    let chats = read_json::<HashMap<String, Vec<ChatMessage>>>(&app, CHATS_FILE, HashMap::new())?;
    let summaries =
        read_json::<HashMap<String, ChatSummary>>(&app, SUMMARIES_FILE, HashMap::new())?;
    let mut result: Vec<GroupChatInfo> = chats
        .into_iter()
        .filter(|(key, messages)| key.starts_with("group:") && !messages.is_empty())
        .map(|(key, messages)| {
            let last_message = messages
                .iter()
                .filter_map(|message| message.created_at)
                .max()
                .unwrap_or(0);
            let last_summary = summaries
                .get(&key)
                .map(|summary| summary.updated_at)
                .unwrap_or(0);
            GroupChatInfo {
                key,
                message_count: messages.len(),
                last_at: last_message.max(last_summary),
            }
        })
        .collect();
    result.sort_by(|a, b| b.last_at.cmp(&a.last_at).then_with(|| a.key.cmp(&b.key)));
    Ok(result)
}

#[tauri::command]
fn mark_chat_messages_read(
    app: AppHandle,
    character_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let mut chats =
        read_json::<HashMap<String, Vec<ChatMessage>>>(&app, CHATS_FILE, HashMap::new())?;
    if let Some(messages) = chats.get_mut(&character_id) {
        let wanted: HashSet<String> = ids.into_iter().collect();
        for message in messages.iter_mut() {
            if wanted.contains(&message.id) {
                message.pending = false;
            }
        }
    }
    write_json(&app, CHATS_FILE, &chats)
}

#[tauri::command]
fn read_chat_summary(app: AppHandle, character_id: String) -> Result<ChatSummary, String> {
    let summaries =
        read_json::<HashMap<String, ChatSummary>>(&app, SUMMARIES_FILE, HashMap::new())?;
    Ok(summaries.get(&character_id).cloned().unwrap_or_default())
}

#[tauri::command]
fn write_chat_summary(
    app: AppHandle,
    character_id: String,
    summary: ChatSummary,
) -> Result<(), String> {
    let mut summaries =
        read_json::<HashMap<String, ChatSummary>>(&app, SUMMARIES_FILE, HashMap::new())?;
    summaries.insert(character_id, summary);
    write_json(&app, SUMMARIES_FILE, &summaries)
}

#[tauri::command]
fn read_view_transform(app: AppHandle, character_id: String) -> Result<ViewTransform, String> {
    let views = read_json::<HashMap<String, ViewTransform>>(&app, VIEWS_FILE, HashMap::new())?;
    Ok(views.get(&character_id).cloned().unwrap_or_default())
}

#[tauri::command]
fn write_view_transform(
    app: AppHandle,
    character_id: String,
    transform: ViewTransform,
) -> Result<(), String> {
    let mut views = read_json::<HashMap<String, ViewTransform>>(&app, VIEWS_FILE, HashMap::new())?;
    views.insert(character_id, transform);
    write_json(&app, VIEWS_FILE, &views)
}

fn new_background_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("bg-{}-{}", now, std::process::id())
}

#[tauri::command]
fn list_backgrounds(app: AppHandle) -> Result<Vec<BackgroundInfo>, String> {
    let library =
        read_json::<BackgroundLibrary>(&app, BACKGROUNDS_FILE, BackgroundLibrary::default())?;
    Ok(library.items)
}

#[tauri::command]
fn save_background(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<BackgroundInfo, String> {
    let dir = backgrounds_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let mut library =
        read_json::<BackgroundLibrary>(&app, BACKGROUNDS_FILE, BackgroundLibrary::default())?;

    let mut id = new_background_id();
    while library.items.iter().any(|item| item.id == id) {
        id = new_background_id();
    }
    let file_name = format!("{id}.jpg");
    fs::write(dir.join(&file_name), bytes).map_err(|error| error.to_string())?;

    let item = BackgroundInfo {
        id,
        file_name,
        name: name.trim().to_string(),
    };
    library.items.push(item.clone());
    write_json(&app, BACKGROUNDS_FILE, &library)?;
    Ok(item)
}

#[tauri::command]
fn read_background(app: AppHandle, file_name: String) -> Result<Vec<u8>, String> {
    let safe_name = safe_background_file_name(&file_name);
    if safe_name != file_name {
        return Err("Недопустимое имя файла фона".to_string());
    }
    fs::read(backgrounds_dir(&app)?.join(safe_name)).map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_background(app: AppHandle, id: String, name: String) -> Result<String, String> {
    let mut library =
        read_json::<BackgroundLibrary>(&app, BACKGROUNDS_FILE, BackgroundLibrary::default())?;
    let item = library
        .items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "Фон не найден".to_string())?;
    item.name = name.trim().to_string();
    let next = item.name.clone();
    write_json(&app, BACKGROUNDS_FILE, &library)?;
    Ok(next)
}

#[tauri::command]
fn delete_background(app: AppHandle, id: String) -> Result<(), String> {
    let mut library =
        read_json::<BackgroundLibrary>(&app, BACKGROUNDS_FILE, BackgroundLibrary::default())?;
    let index = library
        .items
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| "Фон не найден".to_string())?;
    let item = library.items.remove(index);
    let _ = fs::remove_file(backgrounds_dir(&app)?.join(&item.file_name));
    write_json(&app, BACKGROUNDS_FILE, &library)?;

    let mut states = read_json::<HashMap<String, CharacterBackgrounds>>(
        &app,
        CHARACTER_BACKGROUNDS_FILE,
        HashMap::new(),
    )?;
    for state in states.values_mut() {
        state.attached_ids.retain(|value| value != &id);
        if state.active_id == id {
            state.active_id = DEFAULT_BACKGROUND_ID.to_string();
        }
        normalize_character_backgrounds(state);
    }
    write_json(&app, CHARACTER_BACKGROUNDS_FILE, &states)
}

#[tauri::command]
fn read_character_backgrounds(
    app: AppHandle,
    character_id: String,
) -> Result<CharacterBackgrounds, String> {
    let states = read_json::<HashMap<String, CharacterBackgrounds>>(
        &app,
        CHARACTER_BACKGROUNDS_FILE,
        HashMap::new(),
    )?;
    Ok(states
        .get(&character_id)
        .cloned()
        .unwrap_or_else(CharacterBackgrounds::default))
}

#[tauri::command]
fn write_character_backgrounds(
    app: AppHandle,
    character_id: String,
    state: CharacterBackgrounds,
) -> Result<(), String> {
    let mut state = state;
    normalize_character_backgrounds(&mut state);
    let mut states = read_json::<HashMap<String, CharacterBackgrounds>>(
        &app,
        CHARACTER_BACKGROUNDS_FILE,
        HashMap::new(),
    )?;
    states.insert(character_id, state);
    write_json(&app, CHARACTER_BACKGROUNDS_FILE, &states)
}

#[tauri::command]
fn validate_gguf(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
fn validate_runner(path: String) -> bool {
    Path::new(&path).is_file()
}

fn log_tail(path: &Path) -> String {
    match fs::read_to_string(path) {
        Ok(raw) => raw
            .chars()
            .rev()
            .take(2000)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect(),
        Err(_) => String::new(),
    }
}

fn append_speech_debug_line(app: &AppHandle, line: &str) {
    let path = match json_path(app, STT_DEBUG_FILE) {
        Ok(path) => path,
        Err(_) => return,
    };
    let previous = fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<&str> = previous.lines().collect();
    lines.push(line);
    while lines.len() > 120 {
        lines.remove(0);
    }
    let mut text = lines.join("\n");
    text.push('\n');
    let _ = fs::write(path, text);
}

#[tauri::command]
fn speech_debug(app: AppHandle, message: String) -> Result<(), String> {
    append_speech_debug_line(&app, &message);
    Ok(())
}

fn set_model_status(
    state: &Mutex<ModelProcess>,
    status: &str,
    message: String,
) -> Result<(), String> {
    let mut process = state.lock().map_err(|error| error.to_string())?;
    process.status = status.to_string();
    process.message = message;
    Ok(())
}

fn port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn process_command(pid: u32) -> Option<String> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if command.is_empty() {
        None
    } else {
        Some(command)
    }
}

fn process_matches(pid: u32, marker: &str) -> bool {
    process_command(pid)
        .map(|command| command.contains(marker))
        .unwrap_or(false)
}

fn is_llama_process(pid: u32) -> bool {
    process_matches(pid, "llama-server")
}

fn is_crispasr_process(pid: u32) -> bool {
    process_matches(pid, "crispasr")
}

fn terminate_pid(pid: u32, force: bool) {
    let mut command = Command::new("kill");
    if force {
        command.arg("-9");
    }
    let _ = command.arg(pid.to_string()).output();
}

fn wait_pid_exit_matching(pid: u32, marker: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !process_matches(pid, marker) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn wait_pid_exit(pid: u32, timeout: Duration) -> bool {
    wait_pid_exit_matching(pid, "llama-server", timeout)
}

fn listener_pid_matching(port: u16, marker: &str) -> Option<u32> {
    let output = Command::new("lsof")
        .args(["-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            if process_matches(pid, marker) {
                return Some(pid);
            }
        }
    }
    None
}

fn llama_listener_pid(port: u16) -> Option<u32> {
    listener_pid_matching(port, "llama-server")
}

fn crispasr_listener_pid(port: u16) -> Option<u32> {
    listener_pid_matching(port, "crispasr")
}

fn remove_model_pid(app: &AppHandle) {
    if let Ok(path) = json_path(app, MODEL_PID_FILE) {
        let _ = fs::remove_file(path);
    }
}

fn kill_model_child(app: &AppHandle, state: &Mutex<ModelProcess>) -> Result<(), String> {
    let mut pids = Vec::new();
    if let Some(info) = read_json::<Option<ModelPid>>(app, MODEL_PID_FILE, None)
        .ok()
        .flatten()
    {
        pids.push(info.pid);
    }
    let port = read_json::<AppSettings>(app, SETTINGS_FILE, AppSettings::default())
        .ok()
        .map(|settings| settings.port);
    if let Some(port) = port {
        if let Some(pid) = llama_listener_pid(port) {
            pids.push(pid);
        }
    }

    {
        let mut process = state.lock().map_err(|error| error.to_string())?;
        if let Some(child) = process.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        process.child = None;
        process.status = "idle".to_string();
        process.message.clear();
    }

    pids.sort_unstable();
    pids.dedup();
    for pid in pids {
        if !is_llama_process(pid) {
            continue;
        }
        terminate_pid(pid, false);
        if !wait_pid_exit(pid, Duration::from_secs(3)) {
            terminate_pid(pid, true);
            wait_pid_exit(pid, Duration::from_secs(1));
        }
    }

    remove_model_pid(app);
    Ok(())
}

#[tauri::command]
fn start_model(
    app: AppHandle,
    state: State<'_, Mutex<ModelProcess>>,
) -> Result<ModelStatus, String> {
    let settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    if settings.gguf_path.is_empty() {
        return Err("Выберите файл GGUF".to_string());
    }
    if !Path::new(&settings.gguf_path).is_file() {
        return Err("Файл GGUF не найден".to_string());
    }
    if !Path::new(&settings.runner_path).is_file() {
        return Err("llama-server не найден".to_string());
    }
    if settings.port == 0 {
        return Err("Укажите корректный порт".to_string());
    }
    if settings.local_vision {
        if settings.mmproj_path.trim().is_empty() {
            return Err("Выберите файл mmproj для поддержки изображений".to_string());
        }
        if !Path::new(&settings.mmproj_path).is_file() {
            return Err("Файл mmproj не найден".to_string());
        }
    }

    kill_model_child(&app, state.inner())?;
    set_model_status(state.inner(), "loading", "Загрузка модели…".to_string())?;

    let runner = PathBuf::from(&settings.runner_path);
    let working_dir = runner.parent().unwrap_or_else(|| Path::new("."));
    let log_path = json_path(&app, MODEL_LOG_FILE)?;
    let stdout = fs::File::create(&log_path).map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;

    let mut command = Command::new(&runner);
    command
        .current_dir(working_dir)
        .arg("-m")
        .arg(&settings.gguf_path);
    if settings.local_vision {
        command.arg("--mmproj").arg(&settings.mmproj_path);
    }
    command
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(settings.port.to_string())
        .arg("-ngl")
        .arg("99")
        .arg("-fa")
        .arg("on")
        .arg("-c")
        .arg(settings.context_size.to_string())
        .arg("--jinja")
        .arg("--no-repack")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    match settings.kv_cache {
        KvCache::F16 => {}
        KvCache::Q8_0 => {
            command.arg("-ctk").arg("q8_0").arg("-ctv").arg("q8_0");
        }
    }

    match settings.reasoning {
        Reasoning::Off => {
            command.arg("--reasoning").arg("off");
        }
        Reasoning::Low | Reasoning::Medium | Reasoning::High => {
            let effort = match settings.reasoning {
                Reasoning::Low => "low",
                Reasoning::Medium => "medium",
                Reasoning::High => "high",
                Reasoning::Off => "off",
            };
            command
                .arg("--reasoning")
                .arg("on")
                .arg("--reasoning-effort")
                .arg(effort);
        }
    }

    let child = command.spawn().map_err(|error| {
        set_model_status(
            state.inner(),
            "error",
            format!("Не удалось запустить llama-server: {error}"),
        )
        .ok();
        format!("Не удалось запустить llama-server: {error}")
    })?;
    let pid = child.id();
    {
        let mut process = state.lock().map_err(|error| error.to_string())?;
        process.child = Some(child);
    }
    write_json(
        &app,
        MODEL_PID_FILE,
        &ModelPid {
            pid,
            port: settings.port,
        },
    )
    .ok();

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        {
            let mut process = state.lock().map_err(|error| error.to_string())?;
            if let Some(child) = process.child.as_mut() {
                if let Ok(Some(code)) = child.try_wait() {
                    process.child = None;
                    process.status = "error".to_string();
                    process.message = format!("Процесс завершился ({code}). {}", log_tail(&log_path));
                    remove_model_pid(&app);
                    return Ok(process.status());
                }
            }
        }

        if TcpStream::connect(("127.0.0.1", settings.port)).is_ok() {
            let mut process = state.lock().map_err(|error| error.to_string())?;
            process.status = "loaded".to_string();
            process.message = format!("Модель загружена на порту {}", settings.port);
            return Ok(process.status());
        }

        if Instant::now() >= deadline {
            let mut process = state.lock().map_err(|error| error.to_string())?;
            process.status = "error".to_string();
            process.message = format!("Таймаут загрузки. {}", log_tail(&log_path));
            return Ok(process.status());
        }

        thread::sleep(Duration::from_millis(250));
    }
}

#[tauri::command]
fn stop_model(app: AppHandle, state: State<'_, Mutex<ModelProcess>>) -> Result<ModelStatus, String> {
    kill_model_child(&app, state.inner())?;
    Ok(state.lock().map_err(|error| error.to_string())?.status())
}

#[tauri::command]
fn model_status(app: AppHandle, state: State<'_, Mutex<ModelProcess>>) -> Result<ModelStatus, String> {
    let mut process = state.lock().map_err(|error| error.to_string())?;
    if let Some(child) = process.child.as_mut() {
        if let Ok(Some(code)) = child.try_wait() {
            process.child = None;
            process.status = "error".to_string();
            process.message = format!("Процесс завершился ({code}). Проверьте лог.");
            remove_model_pid(&app);
        }
    }

    let settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    if process.status != "loaded" && port_open(settings.port) {
        if let Some(pid) = llama_listener_pid(settings.port) {
            process.status = "loaded".to_string();
            process.message = format!("Модель уже запущена на порту {}", settings.port);
            write_json(
                &app,
                MODEL_PID_FILE,
                &ModelPid {
                    pid,
                    port: settings.port,
                },
            )
            .ok();
        }
    } else if process.status == "loaded" && !port_open(settings.port) {
        process.status = "idle".to_string();
        process.message.clear();
        remove_model_pid(&app);
    }

    Ok(process.status())
}

fn set_stt_status(
    state: &Mutex<SttProcess>,
    status: &str,
    message: String,
) -> Result<(), String> {
    let mut process = state.lock().map_err(|error| error.to_string())?;
    process.status = status.to_string();
    process.message = message;
    Ok(())
}

fn remove_stt_pid(app: &AppHandle) {
    if let Ok(path) = json_path(app, STT_PID_FILE) {
        let _ = fs::remove_file(path);
    }
}

fn kill_stt_child(app: &AppHandle, state: &Mutex<SttProcess>) -> Result<(), String> {
    let mut pids = Vec::new();
    if let Some(info) = read_json::<Option<SttPid>>(app, STT_PID_FILE, None)
        .ok()
        .flatten()
    {
        pids.push(info.pid);
    }
    let port = read_json::<AppSettings>(app, SETTINGS_FILE, AppSettings::default())
        .ok()
        .map(|settings| settings.speech.stt_port);
    if let Some(port) = port {
        if let Some(pid) = crispasr_listener_pid(port) {
            pids.push(pid);
        }
    }

    {
        let mut process = state.lock().map_err(|error| error.to_string())?;
        if let Some(child) = process.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        process.child = None;
        process.status = "idle".to_string();
        process.message.clear();
    }

    pids.sort_unstable();
    pids.dedup();
    for pid in pids {
        if !is_crispasr_process(pid) {
            continue;
        }
        terminate_pid(pid, false);
        if !wait_pid_exit_matching(pid, "crispasr", Duration::from_secs(3)) {
            terminate_pid(pid, true);
            wait_pid_exit_matching(pid, "crispasr", Duration::from_secs(1));
        }
    }

    remove_stt_pid(app);
    Ok(())
}

fn speech_language(language: &str) -> String {
    let code = language
        .split(['-', '_'])
        .next()
        .unwrap_or("en")
        .trim()
        .to_ascii_lowercase();
    const SUPPORTED: [&str; 23] = [
        "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv",
        "lt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "uk",
    ];
    if SUPPORTED.contains(&code.as_str()) {
        code
    } else {
        "en".to_string()
    }
}

fn emit_download_progress(
    app: &AppHandle,
    quant: SpeechQuant,
    loaded: u64,
    total: u64,
    done: bool,
    cancelled: bool,
) {
    let percent = if total == 0 {
        0
    } else {
        ((loaded * 100) / total).min(100) as u32
    };
    let _ = app.emit_to(
        "settings",
        "speech-download-progress",
        SpeechDownloadProgress {
            quant,
            loaded,
            total,
            percent,
            done,
            cancelled,
        },
    );
}

#[tauri::command]
fn speech_model_info(app: AppHandle, quant: SpeechQuant) -> Result<SpeechModelInfo, String> {
    let path = speech_model_path(&app, quant)?;
    let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let expected_size = quant.expected_size();
    Ok(SpeechModelInfo {
        quant,
        file_name: quant.file_name().to_string(),
        path: path.to_string_lossy().to_string(),
        exists: path.is_file(),
        valid: path.is_file() && size == expected_size,
        size,
        expected_size,
    })
}

#[tauri::command]
fn speech_runtime_info(app: AppHandle) -> Result<SpeechRuntimeInfo, String> {
    let dir = crispasr_runtime_dir(&app)?;
    Ok(SpeechRuntimeInfo {
        available: dir.join("crispasr").is_file() && dir.join("libc2pa_c.dylib").is_file(),
        binary_path: dir.join("crispasr").to_string_lossy().to_string(),
        version: CRISPASR_VERSION,
    })
}

#[tauri::command]
async fn download_speech_model(app: AppHandle, quant: SpeechQuant) -> Result<String, String> {
    if SPEECH_DOWNLOAD_ACTIVE.load(Ordering::SeqCst) {
        return Err("Загрузка модели уже идёт".to_string());
    }
    SPEECH_DOWNLOAD_ACTIVE.store(true, Ordering::SeqCst);
    SPEECH_DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);

    let result: Result<String, String> = async {
        let dir = speech_models_dir(&app)?;
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let final_path = speech_model_path(&app, quant)?;
        let part_path = dir.join(format!("{}.part", quant.file_name()));
        let expected = quant.expected_size();

        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}?download=true",
            PARAKEET_REPO,
            quant.file_name()
        );
        let client = reqwest::Client::builder()
            .user_agent("vrmapp-parakeet-downloader")
            .build()
            .map_err(|error| error.to_string())?;
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;

        if let Some(content_length) = response.content_length() {
            if content_length != expected {
                return Err(format!(
                    "HF вернул размер {} байт, ожидалось {}",
                    content_length, expected
                ));
            }
        }

        let mut file = fs::File::create(&part_path).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut loaded = 0u64;
        let mut last_percent = 0u32;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            if SPEECH_DOWNLOAD_CANCELLED.load(Ordering::SeqCst) {
                let _ = fs::remove_file(&part_path);
                emit_download_progress(&app, quant, loaded, expected, true, true);
                return Err("Загрузка отменена".to_string());
            }
            let chunk = chunk.map_err(|error| error.to_string())?;
            file.write_all(&chunk).map_err(|error| error.to_string())?;
            hasher.update(&chunk);
            loaded += chunk.len() as u64;
            let percent = ((loaded * 100) / expected).min(100) as u32;
            if percent != last_percent {
                last_percent = percent;
                emit_download_progress(&app, quant, loaded, expected, false, false);
            }
        }

        file.flush().map_err(|error| error.to_string())?;
        drop(file);

        if loaded != expected {
            let _ = fs::remove_file(&part_path);
            return Err(format!(
                "Неверный размер файла: {} байт, ожидалось {}",
                loaded, expected
            ));
        }
        let digest = format!("{:x}", hasher.finalize());
        if digest != quant.sha256() {
            let _ = fs::remove_file(&part_path);
            return Err("SHA-256 модели не совпал".to_string());
        }

        fs::rename(&part_path, &final_path).map_err(|error| error.to_string())?;
        emit_download_progress(&app, quant, loaded, expected, true, false);
        Ok(final_path.to_string_lossy().to_string())
    }
    .await;

    SPEECH_DOWNLOAD_ACTIVE.store(false, Ordering::SeqCst);
    SPEECH_DOWNLOAD_CANCELLED.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn cancel_speech_download() -> Result<(), String> {
    if SPEECH_DOWNLOAD_ACTIVE.load(Ordering::SeqCst) {
        SPEECH_DOWNLOAD_CANCELLED.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn delete_speech_model(app: AppHandle, quant: SpeechQuant) -> Result<(), String> {
    let path = speech_model_path(&app, quant)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn stt_status(app: AppHandle, state: State<'_, Mutex<SttProcess>>) -> Result<ModelStatus, String> {
    let mut process = state.lock().map_err(|error| error.to_string())?;
    if let Some(child) = process.child.as_mut() {
        if let Ok(Some(code)) = child.try_wait() {
            process.child = None;
            process.status = "error".to_string();
            process.message = format!("Процесс CrispASR завершился ({code}). {}", log_tail(&json_path(&app, STT_LOG_FILE)?));
            remove_stt_pid(&app);
        }
    }

    let settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    let port = settings.speech.stt_port;
    if process.status != "loaded" && port_open(port) {
        if let Some(pid) = crispasr_listener_pid(port) {
            process.status = "loaded".to_string();
            process.message = format!("Локальный STT уже запущен на порту {port}");
            write_json(
                &app,
                STT_PID_FILE,
                &SttPid { pid, port },
            )
            .ok();
        }
    } else if process.status == "loaded" && !port_open(port) {
        process.status = "idle".to_string();
        process.message.clear();
        remove_stt_pid(&app);
    }
    Ok(process.status())
}

#[tauri::command]
fn stt_start(
    app: AppHandle,
    state: State<'_, Mutex<SttProcess>>,
) -> Result<ModelStatus, String> {
    let settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    let port = settings.speech.stt_port;
    let model_path = speech_model_path(&app, settings.speech.local_quant)?;
    append_speech_debug_line(
        &app,
        &format!(
            "stt_start port={} quant={:?} model_exists={}",
            port,
            settings.speech.local_quant,
            model_path.is_file()
        ),
    );
    if !model_path.is_file() {
        return Err("Модель Parakeet не скачана".to_string());
    }
    let runtime_dir = crispasr_runtime_dir(&app)?;
    let binary = runtime_dir.join("crispasr");
    if !binary.is_file() {
        return Err("Встроенный CrispASR не найден".to_string());
    }
    if port == 0 {
        return Err("Укажите корректный STT-порт".to_string());
    }

    if let Some(pid) = crispasr_listener_pid(port) {
        set_stt_status(
            state.inner(),
            "loaded",
            format!("Локальный STT уже запущен на порту {port}"),
        )?;
        write_json(
            &app,
            STT_PID_FILE,
            &SttPid { pid, port },
        )
        .ok();
        return Ok(state.lock().map_err(|error| error.to_string())?.status());
    }

    kill_stt_child(&app, state.inner())?;
    set_stt_status(state.inner(), "loading", "Загрузка локального STT…".to_string())?;

    let log_path = json_path(&app, STT_LOG_FILE)?;
    let stdout = fs::File::create(&log_path).map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let language = speech_language(&settings.speech.language);

    let child = Command::new(&binary)
        .current_dir(&runtime_dir)
        .env("DYLD_LIBRARY_PATH", &runtime_dir)
        .arg("--server")
        .arg("--backend")
        .arg("parakeet")
        .arg("-m")
        .arg(&model_path)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-l")
        .arg(&language)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| {
            set_stt_status(
                state.inner(),
                "error",
                format!("Не удалось запустить CrispASR: {error}"),
            )
            .ok();
            format!("Не удалось запустить CrispASR: {error}")
        })?;

    let pid = child.id();
    {
        let mut process = state.lock().map_err(|error| error.to_string())?;
        process.child = Some(child);
    }
    write_json(&app, STT_PID_FILE, &SttPid { pid, port }).ok();

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        {
            let mut process = state.lock().map_err(|error| error.to_string())?;
            if let Some(child) = process.child.as_mut() {
                if let Ok(Some(code)) = child.try_wait() {
                    process.child = None;
                    process.status = "error".to_string();
                    process.message = format!("Процесс CrispASR завершился ({code}). {}", log_tail(&log_path));
                    remove_stt_pid(&app);
                    return Ok(process.status());
                }
            }
        }
        if port_open(port) {
            let mut process = state.lock().map_err(|error| error.to_string())?;
            process.status = "loaded".to_string();
            process.message = format!("Локальный STT готов на порту {port}");
            return Ok(process.status());
        }
        if Instant::now() >= deadline {
            let mut process = state.lock().map_err(|error| error.to_string())?;
            process.status = "error".to_string();
            process.message = format!("Таймаут загрузки STT. {}", log_tail(&log_path));
            return Ok(process.status());
        }
        thread::sleep(Duration::from_millis(200));
    }
}

#[tauri::command]
fn stt_stop(app: AppHandle, state: State<'_, Mutex<SttProcess>>) -> Result<ModelStatus, String> {
    kill_stt_child(&app, state.inner())?;
    Ok(state.lock().map_err(|error| error.to_string())?.status())
}

#[tauri::command]
async fn transcribe_audio(app: AppHandle, bytes: Vec<u8>, language: String) -> Result<String, String> {
    let settings = read_json::<AppSettings>(&app, SETTINGS_FILE, AppSettings::default())?;
    let port = settings.speech.stt_port;
    if !port_open(port) {
        return Err("Локальный STT не запущен".to_string());
    }

    let byte_count = bytes.len();
    if let Ok(path) = json_path(&app, "speech-capture.wav") {
        let _ = fs::write(path, &bytes);
    }
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("response_format", "json")
        .text("language", speech_language(&language));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post(format!("http://127.0.0.1:{port}/v1/audio/transcriptions"))
        .multipart(form)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    append_speech_debug_line(
        &app,
        &format!(
            "transcribe bytes={} lang={} status={} body={}",
            byte_count,
            speech_language(&language),
            status,
            body.chars().take(600).collect::<String>()
        ),
    );
    if !status.is_success() {
        return Err(format!("CrispASR: {status} {body}"));
    }
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let text = value
        .get("text")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(text)
}

#[tauri::command]
fn list_vrm_models(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = models_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut names = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            if name.to_ascii_lowercase().ends_with(".vrm") {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
fn save_vrm_model(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = models_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let file_name = unique_file_name(&dir, &name);
    fs::write(dir.join(&file_name), bytes).map_err(|error| error.to_string())?;
    Ok(file_name)
}

#[tauri::command]
fn read_vrm_model(app: AppHandle, file_name: String) -> Result<Vec<u8>, String> {
    let safe_name = safe_file_name(&file_name);
    if safe_name != file_name {
        return Err("Недопустимое имя файла модели".to_string());
    }
    fs::read(models_dir(&app)?.join(safe_name)).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_vrm_model_base64(app: AppHandle, file_name: String) -> Result<String, String> {
    let safe_name = safe_file_name(&file_name);
    if safe_name != file_name {
        return Err("Недопустимое имя файла модели".to_string());
    }
    let bytes = fs::read(models_dir(&app)?.join(safe_name)).map_err(|error| error.to_string())?;
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes,
    ))
}

#[tauri::command]
fn save_vrm_preview(app: AppHandle, model_id: String, bytes: Vec<u8>) -> Result<(), String> {
    let dir = vrm_previews_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    fs::write(dir.join(vrm_preview_file_name(&model_id)), bytes).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_vrm_preview(app: AppHandle, model_id: String) -> Result<Vec<u8>, String> {
    fs::read(vrm_previews_dir(&app)?.join(vrm_preview_file_name(&model_id)))
        .map_err(|error| error.to_string())
}

fn update_character_model_refs(
    app: &AppHandle,
    from: &str,
    to: Option<&str>,
) -> Result<(), String> {
    let mut characters = read_json::<Vec<StoredCharacter>>(app, CHARACTERS_FILE, Vec::new())?;
    for character in characters.iter_mut() {
        if character.model_id == from {
            character.model_id = to
                .map(str::to_string)
                .unwrap_or_else(|| DEFAULT_MODEL_ID.to_string());
        }
        for id in character.model_ids.iter_mut() {
            if id == from {
                *id = to.unwrap_or_default().to_string();
            }
        }
        character.model_ids.retain(|id| !id.is_empty());
    }
    normalize_character_models(&mut characters);
    persist_characters(app, &characters)
}

#[tauri::command]
fn delete_vrm_model(app: AppHandle, file_name: String) -> Result<(), String> {
    let safe_name = safe_file_name(&file_name);
    if safe_name != file_name {
        return Err("Недопустимое имя файла модели".to_string());
    }
    fs::remove_file(models_dir(&app)?.join(&safe_name)).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(
        vrm_previews_dir(&app)?.join(vrm_preview_file_name(&safe_name)),
    );
    update_character_model_refs(&app, &safe_name, None)
}

#[tauri::command]
fn rename_vrm_model(
    app: AppHandle,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    let safe_old = safe_file_name(&old_name);
    if safe_old != old_name {
        return Err("Недопустимое имя файла модели".to_string());
    }
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Введите новое имя модели".to_string());
    }

    let dir = models_dir(&app)?;
    let source = dir.join(&safe_old);
    if !source.is_file() {
        return Err("Модель не найдена".to_string());
    }

    let target_name = unique_file_name(&dir, trimmed);
    if target_name == safe_old {
        return Ok(safe_old);
    }
    fs::rename(&source, dir.join(&target_name)).map_err(|error| error.to_string())?;
    let previews = vrm_previews_dir(&app)?;
    let old_preview = previews.join(vrm_preview_file_name(&safe_old));
    if old_preview.is_file() {
        let _ = fs::rename(old_preview, previews.join(vrm_preview_file_name(&target_name)));
    }
    update_character_model_refs(&app, &safe_old, Some(&target_name))?;
    Ok(target_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "prerelease")]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                app.handle()
                    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))?;
                let launch_at_login = read_settings(app.handle().clone())
                    .map(|settings| settings.launch_at_login)
                    .unwrap_or(false);
                sync_autostart(app.handle(), launch_at_login);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_settings,
            write_settings,
            capture_screen,
            save_chat_image,
            read_chat_image,
            open_chat_image,
            api_chat_completion,
            api_list_models,
            write_layout_settings,
            open_data_dir,
            set_active_character,
            read_characters,
            write_characters,
            read_chat,
            append_chat_message,
            clear_chat,
            list_group_chats,
            mark_chat_messages_read,
            read_chat_summary,
            write_chat_summary,
            read_view_transform,
            write_view_transform,
            list_backgrounds,
            save_background,
            read_background,
            rename_background,
            delete_background,
            read_character_backgrounds,
            write_character_backgrounds,
            validate_gguf,
            validate_runner,
            start_model,
            stop_model,
            model_status,
            speech_model_info,
            speech_runtime_info,
            download_speech_model,
            cancel_speech_download,
            delete_speech_model,
            stt_status,
            stt_start,
            stt_stop,
            transcribe_audio,
            speech_debug,
            list_vrm_models,
            save_vrm_model,
            read_vrm_model,
            read_vrm_model_base64,
            save_vrm_preview,
            read_vrm_preview,
            rename_vrm_model,
            delete_vrm_model
        ])
        .manage(Mutex::new(ModelProcess::default()))
        .manage(Mutex::new(SttProcess::default()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<Mutex<ModelProcess>>();
                kill_model_child(&app, state.inner()).ok();
                let stt_state = app.state::<Mutex<SttProcess>>();
                kill_stt_child(&app, stt_state.inner()).ok();
            }
        });
}
