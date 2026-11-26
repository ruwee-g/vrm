import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { IS_PRERELEASE } from "./channel";

export type UpdateInfo = {
  version: string;
  notes: string;
  date: string;
};

type UpdateListener = (info: UpdateInfo | null) => void;

const UPDATE_EVENT = "vrm:update-state";

let currentInfo: UpdateInfo | null = null;
let currentUpdate: Update | null = null;
let pendingCheck: Promise<UpdateInfo | null> | null = null;
let watching = false;
const listeners = new Set<UpdateListener>();

function toInfo(update: Update | null): UpdateInfo | null {
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body?.trim() ?? "",
    date: update.date ?? "",
  };
}

function publish(broadcast: boolean) {
  listeners.forEach((listener) => listener(currentInfo));
  if (broadcast) void emit(UPDATE_EVENT, currentInfo).catch(() => undefined);
}

export function subscribeToUpdates(listener: UpdateListener): () => void {
  listeners.add(listener);
  listener(currentInfo);
  return () => {
    listeners.delete(listener);
  };
}

export async function currentAppVersion(): Promise<string> {
  return getVersion();
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!IS_PRERELEASE) return null;
  if (pendingCheck) return pendingCheck;

  pendingCheck = (async () => {
    try {
      const update = await check({ timeout: 10000 });
      if (currentUpdate && currentUpdate !== update) {
        await currentUpdate.close().catch(() => undefined);
      }
      currentUpdate = update;
      currentInfo = toInfo(update);
      publish(true);
      return currentInfo;
    } catch (error) {
      console.error("Не удалось проверить обновления", error);
      return currentInfo;
    } finally {
      pendingCheck = null;
    }
  })();

  return pendingCheck;
}

export async function installAvailableUpdate(): Promise<void> {
  if (!currentUpdate) {
    const update = await check({ timeout: 10000 });
    if (!update) throw new Error("Обновление больше недоступно");
    currentUpdate = update;
    currentInfo = toInfo(update);
  }

  await currentUpdate.downloadAndInstall();
  await currentUpdate.close().catch(() => undefined);
  currentUpdate = null;
  currentInfo = null;
  publish(true);
}

export async function startUpdateWatcher(): Promise<void> {
  if (!IS_PRERELEASE || watching) return;
  watching = true;

  await listen<UpdateInfo | null>(UPDATE_EVENT, (event) => {
    currentInfo = event.payload;
    currentUpdate = null;
    listeners.forEach((listener) => listener(currentInfo));
  });

  void checkForUpdates();
}
