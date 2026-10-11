/**
 * GLB / FBX ファイル → TriangleMesh 抽出 (Phase 7-3)。
 *
 * voxelize は形式非依存の三角形スープ (TriangleMesh) を入力に取るので、
 * ここで GLB (Babylon ローダー) / FBX (fbx-parser) からジオメトリを取り出す。
 * three には依存しない。
 */

import type { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TriangleMesh } from '@/fighting';

const DEFAULT_COLOR: [number, number, number] = [0.72, 0.72, 0.75];

/** メッシュのマテリアル色 (PBR=albedo / Standard=diffuse、無ければグレー) */
function meshColor(mesh: AbstractMesh): [number, number, number] {
  const mat = mesh.material as
    | { albedoColor?: { r: number; g: number; b: number }; diffuseColor?: { r: number; g: number; b: number } }
    | null;
  const c = mat?.albedoColor ?? mat?.diffuseColor;
  return c ? [c.r, c.g, c.b] : DEFAULT_COLOR;
}

interface ImportResult {
  meshes: AbstractMesh[];
  skeletons: { dispose: () => void }[];
  animationGroups: { dispose: () => void }[];
  transformNodes: { dispose: () => void }[];
}

/** テクスチャを RGBA8 ピクセルバッファとして読み出す (失敗時 null) */
async function readTexturePixels(
  tex: { getSize(): { width: number; height: number }; readPixels(): Promise<ArrayBufferView> | undefined },
): Promise<{ pixels: Uint8Array; w: number; h: number } | null> {
  try {
    const size = tex.getSize();
    const buf = await tex.readPixels();
    if (!buf) return null;
    const pixels = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer);
    return { pixels, w: size.width, h: size.height };
  } catch {
    return null;
  }
}

/**
 * ロード結果の全メッシュをワールド変換して三角形スープに連結する。
 * 三角形色は「頂点カラー → テクスチャ(重心UVサンプリング) → マテリアル単色 → グレー」の
 * 優先で決める。LOD1 以降 (名前に _LOD[1-9]) は重複なので除外。抽出後ロード実体は破棄。
 */
async function extractTriangleSoup(res: ImportResult): Promise<TriangleMesh> {
  const positions: number[] = [];
  const indices: number[] = [];
  const triColors: number[] = [];
  const tmp = new Vector3();

  for (const mesh of res.meshes) {
    if (/_LOD[1-9]/i.test(mesh.name)) continue; // 重複 LOD は除外
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    const idx = mesh.getIndices();
    if (!pos || !idx) continue;
    mesh.computeWorldMatrix(true);
    const world = mesh.getWorldMatrix();
    const base = positions.length / 3;
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], world, tmp);
      positions.push(tmp.x, tmp.y, tmp.z);
    }

    // 色ソースを用意 (頂点カラー / テクスチャ / 単色)
    const vcol = mesh.getVerticesData(VertexBuffer.ColorKind); // 0..1
    // 頂点カラーの成分数は 3 (RGB) か 4 (RGBA)。glTF COLOR_0 は両方ありうる
    const colStride = (mesh as {
      getVertexBuffer?: (k: string) => { getSize: () => number } | null;
    }).getVertexBuffer?.(VertexBuffer.ColorKind)?.getSize() ?? 4;
    const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
    const mat = mesh.material as {
      albedoTexture?: Parameters<typeof readTexturePixels>[0];
      diffuseTexture?: Parameters<typeof readTexturePixels>[0];
    } | null;
    const tex = mat?.albedoTexture ?? mat?.diffuseTexture ?? null;
    const texData = tex && uvs ? await readTexturePixels(tex) : null;
    const [fr, fg, fb] = meshColor(mesh);

    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      indices.push(base + a, base + b, base + c);
      let r = fr, g = fg, bl = fb;
      if (vcol) {
        // 3 頂点カラーの平均 (stride は 3 か 4)
        r = (vcol[a * colStride] + vcol[b * colStride] + vcol[c * colStride]) / 3;
        g = (vcol[a * colStride + 1] + vcol[b * colStride + 1] + vcol[c * colStride + 1]) / 3;
        bl = (vcol[a * colStride + 2] + vcol[b * colStride + 2] + vcol[c * colStride + 2]) / 3;
      } else if (texData && uvs) {
        // 重心 UV でテクスチャをサンプリング
        const u = (uvs[a * 2] + uvs[b * 2] + uvs[c * 2]) / 3;
        const v = (uvs[a * 2 + 1] + uvs[b * 2 + 1] + uvs[c * 2 + 1]) / 3;
        const px = Math.min(texData.w - 1, Math.max(0, Math.floor(u * texData.w)));
        const py = Math.min(texData.h - 1, Math.max(0, Math.floor((1 - v) * texData.h)));
        const o = (py * texData.w + px) * 4;
        r = texData.pixels[o] / 255;
        g = texData.pixels[o + 1] / 255;
        bl = texData.pixels[o + 2] / 255;
      }
      triColors.push(r, g, bl);
    }
  }

  // ロードした実体は不要 (ジオメトリは抽出済み)
  for (const m of res.meshes) m.dispose();
  for (const s of res.skeletons) s.dispose();
  for (const g of res.animationGroups) g.dispose();
  for (const tn of res.transformNodes) tn.dispose();

  if (positions.length === 0) throw new Error('メッシュが見つかりませんでした');
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleColors: new Float32Array(triColors),
  };
}

