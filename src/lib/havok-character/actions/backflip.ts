/**
 * バク転アクション。
 *
 * 後方に跳躍し、腰を軸に空中で1回転して着地。
 * 腕は跳躍時に上に振り上げ → 空中で体に沿わせ → 着地で下ろす。
 * 膝は溜め→跳躍→空中で畳む→着地で伸ばす。
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getCharacterDirections } from '../character/directions';

export type BackflipPhase = 'none' | 'crouch' | 'airborne' | 'landing';

export interface BackflipState {
  phase: BackflipPhase;
  timer: number;
  backDir: Vector3;
  rotAxis: Vector3;
  baseRootRot: Quaternion;
  basePos: Vector3;
  jumpVelocity: number;
  velocityY: number;
  pivotHeight: number;
}

const CROUCH_DURATION = 0.15;
const AIRBORNE_DURATION = 0.65;
const LANDING_DURATION = 0.25;
const JUMP_HEIGHT = 1.4;
const BACK_DISTANCE = 1.5;
const ROTATION_AMOUNT = Math.PI * 2;

export function createBackflipState(): BackflipState {
  return {
    phase: 'none', timer: 0,
    backDir: Vector3.Zero(), rotAxis: Vector3.Right(),
    baseRootRot: Quaternion.Identity(), basePos: Vector3.Zero(),
    jumpVelocity: 0, velocityY: 0, pivotHeight: 0.9,
  };
}

export function startBackflip(character: HavokCharacter, bf: BackflipState): boolean {
  if (bf.phase !== 'none') return false;
  const dirs = getCharacterDirections(character);
  if (!dirs) return false;

  bf.phase = 'crouch';
  bf.timer = 0;
  bf.backDir = dirs.forward.scale(-1);
  bf.rotAxis = dirs.charRight.scale(-1);
  bf.baseRootRot = (character.root.rotationQuaternion ?? Quaternion.Identity()).clone();
  bf.basePos = character.root.position.clone();
  bf.velocityY = 0;

  const hipsBone = character.allBones.get('mixamorig:Hips');
  if (hipsBone) {
    hipsBone.computeWorldMatrix(true);
    bf.pivotHeight = hipsBone.getAbsolutePosition().y - character.root.position.y;
  } else {
    bf.pivotHeight = 0.9;
  }

  bf.jumpVelocity = Math.sqrt(2 * 9.8 * JUMP_HEIGHT);
  return true;
}

export function updateBackflip(character: HavokCharacter, bf: BackflipState, dt: number): boolean {
  if (bf.phase === 'none') return false;
  bf.timer += dt;

  switch (bf.phase) {
    case 'crouch': {
      const t = Math.min(1, bf.timer / CROUCH_DURATION);
      const eased = t * t;

      // 膝を曲げて溜め
      const hipsBone = character.allBones.get('mixamorig:Hips');
      if (hipsBone) hipsBone.position.y = character.hipsBaseY - eased * 0.12;

      // 腕を後ろに引く (溜め)
      applyArmPose(character, -0.3 * eased, -0.2 * eased);

      // 膝を曲げる (足のIKターゲットを少し上に)
      character.ikChains.leftLeg.target.y += eased * 0.05;
      character.ikChains.rightLeg.target.y += eased * 0.05;

      if (bf.timer >= CROUCH_DURATION) {
        bf.phase = 'airborne';
        bf.timer = 0;
        bf.velocityY = bf.jumpVelocity;
        bf.basePos = character.root.position.clone();
        character.ikChains.leftLeg.weight = 0;
        character.ikChains.rightLeg.weight = 0;
        character.ikChains.leftArm.weight = 0;
        character.ikChains.rightArm.weight = 0;
        if (hipsBone) hipsBone.position.y = character.hipsBaseY;
      }
      break;
    }

    case 'airborne': {
      const t = Math.min(1, bf.timer / AIRBORNE_DURATION);

      // 放物線
      bf.velocityY -= 9.8 * dt;
      const jumpY = bf.basePos.y + bf.velocityY * bf.timer - 0.5 * 9.8 * bf.timer * bf.timer;

      // 後方移動
      const backOffset = bf.backDir.scale(BACK_DISTANCE * t);

      // 回転 (sine ease)
      const rotEased = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const angle = rotEased * ROTATION_AMOUNT;

      // 腰軸の位置補正
      const pivotOffset = new Vector3(0, bf.pivotHeight, 0);
      const rot = Quaternion.RotationAxis(bf.rotAxis, angle);
      const rotConj = rot.clone(); rotConj.invertInPlace();
      const rotQ = rot.multiply(new Quaternion(pivotOffset.x, pivotOffset.y, pivotOffset.z, 0)).multiply(rotConj);
      const rotatedPivot = new Vector3(rotQ.x, rotQ.y, rotQ.z);
      const pivotCorrection = pivotOffset.subtract(rotatedPivot);

      character.root.position.set(
        bf.basePos.x + backOffset.x + pivotCorrection.x,
        Math.max(0, jumpY + pivotCorrection.y),
        bf.basePos.z + backOffset.z + pivotCorrection.z,
      );
      character.root.rotationQuaternion = rot.multiply(bf.baseRootRot);

      // ─── 腕: 振り上げ → 体に沿わせる → 下ろす ───
      // t=0: 腕を上に振り上げ, t=0.3-0.7: 体に沿わせる (タック), t=1: 下ろす
      let armUp: number, armFwd: number;
      if (t < 0.2) {
        // 跳び出し: 腕を上に振り上げる
        const at = t / 0.2;
        armUp = at * 1.2;    // 頭上に
        armFwd = at * 0.3;
      } else if (t < 0.7) {
        // 空中タック: 腕を体に沿わせる
        const at = (t - 0.2) / 0.5;
        armUp = 1.2 - at * 1.0;  // 上から下へ
        armFwd = 0.3 - at * 0.5; // 前から体側へ
      } else {
        // 着地準備: 腕を前方下に
        const at = (t - 0.7) / 0.3;
        armUp = 0.2 - at * 0.4;
        armFwd = -0.2 - at * 0.1;
      }
      applyArmPose(character, armFwd, armUp);

      // ─── 膝: 空中で畳む ───
      // Spine に少し前屈を追加 (タック姿勢)
      const tuckAmount = t < 0.3 ? t / 0.3 : t > 0.7 ? (1 - t) / 0.3 : 1.0;
      const spineBone = character.allBones.get('mixamorig:Spine1');
      if (spineBone) {
        const baseRot = character.ikBaseRotations.get(spineBone.name);
        if (baseRot) {
          const tuckQuat = Quaternion.RotationAxis(bf.rotAxis.scale(-1), tuckAmount * 0.25);
          spineBone.rotationQuaternion = tuckQuat.multiply(baseRot.root);
        }
      }

      // 着地判定
      if (t > 0.6 && character.root.position.y <= bf.basePos.y + 0.01) {
        character.root.position.y = bf.basePos.y;
        bf.phase = 'landing';
        bf.timer = 0;
        character.root.rotationQuaternion = bf.baseRootRot.clone();
        character.ikChains.leftLeg.weight = 1;
        character.ikChains.rightLeg.weight = 1;
        character.ikChains.leftArm.weight = 1;
        character.ikChains.rightArm.weight = 1;
        // Spine リセット
        if (spineBone) {
          const baseRot = character.ikBaseRotations.get(spineBone.name);
          if (baseRot) spineBone.rotationQuaternion = baseRot.root.clone();
        }
      }
      break;
    }

    case 'landing': {
      const t = Math.min(1, bf.timer / LANDING_DURATION);
      character.root.position.y = bf.basePos.y;
      character.root.rotationQuaternion = bf.baseRootRot.clone();

      // 着地衝撃吸収 (膝曲げ)
      const sinkCurve = Math.sin(t * Math.PI);
      const hipsBone = character.allBones.get('mixamorig:Hips');
      if (hipsBone) hipsBone.position.y = character.hipsBaseY - sinkCurve * 0.12;

      // 腕を下ろして安定
      applyArmPose(character, -0.1 * (1 - t), -0.1 * (1 - t));

      if (bf.timer >= LANDING_DURATION) {
        bf.phase = 'none';
        if (hipsBone) hipsBone.position.y = character.hipsBaseY;
        return false;
      }
      break;
    }
  }

  return true;
}

/**
 * 腕のポーズを設定 (IKが無効な時はボーンを直接回転)
 * @param fwd 前方方向の角度 (rad, +=前方)
 * @param up 上方向の角度 (rad, +=上)
 */
