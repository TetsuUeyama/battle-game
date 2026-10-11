/**
 * ARP リグ(QueenMarika_rig)は変形ボーンがルート直下に散らばり、使える階層が無い。
 * そこで標準(Humanoid)セグメントを定義し、各 ARP ボーンをセグメントへ写像する。
 * セグメントは標準名で命名し、clean な humanoid 親子で組む。
 */

/** セグメント → 親セグメント（null = ルート） */
export const SEGMENT_PARENT: Record<string, string | null> = {
  Hips: null,
  Spine: "Hips",
  Chest: "Spine",
  Neck: "Chest",
  Head: "Neck",
  LeftShoulder: "Chest",
  RightShoulder: "Chest",
  LeftUpperArm: "LeftShoulder",
  RightUpperArm: "RightShoulder",
  LeftLowerArm: "LeftUpperArm",
  RightLowerArm: "RightUpperArm",
  LeftHand: "LeftLowerArm",
  RightHand: "RightLowerArm",
  LeftUpperLeg: "Hips",
  RightUpperLeg: "Hips",
  LeftLowerLeg: "LeftUpperLeg",
  RightLowerLeg: "RightUpperLeg",
  LeftFoot: "LeftLowerLeg",
  RightFoot: "RightLowerLeg",
};

/** 各指 3 関節 × 5 指 × 2 手 を SEGMENT_PARENT に追加 */
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"];
const PHAL = ["Proximal", "Intermediate", "Distal"];
for (const side of ["Left", "Right"]) {
  for (const f of FINGERS) {
    SEGMENT_PARENT[`${side}${f}Proximal`] = `${side}Hand`;
    SEGMENT_PARENT[`${side}${f}Intermediate`] = `${side}${f}Proximal`;
    SEGMENT_PARENT[`${side}${f}Distal`] = `${side}${f}Intermediate`;
  }
}

/** セグメント → head 位置に使う代表 ARP ボーン名 */
export const SEGMENT_REP: Record<string, string> = {
  Hips: "c_root_bend.x",
  Spine: "c_spine_01_bend.x",
  Chest: "c_spine_03_bend.x",
  Neck: "neck.x",
  Head: "head.x",
  LeftShoulder: "shoulder.l",
  RightShoulder: "shoulder.r",
  // 上腕/太ももの pivot は近位(関節側)の twist ボーン head を使う
  // （stretch ボーンの head は部位中央なので回転中心がずれて崩れる）
  LeftUpperArm: "c_arm_twist.l",
  RightUpperArm: "c_arm_twist.r",
  LeftLowerArm: "c_forearm_stretch.l",
  RightLowerArm: "c_forearm_stretch.r",
  LeftHand: "hand.l",
  RightHand: "hand.r",
  LeftUpperLeg: "c_thigh_twist.l",
  RightUpperLeg: "c_thigh_twist.r",
  LeftLowerLeg: "c_leg_stretch.l",
  RightLowerLeg: "c_leg_stretch.r",
  LeftFoot: "foot.l",
  RightFoot: "foot.r",
};
const FINGER_REP: Record<string, [string, string, string]> = {
  Thumb: ["thumb1", "c_thumb2", "c_thumb3"],
  Index: ["index1", "c_index2", "c_index3"],
  Middle: ["middle1", "c_middle2", "c_middle3"],
  Ring: ["ring1", "c_ring2", "c_ring3"],
  Little: ["pinky1", "c_pinky2", "c_pinky3"],
};
for (const [side, suf] of [["Left", "l"], ["Right", "r"]] as const) {
  for (const f of FINGERS) {
    const reps = FINGER_REP[f];
    PHAL.forEach((p, i) => {
      SEGMENT_REP[`${side}${f}${p}`] = `${reps[i]}.${suf}`;
    });
  }
}

export const ALL_SEGMENTS: string[] = Object.keys(SEGMENT_PARENT);

/** .l / .r → Left / Right */
function side(name: string): "Left" | "Right" | null {
  if (/\.l$|_l$|\bl$/i.test(name) || name.endsWith(".l")) return "Left";
  if (/\.r$|_r$|\br$/i.test(name) || name.endsWith(".r")) return "Right";
  return null;
}

/**
 * ARP ボーン名 → 標準セグメント名（無ければ null）。
 * 順序重要: forearm を arm より先に、toes を foot 系で、spine_03 を Chest 等。
 */
export function arpToSegment(bone: string): string | null {
  const n = bone.toLowerCase();
  const s = side(bone); // Left/Right/null

  // --- 中央(.x) 系 ---
  if (/(^|_)c?_?root_bend|^genital|^vagina|^butt/.test(n)) return "Hips";
  if (/spine_01|spine_02/.test(n)) return "Spine";
  if (/spine_03|^breast|^nipple/.test(n)) return "Chest";
  if (/^neck/.test(n)) return "Neck";
  if (/^head|jawbone|^tong|c_eye|c_lip|c_brow|c_eyelid|c_eyebrow|c_cheek|c_chin|c_nose|c_ear|c_teeth/.test(n))
    return "Head";

  if (!s) return null; // 以降は左右が要る

  // --- 脚・足を先に（toe ボーンが thumb1/index1 等の文字列を含むため）---
  if (/toes|^foot/.test(n)) return `${s}Foot`;
  if (/thigh/.test(n)) return `${s}UpperLeg`;
  if (/leg|knee/.test(n)) return `${s}LowerLeg`;

  // --- 指（手）--- forearm/arm より先に判定。各関節(proximal/intermediate/distal)を保持。
  if (/thumb1|c_thumb1/.test(n)) return `${s}ThumbProximal`;
  if (/c_thumb2/.test(n)) return `${s}ThumbIntermediate`;
  if (/c_thumb3/.test(n)) return `${s}ThumbDistal`;
  if (/index1|c_index1/.test(n)) return `${s}IndexProximal`;
  if (/c_index2/.test(n)) return `${s}IndexIntermediate`;
  if (/c_index3/.test(n)) return `${s}IndexDistal`;
  if (/middle1|c_middle1/.test(n)) return `${s}MiddleProximal`;
  if (/c_middle2/.test(n)) return `${s}MiddleIntermediate`;
  if (/c_middle3/.test(n)) return `${s}MiddleDistal`;
  if (/ring1|c_ring1/.test(n)) return `${s}RingProximal`;
  if (/c_ring2/.test(n)) return `${s}RingIntermediate`;
  if (/c_ring3/.test(n)) return `${s}RingDistal`;
  if (/pinky1|c_pinky1/.test(n)) return `${s}LittleProximal`;
  if (/c_pinky2/.test(n)) return `${s}LittleIntermediate`;
  if (/c_pinky3/.test(n)) return `${s}LittleDistal`;

  if (/^hand/.test(n)) return `${s}Hand`;
  if (/shoulder/.test(n)) return `${s}Shoulder`;
  if (/forearm|lowerarm_elbow/.test(n)) return `${s}LowerArm`;
  if (/arm/.test(n)) return `${s}UpperArm`;

  return null;
}
