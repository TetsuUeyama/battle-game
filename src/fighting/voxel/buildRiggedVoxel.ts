import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { VoxModel } from "./parseVox";
import type { AnnaSkeleton } from "./buildAnnaSkeleton";

export interface BoneRegionMap {
  group_colors: Record<string, [number, number, number]>;
  grid: {
    gx: number;
    gy: number;
    gz: number;
    voxel_size: number;
    grid_origin: [number, number, number];
  };
  bone_groups: Record<string, string[]>;
}

export interface RiggedVoxelResult {
  meshes: Mesh[];
  rendered: number;
  total: number;
  /** ボーンに割り当てられなかった領域名 */
  unmappedRegions: string[];
  bounds: { maxY: number };
}

/** 各領域を代表 deform ボーンへ割り当てる（ARP QueenMarika_rig） */
const REGION_TO_BONE: Record<string, string> = {
  head: "head.x",
  neck: "neck.x",
  shoulder_l: "shoulder.l",
  shoulder_r: "shoulder.r",
  upper_torso: "c_spine_03_bend.x",
  lower_torso: "c_spine_01_bend.x",
  hips: "c_root_bend.x",
  upper_arm_l: "c_arm_stretch.l",
  upper_arm_r: "c_arm_stretch.r",
  forearm_l: "c_forearm_stretch.l",
  forearm_r: "c_forearm_stretch.r",
  hand_l: "hand.l",
  hand_r: "hand.r",
  thigh_l: "c_thigh_stretch.l",
  thigh_r: "c_thigh_stretch.r",
  shin_l: "c_leg_stretch.l",
  shin_r: "c_leg_stretch.r",
  foot_l: "foot.l",
  foot_r: "foot.r",
};

/**
 * ボクセルを領域(=色)ごとにボーンへ剛体バインドする。
 * 各ボーンに 1 つの thin-instance メッシュを作り、そのボーンの TransformNode に
 * parent する。ボーンを回すとそのメッシュ(=その部位のボクセル)が追従する。
 *
 * @param skinVox   肌色の body.vox（描画色に使う）
 * @param regionVox 部位色の body_regions.vox（同じボクセル順。領域判定に使う）
 */
export function buildRiggedVoxelMesh(
  scene: Scene,
  skinVox: VoxModel,
  regionVox: VoxModel,
  skeleton: AnnaSkeleton,
  brm: BoneRegionMap,
): RiggedVoxelResult {
  const vs = brm.grid.voxel_size;
  const go = brm.grid.grid_origin;

  // 色インデックス → 領域名（group_colors と RGB 完全一致で対応）
  const colorToRegion = new Map<number, string>();
  for (let ci = 1; ci <= 255; ci++) {
    const p = (ci - 1) * 4;
    const r = regionVox.palette[p];
    const g = regionVox.palette[p + 1];
    const b = regionVox.palette[p + 2];
    for (const [name, col] of Object.entries(brm.group_colors)) {
      if (col[0] === r && col[1] === g && col[2] === b) {
        colorToRegion.set(ci, name);
        break;
      }
    }
  }

  // 表面ボクセル判定
  const { sizeX, sizeY, sizeZ, xs, ys, zs, count } = skinVox;
  const gridIdx = (x: number, y: number, z: number) =>
    x + sizeX * (y + sizeY * z);
  const occ = new Uint8Array(sizeX * sizeY * sizeZ);
  for (let i = 0; i < count; i++) occ[gridIdx(xs[i], ys[i], zs[i])] = 1;
  const filled = (x: number, y: number, z: number) =>
    x >= 0 &&
    y >= 0 &&
    z >= 0 &&
    x < sizeX &&
    y < sizeY &&
    z < sizeZ &&
    occ[gridIdx(x, y, z)] === 1;
  const isSurface = (x: number, y: number, z: number) =>
    !filled(x - 1, y, z) ||
    !filled(x + 1, y, z) ||
    !filled(x, y - 1, z) ||
    !filled(x, y + 1, z) ||
    !filled(x, y, z - 1) ||
    !filled(x, y, z + 1);

  // ボーンごとに matrix / color を貯める
  const perBone = new Map<string, { mat: number[]; col: number[] }>();
  const unmapped = new Set<string>();
  let maxY = 0;
  const tmp = new Matrix();

  for (let i = 0; i < count; i++) {
    const x = xs[i];
    const y = ys[i];
    const z = zs[i];
    if (!isSurface(x, y, z)) continue;

    const region = colorToRegion.get(regionVox.cs[i]);
    const boneName = region ? REGION_TO_BONE[region] : undefined;
    if (!boneName || !skeleton.nodesByName.has(boneName)) {
      if (region) unmapped.add(region);
      continue;
    }

    // Blender world (grid_origin + voxel*size) → Babylon (x, z, y)
    const bx = go[0] + x * vs;
    const byw = go[1] + y * vs;
    const bz = go[2] + z * vs;
    const world = new Vector3(bx, bz, byw);
    if (world.y > maxY) maxY = world.y;

    const boneWorld = skeleton.restWorld.get(boneName)!;
    const off = world.subtract(boneWorld);

    let bucket = perBone.get(boneName);
    if (!bucket) {
      bucket = { mat: [], col: [] };
      perBone.set(boneName, bucket);
    }
    Matrix.TranslationToRef(off.x, off.y, off.z, tmp);
    for (let m = 0; m < 16; m++) bucket.mat.push(tmp.m[m]);

    const c = skinVox.cs[i];
    const sp = (c - 1) * 4;
    bucket.col.push(
      skinVox.palette[sp] / 255,
      skinVox.palette[sp + 1] / 255,
      skinVox.palette[sp + 2] / 255,
      1,
    );
  }

  // ボーンごとに thin-instance メッシュを作って parent
  const meshes: Mesh[] = [];
  let rendered = 0;
  const mat = new StandardMaterial("annaSkinMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);

  for (const [boneName, bucket] of perBone) {
    const node = skeleton.nodesByName.get(boneName)!;
    const box = MeshBuilder.CreateBox(`annaVox_${boneName}`, { size: vs }, scene);
    box.parent = node;
    box.material = mat;
    box.thinInstanceSetBuffer("matrix", new Float32Array(bucket.mat), 16, true);
    box.thinInstanceSetBuffer("color", new Float32Array(bucket.col), 4, true);
    meshes.push(box);
    rendered += bucket.col.length / 4;
  }

  return {
    meshes,
    rendered,
    total: count,
    unmappedRegions: [...unmapped],
    bounds: { maxY },
  };
}
