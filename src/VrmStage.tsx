import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  type VRM,
  type VRMHumanBoneName,
} from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from "@pixiv/three-vrm-animation";
import { IS_PRERELEASE } from "./channel";
import {
  DANCE_AUDIO_THRESHOLD,
  DANCE_EXPRESSIONS,
  activityScale,
  clamp01,
  damp,
  idleDelay,
  noise1,
  pickIdleActivity,
  smoothstep,
  type ActivityEvent,
  type ActivityExpression,
} from "./avatarActivity";
import {
  NEUTRAL_POSE,
  REACTIONS,
  type ReactionId,
  type ReactionPose,
} from "./reactions";
import {
  DEFAULT_MODEL_ID,
  base64ToArrayBuffer,
  readVrmModelBase64,
  type CharacterActivitySettings,
  type ViewTransform,
} from "./store";

const REACTION_ANIMATION_URLS = Array.from(
  new Set(
    Object.values(REACTIONS)
      .map((config) => config.animationUrl)
      .filter((url): url is string => Boolean(url)),
  ),
);
const ALL_ANIMATION_URLS = Array.from(new Set(REACTION_ANIMATION_URLS));
const ANIMATION_SET_KEY = ALL_ANIMATION_URLS.join("|");

const REACTION_RELEASE = 0.52;
const EVENT_RELEASE = 0.42;
const CLIP_FADE = 0.34;
const POSE_TAU = 0.38;
const EXPRESSION_TAU = 0.18;

type ActivityState = "reacting" | "thinking" | "listening" | "dancing" | "idle";

const THINKING_POSE: ReactionPose = {
  headPitch: -0.05,
  headRoll: 0.045,
  chestPitch: -0.01,
  nodAmplitude: 0,
};

const LISTENING_POSE: ReactionPose = {
  headPitch: 0.015,
  headRoll: -0.02,
  chestPitch: 0,
  nodAmplitude: 0,
};

const DEFAULT_ACTIVITY_SETTINGS: CharacterActivitySettings = {
  idleActivity: true,
  idleIntensity: "medium",
  musicReactivity: true,
  interactionResponses: true,
};

const RELAXED_HAND_ROTATIONS: Array<[VRMHumanBoneName, number, number, number]> = [
  ["leftHand", 0.08, 0, 0],
  ["leftIndexProximal", 0, 0, 0.26],
  ["leftIndexIntermediate", 0, 0, 0.32],
  ["leftIndexDistal", 0, 0, 0.1],
  ["leftMiddleProximal", 0, 0, 0.28],
  ["leftMiddleIntermediate", 0, 0, 0.34],
  ["leftMiddleDistal", 0, 0, 0.11],
  ["leftRingProximal", 0, 0, 0.24],
  ["leftRingIntermediate", 0, 0, 0.32],
  ["leftRingDistal", 0, 0, 0.1],
  ["leftLittleProximal", 0, 0, 0.2],
  ["leftLittleIntermediate", 0, 0, 0.28],
  ["leftLittleDistal", 0, 0, 0.09],
  ["rightHand", -0.08, 0, 0],
  ["rightIndexProximal", 0, 0, -0.26],
  ["rightIndexIntermediate", 0, 0, -0.32],
  ["rightIndexDistal", 0, 0, -0.1],
  ["rightMiddleProximal", 0, 0, -0.28],
  ["rightMiddleIntermediate", 0, 0, -0.34],
  ["rightMiddleDistal", 0, 0, -0.11],
  ["rightRingProximal", 0, 0, -0.24],
  ["rightRingIntermediate", 0, 0, -0.32],
  ["rightRingDistal", 0, 0, -0.1],
  ["rightLittleProximal", 0, 0, -0.2],
  ["rightLittleIntermediate", 0, 0, -0.28],
  ["rightLittleDistal", 0, 0, -0.09],
];

const RELAXED_HAND_QUATERNIONS = RELAXED_HAND_ROTATIONS.map(
  ([name, x, y, z]) => ({
    name,
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)),
  }),
);

const OVERLAY_BONES: VRMHumanBoneName[] = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftIndexProximal",
  "rightIndexProximal",
];

