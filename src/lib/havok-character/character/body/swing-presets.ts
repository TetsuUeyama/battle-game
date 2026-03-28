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
  vertical: {
    windup: { torsoLean: -0.15, torsoTwist: 0.1, hipsOffset: 0.02, hipsForward: -0.03, footStepR: -0.05, offHand: [-0.05, 0.1, -0.05] },
    strike: { torsoLean: 0.35, torsoTwist: -0.05, hipsOffset: -0.08, hipsForward: 0.08, footStepR: 0.12, offHand: [0.1, -0.1, 0.05] },
  },
  horizontal: {
    windup: { torsoLean: 0, torsoTwist: 0.35, hipsOffset: 0, hipsForward: -0.02, footStepR: 0.05, offHand: [-0.1, 0.05, -0.08] },
    strike: { torsoLean: 0.1, torsoTwist: -0.3, hipsOffset: -0.03, hipsForward: 0.05, footStepR: -0.03, offHand: [0.15, -0.05, 0.1] },
  },
  thrust: {
    windup: { torsoLean: -0.1, torsoTwist: 0.1, hipsOffset: 0.02, hipsForward: -0.08, footStepR: -0.08, offHand: [-0.08, 0.05, -0.1] },
    strike: { torsoLean: 0.25, torsoTwist: -0.05, hipsOffset: -0.04, hipsForward: 0.15, footStepR: 0.18, offHand: [0.05, -0.08, 0] },
  },
  // ─── 対キャラAI用 (close_in): やや大きめの値 ───
  vertical_vs: {
    windup: { torsoLean: -0.25, torsoTwist: 0.15, hipsOffset: 0.03, hipsForward: -0.08, footStepR: -0.1, offHand: [-0.05, 0.1, -0.05] },
    strike: { torsoLean: 0.5, torsoTwist: -0.1, hipsOffset: -0.12, hipsForward: 0.2, footStepR: 0.25, offHand: [0.1, -0.1, 0.05] },
  },
  horizontal_vs: {
    windup: { torsoLean: -0.1, torsoTwist: 0.8, hipsOffset: 0.02, hipsForward: -0.05, footStepR: 0.12, offHand: [-0.2, 0.08, -0.15] },
    strike: { torsoLean: 0.2, torsoTwist: -0.8, hipsOffset: -0.06, hipsForward: 0.1, footStepR: -0.1, offHand: [0.25, -0.08, 0.2] },
  },
  thrust_vs: {
    windup: { torsoLean: -0.15, torsoTwist: 0.15, hipsOffset: 0.03, hipsForward: -0.15, footStepR: -0.12, offHand: [-0.08, 0.05, -0.1] },
    strike: { torsoLean: 0.35, torsoTwist: -0.1, hipsOffset: -0.06, hipsForward: 0.25, footStepR: 0.3, offHand: [0.05, -0.08, 0] },
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
