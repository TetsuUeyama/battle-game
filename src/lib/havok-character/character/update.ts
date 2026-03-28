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
  solveIK2Bone, clampJointAngles,
  updateFootStepping, calculateCenterOfMass, updateDebugVisuals, keepFootHorizontal,
} from './index';
import { updateWeaponPower } from '../weapon';
import { updateJump } from '../actions/jump';

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

  solveIK2Bone(chains.leftLeg, character);
  solveIK2Bone(chains.rightLeg, character);
  solveIK2Bone(chains.leftArm, character);
  solveIK2Bone(chains.rightArm, character);

  clampJointAngles(chains.leftLeg, character, 'leg');
  clampJointAngles(chains.rightLeg, character, 'leg');
  clampJointAngles(chains.leftArm, character, 'arm');
  clampJointAngles(chains.rightArm, character, 'arm');

  keepFootHorizontal(chains.leftLeg.end, character.footBaseWorldRot.left);
  keepFootHorizontal(chains.rightLeg.end, character.footBaseWorldRot.right);

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

  const com = calculateCenterOfMass(character.combatBones);
  const lFoot = getWorldPos(character.combatBones.get('leftFoot')!);
  const rFoot = getWorldPos(character.combatBones.get('rightFoot')!);

  if (character.debug.enabled) {
    updateDebugVisuals(scene, character.debug, com, lFoot, rFoot, character.root.name);
  }
}
