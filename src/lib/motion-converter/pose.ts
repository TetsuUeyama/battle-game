/**
 * 初期ポーズ検出・正規化
 *
 * ■ T-pose vs A-pose
 *   T-pose: 腕が水平 (肩の角度 ≈ 0°)
 *   A-pose: 腕が斜め下 (肩の角度 ≈ 30-45°)
 *
 *   判定方法:
 *     LeftArm の localPosition.y が支配的 → T-pose (腕が横に伸びている)
 *     LeftArm の localPosition に Y と -Z の両成分がある → A-pose
 *
 *   bone-data.json の場合:
 *     LeftArm.localPosition ≈ [0, 12.9, 0] → Y方向のみ → T-pose
 *
 * ■ FK→IK変換での影響
 *   FKモーションデータの dq (デルタクォータニオン) は rest pose からの差分。
 *   rest pose が T-pose か A-pose かで、同じ dq でも最終的な姿勢が変わる。
 *
 *   例: 腕を体の横に下ろすポーズ
 *     T-pose基準: 肩を -90° 回転 (大きな回転)
 *     A-pose基準: 肩を -45° 回転 (小さな回転)
 *
 *   → モーションの rest pose とキャラクターの rest pose が異なる場合、
 *     差分を補正する必要がある。
 *
 * ■ IK使用時の注意
 *   IKシステムはターゲット位置 (ワールド座標) で手足を制御するため、
 *   rest pose の違いは FK ほど影響しない。
 *   ただし IK の pole hint (肘/膝の向き) は rest pose に依存する。
 */
import type { Vec3, Quat, EulerDeg, RawBoneData, RestPoseType, APoseConfig } from './types';
import { stripMixamoPrefix } from './bone-mapping';
import { eulerDegToQuat, mulQuat, conjugateQuat, axisAngleToQuat, normalizeQuat } from './math';

/**
 * bone-data.json から rest pose の種類を検出する。
 *
 * LeftArm の localPosition の方向を見て判断:
 *   Y成分が支配的 (>90%) → T-pose
 *   Y成分が70-90%で Z成分もある → A-pose
 *   それ以外 → unknown
 */
export function detectRestPose(boneData: RawBoneData): RestPoseType {
  const leftArm = boneData.bones.find(b =>
    stripMixamoPrefix(b.name) === 'LeftArm',
  );
  if (!leftArm) return 'unknown';

  const [x, y, z] = leftArm.localPosition;
  const total = Math.sqrt(x * x + y * y + z * z);
  if (total < 0.01) return 'unknown';

  const yRatio = Math.abs(y) / total;

  if (yRatio > 0.9) return 't-pose';
  if (yRatio > 0.7) return 'a-pose';
  return 'unknown';
}

/**
 * A-poseのbone-dataをT-poseに正規化する肩の補正クォータニオンを返す。
 *
 * A-pose → T-pose: 肩をZ軸まわりに回転して水平にする。
 * 返されるクォータニオンをLeftShoulder/RightShoulderのpreRotationに
 * 追加で乗算すると、T-pose相当になる。
 *
 * @param config A-poseの角度設定
 * @returns 左肩・右肩の補正クォータニオン
 */
export function getAPoseToTPoseCorrection(config: APoseConfig = { leftShoulderAngleDeg: -45, rightShoulderAngleDeg: 45 }): {
  leftShoulder: Quat;
  rightShoulder: Quat;
} {
  // Z軸まわりに回転して腕を水平にする
  // 左肩: -45° → 0° なので +45° 回転
  // 右肩: +45° → 0° なので -45° 回転
  return {
    leftShoulder: axisAngleToQuat({ x: 0, y: 0, z: 1 }, -config.leftShoulderAngleDeg),
    rightShoulder: axisAngleToQuat({ x: 0, y: 0, z: 1 }, -config.rightShoulderAngleDeg),
  };
}

/**
 * モーションデータの rest pose とキャラクターの rest pose が異なる場合の
 * デルタクォータニオン補正。
 *
 * motionRestQ: モーションデータの rest pose でのボーン回転 (クォータニオン)
 * charRestQ:   キャラクターの rest pose でのボーン回転 (クォータニオン)
 * dq:          モーション内のデルタクォータニオン
 *
 * 補正後のdq = inv(charRestQ) * motionRestQ * dq * inv(motionRestQ) * charRestQ
 *
 * 簡略化: restPoseDiff = inv(charRestQ) * motionRestQ とすると
 *         補正後dq = restPoseDiff * dq * inv(restPoseDiff)
 */
export function correctDeltaQuatForRestPose(
  dq: Quat,
  motionRestQ: Quat,
  charRestQ: Quat,
): Quat {
  const diff = mulQuat(conjugateQuat(charRestQ), motionRestQ);
  const diffInv = conjugateQuat(diff);
  return normalizeQuat(mulQuat(mulQuat(diff, dq), diffInv));
}
