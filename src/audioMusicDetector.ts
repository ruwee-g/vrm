/**
 * Lightweight "is this rhythmic music?" detector for system audio.
 *
 * Loudness alone cannot distinguish music from speech or background noise.
 * We look for a stable pulse train in the onset envelope inside 80–165 BPM,
 * and require that pulse to persist for several seconds before dancing.
 */

const SAMPLE_RATE = 24_000;
const FRAME_SIZE = 512;
const FFT_SIZE = 1024;
const BINS = FFT_SIZE / 2;
const HISTORY_SIZE = 600; // ~12.8 s at 21.3 ms per frame
const DETREND_FRAMES = 47; // ~1 s
const CORR_FRAMES = 235; // ~5 s
const PEAK_FRAMES = 187; // ~4 s
const EVAL_SECONDS = 0.25;

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

function fft(re: Float64Array, im: Float64Array): void {
  const size = re.length;
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const reTemp = re[i];
      re[i] = re[j];
      re[j] = reTemp;
      const imTemp = im[i];
      im[i] = im[j];
      im[j] = imTemp;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleRe = 1;
      let twiddleIm = 0;
      const half = length >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const a = start + offset;
        const b = a + half;
        const valueRe = re[b] * twiddleRe - im[b] * twiddleIm;
        const valueIm = re[b] * twiddleIm + im[b] * twiddleRe;
        re[b] = re[a] - valueRe;
        im[b] = im[a] - valueIm;
        re[a] += valueRe;
        im[a] += valueIm;
        const nextRe = twiddleRe * stepRe - twiddleIm * stepIm;
        twiddleIm = twiddleRe * stepIm + twiddleIm * stepRe;
        twiddleRe = nextRe;
      }
    }
  }
}

