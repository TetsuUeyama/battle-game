/**
 * 手首回転による武器方向制御 + 武器の慣性追従。
 *
 * ■ 振りかぶり時 (手が上に向かっている)
 *   手首を回転して武器先端を上方・背中側に向ける。
 *   攻撃範囲を最大限高く/後方に持っていく。
 *
 * ■ 振り下ろし時 (手が前下に向かっている)
 *   手首の目標方向は前方下方だが、慣性で先端が遅れて追従する。
 *   重い・長い武器ほど遅延が大きい。
 *
 * ■ 構え中
 *   武器先端はキャラクター前方を向く。
 */
import { Vector3, Quaternion, Matrix } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos, rotationBetweenVectors } from '@/lib/math-utils';
import { getWeaponTipWorld } from './physics';
import { getCharacterDirections } from '../character/directions';
import { JOINT_CONFIG } from '../character/body/joints';

/** 手首制御の状態 */
interface WristState {
  /** 武器先端の実際の方向 (慣性適用後) */
  actualDir: Vector3;
  /** 前フレームの Hand 位置 */
  prevHandPos: Vector3;
  initialized: boolean;
}

function getState(character: HavokCharacter): WristState {
  let s = (character as any)._wristState as WristState | undefined;
  if (!s) {
    s = { actualDir: Vector3.Zero(), prevHandPos: Vector3.Zero(), initialized: false };
    (character as any)._wristState = s;
  }
  return s;
}

/**
 * IK 解決後に呼び出す。手首を回転して武器方向を制御する。
 */
export function updateWristRotation(character: HavokCharacter, dt: number): void {
  const weapon = character.weapon;
  if (!weapon || dt < 0.0001) return;

  const handBone = character.ikChains.rightArm.end;
  if (!handBone.rotationQuaternion) return;

  const dirs = getCharacterDirections(character);
  if (!dirs) return;

  const state = getState(character);
  handBone.computeWorldMatrix(true);
  const handPos = handBone.getAbsolutePosition().clone();

  if (!state.initialized) {
    state.prevHandPos.copyFrom(handPos);
    const tipWorld = getWeaponTipWorld(character);
    const tipDir = tipWorld.subtract(handPos);
    if (tipDir.length() > 0.001) tipDir.normalize();
    else tipDir.copyFrom(Vector3.Down());
    state.actualDir.copyFrom(tipDir);
    state.initialized = true;
    return;
  }

  // 手の移動速度
  const handDelta = handPos.subtract(state.prevHandPos);
  const handSpeed = handDelta.length() / dt;
  state.prevHandPos.copyFrom(handPos);

  // 現在の武器先端方向 (手首補正なしの状態)
  const tipWorld = getWeaponTipWorld(character);
  const idealDir = tipWorld.subtract(handPos);
  if (idealDir.length() < 0.001) return;
  idealDir.normalize();

  const facing = dirs.forward; // キャラの前方
  const swinging = character.weaponSwing.swinging;

  // ── 目標方向の決定 ──
  let desiredDir: Vector3;

  if (swinging && handSpeed > 0.2) {
    const handDir = handDelta.normalize();
    const upComponent = Vector3.Dot(handDir, Vector3.Up());

    if (upComponent > 0.2) {
      // 振りかぶり中: 武器先端を上方 かつ 背中側に (両方必須)
      desiredDir = Vector3.Up().scale(0.5)
        .add(facing.scale(-0.5))  // 背中側
        .normalize();
    } else if (upComponent < -0.2) {
      // 振り下ろし中: 武器先端を前方下方に
      desiredDir = facing.scale(0.5)
        .add(Vector3.Down().scale(0.5))
        .normalize();
    } else {
      // 横移動など → 手の移動方向に向ける
      desiredDir = handDir;
    }
  } else if (swinging) {
    // スイング中だが手がほぼ静止 → 現在の方向を維持
    desiredDir = state.actualDir.clone();
  } else {
    // 構え中 → 現在の武器方向を維持
    desiredDir = idealDir;
  }

  // ── 慣性追従 ──
  // 重い・長い武器ほど先端の追従が遅い
  const inertia = weapon.weight * weapon.length;

  // スイング中は慣性を強く効かせる (全力で振っている = 軌道修正困難)
  const inertiaScale = swinging ? 10.0 : 2.0;
  const catchUp = 1.0 / (1.0 + inertia * inertiaScale);
  const t = Math.min(1.0, catchUp * dt * 10);

  // actualDir を desiredDir に向けて慣性追従
  Vector3.LerpToRef(state.actualDir, desiredDir, t, state.actualDir);
  state.actualDir.normalize();

  // ── Hand ボーンの回転補正 ──
  // idealDir (現在の武器方向) → actualDir (慣性適用後の方向) の回転差を計算
  const dot = Vector3.Dot(idealDir, state.actualDir);
  if (dot > 0.9999) return;

  const correction = rotationBetweenVectors(idealDir, state.actualDir);

  // 制限内に収まるなら適用
  if (canApplyWithinLimits(character, correction)) {
    applyWristDelta(character, correction);
  } else {
    // 制限外 → actualDir を制限内で最大限 desiredDir に近づける
    // idealDir 方向に戻す (制限内は保証)
    state.actualDir.copyFrom(idealDir);
  }
}

/**
 * Hand ボーンにワールド空間のデルタ回転を適用する。
 */
function applyWristDelta(character: HavokCharacter, deltaWorld: Quaternion): void {
  const handBone = character.ikChains.rightArm.end;
  if (!handBone.rotationQuaternion) return;

  const parent = handBone.parent as any;
  if (!parent) return;
  parent.computeWorldMatrix(true);

  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  const localDelta = parentInv.multiply(deltaWorld).multiply(parentWorldRot);
  handBone.rotationQuaternion = localDelta.multiply(handBone.rotationQuaternion);
}

/**
 * デルタ回転を適用した結果が手首制限内に収まるか確認する。
 */
function canApplyWithinLimits(character: HavokCharacter, deltaWorld: Quaternion): boolean {
  const handBone = character.ikChains.rightArm.end;
  if (!handBone.rotationQuaternion) return false;

  const baseEntry = character.ikBaseRotations.get(handBone.name);
  if (!baseEntry) return false;
  const baseQ = baseEntry.root;

  const parent = handBone.parent as any;
  if (!parent) return false;
  parent.computeWorldMatrix(true);

  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  const localDelta = parentInv.multiply(deltaWorld).multiply(parentWorldRot);
  const candidateRot = localDelta.multiply(handBone.rotationQuaternion);

  const baseInv = baseQ.clone();
  baseInv.invertInPlace();
  const delta = candidateRot.multiply(baseInv);

  const m = new Matrix();
  delta.toRotationMatrix(m);
  const d = m.m;
  const toDeg = 180 / Math.PI;
  const sy = Math.max(-1, Math.min(1, d[2]));
  let ex: number, ey: number, ez: number;
  if (Math.abs(sy) < 0.9999) {
    ex = Math.atan2(-d[6], d[10]) * toDeg;
    ey = Math.asin(sy) * toDeg;
    ez = Math.atan2(-d[1], d[0]) * toDeg;
  } else {
    ex = Math.atan2(d[9], d[5]) * toDeg;
    ey = (sy > 0 ? 90 : -90);
    ez = 0;
  }

  const lim = JOINT_CONFIG.arm.hand;
  return ex >= lim.x.min && ex <= lim.x.max
      && ey >= lim.y.min && ey <= lim.y.max
      && ez >= lim.z.min && ez <= lim.z.max;
}
