/**
 * voxel-pipeline (developsecond/voxel-pipeline) 出力の汎用ローダー。
 *
 * `game-assets/vox-model/<character>/` には
 *   skeleton.json            ARP ボーン (head_rest, QM rig 共通)
 *   grid.json                共通グリッド (voxel_size / grid_origin)
 *   <part>.vox               パーツの表面ボクセル (MagicaVoxel)
 *   <part>_c<N>.vox          軸 256 セル超のパーツの空間分割チャンク
 *   <part>.grid.json         パーツ専用グリッド (sub-grid / chunks 配列)
 *   <part>.weights.json      per-voxel 実ウェイト (ARP 名, 最大4本)
 * が入っている。
 *
 * ★weights の並び順は「グローバル格子座標 (x,y,z) の辞書順ソート」
 * (voxelize.py: voxel_order = sorted(result_voxels.keys()))。チャンク分割は
 * この列を空間バケットへ分配したものなので、**全チャンクを読み戻して
 * グローバル座標で再ソートすれば weights と厳密に整列する**。
 *
 * ボクセル解像度・ウェイトは Blender パイプライン (resolution 250 + 実スキン
 * ウェイト) 由来なので、ブラウザ内の簡易ボクセル化 (voxelize/) より高品質。
 * ソースモデルのポーズは任意 (実ウェイトなのでポーズ依存の崩れがない)。
 */

import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { parseVox } from "./parseVox";
import { buildCleanSkeleton } from "./buildCleanSkeleton";
import type { AnnaSkeleton, SkeletonJson } from "./buildAnnaSkeleton";
import {
  buildWeightedVoxelMesh,
  type VoxelWeights,
  type WeightedVoxelResult,
} from "./buildWeightedVoxel";
import type { BoneRegionMap } from "./buildRiggedVoxel";
import { SEGMENT_PARENT, SEGMENT_REP } from "./arpSegments";
import {
  computeVoxelWeights,
  type BoneSegment,
} from "../voxelize/autoSkin";

/** grid.json / <part>.grid.json */
interface GridJson {
  voxel_size: number;
  grid_origin: [number, number, number];
  gx: number;
  gy: number;
  gz: number;
  /** 256 セル超で分割された場合のチャンク一覧 */
  chunks?: {
    vox_file: string;
    grid_origin: [number, number, number];
    gx: number;
    gy: number;
    gz: number;
    voxel_count: number;
  }[];
}

export interface VoxCharacterPart {
  part: string;
  result: WeightedVoxelResult;
}

export interface VoxCharacter {
  skeleton: AnnaSkeleton;
  parts: VoxCharacterPart[];
  bounds: { maxY: number };
  stats: { rendered: number; total: number; unbound: number };
  dispose: () => void;
}

export interface LoadVoxCharacterOptions {
  /** 例 "/vox-model/blackwidow" */
  baseUrl: string;
  /** ロードするパーツ prefix (例 ["body", "bw_suit"]) */
  parts: string[];
  /** パーツ単位の進捗 */
  onProgress?: (loaded: number, total: number, part: string) => void;
}

export async function loadVoxCharacter(
  scene: Scene,
  opts: LoadVoxCharacterOptions,
): Promise<VoxCharacter> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  if (opts.parts.length === 0) {
    throw new Error("parts が空です");
  }

  const skelJson = await fetchJson<SkeletonJson>(`${base}/skeleton.json`);
  const skeleton = buildCleanSkeleton(scene, skelJson);
  const sharedGrid = await tryFetchJson<GridJson>(`${base}/grid.json`);

  const parts: VoxCharacterPart[] = [];
  let rendered = 0;
  let total = 0;
  let unbound = 0;
  let maxY = 0;
  let loaded = 0;

  try {
    for (const part of opts.parts) {
      const grid =
        (await tryFetchJson<GridJson>(`${base}/${part}.grid.json`)) ??
        sharedGrid;
      if (!grid) {
        throw new Error(`${part}: grid.json が見つかりません`);
      }

      const [model, storedWeights] = await Promise.all([
        loadPartVoxels(base, part, grid),
        fetchJson<VoxelWeights>(`${base}/${part}.weights.json`),
      ]);

      // ★既知のデータ問題: チャンク分割パーツ (body 等) の weights.json は
      // voxel-pipeline 側のバグでボクセル順と対応していないことがある
      // (helena/blackwidow の body で実測: 最近傍ボーン一致率 ~10-20%。
      //  正常な単一ファイルパーツは ~90%)。整列検査して、壊れていれば
      // ボーンカプセル距離の自動ウェイトへフォールバックする。
      let weights = storedWeights;
      const rate = weightsAlignmentRate(model, storedWeights, grid, skelJson);
      if (rate < 0.45) {
        console.warn(
          `[loadVoxCharacter] ${part}: weights.json がボクセル順と不整合 ` +
            `(最近傍ボーン一致率 ${(rate * 100).toFixed(0)}%)。` +
            `距離ベースの自動ウェイトへフォールバックします`,
        );
        weights = computeFallbackWeights(model, grid, skeleton);
      }

      const result = buildWeightedVoxelMesh(scene, model, weights, skeleton, {
        grid,
      });
      parts.push({ part, result });
      rendered += result.rendered;
      total += result.total;
      unbound += result.unbound;
      maxY = Math.max(maxY, result.bounds.maxY);

      loaded++;
      opts.onProgress?.(loaded, opts.parts.length, part);
    }
  } catch (e) {
    for (const p of parts) p.result.dispose();
    skeleton.root.dispose();
    throw e;
  }

  return {
    skeleton,
    parts,
    bounds: { maxY },
    stats: { rendered, total, unbound },
    dispose: () => {
      for (const p of parts) p.result.dispose();
      skeleton.root.dispose();
    },
  };
}

