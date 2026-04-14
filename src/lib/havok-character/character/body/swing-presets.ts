/**
 * 攻撃モーション基本値。各スイングタイプの windup/strike BodyMotion プリセット。
 * 実行時に power(p) × bodyCommitment(bc) × gripCommitment(gc) でスケールされる。
 *
 * 値の意味:
 *   torsoLean:  胴体前傾 (rad, +=前傾)
 *   torsoTwist: 胴体横回転 (rad, +=右回転)
 *   hipsOffset: 腰のY移動 (m, -=しゃがみ)
 *   hipsForward: 腰の前後移動 (m, +=前方)
 *   footStepR:  右足踏み出し (m)
 *   offHand:    オフハンドオフセット [forward, up, right] (m)
 */
import { Vector3 } from '@babylonjs/core';

export interface BodyMotionPreset {
  torsoLean: number;
  torsoTwist: number;
  hipsOffset: number;
  hipsForward: number;
  footStepR: number;
  offHand: [number, number, number];
}

export interface SwingPreset {
  windup: BodyMotionPreset;
  strike: BodyMotionPreset;
}

export const SWING_PRESETS: Record<string, SwingPreset> = {
  // ─── 標的練習用 (createSwingMotion) ───
  // lean-=後傾(振りかぶり), lean+=前傾(振り下ろし)
  // twist-=左ひねり, twist+=右ひねり
  // lean: 0.33rad ≈ 正規化1.0 (各Spine可動域限界)
  // twist: 0.67rad ≈ 正規化1.0
  vertical: {
    windup: { torsoLean: 0.0, torsoTwist: 0.0, hipsOffset: 0.04, hipsForward: 0.0, footStepR: 0.0, offHand: [0.0, 0.15, 0.0] },
    strike: { torsoLean: 0.5, torsoTwist: -0.05, hipsOffset: -0.3, hipsForward: 0.2, footStepR: 0.25, offHand: [0.2, -0.2, 0.1] },
  },
  horizontal: {
    windup: { torsoLean: -0.05, torsoTwist: -0.67, hipsOffset: 0.02, hipsForward: -0.05, footStepR: 0.1, offHand: [-0.15, 0.08, -0.12] },
    strike: { torsoLean: 0.15, torsoTwist: 0.67, hipsOffset: -0.06, hipsForward: 0.1, footStepR: -0.08, offHand: [0.2, -0.08, 0.15] },
  },
  horizontal_r2l: {
    windup: { torsoLean: -0.05, torsoTwist: -0.67, hipsOffset: 0.02, hipsForward: -0.05, footStepR: 0.1, offHand: [-0.15, 0.08, -0.12] },
    strike: { torsoLean: 0.15, torsoTwist: 0.67, hipsOffset: -0.06, hipsForward: 0.1, footStepR: -0.08, offHand: [0.2, -0.08, 0.15] },
  },
  horizontal_l2r: {
    windup: { torsoLean: -0.05, torsoTwist: 0.67, hipsOffset: 0.02, hipsForward: -0.05, footStepR: -0.1, offHand: [0.15, 0.08, 0.12] },
    strike: { torsoLean: 0.15, torsoTwist: -0.67, hipsOffset: -0.06, hipsForward: 0.1, footStepR: 0.08, offHand: [-0.2, -0.08, -0.15] },
  },
  thrust: {
    windup: { torsoLean: -0.3, torsoTwist: -0.1, hipsOffset: 0.02, hipsForward: -0.1, footStepR: -0.08, offHand: [-0.08, 0.05, -0.1] },
    strike: { torsoLean: 0.4, torsoTwist: 0.05, hipsOffset: -0.04, hipsForward: 0.2, footStepR: 0.18, offHand: [0.05, -0.08, 0] },
  },
  // ─── 対キャラAI用 (close_in): さらに大きめ ───
  vertical_vs: {
    windup: { torsoLean: 0.0, torsoTwist: 0.0, hipsOffset: 0.04, hipsForward: 0.0, footStepR: 0.0, offHand: [0.0, 0.15, 0.0] },
    strike: { torsoLean: 0.5, torsoTwist: -0.05, hipsOffset: -0.3, hipsForward: 0.2, footStepR: 0.25, offHand: [0.2, -0.2, 0.1] },
  },
  horizontal_vs: {
    windup: { torsoLean: -0.05, torsoTwist: -0.67, hipsOffset: 0.02, hipsForward: -0.05, footStepR: 0.1, offHand: [-0.15, 0.08, -0.12] },
    strike: { torsoLean: 0.15, torsoTwist: 0.67, hipsOffset: -0.06, hipsForward: 0.1, footStepR: -0.08, offHand: [0.2, -0.08, 0.15] },
  },
  horizontal_r2l_vs: {
    windup: { torsoLean: -0.05, torsoTwist: -0.67, hipsOffset: 0.02, hipsForward: -0.05, footStepR: 0.1, offHand: [-0.15, 0.08, -0.12] },
    strike: { torsoLean: 0.15, torsoTwist: 0.67, hipsOffset: -0.06, hipsForward: 0.1, footStepR: -0.08, offHand: [0.2, -0.08, 0.15] },
  },
  horizontal_l2r_vs: {
    windup: { torsoLean: -0.05, torsoTwist: 0.67, hipsOffset: 0.02, hipsForward: -0.05, footStepR: -0.1, offHand: [0.15, 0.08, 0.12] },
    strike: { torsoLean: 0.15, torsoTwist: -0.67, hipsOffset: -0.06, hipsForward: 0.1, footStepR: 0.08, offHand: [-0.2, -0.08, -0.15] },
  },
  thrust_vs: {
    windup: { torsoLean: -0.25, torsoTwist: -0.2, hipsOffset: 0.04, hipsForward: -0.15, footStepR: -0.15, offHand: [-0.1, 0.08, -0.12] },
    strike: { torsoLean: 0.33, torsoTwist: 0.1, hipsOffset: -0.08, hipsForward: 0.3, footStepR: 0.3, offHand: [0.08, -0.1, 0] },
  },
};

/** BodyMotionPreset を power × bodyCommitment × gripCommitment でスケール */
export function scalePreset(
  preset: BodyMotionPreset,
  p: number,
  bc: number,
  gc: number,
): { torsoLean: number; torsoTwist: number; hipsOffset: number; hipsForward: number; footStepR: number; offHandOffset: Vector3 } {
  return {
    torsoLean: preset.torsoLean * p * bc * gc,
    torsoTwist: preset.torsoTwist * p * bc * gc,
    hipsOffset: preset.hipsOffset * p * bc,
    hipsForward: preset.hipsForward * p * bc,
    footStepR: preset.footStepR * p * bc,
    offHandOffset: new Vector3(
      preset.offHand[0] * p * bc,
      preset.offHand[1] * p * bc,
      preset.offHand[2] * p * bc,
    ),
  };
}
