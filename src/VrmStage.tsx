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
  NEUTRAL_POSE,
  REACTIONS,
  type ReactionId,
  type ReactionPose,
} from "./reactions";
import {
  DEFAULT_MODEL_ID,
  base64ToArrayBuffer,
  readVrmModelBase64,
  type ViewTransform,
} from "./store";

const IDLE_ANIMATION_URL = "/animations/idle_loop.vrma";
const REACTION_ANIMATION_URLS = Array.from(
  new Set(
    Object.values(REACTIONS)
      .map((config) => config.animationUrl)
      .filter((url): url is string => Boolean(url)),
  ),
);
const ALL_ANIMATION_URLS = [IDLE_ANIMATION_URL, ...REACTION_ANIMATION_URLS];
const ANIMATION_SET_KEY = ALL_ANIMATION_URLS.join("|");

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
  micStatus?: ReactNode;
  showResetButton?: boolean;
  onResetView?: () => void;
  children?: ReactNode;
  style?: CSSProperties;
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
    micStatus,
    showResetButton,
    onResetView,
    children,
    style,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadModelRef = useRef<((id: string) => void) | null>(null);
  const applyViewRef = useRef<((transform: ViewTransform) => void) | null>(null);
  const reactRef = useRef<((id: ReactionId) => void) | null>(null);
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
    let idleAction: THREE.AnimationAction | null = null;
    let actionsByUrl = new Map<string, THREE.AnimationAction>();
    let actionWeights = new Map<
      THREE.AnimationAction,
      { value: number; target: number }
    >();
    let clipsByUrl = new Map<string, THREE.AnimationClip>();
    let reactionId: ReactionId | null = null;
    let reactionRemaining = 0;
    let reactionGazeYaw = 0;
    let reactionGazePitch = 0;
    let expressionStates: Array<{ name: string; value: number; target: number }> = [];
    let poseCurrent: ReactionPose = { ...NEUTRAL_POSE };
    let poseTarget: ReactionPose = { ...NEUTRAL_POSE };
    let posePhase = 0;

    const blinkState = { next: 2 + Math.random() * 4, open: true, double: false };
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

    const playAction = (url: string, restart = false) => {
      const action = actionsByUrl.get(url);
      if (!action) return;
      if (restart) action.reset();
      for (const [candidate, state] of actionWeights) {
        state.target = candidate === action ? 1 : 0;
      }
    };

    const updateFace = (model: VRM, delta: number) => {
      const manager = model.expressionManager;
      if (manager) {
        blinkState.next -= delta;
        if (blinkState.next <= 0) {
          if (blinkState.open) {
            manager.setValue("blink", 1);
            blinkState.open = false;
            blinkState.next = 0.09;
          } else {
            manager.setValue("blink", 0);
            blinkState.open = true;
            if (blinkState.double) {
              blinkState.double = false;
              blinkState.next = 0.14;
            } else {
              blinkState.next = 2 + Math.random() * 4;
              if (Math.random() < 0.12) blinkState.double = true;
            }
          }
        }
      }

      const lookAt = model.lookAt;
      if (lookAt) {
        lookAt.autoUpdate = false;
        gazeState.next -= delta;
        if (reactionId) {
          gazeState.targetYaw = reactionGazeYaw;
          gazeState.targetPitch = reactionGazePitch;
          gazeState.next = 0.5;
        } else if (gazeState.next <= 0) {
          gazeState.targetYaw = (Math.random() - 0.5) * 24;
          gazeState.targetPitch = (Math.random() - 0.5) * 9;
          gazeState.next = 2.5 + Math.random() * 4;
        }
        const ease = Math.min(1, delta * 1.5);
        gazeState.yaw += (gazeState.targetYaw - gazeState.yaw) * ease;
        gazeState.pitch += (gazeState.targetPitch - gazeState.pitch) * ease;
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

    const addReactionRotation = (
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

    const applyReactionPose = (model: VRM) => {
      const poseIdle =
        Math.abs(poseCurrent.headPitch) < 0.001 &&
        Math.abs(poseCurrent.headRoll) < 0.001 &&
        Math.abs(poseCurrent.chestPitch) < 0.001 &&
        Math.abs(poseCurrent.nodAmplitude) < 0.001;
      if (poseIdle) return;

      const nod = Math.sin(posePhase * 7) * poseCurrent.nodAmplitude;
      addReactionRotation(
        model,
        "head",
        poseCurrent.headPitch + nod,
        0,
        poseCurrent.headRoll,
      );
      addReactionRotation(model, "chest", poseCurrent.chestPitch, 0, 0);
    };

    const updateExpressions = (model: VRM, delta: number) => {
      const manager = model.expressionManager;
      if (!manager || expressionStates.length === 0) return;
      const ease = Math.min(1, delta * 6);
      for (const state of expressionStates) {
        state.value += (state.target - state.value) * ease;
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
      if (!mixer || !idleAction || !vrm) return;
      const config = REACTIONS[id] ?? REACTIONS.neutral;
      const appliedId = REACTIONS[id] ? id : "neutral";

      reactionId = appliedId;
      reactionRemaining = config.duration;
      reactionGazeYaw = config.gazeYaw;
      reactionGazePitch = config.gazePitch;
      poseTarget = { ...config.pose };

      const manager = vrm.expressionManager;
      const nextStates = new Map<string, { name: string; value: number; target: number }>();
      for (const state of expressionStates) {
        nextStates.set(state.name, { ...state, target: 0 });
      }
      for (const name of config.expressions) {
        const existing = nextStates.get(name);
        nextStates.set(name, {
          name,
          value: existing?.value ?? manager?.getValue(name) ?? 0,
          target: config.expressionWeight,
        });
      }
      expressionStates = Array.from(nextStates.values());

      if (config.animationUrl) playAction(config.animationUrl, true);
      else playAction(IDLE_ANIMATION_URL);
    };
    reactRef.current = playReaction;

    const setupAnimations = (model: VRM, token: number) => {
      void animationsPromise
        .then((items) => {
          if (token !== loadToken || vrm !== model || items.length === 0) return;
          mixer = new THREE.AnimationMixer(model.scene);
          clipsByUrl = new Map();
          actionsByUrl = new Map();
          actionWeights = new Map();
          for (const { url, animation } of items) {
            const clip = createVRMAnimationClip(animation, model);
            clipsByUrl.set(url, clip);
            const action = mixer.clipAction(clip);
            action.setLoop(THREE.LoopRepeat, Infinity).play();
            actionsByUrl.set(url, action);
            actionWeights.set(action, {
              value: url === IDLE_ANIMATION_URL ? 1 : 0,
              target: url === IDLE_ANIMATION_URL ? 1 : 0,
            });
          }
          idleAction = actionsByUrl.get(IDLE_ANIMATION_URL) ?? null;
          if (!idleAction) return;
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
      idleAction = null;
      actionsByUrl = new Map();
      actionWeights = new Map();
      clipsByUrl = new Map();
      reactionId = null;
      reactionRemaining = 0;
      reactionGazeYaw = 0;
      reactionGazePitch = 0;
      expressionStates = [];
      poseCurrent = { ...NEUTRAL_POSE };
      poseTarget = { ...NEUTRAL_POSE };
      posePhase = 0;
      blinkState.next = 2 + Math.random() * 4;
      blinkState.open = true;
      blinkState.double = false;
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

      if (mixer && idleAction) {
        const weightEase = 1 - Math.exp(-delta / 0.3);
        for (const [action, state] of actionWeights) {
          state.value += (state.target - state.value) * weightEase;
          if (state.target === 0 && state.value < 0.001) state.value = 0;
          action.setEffectiveWeight(state.value);
        }
        mixer.update(delta);

        if (reactionId) {
          reactionRemaining -= delta;
          if (reactionRemaining <= 0) {
            reactionId = null;
            reactionGazeYaw = 0;
            reactionGazePitch = 0;
            poseTarget = { ...NEUTRAL_POSE };
            for (const state of expressionStates) state.target = 0;
            playAction(IDLE_ANIMATION_URL);
          }
        }

        const poseEase = 1 - Math.exp(-delta / 0.22);
        poseCurrent.headPitch +=
          (poseTarget.headPitch - poseCurrent.headPitch) * poseEase;
        poseCurrent.headRoll +=
          (poseTarget.headRoll - poseCurrent.headRoll) * poseEase;
        poseCurrent.chestPitch +=
          (poseTarget.chestPitch - poseCurrent.chestPitch) * poseEase;
        poseCurrent.nodAmplitude +=
          (poseTarget.nodAmplitude - poseCurrent.nodAmplitude) * poseEase;
        posePhase += delta;
      }

      if (vrm && idleAction) {
        updateExpressions(vrm, delta);
      }
      if (vrm) updateFace(vrm, delta);
      vrm?.update(delta);
      if (vrm && idleAction) {
        applyReactionPose(vrm);
        relaxHands(vrm);
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      loadToken += 1;
      loadModelRef.current = null;
      applyViewRef.current = null;
      reactRef.current = null;
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

  return (
    <div
      className="relative mr-3 aspect-[9/16] h-[88vh] shrink-0 overflow-hidden rounded-[32px] shadow-[0_18px_44px_-16px_rgba(0,0,0,0.35)]"
      style={style}
    >
      <div
        className={`model-stage absolute inset-0 ${
          blurred ? "model-stage-blur" : revealing ? "model-stage-reveal" : ""
        }`}
        style={backgroundStyle}
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
