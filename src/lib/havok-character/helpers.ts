/**
 * Havok Character System — Math utilities and shared helper functions.
 */
import { Vector3, Quaternion, TransformNode } from '@babylonjs/core';
import type { HavokCharacter, WeaponPhysics, StanceType } from './types';
import { PALM_OFFSET } from './types';

// ─── Math Utilities ──────────────────────────────────────

export function degToRad(d: number): number { return d * Math.PI / 180; }

/**
 * FBX XYZ intrinsic Euler (degrees) → Quaternion.
 * FBX applies rotations in order: X, then Y, then Z (intrinsic).
 * Matrix form: Rz * Ry * Rx. Quaternion form: Qz * Qy * Qx.
 *
 * NOTE: Babylon.js Quaternion.FromEulerAngles uses YXZ order,
 * which is WRONG for FBX. We must compose per-axis quaternions.
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

/** Compute shortest rotation quaternion from direction A to direction B */
export function rotationBetweenVectors(from: Vector3, to: Vector3): Quaternion {
  const dot = Vector3.Dot(from, to);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) {
    // 180° rotation: find perpendicular axis
    let perp = Vector3.Cross(from, Vector3.Right());
    if (perp.length() < 0.001) perp = Vector3.Cross(from, Vector3.Up());
    perp.normalize();
    return Quaternion.RotationAxis(perp, Math.PI);
  }
  const axis = Vector3.Cross(from, to).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return Quaternion.RotationAxis(axis, angle);
}

/** Apply a world-space delta rotation to a node's local rotation */
export function applyWorldDeltaRotation(node: TransformNode, deltaWorld: Quaternion, weight: number): void {
  // Get parent's world rotation
  const parent = node.parent as TransformNode;
  if (!parent) return;
  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  // Convert world delta to local delta: localDelta = parentInv * worldDelta * parentRot
  const localDelta = parentInv.multiply(deltaWorld).multiply(parentWorldRot);

  // Apply to current local rotation
  const currentLocal = node.rotationQuaternion ?? Quaternion.Identity();
  const newLocal = localDelta.multiply(currentLocal);

  if (weight >= 1) {
    node.rotationQuaternion = newLocal;
  } else {
    node.rotationQuaternion = Quaternion.Slerp(currentLocal, newLocal, weight);
  }
}

// ─── Node Helpers ────────────────────────────────────────

export function getWorldPos(node: TransformNode): Vector3 {
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition();
}

export function distanceBetweenBones(a: TransformNode, b: TransformNode): number {
  return Vector3.Distance(getWorldPos(a), getWorldPos(b));
}

// ─── Character Direction Helpers ─────────────────────────

/**
 * キャラクターのボーン位置から画面上の方向ベクトルを算出。
 * 重要: Babylon.js左手座標系ではMixamoの左右が画面上で反転する。
 *   Mixamo RightShoulder → 画面左側, Mixamo LeftShoulder → 画面右側
 * この関数は画面上の方向を返す (charRight = 画面上の右方向)。
 */
export function getCharacterDirections(character: HavokCharacter): {
  forward: Vector3; charRight: Vector3; charLeft: Vector3;
} | null {
  const mixamoRShoulder = character.allBones.get('mixamorig:RightShoulder');
  const mixamoLShoulder = character.allBones.get('mixamorig:LeftShoulder');
  if (!mixamoRShoulder || !mixamoLShoulder) return null;

  const mixamoRPos = getWorldPos(mixamoRShoulder);
  const mixamoLPos = getWorldPos(mixamoLShoulder);

  // Mixamo Left→Right方向 = 画面上の右方向 (Babylon.js左手座標系での反転)
  const charRight = mixamoLPos.subtract(mixamoRPos).normalize();
  charRight.y = 0; charRight.normalize();
  const charLeft = charRight.scale(-1);
  const forward = Vector3.Cross(charRight, Vector3.Up()).normalize();

  return { forward, charRight, charLeft };
}

