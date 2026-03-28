/** retreat: 攻撃後に安全距離まで後退。完了したら recover へ。 */
import type { StateContext, StateResult } from '../ai/context';
import { updateStance } from '../ai/shared';
import { shouldEndRetreat } from '../ai/distance-eval';
import { retreatBack } from '../actions/retreat-back';

export function handleRetreat(ctx: StateContext): StateResult {
  const { ai, character, dist, dir, dt } = ctx;
  updateStance(character, dt);

  ai.recoverTimer -= dt;
  if (shouldEndRetreat(ai, dist)) {
    ai.state = 'recover';
    ai.recoverTimer = 0.3 + Math.random() * 0.3;
  } else {
    retreatBack(character, dir, ai, dt);
  }

  return { hit: false, damage: 0 };
}
