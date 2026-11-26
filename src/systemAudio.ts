import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const SYSTEM_AUDIO_EVENT = "system-audio-chunk";

export type SystemAudioStatus = {
  running: boolean;
  error: string | null;
  chunks: number;
  sampleRate: number;
};

export function startSystemAudio(): Promise<void> {
  return invoke("start_system_audio");
}

export function stopSystemAudio(): Promise<void> {
  return invoke("stop_system_audio");
}

export function systemAudioStatus(): Promise<SystemAudioStatus> {
  return invoke("system_audio_status");
}

/** Subscribe to base64-encoded mono i16 PCM chunks from Rust. */
export function onSystemAudioChunk(
  handler: (samples: Int16Array) => void,
): Promise<() => void> {
  return listen<string>(SYSTEM_AUDIO_EVENT, (event) => {
    const binary = atob(event.payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    handler(new Int16Array(bytes.buffer));
  });
}
