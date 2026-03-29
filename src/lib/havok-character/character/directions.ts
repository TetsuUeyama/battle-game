/**
 * キャラクター方向算出。ボーン位置から画面上の前方・左右方向を計算する。
 * MotionConverter変換済みの骨格を前提: LeftShoulder = 画面左、RightShoulder = 画面右。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';

/**
 * キャラクターのボーン位置から画面上の方向ベクトルを算出。
 */
export function getCharacterDirections(character: HavokCharacter): {
  forward: Vector3; charRight: Vector3; charLeft: Vector3;
} | null {
  const rShoulder = character.allBones.get('mixamorig:RightShoulder');
  const lShoulder = character.allBones.get('mixamorig:LeftShoulder');
  if (!rShoulder || !lShoulder) return null;

  const rPos = getWorldPos(rShoulder);
  const lPos = getWorldPos(lShoulder);

  // 変換済み: RightShoulder = 画面右、LeftShoulder = 画面左
  const charRight = rPos.subtract(lPos).normalize();
  charRight.y = 0; charRight.normalize();
  const charLeft = charRight.scale(-1);
  const forward = Vector3.Cross(charRight, Vector3.Up()).normalize();

  return { forward, charRight, charLeft };
}
