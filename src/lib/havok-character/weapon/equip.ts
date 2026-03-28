/**
 * 武器の装備・解除・構え変更。
 * IKターゲット設定と武器メッシュの配置を担当。
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion,
} from '@babylonjs/core';
import type { HavokCharacter, WeaponPhysics, StanceType } from '../types';
import { createWeaponSwingState, PALM_GRIP_POINTS } from '../types';
import { getWorldPos, rotationBetweenVectors } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getStanceTargets, getOffHandRestPosition } from './stance';
import { getWeaponTipWorld } from './physics';

/**
 * 武器を装備する。
 * weaponMesh が指定されればそれを使用、なければデバッグ用ボックスを生成。
 */
export function equipWeapon(
  scene: Scene, character: HavokCharacter, weapon: WeaponPhysics,
  stance: StanceType = 'front',
  weaponMesh?: Mesh,
): void {
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }

  character.weapon = weapon;

  if (weaponMesh) {
    weaponMesh.parent = character.weaponAttachR;
    character.weaponMesh = weaponMesh;
  } else {
    character.weaponAttachR.position.set(0, 0.064, 0.035);
    const mesh = MeshBuilder.CreateBox(
      `${character.root.name}_weapon`,
      { width: 0.03, height: weapon.length, depth: 0.03 },
      scene,
    );
    const mat = new StandardMaterial(`${character.root.name}_weaponMat`, scene);
    mat.diffuseColor = new Color3(0.8, 0.8, 0.2);
    mat.specularColor = new Color3(0.3, 0.3, 0.1);
    mesh.material = mat;
    mesh.parent = character.weaponAttachR;
    mesh.position.set(0, -weapon.length / 2, 0);
    character.weaponMesh = mesh;
  }

  applyStance(character, stance);
}

/**
 * 構えを変更する (装備中に呼び出し)
 */
export function setStance(character: HavokCharacter, stance: StanceType): void {
  if (!character.weapon) return;
  applyStance(character, stance);
}

/**
 * 武器を外す
 */
export function unequipWeapon(character: HavokCharacter): void {
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }
  character.weapon = null;
  character.weaponSwing = createWeaponSwingState();
}

/**
 * 構えを適用する: IKターゲットと武器の向きを設定
 */
export function applyStance(character: HavokCharacter, stance: StanceType): void {
  const weapon = character.weapon;
  if (!weapon) return;

  const swing = character.weaponSwing;
  swing.stance = stance;

  const { rightTarget, leftTarget, weaponDir } = getStanceTargets(character, stance, weapon);
  swing.baseHandPos = rightTarget.clone();
  swing.smoothedTarget = rightTarget.clone();

  character.ikChains.leftArm.target.copyFrom(rightTarget);
  character.ikChains.leftArm.weight = 1;

  if (weapon.gripType === 'two-handed' && leftTarget) {
    character.ikChains.rightArm.target.copyFrom(leftTarget);
    character.ikChains.rightArm.weight = 1;
  } else {
    const offHandPos = getOffHandRestPosition(character);
    if (offHandPos) {
      character.ikChains.rightArm.target.copyFrom(offHandPos);
      character.ikChains.rightArm.weight = 1;
    }
  }

  if (!weapon.directPlacement) {
    setWeaponDirection(character, weaponDir);
  }

  const tipWorld = getWeaponTipWorld(character);
  swing.prevTipPos.copyFrom(tipWorld);
  swing.tipSpeed = 0;
  swing.power = 0;
  swing.swinging = false;
}

/**
 * 武器の向きを設定する (2軸アラインメント)。
 */
function setWeaponDirection(character: HavokCharacter, weaponDir: Vector3): void {
  const attach = character.weaponAttachR;
  const parent = attach.parent as TransformNode;
  const weapon = character.weapon;
  if (!parent || !weapon) return;

  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  const rot1 = rotationBetweenVectors(weapon.localTipDir, weaponDir);

  const rotatedGripAxis = weapon.localGripAxis.clone();
  const rot1Conj = rot1.clone(); rot1Conj.invertInPlace();
  const tempQ = rot1.multiply(new Quaternion(rotatedGripAxis.x, rotatedGripAxis.y, rotatedGripAxis.z, 0)).multiply(rot1Conj);
  const rotatedGrip = new Vector3(tempQ.x, tempQ.y, tempQ.z).normalize();

  const palmUpper = PALM_GRIP_POINTS.left_upper;
  const palmLower = PALM_GRIP_POINTS.left_lower;
  const palmAxisLocal = palmUpper.subtract(palmLower).normalize();
  const palmAxisQ = parentWorldRot.multiply(
    new Quaternion(palmAxisLocal.x, palmAxisLocal.y, palmAxisLocal.z, 0),
  ).multiply(parentInv);
  const palmAxisWorld = new Vector3(palmAxisQ.x, palmAxisQ.y, palmAxisQ.z).normalize();

  const projRotated = rotatedGrip.subtract(weaponDir.scale(Vector3.Dot(rotatedGrip, weaponDir))).normalize();
  const projPalm = palmAxisWorld.subtract(weaponDir.scale(Vector3.Dot(palmAxisWorld, weaponDir))).normalize();

  let rot2 = Quaternion.Identity();
  if (projRotated.length() > 0.001 && projPalm.length() > 0.001) {
    rot2 = rotationBetweenVectors(projRotated, projPalm);
  }

  const worldRot = rot2.multiply(rot1);
  attach.rotationQuaternion = parentInv.multiply(worldRot);
}
