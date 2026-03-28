/**
 * 重心配分。各部位の質量比を定義し、重心計算 (calculateCenterOfMass) で使用。
 */

/** 各部位の質量比 (合計≒1.0) */
export const MASS_DISTRIBUTION: Record<string, number> = {
  hips: 0.20,
  torso: 0.20,
  head: 0.08,
  leftArm: 0.05,
  rightArm: 0.05,
  leftHand: 0.01,
  rightHand: 0.01,
  leftLeg: 0.10,
  rightLeg: 0.10,
  leftFoot: 0.015,
  rightFoot: 0.015,
};
