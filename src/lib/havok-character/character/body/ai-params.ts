/**
 * AIパラメータ定義。移動速度・射程・コンボ・回復時間など。
 */

export const AI_PARAMS = {
  // ─── 移動 ───
  /** 歩き速度 (m/s) */
  walkSpeed: 1.0,
  /** 走り速度 (m/s) */
  runSpeed: 2.5,
  /** 走り切替距離 (m): これ以上離れていたら走る */
  runThreshold_target: 2.0,
  runThreshold_character: 3.0,
  /** 後退速度 (m/s) */
  retreatSpeed: 1.5,

  // ─── 射程 ───
  /** 追尾開始距離 (m) — target モード */
  pursueRange_target: 5.0,
  /** 追尾開始距離 (m) — character モード */
  pursueRange_character: 8.0,
  /** 攻撃射程倍率 — target モード: weapon.length * この値 */
  attackRangeMul_target: 0.9,
  /** 安全距離の追加マージン (m) */
  safeRangeMargin: 0.5,
  /** 腕リーチ (m) — character モードの attackRange 計算用 */
  armReach: 0.5,
  /** 踏み込みリーチ (m) — character モードの attackRange 計算用 */
  lungeReach: 0.25,

  // ─── 攻撃・コンボ ───
  /** maxCombo 計算: max(1, round(この値 - weight * comboWeightFactor)) */
  comboBase: 4,
  comboWeightFactor: 0.3,

  // ─── 回復 ───
  /** 攻撃後の回復時間 (秒) — target モード */
  recoverTime_target: 0.8,
  /** 攻撃後の回復時間 (秒) — character モード */
  recoverTime_character: 0.6,
} as const;
