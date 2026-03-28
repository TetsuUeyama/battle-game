/**
 * 関節可動域制限。IKソルバーが関節角度をクランプする際に参照する。
 */

export interface JointLimitDef {
  /** 最小曲げ角 (deg, 0=完全伸展) */
  minBendDeg: number;
  /** 最大曲げ角 (deg) */
  maxBendDeg: number;
}

export const JOINT_CONFIG = {
  arm: {
    root: { minBendDeg: 0, maxBendDeg: 170 } as JointLimitDef,  // 肩: ほぼ自由
    mid:  { minBendDeg: 5, maxBendDeg: 150 } as JointLimitDef,  // 肘: 5°〜150°
  },
  leg: {
    root: { minBendDeg: 0, maxBendDeg: 120 } as JointLimitDef,  // 股関節
    mid:  { minBendDeg: 5, maxBendDeg: 140 } as JointLimitDef,  // 膝: 5°〜140°
  },
} as const;
