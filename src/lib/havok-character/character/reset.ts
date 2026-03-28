/**
 * ボーンリセット。攻撃終了後などに体幹をT-poseに戻す。
 * ボーンレベルのレート制限 (motion-rate-limit.ts) が自然な速度で制限するため、
 * ここでは目標回転を設定するだけ。
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';

const SPINE_NAMES = ['mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2'] as const;

/**
 * Spine / Spine1 / Spine2 の回転を T-pose に戻す。
 * 実際の移動速度は enforceMotionRateLimit がフレーム毎にクランプする。
 * Hips の Y 位置も基準値に戻す。
 */
export function resetSpine(character: HavokCharacter): void {
  for (const boneName of SPINE_NAMES) {
    const bone = character.allBones.get(boneName);
    if (!bone?.rotationQuaternion) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (!baseRot) continue;

    bone.rotationQuaternion = baseRot.root.clone();
  }

  const hips = character.allBones.get('mixamorig:Hips');
  if (hips) {
    hips.position.y = character.hipsBaseY;
  }
}

/**
 * 即座にリセット (再戦時など完全リセットが必要な場合)。
 * レート制限の前フレーム値もクリアする。
 */
export function resetSpineImmediate(character: HavokCharacter): void {
  for (const boneName of SPINE_NAMES) {
    const bone = character.allBones.get(boneName);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (baseRot) bone.rotationQuaternion = baseRot.root.clone();
  }

  const hips = character.allBones.get('mixamorig:Hips');
  if (hips) hips.position.y = character.hipsBaseY;

  // currentBodyMotion もリセット
  const cur = character.currentBodyMotion;
  cur.torsoLean = 0;
  cur.torsoTwist = 0;
  cur.hipsOffset = 0;
  cur.hipsForward = 0;
  cur.footStepR = 0;
  cur.offHandOffset = Vector3.Zero();

  // レート制限の前フレーム値クリア
  character.prevBoneRotations.clear();
  character.prevBonePosY.clear();
}