function applyArmPose(character: HavokCharacter, fwd: number, up: number): void {
  for (const armName of ['mixamorig:LeftArm', 'mixamorig:RightArm']) {
    const bone = character.allBones.get(armName);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (!baseRot) continue;

    // charRight方向 (肩の前後回転軸) を使用
    // 左腕と右腕で向きを反転
    const isLeft = armName.includes('Left');
    const dirs = getCharacterDirections(character);
    if (!dirs) continue;

    const fwdAxis = dirs.charRight.scale(isLeft ? 1 : -1);
    const upAxis = dirs.forward.scale(isLeft ? -1 : 1);

    const fwdRot = Quaternion.RotationAxis(fwdAxis, fwd);
    const upRot = Quaternion.RotationAxis(upAxis, up);
    bone.rotationQuaternion = upRot.multiply(fwdRot).multiply(baseRot.root);
  }

  // 前腕も少し追従
  for (const forearmName of ['mixamorig:LeftForeArm', 'mixamorig:RightForeArm']) {
    const bone = character.allBones.get(forearmName);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (!baseRot) continue;

    const dirs = getCharacterDirections(character);
    if (!dirs) continue;
    const isLeft = forearmName.includes('Left');
    const axis = dirs.charRight.scale(isLeft ? 1 : -1);
    const bendRot = Quaternion.RotationAxis(axis, fwd * 0.5 + Math.max(0, up) * 0.3);
    bone.rotationQuaternion = bendRot.multiply(baseRot.root);
  }
}

export function isBackflipActive(bf: BackflipState): boolean {
  return bf.phase !== 'none';
}
