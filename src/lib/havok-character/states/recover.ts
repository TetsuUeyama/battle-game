/** recover: 短い回復 → circle で様子見に戻る。 */
import type { StateContext, StateResult } from '../ai/context';
import { updateStance } from '../ai/shared';

export function handleRecover(ctx: StateContext): StateResult {
  const { ai, character, dt } = ctx;
  updateStance(character, dt);

  ai.recoverTimer -= dt;
  if (ai.recoverTimer <= 0) {
    ai.state = 'circle';
    ai.circleTimer = 0.8 + Math.random() * 1.2;
    ai.circleDir = Math.random() > 0.5 ? 1 : -1;
  }

  return { hit: false, damage: 0 };
}
