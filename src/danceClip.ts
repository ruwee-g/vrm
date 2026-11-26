import * as THREE from "three";
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export const EDITED_DANCE_URL = "/animations/dance-simple.glb";
export const BASELINE_DANCE_URL = "/animations/dance.vrma";

const BAKE_FPS = 180;

type TrackSampler = {
  evaluate: (time: number) => ArrayLike<number>;
  kind: "quaternion" | "vector" | "number";
};

const LEG_BONES = new Set<VRMHumanBoneName>([
  "hips",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
]);

const LATERAL_SWAY_SCALE = 0.45;
const LATERAL_ROLL_SCALE = 0.5;
const LATERAL_ROLL_BONES = new Set<VRMHumanBoneName>([
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
]);

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
    return [{ sourceName, sourceNode, targetName, targetNode, sourceRestQ, targetRestQ }];
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
  const rollEuler = new THREE.Euler();

  for (const time of times) {
    mixer.setTime(time);
    sourceScene.updateMatrixWorld(true);

    const animatedTargetWorld = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const pair of pairs) {
      const sourceWorldQ = pair.sourceNode.getWorldQuaternion(new THREE.Quaternion());
      const worldDelta = sourceWorldQ
        .clone()
        .multiply(pair.sourceRestQ.clone().invert());
      if (LATERAL_ROLL_BONES.has(pair.targetName)) {
        rollEuler.setFromQuaternion(worldDelta, "XYZ");
        rollEuler.z *= LATERAL_ROLL_SCALE;
        worldDelta.setFromEuler(rollEuler);
      }
      const targetWorldQ = worldDelta.multiply(pair.targetRestQ);
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
      deltaWorld.x *= LATERAL_SWAY_SCALE;

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

function resampleTrack(
  track: THREE.KeyframeTrack,
  times: number[],
  sourceDuration: number,
  targetDuration: number,
) {
  const interpolant = (
    track as THREE.KeyframeTrack & {
      createInterpolant: () => { evaluate: (time: number) => ArrayLike<number> };
    }
  ).createInterpolant();
  const values: number[] = [];
  for (const time of times) {
    const sourceTime = targetDuration > 0 ? (time / targetDuration) * sourceDuration : time;
    values.push(...Array.from(interpolant.evaluate(sourceTime)));
  }
  if (track instanceof THREE.QuaternionKeyframeTrack) {
    return new THREE.QuaternionKeyframeTrack(track.name, times, values);
  }
  if (track instanceof THREE.VectorKeyframeTrack) {
    return new THREE.VectorKeyframeTrack(track.name, times, values);
  }
  return new THREE.NumberKeyframeTrack(track.name, times, values);
}

// First dance as-is, but its legs and hips are replaced with the edited dance,
// so the corrected knee bend and reduced sway stay in both phases.
export function makeHybridBaselineClip(
  baseline: THREE.AnimationClip,
  edited: THREE.AnimationClip,
) {
  const sample = baseline.tracks.find((track) => track.name === "hips.quaternion") ?? baseline.tracks[0];
  if (!sample) return baseline;
  const times = Array.from(sample.times);
  const tracks = baseline.tracks.map((track) => {
    const bone = track.name.split(".")[0] as VRMHumanBoneName;
    if (!LEG_BONES.has(bone)) return track;
    const source = edited.tracks.find((item) => item.name === track.name);
    if (!source) return track;
    return resampleTrack(source, times, edited.duration, baseline.duration);
  });
  return new THREE.AnimationClip("Dance First With Current Legs", baseline.duration, tracks);
}

function samplersFor(clip: THREE.AnimationClip) {
  const samplers = new Map<string, TrackSampler>();
  for (const track of clip.tracks) {
    const interpolant = (
      track as THREE.KeyframeTrack & {
        createInterpolant: () => { evaluate: (time: number) => ArrayLike<number> };
      }
    ).createInterpolant();
    const kind =
      track instanceof THREE.QuaternionKeyframeTrack
        ? "quaternion"
        : track instanceof THREE.VectorKeyframeTrack
          ? "vector"
          : "number";
    samplers.set(track.name, { evaluate: (time) => interpolant.evaluate(time), kind });
  }
  return samplers;
}

// Bakes "4x edited dance -> 7x first dance" into one loopable clip with
// crossfades at both seams. All playback speed is applied to the final action.
export function bakeDanceSequence(
  edited: THREE.AnimationClip,
  first: THREE.AnimationClip,
  cyclesCurrent: number,
  cyclesFirst: number,
  crossfade: number,
) {
  const sectionCurrent = cyclesCurrent * edited.duration;
  const sectionFirst = cyclesFirst * first.duration;
  const total = sectionCurrent + sectionFirst;
  const fade = Math.min(crossfade, sectionCurrent / 3, sectionFirst / 3);

  const currentSamplers = samplersFor(edited);
  const firstSamplers = samplersFor(first);
  const names = new Set([...currentSamplers.keys(), ...firstSamplers.keys()]);

  const times: number[] = [];
  const frameCount = Math.round(total * BAKE_FPS);
  for (let frame = 0; frame <= frameCount; frame += 1) {
    times.push(Math.min(total, frame / BAKE_FPS));
  }
  if (times[times.length - 1] !== total) times.push(total);

  const valuesByName = new Map<string, number[]>();
  for (const name of names) valuesByName.set(name, []);

  const quaternionA = new THREE.Quaternion();
  const quaternionB = new THREE.Quaternion();

  const positiveMod = (value: number, length: number) =>
    ((value % length) + length) % length;
  const smoothstep = (value: number) => value * value * (3 - 2 * value);

  // 7 seconds of the first dance are not a whole number of edited-dance
  // cycles. Without this correction the edited clip ends halfway through a
  // cycle and snaps to its start when the whole clip loops. During the first
  // section its speed is adjusted (invisible at weight 0) so both seams land
  // exactly on a cycle boundary.
  const catchupCycles = Math.max(1, Math.round(sectionFirst / edited.duration));
  const catchupSpeed = (catchupCycles * edited.duration) / sectionFirst;

  for (const time of times) {
    // Both source clips keep looping continuously; only their blend weight
    // changes at the seams. Resetting a source at a seam caused a visible jump.
    const loopTime = time >= total ? 0 : time;
    const currentTime = positiveMod(
      loopTime < sectionCurrent
        ? loopTime
        : sectionCurrent + (loopTime - sectionCurrent) * catchupSpeed,
      edited.duration,
    );
    const firstTime = positiveMod(loopTime - sectionCurrent, first.duration);
    let blend: number;
    if (loopTime < sectionCurrent - fade) {
      blend = 0;
    } else if (loopTime < sectionCurrent) {
      blend = smoothstep((loopTime - (sectionCurrent - fade)) / fade);
    } else if (loopTime < total - fade) {
      blend = 1;
    } else {
      blend = 1 - smoothstep((loopTime - (total - fade)) / fade);
    }

    for (const name of names) {
      const current = currentSamplers.get(name);
      const firstSampler = firstSamplers.get(name);
      const values = valuesByName.get(name)!;
      if (!current) {
        values.push(...Array.from(firstSampler!.evaluate(firstTime)));
        continue;
      }
      if (!firstSampler) {
        values.push(...Array.from(current.evaluate(currentTime)));
        continue;
      }
      const currentValues =
        blend < 1 ? Array.from(current.evaluate(currentTime)) : null;
      const firstValues = blend > 0 ? Array.from(firstSampler.evaluate(firstTime)) : null;
      if (!currentValues) {
        values.push(...firstValues!);
      } else if (!firstValues) {
        values.push(...currentValues);
      } else if (current.kind === "quaternion") {
        quaternionA.fromArray(currentValues);
        quaternionB.fromArray(firstValues);
        quaternionA.slerp(quaternionB, blend);
        values.push(quaternionA.x, quaternionA.y, quaternionA.z, quaternionA.w);
      } else {
        for (let index = 0; index < currentValues.length; index += 1) {
          values.push(currentValues[index] + (firstValues[index] - currentValues[index]) * blend);
        }
      }
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const [name, values] of valuesByName) {
    const template =
      edited.tracks.find((track) => track.name === name) ??
      first.tracks.find((track) => track.name === name)!;
    if (template instanceof THREE.QuaternionKeyframeTrack) {
      tracks.push(new THREE.QuaternionKeyframeTrack(name, times, values));
    } else if (template instanceof THREE.VectorKeyframeTrack) {
      tracks.push(new THREE.VectorKeyframeTrack(name, times, values));
    } else {
      tracks.push(new THREE.NumberKeyframeTrack(name, times, values));
    }
  }

  return new THREE.AnimationClip("Dance Final", total, tracks);
}