/**
 * 片手武器時のオフハンド(画面左手)の自然な休息位置を計算。
 * 腰の横、やや前方に手を下げた位置。
 */
export function getOffHandRestPosition(character: HavokCharacter): Vector3 | null {
  const dirs = getCharacterDirections(character);
  const hips = character.combatBones.get('hips');
  if (!dirs || !hips) return null;

  const hipsPos = getWorldPos(hips);
  // 画面左手側 = charLeft 方向
  return hipsPos
    .add(dirs.charLeft.scale(0.2))     // 左腰の横
    .add(dirs.forward.scale(0.08))     // やや前方
    .add(new Vector3(0, -0.15, 0));    // 腰より下
}

/**
 * 構えごとのグリップ位置・武器方向・左手位置を算出。
 */
export function getStanceTargets(
  character: HavokCharacter,
  stance: StanceType,
  weapon: WeaponPhysics,
): { rightTarget: Vector3; leftTarget: Vector3 | null; weaponDir: Vector3 } {
  const spine2 = character.combatBones.get('torso');
  const hips = character.combatBones.get('hips');
  const dirs = getCharacterDirections(character);
  if (!spine2 || !hips || !dirs) {
    return { rightTarget: Vector3.Zero(), leftTarget: null, weaponDir: Vector3.Down() };
  }

  const chestPos = getWorldPos(spine2);
  const { forward, charRight, charLeft } = dirs;

  let gripPos: Vector3;
  let weaponDir: Vector3; // grip → tip 方向 (正規化)

  switch (stance) {
    case 'front': {
      // 正面に構える: グリップは胸の前方、やや右寄り
      gripPos = chestPos.add(forward.scale(0.3)).add(charRight.scale(0.1));
      // 武器は前方やや下を向く
      weaponDir = forward.scale(0.7).add(Vector3.Down().scale(0.3)).normalize();
      break;
    }
    case 'side': {
      // 右側面に自然に下げる: グリップは腰の右横
      const hipPos = getWorldPos(hips);
      gripPos = hipPos.add(charRight.scale(0.25)).add(new Vector3(0, -0.05, 0));
      // 武器は真下を向く
      weaponDir = Vector3.Down();
      break;
    }
    case 'overhead': {
      // 頭上に振りかぶり: グリップは頭上やや後方
      const headBone = character.combatBones.get('head');
      const headPos = headBone ? getWorldPos(headBone) : chestPos.add(new Vector3(0, 0.3, 0));
      gripPos = headPos.add(new Vector3(0, 0.15, 0)).add(forward.scale(-0.1)).add(charRight.scale(0.05));
      // 武器は後方下向き (振りかぶった状態)
      weaponDir = forward.scale(-0.5).add(Vector3.Down().scale(0.5)).normalize();
      break;
    }
  }

  // 右手IKターゲット: 画面右手 = Mixamo leftArm チェーン
  const weaponShoulderPos = getWorldPos(character.ikChains.leftArm.root); // 画面右肩
  const shoulderToGrip = gripPos.subtract(weaponShoulderPos).normalize();
  const rightTarget = gripPos.subtract(shoulderToGrip.scale(PALM_OFFSET));

  // 左手IKターゲット (off-hand): 画面左手 = Mixamo rightArm チェーン
  let leftTarget: Vector3 | null = null;
  if (weapon.gripType === 'two-handed') {
    const pommelDir = weaponDir.scale(-1);
    const offHandWorld = gripPos.add(pommelDir.scale(weapon.offHandOffset.y));
    const offHandShoulderPos = getWorldPos(character.ikChains.rightArm.root); // 画面左肩
    const offShoulderToOff = offHandWorld.subtract(offHandShoulderPos).normalize();
    leftTarget = offHandWorld.subtract(offShoulderToOff.scale(PALM_OFFSET));
  }

  return { rightTarget, leftTarget, weaponDir };
}
