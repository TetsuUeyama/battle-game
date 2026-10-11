import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
// thin instance 系メソッド (thinInstanceSetBuffer 等) を Mesh に生やす副作用 import
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { VoxModel } from "./parseVox";

export interface BuildVoxelOptions {
  /** 1 ボクセルの一辺 (m)。anna のグリッドは約 0.00705 */
  voxelSize?: number;
  /** 内部ボクセルを間引いて表面だけ描く（既定 true） */
  surfaceOnly?: boolean;
  name?: string;
}

export interface VoxelMeshResult {
  mesh: Mesh;
  /** 実際に描画したインスタンス数 */
  rendered: number;
  /** 元のボクセル総数 */
  total: number;
  /** Y-up 変換後の境界 (フィット用) */
  bounds: { minY: number; maxY: number; radius: number };
}

/**
 * MagicaVoxel(Z-up) のボクセル群を Babylon(Y-up) の thin instances メッシュにする。
 * 表面ボクセルのみ描画し、色はパレットから per-instance color で与える。
 */
export function buildVoxelMesh(
  scene: Scene,
  model: VoxModel,
  opts: BuildVoxelOptions = {},
): VoxelMeshResult {
  const vs = opts.voxelSize ?? 0.00705;
  const surfaceOnly = opts.surfaceOnly ?? true;
  const { sizeX, sizeY, sizeZ, xs, ys, zs, cs, palette, count } = model;

  // 占有グリッド（表面判定用）
  const idx = (x: number, y: number, z: number) =>
    x + sizeX * (y + sizeY * z);
  let occ: Uint8Array | null = null;
  if (surfaceOnly) {
    occ = new Uint8Array(sizeX * sizeY * sizeZ);
    for (let i = 0; i < count; i++) occ[idx(xs[i], ys[i], zs[i])] = 1;
  }
  const filled = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ)
      return false;
    return occ![idx(x, y, z)] === 1;
  };
  const isSurface = (x: number, y: number, z: number) =>
    !filled(x - 1, y, z) ||
    !filled(x + 1, y, z) ||
    !filled(x, y - 1, z) ||
    !filled(x, y + 1, z) ||
    !filled(x, y, z - 1) ||
    !filled(x, y, z + 1);

  // 中心合わせ: x と 奥行き(y) は中央寄せ、高さ(z)は足元を 0 に
  const cx = sizeX / 2;
  const cz = sizeY / 2;

  const matrices: number[] = [];
  const colors: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;

  const tmp = new Matrix();
  for (let i = 0; i < count; i++) {
    const x = xs[i];
    const y = ys[i];
    const z = zs[i];
    if (surfaceOnly && !isSurface(x, y, z)) continue;

    // Z-up(vox) → Y-up(babylon): worldY = z, worldZ = depth(y)
    const wx = (x - cx) * vs;
    const wy = z * vs;
    const wz = (y - cz) * vs;
    Matrix.TranslationToRef(wx, wy, wz, tmp);
    for (let m = 0; m < 16; m++) matrices.push(tmp.m[m]);

    const c = cs[i];
    const p = (c - 1) * 4; // MagicaVoxel: color index は 1 始まり
    colors.push(palette[p] / 255, palette[p + 1] / 255, palette[p + 2] / 255, 1);

    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
    const r = Math.hypot(wx, wz);
    if (r > maxR) maxR = r;
  }

  const box = MeshBuilder.CreateBox(opts.name ?? "annaVox", { size: vs }, scene);
  box.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
  box.thinInstanceSetBuffer("color", new Float32Array(colors), 4, true);

  const mat = new StandardMaterial("annaVoxMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1); // per-instance color を乗算
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  box.material = mat;

  return {
    mesh: box,
    rendered: colors.length / 4,
    total: count,
    bounds: {
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 0,
      radius: maxR,
    },
  };
}
