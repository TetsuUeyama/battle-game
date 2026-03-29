/**
 * MotionConverter
 *
 * Mixamo / Blender のモーションデータを Babylon.js 座標系に変換するモジュール。
 * プロジェクトのトップレベルでインポートし、データ読み込み時に1回変換することで、
 * 後段のコードでは座標系の違いを一切意識する必要がなくなる。
 *
 * ■ 座標系の違いまとめ
 *
 *   | システム    | 利き手 | Up | Forward | 位置単位 | 回転単位 |
 *   |-------------|--------|----|---------|----------|----------|
 *   | Mixamo FBX  | 右手系 | +Y | +Z      | cm       | 度数     |
 *   | Blender     | 右手系 | +Z | +Y      | m        | ラジアン |
 *   | Babylon.js  | 左手系 | +Y | +Z      | m        | ラジアン |
 *
 *   右手系→左手系: 同じ軸名でも回転方向が逆。Z軸反転で変換。
 *   Z-up→Y-up: 軸の入れ替え (Blenderからのデータ)。
 *
 * ■ 使用例
 *
 *   import {
 *     convertBoneData, convertMotionData, extractIKTargets,
 *     detectRestPose,
 *   } from '@/game-assets/MotionConverter';
 *
 *   // 1. ボーンデータ変換
 *   const rawBoneData = await fetch('/bone-data.json').then(r => r.json());
 *   const boneData = convertBoneData(rawBoneData, 'mixamo');
 *
 *   // 2. モーションデータ変換
 *   const rawMotion = await fetch('/Idle.motion.json').then(r => r.json());
 *   const motion = convertMotionData(rawMotion, 'mixamo');
 *
 *   // 3. FK→IK変換 (IKシステムで使う場合)
 *   const ikData = extractIKTargets(motion);
 *   // ikData.ikFrames[0].targets.leftHand → Babylon.js座標系のVec3
 *
 *   // 4. rest pose 検出
 *   const poseType = detectRestPose(rawBoneData); // 't-pose' | 'a-pose' | 'unknown'
 */

// 型定義
export type {
  CoordinateSystem, Handedness, UpAxis, CoordinateSystemDef,
  Vec3, Quat, EulerDeg,
  RawBoneEntry, RawBoneData, ConvertedBoneEntry, ConvertedBoneData,
  MotionHierarchyEntry, RawFrameBone, RawMotionData,
  ConvertedFrameBone, ConvertedMotionData,
  IKTargets, IKFrame, IKMotionData,
  RestPoseType, APoseConfig,
} from './types';

export { COORDINATE_SYSTEMS, DEFAULT_A_POSE } from './types';

// パイプライン (メインAPI)
export { convertBoneData, convertMotionData } from './pipeline';

// FK→IK変換
export { extractIKTargets } from './fk-to-ik';

// ポーズ検出・正規化
export { detectRestPose, getAPoseToTPoseCorrection, correctDeltaQuatForRestPose } from './pose';

// 個別変換 (直接使う必要がある場合)
export {
  convertPositionRHtoLH, convertPositionLHtoRH,
  convertQuatRHtoLH, convertQuatLHtoRH,
  convertEulerRHtoLH, convertEulerLHtoRH,
} from './handedness';

export {
  convertPositionZupToYup, convertPositionYupToZup,
  convertQuatZupToYup, convertQuatYupToZup,
  convertEulerZupToYup, convertEulerYupToZup,
} from './axis-system';

export { cmToM, mToCm, cmToMVec3, mToCmVec3, getScaleToMeters } from './scale';

// ボーンマッピング
export {
  stripMixamoPrefix, addMixamoPrefix,
  IK_END_EFFECTORS, IK_CHAINS,
  MIXAMO_HIERARCHY, FINGER_BONES,
} from './bone-mapping';

// 数学ユーティリティ
export {
  degToRad, radToDeg,
  vec3, quat, quatIdentity,
  mulQuat, conjugateQuat, normalizeQuat, rotateVec3ByQuat,
  eulerDegToQuat, quatToEulerDeg, axisAngleToQuat, slerpQuat,
  addVec3, scaleVec3,
} from './math';
