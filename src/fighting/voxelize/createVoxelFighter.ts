/**
 * オーケストレータ: 三角形メッシュ (FBX 等から抽出済み) をボクセル化し、
 * Maskman GLB のスケルトンへ自動バインドして「FAP モーションがそのまま動く
 * ボクセルファイター」を作る。
 *
 * 骨は FAP スケルトンをそのまま使う (モデル側の骨は見ない) ので、
 * リターゲット変換が無く、anna で確定した rest 幾何不一致による
 * 関節崩れが構造的に発生しない。
 *
 * 品質を決めるのは「メッシュのポーズが Maskman の bind pose にどれだけ
 * 近いか」(自動ウェイトの精度)。yaw / scale / offsetY で位置合わせを調整できる。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

import type { CharacterRig } from "../fighting/types";
import {
  loadFightingCharacter,
  type LoadFightingCharacterOptions,
  type FightingCharacter,
} from "../retarget/loadFightingCharacter";
import type { RetargetResult } from "../retarget/retarget";
import type { TriangleMesh } from "./types";
import { voxelizeTriangleMesh } from "./voxelize";
import { skeletonFitInfo, computeSkeletonFit, applyFit } from "./alignSkeleton";
import {
  collectBoneSegments,
  computeVoxelWeights,
  type BoneSegment,
  type CollectBoneSegmentsOptions,
  type ComputeWeightsOptions,
} from "./autoSkin";
import { buildVoxelSkinMesh, type SkinnedVoxelMesh } from "./buildVoxelSkin";
import { applyPoseFit, TPOSE_CHAINS, type PoseChain } from "./fitPose";
import {
  applyJointMarkers,
  snapshotRestPose,
  applyRestPose,
  restorePlaybackPose,
  type JointMarkers,
} from "./fitMarkers";

export interface CreateVoxelFighterOptions
  extends Omit<LoadFightingCharacterOptions, "onProgress">,
    ComputeWeightsOptions,
    CollectBoneSegmentsOptions {
  /** ボクセル化する三角形メッシュ (FBX から抽出したもの等) */
  triangles: TriangleMesh;
  /** ボクセル解像度 (最長軸セル数)。既定 64 */
  resolution?: number;
  /**
   * バインド用ポーズフィット。"tpose" でスケルトンの腕/脚を世界軸へ整列させて
   * から束縛する (T ポーズのモデル用)。モデルが Maskman と同じ構えなら "none"。
   * 既定 "none"。
   */
  fitPose?: "none" | "tpose";
  /** fitPose のチェーン定義を差し替える (既定 TPOSE_CHAINS) */
  fitChains?: readonly PoseChain[];
  /**
   * 関節マーカー (ボーン名 → ワールド座標)。fitPose の後に適用され、
   * 主要関節をモデルの実際の関節位置へ移動して束縛する。
   * 指定時は自動で position トラックを Root/Hips 以外捨て、骨長を保つ
   * (retargetOptions を明示すればそちらを優先)。
   * バインド後は再生ポーズへ正規化される (restorePlaybackPose): マーカーから
   * 引き継がれるのは骨長のみで、骨方向は元 rest に戻るためモーションは
   * Maskman と一致する。
   */
  markers?: JointMarkers;
  /** メッシュのヨー回転 (度)。向きが合わないとき 90/180 等 */
  yawDeg?: number;
  /** 自動フィットへの追加倍率。既定 1 (= スケルトン身長にフィット) */
  scale?: number;
  /** 接地後の上下オフセット (m) */
  offsetY?: number;
  onProgress?: LoadFightingCharacterOptions["onProgress"];
}

export interface VoxelFighter {
  /** combat / pose / emotion がそのまま使える共通契約 (meshes はボクセル) */
  rig: CharacterRig;
  voxel: SkinnedVoxelMesh;
  segments: BoneSegment[];
  retargetStats: RetargetResult[];
  /**
   * 全ボーンを再生 rest (正規化後: 回転 = 元 rest / 骨長 = マーカー後) へ戻す。
   * AnimationGroup.stop() は最後のポーズで凍結するだけなので、
   * rest 表示の前にはこれを呼ぶ。バインドポーズ (fit/markers 適用後の姿勢)
   * ではない点に注意 — バインドポーズは invRest に焼かれて役目を終えている。
   */
  resetPose: () => void;
  /** 位置合わせ後のボクセル数など */
  stats: {
    voxels: number;
    bones: number;
    /** メッシュへ適用した最終スケール */
    appliedScale: number;
  };
  dispose: () => void;
}

