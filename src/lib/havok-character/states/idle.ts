/** idle: 相手が pursueRange 内に入るまで待機。 */
import type { StateContext, StateResult } from '../types';

export function handleIdle(ctx: StateContext): StateResult {
  if (ctx.decision.nextState) {
    ctx.ai.state = ctx.decision.nextState;
  }
  return { hit: false, damage: 0 };
}
