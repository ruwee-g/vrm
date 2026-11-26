import type { ReactionPose } from "./reactions";
import type { IdleIntensity } from "./store";

export type ActivityExpression = {
  name: string;
  weight: number;
};

export type ActivityEvent = {
  id: string;
  duration: number;
  pose: ReactionPose;
  gazeYaw: number;
  gazePitch: number;
  expressions: ActivityExpression[];
};

const NEUTRAL: ReactionPose = {
  headPitch: 0,
  headRoll: 0,
  chestPitch: 0,
  nodAmplitude: 0,
};

const pose = (values: Partial<ReactionPose>): ReactionPose => ({ ...NEUTRAL, ...values });

export const IDLE_ACTIVITIES: ActivityEvent[] = [
  {
    id: "look-around",
    duration: 3.1,
    pose: pose({ headRoll: 0.02, headPitch: 0.01 }),
    gazeYaw: 18,
    gazePitch: -2,
    expressions: [{ name: "relaxed", weight: 0.35 }],
  },
  {
    id: "settle",
    duration: 3.8,
    pose: pose({ chestPitch: 0.035, headPitch: 0.025 }),
    gazeYaw: -7,
    gazePitch: 3,
    expressions: [{ name: "relaxed", weight: 0.45 }],
  },
  {
    id: "head-tilt",
    duration: 2.7,
    pose: pose({ headRoll: 0.11, headPitch: -0.035 }),
    gazeYaw: -12,
    gazePitch: 0,
    expressions: [{ name: "relaxed", weight: 0.3 }],
  },
  {
    id: "nod",
    duration: 2.0,
    pose: pose({ nodAmplitude: 0.055 }),
    gazeYaw: 0,
    gazePitch: 3,
    expressions: [{ name: "happy", weight: 0.35 }],
  },
  {
    id: "curious",
    duration: 2.5,
    pose: pose({ headPitch: -0.06, headRoll: 0.05, chestPitch: -0.015 }),
    gazeYaw: 14,
    gazePitch: -6,
    expressions: [{ name: "surprised", weight: 0.3 }],
  },
  {
    id: "glance",
    duration: 1.8,
    pose: pose({}),
    gazeYaw: 20,
    gazePitch: 4,
    expressions: [],
  },
];

export const DANCE_EXPRESSIONS: ActivityExpression[] = [
  { name: "happy", weight: 0.5 },
];

export const DANCE_AUDIO_THRESHOLD = 0.35;

const IDLE_DELAY_RANGES: Record<IdleIntensity, [number, number]> = {
  low: [16, 28],
  medium: [9, 18],
  high: [5, 11],
};

export const idleDelay = (intensity: IdleIntensity): number => {
  const [min, max] = IDLE_DELAY_RANGES[intensity] ?? IDLE_DELAY_RANGES.medium;
  return min + Math.random() * (max - min);
};

export const activityScale = (intensity: IdleIntensity): number => {
  if (intensity === "low") return 0.55;
  if (intensity === "high") return 1.35;
  return 1;
};

export const pickIdleActivity = (previousId?: string | null): ActivityEvent => {
  const candidates = IDLE_ACTIVITIES.filter((item) => item.id !== previousId);
  const pool = candidates.length > 0 ? candidates : IDLE_ACTIVITIES;
  return pool[Math.floor(Math.random() * pool.length)] ?? IDLE_ACTIVITIES[0];
};

export const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const damp = (current: number, target: number, tau: number, delta: number): number =>
  current + (target - current) * (1 - Math.exp(-delta / Math.max(tau, 0.0001)));

const hash = (value: number): number => {
  const x = Math.sin(value * 127.1) * 43758.5453123;
  return x - Math.floor(x);
};

export const noise1 = (value: number): number => {
  const i = Math.floor(value);
  const f = value - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
};
