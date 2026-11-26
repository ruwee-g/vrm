import * as THREE from "three";
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export const EDITED_DANCE_URL = "/animations/dance-simple.glb";

type BonePair = [source: string, target: VRMHumanBoneName];

const FINGERS = ["index", "middle", "ring", "little"] as const;

const BONE_PAIRS: BonePair[] = [
  ["pelvis", "hips"],
  ["spine_01", "spine"],
  ["spine_02", "chest"],
  ["spine_03", "upperChest"],
  ["neck_01", "neck"],
  ["head", "head"],
  ["clavicle_l", "leftShoulder"],
  ["upperarm_l", "leftUpperArm"],
  ["lowerarm_l", "leftLowerArm"],
  ["hand_l", "leftHand"],
  ["clavicle_r", "rightShoulder"],
  ["upperarm_r", "rightUpperArm"],
  ["lowerarm_r", "rightLowerArm"],
  ["hand_r", "rightHand"],
  ["thigh_l", "leftUpperLeg"],
  ["calf_l", "leftLowerLeg"],
  ["foot_l", "leftFoot"],
  ["ball_l", "leftToes"],
  ["thigh_r", "rightUpperLeg"],
  ["calf_r", "rightLowerLeg"],
  ["foot_r", "rightFoot"],
  ["ball_r", "rightToes"],
];

for (const side of ["l", "r"] as const) {
  const prefix = side === "l" ? "left" : "right";
  BONE_PAIRS.push(
    [`thumb_01_${side}`, `${prefix}ThumbMetacarpal` as VRMHumanBoneName],
    [`thumb_02_${side}`, `${prefix}ThumbProximal` as VRMHumanBoneName],
    [`thumb_03_${side}`, `${prefix}ThumbDistal` as VRMHumanBoneName],
  );
  for (const finger of FINGERS) {
    BONE_PAIRS.push(
      [`${finger}_01_${side}`, `${prefix}${capitalize(finger)}Proximal` as VRMHumanBoneName],
      [`${finger}_02_${side}`, `${prefix}${capitalize(finger)}Intermediate` as VRMHumanBoneName],
      [`${finger}_03_${side}`, `${prefix}${capitalize(finger)}Distal` as VRMHumanBoneName],
    );
  }
}

type ArmBoneName =
  | "leftShoulder"
  | "leftUpperArm"
  | "leftLowerArm"
  | "leftHand"
  | "rightShoulder"
  | "rightUpperArm"
  | "rightLowerArm"
  | "rightHand";

const ARM_MOTION: Record<
  ArmBoneName,
  { pitch: number; roll: number; yaw: number; phase: number }
> = {
  leftShoulder: { pitch: 0.006, roll: 0.012, yaw: 0, phase: 0 },
  leftUpperArm: { pitch: 0.022, roll: 0.015, yaw: 0.008, phase: 0 },
  leftLowerArm: { pitch: 0.014, roll: 0.01, yaw: 0, phase: 0.6 },
  leftHand: { pitch: 0.018, roll: 0.012, yaw: 0, phase: 1.1 },
  rightShoulder: { pitch: 0.006, roll: -0.012, yaw: 0, phase: Math.PI },
  rightUpperArm: { pitch: 0.022, roll: -0.015, yaw: -0.008, phase: Math.PI },
  rightLowerArm: { pitch: 0.014, roll: -0.01, yaw: 0, phase: Math.PI + 0.6 },
  rightHand: { pitch: 0.018, roll: -0.012, yaw: 0, phase: Math.PI + 1.1 },
};

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function worldQuaternions(root: THREE.Object3D) {
  const map = new Map<THREE.Object3D, THREE.Quaternion>();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    map.set(object, object.getWorldQuaternion(new THREE.Quaternion()));
  });
  return map;
}

