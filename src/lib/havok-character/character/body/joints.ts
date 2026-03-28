/**
 * 関節可動域制限。IKソルバーが関節角度をクランプする際に参照する。
 */

export interface JointLimitDef {
  /** 最小曲げ角 (deg, 0=完全伸展) */
  minBendDeg: number;
  /** 最大曲げ角 (deg) */
  maxBendDeg: number;
}

/** 1軸の角度制限 */
export interface AxisLimitDeg {
  min: number;
  max: number;
}

/** XYZ 3軸の角度制限 */
export interface AxisLimits3 {
  x: AxisLimitDeg;
  y: AxisLimitDeg;
  z: AxisLimitDeg;
}

export const JOINT_CONFIG = {
  arm: {
    /** IKソルバー用の単軸制限 (従来互換) */
    root: { minBendDeg: 0, maxBendDeg: 170 } as JointLimitDef,  // 肩
    mid:  { minBendDeg: 5, maxBendDeg: 150 } as JointLimitDef,  // 肘
    /** 上腕 (肩関節) のXYZ制限 */
    upperArm: {
      x: { min: -75,  max: 75 },  // 腕を後ろ / 前上方
      y: { min: -45,  max: 45 },   // 内旋 / 外旋
      z: { min: -90, max: 180 },  // 体側 / 真横〜頭上 (IKで大きく動くので広め)
    } as AxisLimits3,
    /** 前腕 (肘関節) のXYZ制限 */
    foreArm: {
      x: { min: -150,   max: 0 },   // 肘は伸展0°〜屈曲150°
      y: { min: -80, max: 80 },    // 前腕の回内/回外
      z: { min: -150,  max: 5 },     // 肘は横方向ほぼなし
    } as AxisLimits3,
  },
  leg: {
    root: { minBendDeg: 0, maxBendDeg: 120 } as JointLimitDef,  // 股関節
    mid:  { minBendDeg: 5, maxBendDeg: 140 } as JointLimitDef,  // 膝
  },
  shoulder: {
    x: { min: -45, max: 45 } as AxisLimitDeg,   // 鎖骨の上下
    y: { min: -45, max: 45 } as AxisLimitDeg,   // 鎖骨のねじり
    z: { min: 0,  max: 45 } as AxisLimitDeg,   // 鎖骨の前後
  },
  spine: {
    x: { min: -20, max: 30 },   // 前屈 / 後屈
    y: { min: -45, max: 45 },   // 体幹ひねり
    z: { min: -15, max: 15 },   // 側屈
  } as AxisLimits3,
  spine1: {
    x: { min: -25, max: 25 },   // 前屈 / 後屈
    y: { min: -45, max: 45 },   // 体幹ひねり
    z: { min: -25, max: 25 },   // 側屈
  } as AxisLimits3,
  spine2: {
    x: { min: -20, max: 20 },   // 前屈 / 後屈
    y: { min: -45, max: 45 },   // 体幹ひねり
    z: { min: -20, max: 20 },   // 側屈
  } as AxisLimits3,
} as const;
