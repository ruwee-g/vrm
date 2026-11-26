import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readSettings, type Theme } from "./store";

const THEME_STORAGE_KEY = "vrm-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in restricted webviews; the DOM theme still applies.
  }
}

export function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Fall through to the default theme.
  }
  return "light";
}

export async function syncThemeFromSettings(): Promise<void> {
  const settings = await readSettings();
  applyTheme(isTheme(settings.theme) ? settings.theme : "light");
}

export async function writeTheme(theme: Theme): Promise<void> {
  applyTheme(theme);
  await invoke("write_theme", { theme });
}

export async function listenThemeChanges(
  onChange?: (theme: Theme) => void,
): Promise<() => void> {
  return listen<Theme>("theme-changed", ({ payload }) => {
    if (!isTheme(payload)) return;
    applyTheme(payload);
    onChange?.(payload);
  });
}
