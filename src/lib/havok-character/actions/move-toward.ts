/** 指定方向に歩き/走り移動する。距離に応じて速度を切り替え。 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI } from '../types';

export function moveToward(
  character: HavokCharacter,
  dir: Vector3,
  dist: number,
  targetDist: number,
  ai: CombatAI,
  dt: number,
): void {
  const speed = dist > ai.runThreshold ? ai.runSpeed : ai.walkSpeed;
  const moveAmount = Math.min(dist - targetDist, speed * dt);
  if (moveAmount > 0) {
    character.root.position.addInPlace(dir.scale(moveAmount));
  }
}
