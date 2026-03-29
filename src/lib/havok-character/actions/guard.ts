/**
 * ガードアクション — 武器を体の前に構えて攻撃を受け止める。
 *
 * ガード中は武器のIKターゲットを防御位置に移動させ、
 * 被弾時のダメージを軽減する。
 * ガード中に攻撃を受けると、武器重量に応じたスタミナ消費とノックバックが発生。
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';

export interface GuardState {
  /** ガード中か */
  active: boolean;
  /** ガード開始からの経過時間 (秒) */
  timer: number;
  /** ガード持続上限 (秒) */
  maxDuration: number;
  /** ダメージ軽減率 (0-1, 1=完全ブロック) */
  damageReduction: number;
  /** ガード位置 (world) */
  guardPos: Vector3;
}

export function createGuardState(): GuardState {
  return {
    active: false,
    timer: 0,
    maxDuration: 2.0,
    damageReduction: 0.7,
    guardPos: Vector3.Zero(),
  };
}

/**
 * ガード開始。武器を防御位置に構える。
 */
export function startGuard(character: HavokCharacter, guard: GuardState): void {
  if (guard.active) return;

  const dirs = getCharacterDirections(character);
  if (!dirs || !character.weapon) return;

  guard.active = true;
  guard.timer = 0;

  // ガード位置: 胸の前方に武器を横に構える
  const chestBone = character.combatBones.get('torso');
  const chestPos = chestBone ? getWorldPos(chestBone) : character.root.position.add(new Vector3(0, 1.2, 0));

  guard.guardPos = chestPos
    .add(dirs.forward.scale(0.15))
    .add(new Vector3(0, 0.05, 0));

  // 右手を防御位置に
  character.ikChains.rightArm.target.copyFrom(guard.guardPos);
  character.ikChains.rightArm.weight = 1;
}

/**
 * ガード更新。毎フレーム呼び出し。
 * @returns ガード継続中か
 */
export function updateGuard(
  character: HavokCharacter,
  guard: GuardState,
  dt: number,
): boolean {
  if (!guard.active) return false;

  guard.timer += dt;
  if (guard.timer >= guard.maxDuration) {
    endGuard(character, guard);
    return false;
  }

  // ガード位置を毎フレーム更新 (キャラの移動に追従)
  const dirs = getCharacterDirections(character);
  if (dirs) {
    const chestBone = character.combatBones.get('torso');
    const chestPos = chestBone ? getWorldPos(chestBone) : character.root.position.add(new Vector3(0, 1.2, 0));
    guard.guardPos = chestPos
      .add(dirs.forward.scale(0.15))
      .add(new Vector3(0, 0.05, 0));
    character.ikChains.leftArm.target.copyFrom(guard.guardPos);
  }

  return true;
}

/**
 * ガード終了。
 */
export function endGuard(character: HavokCharacter, guard: GuardState): void {
  guard.active = false;
  guard.timer = 0;
}

/**
 * ガード中にヒットを受けた場合のダメージ計算。
 * @returns 軽減後のダメージ
 */
export function applyGuardedHit(
  character: HavokCharacter,
  guard: GuardState,
  rawDamage: number,
  attackerWeaponWeight: number,
): number {
  if (!guard.active) return rawDamage;

  // ダメージ軽減
  const reduced = Math.floor(rawDamage * (1 - guard.damageReduction));

  // ガード時のノックバック (攻撃者の武器が重いほど大きい)
  const dirs = getCharacterDirections(character);
  if (dirs) {
    const knockback = dirs.forward.scale(-0.05 * attackerWeaponWeight);
    knockback.y = 0;
    character.root.position.addInPlace(knockback);
  }

  return reduced;
}
