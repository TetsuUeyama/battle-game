/**
 * ボーン回転・位置のレート制限。
 *
 * 各ボーンの前フレーム回転を記録し、現在フレームとの角度差が
 * 最大角速度 × dt を超える場合は Slerp でクランプする。
 * 全てのモーション適用後、update パイプラインの最後に1回呼ぶ。
 *
 * スイング中は applyBodyMotion が制御する Spine/Hips をスキップする。
 * スイングのeasing関数が既に滑らかに補間しているためレート制限は不要。
 */
import { Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { BONE_ANGULAR_SPEED, PART_LINEAR_SPEED } from './body/motion-speed';

/** レート制限をスキップするボーン: IK + clamp が最終権限を持つボーンは除外 */
const RATE_LIMIT_SKIP_BONES = new Set([
  // 腕: IK + clampArmRotation が制御
  'mixamorig:LeftArm', 'mixamorig:RightArm',
  'mixamorig:LeftForeArm', 'mixamorig:RightForeArm',
  'mixamorig:LeftHand', 'mixamorig:RightHand',
  // 肩: clampShoulderX が制御
  'mixamorig:LeftShoulder', 'mixamorig:RightShoulder',
]);

/**
 * レート制限対象ボーンの回転をクランプし、前フレーム値を更新する。
 * IKソルバー・モーション適用の全てが完了した後に呼ぶ。
 */
export function enforceMotionRateLimit(character: HavokCharacter, dt: number): void {
  const prev = character.prevBoneRotations;
  const swinging = character.weaponSwing.swinging;

  for (const [boneName, maxAngVel] of Object.entries(BONE_ANGULAR_SPEED)) {
    // IK + clamp が最終権限を持つボーンは常にスキップ
    if (RATE_LIMIT_SKIP_BONES.has(boneName)) {
      const bone = character.allBones.get(boneName);
      if (bone?.rotationQuaternion) {
        prev.set(boneName, bone.rotationQuaternion.clone());
      }
      continue;
    }
    // スイング中: Spine はスキップ (applyBodyMotion が制御)
    if (swinging && boneName.includes('Spine')) {
      const bone = character.allBones.get(boneName);
      if (bone?.rotationQuaternion) {
        prev.set(boneName, bone.rotationQuaternion.clone());
      }
      continue;
    }

    const bone = character.allBones.get(boneName);
    if (!bone?.rotationQuaternion) continue;

    const prevRot = prev.get(boneName);
    if (!prevRot) {
      prev.set(boneName, bone.rotationQuaternion.clone());
      continue;
    }

    // 前フレームとの角度差を計算
    const current = bone.rotationQuaternion;
    const dot = Math.abs(Quaternion.Dot(prevRot, current));
    const angle = 2 * Math.acos(Math.min(1, dot));

    const maxAngle = maxAngVel * dt;

    if (angle > maxAngle && angle > 0.001) {
      const t = maxAngle / angle;
      bone.rotationQuaternion = Quaternion.Slerp(prevRot, current, t);
    }

    prev.set(boneName, bone.rotationQuaternion.clone());
  }

  // 位置 (Hips Y) — スイング中はスキップ
  if (!swinging) {
    const prevY = character.prevBonePosY;
    for (const [boneName, maxVel] of Object.entries(PART_LINEAR_SPEED)) {
      const bone = character.allBones.get(boneName);
      if (!bone) continue;

      const py = prevY.get(boneName);
      if (py === undefined) {
        prevY.set(boneName, bone.position.y);
        continue;
      }

      const diff = bone.position.y - py;
      const maxDelta = maxVel * dt;

      if (Math.abs(diff) > maxDelta) {
        bone.position.y = py + Math.sign(diff) * maxDelta;
      }

      prevY.set(boneName, bone.position.y);
    }
  } else {
    // スイング中もHips prevは更新
    const prevY = character.prevBonePosY;
    const bone = character.allBones.get('mixamorig:Hips');
    if (bone) prevY.set('mixamorig:Hips', bone.position.y);
  }
}

/**
 * 前フレーム値をリセット (再戦・テレポート時)。
 */
export function resetMotionRateLimit(character: HavokCharacter): void {
  character.prevBoneRotations.clear();
  character.prevBonePosY.clear();
}