function parentWorldQuaternion(
  node: THREE.Object3D,
  animated: Map<THREE.Object3D, THREE.Quaternion>,
  rest: Map<THREE.Object3D, THREE.Quaternion>,
) {
  const missing: THREE.Object3D[] = [];
  let parent = node.parent;
  while (parent && !animated.has(parent)) {
    missing.unshift(parent);
    parent = parent.parent;
  }

  let result = parent ? animated.get(parent)!.clone() : new THREE.Quaternion();

  for (const object of missing) {
    const parentRest = object.parent
      ? rest.get(object.parent) ?? new THREE.Quaternion()
      : new THREE.Quaternion();
    const objectRest = rest.get(object) ?? new THREE.Quaternion();
    const localRest = parentRest.clone().invert().multiply(objectRest);
    result.multiply(localRest);
  }
  return result;
}

function naturalizeArms(
  tracks: THREE.KeyframeTrack[],
  targetNodes: Map<VRMHumanBoneName, THREE.Object3D>,
  times: number[],
  duration: number,
) {
  const euler = new THREE.Euler();
  const wobbleQuat = new THREE.Quaternion();

  for (const [name, motion] of Object.entries(ARM_MOTION) as Array<[ArmBoneName, typeof ARM_MOTION[ArmBoneName]]>) {
    const node = targetNodes.get(name);
    if (!node) continue;
    const track = tracks.find((item) => item.name === `${node.name}.quaternion`);
    if (!track) continue;

    const rest = node.quaternion.clone();
    const values: number[] = [];
    for (const time of times) {
      const wave = Math.sin((time / Math.max(duration, 0.001)) * Math.PI * 2 + motion.phase);
      euler.set(
        motion.pitch * wave,
        motion.yaw * Math.sin(wave * 0.7),
        motion.roll * Math.cos(wave),
      );
      wobbleQuat.setFromEuler(euler);
      const quaternions = rest.clone().multiply(wobbleQuat);
      values.push(quaternions.x, quaternions.y, quaternions.z, quaternions.w);
    }
    track.values.set(values);
  }

  for (const side of ["l", "r"] as const) {
    const prefix = side === "l" ? "left" : "right";
    const fingerNames: VRMHumanBoneName[] = [
      `${prefix}ThumbMetacarpal`,
      `${prefix}ThumbProximal`,
      `${prefix}ThumbDistal`,
      `${prefix}IndexProximal`,
      `${prefix}IndexIntermediate`,
      `${prefix}IndexDistal`,
      `${prefix}MiddleProximal`,
      `${prefix}MiddleIntermediate`,
      `${prefix}MiddleDistal`,
      `${prefix}RingProximal`,
      `${prefix}RingIntermediate`,
      `${prefix}RingDistal`,
      `${prefix}LittleProximal`,
      `${prefix}LittleIntermediate`,
      `${prefix}LittleDistal`,
    ] as VRMHumanBoneName[];

    for (const name of fingerNames) {
      const node = targetNodes.get(name);
      if (!node) continue;
      const track = tracks.find((item) => item.name === `${node.name}.quaternion`);
      if (!track) continue;
      const rest = node.quaternion.clone();
      const values: number[] = [];
      for (const time of times) {
        const wave = Math.sin((time / Math.max(duration, 0.001)) * Math.PI * 2);
        euler.set(wave * 0.008, 0, side === "l" ? wave * 0.006 : -wave * 0.006);
        wobbleQuat.setFromEuler(euler);
        const quaternions = rest.clone().multiply(wobbleQuat);
        values.push(quaternions.x, quaternions.y, quaternions.z, quaternions.w);
      }
      track.values.set(values);
    }
  }
}