/**
 * パーツのボクセルを (単一 .vox / チャンク群) からロードし、
 * グローバル格子座標へ統合 + 辞書順ソートして weights と整列させる。
 */
async function loadPartVoxels(
  base: string,
  part: string,
  grid: GridJson,
): Promise<{
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  count: number;
  xs: Uint16Array;
  ys: Uint16Array;
  zs: Uint16Array;
  cs: Uint8Array;
  palette: Uint8Array;
}> {
  // チャンクファイルとグローバル座標オフセットの一覧
  const sources: { url: string; ox: number; oy: number; oz: number }[] =
    grid.chunks && grid.chunks.length > 0
      ? grid.chunks.map((c) => ({
          url: `${base}/${c.vox_file}`,
          ox: Math.round((c.grid_origin[0] - grid.grid_origin[0]) / grid.voxel_size),
          oy: Math.round((c.grid_origin[1] - grid.grid_origin[1]) / grid.voxel_size),
          oz: Math.round((c.grid_origin[2] - grid.grid_origin[2]) / grid.voxel_size),
        }))
      : [{ url: `${base}/${part}.vox`, ox: 0, oy: 0, oz: 0 }];

  const models = await Promise.all(
    sources.map(async (s) => ({
      ...s,
      vox: parseVox(await fetchBuf(s.url)),
    })),
  );

  const count = models.reduce((n, m) => n + m.vox.count, 0);
  const xs = new Uint16Array(count);
  const ys = new Uint16Array(count);
  const zs = new Uint16Array(count);
  const cs = new Uint8Array(count);
  let w = 0;
  for (const m of models) {
    const { vox } = m;
    for (let i = 0; i < vox.count; i++) {
      xs[w] = vox.xs[i] + m.ox;
      ys[w] = vox.ys[i] + m.oy;
      zs[w] = vox.zs[i] + m.oz;
      cs[w] = vox.cs[i];
      w++;
    }
  }

  // weights の並び (グローバル (x,y,z) 辞書順) に合わせて再ソート
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => {
    const dx = xs[a] - xs[b];
    if (dx !== 0) return dx;
    const dy = ys[a] - ys[b];
    if (dy !== 0) return dy;
    return zs[a] - zs[b];
  });

  const sx = new Uint16Array(count);
  const sy = new Uint16Array(count);
  const sz = new Uint16Array(count);
  const sc = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const j = sorted[i];
    sx[i] = xs[j];
    sy[i] = ys[j];
    sz[i] = zs[j];
    sc[i] = cs[j];
  }

  return {
    sizeX: grid.gx,
    sizeY: grid.gy,
    sizeZ: grid.gz,
    count,
    xs: sx,
    ys: sy,
    zs: sz,
    cs: sc,
    palette: models[0].vox.palette,
  };
}

/** ロード済みパーツのボクセル集合 (グローバル格子座標) */
interface MergedVoxels {
  count: number;
  xs: Uint16Array;
  ys: Uint16Array;
  zs: Uint16Array;
}

/**
 * weights.json がボクセル順と対応しているかのサンプル検査。
 * 各サンプルボクセルの「最近傍ボーン (weights.bones 内)」がそのボクセルの
 * weight リストに含まれる率を返す。整列していれば ~0.9、壊れていると ~0.1-0.2。
 */
