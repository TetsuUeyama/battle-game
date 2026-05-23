/**
 * Unity Humanoid Avatar に準拠した標準スケルトン定義。
 * Asset Store / Mixamo / 自作モデルなどリグの命名が異なるアセットを
 * この標準名へリマップしてから扱う。
 */

export const STANDARD_BONES = [
  "Hips",
  "Spine",
  "Chest",
  "UpperChest",
  "Neck",
  "Head",

  "LeftShoulder",
  "LeftUpperArm",
  "LeftLowerArm",
  "LeftHand",

  "RightShoulder",
  "RightUpperArm",
  "RightLowerArm",
  "RightHand",

  "LeftUpperLeg",
  "LeftLowerLeg",
  "LeftFoot",
  "LeftToes",

  "RightUpperLeg",
  "RightLowerLeg",
  "RightFoot",
  "RightToes",

  "LeftEye",
  "RightEye",
  "Jaw",

  "LeftThumbProximal",
  "LeftThumbIntermediate",
  "LeftThumbDistal",
  "LeftIndexProximal",
  "LeftIndexIntermediate",
  "LeftIndexDistal",
  "LeftMiddleProximal",
  "LeftMiddleIntermediate",
  "LeftMiddleDistal",
  "LeftRingProximal",
  "LeftRingIntermediate",
  "LeftRingDistal",
  "LeftLittleProximal",
  "LeftLittleIntermediate",
  "LeftLittleDistal",

  "RightThumbProximal",
  "RightThumbIntermediate",
  "RightThumbDistal",
  "RightIndexProximal",
  "RightIndexIntermediate",
  "RightIndexDistal",
  "RightMiddleProximal",
  "RightMiddleIntermediate",
  "RightMiddleDistal",
  "RightRingProximal",
  "RightRingIntermediate",
  "RightRingDistal",
  "RightLittleProximal",
  "RightLittleIntermediate",
  "RightLittleDistal",
] as const;

export type StandardBoneName = (typeof STANDARD_BONES)[number];

export const STANDARD_BONE_SET: ReadonlySet<StandardBoneName> = new Set(
  STANDARD_BONES,
);

export const REQUIRED_BONES: readonly StandardBoneName[] = [
  "Hips",
  "Spine",
  "Head",
  "LeftUpperArm",
  "LeftLowerArm",
  "LeftHand",
  "RightUpperArm",
  "RightLowerArm",
  "RightHand",
  "LeftUpperLeg",
  "LeftLowerLeg",
  "LeftFoot",
  "RightUpperLeg",
  "RightLowerLeg",
  "RightFoot",
];

/**
 * 親ボーン関係。null はルート (= Hips の親)。
 * オプショナルなボーンは親が省略されている場合があるので、
 * 解決時は親が見つからなければ祖先方向を辿って最も近い実在ボーンへ繋ぐ。
 */
export const STANDARD_PARENTS: Record<StandardBoneName, StandardBoneName | null> = {
  Hips: null,
  Spine: "Hips",
  Chest: "Spine",
  UpperChest: "Chest",
  Neck: "UpperChest",
  Head: "Neck",

  LeftShoulder: "UpperChest",
  LeftUpperArm: "LeftShoulder",
  LeftLowerArm: "LeftUpperArm",
  LeftHand: "LeftLowerArm",

  RightShoulder: "UpperChest",
  RightUpperArm: "RightShoulder",
  RightLowerArm: "RightUpperArm",
  RightHand: "RightLowerArm",

  LeftUpperLeg: "Hips",
  LeftLowerLeg: "LeftUpperLeg",
  LeftFoot: "LeftLowerLeg",
  LeftToes: "LeftFoot",

  RightUpperLeg: "Hips",
  RightLowerLeg: "RightUpperLeg",
  RightFoot: "RightLowerLeg",
  RightToes: "RightFoot",

  LeftEye: "Head",
  RightEye: "Head",
  Jaw: "Head",

  LeftThumbProximal: "LeftHand",
  LeftThumbIntermediate: "LeftThumbProximal",
  LeftThumbDistal: "LeftThumbIntermediate",
  LeftIndexProximal: "LeftHand",
  LeftIndexIntermediate: "LeftIndexProximal",
  LeftIndexDistal: "LeftIndexIntermediate",
  LeftMiddleProximal: "LeftHand",
  LeftMiddleIntermediate: "LeftMiddleProximal",
  LeftMiddleDistal: "LeftMiddleIntermediate",
  LeftRingProximal: "LeftHand",
  LeftRingIntermediate: "LeftRingProximal",
  LeftRingDistal: "LeftRingIntermediate",
  LeftLittleProximal: "LeftHand",
  LeftLittleIntermediate: "LeftLittleProximal",
  LeftLittleDistal: "LeftLittleIntermediate",

  RightThumbProximal: "RightHand",
  RightThumbIntermediate: "RightThumbProximal",
  RightThumbDistal: "RightThumbIntermediate",
  RightIndexProximal: "RightHand",
  RightIndexIntermediate: "RightIndexProximal",
  RightIndexDistal: "RightIndexIntermediate",
  RightMiddleProximal: "RightHand",
  RightMiddleIntermediate: "RightMiddleProximal",
  RightMiddleDistal: "RightMiddleIntermediate",
  RightRingProximal: "RightHand",
  RightRingIntermediate: "RightRingProximal",
  RightRingDistal: "RightRingIntermediate",
  RightLittleProximal: "RightHand",
  RightLittleIntermediate: "RightLittleProximal",
  RightLittleDistal: "RightLittleIntermediate",
};
