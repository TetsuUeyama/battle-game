/**
 * ボーンリセット。攻撃終了後などに胴体をT-poseに戻す。
 */
import type { HavokCharacter } from '../types';

/** Spine / Spine1 / Spine2 の回転を T-pose にリセットする。 */
export function resetSpine(character: HavokCharacter): void {
  for (const boneName of ['mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2']) {
    const bone = character.allBones.get(boneName);
    if (!bone) continue;
    const baseRot = character.ikBaseRotations.get(bone.name);
    if (baseRot) bone.rotationQuaternion = baseRot.root.clone();
  }
}
