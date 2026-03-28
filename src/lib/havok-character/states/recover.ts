/** recover: 短い回復 → circle で様子見に戻る。 */
import type { StateContext, StateResult } from '../types';
import { updateStance } from '../weapon/stance';

export function handleRecover(ctx: StateContext): StateResult {
  const { ai, character, dt, decision } = ctx;
  updateStance(character, dt);

  ai.recoverTimer -= dt;
  if (decision.nextState) {
    ai.state = decision.nextState;
    ai.circleTimer = decision.circleDuration;
    ai.circleDir = decision.circleDir;
  }

  return { hit: false, damage: 0 };
}
