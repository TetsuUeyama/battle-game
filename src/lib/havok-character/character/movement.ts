/**
 * キャラクター移動。テレポート・衝突回避・フィールド境界制限。
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { rotateVectorByQuat } from '@/lib/math-utils';

/**
 * キャラクターを指定位置・向きにテレポートする。
 */
export function teleportCharacter(
  character: HavokCharacter, position: Vector3, facingAngleY: number,
): void {
  const oldPos = character.root.position.clone();
  const oldRot = character.root.rotationQuaternion?.clone() ?? Quaternion.Identity();

  character.root.position.copyFrom(position);
  const newRot = Quaternion.RotationAxis(Vector3.Up(), facingAngleY);
  character.root.rotationQuaternion = newRot;

  const oldRotInv = oldRot.clone(); oldRotInv.invertInPlace();
  const deltaRot = newRot.multiply(oldRotInv);

  const stepper = character.footStepper;
  for (const foot of [stepper.left, stepper.right]) {
    const rel = foot.planted.subtract(oldPos);
    foot.planted.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }
  if (character.footPlant.leftLocked) {
    const rel = character.footPlant.leftLocked.subtract(oldPos);
    character.footPlant.leftLocked.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }
  if (character.footPlant.rightLocked) {
    const rel = character.footPlant.rightLocked.subtract(oldPos);
    character.footPlant.rightLocked.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }

  character.footBaseWorldRot.left = deltaRot.multiply(character.footBaseWorldRot.left);
  character.footBaseWorldRot.right = deltaRot.multiply(character.footBaseWorldRot.right);

  const chains = character.ikChains;
  for (const chain of [chains.leftLeg, chains.rightLeg]) {
    const rel = chain.target.subtract(oldPos);
    chain.target.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }
}

/**
 * 2体のキャラクター間の貫通を防ぐ。
 */
export function resolveCharacterCollision(
  a: HavokCharacter, b: HavokCharacter, radius: number = 0.25,
): void {
  const posA = a.root.position;
  const posB = b.root.position;
  const dx = posB.x - posA.x;
  const dz = posB.z - posA.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const minDist = radius * 2;
  if (dist >= minDist || dist < 0.001) return;
  const overlap = minDist - dist;
  const nx = dx / dist;
  const nz = dz / dist;
  const push = overlap * 0.5;
  posA.x -= nx * push;
  posA.z -= nz * push;
  posB.x += nx * push;
  posB.z += nz * push;
}

/**
 * キャラクターをフィールド境界内に制限する。
 */
export function clampToFieldBounds(character: HavokCharacter, halfSize: number = 4.5): void {
  const pos = character.root.position;
  pos.x = Math.max(-halfSize, Math.min(halfSize, pos.x));
  pos.z = Math.max(-halfSize, Math.min(halfSize, pos.z));
}
