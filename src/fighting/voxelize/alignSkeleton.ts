/**
 * メッシュをスケルトンへ位置合わせする変換の算出。
 *
 * createVoxelFighter の「ステップ 3 (yaw → 身長フィット → 接地)」をここに切り出し、
 * **位置合わせプレビュー (SkinEdit のステップ3) と最終ボクセル化が完全に同じ数式**
 * を共有できるようにする。プレビューでズレが無いまま確定できる。
 *
 * - skeletonFitInfo(segments): スケルトン側の不変量 (身長/接地Y/Hips XZ)
 * - computeSkeletonFit(tris, info, opts): メッシュ → スケルトンの変換 (yaw/scale/translate)
 * - applyFit(tris, fit): 変換を焼いた新しい TriangleMesh
 * - fitMeshToSkeleton(tris, info, opts): 上記 2 つの合成 (= 旧 createVoxelFighter 相当)
 */

import type { BoneSegment } from "./autoSkin";
import type { TriangleMesh } from "./types";
import { transformTriangleMesh } from "./voxelize";

/** スケルトン側の位置合わせ基準 (rest/fitPose 適用後の segments から算出) */
export interface SkeletonFitInfo {
  /** スケルトン全体の高さ (head/tail の Y 範囲) */
  skelHeight: number;
  /** 足元の最小 Y (接地基準) */
  sMinY: number;
  /** Hips (無ければ先頭ボーン) の head X/Z (水平配置基準) */
  hipsX: number;
  hipsZ: number;
}

/** メッシュ → スケルトンの位置合わせ変換 */
export interface SkeletonFitTransform {
  yawRad: number;
  /** メッシュに適用する一様スケール (身長フィット × ユーザ倍率) */
  appliedScale: number;
  /** スケール・回転後の平行移動 */
  translate: [number, number, number];
}

export interface SkeletonFitOptions {
  /** メッシュのヨー回転 (度)。既定 0 */
  yawDeg?: number;
  /** 身長フィットへの追加倍率。既定 1 */
  scale?: number;
  /** 接地後の上下オフセット (m)。既定 0 */
  offsetY?: number;
}

/** segments (rest/fitPose 適用済み) からスケルトン側の不変量を求める */
export function skeletonFitInfo(segments: readonly BoneSegment[]): SkeletonFitInfo {
  if (segments.length === 0) {
    throw new Error("skeletonFitInfo: segments が空です");
  }
  const hipsLike =
    segments.find((s) => /hips|pelvis/i.test(s.name)) ?? segments[0];
  let sMinY = Infinity;
  let sMaxY = -Infinity;
  for (const s of segments) {
    sMinY = Math.min(sMinY, s.head.y, s.tail.y);
    sMaxY = Math.max(sMaxY, s.head.y, s.tail.y);
  }
  return {
    skelHeight: Math.max(1e-3, sMaxY - sMinY),
    sMinY,
    hipsX: hipsLike.head.x,
    hipsZ: hipsLike.head.z,
  };
}

/**
 * メッシュをスケルトンへ合わせる変換を求める (メッシュは焼かない)。
 * 一様スケールなので Babylon の TransformNode (scaling=appliedScale,
 * rotation.y=yawRad, position=translate) でそのまま再現でき、プレビューの
 * ノード変換と applyFit の頂点焼きが一致する。
 */
export function computeSkeletonFit(
  triangles: TriangleMesh,
  info: SkeletonFitInfo,
  opts?: SkeletonFitOptions,
): SkeletonFitTransform {
  const yawRad = ((opts?.yawDeg ?? 0) * Math.PI) / 180;

  // yaw 適用後の AABB をアロケーション無しで求める
  const cosY = Math.cos(yawRad);
  const sinY = Math.sin(yawRad);
  const p = triangles.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const rx = p[i] * cosY + p[i + 2] * sinY;
    const y = p[i + 1];
    const rz = -p[i] * sinY + p[i + 2] * cosY;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (rz < minZ) minZ = rz;
    if (rz > maxZ) maxZ = rz;
  }

  const meshHeight = Math.max(1e-6, maxY - minY);
  const appliedScale = (info.skelHeight / meshHeight) * (opts?.scale ?? 1);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  return {
    yawRad,
    appliedScale,
    translate: [
      info.hipsX - cx * appliedScale,
      info.sMinY - minY * appliedScale + (opts?.offsetY ?? 0),
      info.hipsZ - cz * appliedScale,
    ],
  };
}

/** computeSkeletonFit の変換を頂点に焼いた新しい TriangleMesh を返す */
export function applyFit(
  triangles: TriangleMesh,
  fit: SkeletonFitTransform,
): TriangleMesh {
  const rotated = transformTriangleMesh(triangles, { yawRad: fit.yawRad });
  return transformTriangleMesh(rotated, {
    scale: fit.appliedScale,
    translate: fit.translate,
  });
}

/** メッシュをスケルトンへ位置合わせした新しい TriangleMesh を返す (合成版) */
export function fitMeshToSkeleton(
  triangles: TriangleMesh,
  info: SkeletonFitInfo,
  opts?: SkeletonFitOptions,
): { mesh: TriangleMesh; fit: SkeletonFitTransform } {
  const fit = computeSkeletonFit(triangles, info, opts);
  return { mesh: applyFit(triangles, fit), fit };
}
