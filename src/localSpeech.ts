const TARGET_RATE = 16000;
const DEFAULT_THRESHOLD = 0.006;
const DEFAULT_SILENCE_MS = 900;
const DEFAULT_WAIT_MS = 8000;
const DEFAULT_MAX_MS = 15000;
const EDGE_PAD_MS = 300;

export type LocalCaptureStats = {
  sourceRate: number;
  durationMs: number;
  voiceMs: number;
  peakRms: number;
  lastRms: number;
  threshold: number;
  wavPeak: number;
  wavBytes: number;
};

type RecorderOptions = {
  threshold?: number;
  silenceMs?: number;
  waitMs?: number;
  maxMs?: number;
  onLevel?: (level: number) => void;
  onStats?: (stats: LocalCaptureStats) => void;
};

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as {
    webkitAudioContext?: typeof AudioContext;
  };
  return window.AudioContext ?? holder.webkitAudioContext ?? null;
}

export function isLocalSpeechSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!audioContextConstructor()
  );
}

function describeCaptureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Разрешите доступ к микрофону в настройках системы";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Микрофон не найден";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Микрофон занят другим приложением";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось записать речь";
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    output[i] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export class LocalMicRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private firstVoiceSample: number | null = null;
  private lastVoiceSample: number | null = null;
  private startedAt = 0;
  private lastVoiceAt = 0;
  private peakRms = 0;
  private lastRms = 0;
  private noiseSamples: number[] = [];
  private threshold: number | null = null;
  private wavPeak = 0;
  private options: RecorderOptions = {};
  private activePromise: Promise<Uint8Array> | null = null;
  private resolvePromise: ((wav: Uint8Array) => void) | null = null;
  private rejectPromise: ((error: unknown) => void) | null = null;
  private settled = false;
  private stopRequested = false;
  private cancelRequested = false;

  record(options: RecorderOptions = {}): Promise<Uint8Array> {
    if (this.activePromise) return this.activePromise;
    this.options = options;
    this.settled = false;
    this.stopRequested = false;
    this.cancelRequested = false;
    this.chunks = [];
    this.totalSamples = 0;
    this.firstVoiceSample = null;
    this.lastVoiceSample = null;
    this.peakRms = 0;
    this.lastRms = 0;
    this.noiseSamples = [];
    this.threshold = null;
    this.wavPeak = 0;
    this.activePromise = new Promise<Uint8Array>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    void this.setup(options).catch((error) => this.fail(error));
    return this.activePromise;
  }

  stop(): void {
    this.stopRequested = true;
    if (this.startedAt > 0 && !this.settled) this.finish();
  }

  cancel(): void {
    this.cancelRequested = true;
    this.stopRequested = true;
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise?.(new Uint8Array(0));
    this.cleanup();
  }

  private async setup(options: RecorderOptions): Promise<void> {
    if (!isLocalSpeechSupported()) {
      throw new Error("Локальная запись речи недоступна в этом окне");
    }
    const Constructor = audioContextConstructor();
    if (!Constructor) throw new Error("Локальная запись речи недоступна в этом окне");

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.stream = stream;

    if (this.cancelRequested) {
      this.cancel();
      return;
    }

    let context: AudioContext;
    try {
      context = new Constructor({ sampleRate: TARGET_RATE });
    } catch {
      context = new Constructor();
    }
    this.context = context;
    await context.resume();

    const source = context.createMediaStreamSource(stream);
    source.channelCount = 1;
    source.channelCountMode = "explicit";
    source.channelInterpretation = "speakers";
    this.source = source;

    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;
    processor.onaudioprocess = (event) => {
      this.handleChunk(event.inputBuffer.getChannelData(0), options);
    };

    const sink = context.createGain();
    sink.gain.value = 0;
    this.sink = sink;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);

    this.startedAt = performance.now();
    this.lastVoiceAt = this.startedAt;
    if (this.stopRequested) this.finish();
  }

  private handleChunk(input: Float32Array, options: RecorderOptions): void {
    if (this.settled) return;
    const chunk = new Float32Array(input);
    const chunkStart = this.totalSamples;
    this.chunks.push(chunk);
    this.totalSamples += chunk.length;

    let sum = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      sum += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sum / Math.max(1, chunk.length));
    this.lastRms = rms;
    if (rms > this.peakRms) this.peakRms = rms;
    options.onLevel?.(rms);

    const now = performance.now();
    if (this.threshold === null) {
      this.noiseSamples.push(rms);
      if (this.noiseSamples.length >= 4) {
        const floor = Math.min(...this.noiseSamples);
        const base = options.threshold ?? DEFAULT_THRESHOLD;
        this.threshold = Math.max(0.0015, Math.min(base * 2, Math.max(base * 0.25, floor * 2.5)));
      }
    }
    const baseThreshold = this.threshold ?? options.threshold ?? DEFAULT_THRESHOLD;
    const threshold = this.firstVoiceSample === null ? baseThreshold : baseThreshold * 0.6;
    if (rms > threshold) {
      if (this.firstVoiceSample === null) this.firstVoiceSample = chunkStart;
      this.lastVoiceSample = this.totalSamples;
      this.lastVoiceAt = now;
    }

    const elapsed = now - this.startedAt;
    const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
    const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
    const maxMs = options.maxMs ?? DEFAULT_MAX_MS;

    if (this.firstVoiceSample !== null && now - this.lastVoiceAt >= silenceMs) {
      this.finish();
      return;
    }
    if (this.firstVoiceSample === null && elapsed >= waitMs) {
      this.finish();
      return;
    }
    if (elapsed >= maxMs) this.finish();
  }

  private finish(): void {
    if (this.settled) return;
    this.settled = true;
    const wav = this.makeWav();
    const sourceRate = this.context?.sampleRate ?? TARGET_RATE;
    this.options.onStats?.({
      sourceRate,
      durationMs: Math.round(performance.now() - this.startedAt),
      voiceMs:
        this.firstVoiceSample !== null && this.lastVoiceSample !== null
          ? Math.round(((this.lastVoiceSample - this.firstVoiceSample) / sourceRate) * 1000)
          : 0,
      peakRms: this.peakRms,
      lastRms: this.lastRms,
      threshold: this.threshold ?? DEFAULT_THRESHOLD,
      wavPeak: this.wavPeak,
      wavBytes: wav.byteLength,
    });
    this.resolvePromise?.(wav);
    this.cleanup();
  }

  private fail(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise?.(new Error(describeCaptureError(error)));
    this.cleanup();
  }

  private makeWav(): Uint8Array {
    if (this.firstVoiceSample === null || this.lastVoiceSample === null) {
      return new Uint8Array(0);
    }
    const sourceRate = this.context?.sampleRate ?? TARGET_RATE;
    const pad = Math.round((EDGE_PAD_MS / 1000) * sourceRate);
    const start = Math.max(0, this.firstVoiceSample - pad);
    const end = Math.min(this.totalSamples, this.lastVoiceSample + pad);
    if (end <= start) return new Uint8Array(0);

    const slice = new Float32Array(end - start);
    let offset = 0;
    for (const chunk of this.chunks) {
      const chunkStart = offset;
      const chunkEnd = offset + chunk.length;
      offset = chunkEnd;
      if (chunkEnd <= start || chunkStart >= end) continue;
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(chunk.length, end - chunkStart);
      slice.set(chunk.subarray(from, to), Math.max(0, chunkStart + from - start));
    }

    this.wavPeak = 0;
    for (let i = 0; i < slice.length; i += 1) {
      const value = Math.abs(slice[i]);
      if (value > this.wavPeak) this.wavPeak = value;
    }

    return encodeWav(resample(slice, sourceRate, TARGET_RATE), TARGET_RATE);
  }

  private cleanup(): void {
    const { processor, source, sink, stream, context } = this;
    this.processor = null;
    this.source = null;
    this.sink = null;
    this.stream = null;
    this.context = null;
    this.resolvePromise = null;
    this.rejectPromise = null;
    this.activePromise = null;

    try {
      if (processor) processor.onaudioprocess = null;
      source?.disconnect();
      processor?.disconnect();
      sink?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close().catch(() => {});
    } catch {
      // ресурсы могли быть уже закрыты
    }
  }
}
