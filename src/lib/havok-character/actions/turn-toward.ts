/**
 * 指定方向への回転アクション。足の接地位置・footBaseWorldRotも追従させる。
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { rotateVectorByQuat } from '@/lib/math-utils';
import { TURN_CONFIG } from '../character/body';

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
