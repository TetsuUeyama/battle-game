/**
 * キャラクター方向算出。ボーン位置から画面上の前方・左右方向を計算する。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';

/**
 * キャラクターのボーン位置から画面上の方向ベクトルを算出。
 * Babylon.js左手座標系ではMixamoの左右が画面上で反転する。
 */
export function getCharacterDirections(character: HavokCharacter): {
  forward: Vector3; charRight: Vector3; charLeft: Vector3;
} | null {
  const mixamoRShoulder = character.allBones.get('mixamorig:RightShoulder');
  const mixamoLShoulder = character.allBones.get('mixamorig:LeftShoulder');
  if (!mixamoRShoulder || !mixamoLShoulder) return null;

  const mixamoRPos = getWorldPos(mixamoRShoulder);
  const mixamoLPos = getWorldPos(mixamoLShoulder);

  const charRight = mixamoLPos.subtract(mixamoRPos).normalize();
  charRight.y = 0; charRight.normalize();
  const charLeft = charRight.scale(-1);
  const forward = Vector3.Cross(charRight, Vector3.Up()).normalize();

  return { forward, charRight, charLeft };
}
