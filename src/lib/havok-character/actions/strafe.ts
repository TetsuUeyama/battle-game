/** 横移動 (ストレイフ)。安全距離からの誤差を補正しつつ左右に動く。 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI } from '../types';

export function strafe(
  character: HavokCharacter,
  dir: Vector3,
  dist: number,
  ai: CombatAI,
  dirs: { forward: Vector3; charRight: Vector3; charLeft: Vector3 },
  dt: number,
): void {
  // 安全距離からの誤差を補正
  const distError = dist - ai.safeRange;
  if (Math.abs(distError) > 0.2) {
    character.root.position.addInPlace(dir.scale(Math.sign(distError) * 0.8 * dt));
  }

  // 横移動
  const strafeDir = dirs.charRight.scale(ai.circleDir);
  character.root.position.addInPlace(strafeDir.scale(0.6 * dt));
}
