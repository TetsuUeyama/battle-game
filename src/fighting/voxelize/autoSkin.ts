/**
 * 自動スキニング: スケルトンの「ボーンカプセル」(head→tail の線分) への距離で
 * 各ボクセルのウェイトを決める。
 *
 * 前提: ボクセルモデルとスケルトンが同一ワールド空間で重なっていること
 * (位置合わせは createVoxelFighter が行う)。ポーズが大きく違うと
 * 腕などのウェイトがずれる — その場合はモデル側を bind pose に近づける。
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";

import type { VoxelSkinWeights } from "./types";

/** ウェイト計算に使うボーン線分 (rest ワールド空間) */
export interface BoneSegment {
  name: string;
  node: TransformNode;
  head: Vector3;
  tail: Vector3;
}

export interface CollectBoneSegmentsOptions {
  /** この正規表現に一致するボーン名は除外する。既定: Root/カメラ系 */
  exclude?: RegExp;
  /** 末端ボーン (子無し) の線分長 (m)。既定 0.06 */
  leafLength?: number;
}

const DEFAULT_EXCLUDE = /^__root__$|^Root$|camerabone/i;

/**
 * CharacterRig 相当 (nodesByName + skeleton) からボーン線分を組み立てる。
 * skeleton があればその bones に名前が載っているノードだけを骨とみなす
 * (GLB に混ざるメッシュ用 TransformNode を弾くため)。
 * 呼ぶ前にスケルトンが rest ポーズ (クリップ未再生) であること。
 */
export function collectBoneSegments(
  rig: {
    nodesByName: ReadonlyMap<string, TransformNode>;
    skeleton?: Skeleton | null;
  },
  opts?: CollectBoneSegmentsOptions,
): BoneSegment[] {
  const exclude = opts?.exclude ?? DEFAULT_EXCLUDE;
  const leafLength = opts?.leafLength ?? 0.06;

  // 骨として扱うノード集合
  const boneNames = new Set<string>();
  if (rig.skeleton && rig.skeleton.bones.length > 0) {
    for (const b of rig.skeleton.bones) {
      if (rig.nodesByName.has(b.name)) boneNames.add(b.name);
    }
  } else {
    for (const name of rig.nodesByName.keys()) boneNames.add(name);
  }

  const boneNodes = new Set<TransformNode>();
  for (const name of boneNames) {
    if (exclude.test(name)) continue;
    boneNodes.add(rig.nodesByName.get(name)!);
  }

  const segments: BoneSegment[] = [];
  for (const node of boneNodes) {
    node.computeWorldMatrix(true);
    const head = node.getAbsolutePosition().clone();

    // 子ボーンの head 平均を tail にする
    const childHeads: Vector3[] = [];
    for (const child of node.getChildren()) {
      if (boneNodes.has(child as TransformNode)) {
        (child as TransformNode).computeWorldMatrix(true);
        childHeads.push((child as TransformNode).getAbsolutePosition());
      }
    }

    let tail: Vector3;
    if (childHeads.length > 0) {
      tail = childHeads
        .reduce((acc, p) => acc.addInPlace(p), new Vector3())
        .scaleInPlace(1 / childHeads.length);
    } else {
      // 末端: 親→自分 の方向へ少し伸ばす
      const parent = node.parent as TransformNode | null;
      const dir =
        parent && boneNodes.has(parent)
          ? head.subtract(parent.getAbsolutePosition()).normalize()
          : new Vector3(0, -1, 0);
      tail = head.add(dir.scaleInPlace(leafLength));
    }

    segments.push({ name: node.name, node, head, tail });
  }
  return segments;
}

export interface ComputeWeightsOptions {
  /** ボクセル 1 個あたりの最大影響ボーン数。既定 4 */
  maxInfluences?: number;
  /** 距離の減衰べき。大きいほど最寄りボーンに集中する。既定 4 */
  falloffPower?: number;
}

/**
 * 各ボクセル中心から全ボーン線分への距離を取り、近い順に最大 N 本へ
 * 1/d^p の正規化ウェイトを割り当てる。
 *
 * @param centers ボクセル中心のワールド座標 (xyz 連続, 長さ = count×3)
 */
export function computeVoxelWeights(
  centers: Float32Array,
  segments: readonly BoneSegment[],
  opts?: ComputeWeightsOptions,
): VoxelSkinWeights {
  const maxInfluences = opts?.maxInfluences ?? 4;
  const power = opts?.falloffPower ?? 4;
  const count = centers.length / 3;
  const nSeg = segments.length;

  // 線分を flat 配列へ (ループ内のプロパティアクセスを減らす)
  const hx = new Float64Array(nSeg), hy = new Float64Array(nSeg), hz = new Float64Array(nSeg);
  const dx = new Float64Array(nSeg), dy = new Float64Array(nSeg), dz = new Float64Array(nSeg);
  const dd = new Float64Array(nSeg);
  for (let s = 0; s < nSeg; s++) {
    const seg = segments[s];
    hx[s] = seg.head.x; hy[s] = seg.head.y; hz[s] = seg.head.z;
    dx[s] = seg.tail.x - seg.head.x;
    dy[s] = seg.tail.y - seg.head.y;
    dz[s] = seg.tail.z - seg.head.z;
    dd[s] = dx[s] * dx[s] + dy[s] * dy[s] + dz[s] * dz[s];
  }

  const boneIndices = new Int32Array(count * maxInfluences).fill(-1);
  const weights = new Float32Array(count * maxInfluences);

  // 上位 N 件の挿入ソート用
  const bestIdx = new Int32Array(maxInfluences);
  const bestDist = new Float64Array(maxInfluences);

  for (let i = 0; i < count; i++) {
    const px = centers[i * 3], py = centers[i * 3 + 1], pz = centers[i * 3 + 2];

    bestIdx.fill(-1);
    bestDist.fill(Infinity);

    for (let s = 0; s < nSeg; s++) {
      // 点-線分距離
      let t = 0;
      if (dd[s] > 1e-12) {
        t =
          ((px - hx[s]) * dx[s] + (py - hy[s]) * dy[s] + (pz - hz[s]) * dz[s]) /
          dd[s];
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }
      const cx = hx[s] + dx[s] * t - px;
      const cy = hy[s] + dy[s] * t - py;
      const cz = hz[s] + dz[s] * t - pz;
      const distSq = cx * cx + cy * cy + cz * cz;

      // 上位 N に挿入
      if (distSq < bestDist[maxInfluences - 1]) {
        let k = maxInfluences - 1;
        while (k > 0 && bestDist[k - 1] > distSq) {
          bestDist[k] = bestDist[k - 1];
          bestIdx[k] = bestIdx[k - 1];
          k--;
        }
        bestDist[k] = distSq;
        bestIdx[k] = s;
      }
    }

    // 1/d^p で正規化
    let sum = 0;
    const raw = new Array<number>(maxInfluences).fill(0);
    for (let k = 0; k < maxInfluences; k++) {
      if (bestIdx[k] < 0) break;
      const d = Math.sqrt(bestDist[k]) + 1e-5;
      raw[k] = 1 / Math.pow(d, power);
      sum += raw[k];
    }
    if (sum <= 0) continue;
    for (let k = 0; k < maxInfluences; k++) {
      if (bestIdx[k] < 0) break;
      boneIndices[i * maxInfluences + k] = bestIdx[k];
      weights[i * maxInfluences + k] = raw[k] / sum;
    }
  }

  return { count, maxInfluences, boneIndices, weights };
}
