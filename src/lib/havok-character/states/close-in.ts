/** close_in: ダッシュで攻撃射程に踏み込み、attack に遷移。 */
import type { StateContext, StateResult } from '../ai/context';
import { updateStance } from '../ai/shared';
import { isInAttackRange, isTooFarForCloseIn } from '../ai/distance-eval';
import { rollComboCount } from '../ai/combo-decision';
import { pickAttackType, rollAttackPower } from '../ai/pick-attack';
import { moveToward } from '../actions/move-toward';
import { buildSwingMotion } from '../actions/start-swing';

export function handleCloseIn(ctx: StateContext): StateResult {
  const { ai, character, opponent, dist, dir, dirs, dt } = ctx;
  updateStance(character, dt);

  if (isInAttackRange(ai, dist)) {
    ai.state = 'attack';
    ai.comboRemaining = rollComboCount(ai);

    const swingType = pickAttackType(character);
    const power = rollAttackPower();
    ai.currentMotion = buildSwingMotion(swingType, {
      character, opponent, dir, dirs, power,
    });
    ai.attackIndex++;
  } else {
    // ダッシュで接近 (通常の1.2倍速)
    const saved = ai.runSpeed;
    ai.runSpeed *= 1.2;
    moveToward(character, dir, dist, ai.attackRange * 0.8, ai, dt);
    ai.runSpeed = saved;

    if (isTooFarForCloseIn(ai, dist)) {
      ai.state = 'pursue';
    }
  }

  return { hit: false, damage: 0 };
}
