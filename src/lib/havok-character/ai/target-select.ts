/**
 * 攻撃ターゲットボーンの選択。
 * 相手のどの部位を狙うかをランダムに決定する。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';

const TARGET_BONES = ['head', 'torso', 'hips'] as const;

/** 相手のランダムなボーン位置を取得 (攻撃目標として使用) */
export function selectTargetPosition(opponent: HavokCharacter): Vector3 {
  const boneName = TARGET_BONES[Math.floor(Math.random() * TARGET_BONES.length)];
  const bone = opponent.combatBones.get(boneName);
  return bone ? getWorldPos(bone) : opponent.root.position.add(new Vector3(0, 1.0, 0));
}
