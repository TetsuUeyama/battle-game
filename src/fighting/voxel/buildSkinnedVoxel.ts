import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { VoxModel } from "./parseVox";
import type { AnnaSkeleton } from "./buildAnnaSkeleton";
import type { BoneRegionMap } from "./buildRiggedVoxel";

/** 領域 → 代表 deform ボーン（剛体版と同じ） */
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

/** 領域 → 親領域（関節ブレンド用。head の関節は neck 側） */
const REGION_PARENT: Record<string, string> = {
  head: "neck",
  neck: "upper_torso",
  shoulder_l: "upper_torso",
  shoulder_r: "upper_torso",
  upper_arm_l: "shoulder_l",
  upper_arm_r: "shoulder_r",
  forearm_l: "upper_arm_l",
  forearm_r: "upper_arm_r",
  hand_l: "forearm_l",
  hand_r: "forearm_r",
  upper_torso: "lower_torso",
  lower_torso: "hips",
  thigh_l: "hips",
  thigh_r: "hips",
  shin_l: "thigh_l",
  shin_r: "thigh_r",
  foot_l: "shin_l",
  foot_r: "shin_r",
};

/** 関節ブレンドの幅 (m)。bone head から この距離内を親ボーンへブレンド */
const BLEND_ZONE = 0.06;

export interface SkinnedVoxelResult {
  mesh: Mesh;
  rendered: number;
  total: number;
  bounds: { maxY: number };
  dispose: () => void;
}

/**
 * スムーススキニング(リニアブレンド)版。
 * 各ボクセルを「自ボーン＋親ボーン」の加重ブレンド位置で毎フレーム更新するので、
 * 関節付近が連続的に変形し、剛体版で開いていた隙間が閉じる。
 */
export function buildSkinnedVoxelMesh(
  scene: Scene,
  skinVox: VoxModel,
  regionVox: VoxModel,
  skeleton: AnnaSkeleton,
  brm: BoneRegionMap,
): SkinnedVoxelResult {
  const vs = brm.grid.voxel_size;
  const go = brm.grid.grid_origin;

  // 色 → 領域
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

  // 使用ボーンのユニーク化
  const usedBones: import("@babylonjs/core/Meshes/transformNode").TransformNode[] = [];
  const boneIndex = new Map<string, number>();
  const useBone = (name: string): number => {
    let idx = boneIndex.get(name);
    if (idx === undefined) {
      const node = skeleton.nodesByName.get(name)!;
      idx = usedBones.length;
      usedBones.push(node);
      boneIndex.set(name, idx);
    }
    return idx;
  };

  // 表面ボクセルを集計
  const b1: number[] = [];
  const b2: number[] = [];
  const dom: number[] = [];
  const wArr: number[] = [];
  const l1: number[] = [];
  const l2: number[] = [];
  const colors: number[] = [];
  let maxY = 0;

  for (let i = 0; i < count; i++) {
    const x = xs[i], y = ys[i], z = zs[i];
    if (!isSurface(x, y, z)) continue;
    const region = colorToRegion.get(regionVox.cs[i]);
    const boneName = region ? REGION_TO_BONE[region] : undefined;
    if (!boneName || !skeleton.nodesByName.has(boneName)) continue;

    const parentRegion = region ? REGION_PARENT[region] : undefined;
    const parentBoneName = parentRegion ? REGION_TO_BONE[parentRegion] : undefined;
    const hasParent = !!parentBoneName && skeleton.nodesByName.has(parentBoneName);

    // Blender world (grid_origin + voxel*size) → Babylon (x, z, y)
    const wx = go[0] + x * vs;
    const wd = go[1] + y * vs;
    const wh = go[2] + z * vs;
    const world = new Vector3(wx, wh, wd);
    if (wh > maxY) maxY = wh;

    const head1 = skeleton.restWorld.get(boneName)!;
    const idx1 = useBone(boneName);
    let idx2 = idx1;
    let w = 1;
    if (hasParent) {
      const dist = Vector3.Distance(world, head1); // 関節(=自ボーン head)からの距離
      // head 付近を親へブレンド: w1 = 0.5..1
      w = Math.min(1, 0.5 + 0.5 * (dist / BLEND_ZONE));
      idx2 = useBone(parentBoneName!);
    }
    const head2 = skeleton.restWorld.get(usedBones[idx2].name)!;

    b1.push(idx1);
    b2.push(idx2);
    dom.push(w >= 0.5 ? idx1 : idx2);
    wArr.push(w);
    // bind 局所オフセット（ボーンは rest で identity 回転なので world - head）
    l1.push(world.x - head1.x, world.y - head1.y, world.z - head1.z);
    l2.push(world.x - head2.x, world.y - head2.y, world.z - head2.z);

    const c = skinVox.cs[i];
    const sp = (c - 1) * 4;
    colors.push(
      skinVox.palette[sp] / 255,
      skinVox.palette[sp + 1] / 255,
      skinVox.palette[sp + 2] / 255,
      1,
    );
  }

  const n = wArr.length;
  const B1 = Int32Array.from(b1);
  const B2 = Int32Array.from(b2);
  const DOM = Int32Array.from(dom);
  const W = Float32Array.from(wArr);
  const L1 = Float32Array.from(l1);
  const L2 = Float32Array.from(l2);
  const matrices = new Float32Array(n * 16);

  const box = MeshBuilder.CreateBox("annaSkinned", { size: vs }, scene);
  const mat = new StandardMaterial("annaSkinnedMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  box.material = mat;
  box.thinInstanceSetBuffer("color", Float32Array.from(colors), 4, true);
  box.thinInstanceSetBuffer("matrix", matrices, 16, false); // 動的

  // 毎フレーム更新（ボーン world を読んで加重ブレンド）
  const boneMats: Matrix[] = usedBones.map(() => Matrix.Identity());
  const boneQuats: Quaternion[] = usedBones.map(() => Quaternion.Identity());
  const p1 = new Vector3();
  const p2 = new Vector3();
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
      const m1 = boneMats[B1[i]];
      const m2 = boneMats[B2[i]];
      Vector3.TransformCoordinatesFromFloatsToRef(L1[i * 3], L1[i * 3 + 1], L1[i * 3 + 2], m1, p1);
      Vector3.TransformCoordinatesFromFloatsToRef(L2[i * 3], L2[i * 3 + 1], L2[i * 3 + 2], m2, p2);
      const w = W[i];
      pos.set(p1.x * w + p2.x * (1 - w), p1.y * w + p2.y * (1 - w), p1.z * w + p2.z * (1 - w));
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
    dispose: () => {
      scene.onBeforeRenderObservable.remove(obs);
      box.dispose();
    },
  };
}
