/**
 * attack: SwingMotion を進行し、ヒット判定。
 * 振り完了後: コンボ継続判断 → 次の振り or retreat。
 */
import type { StateContext, StateResult } from '../ai/context';
import { resetSpine, updateStance } from '../ai/shared';
import { shouldContinueCombo } from '../ai/combo-decision';
import { pickAttackType, rollComboPower } from '../ai/pick-attack';
import { endSwing } from '../weapon';
import { swingAttack } from '../actions/swing-attack';
import { buildSwingMotion } from '../actions/start-swing';

export function handleAttack(ctx: StateContext): StateResult {
  const { ai, character, opponent, dist, dir, dirs, dt } = ctx;

  // アクション: SwingMotion 進行 + ヒット判定
  const result = swingAttack(ai, character, opponent, dirs, dt);

  // 遷移判定: 振り完了時
  if (result.finished) {
    endSwing(character);
    ai.comboRemaining--;

    if (shouldContinueCombo(ai, dist)) {
      // コンボ継続
      updateStance(character, dt);
      const nextType = pickAttackType(character);
      const nextPower = rollComboPower();
      ai.currentMotion = buildSwingMotion(nextType, {
        character, opponent, dir, dirs,
        power: nextPower,
        isComboFollow: true,
      });
    } else {
      // コンボ終了 → retreat
      ai.state = 'retreat';
      ai.recoverTimer = 0.5 + Math.random() * 0.5;
      ai.currentMotion = null;
      ai.comboRemaining = 0;
      resetSpine(character);
    }
  }

  return { hit: result.hit, damage: result.damage };
}