export async function createVoxelFighter(
  scene: Scene,
  opts: CreateVoxelFighterOptions,
): Promise<VoxelFighter> {
  // 1) スケルトン + クリップの供給源 (Maskman GLB)。メッシュは隠す。
  //    マーカーで骨長を変える場合は position トラックを Root/Hips 以外捨て、
  //    再生時もマーカーのプロポーションを保つ。
  const retargetOptions =
    opts.retargetOptions ??
    (opts.markers ? { keepPositionFor: /^(Root|Hips)$/ } : undefined);
  const fc: FightingCharacter = await loadFightingCharacter(scene, {
    modelGlbPath: opts.modelGlbPath,
    animGlbPaths: opts.animGlbPaths,
    preloadedAnimations: opts.preloadedAnimations,
    binding: opts.binding,
    retargetOptions,
    baseUrl: opts.baseUrl,
    onProgress: opts.onProgress,
  });
  for (const m of fc.rig.meshes) m.setEnabled(false);

  // 1.5) 元 rest のローカル変換を控える。fitPose / markers は「ウェイト計算と
  //      invRest 焼き込みのためのバインド専用ポーズ」であり、クリップの回転
  //      カーブは元 rest のローカルオフセット方向を前提とするため、バインド後に
  //      restorePlaybackPose でこの元値基準へ正規化する (下の手順 5)。
  fc.rig.root.computeWorldMatrix(true);
  const origRest = snapshotRestPose(fc.rig);

  // 2) バインド用ポーズフィット (T ポーズモデル向け)。
  //    フィット後の姿勢が invRest に焼かれるので、クリップ再生時は
  //    各ボーンが絶対回転で上書きされて正しい FAP ポーズへ変形する。
  if (opts.fitPose === "tpose") {
    applyPoseFit(fc.rig, opts.fitChains ?? TPOSE_CHAINS);
  }

  // 3) メッシュをスケルトンへ位置合わせ:
  //    yaw 回転 → 身長フィット (＋ユーザ倍率) → XZ は Hips、足元は sMinY へ。
  //    ★マーカー適用の「前」(fitPose 後) のスケルトンで fitInfo を取る。
  //    こうするとマーカーは「位置合わせ済みメッシュへスケルトン関節を寄せる」
  //    だけになり、マーカーでメッシュ位置が再シフトしない (SkinEdit のプレビューと一致)。
  //    算出は alignSkeleton に集約 (SkinEdit の位置合わせプレビューと同一数式)。
  const preMarkerSegments = collectBoneSegments(fc.rig, {
    exclude: opts.exclude,
    leafLength: opts.leafLength,
  });
  if (preMarkerSegments.length === 0) {
    throw new Error("ボーンが見つかりません (skeleton が空?)");
  }
  const fitInfo = skeletonFitInfo(preMarkerSegments);
  const fit = computeSkeletonFit(opts.triangles, fitInfo, {
    yawDeg: opts.yawDeg,
    scale: opts.scale,
    offsetY: opts.offsetY,
  });
  const appliedScale = fit.appliedScale;
  const fitted = applyFit(opts.triangles, fit);

  //    関節マーカー (手動指定) — 位置合わせ済みメッシュへ主要関節を移動
  if (opts.markers) {
    applyJointMarkers(fc.rig, opts.markers);
  }

  //    ウェイト計算用のボーン線分 (マーカー適用後・クリップ未再生の今が rest)。
  //    マーカーで動いた関節位置を反映するため、束縛用 segments は markers 後に取る。
  const segments = opts.markers
    ? collectBoneSegments(fc.rig, {
        exclude: opts.exclude,
        leafLength: opts.leafLength,
      })
    : preMarkerSegments;

  // 4) ボクセル化 → 自動ウェイト → スキン描画
  const model = voxelizeTriangleMesh(fitted, { resolution: opts.resolution });
  if (model.count === 0) {
    throw new Error("ボクセル化結果が空です (メッシュが不正?)");
  }

  const centers = new Float32Array(model.count * 3);
  for (let i = 0; i < model.count; i++) {
    centers[i * 3] = model.origin[0] + (model.xs[i] + 0.5) * model.voxelSize;
    centers[i * 3 + 1] = model.origin[1] + (model.ys[i] + 0.5) * model.voxelSize;
    centers[i * 3 + 2] = model.origin[2] + (model.zs[i] + 0.5) * model.voxelSize;
  }
  const weights = computeVoxelWeights(centers, segments, {
    maxInfluences: opts.maxInfluences,
    falloffPower: opts.falloffPower,
  });
  const voxel = buildVoxelSkinMesh(scene, model, weights, segments);

  // 5) 再生ポーズ正規化: バインドポーズ (fitPose/markers) は invRest に焼いた
  //    時点で役目を終える。クリップの回転カーブは元 rest の骨方向を前提とする
  //    ため、マーカー姿勢のまま再生すると全モーションが (取込ポーズ − rest) 分
  //    恒常的にずれる。回転・スケールを元 rest へ戻し、位置は「元の方向 ×
  //    マーカー後の長さ」で骨長 (プロポーション) だけ引き継ぐ。メッシュは
  //    invRest 経由のスキニングでこの姿勢へ再ポーズされる (= ポーズの統一)。
  restorePlaybackPose(origRest);
  fc.rig.root.computeWorldMatrix(true);

  //    正規化後の姿勢を rest として控える (resetPose 用)
  const restPose = snapshotRestPose(fc.rig);
  const resetPose = (): void => {
    applyRestPose(restPose);
    fc.rig.root.computeWorldMatrix(true);
  };

  // 6) CharacterRig: メッシュをボクセルへ差し替え (clips/nodes はそのまま)
  const rig: CharacterRig = {
    ...fc.rig,
    meshes: [voxel.mesh],
  };

  return {
    rig,
    voxel,
    segments,
    retargetStats: fc.retargetStats,
    resetPose,
    stats: {
      voxels: model.count,
      bones: segments.length,
      appliedScale,
    },
    dispose: () => {
      voxel.dispose();
      for (const g of fc.rig.clips.values()) g.dispose();
      for (const m of fc.rig.meshes) m.dispose();
      fc.rig.root.dispose();
    },
  };
}

/** デバッグ用: ボーン線分の頂点ペア (Line 描画用) を返す */
export function boneSegmentLines(
  segments: readonly BoneSegment[],
): Vector3[][] {
  return segments.map((s) => [s.head.clone(), s.tail.clone()]);
}
