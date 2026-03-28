/**
 * ボーンスケーリング。キャラクターの全ボーンを均一にスケールする。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { _baseBonePositions } from './create';

function ensureBasePositions(character: HavokCharacter): Map<string, Vector3> {
  const key = character.root.name;
  if (!_baseBonePositions.has(key)) {
    const base = new Map<string, Vector3>();
    for (const [name, bone] of character.allBones) {
      base.set(name, bone.position.clone());
    }
    _baseBonePositions.set(key, base);
  }
  return _baseBonePositions.get(key)!;
}

export function scaleBones(character: HavokCharacter, factor: number): void {
  const base = ensureBasePositions(character);
  for (const [name, bone] of character.allBones) {
    const basePos = base.get(name);
    if (basePos) {
      bone.position.set(basePos.x * factor, basePos.y * factor, basePos.z * factor);
    }
  }

  const initFY = character.initialFootY;
  const chains = character.ikChains;
  const fp = character.footPlant;

  character.root.computeWorldMatrix(true);
  for (const bone of character.allBones.values()) bone.computeWorldMatrix(true);

  const lFoot = chains.leftLeg.end.getAbsolutePosition().clone();
  const rFoot = chains.rightLeg.end.getAbsolutePosition().clone();

  fp.leftLocked = new Vector3(lFoot.x, initFY.left * factor, lFoot.z);
  fp.rightLocked = new Vector3(rFoot.x, initFY.right * factor, rFoot.z);
  chains.leftLeg.target.copyFrom(fp.leftLocked);
  chains.rightLeg.target.copyFrom(fp.rightLocked);

  for (const chain of [chains.leftLeg, chains.rightLeg, chains.leftArm, chains.rightArm]) {
    chain.root.computeWorldMatrix(true);
    chain.mid.computeWorldMatrix(true);
    chain.end.computeWorldMatrix(true);
    chain.lengthA = Vector3.Distance(chain.root.getAbsolutePosition().clone(), chain.mid.getAbsolutePosition().clone());
    chain.lengthB = Vector3.Distance(chain.mid.getAbsolutePosition().clone(), chain.end.getAbsolutePosition().clone());
  }
}