export class MusicDetector {
  private readonly ring = new Float32Array(FFT_SIZE);
  private ringPos = 0;
  private pending: number[] = [];
  private pendingPos = 0;

  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);
  private readonly hann = new Float64Array(FFT_SIZE);
  private readonly spectrum = new Float32Array(BINS);
  private readonly previousSpectrum = new Float32Array(BINS);

  private readonly envelope = new Float32Array(HISTORY_SIZE);
  private readonly rmsHistory = new Float32Array(HISTORY_SIZE);
  private historyPos = 0;
  private historyCount = 0;

  private fluxMean = 1e-5;
  private flatness = 0.8;
  private sinceEval = 0;
  private confidence = 0;
  private hold = 0;
  private confirmed = false;

  private bpmValue = 0;
  private lastCorrelation = 0;
  private lastRegularity = 0;
  private lastTarget = 0;
  private lastMeanRms = 0;

  constructor() {
    for (let i = 0; i < FFT_SIZE; i += 1) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }
  }

  /** 0..1 confidence passed to VrmStage when the rhythm is confirmed. */
  get level(): number {
    return this.confirmed ? this.confidence : 0;
  }

  get isMusic(): boolean {
    return this.confirmed;
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get debugState() {
    return {
      confidence: this.confidence,
      correlation: this.lastCorrelation,
      regularity: this.lastRegularity,
      target: this.lastTarget,
      meanRms: this.lastMeanRms,
      flatness: this.flatness,
      hold: this.hold,
    };
  }

  reset(): void {
    this.pending = [];
    this.pendingPos = 0;
    this.historyCount = 0;
    this.historyPos = 0;
    this.confidence = 0;
    this.hold = 0;
    this.confirmed = false;
    this.bpmValue = 0;
    this.previousSpectrum.fill(0);
  }

  push(samples: Int16Array | Float32Array, sampleRate = SAMPLE_RATE): void {
    const resampled = this.resample(samples, sampleRate);
    for (let i = 0; i < resampled.length; i += 1) this.pending.push(resampled[i]);

    while (this.pending.length - this.pendingPos >= FRAME_SIZE) {
      const frame = this.pending.slice(this.pendingPos, this.pendingPos + FRAME_SIZE);
      this.pendingPos += FRAME_SIZE;
      this.processFrame(frame);
    }
    if (this.pendingPos > FRAME_SIZE * 8) {
      this.pending = this.pending.slice(this.pendingPos);
      this.pendingPos = 0;
    }
  }

  private resample(samples: Int16Array | Float32Array, sampleRate: number): Float32Array {
    const count = samples.length;
    if (count === 0) return new Float32Array(0);
    const scale = sampleRate === SAMPLE_RATE ? 1 : sampleRate / SAMPLE_RATE;
    const targetLength = Math.max(1, Math.round(count / scale));
    const output = new Float32Array(targetLength);
    if (scale === 1) {
      for (let i = 0; i < count; i += 1) {
        output[i] = typeof samples === "object" && samples instanceof Int16Array
          ? samples[i] / 32768
          : (samples as Float32Array)[i];
      }
      return output;
    }

    for (let i = 0; i < targetLength; i += 1) {
      const source = i * scale;
      const left = Math.min(count - 1, Math.floor(source));
      const right = Math.min(count - 1, left + 1);
      const mix = source - left;
      const a = samples[left] / (samples instanceof Int16Array ? 32768 : 1);
      const b = samples[right] / (samples instanceof Int16Array ? 32768 : 1);
      output[i] = a + (b - a) * mix;
    }
    return output;
  }

  private processFrame(frame: number[]): void {
    let sumSquares = 0;
    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const value = frame[i];
      sumSquares += value * value;
      this.ring[this.ringPos] = value;
      this.ringPos = (this.ringPos + 1) % FFT_SIZE;
    }
    const rms = Math.sqrt(sumSquares / FRAME_SIZE);

    for (let i = 0; i < FFT_SIZE; i += 1) {
      this.re[i] = this.ring[(this.ringPos + i) % FFT_SIZE] * this.hann[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im);

    let total = 0;
    let logSum = 0;
    let flux = 0;
    for (let i = 1; i < BINS; i += 1) {
      const magnitude = Math.hypot(this.re[i], this.im[i]) / BINS;
      this.spectrum[i] = magnitude;
      total += magnitude;
      logSum += Math.log(magnitude + 1e-8);
      const delta = magnitude - this.previousSpectrum[i];
      if (delta > 0) flux += delta;
      this.previousSpectrum[i] = magnitude;
    }

    this.fluxMean = this.fluxMean * 0.97 + flux * 0.03;
    const onset = Math.max(0, flux - this.fluxMean * 1.25) / (this.fluxMean + 1e-6);
    this.flatness = Math.exp(logSum / (BINS - 1)) / (total / (BINS - 1) + 1e-8);

    this.envelope[this.historyPos] = onset;
    this.rmsHistory[this.historyPos] = rms;
    this.historyPos = (this.historyPos + 1) % HISTORY_SIZE;
    this.historyCount = Math.min(HISTORY_SIZE, this.historyCount + 1);

    this.sinceEval += FRAME_SIZE / SAMPLE_RATE;
    if (this.sinceEval >= EVAL_SECONDS) {
      this.sinceEval = 0;
      this.evaluate();
    }
  }

  /** Frame at `age` frames before the newest one. */
  private recent(index: number, length: number, source: Float32Array): number {
    const start = (this.historyPos - length + HISTORY_SIZE) % HISTORY_SIZE;
    return source[(start + index) % HISTORY_SIZE];
  }

  private evaluate(): void {
    if (this.historyCount < CORR_FRAMES) return;

    let energySum = 0;
    for (let i = 0; i < PEAK_FRAMES; i += 1) {
      energySum += this.recent(i, PEAK_FRAMES, this.rmsHistory);
    }
    const meanRms = energySum / PEAK_FRAMES;

    // Remove slow loudness drift so quiet verses do not kill the pulse.
    const series = new Float32Array(CORR_FRAMES);
    let prefix = 0;
    const prefixes = new Float64Array(CORR_FRAMES + 1);
    for (let i = 0; i < CORR_FRAMES; i += 1) {
      series[i] = this.recent(i, CORR_FRAMES, this.envelope);
      prefix += series[i];
      prefixes[i + 1] = prefix;
    }
    const detrended = new Float32Array(CORR_FRAMES);
    for (let i = 0; i < CORR_FRAMES; i += 1) {
      const from = Math.max(0, i - DETREND_FRAMES);
      const to = Math.min(CORR_FRAMES, i + DETREND_FRAMES + 1);
      const localMean = (prefixes[to] - prefixes[from]) / (to - from);
      detrended[i] = Math.max(0, series[i] - localMean);
    }

    const { correlation, lag } = this.bestLag(detrended);
    const bpm = 60 / (lag * (FRAME_SIZE / SAMPLE_RATE));
    this.bpmValue = bpm;

    const peakFrames = detrended.subarray(0, PEAK_FRAMES);
    let maxPeak = 0;
    for (const value of peakFrames) maxPeak = Math.max(maxPeak, value);
    const intervals: number[] = [];
    let lastPeak = -1;
    if (maxPeak > 0) {
      for (let i = 1; i < peakFrames.length - 1; i += 1) {
        const value = peakFrames[i];
        if (
          value < peakFrames[i - 1] ||
          value < peakFrames[i + 1] ||
          value < maxPeak * 0.22
        ) {
          continue;
        }
        if (lastPeak >= 0 && i - lastPeak >= 8) intervals.push(i - lastPeak);
        lastPeak = i;
      }
    }

    let regularity = 0;
    if (intervals.length >= 5) {
      const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      const variance =
        intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        intervals.length;
      const cv = Math.sqrt(variance) / mean;
      regularity = clamp01((0.32 - cv) / 0.27);
    }

    const rhythm = clamp01((correlation - 0.3) / 0.4) * regularity;
    const energyGate = meanRms > 0.012 ? 1 : clamp01(meanRms / 0.012);
    const toneGate = clamp01((0.72 - this.flatness) / 0.32);
    const target = clamp01(rhythm * energyGate * (0.6 + 0.4 * toneGate));
    this.lastCorrelation = correlation;
    this.lastRegularity = regularity;
    this.lastTarget = target;
    this.lastMeanRms = meanRms;

    this.confidence += (target - this.confidence) * 0.3;

    if (this.confidence >= 0.62) {
      this.hold = Math.min(3, this.hold + EVAL_SECONDS);
    } else if (this.confidence <= 0.3) {
      this.hold = Math.max(-4, this.hold - EVAL_SECONDS);
    }
    this.confirmed = this.hold >= 3;
  }

  private bestLag(series: Float32Array): { correlation: number; lag: number } {
    let bestCorrelation = -1;
    let bestLag = 24;
    for (let lag = 17; lag <= 36; lag += 0.25) {
      const whole = Math.floor(lag);
      const fraction = lag - whole;
      let sumA = 0;
      let sumB = 0;
      let sumAB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let count = 0;
      for (let i = 0; i + whole + 1 < series.length; i += 1) {
        const a = series[i];
        const b = series[i + whole] * (1 - fraction) + series[i + whole + 1] * fraction;
        sumA += a;
        sumB += b;
        sumAB += a * b;
        sumAA += a * a;
        sumBB += b * b;
        count += 1;
      }
      if (count === 0) continue;
      const covariance = sumAB - (sumA * sumB) / count;
      const varianceA = sumAA - (sumA * sumA) / count;
      const varianceB = sumBB - (sumB * sumB) / count;
      const denominator = Math.sqrt(varianceA * varianceB);
      if (denominator < 1e-8) continue;
      const correlation = covariance / denominator;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    return { correlation: Math.max(0, bestCorrelation), lag: bestLag };
  }
}
