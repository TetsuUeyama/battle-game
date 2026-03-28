/** pursue: safeRange まで接近。到達したら circle (or target モードで attack) に遷移。 */
import { Vector3 } from '@babylonjs/core';
import type { StateContext, StateResult } from '../types';
import { updateStance } from '../weapon/stance';
import { moveToward } from '../actions/move-toward';
import { createSwingMotion } from '../actions/swing-attack';
import { startSwing } from '../weapon';

export function handlePursue(ctx: StateContext): StateResult {
  const { ai, character, dist, dir, dt, decision } = ctx;
  updateStance(character, dt);

  if (decision.nextState === 'attack' && ai.mode === 'target') {
    // target モード: pursue → attack 直接遷移
    ai.state = 'attack';
    const targetPos = ai.targetNode.position.clone();
    ai.currentMotion = createSwingMotion(character, {
      type: decision.attackType,
      power: decision.attackPower,
      targetPos: targetPos.add(new Vector3(0, 1.1, 0)),
    });
    startSwing(character);
    ai.comboRemaining = decision.comboCount;
    ai.attackIndex++;
  } else if (decision.nextState) {
    ai.state = decision.nextState;
    ai.circleTimer = decision.circleDuration;
    ai.circleDir = decision.circleDir;
  } else {
    moveToward(character, dir, dist, ai.safeRange, ai, dt);
  }

  return { hit: false, damage: 0 };
}
