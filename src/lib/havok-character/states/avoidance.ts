/**
 * avoidance: サイドステップ/バックステップで相手の攻撃を回避。
 * 完了後は circle に遷移。
 */
import type { StateContext, StateResult } from '../types';
import {
  createAvoidanceState, startAvoidance, updateAvoidance, pickAvoidanceType,
} from '../actions/avoidance';

const avoidanceStates = new WeakMap<object, ReturnType<typeof createAvoidanceState>>();

function getAvoidanceState(ai: object) {
  if (!avoidanceStates.has(ai)) avoidanceStates.set(ai, createAvoidanceState());
  return avoidanceStates.get(ai)!;
}

export function handleAvoidance(ctx: StateContext): StateResult {
  const { ai, character, dir, dt, decision } = ctx;
  const avoidance = getAvoidanceState(ai);

  if (!avoidance.active) {
    // 回避方向を決定して開始
    const avoidType = pickAvoidanceType(character, dir);
    startAvoidance(character, avoidance, avoidType);
  }

  const continuing = updateAvoidance(character, avoidance, dt);

  if (!continuing) {
    ai.state = decision.nextState ?? 'circle';
    ai.circleTimer = decision.circleDuration;
    ai.circleDir = decision.circleDir;
  }

  return { hit: false, damage: 0 };
}
