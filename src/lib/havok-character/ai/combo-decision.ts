/**
 * コンボ継続/終了の判断。
 * 攻撃完了後に次の振りに繋げるか、retreat に遷移するかを決定する。
 */
import type { CombatAI } from '../types';

/** コンボ開始時の攻撃回数を決定 (1〜maxCombo のランダム) */
export function rollComboCount(ai: CombatAI): number {
  return 1 + Math.floor(Math.random() * ai.maxCombo);
}

/** コンボを継続すべきか判定 */
export function shouldContinueCombo(ai: CombatAI, dist: number): boolean {
  return ai.comboRemaining > 0 && dist <= ai.attackRange * 1.3;
}
