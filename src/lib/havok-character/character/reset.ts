/**
 * ボーンリセット。攻撃終了後などに胴体をT-poseに戻す。
 */
import type { HavokCharacter } from '../types';

/** 胴体回転を T-pose にリセットする。 */
export function resetSpine(character: HavokCharacter): void {
  const spine = character.allBones.get('mixamorig:Spine1');
  if (spine) {
    const baseRot = character.ikBaseRotations.get(spine.name);
    if (baseRot) spine.rotationQuaternion = baseRot.root.clone();
  }
}
