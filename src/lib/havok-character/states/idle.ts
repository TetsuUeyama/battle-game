/** idle: 相手が pursueRange 内に入るまで待機。 */
import type { StateContext, StateResult } from '../ai/context';
import { isInPursueRange } from '../ai/distance-eval';

export function handleIdle(ctx: StateContext): StateResult {
  if (isInPursueRange(ctx.ai, ctx.dist)) {
    ctx.ai.state = 'pursue';
  }
  return { hit: false, damage: 0 };
}
