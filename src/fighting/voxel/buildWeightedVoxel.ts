import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { AnnaSkeleton } from "./buildAnnaSkeleton";
import type { BoneRegionMap } from "./buildRiggedVoxel";
import { arpToSegment } from "./arpSegments";

/** body_clean.weights.json */
export interface VoxelWeights {
  bones: string[];
  /** voxel ごとの [[boneIndex, weight], ...]（最大4） */
  weights: [number, number][][];
}

/**
 * VoxModel 互換の構造的入力。
 * 256 セル超のチャンク統合 (loadVoxCharacter) は座標が 1 byte に収まらないため
 * Uint16Array で来る。インデックスアクセスしかしないので ArrayLike で受ける。
 */
export interface SkinVoxLike {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  count: number;
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  zs: ArrayLike<number>;
  cs: ArrayLike<number>;
  palette: ArrayLike<number>;
}

export interface WeightedVoxelResult {
  mesh: Mesh;
  rendered: number;
  total: number;
  bounds: { maxY: number };
  /** 荷重がボーンに解決できなかったボクセル数（参考） */
  unbound: number;
  dispose: () => void;
}

const MAX_INF = 4;

/**
 * 本物の per-voxel 荷重（最大4ボーン）で CPU リニアブレンドスキニング。
 * 関節は複数ボーンの加重で連続変形し、指も指ボーンに紐づくので動く。
 * （ボクセル順は weights と一致している前提：body_clean.vox ↔ body_clean.weights.json）
 */
