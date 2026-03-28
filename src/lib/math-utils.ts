/**
 * 汎用数学ユーティリティ。
 * Babylon.js の Vector3/Quaternion/TransformNode を操作する純粋な関数群。
 */
import { Vector3, Quaternion, TransformNode } from '@babylonjs/core';

export function degToRad(d: number): number { return d * Math.PI / 180; }

/**
 * FBX XYZ intrinsic Euler (degrees) → Quaternion.
 * FBX applies rotations in order: X, then Y, then Z (intrinsic).
 */
export function eulerDegreesToQuat(xDeg: number, yDeg: number, zDeg: number): Quaternion {
  const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(xDeg));
  const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), degToRad(yDeg));
  const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), degToRad(zDeg));
  return qz.multiply(qy.multiply(qx));
}

/** Quaternion でベクトルを回転: v' = q * v * q^-1 */
export function rotateVectorByQuat(v: Vector3, q: Quaternion): Vector3 {
  const conj = q.clone(); conj.invertInPlace();
  const r = q.multiply(new Quaternion(v.x, v.y, v.z, 0)).multiply(conj);
  return new Vector3(r.x, r.y, r.z);
}

/** 2方向間の最短回転Quaternionを算出 */
export function rotationBetweenVectors(from: Vector3, to: Vector3): Quaternion {
  const dot = Vector3.Dot(from, to);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) {
    let perp = Vector3.Cross(from, Vector3.Right());
    if (perp.length() < 0.001) perp = Vector3.Cross(from, Vector3.Up());
    perp.normalize();
    return Quaternion.RotationAxis(perp, Math.PI);
  }
  const axis = Vector3.Cross(from, to).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return Quaternion.RotationAxis(axis, angle);
}

/** ワールド空間のデルタ回転をノードのローカル回転に適用 */
export function applyWorldDeltaRotation(node: TransformNode, deltaWorld: Quaternion, weight: number): void {
  const parent = node.parent as TransformNode;
  if (!parent) return;
  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(parent.getWorldMatrix().getRotationMatrix());
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();
  const localDelta = parentInv.multiply(deltaWorld).multiply(parentWorldRot);
  const currentLocal = node.rotationQuaternion ?? Quaternion.Identity();
  const newLocal = localDelta.multiply(currentLocal);
  if (weight >= 1) {
    node.rotationQuaternion = newLocal;
  } else {
    node.rotationQuaternion = Quaternion.Slerp(currentLocal, newLocal, weight);
  }
}

/** TransformNodeのワールド位置を取得 */
export function getWorldPos(node: TransformNode): Vector3 {
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition();
}

/** 2つのボーン間のワールド距離 */
export function distanceBetweenBones(a: TransformNode, b: TransformNode): number {
  return Vector3.Distance(getWorldPos(a), getWorldPos(b));
}
