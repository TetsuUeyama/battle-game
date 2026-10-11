/**
 * 三角形スープ → 表面ボクセル化。
 *
 * 各三角形の AABB が触れるセルに対して三角形-AABB 重なり判定 (SAT,
 * Akenine-Möller の 13 軸) を行い、交差セルを占有にする。
 * 三角形ラスタライズなので結果は「表面シェル」— 描画にはそれで十分で、
 * スキニングも表面ボクセルにだけ掛ければよい。
 */

import type { TriangleMesh, VoxelizedModel } from "./types";

export interface VoxelizeOptions {
  /** 最長軸のセル数。既定 64 */
  resolution?: number;
  /** 色が無い三角形に使う RGB。既定グレー */
  defaultColor?: [number, number, number];
}

export function voxelizeTriangleMesh(
  mesh: TriangleMesh,
  opts?: VoxelizeOptions,
): VoxelizedModel {
  const resolution = Math.max(4, Math.floor(opts?.resolution ?? 64));
  const defC = opts?.defaultColor ?? [0.72, 0.72, 0.75];
  const { positions, indices, triangleColors } = mesh;

  // bbox
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(ext > 0)) {
    return {
      count: 0,
      xs: new Uint16Array(0), ys: new Uint16Array(0), zs: new Uint16Array(0),
      colors: new Float32Array(0),
      origin: [0, 0, 0], voxelSize: 1, size: [0, 0, 0],
    };
  }
  const vs = ext / resolution;
  // わずかに広げて境界三角形の取りこぼしを防ぐ
  const ox = minX - vs * 0.5, oy = minY - vs * 0.5, oz = minZ - vs * 0.5;
  const nx = Math.ceil((maxX - ox) / vs) + 1;
  const ny = Math.ceil((maxY - oy) / vs) + 1;
  const nz = Math.ceil((maxZ - oz) / vs) + 1;

  const occ = new Uint8Array(nx * ny * nz);
  const colR = new Float32Array(nx * ny * nz);
  const colG = new Float32Array(nx * ny * nz);
  const colB = new Float32Array(nx * ny * nz);
  const gi = (x: number, y: number, z: number) => x + nx * (y + ny * z);

  const half = vs / 2;
  const triCount = indices.length / 3;

  // 三角形頂点 (セル中心相対) の作業バッファ
  const v0 = [0, 0, 0], v1 = [0, 0, 0], v2 = [0, 0, 0];

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];

    // 三角形 AABB → セル範囲
    const tminX = Math.min(ax, bx, cx), tmaxX = Math.max(ax, bx, cx);
    const tminY = Math.min(ay, by, cy), tmaxY = Math.max(ay, by, cy);
    const tminZ = Math.min(az, bz, cz), tmaxZ = Math.max(az, bz, cz);
    const cx0 = clampCell(Math.floor((tminX - ox) / vs), nx);
    const cx1 = clampCell(Math.floor((tmaxX - ox) / vs), nx);
    const cy0 = clampCell(Math.floor((tminY - oy) / vs), ny);
    const cy1 = clampCell(Math.floor((tmaxY - oy) / vs), ny);
    const cz0 = clampCell(Math.floor((tminZ - oz) / vs), nz);
    const cz1 = clampCell(Math.floor((tmaxZ - oz) / vs), nz);

    const r = triangleColors ? triangleColors[t * 3] : defC[0];
    const g = triangleColors ? triangleColors[t * 3 + 1] : defC[1];
    const b = triangleColors ? triangleColors[t * 3 + 2] : defC[2];

    for (let zc = cz0; zc <= cz1; zc++) {
      for (let yc = cy0; yc <= cy1; yc++) {
        for (let xc = cx0; xc <= cx1; xc++) {
          const idx = gi(xc, yc, zc);
          if (occ[idx]) continue; // 既に占有 (色は先勝ち)
          // セル中心
          const ccx = ox + (xc + 0.5) * vs;
          const ccy = oy + (yc + 0.5) * vs;
          const ccz = oz + (zc + 0.5) * vs;
          v0[0] = ax - ccx; v0[1] = ay - ccy; v0[2] = az - ccz;
          v1[0] = bx - ccx; v1[1] = by - ccy; v1[2] = bz - ccz;
          v2[0] = cx - ccx; v2[1] = cy - ccy; v2[2] = cz - ccz;
          if (triBoxOverlap(half, v0, v1, v2)) {
            occ[idx] = 1;
            colR[idx] = r; colG[idx] = g; colB[idx] = b;
          }
        }
      }
    }
  }

  // 占有セルを詰めて出力
  let count = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) count++;
  const xs = new Uint16Array(count);
  const ys = new Uint16Array(count);
  const zs = new Uint16Array(count);
  const colors = new Float32Array(count * 3);
  let w = 0;
  for (let zc = 0; zc < nz; zc++) {
    for (let yc = 0; yc < ny; yc++) {
      for (let xc = 0; xc < nx; xc++) {
        const idx = gi(xc, yc, zc);
        if (!occ[idx]) continue;
        xs[w] = xc; ys[w] = yc; zs[w] = zc;
        colors[w * 3] = colR[idx];
        colors[w * 3 + 1] = colG[idx];
        colors[w * 3 + 2] = colB[idx];
        w++;
      }
    }
  }

  return {
    count, xs, ys, zs, colors,
    origin: [ox, oy, oz],
    voxelSize: vs,
    size: [nx, ny, nz],
  };
}

