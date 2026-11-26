import type { ReactionPose } from "./reactions";
import type { IdleIntensity } from "./store";

export type ActivityExpression = {
  name: string;
  weight: number;
};

export type ActivityEvent = {
  id: string;
  duration: number;
  animationUrl?: string;
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

export const IDLE_ACTIVITY_ANIMATION_URLS = [
  "/animations/LookAround.vrma",
  "/animations/Relax.vrma",
];

export const IDLE_ACTIVITIES: ActivityEvent[] = [
  {
    id: "look-around",
    duration: 3.2,
    animationUrl: "/animations/LookAround.vrma",
    pose: pose({ headRoll: 0.015 }),
    gazeYaw: 16,
    gazePitch: -2,
    expressions: [{ name: "relaxed", weight: 0.35 }],
  },
  {
    id: "relax",
    duration: 4.1,
    animationUrl: "/animations/Relax.vrma",
    pose: pose({ chestPitch: 0.025, headPitch: 0.02 }),
    gazeYaw: -6,
    gazePitch: 2,
    expressions: [{ name: "relaxed", weight: 0.45 }],
  },
  {
    id: "head-tilt",
    duration: 2.6,
    pose: pose({ headRoll: 0.1, headPitch: -0.03 }),
    gazeYaw: -10,
    gazePitch: 0,
    expressions: [{ name: "relaxed", weight: 0.3 }],
  },
  {
    id: "nod",
    duration: 1.9,
    pose: pose({ nodAmplitude: 0.05 }),
    gazeYaw: 0,
    gazePitch: 2,
    expressions: [{ name: "happy", weight: 0.35 }],
  },
  {
    id: "model-pose",
    duration: 2.8,
    animationUrl: "/animations/VRMA_06.vrma",
    pose: pose({ headRoll: 0.02 }),
    gazeYaw: 8,
    gazePitch: 0,
    expressions: [{ name: "relaxed", weight: 0.4 }],
  },
  {
    id: "glance",
    duration: 1.7,
    pose: pose({}),
    gazeYaw: 18,
    gazePitch: 3,
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
