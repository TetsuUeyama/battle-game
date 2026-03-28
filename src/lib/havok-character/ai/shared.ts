/**
 * Combat AI — ステート間で共有される処理。
 *
 * - turnToward:    相手方向への自動回転 (足・footBaseWorldRotも追従)
 * - updateStance:  構え位置の毎フレーム更新 (attack以外で使用)
 * - resetSpine:    胴体回転をT-poseにリセット
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { rotateVectorByQuat } from '@/lib/math-utils';
import { getStanceTargets } from '../weapon/stance';
import { updateWeaponInertia } from '../weapon';
import { TURN_CONFIG } from '../character/body';

/**
 * キャラクターを指定方向に回転させ、足の接地位置・footBaseWorldRotも追従させる。
 */
export function turnToward(
  character: HavokCharacter,
  dir: Vector3,
  dirs: { forward: Vector3; charRight: Vector3; charLeft: Vector3 },
  dt: number,
): void {
  const currentFwd = dirs.forward;
  const targetAngle = Math.atan2(dir.x, dir.z);
  const currentAngle = Math.atan2(currentFwd.x, currentFwd.z);
  let angleDiff = targetAngle - currentAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const turnSpeed = TURN_CONFIG.turnSpeed;
  const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnSpeed * dt);

  if (Math.abs(turnAmount) <= 0.0001) return;

  const rotDelta = Quaternion.RotationAxis(Vector3.Up(), turnAmount);
  if (character.root.rotationQuaternion) {
    character.root.rotationQuaternion = rotDelta.multiply(character.root.rotationQuaternion);
  } else {
    character.root.rotationQuaternion = rotDelta.multiply(
      Quaternion.FromEulerAngles(character.root.rotation.x, character.root.rotation.y, character.root.rotation.z),
    );
  }

  // 足の接地位置を root 中心で回転
  const rootPos = character.root.position;
  const stepper = character.footStepper;
  for (const foot of [stepper.left, stepper.right]) {
    const rel = foot.planted.subtract(rootPos);
    const rotated = rotateVectorByQuat(rel, rotDelta);
    foot.planted.copyFrom(rootPos.add(rotated));
    if (foot.stepping) {
      const relT = foot.target.subtract(rootPos);
      foot.target.copyFrom(rootPos.add(rotateVectorByQuat(relT, rotDelta)));
    }
  }
  if (character.footPlant.leftLocked) character.footPlant.leftLocked.copyFrom(stepper.left.planted);
  if (character.footPlant.rightLocked) character.footPlant.rightLocked.copyFrom(stepper.right.planted);
  character.footBaseWorldRot.left = rotDelta.multiply(character.footBaseWorldRot.left);
  character.footBaseWorldRot.right = rotDelta.multiply(character.footBaseWorldRot.right);
}

/**
 * 構え位置を更新し、武器慣性を適用する。attack 以外の全ステートで毎フレーム呼び出す。
 */
export function updateStance(character: HavokCharacter, dt: number): void {
  if (!character.weapon) return;
  const stanceNow = getStanceTargets(character, character.weaponSwing.stance, character.weapon);
  character.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
  updateWeaponInertia(character, stanceNow.rightTarget, dt);
}

/**
 * 胴体回転を T-pose にリセットする。攻撃終了後に呼び出す。
 */
export function resetSpine(character: HavokCharacter): void {
  const spine = character.allBones.get('mixamorig:Spine1');
  if (spine) {
    const baseRot = character.ikBaseRotations.get(spine.name);
    if (baseRot) spine.rotationQuaternion = baseRot.root.clone();
  }
}
