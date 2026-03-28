/**
 * 距離評価。射程・安全距離などの判定をまとめる。
 */
import type { CombatAI } from '../types';

/** 攻撃射程内か */
export function isInAttackRange(ai: CombatAI, dist: number): boolean {
  return dist <= ai.attackRange;
}

/** 安全距離に到達したか */
export function isInSafeRange(ai: CombatAI, dist: number): boolean {
  return dist <= ai.safeRange;
}

/** 追尾開始距離内か */
export function isInPursueRange(ai: CombatAI, dist: number): boolean {
  return dist < ai.pursueRange;
}

/** close_in からの撤退判定 (safeRange + 1m 以上離れた) */
export function isTooFarForCloseIn(ai: CombatAI, dist: number): boolean {
  return dist > ai.safeRange + 1.0;
}

/** retreat完了判定 (安全距離に到達 or タイマー切れ) */
export function shouldEndRetreat(ai: CombatAI, dist: number): boolean {
  return dist >= ai.safeRange || ai.recoverTimer <= 0;
}
