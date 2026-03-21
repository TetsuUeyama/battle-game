/**
 * StageBuilder: builds the battle field ground using a random village voxel tile.
 * Builds a heightmap from the voxel data so characters walk on the terrain surface.
 */

import { Scene } from '@babylonjs/core';
import { loadVoxFile, SCALE } from '@/lib/vox-parser';
import { buildGreedyMesh } from '@/lib/greedy-mesh';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

const VILLAGE_TILES_BASE = '/api/game-assets/field/village/tiles';
const TILE_SCALE = 6;

/** All available tile IDs (4×4 grid) */
const TILE_IDS = [
  'tile_0_0', 'tile_0_1', 'tile_0_2', 'tile_0_3',
  'tile_1_0', 'tile_1_1', 'tile_1_2', 'tile_1_3',
  'tile_2_0', 'tile_2_1', 'tile_2_2', 'tile_2_3',
  'tile_3_0', 'tile_3_1', 'tile_3_2', 'tile_3_3',
];

// ---- Heightmap state ----
let heightmap: Float32Array | null = null;
let hmSizeX = 0;
let hmSizeY = 0;
let hmCx = 0;
let hmCy = 0;

/**
 * Sample the terrain height at a given world (X, Z) position.
 * Returns the Y coordinate of the topmost voxel surface at that point.
 */
export function getGroundHeight(worldX: number, worldZ: number): number {
  if (!heightmap) return 0;

  const vx = Math.floor(worldX / (SCALE * TILE_SCALE) + hmCx);
  const vy = Math.floor(-worldZ / (SCALE * TILE_SCALE) + hmCy);

  const cx = Math.max(0, Math.min(hmSizeX - 1, vx));
  const cy = Math.max(0, Math.min(hmSizeY - 1, vy));

  const maxZ = heightmap[cx + cy * hmSizeX];
  return (maxZ + 1) * SCALE * TILE_SCALE;
}

/**
 * Build the stage: load a random voxel tile and build a heightmap for ground collision.
 */
export async function buildStage(scene: Scene): Promise<void> {
  const tileId = TILE_IDS[Math.floor(Math.random() * TILE_IDS.length)];

  const { model, voxels } = await loadVoxFile(`${VILLAGE_TILES_BASE}/${tileId}.vox`);

  // ---- Build heightmap ----
  hmSizeX = model.sizeX;
  hmSizeY = model.sizeY;
  hmCx = model.sizeX / 2;
  hmCy = model.sizeY / 2;

  heightmap = new Float32Array(hmSizeX * hmSizeY);
  heightmap.fill(-1);

  for (const v of voxels) {
    const idx = v.x + v.y * hmSizeX;
    if (v.z > heightmap[idx]) {
      heightmap[idx] = v.z;
    }
  }

  // Fill empty cells with global max height
  let globalMaxZ = 0;
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] > globalMaxZ) globalMaxZ = heightmap[i];
  }
  for (let i = 0; i < heightmap.length; i++) {
    if (heightmap[i] < 0) heightmap[i] = globalMaxZ;
  }

  // ---- Build the visible mesh ----
  const mesh = buildGreedyMesh(voxels, scene, 'ground', model.sizeX, model.sizeY, model.sizeZ);
  mesh.scaling.setAll(TILE_SCALE);
  mesh.position.y = 0;
  mesh.isPickable = false;

  // Update groundY to center height (used for spawn positioning)
  const centerIdx = Math.floor(hmCx) + Math.floor(hmCy) * hmSizeX;
  STAGE_CONFIG.groundY = (heightmap[centerIdx] + 1) * SCALE * TILE_SCALE;

  // Update field extents to match tile size
  const tileWorldX = model.sizeX * SCALE * TILE_SCALE;
  const tileWorldZ = model.sizeY * SCALE * TILE_SCALE;
  STAGE_CONFIG.fieldHalfX = tileWorldX / 2;
  STAGE_CONFIG.fieldHalfZ = tileWorldZ / 2;
}
