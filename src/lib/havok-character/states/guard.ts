/**
 * guard: 武器を構えて攻撃を受け止める。
 * ガード時間経過 or 相手の攻撃が終わったら circle に遷移。
 */
import type { StateContext, StateResult } from '../types';
import { startGuard, updateGuard, endGuard, createGuardState, type GuardState } from '../actions/guard';

const guardStates = new WeakMap<object, GuardState>();

function getGuardState(ai: object): GuardState {
  if (!guardStates.has(ai)) guardStates.set(ai, createGuardState());
  return guardStates.get(ai)!;
}

export function handleGuard(ctx: StateContext): StateResult {
  const { ai, character, dt, decision } = ctx;
  const guard = getGuardState(ai);

  if (!guard.active) {
    startGuard(character, guard);
  }

  const continuing = updateGuard(character, guard, dt);

  if (!continuing || decision.nextState) {
    endGuard(character, guard);
    ai.state = decision.nextState ?? 'circle';
    ai.circleTimer = decision.circleDuration;
    ai.circleDir = decision.circleDir;
  }

  return { hit: false, damage: 0 };
}
