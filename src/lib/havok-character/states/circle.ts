/** circle: 安全距離を保ちつつ横移動で様子見。タイマー終了で close_in へ。 */
import type { StateContext, StateResult } from '../ai/context';
import { updateStance } from '../ai/shared';
import { strafe } from '../actions/strafe';

export function handleCircle(ctx: StateContext): StateResult {
  const { ai, character, dist, dir, dirs, dt } = ctx;
  updateStance(character, dt);

  ai.circleTimer -= dt;

  if (dirs) {
    strafe(character, dir, dist, ai, dirs, dt);
  }

  if (ai.circleTimer <= 0) {
    ai.state = 'close_in';
  }

  return { hit: false, damage: 0 };
}