function weightsAlignmentRate(
  model: MergedVoxels,
  weights: VoxelWeights,
  grid: { voxel_size: number; grid_origin: [number, number, number] },
  skelJson: SkeletonJson,
): number {
  const heads: (readonly [number, number, number] | null)[] = [];
  const headByName = new Map<string, [number, number, number]>();
  for (const b of skelJson.bones) headByName.set(b.name, b.head_rest);
  for (const name of weights.bones) heads.push(headByName.get(name) ?? null);

  const vs = grid.voxel_size;
  const go = grid.grid_origin;
  let hit = 0;
  let n = 0;
  const samples = 2000;
  const step = Math.max(1, Math.floor(model.count / samples));
  for (let i = 0; i < model.count; i += step) {
    const wl = weights.weights[i];
    if (!wl || wl.length === 0) continue;
    const wx = go[0] + (model.xs[i] + 0.5) * vs;
    const wy = go[1] + (model.ys[i] + 0.5) * vs;
    const wz = go[2] + (model.zs[i] + 0.5) * vs;
    let bestK = -1;
    let bestD = Infinity;
    for (let k = 0; k < heads.length; k++) {
      const h = heads[k];
      if (!h) continue;
      const dx = wx - h[0];
      const dy = wy - h[1];
      const dz = wz - h[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestK = k;
      }
    }
    if (bestK >= 0 && wl.some((e) => e[0] === bestK)) hit++;
    n++;
  }
  return n > 0 ? hit / n : 0;
}

/**
 * フォールバック: clean スケルトンのセグメントをボーンカプセルとして
 * 距離ウェイトを計算し、VoxelWeights 形式 (ARP rep 名) で返す。
 * 実ウェイトより品質は落ちるが、任意ポーズ/任意キャラで破綻しない。
 */
function computeFallbackWeights(
  model: MergedVoxels,
  grid: { voxel_size: number; grid_origin: [number, number, number] },
  skeleton: AnnaSkeleton,
): VoxelWeights {
  // セグメント → カプセル (head = restWorld, tail = 子セグメント平均)
  const children = new Map<string, string[]>();
  for (const [seg, parent] of Object.entries(SEGMENT_PARENT)) {
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(seg);
    children.set(parent, list);
  }
  const segments: BoneSegment[] = [];
  const segNames: string[] = [];
  for (const seg of Object.keys(SEGMENT_PARENT)) {
    const node = skeleton.nodesByName.get(seg);
    const head = skeleton.restWorld.get(seg);
    if (!node || !head) continue;
    const kids = (children.get(seg) ?? [])
      .map((c) => skeleton.restWorld.get(c))
      .filter((p): p is Vector3 => !!p);
    let tail: Vector3;
    if (kids.length > 0) {
      tail = kids
        .reduce((acc, p) => acc.addInPlace(p), new Vector3())
        .scaleInPlace(1 / kids.length);
    } else {
      const parent = SEGMENT_PARENT[seg];
      const ph = parent ? skeleton.restWorld.get(parent) : null;
      const dir = ph ? head.subtract(ph).normalize() : new Vector3(0, -1, 0);
      tail = head.add(dir.scaleInPlace(0.05));
    }
    segments.push({ name: seg, node, head: head.clone(), tail });
    segNames.push(seg);
  }

  // ボクセル中心 (Babylon 座標: Blender Z-up → (x, z, y))
  const vs = grid.voxel_size;
  const go = grid.grid_origin;
  const centers = new Float32Array(model.count * 3);
  for (let i = 0; i < model.count; i++) {
    centers[i * 3] = go[0] + (model.xs[i] + 0.5) * vs;
    centers[i * 3 + 1] = go[2] + (model.zs[i] + 0.5) * vs;
    centers[i * 3 + 2] = go[1] + (model.ys[i] + 0.5) * vs;
  }
  const skin = computeVoxelWeights(centers, segments, {
    maxInfluences: 4,
    falloffPower: 4,
  });

  // VoxelWeights 形式へ (bones はセグメントの ARP rep 名 → arpToSegment で戻る)
  const bones = segNames.map((s) => SEGMENT_REP[s]);
  const weights: [number, number][][] = new Array(model.count);
  for (let i = 0; i < model.count; i++) {
    const list: [number, number][] = [];
    for (let k = 0; k < skin.maxInfluences; k++) {
      const u = skin.boneIndices[i * skin.maxInfluences + k];
      if (u < 0) continue;
      list.push([u, skin.weights[i * skin.maxInfluences + k]]);
    }
    weights[i] = list;
  }
  return { bones, weights };
}

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function tryFetchJson<T>(url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return null;
  }
}

// BoneRegionMap は buildWeightedVoxelMesh の grid 部分型として参照するだけ
export type { BoneRegionMap };
