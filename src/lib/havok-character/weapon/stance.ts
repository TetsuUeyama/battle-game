/**
 * 武器構えの位置算出。グリップ位置・オフハンド休息位置・構えターゲットを計算する。
 *
 * ソルバーキャッシュが存在する場合はソルバー結果を使用し、
 * 存在しない場合は旧プリセット (front/side/overhead) にフォールバックする。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, WeaponPhysics, StanceType } from '../types';
import { PALM_OFFSET } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getSolverCache } from '../solver/precompute';
import { reconstructStance } from '../solver/stance-solver';
import type { StanceLevel } from '../solver/types';

/** 手のひら中心オフセット */
const PALM = PALM_OFFSET;

/** StanceType → StanceLevel のマッピング */
const STANCE_TO_LEVEL: Record<StanceType, StanceLevel> = {
  'overhead': 'upper',
  'front': 'middle',
  'side': 'lower',
};

/**
 * 片手武器時のオフハンド(左手)の自然な休息位置。
 */
export function getOffHandRestPosition(character: HavokCharacter): Vector3 | null {
  const dirs = getCharacterDirections(character);
  const hips = character.combatBones.get('hips');
  if (!dirs || !hips) return null;

  const hipsPos = getWorldPos(hips);
  return hipsPos
    .add(dirs.charLeft.scale(0.2))
    .add(dirs.forward.scale(0.08))
    .add(new Vector3(0, -0.15, 0));
}

/**
 * 構えごとのグリップ位置・武器方向・左手位置を算出。
 *
 * ソルバーキャッシュがあればソルバー結果を使用、なければ旧プリセットにフォールバック。
 */
export function getStanceTargets(
  character: HavokCharacter,
  stance: StanceType,
  weapon: WeaponPhysics,
): { rightTarget: Vector3; leftTarget: Vector3 | null; weaponDir: Vector3 } {
  // ソルバーキャッシュがあれば使用
  const cache = getSolverCache(character);
  if (cache) {
    const level = STANCE_TO_LEVEL[stance];
    const baseResult = cache.baseStances[level];
    // 角度パラメータ (theta/phi/reachRatio) から現在の肩位置・facingで再計算
    return reconstructStance(baseResult, character, weapon);
  }

  // フォールバック: 旧プリセット
  return getStanceTargetsFallback(character, stance, weapon);
}

/**
 * 旧プリセットによる構え位置計算 (フォールバック用)。
 */
function getStanceTargetsFallback(
  character: HavokCharacter,
  stance: StanceType,
  weapon: WeaponPhysics,
): { rightTarget: Vector3; leftTarget: Vector3 | null; weaponDir: Vector3 } {
  const spine2 = character.combatBones.get('torso');
  const hips = character.combatBones.get('hips');
  const dirs = getCharacterDirections(character);
  if (!spine2 || !hips || !dirs) {
    return { rightTarget: Vector3.Zero(), leftTarget: null, weaponDir: Vector3.Down() };
  }

  const chestPos = getWorldPos(spine2);
  const { forward: facing, charRight } = dirs;

  let gripPos: Vector3;
  let weaponDir: Vector3;

  switch (stance) {
    case 'front': {
      gripPos = chestPos.add(facing.scale(0.3)).add(charRight.scale(0.1));
      weaponDir = facing.scale(0.7).add(Vector3.Down().scale(0.3)).normalize();
      break;
    }
    case 'side': {
      const hipPos = getWorldPos(hips);
      gripPos = hipPos.add(charRight.scale(0.25)).add(new Vector3(0, -0.05, 0));
      weaponDir = Vector3.Down();
      break;
    }
    case 'overhead': {
      const headBone = character.combatBones.get('head');
      const headPos = headBone ? getWorldPos(headBone) : chestPos.add(new Vector3(0, 0.3, 0));
      gripPos = headPos.add(new Vector3(0, 0.15, 0)).add(facing.scale(0.1)).add(charRight.scale(0.05));
      weaponDir = facing.scale(0.5).add(Vector3.Down().scale(0.5)).normalize();
      break;
    }
  }

  const weaponShoulderPos = getWorldPos(character.ikChains.rightArm.root);
  const shoulderToGrip = gripPos.subtract(weaponShoulderPos).normalize();
  const rightTarget = gripPos.subtract(shoulderToGrip.scale(PALM));

  let leftTarget: Vector3 | null = null;
  if (weapon.gripType === 'two-handed') {
    const pommelDir = weaponDir.scale(-1);
    const offHandWorld = gripPos.add(pommelDir.scale(weapon.offHandOffset.y));
    const offHandShoulderPos = getWorldPos(character.ikChains.leftArm.root);
    const offShoulderToOff = offHandWorld.subtract(offHandShoulderPos).normalize();
    leftTarget = offHandWorld.subtract(offShoulderToOff.scale(PALM));
  }

  return { rightTarget, leftTarget, weaponDir };
}

// ─── 構え毎フレーム更新 ─────────────────────────────────

import { updateWeaponInertia } from './physics';

/**
 * 構え位置を更新し、武器慣性を適用する。attack 以外の全ステートで毎フレーム呼び出す。
 */
export function updateStance(character: HavokCharacter, dt: number): void {
  if (!character.weapon) return;
  const stanceNow = getStanceTargets(character, character.weaponSwing.stance, character.weapon);
  character.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
  updateWeaponInertia(character, stanceNow.rightTarget, dt);
}
