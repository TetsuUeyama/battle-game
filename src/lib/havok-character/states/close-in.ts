/** close_in: ダッシュで攻撃射程に踏み込み、attack に遷移。 */
import type { StateContext, StateResult } from '../types';
import { updateStance } from '../weapon/stance';
import { moveToward } from '../actions/move-toward';
import { createSwingMotion } from '../actions/swing-attack';
import { startSwing } from '../weapon';

export function handleCloseIn(ctx: StateContext): StateResult {
  const { ai, character, opponent, dist, dir, dirs, dt, decision } = ctx;
  updateStance(character, dt);

  if (decision.shouldStartAttack) {
    ai.state = 'attack';
    ai.comboRemaining = decision.comboCount;
    ai.currentMotion = createSwingMotion(character, {
      type: decision.attackType,
      power: decision.attackPower,
      opponent, dir,
      targetBone: decision.targetBone,
      useVsPreset: true,
    });
    startSwing(character);
    ai.attackIndex++;
  } else if (decision.nextState === 'pursue') {
    ai.state = 'pursue';
  } else {
    const saved = ai.runSpeed;
    ai.runSpeed *= 1.2;
    moveToward(character, dir, dist, ai.attackRange * 0.8, ai, dt);
    ai.runSpeed = saved;
  }

  return { hit: false, damage: 0 };
}