/**
 * メッシュをヨー回転 → 一様スケール → 平行移動した新しい TriangleMesh を返す。
 * (スケルトンへの位置合わせ用。元は不変)
 */
export function transformTriangleMesh(
  mesh: TriangleMesh,
  opts: {
    yawRad?: number;
    scale?: number;
    translate?: [number, number, number];
  },
): TriangleMesh {
  const yaw = opts.yawRad ?? 0;
  const s = opts.scale ?? 1;
  const [tx, ty, tz] = opts.translate ?? [0, 0, 0];
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    const rx = x * cosY + z * sinY;
    const rz = -x * sinY + z * cosY;
    out[i] = rx * s + tx;
    out[i + 1] = y * s + ty;
    out[i + 2] = rz * s + tz;
  }
  return { positions: out, indices: mesh.indices, triangleColors: mesh.triangleColors };
}

/** TriangleMesh の AABB */
export function triangleMeshBounds(mesh: TriangleMesh): {
  min: [number, number, number];
  max: [number, number, number];
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
    if (p[i + 2] < minZ) minZ = p[i + 2];
    if (p[i + 2] > maxZ) maxZ = p[i + 2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function clampCell(v: number, n: number): number {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

// ---------------------------------------------------------------------------
// 三角形 vs 立方体 (中心原点, 半辺 h) の SAT 判定 (Akenine-Möller)
// 頂点はセル中心相対で渡す。
// ---------------------------------------------------------------------------

function triBoxOverlap(
  h: number,
  v0: number[],
  v1: number[],
  v2: number[],
): boolean {
  // 1) AABB 軸 3 本 (x/y/z) — 呼び出し側のセル範囲で概ね済んでいるが厳密に
  if (
    Math.min(v0[0], v1[0], v2[0]) > h || Math.max(v0[0], v1[0], v2[0]) < -h ||
    Math.min(v0[1], v1[1], v2[1]) > h || Math.max(v0[1], v1[1], v2[1]) < -h ||
    Math.min(v0[2], v1[2], v2[2]) > h || Math.max(v0[2], v1[2], v2[2]) < -h
  ) {
    return false;
  }

  const e0 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  const e2 = [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]];

  // 2) 9 本のクロス積軸
  if (!axisTest(e0, v0, v1, v2, h)) return false;
  if (!axisTest(e1, v0, v1, v2, h)) return false;
  if (!axisTest(e2, v0, v1, v2, h)) return false;

  // 3) 三角形面の法線軸
  const n = [
    e0[1] * e1[2] - e0[2] * e1[1],
    e0[2] * e1[0] - e0[0] * e1[2],
    e0[0] * e1[1] - e0[1] * e1[0],
  ];
  const d = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2];
  const r = h * (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]));
  return Math.abs(d) <= r;
}

/** エッジ e と x/y/z 軸のクロス積 3 軸ぶんをまとめて SAT 判定 */
function axisTest(
  e: number[],
  v0: number[],
  v1: number[],
  v2: number[],
  h: number,
): boolean {
  // axis = e × (1,0,0) = (0, e.z, -e.y)
  {
    const p0 = e[2] * v0[1] - e[1] * v0[2];
    const p1 = e[2] * v1[1] - e[1] * v1[2];
    const p2 = e[2] * v2[1] - e[1] * v2[2];
    const r = h * (Math.abs(e[2]) + Math.abs(e[1]));
    if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
  }
  // axis = e × (0,1,0) = (-e.z, 0, e.x)
  {
    const p0 = e[0] * v0[2] - e[2] * v0[0];
    const p1 = e[0] * v1[2] - e[2] * v1[0];
    const p2 = e[0] * v2[2] - e[2] * v2[0];
    const r = h * (Math.abs(e[0]) + Math.abs(e[2]));
    if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
  }
  // axis = e × (0,0,1) = (e.y, -e.x, 0)
  {
    const p0 = e[1] * v0[0] - e[0] * v0[1];
    const p1 = e[1] * v1[0] - e[0] * v1[1];
    const p2 = e[1] * v2[0] - e[0] * v2[1];
    const r = h * (Math.abs(e[1]) + Math.abs(e[0]));
    if (Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r) return false;
  }
  return true;
}
