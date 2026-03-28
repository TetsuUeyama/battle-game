/**
 * ジャンプアクション。
 *
 * 膝を曲げて溜め → 膝を伸ばすモーメントで跳躍 → 放物線 → 着地衝撃吸収。
 * 走り中の水平慣性を引き継いで慣性ジャンプが可能。
 *
 * 段階:
 *   1. crouch (0-0.2秒): 膝を曲げて溜め (Hips沈み + 膝IKターゲット上昇)
 *   2. airborne: 膝を伸ばして跳躍 (放物線 + 水平慣性移動)
 *   3. landing (0.2秒): 着地衝撃吸収 (膝曲げ→元に戻す)
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getCharacterDirections } from '../character/directions';
import { applyWorldDeltaRotation } from '@/lib/math-utils';

const CROUCH_DURATION = 0.18;
const LANDING_DURATION = 0.22;
const CROUCH_DEPTH = 0.15;       // 溜め時の腰沈み (m)
const MIN_JUMP_POWER = 0.5;       // 最低跳躍力倍率
const AIR_DRAG = 0.98;            // 空中の水平減速
const LANDING_SINK = 0.14;        // 着地衝撃の沈み (m)

/**
 * ジャンプ開始 (溜めフェーズへ)。
 * @param horizontalVelocity 走り中の水平速度 (省略時は0 = 真上ジャンプ)
 */
export function startJump(character: HavokCharacter, horizontalVelocity?: Vector3): void {
  const jump = character.jumpState;
  if (jump.active) return;

  jump.active = true;
  jump.phase = 'crouch';
  jump.phaseTimer = 0;
  jump.crouchPower = 0;
  jump.heightOffset = 0;
  jump.velocityY = 0;

  // 走り慣性を引き継ぐ
  if (horizontalVelocity) {
    jump.horizontalVelocity = horizontalVelocity.clone();
    jump.horizontalVelocity.y = 0;
  } else {
    jump.horizontalVelocity = Vector3.Zero();
  }
}

/** ジャンプ進行。毎フレーム呼び出し。 */
export function updateJump(character: HavokCharacter, dt: number): void {
  const jump = character.jumpState;
  if (!jump.active) return;

  jump.phaseTimer += dt;
  const wasActive = jump.active;

  switch (jump.phase) {
    case 'crouch': {
      // 膝を曲げて溜め: 溜め時間に比例して跳躍力UP (ただし上限あり)
      const t = Math.min(1, jump.phaseTimer / CROUCH_DURATION);
      const eased = t * t; // ease-in

      jump.crouchPower = eased;

      // Hips を沈める
      const hipsBone = character.allBones.get('mixamorig:Hips');
      if (hipsBone) {
        hipsBone.position.y = character.hipsBaseY - eased * CROUCH_DEPTH;
      }

      // 膝IKターゲットを少し上げて膝を曲げる
      const chains = character.ikChains;
      if (chains.leftLeg.weight > 0) {
        chains.leftLeg.target.y += eased * 0.04 * dt * 60; // フレームレート補正
      }
      if (chains.rightLeg.weight > 0) {
        chains.rightLeg.target.y += eased * 0.04 * dt * 60;
      }

      if (jump.phaseTimer >= CROUCH_DURATION) {
        // 溜め完了 → 膝を伸ばして跳躍!
        jump.phase = 'airborne';
        jump.phaseTimer = 0;

        // 跳躍力 = 基本速度 × (最低倍率 + 溜め量)
        const power = MIN_JUMP_POWER + jump.crouchPower * (1 - MIN_JUMP_POWER);
        jump.velocityY = jump.jumpVelocity * power;

        // Hips を戻す
        if (hipsBone) {
          hipsBone.position.y = character.hipsBaseY;
        }
      }
      break;
    }

    case 'airborne': {
      // 重力
      jump.velocityY -= jump.gravity * dt;
      jump.heightOffset += jump.velocityY * dt;

      // 水平慣性移動
      if (jump.horizontalVelocity.length() > 0.01) {
        character.root.position.addInPlace(jump.horizontalVelocity.scale(dt));
        // 空気抵抗で減速
        jump.horizontalVelocity.scaleInPlace(Math.pow(AIR_DRAG, dt * 60));
      }

      // 着地判定
      if (jump.heightOffset <= 0) {
        jump.heightOffset = 0;
        jump.phase = 'landing';
        jump.phaseTimer = 0;
        jump.velocityY = 0;
      }

      character.root.position.y = jump.heightOffset;

      // 足のIKターゲットを持ち上げ
      if (jump.heightOffset > 0.05) {
        const chains = character.ikChains;
        const groundY = character.initialFootY.left;
        const airFootY = groundY + jump.heightOffset - 0.05;
        chains.leftLeg.target.y = Math.max(groundY, airFootY);
        chains.rightLeg.target.y = Math.max(groundY, airFootY);
      }

      // 腕モーション
      const maxHeight = (jump.jumpVelocity * jump.jumpVelocity) / (2 * jump.gravity);
      const heightRatio = maxHeight > 0 ? jump.heightOffset / maxHeight : 0;
      applyJumpArmPose(character, heightRatio, jump.velocityY > 0);
      break;
    }

    case 'landing': {
      // 着地衝撃吸収
      const t = Math.min(1, jump.phaseTimer / LANDING_DURATION);
      character.root.position.y = 0;
      jump.heightOffset = 0;

      // 膝を曲げて沈む → 戻る
      const sinkCurve = Math.sin(t * Math.PI);
      const hipsBone = character.allBones.get('mixamorig:Hips');
      if (hipsBone) {
        hipsBone.position.y = character.hipsBaseY - sinkCurve * LANDING_SINK;
      }

      // 残りの水平慣性を消化
      if (jump.horizontalVelocity.length() > 0.01) {
        character.root.position.addInPlace(jump.horizontalVelocity.scale(dt * (1 - t)));
        jump.horizontalVelocity.scaleInPlace(0.9);
      }

      // 腕を戻す
      applyJumpArmPose(character, (1 - t) * 0.2, false);

      if (jump.phaseTimer >= LANDING_DURATION) {
        jump.active = false;
        jump.phase = 'none';
        jump.horizontalVelocity = Vector3.Zero();
        if (hipsBone) hipsBone.position.y = character.hipsBaseY;
        resetArmPose(character);
      }
      break;
    }
  }
}

