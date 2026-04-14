/**
 * ボクセル髪メッシュをHeadボーンに取り付けるユーティリティ。
 * .vox ファイルを読み込み、greedy mesh で最適化して Head に親子付けする。
 */
import { Scene, Mesh, VertexData, Vector3 } from '@babylonjs/core';
import { loadVoxFile, SCALE } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';
import { createUnlitMaterial } from '@/lib/voxel-skeleton';
import type { HavokCharacter } from '../types';

/**
 * ボクセル配列の AABB を返す
 */
function computeBounds(voxels: VoxelEntry[]) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of voxels) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * ボクセルデータからメッシュを構築。
 * anchorX/Y/Z (ボクセル空間) を原点として頂点座標を生成する。
 * ボクセル→ビューア座標変換: X→X, Z→Y(上), Y→-Z
 */
function buildHairMesh(
  voxels: VoxelEntry[], scene: Scene, name: string,
  anchorX: number, anchorY: number, anchorZ: number,
): Mesh {
  // 高速ルックアップ用 Set
  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);

  const FACE_DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const FACE_VERTS = [
    [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
    [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],
  ];
  const FACE_NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const v of voxels) {
    for (let fi = 0; fi < 6; fi++) {
      const fd = FACE_DIRS[fi];
      const nx = v.x + fd[0], ny = v.y + fd[1], nz = v.z + fd[2];
      if (occupied.has(`${nx},${ny},${nz}`)) continue;

      const fv = FACE_VERTS[fi];
      const fn = FACE_NORMALS[fi];
      const bi = positions.length / 3;

      for (let vi = 0; vi < 4; vi++) {
        // ボクセル→ビューア座標 (anchor基準)
        const vx = (v.x + fv[vi][0] - anchorX) * SCALE;
        const vy = (v.z + fv[vi][2] - anchorZ) * SCALE; // voxel Z → viewer Y (上)
        const vz = -(v.y + fv[vi][1] - anchorY) * SCALE; // voxel Y → viewer -Z
        positions.push(vx, vy, vz);
        normals.push(fn[0], fn[2], -fn[1]);
        colors.push(v.r, v.g, v.b, 1);
      }
      indices.push(bi, bi+1, bi+2, bi, bi+2, bi+3);
    }
  }

  const vd = new VertexData();
  vd.positions = new Float32Array(positions);
  vd.normals = new Float32Array(normals);
  vd.colors = new Float32Array(colors);
  vd.indices = new Uint32Array(indices);
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_unlit');
  mesh.isPickable = false;
  return mesh;
}

/**
 * .vox 髪モデルを読み込み、キャラクターの Head ボーンに取り付ける。
 * @param scene Babylon.js シーン
 * @param character 対象キャラクター
 * @param voxUrl 髪 .vox ファイルの URL
 * @param headTopRatio 元モデルの頭頂部に相当する位置 (0=髪の下端, 1=髪の上端, デフォルト 0.85)
 * @param yOffset HeadTop_End からの追加 Y オフセット (デフォルト 0)
 * @returns 生成した髪メッシュ
 */
export async function attachVoxHairToHead(
  scene: Scene,
  character: HavokCharacter,
  voxUrl: string,
  headTopRatio = 0.85,
  yOffset = 0,
): Promise<Mesh> {
  const { voxels } = await loadVoxFile(voxUrl);
  if (voxels.length === 0) throw new Error('Hair vox file is empty');

  const bounds = computeBounds(voxels);

  // anchor X/Y = 水平中央
  const anchorX = (bounds.minX + bounds.maxX + 1) / 2;
  const anchorY = (bounds.minY + bounds.maxY + 1) / 2;
  // anchor Z = 元モデルの頭頂部に相当する位置 (voxel Z → viewer Y 上方向)
  // headTopRatio で指定: 0=minZ(下端), 1=maxZ+1(上端)
  const anchorZ = bounds.minZ + (bounds.maxZ + 1 - bounds.minZ) * headTopRatio;

  const headBone = character.allBones.get('mixamorig:Head');
  if (!headBone) throw new Error('Head bone not found');

  const prefix = character.root.name.split('_')[0];
  const mesh = buildHairMesh(voxels, scene, `${prefix}_voxHair`, anchorX, anchorY, anchorZ);
  mesh.parent = headBone;

  // 前後反転を修正 (Head ボーンのローカル Z 方向に対して髪が逆向き)
  mesh.rotation.y = Math.PI;

  // anchor (= 元モデルの頭頂部) を HeadTop_End の位置に合わせる
  const headTopBone = character.allBones.get('mixamorig:HeadTop_End');
  if (headTopBone) {
    const headHeight = headTopBone.position.length();
    mesh.position = new Vector3(0, headHeight + yOffset, 0);
  } else {
    mesh.position = new Vector3(0, 0.15 + yOffset, 0);
  }

  return mesh;
}
