export const REACTION_IDS = [
  "happy",
  "surprised",
  "sad",
  "angry",
  "smug",
  "greeting",
  "wave",
  "peace",
  "show",
  "model",
  "spin",
  "squat",
  "shoot",
  "think",
  "neutral",
] as const;

export type ReactionId = (typeof REACTION_IDS)[number];

export type ReactionPose = {
  headPitch: number;
  headRoll: number;
  chestPitch: number;
  nodAmplitude: number;
};

export const NEUTRAL_POSE: ReactionPose = {
  headPitch: 0,
  headRoll: 0,
  chestPitch: 0,
  nodAmplitude: 0,
};

const pose = (values: Partial<ReactionPose>): ReactionPose => ({
  ...NEUTRAL_POSE,
  ...values,
});

export type ReactionConfig = {
  expressions: string[];
  expressionWeight: number;
  animationUrl?: string;
  duration: number;
  gazeYaw: number;
  gazePitch: number;
  pose: ReactionPose;
};

export const REACTIONS: Record<ReactionId, ReactionConfig> = {
  happy: {
    expressions: ["happy"],
    expressionWeight: 0.85,
    duration: 2.1,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({ nodAmplitude: 0.045 }),
  },
  surprised: {
    expressions: ["surprised"],
    expressionWeight: 0.95,
    duration: 1.8,
    gazeYaw: 0,
    gazePitch: -9,
    pose: pose({ headPitch: -0.14 }),
  },
  sad: {
    expressions: ["sad", "lookDown"],
    expressionWeight: 0.85,
    duration: 2.8,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
  angry: {
    expressions: ["angry"],
    expressionWeight: 0.85,
    duration: 2.2,
    gazeYaw: 0,
    gazePitch: 1,
    pose: pose({ chestPitch: 0.07 }),
  },
  smug: {
    expressions: ["relaxed"],
    expressionWeight: 0.6,
    duration: 3,
    gazeYaw: 12,
    gazePitch: -2,
    pose: pose({ headPitch: 0.02, headRoll: 0.06 }),
  },
  greeting: {
    expressions: ["happy"],
    expressionWeight: 0.9,
    animationUrl: "/animations/VRMA_02.vrma",
    duration: 2.7,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
  wave: {
    expressions: ["happy"],
    expressionWeight: 0.85,
    animationUrl: "/animations/VRMA_02.vrma",
    duration: 2.6,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
  peace: {
    expressions: ["happy"],
    expressionWeight: 0.6,
    animationUrl: "/animations/VRMA_03.vrma",
    duration: 2.4,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
  show: {
    expressions: ["happy"],
    expressionWeight: 0.45,
    animationUrl: "/animations/VRMA_01.vrma",
    duration: 3.4,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
  model: {
    expressions: ["relaxed"],
    expressionWeight: 0.5,
    animationUrl: "/animations/VRMA_06.vrma",
    duration: 3,
    gazeYaw: 8,
    gazePitch: 0,
    pose: pose({ headRoll: 0.02 }),
  },
  spin: {
    expressions: ["happy"],
    expressionWeight: 0.5,
    animationUrl: "/animations/VRMA_05.vrma",
    duration: 2.8,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
  squat: {
    expressions: ["relaxed"],
    expressionWeight: 0.45,
    animationUrl: "/animations/VRMA_07.vrma",
    duration: 3,
    gazeYaw: 0,
    gazePitch: 6,
    pose: pose({ headPitch: 0.05 }),
  },
  shoot: {
    expressions: ["relaxed"],
    expressionWeight: 0.55,
    animationUrl: "/animations/VRMA_04.vrma",
    duration: 2.2,
    gazeYaw: 8,
    gazePitch: -2,
    pose: pose({ headRoll: -0.04 }),
  },
  think: {
    expressions: ["relaxed"],
    expressionWeight: 0.55,
    duration: 3.2,
    gazeYaw: -10,
    gazePitch: -8,
    pose: pose({ headPitch: -0.06, headRoll: 0.05, chestPitch: -0.01 }),
  },
  neutral: {
    expressions: [],
    expressionWeight: 0,
    duration: 0.6,
    gazeYaw: 0,
    gazePitch: 0,
    pose: pose({}),
  },
};

export const REACTION_LABELS: Record<ReactionId, string> = {
  happy: "Радость",
  surprised: "Удивление",
  sad: "Грусть",
  angry: "Злость",
  smug: "Ухмылка",
  greeting: "Приветствие",
  wave: "Машет",
  peace: "Мир / победа",
  show: "Показывает себя",
  model: "Модельная поза",
  spin: "Крутится",
  squat: "Приседает",
  shoot: "Выстрел",
  think: "Задумчивость",
  neutral: "Нейтрально",
};

const ALIASES: Record<string, ReactionId> = {
  joy: "happy",
  glad: "happy",
  smile: "happy",
  wow: "surprised",
  shock: "surprised",
  sorrow: "sad",
  mad: "angry",
  smirk: "smug",
  cocky: "smug",
  hello: "wave",
  hi: "wave",
  waving: "wave",
  victory: "peace",
  sign: "peace",
  present: "show",
  display: "show",
  pose: "model",
  posing: "model",
  turn: "spin",
  twirl: "spin",
  rotate: "spin",
  crouch: "squat",
  sit: "squat",
  finger_gun: "shoot",
  bang: "shoot",
  gun: "shoot",
  thinking: "think",
  ponder: "think",
  pensive: "think",
  idle: "neutral",
  normal: "neutral",
};

export const REACTION_PROMPT_HINT = `В конце каждого ответа добавь отдельной строкой ровно один тег:
[[reaction:${REACTION_IDS[0]}]]

Допустимые значения:
${REACTION_IDS.map((id) => `${id} — ${REACTION_LABELS[id].toLowerCase()}`).join("\n")}

После тега ничего не пиши. Тег не является частью видимого ответа.`;

export function normalizeReaction(value: string): ReactionId | null {
  const key = value.trim().toLowerCase();
  if ((REACTION_IDS as readonly string[]).includes(key)) {
    return key as ReactionId;
  }
  return ALIASES[key] ?? null;
}

export function parseReaction(raw: string): {
  text: string;
  reaction?: ReactionId;
} {
  const match = raw.match(/\[\[reaction:\s*([a-z][a-z0-9_-]*)\s*\]\]\s*$/i);
  if (!match || match.index === undefined) {
    return { text: raw.trim() };
  }
  const reaction = normalizeReaction(match[1]);
  const text = raw.slice(0, match.index).trimEnd();
  return reaction ? { text, reaction } : { text };
}
