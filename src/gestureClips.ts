import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import type { ReactionId } from "./reactions";

type Vec3 = [pitch: number, yaw: number, roll: number];

type GestureFrame = {
  time: number;
  bones: Partial<Record<VRMHumanBoneName, Vec3>>;
};

type GestureDefinition = {
  duration: number;
  frames: GestureFrame[];
};

// Local Euler offsets relative to the model's relaxed pose. The tracks are
// baked on the normalized humanoid bones so the mixer can crossfade them with
// the dance and VRMA actions instead of accumulating per-frame overlays.
// Clips that do not animate arms still need to write a rest value for them,
// otherwise the last dance pose would stay on the bones when the dance fades.
const REST_ARM_BONES: VRMHumanBoneName[] = [
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
];

// Durations match REACTIONS so the body finishes with the face and gaze.
const GESTURES: Partial<Record<ReactionId, GestureDefinition>> = {
  happy: {
    duration: 2.1,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.28,
        bones: {
          hips: [0, 0, 0.015],
          head: [-0.055, 0, 0],
        },
      },
      { time: 0.6, bones: {} },
      {
        time: 0.9,
        bones: {
          head: [-0.035, 0, 0],
        },
      },
      { time: 1.25, bones: {} },
      {
        time: 1.55,
        bones: {
          head: [-0.03, 0, 0],
        },
      },
      { time: 2.1, bones: {} },
    ],
  },
  surprised: {
    duration: 1.8,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.16,
        bones: {
          head: [-0.14, 0, 0],
          leftShoulder: [0, 0, 0.12],
          rightShoulder: [0, 0, -0.12],
          leftUpperArm: [0.14, 0, 0.3],
          rightUpperArm: [0.14, 0, -0.3],
          leftLowerArm: [-0.6, 0, 0],
          rightLowerArm: [-0.6, 0, 0],
        },
      },
      {
        time: 0.65,
        bones: {
          head: [-0.09, 0, 0],
          leftUpperArm: [0.09, 0, 0.2],
          rightUpperArm: [0.09, 0, -0.2],
          leftLowerArm: [-0.35, 0, 0],
          rightLowerArm: [-0.35, 0, 0],
        },
      },
      {
        time: 1.15,
        bones: {
          head: [-0.05, 0, 0],
          leftUpperArm: [0.04, 0, 0.08],
          rightUpperArm: [0.04, 0, -0.08],
        },
      },
      { time: 1.8, bones: {} },
    ],
  },
  sad: {
    duration: 2.8,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.55,
        bones: {
          chest: [0.03, 0, 0],
          head: [0.1, 0, 0],
        },
      },
      {
        time: 1.7,
        bones: {
          chest: [0.02, 0, 0],
          head: [0.08, 0, 0],
        },
      },
      { time: 2.8, bones: {} },
    ],
  },
  angry: {
    duration: 2.2,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.28,
        bones: {
          chest: [0.03, 0, 0],
          head: [0.055, 0, 0],
        },
      },
      {
        time: 0.75,
        bones: {
          chest: [0.025, 0, 0],
          head: [0.045, 0, 0],
        },
      },
      {
        time: 1.2,
        bones: {
          chest: [0.025, 0, 0],
          head: [0.05, 0, 0],
        },
      },
      { time: 2.2, bones: {} },
    ],
  },
  smug: {
    duration: 3,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.4,
        bones: {
          hips: [0, 0.035, 0.02],
          chest: [-0.02, 0, -0.025],
          head: [0.02, 0, 0.12],
          leftShoulder: [0, 0, 0.1],
          rightShoulder: [0, 0, -0.03],
          leftUpperArm: [0.07, 0, 0.14],
          rightUpperArm: [0.06, 0, -0.06],
          leftLowerArm: [-0.25, 0, 0],
        },
      },
      {
        time: 2.1,
        bones: {
          hips: [0, 0.025, 0.015],
          chest: [-0.015, 0, -0.015],
          head: [0.01, 0, 0.09],
          leftShoulder: [0, 0, 0.07],
          leftUpperArm: [0.05, 0, 0.1],
        },
      },
      { time: 3, bones: {} },
    ],
  },
  think: {
    duration: 3.2,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.5,
        bones: {
          hips: [0, 0, 0.02],
          chest: [0.015, 0, 0],
          head: [-0.04, 0.04, 0.09],
          leftShoulder: [0, 0, 0.04],
          leftUpperArm: [0.04, 0, 0.04],
          rightUpperArm: [0.14, 0, 0.14],
          rightLowerArm: [-0.9, 0, 0],
          rightHand: [-0.25, 0, 0],
        },
      },
      {
        time: 1.9,
        bones: {
          head: [-0.03, 0.06, 0.08],
          rightUpperArm: [0.11, 0, 0.12],
          rightLowerArm: [-0.8, 0, 0],
          rightHand: [-0.2, 0, 0],
        },
      },
      { time: 2.6, bones: {} },
      { time: 3.2, bones: {} },
    ],
  },
  // A short respectful bow. Wave keeps the VRMA greeting animation, so the two
  // reactions are visually distinct.
  greeting: {
    duration: 2.7,
    frames: [
      { time: 0, bones: {} },
      {
        time: 0.4,
        bones: {
          spine: [0.03, 0, 0],
          chest: [0.06, 0, 0],
          upperChest: [0.02, 0, 0],
          head: [0.06, 0, 0],
          leftUpperArm: [0.06, 0, 0.08],
          rightUpperArm: [0.06, 0, -0.08],
          leftLowerArm: [-0.12, 0, 0],
          rightLowerArm: [-0.12, 0, 0],
        },
      },
      {
        time: 1.1,
        bones: {
          spine: [0.03, 0, 0],
          chest: [0.06, 0, 0],
          upperChest: [0.02, 0, 0],
          head: [0.06, 0, 0],
          leftUpperArm: [0.06, 0, 0.08],
          rightUpperArm: [0.06, 0, -0.08],
        },
      },
      {
        time: 1.8,
        bones: {
          chest: [0.015, 0, 0],
          head: [0.02, 0, 0],
        },
      },
      { time: 2.7, bones: {} },
    ],
  },
};

function gestureClip(vrm: VRM, id: ReactionId, definition: GestureDefinition) {
  const boneNames = new Set<VRMHumanBoneName>(REST_ARM_BONES);
  for (const frame of definition.frames) {
    for (const name of Object.keys(frame.bones)) {
      boneNames.add(name as VRMHumanBoneName);
    }
  }

  const times = definition.frames.map((frame) => frame.time);
  const euler = new THREE.Euler();
  const offset = new THREE.Quaternion();
  const tracks: THREE.KeyframeTrack[] = [];

  for (const name of boneNames) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) continue;
    const rest = node.quaternion.clone();
    const values: number[] = [];
    for (const frame of definition.frames) {
      const angles = frame.bones[name] ?? [0, 0, 0];
      euler.set(angles[0], angles[1], angles[2]);
      offset.setFromEuler(euler);
      const value = rest.clone().multiply(offset);
      values.push(value.x, value.y, value.z, value.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values));
  }

  return new THREE.AnimationClip(`Gesture ${id}`, definition.duration, tracks);
}

export function createReactionGestureClips(vrm: VRM) {
  const clips = new Map<ReactionId, THREE.AnimationClip>();
  for (const [id, definition] of Object.entries(GESTURES)) {
    if (!definition) continue;
    const reactionId = id as ReactionId;
    clips.set(reactionId, gestureClip(vrm, reactionId, definition));
  }
  return clips;
}