/** GLB/glTF (File) を Babylon でロードして三角形スープにする */
async function glbToTriangleMesh(scene: Scene, file: File): Promise<TriangleMesh> {
  return extractTriangleSoup(await ImportMeshAsync(file, scene));
}

/** GLB/glTF を URL から取り込む (サンプル/共有用) */
export async function importUrlToTriangleMesh(scene: Scene, url: string): Promise<TriangleMesh> {
  return extractTriangleSoup(await ImportMeshAsync(url, scene));
}

/**
 * FBX を fbx-parser でパースし、Geometry の Vertices/PolygonVertexIndex から
 * 三角形スープを作る (多角形は扇状に三角形分割)。three 不要。
 * 注: 軸 (Z-up) やスケールは createVoxelFighter 側の身長フィット + yaw で吸収する。
 */
async function fbxToTriangleMesh(file: File): Promise<TriangleMesh> {
  const { parseBinary, parseText, FBXReader } = await import('fbx-parser');
  const buf = new Uint8Array(await file.arrayBuffer());
  let fbx;
  try {
    fbx = parseBinary(buf);
  } catch {
    fbx = parseText(new TextDecoder().decode(buf));
  }
  const reader = new FBXReader(fbx);
  const geometries = reader.node('Objects')?.nodes('Geometry') ?? [];

  const positions: number[] = [];
  const indices: number[] = [];
  for (const geo of geometries) {
    const verts = geo.node('Vertices')?.prop(0, 'number[]');
    const pvi = geo.node('PolygonVertexIndex')?.prop(0, 'number[]');
    if (!verts || !pvi) continue;
    const base = positions.length / 3;
    for (const v of verts) positions.push(v);

    // PolygonVertexIndex: 負値 (~idx) が多角形の終端マーカー
    let poly: number[] = [];
    for (const raw of pvi) {
      let idx = raw;
      let end = false;
      if (idx < 0) { idx = ~idx; end = true; }
      poly.push(base + idx);
      if (end) {
        for (let k = 1; k + 1 < poly.length; k++) {
          indices.push(poly[0], poly[k], poly[k + 1]);
        }
        poly = [];
      }
    }
  }

  if (positions.length === 0) throw new Error('FBX からジオメトリを抽出できませんでした');
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** 拡張子で振り分けて TriangleMesh を返す */
export async function importToTriangleMesh(scene: Scene, file: File): Promise<TriangleMesh> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.glb') || name.endsWith('.gltf')) return glbToTriangleMesh(scene, file);
  if (name.endsWith('.fbx')) return fbxToTriangleMesh(file);
  throw new Error('対応形式は .glb / .gltf / .fbx です');
}

/** TriangleMesh の三角形数 (UI 表示用) */
export function triangleCount(mesh: TriangleMesh): number {
  return mesh.indices.length / 3;
}

/**
 * TriangleMesh を「確認用」の表示メッシュ (Babylon Mesh) に変換する。
 * ボクセル化前に生データの形・向き・色をそのまま見るためのもの。
 *
 * 三角形ごとの色 (triangleColors) を出すため各三角形を 3 頂点に展開した
 * non-indexed メッシュにし、フラットシェーディングで陰影を付ける。色が無い
 * モデル (FBX 等) は一様色。返したメッシュの transform はステップ3の位置合わせで
 * 親側から動かす想定。
 */
export function buildDisplayMesh(
  scene: Scene,
  tris: TriangleMesh,
  opts?: { name?: string; alpha?: number; uniformColor?: [number, number, number] },
): Mesh {
  const { positions: srcPos, indices, triangleColors } = tris;
  const triCount = indices.length / 3;
  const positions = new Float32Array(triCount * 9);
  const colors = new Float32Array(triCount * 12);
  const outIdx = new Uint32Array(triCount * 3);
  const [ur, ug, ub] = opts?.uniformColor ?? [0.72, 0.74, 0.8];

  for (let t = 0; t < triCount; t++) {
    const r = triangleColors ? triangleColors[t * 3] : ur;
    const g = triangleColors ? triangleColors[t * 3 + 1] : ug;
    const b = triangleColors ? triangleColors[t * 3 + 2] : ub;
    for (let k = 0; k < 3; k++) {
      const src = indices[t * 3 + k] * 3;
      const v = (t * 3 + k) * 3;
      positions[v] = srcPos[src];
      positions[v + 1] = srcPos[src + 1];
      positions[v + 2] = srcPos[src + 2];
      const c = (t * 3 + k) * 4;
      colors[c] = r; colors[c + 1] = g; colors[c + 2] = b; colors[c + 3] = 1;
      outIdx[t * 3 + k] = t * 3 + k;
    }
  }

  const mesh = new Mesh(opts?.name ?? 'displayMesh', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = outIdx;
  vd.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, outIdx, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);

  const mat = new StandardMaterial((opts?.name ?? 'display') + '-mat', scene);
  mat.diffuseColor = new Color3(1, 1, 1); // 頂点カラーをそのまま出す
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  mat.backFaceCulling = false;
  if (opts?.alpha !== undefined && opts.alpha < 1) mat.alpha = opts.alpha;
  mesh.material = mat;
  mesh.useVertexColors = true;
  return mesh;
}
