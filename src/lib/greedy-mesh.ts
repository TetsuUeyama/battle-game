/**
 * Greedy Meshing for voxel data.
 * Merges adjacent same-color faces into larger quads to dramatically reduce
 * vertex/face count. Does NOT modify the original voxel data.
 *
 * Reference: Mikola Lysenko's greedy meshing algorithm.
 */

import { Scene, Mesh, VertexData } from '@babylonjs/core';
import { SCALE } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';
import { createUnlitMaterial } from '@/lib/voxel-skeleton';

/**
 * Pack RGB floats (0-1) into a single integer key for fast color comparison.
 * Uses 8 bits per channel.
 */
function colorKey(r: number, g: number, b: number): number {
  return ((r * 255 + 0.5) | 0) << 16 | ((g * 255 + 0.5) | 0) << 8 | ((b * 255 + 0.5) | 0);
}

/**
 * Build an optimized mesh from voxel data using greedy meshing.
 * Centered on XZ, Y=0 at bottom. Same coordinate convention as buildVoxelMesh.
 */
export function buildGreedyMesh(
  voxels: VoxelEntry[], scene: Scene, name: string,
  sizeX: number, sizeY: number, sizeZ: number,
): Mesh {
  const cx = sizeX / 2;
  const cy = sizeY / 2;

  // Build 3D lookup: key → colorKey (0 = empty)
  const grid = new Int32Array(sizeX * sizeY * sizeZ);
  const colorR = new Float32Array(sizeX * sizeY * sizeZ);
  const colorG = new Float32Array(sizeX * sizeY * sizeZ);
  const colorB = new Float32Array(sizeX * sizeY * sizeZ);

  const idx = (x: number, y: number, z: number) => x + y * sizeX + z * sizeX * sizeY;

  for (const v of voxels) {
    if (v.x < 0 || v.x >= sizeX || v.y < 0 || v.y >= sizeY || v.z < 0 || v.z >= sizeZ) continue;
    const i = idx(v.x, v.y, v.z);
    grid[i] = colorKey(v.r, v.g, v.b) + 1; // +1 so 0 = empty
    colorR[i] = v.r;
    colorG[i] = v.g;
    colorB[i] = v.b;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Process each of the 6 face directions
  // Axis definitions: [sweepAxis, uAxis, vAxis, normalDir]
  // We sweep along sweepAxis, generating quads on the uAxis×vAxis plane.
  const axes: [number, number, number, number][] = [
    [0, 1, 2, +1], // +X face
    [0, 1, 2, -1], // -X face
    [1, 0, 2, +1], // +Y face
    [1, 0, 2, -1], // -Y face
    [2, 0, 1, +1], // +Z face
    [2, 0, 1, -1], // -Z face
  ];

  const dims = [sizeX, sizeY, sizeZ];

  for (const [sweepAxis, uAxis, vAxis, dir] of axes) {
    const sweepLen = dims[sweepAxis];
    const uLen = dims[uAxis];
    const vLen = dims[vAxis];

    // For each slice along the sweep axis
    for (let d = 0; d < sweepLen; d++) {
      // Build a mask of faces that need to be drawn on this slice
      // mask[u + v * uLen] = colorKey+1 if face visible, 0 if not
      const mask = new Int32Array(uLen * vLen);
      const maskR = new Float32Array(uLen * vLen);
      const maskG = new Float32Array(uLen * vLen);
      const maskB = new Float32Array(uLen * vLen);

      for (let v = 0; v < vLen; v++) {
        for (let u = 0; u < uLen; u++) {
          // Current voxel position
          const pos = [0, 0, 0];
          pos[sweepAxis] = d;
          pos[uAxis] = u;
          pos[vAxis] = v;

          // Neighbor position (in the direction of the face normal)
          const npos = [pos[0], pos[1], pos[2]];
          npos[sweepAxis] += dir > 0 ? 1 : -1;

          const ci = idx(pos[0], pos[1], pos[2]);
          const currentFilled = grid[ci];

          // Check neighbor
          let neighborFilled = 0;
          if (npos[sweepAxis] >= 0 && npos[sweepAxis] < dims[sweepAxis]) {
            neighborFilled = grid[idx(npos[0], npos[1], npos[2])];
          }

          // Face is visible if current is filled and neighbor is empty
          if (currentFilled && !neighborFilled) {
            const mi = u + v * uLen;
            mask[mi] = currentFilled;
            maskR[mi] = colorR[ci];
            maskG[mi] = colorG[ci];
            maskB[mi] = colorB[ci];
          }
        }
      }

      // Greedy merge: scan the mask and create merged quads
      for (let v = 0; v < vLen; v++) {
        for (let u = 0; u < uLen;) {
          const mi = u + v * uLen;
          if (!mask[mi]) { u++; continue; }

          const col = mask[mi];
          const r = maskR[mi], g = maskG[mi], b = maskB[mi];

          // Expand width (along u)
          let w = 1;
          while (u + w < uLen && mask[u + w + v * uLen] === col) w++;

          // Expand height (along v)
          let h = 1;
          let done = false;
          while (v + h < vLen && !done) {
            for (let k = 0; k < w; k++) {
              if (mask[u + k + (v + h) * uLen] !== col) { done = true; break; }
            }
            if (!done) h++;
          }

          // Clear the merged region
          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) {
              mask[u + du + (v + dv) * uLen] = 0;
            }
          }

          // Emit quad
          // Calculate the 4 corners in voxel space
          const p0 = [0, 0, 0]; // base corner
          p0[sweepAxis] = dir > 0 ? d + 1 : d;
          p0[uAxis] = u;
          p0[vAxis] = v;

          const du = [0, 0, 0]; // u direction vector
          du[uAxis] = w;

          const dv = [0, 0, 0]; // v direction vector
          dv[vAxis] = h;

          // Normal
          const n = [0, 0, 0];
          n[sweepAxis] = dir;

          // Convert voxel coords to viewer coords: X→X, Z→Y(up), Y→-Z
          const toViewer = (vx: number, vy: number, vz: number): [number, number, number] => [
            (vx - cx) * SCALE,
            vz * SCALE,
            -(vy - cy) * SCALE,
          ];

          const toViewerN = (nx: number, ny: number, nz: number): [number, number, number] => [
            nx, nz, -ny,
          ];

          const c0 = toViewer(p0[0], p0[1], p0[2]);
          const c1 = toViewer(p0[0] + du[0], p0[1] + du[1], p0[2] + du[2]);
          const c2 = toViewer(p0[0] + du[0] + dv[0], p0[1] + du[1] + dv[1], p0[2] + du[2] + dv[2]);
          const c3 = toViewer(p0[0] + dv[0], p0[1] + dv[1], p0[2] + dv[2]);
          const nv = toViewerN(n[0], n[1], n[2]);

          const bi = positions.length / 3;

          // Wind vertices so normal faces outward
          if (dir > 0) {
            positions.push(...c0, ...c1, ...c2, ...c3);
          } else {
            positions.push(...c0, ...c3, ...c2, ...c1);
          }
          for (let q = 0; q < 4; q++) {
            normals.push(nv[0], nv[1], nv[2]);
            colors.push(r, g, b, 1);
          }
          indices.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);

          u += w;
        }
      }
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
