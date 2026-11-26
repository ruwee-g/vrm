export const NAVBAR_BUTTONS = [
  { id: "chat", label: "Чат", locked: true },
  { id: "group", label: "Беседа" },
  { id: "screen", label: "Поделиться экраном" },
  { id: "bg", label: "Фон" },
  { id: "reactions", label: "Эмоции" },
  { id: "mic", label: "Микрофон" },
  { id: "view", label: "Редактировать вид" },
  { id: "display", label: "Режим отображения" },
  { id: "user", label: "Персонажи" },
  { id: "outfit", label: "Одежда" },
  { id: "settings", label: "Настройки", locked: true },
  { id: "power", label: "Питание модели", locked: true },
] as const;

export type NavbarButtonId = (typeof NAVBAR_BUTTONS)[number]["id"];

const BUTTON_IDS = new Set<string>(NAVBAR_BUTTONS.map((button) => button.id));
const LOCKED_IDS = new Set<string>(
  NAVBAR_BUTTONS.filter((button) => "locked" in button && button.locked).map(
    (button) => button.id,
  ),
);

export function isLockedNavbarButton(id: string): boolean {
  return LOCKED_IDS.has(id);
}

/** Drop unknown and forced-visible ids so persisted settings stay clean. */
export function normalizeHiddenNavbarButtons(value: unknown): NavbarButtonId[] {
  if (!Array.isArray(value)) return [];
  const result: NavbarButtonId[] = [];
  for (const id of value) {
    if (
      typeof id === "string" &&
      BUTTON_IDS.has(id) &&
      !LOCKED_IDS.has(id) &&
      !result.includes(id as NavbarButtonId)
    ) {
      result.push(id as NavbarButtonId);
    }
  }
  return result;
}

export function isNavbarButtonVisible(
  id: string,
  hidden: readonly string[],
): boolean {
  return LOCKED_IDS.has(id) || !hidden.includes(id);
}
