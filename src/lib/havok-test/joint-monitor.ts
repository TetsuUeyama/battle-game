/**
 * 関節角度のリアルタイム計算。IKチェーンの mid joint の曲げ角度を算出。
 */
import { Vector3, TransformNode } from '@babylonjs/core';
import type { HavokCharacter } from '@/lib/havok-character/types';

export interface JointAngleMap {
  [chainName: string]: number;  // 曲げ角度 (degrees)
}

/**
 * 全IKチェーンの mid joint 曲げ角度を計算する。
 */
export function computeJointAngles(character: HavokCharacter): JointAngleMap {
  const angles: JointAngleMap = {};
  const chains = character.ikChains;

  for (const [name, chain] of Object.entries(chains) as [string, { root: TransformNode; mid: TransformNode; end: TransformNode }][]) {
    chain.root.computeWorldMatrix(true);
    chain.mid.computeWorldMatrix(true);
    chain.end.computeWorldMatrix(true);

    const rootP = chain.root.getAbsolutePosition();
    const midP = chain.mid.getAbsolutePosition();
    const endP = chain.end.getAbsolutePosition();

    const v1 = rootP.subtract(midP).normalize();
    const v2 = endP.subtract(midP).normalize();
    const dot = Math.max(-1, Math.min(1, Vector3.Dot(v1, v2)));
    angles[name] = Math.round(180 - Math.acos(dot) * 180 / Math.PI);
  }

  return angles;
}
