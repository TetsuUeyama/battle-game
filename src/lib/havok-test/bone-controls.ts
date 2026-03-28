/**
 * ボーン操作。選択ボーンの回転/位置変更を両モデル(キャラ+可視化)に適用。
 */
import { Vector3, Quaternion, TransformNode } from '@babylonjs/core';
import type { HavokCharacter } from '@/lib/havok-character/types';
import { degToRad } from '@/lib/math-utils';

export interface BoneRefs {
  characterRef: React.RefObject<HavokCharacter | null>;
  boneVisRef: React.RefObject<Map<string, TransformNode> | null>;
  baseRotationsRef: React.MutableRefObject<Map<string, Quaternion>>;
  basePositionsRef: React.MutableRefObject<Map<string, Vector3>>;
}

/** 選択ボーンの基準回転・位置を保存 */
export function storeBaseValues(boneName: string, refs: BoneRefs): void {
  const char = refs.characterRef.current;
  const vis = refs.boneVisRef.current;
  const baseRots = refs.baseRotationsRef.current;
  const basePos = refs.basePositionsRef.current;

  const cb = char?.allBones.get(boneName);
  if (cb) {
    baseRots.set(`char_${boneName}`, (cb.rotationQuaternion ?? Quaternion.Identity()).clone());
    basePos.set(`char_${boneName}`, cb.position.clone());
  }
  const vb = vis?.get(boneName);
  if (vb) {
    baseRots.set(`vis_${boneName}`, (vb.rotationQuaternion ?? Quaternion.Identity()).clone());
    basePos.set(`vis_${boneName}`, vb.position.clone());
  }
}

/** 回転/位置デルタを両モデルに適用 */
export function applyTransform(
  boneName: string,
  rx: number, ry: number, rz: number,
  px: number, py: number, pz: number,
  refs: BoneRefs,
): void {
  const char = refs.characterRef.current;
  const vis = refs.boneVisRef.current;
  const baseRots = refs.baseRotationsRef.current;
  const basePos = refs.basePositionsRef.current;

  const deltaRot = Quaternion.RotationYawPitchRoll(degToRad(ry), degToRad(rx), degToRad(rz));

  for (const [prefix, bonesMap] of [['char', char?.allBones], ['vis', vis]] as const) {
    if (!bonesMap) continue;
    const bone = bonesMap.get(boneName);
    if (!bone) continue;
    const baseR = baseRots.get(`${prefix}_${boneName}`);
    const baseP = basePos.get(`${prefix}_${boneName}`);
    if (baseR) bone.rotationQuaternion = baseR.multiply(deltaRot);
    if (baseP) bone.position.set(baseP.x + px, baseP.y + py, baseP.z + pz);
  }
}