export function buildWeightedVoxelMesh(
  scene: Scene,
  skinVox: SkinVoxLike,
  weights: VoxelWeights,
  skeleton: AnnaSkeleton,
  // grid (voxel_size / grid_origin) しか使わないため部分型を受ける
  // (anna は bone_region_map.json、voxel-pipeline 出力は grid.json を渡す)
  brm: Pick<BoneRegionMap, "grid">,
): WeightedVoxelResult {
  const vs = brm.grid.voxel_size;
  const go = brm.grid.grid_origin;

  // 表面判定
  const { sizeX, sizeY, sizeZ, xs, ys, zs, count } = skinVox;
  const gi = (x: number, y: number, z: number) => x + sizeX * (y + sizeY * z);
  const occ = new Uint8Array(sizeX * sizeY * sizeZ);
  for (let i = 0; i < count; i++) occ[gi(xs[i], ys[i], zs[i])] = 1;
  const filled = (x: number, y: number, z: number) =>
    x >= 0 && y >= 0 && z >= 0 && x < sizeX && y < sizeY && z < sizeZ && occ[gi(x, y, z)] === 1;
  const isSurface = (x: number, y: number, z: number) =>
    !filled(x - 1, y, z) || !filled(x + 1, y, z) ||
    !filled(x, y - 1, z) || !filled(x, y + 1, z) ||
    !filled(x, y, z - 1) || !filled(x, y, z + 1);

  // 使用セグメント(=clean スケルトンのノード)のユニーク化
  // ARP ボーンは arpToSegment で標準セグメントへ集約する
  const usedBones: TransformNode[] = [];
  const usedHeads: Vector3[] = [];
  const segCache = new Map<string, number>(); // segment 名 → usedBones idx
  const arpIdxToUsed = new Map<number, number>(); // weights.bones idx → usedBones idx
  const useBone = (weightBoneIdx: number): number => {
    let u = arpIdxToUsed.get(weightBoneIdx);
    if (u !== undefined) return u;
    const seg = arpToSegment(weights.bones[weightBoneIdx]);
    if (!seg || !skeleton.nodesByName.has(seg)) {
      arpIdxToUsed.set(weightBoneIdx, -1);
      return -1;
    }
    let su = segCache.get(seg);
    if (su === undefined) {
      su = usedBones.length;
      usedBones.push(skeleton.nodesByName.get(seg)!);
      usedHeads.push(skeleton.restWorld.get(seg)!);
      segCache.set(seg, su);
    }
    arpIdxToUsed.set(weightBoneIdx, su);
    return su;
  };

  const bIdx: number[] = [];
  const wArr: number[] = [];
  const local: number[] = [];
  const dom: number[] = [];
  const colors: number[] = [];
  let maxY = 0;
  let unbound = 0;

  for (let i = 0; i < count; i++) {
    const x = xs[i], y = ys[i], z = zs[i];
    if (!isSurface(x, y, z)) continue;

    const raw = weights.weights[i];
    if (!raw || raw.length === 0) {
      unbound++;
      continue;
    }
    // ARP ボーン荷重をセグメントへ集約（複数 ARP → 同一セグメントは加算）
    const accum = new Map<number, number>();
    for (const [bi, w] of raw) {
      if (w <= 0) continue;
      const u = useBone(bi);
      if (u < 0) continue;
      accum.set(u, (accum.get(u) ?? 0) + w);
    }
    const infl = [...accum.entries()].map(([u, w]) => ({ u, w }));
    if (infl.length === 0) {
      unbound++;
      continue;
    }
    infl.sort((a, b) => b.w - a.w);
    if (infl.length > MAX_INF) infl.length = MAX_INF;
    const sum = infl.reduce((s, e) => s + e.w, 0);

    const wx = go[0] + x * vs;
    const wd = go[1] + y * vs;
    const wh = go[2] + z * vs;
    if (wh > maxY) maxY = wh;

    // 4影響ぶん格納（不足は u=-1, w=0）
    let domU = infl[0].u;
    for (let k = 0; k < MAX_INF; k++) {
      const e = infl[k];
      if (e) {
        bIdx.push(e.u);
        wArr.push(e.w / sum);
        const head = usedHeads[e.u];
        local.push(wx - head.x, wh - head.y, wd - head.z);
      } else {
        bIdx.push(-1);
        wArr.push(0);
        local.push(0, 0, 0);
      }
    }
    dom.push(domU);

    const c = skinVox.cs[i];
    const sp = (c - 1) * 4;
    colors.push(
      skinVox.palette[sp] / 255,
      skinVox.palette[sp + 1] / 255,
      skinVox.palette[sp + 2] / 255,
      1,
    );
  }

  const n = dom.length;
  const B = Int32Array.from(bIdx);
  const W = Float32Array.from(wArr);
  const L = Float32Array.from(local);
  const DOM = Int32Array.from(dom);
  const matrices = new Float32Array(n * 16);

  const box = MeshBuilder.CreateBox("annaWeighted", { size: vs }, scene);
  const mat = new StandardMaterial("annaWeightedMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  box.material = mat;
  box.thinInstanceSetBuffer("color", Float32Array.from(colors), 4, true);
  box.thinInstanceSetBuffer("matrix", matrices, 16, false);

  const boneMats: Matrix[] = usedBones.map(() => Matrix.Identity());
  const boneQuats: Quaternion[] = usedBones.map(() => Quaternion.Identity());
  const tmp = new Vector3();
  const pos = new Vector3();
  const scaleOne = new Vector3(1, 1, 1);
  const tmpMat = new Matrix();

  const update = (): void => {
    for (let k = 0; k < usedBones.length; k++) {
      const node = usedBones[k];
      node.computeWorldMatrix(true);
      boneMats[k].copyFrom(node.getWorldMatrix());
      boneQuats[k].copyFrom(node.absoluteRotationQuaternion);
    }
    for (let i = 0; i < n; i++) {
      pos.set(0, 0, 0);
      const base = i * MAX_INF;
      for (let k = 0; k < MAX_INF; k++) {
        const u = B[base + k];
        if (u < 0) continue;
        const w = W[base + k];
        const li = (base + k) * 3;
        Vector3.TransformCoordinatesFromFloatsToRef(L[li], L[li + 1], L[li + 2], boneMats[u], tmp);
        pos.x += tmp.x * w;
        pos.y += tmp.y * w;
        pos.z += tmp.z * w;
      }
      Matrix.ComposeToRef(scaleOne, boneQuats[DOM[i]], pos, tmpMat);
      tmpMat.copyToArray(matrices, i * 16);
    }
    box.thinInstanceBufferUpdated("matrix");
  };

  const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(update);
  update();

  return {
    mesh: box,
    rendered: n,
    total: count,
    bounds: { maxY },
    unbound,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(obs);
      box.dispose();
    },
  };
}
