/**
 * 武器スケーリング基準値。武器の長さ・重さからスケール係数を算出する際の定数。
 */

export const WEAPON_SCALE_CONFIG = {
  /** 基準武器の長さ (m) — スケール1.0の基準 */
  baseLength: 0.5,
  /** 基準武器の重さ (kg) — スケール1.0の基準 */
  baseWeight: 1.0,
  /** 長さスケールの最小値 */
  minLengthScale: 0.8,
  /** 長さスケールの最大値 */
  maxLengthScale: 4.0,
  /** 重さスケールの最大値 */
  maxWeightScale: 10.0,
  /** reachScale 係数: 1 + (ls-1) * この値 */
  reachFactor: 0.5,
  /** reachScale 上限 */
  maxReachScale: 3.0,
  /** arcScale 係数 */
  arcFactor: 0.3,
  /** arcScale 上限 */
  maxArcScale: 2.5,
  /** bodyCommitment 係数 */
  bodyCommitmentFactor: 0.15,
  /** bodyCommitment の重さ上限 (これ以上は頭打ち) */
  bodyCommitmentWeightCap: 3.0,
  /** gripCommitment (両手持ち追加倍率) */
  twoHandedGripMul: 1.3,
  /** durationScale 係数 */
  durationFactor: 0.06,
  /** 横振り弧の最大角度 (rad) */
  maxArcAngle: Math.PI * 0.6,
  /** 横振り弧の基本角度 (rad) */
  baseArcAngle: Math.PI * 0.39,
} as const;
