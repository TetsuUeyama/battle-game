/**
 * ノックアウト (倒れ) アクション。
 *
 * 体の結合は維持したまま、root回転で倒れる。
 * root全体が重力で落下し、いずれかのボーンが床(Y=0)に接触した時点で
 * rootの落下が止まる。結合を維持するので、床から浮いている部位も出る。
 *
 * 段階:
 *   1. stagger (0-0.5秒): よろめき
 *   2. falling: root回転 + 重力落下、最低ボーンが床に着くまで
 *   3. grounded: 停止
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getCharacterDirections } from '../character/directions';

export type KnockoutPhase = 'none' | 'stagger' | 'falling' | 'grounded';

export interface KnockoutState {
  phase: KnockoutPhase;
  timer: number;
  fallAxis: Vector3;
  fallVector: Vector3;
  baseRootRot: Quaternion;
  /** root の落下速度 (m/s) */
  velocityY: number;
  /** root の回転速度 (rad/s) */
  angularVel: number;
  /** 現在の回転角度 (rad) */
  currentAngle: number;
}

const STAGGER_DURATION = 0.5;
const GRAVITY = 9.0;
const ANGULAR_ACCEL = 2.5;   // 回転加速度 (rad/s²)
const MAX_ANGULAR_VEL = 3.5; // 最大回転速度
const MAX_ANGLE = Math.PI * 0.5; // 90度で回転停止

/** 床判定に使う主要ボーン */
const FLOOR_CHECK_BONES = [
  'mixamorig:Head', 'mixamorig:HeadTop_End',
  'mixamorig:Hips', 'mixamorig:Spine1', 'mixamorig:Spine2', 'mixamorig:Neck',
  'mixamorig:LeftHand', 'mixamorig:RightHand',
  'mixamorig:LeftFoot', 'mixamorig:RightFoot',
  'mixamorig:LeftArm', 'mixamorig:RightArm',
  'mixamorig:LeftForeArm', 'mixamorig:RightForeArm',
  'mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg',
  'mixamorig:LeftLeg', 'mixamorig:RightLeg',
];

export function createKnockoutState(): KnockoutState {
  return {
    phase: 'none',
    timer: 0,
    fallAxis: Vector3.Right(),
    fallVector: Vector3.Zero(),
    baseRootRot: Quaternion.Identity(),
    velocityY: 0,
    angularVel: 0,
    currentAngle: 0,
  };
}

export function startKnockout(
  character: HavokCharacter,
  ko: KnockoutState,
  attackerPos: Vector3,
): void {
  if (ko.phase !== 'none') return;

  ko.phase = 'stagger';
  ko.timer = 0;
  ko.velocityY = 0;
  ko.angularVel = 0.5; // 初期回転速度
  ko.currentAngle = 0;
  ko.baseRootRot = (character.root.rotationQuaternion ?? Quaternion.Identity()).clone();

  const dirs = getCharacterDirections(character);
  if (dirs) {
    const toAttacker = attackerPos.subtract(character.root.position);
    toAttacker.y = 0;
    toAttacker.normalize();
    const forwardDot = Vector3.Dot(toAttacker, dirs.forward);
    if (forwardDot > 0) {
      ko.fallVector = dirs.forward.scale(-1);
      ko.fallAxis = dirs.charRight.scale(-1);
    } else {
      ko.fallVector = dirs.forward.clone();
      ko.fallAxis = dirs.charRight.clone();
    }
  } else {
    ko.fallVector = new Vector3(0, 0, -1);
    ko.fallAxis = Vector3.Right();
  }

  // 全IK無効化
  character.ikChains.leftLeg.weight = 0;
  character.ikChains.rightLeg.weight = 0;
  character.ikChains.leftArm.weight = 0;
  character.ikChains.rightArm.weight = 0;
}

export function updateKnockout(
  character: HavokCharacter,
  ko: KnockoutState,
  dt: number,
): boolean {
  if (ko.phase === 'none' || ko.phase === 'grounded') return false;

  ko.timer += dt;

  switch (ko.phase) {
    case 'stagger': {
      const t = Math.min(1, ko.timer / STAGGER_DURATION);

      // 少し傾く + 横揺れ
      ko.currentAngle = t * t * 0.15;
      const rot = Quaternion.RotationAxis(ko.fallAxis, ko.currentAngle);
      character.root.rotationQuaternion = rot.multiply(ko.baseRootRot);

      const wobble = Math.sin(ko.timer * 14) * (1 - t) * 0.012;
      character.root.position.x += wobble;
      character.root.position.addInPlace(ko.fallVector.scale(t * 0.1 * dt));

      if (ko.timer >= STAGGER_DURATION) {
        ko.phase = 'falling';
        ko.timer = 0;
        ko.baseRootRot = (character.root.rotationQuaternion ?? Quaternion.Identity()).clone();
        ko.currentAngle = 0;
      }
      break;
    }

    case 'falling': {
      // 回転: 加速しながら倒れる (最大90度)
      if (ko.currentAngle < MAX_ANGLE) {
        ko.angularVel = Math.min(MAX_ANGULAR_VEL, ko.angularVel + ANGULAR_ACCEL * dt);
        ko.currentAngle = Math.min(MAX_ANGLE, ko.currentAngle + ko.angularVel * dt);
      }

      const fallRot = Quaternion.RotationAxis(ko.fallAxis, ko.currentAngle);
      character.root.rotationQuaternion = fallRot.multiply(ko.baseRootRot);

      // 重力: rootのYが落下
      ko.velocityY -= GRAVITY * dt;
      character.root.position.y += ko.velocityY * dt;

      // 倒れる方向に水平移動
      character.root.position.addInPlace(ko.fallVector.scale(0.8 * dt));

      // 全ボーンのワールドYを確認し、最低ボーンが床に着いたらrootを押し上げ
      const correction = getFloorCorrection(character);
      if (correction > 0) {
        character.root.position.y += correction;
        // 床に到達 → 速度を減衰 (バウンド)
        if (ko.velocityY < -0.1) {
          ko.velocityY = Math.abs(ko.velocityY) * 0.15; // 軽い跳ね返り
        } else {
          ko.velocityY = 0;
        }
      }

      // 停止判定: 速度がほぼ0 + 回転完了
      if (Math.abs(ko.velocityY) < 0.05 && ko.currentAngle >= MAX_ANGLE * 0.95 && correction > 0) {
        ko.phase = 'grounded';
        ko.velocityY = 0;
        // 最終補正
        const finalCorrection = getFloorCorrection(character);
        if (finalCorrection > 0) character.root.position.y += finalCorrection;
      }
      break;
    }
  }

  return true;
}

/**
 * 主要ボーンのワールドY最小値を確認し、床下に出ている場合の補正量を返す。
 * 0 = 補正不要 (床上)。
 */
function getFloorCorrection(character: HavokCharacter): number {
  character.root.computeWorldMatrix(true);
  for (const bone of character.allBones.values()) {
    bone.computeWorldMatrix(true);
  }

  let minY = Infinity;
  for (const name of FLOOR_CHECK_BONES) {
    const bone = character.allBones.get(name);
    if (bone) {
      const y = bone.getAbsolutePosition().y;
      if (y < minY) minY = y;
    }
  }

  return minY < 0 ? -minY : 0;
}
