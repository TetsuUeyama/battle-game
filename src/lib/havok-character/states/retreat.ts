/** retreat: 攻撃後に安全距離まで後退。完了したら recover へ。 */
import type { StateContext, StateResult } from '../types';
import { updateStance } from '../weapon/stance';
import { retreatBack } from '../actions/retreat-back';

export function handleRetreat(ctx: StateContext): StateResult {
  const { ai, character, dir, dt, decision } = ctx;
  updateStance(character, dt);

  ai.recoverTimer -= dt;
  if (decision.nextState) {
    ai.state = decision.nextState;
    ai.recoverTimer = 0.3 + Math.random() * 0.3;
  } else {
    retreatBack(character, dir, ai, dt);
  }

  return { hit: false, damage: 0 };
}