// ─── 腕モーション ────────────────────────────────────────

function applyJumpArmPose(character: HavokCharacter, heightRatio: number, ascending: boolean): void {
  const dirs = getCharacterDirections(character);
  if (!dirs) return;

  let armUp: number, armFwd: number;
  if (ascending) {
    armUp = heightRatio * 0.8;
    armFwd = heightRatio * 0.2;
  } else {
    armUp = heightRatio * 0.3;
    armFwd = -heightRatio * 0.15;
  }

  for (const armName of ['mixamorig:LeftArm', 'mixamorig:RightArm']) {
    const bone = character.allBones.get(armName);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (!baseRot) continue;
    const isLeft = armName.includes('Left');
    const fwdAxis = dirs.charRight.scale(isLeft ? 1 : -1);
    const upAxis = dirs.forward.scale(isLeft ? -1 : 1);
    const fwdRot = Quaternion.RotationAxis(fwdAxis, armFwd);
    const upRot = Quaternion.RotationAxis(upAxis, armUp);
    const deltaWorld = upRot.multiply(fwdRot);
    bone.rotationQuaternion = baseRot.root.clone();
    applyWorldDeltaRotation(bone, deltaWorld, 1.0);
  }

  for (const name of ['mixamorig:LeftForeArm', 'mixamorig:RightForeArm']) {
    const bone = character.allBones.get(name);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (!baseRot) continue;
    const isLeft = name.includes('Left');
    const axis = dirs.charRight.scale(isLeft ? 1 : -1);
    const bend = Math.max(0, armUp) * 0.4;
    bone.rotationQuaternion = baseRot.root.clone();
    applyWorldDeltaRotation(bone, Quaternion.RotationAxis(axis, bend), 1.0);
  }
}

function resetArmPose(character: HavokCharacter): void {
  for (const name of ['mixamorig:LeftArm', 'mixamorig:RightArm', 'mixamorig:LeftForeArm', 'mixamorig:RightForeArm']) {
    const bone = character.allBones.get(name);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (baseRot) bone.rotationQuaternion = baseRot.root.clone();
  }
}
