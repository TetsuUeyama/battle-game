/**
 * ガードアクション — 相手の攻撃軌道に武器を配置して受け止める。
 *
 * 相手の武器先端の位置を追跡し、その軌道上に自分の武器を配置する。
 * ブロック判定は swing-attack 側で実施:
 *   相手の武器先端が自分の武器ライン (grip→tip) に近ければブロック成功。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getWeaponTipWorld } from '../weapon/physics';

export interface GuardState {
  active: boolean;
  timer: number;
  maxDuration: number;
  damageReduction: number;
}

export function createGuardState(): GuardState {
  return {
    active: false,
    timer: 0,
    maxDuration: 2.0,
    damageReduction: 0.8,
  };
}

/**
 * ガード開始。
 */
export function startGuard(character: HavokCharacter, guard: GuardState, opponent?: HavokCharacter): void {
  if (guard.active) return;
  if (!character.weapon) return;

  guard.active = true;
  guard.timer = 0;

  applyGuardPosition(character, opponent ?? null);
}

/**
 * ガード更新。毎フレーム呼び出し。
 * @returns ガード継続中か
 */
export function updateGuard(
  character: HavokCharacter,
  guard: GuardState,
  dt: number,
  opponent?: HavokCharacter,
): boolean {
  if (!guard.active) return false;

  guard.timer += dt;
  if (guard.timer >= guard.maxDuration) {
    endGuard(character, guard);
    return false;
  }

  applyGuardPosition(character, opponent ?? null);
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
 * 相手の攻撃軌道に武器を配置する。
 *
 * 1. 相手の武器先端のワールド位置を取得
 * 2. その位置と自分の体の間に手を配置
 * 3. 武器が攻撃軌道を遮るようにする
 */
function applyGuardPosition(character: HavokCharacter, opponent: HavokCharacter | null): void {
  const dirs = getCharacterDirections(character);
  if (!dirs || !character.weapon) return;

  const chestBone = character.combatBones.get('torso');
  const headBone = character.combatBones.get('head');
  if (!chestBone) return;

  const chestPos = getWorldPos(chestBone);
  const headPos = headBone ? getWorldPos(headBone) : chestPos.add(new Vector3(0, 0.3, 0));

  let guardTarget: Vector3;

  if (opponent?.weapon) {
    // 相手の武器先端位置を取得
    const opponentTip = getWeaponTipWorld(opponent);
    const opponentGrip = getWorldPos(opponent.weaponAttachR);

    // 相手の武器が向かっている方向 (grip→tip)
    const attackDir = opponentTip.subtract(opponentGrip);
    if (attackDir.length() > 0.001) attackDir.normalize();

    // 相手の武器先端と自分の体の中間に手を配置
    // → 攻撃軌道上に武器を置く
    const bodyCenter = Vector3.Lerp(chestPos, headPos, 0.3);
    const tipToBody = bodyCenter.subtract(opponentTip);
    const distToTip = tipToBody.length();

    if (distToTip > 0.1) {
      // 相手の先端と自分の体の間、先端寄りに配置
      const interceptT = Math.min(0.6, 0.3 + character.weapon.length * 0.2);
      guardTarget = Vector3.Lerp(bodyCenter, opponentTip, interceptT);
    } else {
      // 非常に近い → 体の前方にデフォルト配置
      guardTarget = bodyCenter.add(dirs.forward.scale(0.2));
    }

    // 高さを相手の先端に合わせる (体の範囲内にクランプ)
    const hipsBone = character.combatBones.get('hips');
    const hipsY = hipsBone ? getWorldPos(hipsBone).y : chestPos.y - 0.3;
    guardTarget.y = Math.max(hipsY, Math.min(headPos.y + 0.1, opponentTip.y));
  } else {
    // 相手の武器情報がない → デフォルト: 体の前方
    guardTarget = Vector3.Lerp(chestPos, headPos, 0.5)
      .add(dirs.forward.scale(0.25));
  }

  // 右手をガード位置に
  character.ikChains.rightArm.target.copyFrom(guardTarget);
  character.ikChains.rightArm.weight = 1;

  // 両手持ちの場合、左手も配置
  if (character.weapon.gripType === 'two-handed') {
    // 左手は右手の少し下・体寄りに
    const leftTarget = guardTarget
      .add(dirs.forward.scale(-0.05))
      .add(new Vector3(0, -0.1, 0));
    character.ikChains.leftArm.target.copyFrom(leftTarget);
    character.ikChains.leftArm.weight = 1;
  }
}

/**
 * 相手の武器先端がこちらの武器ラインに近いかチェックする (ブロック判定)。
 */
export function checkWeaponBlock(
  defender: HavokCharacter,
  attackerTipWorld: Vector3,
): boolean {
  if (!defender.weapon) return false;

  const gripPos = getWorldPos(defender.weaponAttachR);
  const tipPos = getWeaponTipWorld(defender);

  const dist = distancePointToSegment(attackerTipWorld, gripPos, tipPos);
  const blockRadius = 0.15;
  return dist < blockRadius;
}

/**
 * ガード中にヒットを受けた場合のダメージ計算。
 */
export function applyGuardedHit(
  character: HavokCharacter,
  guard: GuardState,
  rawDamage: number,
  attackerWeaponWeight: number,
): number {
  if (!guard.active) return rawDamage;

  const reduced = Math.floor(rawDamage * (1 - guard.damageReduction));

  const dirs = getCharacterDirections(character);
  if (dirs) {
    const knockback = dirs.forward.scale(-0.05 * attackerWeaponWeight);
    knockback.y = 0;
    character.root.position.addInPlace(knockback);
  }

  return reduced;
}

/** 点から線分への最短距離 */
function distancePointToSegment(point: Vector3, segA: Vector3, segB: Vector3): number {
  const ab = segB.subtract(segA);
  const ap = point.subtract(segA);
  const abLenSq = ab.lengthSquared();
  if (abLenSq < 0.0001) return ap.length();

  const t = Math.max(0, Math.min(1, Vector3.Dot(ap, ab) / abLenSq));
  const closest = segA.add(ab.scale(t));
  return Vector3.Distance(point, closest);
}
