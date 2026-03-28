/**
 * 足接地パラメータ。ステッピングの閾値・高さ・速度・スタンス幅を定義。
 */

export const FOOT_PLANT_CONFIG = {
  /** ステップ発動距離 (m): 腰からのズレがこの値を超えたら足を動かす */
  stepThreshold: 0.15,
  /** ステップ時の足の持ち上げ高さ (m) */
  stepHeight: 0.08,
  /** ステップにかかる時間 (秒) */
  stepDuration: 0.2,
  /** スタンス幅の半分 (m): 腰から左右への足のオフセット */
  stanceHalfWidth: 0.1,
} as const;
