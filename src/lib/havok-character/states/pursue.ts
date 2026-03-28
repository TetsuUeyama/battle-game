/** pursue: safeRange まで接近。到達したら circle に遷移。 */
import type { StateContext, StateResult } from '../ai/context';
import { updateStance } from '../ai/shared';
import { isInSafeRange } from '../ai/distance-eval';
import { moveToward } from '../actions/move-toward';

export function handlePursue(ctx: StateContext): StateResult {
  const { ai, character, dist, dir, dt } = ctx;
  updateStance(character, dt);

  if (isInSafeRange(ai, dist)) {
    ai.state = 'circle';
    ai.circleTimer = 1.0 + Math.random() * 1.5;
    ai.circleDir = Math.random() > 0.5 ? 1 : -1;
  } else {
    moveToward(character, dir, dist, ai.safeRange, ai, dt);
  }

  return { hit: false, damage: 0 };
}
