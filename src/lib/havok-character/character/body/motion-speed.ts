/**
 * 各ボディパーツの最大移動速度。
 * 1秒間に動かせる最大角度(rad/s)・最大距離(m/s)を定義。
 * 全ての骨の回転変更・位置変更はこの速度制限に従う。
 *
 * angularSpeed: 回転の最大角速度 (rad/s)
 * linearSpeed:  位置移動の最大速度 (m/s)
 */

export interface PartSpeedConfig {
  /** 最大角速度 (rad/s) */
  angularSpeed: number;
}

export interface LinearSpeedConfig {
  /** 最大線形速度 (m/s) */
  linearSpeed: number;
}

/**
 * ボーン名 → 最大角速度のマッピング。
 * ここに無いボーンはレート制限なし（IK等が直接制御）。
 */
export const BONE_ANGULAR_SPEED: Record<string, number> = {
  // ── 体幹 ── (遅め: 大きな質量を動かすため)
  'mixamorig:Spine':   2.0,
  'mixamorig:Spine1':  2.2,
  'mixamorig:Spine2':  2.5,

  // ── 肩 ── (鎖骨は体幹に近い速度)
  'mixamorig:LeftShoulder':  3.0,
  'mixamorig:RightShoulder': 3.0,

  // ── 上腕 ── (腕は体幹より速く動ける)
  'mixamorig:LeftArm':   5.0,
  'mixamorig:RightArm':  5.0,

  // ── 前腕 ── (末端ほど速い)
  'mixamorig:LeftForeArm':  6.0,
  'mixamorig:RightForeArm': 6.0,

  // ── 首・頭 ──
  'mixamorig:Neck': 3.0,
  'mixamorig:Head': 4.0,
};

/**
 * 位置移動が必要なパーツの最大線形速度。
 */
export const PART_LINEAR_SPEED: Record<string, number> = {
  // Hips の Y 方向移動
  'mixamorig:Hips': 0.5,
};