type BoneSnapshot = {
  bone: THREE.Object3D;
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export type VrmStageHandle = {
  react: (id: ReactionId) => void;
};

type VrmStageProps = {
  modelId: string;
  modelsReady: boolean;
  viewTransform: ViewTransform;
  onViewTransformChange: (transform: ViewTransform) => void;
  editView: boolean;
  visible: boolean;
  blurred: boolean;
  revealing: boolean;
  backgroundStyle: CSSProperties;
  avatarSource: string | null;
  avatarName: string;
  avatarVisible: boolean;
  offline: boolean;
  generating?: boolean;
  listening?: boolean;
  audioLevel?: number;
  activitySettings?: CharacterActivitySettings;
  micStatus?: ReactNode;
  showResetButton?: boolean;
  onResetView?: () => void;
  children?: ReactNode;
  style?: CSSProperties;
  chrome?: boolean;
  transparent?: boolean;
  fill?: boolean;
};

const VrmStage = forwardRef<VrmStageHandle, VrmStageProps>(function VrmStage(
  {
    modelId,
    modelsReady,
    viewTransform,
    onViewTransformChange,
    editView,
    visible,
    blurred,
    revealing,
    backgroundStyle,
    avatarSource,
    avatarName,
    avatarVisible,
    offline,
    generating = false,
    listening = false,
    audioLevel = 0,
    activitySettings,
    micStatus,
    showResetButton,
    onResetView,
    children,
    style,
    chrome = true,
    transparent = false,
    fill = false,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadModelRef = useRef<((id: string) => void) | null>(null);
  const applyViewRef = useRef<((transform: ViewTransform) => void) | null>(null);
  const reactRef = useRef<((id: ReactionId) => void) | null>(null);
  const interactRef = useRef<((kind: "hover" | "leave" | "tap") => void) | null>(null);
  const generatingRef = useRef(generating);
  const listeningRef = useRef(listening);
  const audioLevelRef = useRef(audioLevel);
  const activitySettingsRef = useRef(activitySettings);
  const stageVisibleRef = useRef(visible);
  const avatarVisibleRef = useRef(avatarVisible);

  stageVisibleRef.current = visible;
  avatarVisibleRef.current = avatarVisible;
  generatingRef.current = generating;
  listeningRef.current = listening;
  audioLevelRef.current = audioLevel;
  activitySettingsRef.current = activitySettings;

  const viewDragRef = useRef<{
    pointerId: number;
    pan: boolean;
    startX: number;
    startY: number;
    transform: ViewTransform;
  } | null>(null);

  useImperativeHandle(ref, () => ({
    react: (id) => reactRef.current?.(id),
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 1.1, 2.02);

    const applyView = (transform: ViewTransform) => {
      const pitch = clamp(transform.pitch, -1.2, 1.2);
      const yaw = transform.yaw;
      const radius = 2.02 / clamp(transform.zoom, 0.5, 3);
      const target = new THREE.Vector3(transform.offsetX, 1.1 + transform.offsetY, 0);
      camera.position.set(
        target.x + radius * Math.sin(yaw) * Math.cos(pitch),
        target.y + radius * Math.sin(pitch),
        target.z + radius * Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(target);
    };
    applyViewRef.current = applyView;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9e3, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(1, 2, 2);
    scene.add(dir);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    let vrm: VRM | null = null;
    let loadToken = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let actionsByUrl = new Map<string, THREE.AnimationAction>();
    let actionWeights = new Map<
      THREE.AnimationAction,
      { value: number; target: number }
    >();
    let boneSnapshots: BoneSnapshot[] = [];
    let reactionId: ReactionId | null = null;
    let reactionRemaining = 0;
    let reactionReleasing = false;
    let reactionGazeYaw = 0;
    let reactionGazePitch = 0;
    let expressionStates: Array<{ name: string; value: number; target: number }> = [];
    let poseCurrent: ReactionPose = { ...NEUTRAL_POSE };
    let poseTarget: ReactionPose = { ...NEUTRAL_POSE };
    let posePhase = 0;
    let activityState: ActivityState = "idle";
    let activityEvent: ActivityEvent | null = null;
    let activityEventRemaining = 0;
    let activityEventReleasing = false;
    let idleDirectorNext = 5 + Math.random() * 5;
    let lastActivityId: string | null = null;
    let idleMotionMix = 0;
    let danceMotionMix = 0;
    let dancePhase = 0;
    let breathPhase = 0;
    let motionTime = 0;
    let danceExpressionsActive = false;
    let musicActive = false;
    let musicHold = 0;
    let interactionHoverYaw = 0;
    let interactionHoverUntil = 0;
    let interactionCooldownUntil = 0;

    const blinkState = {
      next: 2 + Math.random() * 4,
      phase: "idle" as "idle" | "closing" | "holding" | "opening",
      time: 0,
      value: 0,
      doublePending: false,
    };
    const gazeState = {
      yaw: 0,
      pitch: 0,
      targetYaw: 0,
      targetPitch: 0,
      next: 2 + Math.random() * 3,
    };
    const reactionEuler = new THREE.Euler();
    const reactionQuat = new THREE.Quaternion();

    const animationsPromise = Promise.all(
      ALL_ANIMATION_URLS.map(async (url) => {
        try {
          const gltf = await loader.loadAsync(url);
          const animation = (gltf.userData.vrmAnimations?.[0] ?? null) as VRMAnimation | null;
          return animation ? { url, animation } : null;
        } catch (error) {
          console.error("Не удалось загрузить анимацию", url, error);
          return null;
        }
      }),
    ).then((items) => items.flatMap((item) => (item ? [item] : [])));

    const releaseAction = () => {
      for (const state of actionWeights.values()) state.target = 0;
    };

    const playAction = (url: string) => {
      const action = actionsByUrl.get(url);
      if (!action) {
        releaseAction();
        return;
      }
      action.reset().play();
      for (const [candidate, state] of actionWeights) {
        state.target = candidate === action ? 1 : 0;
      }
    };

    const buildBoneSnapshots = (model: VRM) => {
      boneSnapshots = [];
      for (const name of OVERLAY_BONES) {
        const bone = model.humanoid.getRawBoneNode(name);
        if (!bone) continue;
        boneSnapshots.push({
          bone,
          quaternion: bone.quaternion.clone(),
          position: bone.position.clone(),
        });
      }
    };

    const captureBones = () => {
      for (const snapshot of boneSnapshots) {
        snapshot.quaternion.copy(snapshot.bone.quaternion);
        snapshot.position.copy(snapshot.bone.position);
      }
    };

    const restoreBones = () => {
      for (const snapshot of boneSnapshots) {
        snapshot.bone.quaternion.copy(snapshot.quaternion);
        snapshot.bone.position.copy(snapshot.position);
      }
    };

    const applyExpressions = (entries: ActivityExpression[]) => {
      const manager = vrm?.expressionManager;
      const nextStates = new Map<string, { name: string; value: number; target: number }>();
      for (const state of expressionStates) {
        nextStates.set(state.name, { ...state, target: 0 });
      }
      for (const entry of entries) {
        const existing = nextStates.get(entry.name);
        nextStates.set(entry.name, {
          name: entry.name,
          value: existing?.value ?? manager?.getValue(entry.name) ?? 0,
          target: entry.weight,
        });
      }
      expressionStates = Array.from(nextStates.values());
    };

    const clearExpressions = () => {
      for (const state of expressionStates) state.target = 0;
    };

    const beginActivityEvent = (event: ActivityEvent) => {
      activityEvent = { ...event, pose: { ...event.pose } };
      activityEventRemaining = event.duration;
      activityEventReleasing = false;
      lastActivityId = event.id;
      poseTarget = { ...event.pose };
      applyExpressions(event.expressions);
    };

    const releaseActivityEvent = () => {
      if (!activityEvent || activityEventReleasing) return;
      activityEventReleasing = true;
      poseTarget = { ...NEUTRAL_POSE };
      clearExpressions();
    };

    const endActivityEvent = () => {
      activityEvent = null;
      activityEventRemaining = 0;
      activityEventReleasing = false;
      poseTarget = { ...NEUTRAL_POSE };
      clearExpressions();
      const settings = activitySettingsRef.current ?? DEFAULT_ACTIVITY_SETTINGS;
      idleDirectorNext = idleDelay(settings.idleIntensity);
    };

    const updateFace = (model: VRM, delta: number) => {
      const manager = model.expressionManager;
      if (manager) {
        if (blinkState.phase === "idle") {
          blinkState.next -= delta;
          if (blinkState.next <= 0) {
            blinkState.phase = "closing";
            blinkState.time = 0;
          }
        } else {
          blinkState.time += delta;
          if (blinkState.phase === "closing") {
            blinkState.value = smoothstep(0, 0.055, blinkState.time);
            if (blinkState.time >= 0.055) {
              blinkState.phase = "holding";
              blinkState.time = 0;
            }
          } else if (blinkState.phase === "holding") {
            blinkState.value = 1;
            if (blinkState.time >= 0.03) {
              blinkState.phase = "opening";
              blinkState.time = 0;
            }
          } else {
            blinkState.value = 1 - smoothstep(0, 0.1, blinkState.time);
            if (blinkState.time >= 0.1) {
              blinkState.value = 0;
              blinkState.phase = "idle";
              blinkState.next = blinkState.doublePending ? 0.16 : 2.2 + Math.random() * 4;
              blinkState.doublePending = blinkState.doublePending
                ? false
                : Math.random() < 0.14;
            }
          }
        }
        manager.setValue("blink", blinkState.value);
      }

      const lookAt = model.lookAt;
      if (lookAt) {
        lookAt.autoUpdate = false;
        gazeState.next -= delta;
        if (reactionId && !reactionReleasing) {
          gazeState.targetYaw = reactionGazeYaw;
          gazeState.targetPitch = reactionGazePitch;
          gazeState.next = 0.5;
        } else if (activityEvent && !activityEventReleasing) {
          gazeState.targetYaw = activityEvent.gazeYaw;
          gazeState.targetPitch = activityEvent.gazePitch;
          gazeState.next = 0.4;
        } else if (activityState === "thinking") {
          gazeState.targetYaw = -8;
          gazeState.targetPitch = -7;
          gazeState.next = 0.5;
        } else if (activityState === "listening") {
          gazeState.targetYaw = 0;
          gazeState.targetPitch = 0;
          gazeState.next = 0.5;
        } else if (interactionHoverUntil > performance.now()) {
          gazeState.targetYaw = interactionHoverYaw;
          gazeState.targetPitch = -2;
          gazeState.next = 0.4;
        } else if (gazeState.next <= 0) {
          gazeState.targetYaw = (Math.random() - 0.5) * 26;
          gazeState.targetPitch = (Math.random() - 0.5) * 10;
          gazeState.next = 2.5 + Math.random() * 4.5;
        }
        gazeState.yaw = damp(gazeState.yaw, gazeState.targetYaw, 0.26, delta);
        gazeState.pitch = damp(gazeState.pitch, gazeState.targetPitch, 0.26, delta);
        lookAt.yaw = gazeState.yaw;
        lookAt.pitch = gazeState.pitch;
      }
    };

    const relaxHands = (model: VRM) => {
      const humanoid = model.humanoid;
      for (const { name, quaternion } of RELAXED_HAND_QUATERNIONS) {
        const bone = humanoid.getRawBoneNode(name);
        if (bone) bone.quaternion.multiply(quaternion);
      }
    };

    const addOverlayRotation = (
      model: VRM,
      name: VRMHumanBoneName,
      x: number,
      y: number,
      z: number,
    ) => {
      const bone = model.humanoid.getRawBoneNode(name);
      if (!bone) return;
      reactionEuler.set(x, y, z);
      reactionQuat.setFromEuler(reactionEuler);
      bone.quaternion.multiply(reactionQuat);
    };

    const addOverlayOffset = (
      model: VRM,
      name: VRMHumanBoneName,
      x: number,
      y: number,
      z: number,
    ) => {
      const bone = model.humanoid.getRawBoneNode(name);
      if (!bone) return;
      bone.position.x += x;
      bone.position.y += y;
      bone.position.z += z;
    };

    const applyStatePose = (model: VRM) => {
      const poseIdle =
        Math.abs(poseCurrent.headPitch) < 0.001 &&
        Math.abs(poseCurrent.headRoll) < 0.001 &&
        Math.abs(poseCurrent.chestPitch) < 0.001 &&
        Math.abs(poseCurrent.nodAmplitude) < 0.001;
      if (poseIdle) return;

      const nod = Math.sin(posePhase * 7) * poseCurrent.nodAmplitude;
      addOverlayRotation(
        model,
        "head",
        poseCurrent.headPitch + nod,
        0,
        poseCurrent.headRoll,
      );
      addOverlayRotation(model, "chest", poseCurrent.chestPitch, 0, 0);
    };

    const applyProceduralMotion = (
      model: VRM,
      delta: number,
      settings: CharacterActivitySettings,
    ) => {
      const scale = activityScale(settings.idleIntensity);
      motionTime += delta;
      idleMotionMix = damp(
        idleMotionMix,
        activityState === "idle" && !reactionId ? 1 : 0,
        0.45,
        delta,
      );
      const danceTarget =
        activityState === "dancing" && settings.musicReactivity && !reactionId ? 1 : 0;
      danceMotionMix = damp(danceMotionMix, danceTarget, 0.4, delta);

      if (idleMotionMix > 0.01) {
        breathPhase += delta * 1.25;
        const breath =
          (Math.sin(breathPhase) * 0.012 + Math.sin(breathPhase * 2 + 0.8) * 0.003) *
          scale *
          idleMotionMix;
        const shift = noise1(motionTime * 0.19) * 0.026 * scale * idleMotionMix;
        const drift = noise1(motionTime * 0.11 + 31) * 0.018 * scale * idleMotionMix;
        addOverlayRotation(model, "hips", 0, shift * 0.5, shift);
        addOverlayRotation(model, "spine", breath * 0.6, shift * 0.35, shift * 0.6);
        addOverlayRotation(model, "chest", breath, 0, shift * 0.25 + drift * 0.3);
        addOverlayRotation(model, "neck", -breath * 0.2, 0, -shift * 0.2);
        addOverlayRotation(
          model,
          "head",
          breath * 0.3 + noise1(motionTime * 0.7 + 7) * 0.008 * scale * idleMotionMix,
          0,
          drift,
        );
        const finger = noise1(motionTime * 0.55 + 19) * 0.018 * scale * idleMotionMix;
        addOverlayRotation(model, "leftIndexProximal", 0, 0, finger);
        addOverlayRotation(model, "rightIndexProximal", 0, 0, -finger);
      }

      if (danceMotionMix > 0.01) {
        dancePhase += delta * (4.9 + clamp01(audioLevelRef.current) * 1.2);
        const influence = danceMotionMix * scale;
        const beat = Math.sin(dancePhase);
        const delayed = Math.sin(dancePhase - 0.5);
        const side =
          noise1(dancePhase * 0.18) * 0.6 + Math.sin(dancePhase * 0.5) * 0.4;
        addOverlayOffset(model, "hips", 0, beat * 0.012 * influence, 0);
        addOverlayRotation(
          model,
          "hips",
          0.01 * Math.cos(dancePhase) * influence,
          side * 0.14 * influence,
          beat * 0.08 * influence,
        );
        addOverlayRotation(
          model,
          "spine",
          0.02 * Math.cos(dancePhase) * influence,
          beat * 0.07 * influence,
          -side * 0.07 * influence,
        );
        addOverlayRotation(model, "chest", 0, 0, beat * 0.05 * influence);
        addOverlayRotation(
          model,
          "leftShoulder",
          delayed * 0.12 * influence,
          0,
          -0.05 * influence,
        );
        addOverlayRotation(
          model,
          "rightShoulder",
          -delayed * 0.12 * influence,
          0,
          0.05 * influence,
        );
        addOverlayRotation(model, "leftUpperArm", beat * 0.42 * influence, 0, -0.06 * influence);
        addOverlayRotation(model, "rightUpperArm", -beat * 0.42 * influence, 0, 0.06 * influence);
        addOverlayRotation(
          model,
          "leftLowerArm",
          delayed * 0.32 * influence,
          0,
          -0.12 * influence,
        );
        addOverlayRotation(
          model,
          "rightLowerArm",
          -delayed * 0.32 * influence,
          0,
          0.12 * influence,
        );
        addOverlayRotation(
          model,
          "head",
          Math.sin(dancePhase * 2) * 0.025 * influence,
          side * 0.045 * influence,
          delayed * 0.06 * influence,
        );
      }
    };

    const updateExpressions = (model: VRM, delta: number) => {
      const manager = model.expressionManager;
      if (!manager || expressionStates.length === 0) return;
      for (const state of expressionStates) {
        state.value = damp(state.value, state.target, EXPRESSION_TAU, delta);
        manager.setValue(state.name, state.value);
      }
      if (
        !reactionId &&
        expressionStates.every((state) => state.target === 0 && state.value < 0.02)
      ) {
        for (const state of expressionStates) manager.setValue(state.name, 0);
        expressionStates = [];
      }
    };

    const playReaction = (id: ReactionId) => {
      if (!vrm) return;
      const config = REACTIONS[id] ?? REACTIONS.neutral;
      const appliedId = REACTIONS[id] ? id : "neutral";

      reactionId = appliedId;
      reactionRemaining = config.duration;
      reactionReleasing = false;
      reactionGazeYaw = config.gazeYaw;
      reactionGazePitch = config.gazePitch;
      poseTarget = { ...config.pose };
      activityEvent = null;
      activityEventRemaining = 0;
      activityEventReleasing = false;
      activityState = "reacting";
      danceExpressionsActive = false;

      applyExpressions(
        config.expressions.map((name) => ({ name, weight: config.expressionWeight })),
      );

      if (config.animationUrl) playAction(config.animationUrl);
      else releaseAction();
    };
    reactRef.current = playReaction;

    interactRef.current = (kind) => {
      const settings = activitySettingsRef.current ?? DEFAULT_ACTIVITY_SETTINGS;
      if (!settings.interactionResponses || !vrm) return;
      const now = performance.now();
      if (kind === "leave") {
        interactionHoverUntil = 0;
        interactionHoverYaw = 0;
        return;
      }
      if (now < interactionCooldownUntil) return;
      if (kind === "hover") {
        interactionHoverYaw = 13;
        interactionHoverUntil = now + 1500;
        interactionCooldownUntil = now + 2600;
      } else {
        interactionCooldownUntil = now + 2400;
        playReaction(Math.random() < 0.5 ? "happy" : "wave");
      }
    };

    const setupAnimations = (model: VRM, token: number) => {
      void animationsPromise
        .then((items) => {
          if (token !== loadToken || vrm !== model) return;
          mixer = new THREE.AnimationMixer(model.scene);
          actionsByUrl = new Map();
          actionWeights = new Map();
          for (const { url, animation } of items) {
            const clip = createVRMAnimationClip(animation, model);
            const action = mixer.clipAction(clip);
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            action.play();
            action.setEffectiveWeight(0);
            actionsByUrl.set(url, action);
            actionWeights.set(action, { value: 0, target: 0 });
          }
        })
        .catch((error) => console.error("Не удалось подготовить анимации", error));
    };

    const applyPose = (model: VRM) => {
      model.scene.rotation.y = Math.PI;
      const humanoid = model.humanoid;
      const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
      const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
      if (leftUpperArm) leftUpperArm.rotation.z = 1.32;
      if (rightUpperArm) rightUpperArm.rotation.z = -1.32;
    };

    const handleLoaded = (gltf: GLTF, token: number) => {
      if (token !== loadToken) return;
      const model = gltf.userData.vrm as VRM;
      vrm = model;
      applyPose(model);
      buildBoneSnapshots(model);
      scene.add(model.scene);
      setupAnimations(model, token);
    };

    const loadModel = (id: string) => {
      const token = ++loadToken;
      if (vrm) {
        if (mixer) {
          mixer.stopAllAction();
          mixer.uncacheRoot(vrm.scene);
          mixer = null;
        }
        scene.remove(vrm.scene);
        vrm = null;
      }
      boneSnapshots = [];
      actionsByUrl = new Map();
      actionWeights = new Map();
      reactionId = null;
      reactionRemaining = 0;
      reactionReleasing = false;
      reactionGazeYaw = 0;
      reactionGazePitch = 0;
      expressionStates = [];
      poseCurrent = { ...NEUTRAL_POSE };
      poseTarget = { ...NEUTRAL_POSE };
      posePhase = 0;
      activityState = "idle";
      activityEvent = null;
      activityEventRemaining = 0;
      activityEventReleasing = false;
      idleDirectorNext = 5 + Math.random() * 5;
      lastActivityId = null;
      idleMotionMix = 0;
      danceMotionMix = 0;
      dancePhase = 0;
      motionTime = 0;
      danceExpressionsActive = false;
      musicActive = false;
      musicHold = 0;
      interactionHoverYaw = 0;
      interactionHoverUntil = 0;
      interactionCooldownUntil = 0;
      blinkState.next = 2 + Math.random() * 4;
      blinkState.phase = "idle";
      blinkState.time = 0;
      blinkState.value = 0;
      blinkState.doublePending = false;
      gazeState.next = 2 + Math.random() * 3;

      if (!IS_PRERELEASE && id === DEFAULT_MODEL_ID) {
        loader.load(
          "/vrm/model.vrm",
          (gltf) => handleLoaded(gltf, token),
          undefined,
          (error) => console.error("Не удалось загрузить модель", error),
        );
        return;
      }

      void readVrmModelBase64(id)
        .then((base64) => {
          if (token !== loadToken) return;
          loader.parse(
            base64ToArrayBuffer(base64),
            "",
            (gltf) => handleLoaded(gltf, token),
            (error) => console.error("Не удалось загрузить модель", error),
          );
        })
        .catch((error) => console.error("Не удалось прочитать модель", error));
    };

    loadModelRef.current = loadModel;

    const resize = () => {
      const width = el.clientWidth || 1;
      const height = el.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let raf = 0;
    let last = performance.now();

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (document.hidden || !stageVisibleRef.current || avatarVisibleRef.current) return;

      const settings = activitySettingsRef.current ?? DEFAULT_ACTIVITY_SETTINGS;
      const audioLevel = clamp01(audioLevelRef.current);
      musicHold = clamp(
        musicHold + (audioLevel >= DANCE_AUDIO_THRESHOLD ? delta : -delta),
        -0.8,
        0.4,
      );
      if (!musicActive && musicHold >= 0.4) musicActive = true;
      if (musicActive && musicHold <= -0.8) musicActive = false;

      const previousState = activityState;
      let nextState: ActivityState;
      if (reactionId) nextState = "reacting";
      else if (generatingRef.current) nextState = "thinking";
      else if (listeningRef.current) nextState = "listening";
      else if (settings.musicReactivity && musicActive) nextState = "dancing";
      else nextState = "idle";

      if (nextState !== activityState) {
        if (activityEvent && nextState !== "idle") releaseActivityEvent();
        if (activityState === "dancing" && nextState !== "dancing" && danceExpressionsActive) {
          clearExpressions();
          danceExpressionsActive = false;
        }
        if (nextState === "dancing" && !danceExpressionsActive && !reactionId) {
          applyExpressions(DANCE_EXPRESSIONS);
          danceExpressionsActive = true;
        }
        if (nextState === "idle" && previousState !== "idle") {
          idleDirectorNext = Math.max(idleDirectorNext, 2 + Math.random() * 3);
        }
        activityState = nextState;
      }

      if (mixer) {
        if (activityEvent) {
          activityEventRemaining -= delta;
          if (!activityEventReleasing && activityEventRemaining <= EVENT_RELEASE) {
            releaseActivityEvent();
          }
          if (activityEventRemaining <= 0) endActivityEvent();
        } else if (activityState === "idle" && settings.idleActivity) {
          idleDirectorNext -= delta;
          if (idleDirectorNext <= 0) {
            beginActivityEvent(pickIdleActivity(lastActivityId));
          }
        }

        if (!reactionId && !activityEvent) {
          const targetPose =
            activityState === "thinking"
              ? THINKING_POSE
              : activityState === "listening"
                ? LISTENING_POSE
                : NEUTRAL_POSE;
          poseTarget = { ...targetPose };
        }

        const weightEase = 1 - Math.exp(-delta / CLIP_FADE);
        for (const [action, state] of actionWeights) {
          state.value += (state.target - state.value) * weightEase;
          if (state.target === 0 && state.value < 0.001) state.value = 0;
          action.setEffectiveWeight(state.value);
        }
        mixer.update(delta);

        if (reactionId) {
          reactionRemaining -= delta;
          if (!reactionReleasing && reactionRemaining <= REACTION_RELEASE) {
            reactionReleasing = true;
            poseTarget = { ...NEUTRAL_POSE };
            clearExpressions();
            releaseAction();
          }
          if (reactionRemaining <= 0) {
            reactionId = null;
                  reactionGazeYaw = 0;
            reactionGazePitch = 0;
            poseTarget = { ...NEUTRAL_POSE };
            clearExpressions();
            releaseAction();
            idleDirectorNext = Math.max(idleDirectorNext, 2 + Math.random() * 3);
          }
        }

        poseCurrent.headPitch = damp(poseCurrent.headPitch, poseTarget.headPitch, POSE_TAU, delta);
        poseCurrent.headRoll = damp(poseCurrent.headRoll, poseTarget.headRoll, POSE_TAU, delta);
        poseCurrent.chestPitch = damp(poseCurrent.chestPitch, poseTarget.chestPitch, POSE_TAU, delta);
        poseCurrent.nodAmplitude = damp(
          poseCurrent.nodAmplitude,
          poseTarget.nodAmplitude,
          POSE_TAU,
          delta,
        );
        posePhase += delta;
      }

      if (vrm) updateExpressions(vrm, delta);
      if (vrm) updateFace(vrm, delta);
      vrm?.update(delta);
      if (vrm && boneSnapshots.length > 0) {
        captureBones();
        applyProceduralMotion(vrm, delta, settings);
        applyStatePose(vrm);
        relaxHands(vrm);
        renderer.render(scene, camera);
        restoreBones();
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();

    return () => {
      loadToken += 1;
      loadModelRef.current = null;
      applyViewRef.current = null;
      reactRef.current = null;
      interactRef.current = null;
      cancelAnimationFrame(raf);
      mixer?.stopAllAction();
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [ANIMATION_SET_KEY]);

  useEffect(() => {
    if (!modelsReady) return;
    const available = modelId === DEFAULT_MODEL_ID || modelId.endsWith(".vrm");
    loadModelRef.current?.(available ? modelId : DEFAULT_MODEL_ID);
  }, [modelsReady, modelId]);

  useEffect(() => {
    applyViewRef.current?.(viewTransform);
  }, [viewTransform]);

  const handleViewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editView) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    viewDragRef.current = {
      pointerId: event.pointerId,
      pan: event.button === 2 || event.shiftKey,
      startX: event.clientX,
      startY: event.clientY,
      transform: { ...viewTransform },
    };
  };

  const handleViewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = viewDragRef.current;
    if (!editView || !drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const base = drag.transform;
    onViewTransformChange(
      drag.pan
        ? {
            ...base,
            offsetX: base.offsetX - dx * 0.004,
            offsetY: base.offsetY + dy * 0.004,
          }
        : {
            ...base,
            yaw: base.yaw - dx * 0.01,
            pitch: clamp(base.pitch + dy * 0.01, -1.2, 1.2),
          },
    );
  };

  const handleViewPointerUp = () => {
    viewDragRef.current = null;
  };

  const handleViewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!editView) return;
    const factor = Math.exp(-event.deltaY * 0.001);
    onViewTransformChange({
      ...viewTransform,
      zoom: clamp(viewTransform.zoom * factor, 0.5, 3),
    });
  };

  const stageClass = [
    "relative shrink-0 overflow-hidden",
    fill ? "h-full w-full" : "aspect-[9/16] h-[88vh]",
    chrome ? "rounded-[32px] shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)]" : "",
    chrome && !fill ? "mr-3" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={stageClass}
      style={style}
      onPointerEnter={() => interactRef.current?.("hover")}
      onPointerLeave={() => interactRef.current?.("leave")}
    >
      <div
        className={`model-stage absolute inset-0 ${
          blurred ? "model-stage-blur" : revealing ? "model-stage-reveal" : ""
        }`}
        style={transparent ? undefined : backgroundStyle}
      >
        <div
          ref={containerRef}
          className={`model-canvas absolute inset-0 ${visible ? "" : "model-canvas-hidden"} ${editView ? "z-10 cursor-grab touch-none active:cursor-grabbing" : ""}`}
          onPointerDown={editView ? handleViewPointerDown : undefined}
          onPointerMove={editView ? handleViewPointerMove : undefined}
          onPointerUp={editView ? handleViewPointerUp : undefined}
          onPointerCancel={editView ? handleViewPointerUp : undefined}
          onWheel={editView ? handleViewWheel : undefined}
          onContextMenu={editView ? (event) => event.preventDefault() : undefined}
        />
        {!editView && (
          <div
            onPointerDown={(event) => {
              event.preventDefault();
              interactRef.current?.("tap");
              try {
                void getCurrentWindow().startDragging().catch(() => {});
              } catch {
                // в обычном браузере перетаскивать окно нечем
              }
            }}
            className="absolute inset-0 z-10 cursor-grab touch-none active:cursor-grabbing"
          />
        )}
        <div
          aria-hidden={!avatarVisible}
          className={`avatar-layer pointer-events-none absolute inset-0 z-[15] flex items-center justify-center overflow-hidden ${
            avatarVisible ? "avatar-layer-visible" : "avatar-layer-hidden"
          }`}
        >
          {avatarSource ? (
            <img
              src={avatarSource}
              alt={avatarName}
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-neutral-500">
              <span className="text-[76px] font-semibold leading-none text-neutral-300">
                {avatarName.slice(0, 1).toUpperCase() || "?"}
              </span>
              <span className="text-[11px]">Аватарка не загружена</span>
            </div>
          )}
        </div>
        {offline && (
          <div className="status-badge pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-1 text-[10px] font-medium text-neutral-700 backdrop-blur-2xl backdrop-saturate-150">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            offline
          </div>
        )}
        {micStatus}
        {showResetButton && (
          <button
            type="button"
            onClick={onResetView}
            className="absolute bottom-3 right-3 z-20 rounded-full bg-white/25 px-3 py-1.5 text-[11px] text-neutral-700 backdrop-blur-2xl backdrop-saturate-150 transition hover:bg-white/40"
          >
            Сбросить вид
          </button>
        )}
        {children}
      </div>
    </div>
  );
});

export default VrmStage;
