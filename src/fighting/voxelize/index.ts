/**
 * voxelize — 任意の三角形メッシュ (FBX 等) をボクセル化し、FAP スケルトンへ
 * 自動バインドして FAP モーションをネイティブ再生させるパイプライン。
 *
 * FBX のパース (three.js FBXLoader) はアプリ層に置く (このモジュールは
 * Babylon のみに依存)。配布物では extras/loadFbx.ts を参照。
 */

export type {
  TriangleMesh,
  VoxelizedModel,
  VoxelSkinWeights,
} from "./types";

export {
  voxelizeTriangleMesh,
  transformTriangleMesh,
  triangleMeshBounds,
  type VoxelizeOptions,
} from "./voxelize";

export {
  collectBoneSegments,
  computeVoxelWeights,
  type BoneSegment,
  type CollectBoneSegmentsOptions,
  type ComputeWeightsOptions,
} from "./autoSkin";

export {
  buildVoxelSkinMesh,
  type SkinnedVoxelMesh,
} from "./buildVoxelSkin";

export {
  createVoxelFighter,
  boneSegmentLines,
  type CreateVoxelFighterOptions,
  type VoxelFighter,
} from "./createVoxelFighter";

export {
  applyPoseFit,
  TPOSE_CHAINS,
  type PoseChain,
} from "./fitPose";

export {
  skeletonFitInfo,
  computeSkeletonFit,
  applyFit,
  fitMeshToSkeleton,
  type SkeletonFitInfo,
  type SkeletonFitTransform,
  type SkeletonFitOptions,
} from "./alignSkeleton";

export {
  applyJointMarkers,
  readJointMarkers,
  snapshotRestPose,
  applyRestPose,
  restorePlaybackPose,
  MARKER_BONES,
  type JointMarkers,
  type RestSnapshot,
  type RestTransform,
} from "./fitMarkers";

export {
  LANDMARKS,
  MIRROR_PAIRS,
  landmarkDefaults,
  mirrorPlaneX,
  mirrorLandmark,
  inferMarkersFromLandmarks,
  type Landmark,
  type LandmarkPositions,
} from "./landmarkRig";
