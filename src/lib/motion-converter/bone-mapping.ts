/**
 * Mixamo ボーンマッピング
 *
 * ■ 重要: Left/Right の意味
 *   Mixamo の "Left" / "Right" は **キャラクター自身** の左右。
 *   キャラクターが画面正面を向いている場合:
 *     mixamorig:LeftArm  → 画面 **右** 側 (viewer's right)
 *     mixamorig:RightArm → 画面 **左** 側 (viewer's left)
 *
 *   bone-data.json で確認:
 *     LeftShoulder  localPosition X = +6.1  (+X方向 = viewer's right)
 *     RightShoulder localPosition X = -6.1  (-X方向 = viewer's left)
 *
 *   これはMixamoの座標系(右手系)でもBabylon.js(左手系)でも同じ。
 *   X軸の意味は変わらない(Z軸だけが反転するため)。
 *
 * ■ ボーン名のプレフィックス
 *   bone-data.json: "mixamorig:Hips" (プレフィックスあり)
 *   motion.json:    "Hips"           (プレフィックスなし)
 *   → 変換時にプレフィックスの有無を正規化する
 */

/** Mixamoボーン名のプレフィックスを除去 */
export function stripMixamoPrefix(name: string): string {
  return name.replace(/^mixamorig:/, '');
}

/** Mixamoボーン名にプレフィックスを付与 (なければ追加) */
export function addMixamoPrefix(name: string): string {
  if (name.startsWith('mixamorig:')) return name;
  return `mixamorig:${name}`;
}

/**
 * IKチェーンのエンドエフェクターとなるボーン名
 * FK→IK変換で、これらのボーンのワールド位置を抽出する
 */
export const IK_END_EFFECTORS = {
  leftHand:  'LeftHand',
  rightHand: 'RightHand',
  leftFoot:  'LeftFoot',
  rightFoot: 'RightFoot',
} as const;

/**
 * IKチェーン定義 (root → mid → end)
 */
export const IK_CHAINS = {
  leftArm:  { root: 'LeftArm',   mid: 'LeftForeArm',  end: 'LeftHand' },
  rightArm: { root: 'RightArm',  mid: 'RightForeArm', end: 'RightHand' },
  leftLeg:  { root: 'LeftUpLeg', mid: 'LeftLeg',       end: 'LeftFoot' },
  rightLeg: { root: 'RightUpLeg', mid: 'RightLeg',     end: 'RightFoot' },
} as const;

/**
 * Mixamo標準の骨格階層。
 * ボーン名はプレフィックスなし。
 */
export const MIXAMO_HIERARCHY: Record<string, string | null> = {
  'Hips': null,
  'Spine': 'Hips',
  'Spine1': 'Spine',
  'Spine2': 'Spine1',
  'Neck': 'Spine2',
  'Head': 'Neck',
  'HeadTop_End': 'Head',
  'LeftShoulder': 'Spine2',
  'LeftArm': 'LeftShoulder',
  'LeftForeArm': 'LeftArm',
  'LeftHand': 'LeftForeArm',
  'RightShoulder': 'Spine2',
  'RightArm': 'RightShoulder',
  'RightForeArm': 'RightArm',
  'RightHand': 'RightForeArm',
  'LeftUpLeg': 'Hips',
  'LeftLeg': 'LeftUpLeg',
  'LeftFoot': 'LeftLeg',
  'LeftToeBase': 'LeftFoot',
  'LeftToe_End': 'LeftToeBase',
  'RightUpLeg': 'Hips',
  'RightLeg': 'RightUpLeg',
  'RightFoot': 'RightLeg',
  'RightToeBase': 'RightFoot',
  'RightToe_End': 'RightToeBase',
};

/**
 * 指ボーン (あれば)
 */
export const FINGER_BONES = [
  'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3',
  'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
  'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3',
  'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3',
  'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3',
  'RightHandThumb1', 'RightHandThumb2', 'RightHandThumb3',
  'RightHandIndex1', 'RightHandIndex2', 'RightHandIndex3',
  'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3',
  'RightHandRing1', 'RightHandRing2', 'RightHandRing3',
  'RightHandPinky1', 'RightHandPinky2', 'RightHandPinky3',
] as const;
