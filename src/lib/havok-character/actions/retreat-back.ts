/** 後方への移動。相手から離れる方向に移動する。 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI } from '../types';

export function retreatBack(
  character: HavokCharacter,
  dir: Vector3,
  ai: CombatAI,
  dt: number,
): void {
  character.root.position.addInPlace(dir.scale(-ai.retreatSpeed * dt));
}
