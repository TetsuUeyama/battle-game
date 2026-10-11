/**
 * feature2: pose レイヤー公開 API。
 *
 * ベースアニメの「上」にキャラ個性 (腰の曲げ・腕の角度・注視) を足すための
 * コントローラ群。CharacterRig (または {scene, nodesByName}) を装飾する。
 */

export { PoseLayerController } from "./PoseLayerController";
export type { PoseRigLike } from "./PoseLayerController";

export {
  LookAtController,
  compileSpineBend,
  applyProceduralPose,
} from "./ProceduralPose";
export type {
  LookAtOptions,
  ProceduralPoseResult,
} from "./ProceduralPose";

// 共通契約の再 export (page から型を 1 箇所で引けるように)
export type {
  CharacterRig,
  PoseLayer,
  ProceduralPoseConfig,
} from "../fighting/types";
