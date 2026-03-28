/**
 * 標的追尾モード (target モード) の更新。
 * 静的な標的に対して移動・攻撃を行うシンプルなAI。
 *
 * ステート: idle → pursue → attack → recover → pursue → ...
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI } from '../types';
import { getCharacterDirections } from '../character/directions';
import { turnToward, updateStance, resetSpine } from './shared';
import { startSwing, endSwing } from '../weapon';
import { createSwingMotion, updateSwingMotion, applyBodyMotion } from '../weapon/attack-swing';
import { moveToward } from '../actions/move-toward';
import { pickWeightedAttackType, getPreferredAttackTypes } from './pick-attack';
import { isInPursueRange, isInAttackRange } from './distance-eval';

export function updateCombatAI(
  ai: CombatAI,
  character: HavokCharacter,
  dt: number,
): void {
  if (!ai.enabled || !character.weapon) return;

  const targetPos = ai.targetNode.position.clone();
  targetPos.y = 0;
  const charPos = character.root.position.clone();
  charPos.y = 0;

  const toTarget = targetPos.subtract(charPos);
  const dist = toTarget.length();
  const dir = dist > 0.01 ? toTarget.normalize() : Vector3.Forward();

  // 標的方向への自動回転
  const dirs = getCharacterDirections(character);
  if (dirs) {
    turnToward(character, dir, dirs, dt);
  }

  // ─── 状態遷移 ───
  switch (ai.state) {
    case 'idle': {
      if (isInPursueRange(ai, dist)) {
        ai.state = 'pursue';
      }
      break;
    }

    case 'pursue': {
      updateStance(character, dt);

      if (isInAttackRange(ai, dist)) {
        ai.state = 'attack';
        const swingType = pickWeightedAttackType(getPreferredAttackTypes(character.weapon.category));
        ai.attackIndex++;
        const power = 60 + Math.random() * 40;
        const hitPos = targetPos.add(new Vector3(0, 1.1, 0));
        ai.currentMotion = createSwingMotion(character, hitPos, swingType, power);
        startSwing(character);
      } else {
        moveToward(character, dir, dist, ai.attackRange * 0.8, ai, dt);
      }
      break;
    }

    case 'attack': {
      if (ai.currentMotion && ai.currentMotion.active) {
        const frame = updateSwingMotion(ai.currentMotion, dt, character.root.position);
        if (frame) {
          character.ikChains.leftArm.target.copyFrom(frame.handTarget);
          character.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
          if (dirs) {
            applyBodyMotion(character, frame.body, dirs.forward, dirs.charRight);
          }
        }
      }
      if (!ai.currentMotion || !ai.currentMotion.active) {
        ai.state = 'recover';
        ai.recoverTimer = ai.recoverTime;
        ai.currentMotion = null;
        endSwing(character);
        resetSpine(character);
      }
      break;
    }

    case 'recover': {
      updateStance(character, dt);
      ai.recoverTimer -= dt;
      if (ai.recoverTimer <= 0) {
        ai.state = 'pursue';
      }
      break;
    }
  }
}
