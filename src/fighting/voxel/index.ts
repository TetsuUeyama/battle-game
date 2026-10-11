/**
 * Voxel (MagicaVoxel .vox) ローダー。
 * 第一段階は静止メッシュ表示のみ（スケルトン/スキニングは後続）。
 */
export { parseVox, type VoxModel } from "./parseVox";
export {
  buildVoxelMesh,
  type BuildVoxelOptions,
  type VoxelMeshResult,
} from "./buildVoxelMesh";
export {
  buildAnnaSkeleton,
  type AnnaSkeleton,
  type SkeletonJson,
  type SkeletonBone,
} from "./buildAnnaSkeleton";
export { buildCleanSkeleton } from "./buildCleanSkeleton";
export { ALL_SEGMENTS, arpToSegment } from "./arpSegments";
export {
  buildRiggedVoxelMesh,
  type BoneRegionMap,
  type RiggedVoxelResult,
} from "./buildRiggedVoxel";
export {
  buildSkinnedVoxelMesh,
  type SkinnedVoxelResult,
} from "./buildSkinnedVoxel";
export {
  buildWeightedVoxelMesh,
  type VoxelWeights,
  type WeightedVoxelResult,
} from "./buildWeightedVoxel";
export {
  AnnaMotionPlayer,
  type MotionFile,
  type MotionTrack,
  type FapSkeleton,
  type FapNode,
} from "./AnnaMotionPlayer";
export {
  loadVoxCharacter,
  type VoxCharacter,
  type VoxCharacterPart,
  type LoadVoxCharacterOptions,
} from "./loadVoxCharacter";