function retargetDanceClip(gltf: GLTF, vrm: VRM) {
  const sourceClip = gltf.animations[0];
  if (!sourceClip) return null;

  const sourceScene = gltf.scene;
  sourceScene.updateMatrixWorld(true);
  const sourceByName = new Map<string, THREE.Object3D>();
  sourceScene.traverse((object) => {
    if (object.name) sourceByName.set(object.name, object);
  });

  const sourceRest = worldQuaternions(sourceScene);
  const targetRest = worldQuaternions(vrm.scene);
  const targetNodes = new Map<VRMHumanBoneName, THREE.Object3D>();

  const pairs = BONE_PAIRS.flatMap(([sourceName, targetName]) => {
    const sourceNode = sourceByName.get(sourceName);
    const targetNode = vrm.humanoid.getNormalizedBoneNode(targetName);
    if (!sourceNode || !targetNode) return [];
    targetNodes.set(targetName, targetNode);
    const sourceRestQ = sourceRest.get(sourceNode);
    const targetRestQ = targetRest.get(targetNode);
    if (!sourceRestQ || !targetRestQ) return [];
    return [{ sourceName, sourceNode, targetNode, sourceRestQ, targetRestQ }];
  });

  const hipsPair = pairs.find(
    (pair) => pair.targetNode === vrm.humanoid.getNormalizedBoneNode("hips"),
  );
  const sourceHipsRest = hipsPair
    ? hipsPair.sourceNode.getWorldPosition(new THREE.Vector3())
    : null;
  const targetHipsRest = hipsPair
    ? hipsPair.targetNode.getWorldPosition(new THREE.Vector3())
    : null;
  const targetHipsLocalRest = hipsPair ? hipsPair.targetNode.position.clone() : null;
  const translationScale =
    sourceHipsRest && targetHipsRest && sourceHipsRest.y > 0.01
      ? targetHipsRest.y / sourceHipsRest.y
      : 1;

  const times: number[] = [];
  const frameCount = Math.max(2, Math.round(sourceClip.duration * 24));
  for (let frame = 0; frame <= frameCount; frame += 1) {
    times.push(Math.min(sourceClip.duration, frame / 24));
  }

  const tracks: THREE.KeyframeTrack[] = [];
  const rotationValues = new Map<string, number[]>();
  for (const pair of pairs) rotationValues.set(pair.sourceName, []);
  const hipsValues: number[] = [];

  const mixer = new THREE.AnimationMixer(sourceScene);
  const action = mixer.clipAction(sourceClip);
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();

  for (const time of times) {
    mixer.setTime(time);
    sourceScene.updateMatrixWorld(true);

    const animatedTargetWorld = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const pair of pairs) {
      const sourceWorldQ = pair.sourceNode.getWorldQuaternion(new THREE.Quaternion());
      const delta = pair.sourceRestQ.clone().invert().multiply(sourceWorldQ);
      const targetWorldQ = pair.targetRestQ.clone().multiply(delta);
      animatedTargetWorld.set(pair.targetNode, targetWorldQ);

      const parentQ = parentWorldQuaternion(pair.targetNode, animatedTargetWorld, targetRest);
      const localQ = parentQ.invert().multiply(targetWorldQ);
      rotationValues.get(pair.sourceName)!.push(localQ.x, localQ.y, localQ.z, localQ.w);
    }

    if (hipsPair && sourceHipsRest && targetHipsRest && targetHipsLocalRest) {
      const sourceHipsWorld = hipsPair.sourceNode.getWorldPosition(new THREE.Vector3());
      const deltaWorld = sourceHipsWorld.sub(sourceHipsRest);
      const align = hipsPair.targetRestQ
        .clone()
        .multiply(hipsPair.sourceRestQ.clone().invert());
      deltaWorld.applyQuaternion(align).multiplyScalar(translationScale);

      const parentQ = parentWorldQuaternion(hipsPair.targetNode, animatedTargetWorld, targetRest);
      deltaWorld.applyQuaternion(parentQ.invert());
      const localPosition = targetHipsLocalRest.clone().add(deltaWorld);
      hipsValues.push(localPosition.x, localPosition.y, localPosition.z);
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(sourceScene);

  for (const pair of pairs) {
    const values = rotationValues.get(pair.sourceName)!;
    if (values.length !== times.length * 4) continue;
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${pair.targetNode.name}.quaternion`,
        times,
        values,
      ),
    );
  }
  if (hipsPair && hipsValues.length === times.length * 3) {
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${hipsPair.targetNode.name}.position`,
        times,
        hipsValues,
      ),
    );
  }

  naturalizeArms(tracks, targetNodes, times, sourceClip.duration);

  return new THREE.AnimationClip("Dance Simple Edited", sourceClip.duration, tracks);
}

export async function loadEditedDanceClip(loader: GLTFLoader, vrm: VRM) {
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(EDITED_DANCE_URL);
  return retargetDanceClip(gltf, vrm);
}
