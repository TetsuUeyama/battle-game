/** circle: 安全距離を保ちつつ横移動で様子見。 */
import type { StateContext, StateResult } from '../types';
import { updateStance } from '../weapon/stance';
import { strafe } from '../actions/strafe';

export function handleCircle(ctx: StateContext): StateResult {
  const { ai, character, dist, dir, dirs, dt, decision } = ctx;
  updateStance(character, dt);

  ai.circleTimer -= dt;

  if (dirs) {
    strafe(character, dir, dist, ai, dirs, dt);
  }

  if (decision.nextState) {
    ai.state = decision.nextState;
  }

  return { hit: false, damage: 0 };
}
