/**
 * キャラクター毎フレーム更新。IK・足ステップ・武器追従・重心・デバッグ表示。
 */
import { Scene, Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { PALM_OFFSET } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from './directions';
import { getOffHandRestPosition } from '../weapon/stance';
import {
  solveIK2Bone, clampJointAngles, clampShoulderX, clampArmRotation, clampSpineRotation,
  updateFootStepping, calculateCenterOfMass, updateDebugVisuals, keepFootHorizontal,
} from './index';
import { updateWeaponPower, updateWristRotation } from '../weapon';
import { updateJump } from '../actions/jump';
import { resolveBodySelfCollision } from './body-collision';
import { maintainJointReadiness } from './joint-readiness';

import { enforceMotionRateLimit } from './motion-rate-limit';
import { resetSpine } from './reset';

export function updateHavokCharacter(scene: Scene, character: HavokCharacter, dt?: number): void {
  const deltaTime = dt ?? (1 / 60);

  updateJump(character, deltaTime);

  if (!character.jumpState.active) {
    character.root.position.y = 0;
  }

  if (!character.jumpState.active) {
    updateFootStepping(character, deltaTime);
  }

  const charDirs = getCharacterDirections(character);
  const chains = character.ikChains;
  if (charDirs) {
    chains.leftLeg.poleHint.copyFrom(charDirs.forward);
    chains.rightLeg.poleHint.copyFrom(charDirs.forward);
    // 肘は前方下向き（背中側に行かない）
    const elbowHint = charDirs.forward.add(new Vector3(0, -0.5, 0)).normalize();
    chains.leftArm.poleHint.copyFrom(elbowHint);
    chains.rightArm.poleHint.copyFrom(elbowHint);
  }

  // 武器手のIKターゲットを背中側に行かせない (スイング中はスキップ: 振りかぶりの頭上位置を阻害しない)
  if (charDirs && character.weapon && chains.rightArm.weight > 0 && !character.weaponSwing.swinging) {
    const spine = character.combatBones.get('torso');
    if (spine) {
      const spinePos = getWorldPos(spine);
      const toTarget = chains.rightArm.target.subtract(spinePos);
      const fwdDot = Vector3.Dot(toTarget, charDirs.forward);
      if (fwdDot < 0) {
        // 背中側 → 前方に押し出す
        chains.rightArm.target.addInPlace(charDirs.forward.scale(-fwdDot + 0.05));
      }
    }
  }

  // IKソルブ → 関節クランプ → 自己貫通チェック → 再IK (3パス)
  for (let pass = 0; pass < 3; pass++) {
    solveIK2Bone(chains.leftLeg, character);
    solveIK2Bone(chains.rightLeg, character);
    solveIK2Bone(chains.leftArm, character);
    solveIK2Bone(chains.rightArm, character);

    clampJointAngles(chains.leftLeg, character, 'leg');
    clampJointAngles(chains.rightLeg, character, 'leg');
    clampJointAngles(chains.leftArm, character, 'arm');
    clampJointAngles(chains.rightArm, character, 'arm');

    // 3軸制限 (Spine → Shoulder → Arm の順: 体幹から末端へ)
    clampSpineRotation(character);
    clampShoulderX(character);
    clampArmRotation(character);

    if (pass === 0) {
      maintainJointReadiness(character, deltaTime);
    }

    // 毎パス: 自己貫通チェック → IKターゲットを押し戻す → 次パスで再解決
    // スイング中はスキップ (振りかぶり・打撃の腕軌道を阻害しない)
    if (pass < 2 && !character.weaponSwing.swinging) {
      resolveBodySelfCollision(character);
    }
  }

  keepFootHorizontal(chains.leftLeg.end, character.footBaseWorldRot.left);
  keepFootHorizontal(chains.rightLeg.end, character.footBaseWorldRot.right);

  // IK 解決後: 手首回転で武器方向を制御 + 慣性追従
  if (character.weapon) {
    updateWristRotation(character, deltaTime);
  }

  // スイング中でなければ体幹を徐々にニュートラルに戻す
  if (!character.weaponSwing.swinging) {
    resetSpine(character);
  }

  updateWeaponPower(character, dt ?? (1 / 60));

  if (character.weapon && character.ikChains.leftArm.weight > 0) {
    if (character.weapon.gripType === 'two-handed') {
      character.weaponAttachR.computeWorldMatrix(true);
      const offLocal = character.weapon.offHandOffset;
      const offWorld = Vector3.TransformCoordinates(offLocal, character.weaponAttachR.getWorldMatrix());
      const offShoulderPos = getWorldPos(character.ikChains.leftArm.root);
      const dir = offWorld.subtract(offShoulderPos).normalize();
      character.ikChains.leftArm.target.copyFrom(offWorld.subtract(dir.scale(PALM_OFFSET)));
    } else {
      const restPos = getOffHandRestPosition(character);
      if (restPos) {
        const current = character.ikChains.leftArm.target;
        Vector3.LerpToRef(current, restPos, Math.min(1, 8 * deltaTime), current);
      }
    }
  }

  // 全モーション適用後: ボーン回転・位置のレート制限
  enforceMotionRateLimit(character, deltaTime);

  const com = calculateCenterOfMass(character.combatBones);
  const lFoot = getWorldPos(character.combatBones.get('leftFoot')!);
  const rFoot = getWorldPos(character.combatBones.get('rightFoot')!);

  if (character.debug.enabled) {
    updateDebugVisuals(scene, character.debug, com, lFoot, rFoot, character.root.name);
  }

}
