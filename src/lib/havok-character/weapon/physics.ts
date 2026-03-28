/**
 * 武器の物理演算。先端位置の追跡・慣性シミュレーション・パワー算出・スイング状態管理。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';

/**
 * 武器先端のワールド位置を取得
 */
export function getWeaponTipWorld(character: HavokCharacter): Vector3 {
  if (!character.weapon) return getWorldPos(character.weaponAttachR);

  character.weaponAttachR.computeWorldMatrix(true);
  const tipLocal = character.weapon.attackPoint;
  return Vector3.TransformCoordinates(tipLocal, character.weaponAttachR.getWorldMatrix());
}

/**
 * 慣性シミュレーション: weightが重いほどIKターゲットの追従が遅れる。
 */
export function updateWeaponInertia(
  character: HavokCharacter,
  desiredTarget: Vector3,
  dt: number,
): void {
  const weapon = character.weapon;
  if (!weapon) {
    character.ikChains.leftArm.target.copyFrom(desiredTarget);
    return;
  }

  const swing = character.weaponSwing;
  const inertiaFactor = 1.0 / (1.0 + weapon.weight * 2.0);
  const lerpSpeed = inertiaFactor * 10.0;
  const t = Math.min(1.0, lerpSpeed * dt);

  Vector3.LerpToRef(swing.smoothedTarget, desiredTarget, t, swing.smoothedTarget);
  character.ikChains.leftArm.target.copyFrom(swing.smoothedTarget);
}

/**
 * 攻撃威力の算出: 先端移動距離 × weight
 */
export function updateWeaponPower(character: HavokCharacter, dt: number): number {
  const weapon = character.weapon;
  if (!weapon) return 0;

  const swing = character.weaponSwing;
  const tipWorld = getWeaponTipWorld(character);

  const dist = Vector3.Distance(tipWorld, swing.prevTipPos);
  swing.tipSpeed = dt > 0 ? dist / dt : 0;

  if (swing.swinging) {
    swing.power += dist * weapon.weight;
  }

  swing.prevTipPos.copyFrom(tipWorld);
  return swing.power;
}

/**
 * スイング開始
 */
export function startSwing(character: HavokCharacter): void {
  const swing = character.weaponSwing;
  swing.swinging = true;
  swing.power = 0;
}

/**
 * スイング終了 → 累積威力を返す
 */
export function endSwing(character: HavokCharacter): number {
  const swing = character.weaponSwing;
  const finalPower = swing.power;
  swing.swinging = false;
  swing.power = 0;
  return finalPower;
}

/**
 * 両手持ち武器で画面左手(off-hand)を切替。
 */
export function releaseOffHand(character: HavokCharacter, release: boolean): void {
  const weapon = character.weapon;
  if (!weapon || weapon.gripType !== 'two-handed') return;

  if (release) {
    character.ikChains.rightArm.weight = 0;
  } else {
    character.ikChains.rightArm.weight = 1;
    const tipWorld = getWeaponTipWorld(character);
    const handWorld = getWorldPos(character.weaponAttachR);
    Vector3.LerpToRef(handWorld, tipWorld, 0.3, character.ikChains.rightArm.target);
  }
}
