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
import { updateWeaponPower } from '../weapon';
import { updateJump } from '../actions/jump';
import { resolveBodySelfCollision } from './body-collision';
import { maintainJointReadiness } from './joint-readiness';
import { resetSpine as resetSpineGradual } from './reset';
import { enforceMotionRateLimit } from './motion-rate-limit';

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
    const backward = charDirs.forward.scale(-1);
    chains.leftArm.poleHint.copyFrom(backward);
    chains.rightArm.poleHint.copyFrom(backward);
  }

  // IKソルブ → 関節クランプ → 関節レディネス → 自己貫通チェック → 再IK (最大2回)
  for (let pass = 0; pass < 2; pass++) {
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
      // 関節レディネス: まっすぐすぎる関節を最小曲げ角まで戻す
      maintainJointReadiness(character, deltaTime);
      // 自己貫通チェック: IKターゲットを押し戻す
      resolveBodySelfCollision(character);
    }
  }

  keepFootHorizontal(chains.leftLeg.end, character.footBaseWorldRot.left);
  keepFootHorizontal(chains.rightLeg.end, character.footBaseWorldRot.right);

  // スイング中でなければ体幹を徐々にT-poseに戻す (重心も復帰)
  if (!character.weaponSwing.swinging) {
    resetSpineGradual(character);
  }

  updateWeaponPower(character, dt ?? (1 / 60));

  if (character.weapon && character.ikChains.rightArm.weight > 0) {
    if (character.weapon.gripType === 'two-handed') {
      character.weaponAttachR.computeWorldMatrix(true);
      const offLocal = character.weapon.offHandOffset;
      const offWorld = Vector3.TransformCoordinates(offLocal, character.weaponAttachR.getWorldMatrix());
      const offShoulderPos = getWorldPos(character.ikChains.rightArm.root);
      const dir = offWorld.subtract(offShoulderPos).normalize();
      character.ikChains.rightArm.target.copyFrom(offWorld.subtract(dir.scale(PALM_OFFSET)));
    } else {
      const restPos = getOffHandRestPosition(character);
      if (restPos) {
        const current = character.ikChains.rightArm.target;
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
