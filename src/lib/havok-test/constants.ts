/**
 * havok-test ページ用の定数とユーティリティ。
 */
import { Vector3, TransformNode } from '@babylonjs/core';

/** ボーン選択用の主要ボーン一覧 */
export const SELECTABLE_BONES = [
  'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
  'mixamorig:Neck', 'mixamorig:Head',
  'mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand',
  'mixamorig:RightShoulder', 'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot',
  'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot',
];

/** Hips位置の基準値キャッシュ */
let _hipsBasePosCache = new Map<string, Vector3>();

export function clearHipsBaseCache(): void {
  _hipsBasePosCache = new Map();
}

export function ensureBasePos(node: TransformNode, key: string): Vector3 {
  if (!_hipsBasePosCache.has(key)) {
    _hipsBasePosCache.set(key, node.position.clone());
  }
  return _hipsBasePosCache.get(key)!;
}
