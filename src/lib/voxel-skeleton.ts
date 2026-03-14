/**
 * Shared voxel skeleton utilities.
 * Used by bone-config (character making) and FightGame (gameplay).
 * This file is the SINGLE SOURCE OF TRUTH for:
 *   - Bone definitions (41 Mixamo bones)
 *   - Marker → bone calculation
 *   - Voxel-to-bone assignment
 *   - Bone mesh building
 *   - Motion clip types & playback helpers
 */

import {
  Scene, Mesh, VertexData, ShaderMaterial, Effect,
  TransformNode, Vector3, Quaternion,
} from '@babylonjs/core';
import { SCALE, FACE_DIRS, FACE_VERTS, FACE_NORMALS } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';

// ========================================================================
// Types
// ========================================================================
export interface Vec3 { x: number; y: number; z: number; }
export type MarkerData = Record<string, Vec3>;

export interface BoneDef {
  name: string;
  label: string;
  parent: string | null;
  color: string;
}

// ========================================================================
// Bone definitions (41 Mixamo standard bones)
// ========================================================================
export const BONE_DEFS: BoneDef[] = [
  // Center chain
  { name: 'Hips',           label: 'Hips',           parent: null,             color: '#ff4444' },
  { name: 'Spine',          label: 'Spine',          parent: 'Hips',           color: '#ff6644' },
  { name: 'Spine1',         label: 'Spine1',         parent: 'Spine',          color: '#ff8844' },
  { name: 'Spine2',         label: 'Spine2',         parent: 'Spine1',         color: '#ffaa44' },
  { name: 'Neck',           label: 'Neck',           parent: 'Spine2',         color: '#ffcc44' },
  { name: 'Head',           label: 'Head',           parent: 'Neck',           color: '#ffee44' },
  // Left arm chain
  { name: 'LeftShoulder',   label: 'L.Shoulder',     parent: 'Spine2',         color: '#44aaff' },
  { name: 'LeftArm',        label: 'L.Arm',          parent: 'LeftShoulder',   color: '#4488ff' },
  { name: 'LeftForeArm',    label: 'L.ForeArm',      parent: 'LeftArm',        color: '#4466ff' },
  { name: 'LeftHand',       label: 'L.Hand',         parent: 'LeftForeArm',    color: '#4444ff' },
  // Left hand fingers
  { name: 'LeftHandThumb1', label: 'L.Thumb1',       parent: 'LeftHand',       color: '#5555ff' },
  { name: 'LeftHandThumb2', label: 'L.Thumb2',       parent: 'LeftHandThumb1', color: '#5555ee' },
  { name: 'LeftHandThumb3', label: 'L.Thumb3',       parent: 'LeftHandThumb2', color: '#5555dd' },
  { name: 'LeftHandThumb4', label: 'L.Thumb4',       parent: 'LeftHandThumb3', color: '#5555cc' },
  { name: 'LeftHandIndex1', label: 'L.Index1',       parent: 'LeftHand',       color: '#6666ff' },
  { name: 'LeftHandIndex2', label: 'L.Index2',       parent: 'LeftHandIndex1', color: '#6666ee' },
  { name: 'LeftHandIndex3', label: 'L.Index3',       parent: 'LeftHandIndex2', color: '#6666dd' },
  { name: 'LeftHandIndex4', label: 'L.Index4',       parent: 'LeftHandIndex3', color: '#6666cc' },
  // Right arm chain
  { name: 'RightShoulder',  label: 'R.Shoulder',     parent: 'Spine2',         color: '#ff44aa' },
  { name: 'RightArm',       label: 'R.Arm',          parent: 'RightShoulder',  color: '#ff4488' },
  { name: 'RightForeArm',   label: 'R.ForeArm',      parent: 'RightArm',       color: '#ff4466' },
  { name: 'RightHand',      label: 'R.Hand',         parent: 'RightForeArm',   color: '#ff4444' },
  // Right hand fingers
  { name: 'RightHandThumb1',label: 'R.Thumb1',       parent: 'RightHand',      color: '#ff5555' },
  { name: 'RightHandThumb2',label: 'R.Thumb2',       parent: 'RightHandThumb1',color: '#ee5555' },
  { name: 'RightHandThumb3',label: 'R.Thumb3',       parent: 'RightHandThumb2',color: '#dd5555' },
  { name: 'RightHandThumb4',label: 'R.Thumb4',       parent: 'RightHandThumb3',color: '#cc5555' },
  { name: 'RightHandIndex1',label: 'R.Index1',       parent: 'RightHand',      color: '#ff6666' },
  { name: 'RightHandIndex2',label: 'R.Index2',       parent: 'RightHandIndex1',color: '#ee6666' },
  { name: 'RightHandIndex3',label: 'R.Index3',       parent: 'RightHandIndex2',color: '#dd6666' },
  { name: 'RightHandIndex4',label: 'R.Index4',       parent: 'RightHandIndex3',color: '#cc6666' },
  // Left leg chain
  { name: 'LeftUpLeg',      label: 'L.UpLeg',        parent: 'Hips',           color: '#44ff88' },
  { name: 'LeftLeg',        label: 'L.Leg',          parent: 'LeftUpLeg',      color: '#44ff66' },
  { name: 'LeftFoot',       label: 'L.Foot',         parent: 'LeftLeg',        color: '#44ff44' },
  { name: 'LeftToeBase',    label: 'L.ToeBase',      parent: 'LeftFoot',       color: '#44ee44' },
  { name: 'LeftToe_End',    label: 'L.ToeEnd',       parent: 'LeftToeBase',    color: '#44dd44' },
  // Right leg chain
  { name: 'RightUpLeg',     label: 'R.UpLeg',        parent: 'Hips',           color: '#aaff44' },
  { name: 'RightLeg',       label: 'R.Leg',          parent: 'RightUpLeg',     color: '#88ff44' },
  { name: 'RightFoot',      label: 'R.Foot',         parent: 'RightLeg',       color: '#66ff44' },
  { name: 'RightToeBase',   label: 'R.ToeBase',      parent: 'RightFoot',      color: '#55ee44' },
  { name: 'RightToe_End',   label: 'R.ToeEnd',       parent: 'RightToeBase',   color: '#55dd44' },
];

// ========================================================================
// Marker → bone calculation
// ========================================================================
export function mirrorMarker(leftPos: Vec3, mirrorCenterX: number): Vec3 {
  return { x: mirrorCenterX + (mirrorCenterX - leftPos.x), y: leftPos.y, z: leftPos.z };
}

export function getDefaultMarkers(centerX: number): MarkerData {
  const left: MarkerData = {
    Chin:       { x: 42.5, y: 13, z: 82 },
    Groin:      { x: 41, y: 13, z: 47.5 },
    LeftWrist:  { x: 9, y: 13, z: 63.5 },
    LeftElbow:  { x: 23, y: 13, z: 70 },
    LeftKnee:   { x: 32.5, y: 15.5, z: 27.5 },
  };
  left['RightWrist'] = mirrorMarker(left['LeftWrist'], centerX);
  left['RightElbow'] = mirrorMarker(left['LeftElbow'], centerX);
  left['RightKnee']  = mirrorMarker(left['LeftKnee'], centerX);
  return left;
}

export function calculateAllBones(
  markers: MarkerData, bodyMaxZ: number,
): Record<string, Vec3> {
  const chin = markers['Chin'];
  const groin = markers['Groin'];
  const lWrist = markers['LeftWrist'];
  const lElbow = markers['LeftElbow'];
  const lKnee = markers['LeftKnee'];
  const rWrist = markers['RightWrist'];
  const rElbow = markers['RightElbow'];
  const rKnee = markers['RightKnee'];

  const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });

  const hips: Vec3 = { x: groin.x, y: groin.y, z: groin.z };
  const neck: Vec3 = { x: chin.x, y: chin.y, z: chin.z - 4 };
  const head: Vec3 = { x: chin.x, y: chin.y, z: Math.min(chin.z + 8, bodyMaxZ) };

  const spine  = lerp3(hips, neck, 0.25);
  const spine1 = lerp3(hips, neck, 0.50);
  const spine2 = lerp3(hips, neck, 0.75);

  // Left arm
  const lShoulderOffset = (lElbow.x - spine2.x) * 0.35;
  const lShoulder: Vec3 = { x: spine2.x + lShoulderOffset, y: spine2.y, z: spine2.z + 2 };
  const lArm = lerp3(lShoulder, lElbow, 0.3);
  const lForeArm: Vec3 = { ...lElbow };
  const lHand: Vec3 = { ...lWrist };

  const lFingerDir = { x: lHand.x - lForeArm.x, y: lHand.y - lForeArm.y, z: lHand.z - lForeArm.z };
  const lFingerLen = Math.sqrt(lFingerDir.x ** 2 + lFingerDir.y ** 2 + lFingerDir.z ** 2) || 1;
  const lFD = { x: lFingerDir.x / lFingerLen, y: lFingerDir.y / lFingerLen, z: lFingerDir.z / lFingerLen };
  const lThumb1: Vec3 = { x: lHand.x + lFD.x * 1, y: lHand.y + lFD.y * 1, z: lHand.z + lFD.z * 1 };
  const lThumb2: Vec3 = { x: lThumb1.x + lFD.x * 0.8, y: lThumb1.y + lFD.y * 0.8, z: lThumb1.z + lFD.z * 0.8 };
  const lThumb3: Vec3 = { x: lThumb2.x + lFD.x * 0.7, y: lThumb2.y + lFD.y * 0.7, z: lThumb2.z + lFD.z * 0.7 };
  const lThumb4: Vec3 = { x: lThumb3.x + lFD.x * 0.5, y: lThumb3.y + lFD.y * 0.5, z: lThumb3.z + lFD.z * 0.5 };
  const lIndex1: Vec3 = { x: lHand.x + lFD.x * 1.5, y: lHand.y + lFD.y * 1.5, z: lHand.z + lFD.z * 1.5 };
  const lIndex2: Vec3 = { x: lIndex1.x + lFD.x * 1, y: lIndex1.y + lFD.y * 1, z: lIndex1.z + lFD.z * 1 };
  const lIndex3: Vec3 = { x: lIndex2.x + lFD.x * 0.8, y: lIndex2.y + lFD.y * 0.8, z: lIndex2.z + lFD.z * 0.8 };
  const lIndex4: Vec3 = { x: lIndex3.x + lFD.x * 0.7, y: lIndex3.y + lFD.y * 0.7, z: lIndex3.z + lFD.z * 0.7 };

  // Right arm
  const rShoulderOffset = (rElbow.x - spine2.x) * 0.35;
  const rShoulder: Vec3 = { x: spine2.x + rShoulderOffset, y: spine2.y, z: spine2.z + 2 };
  const rArm = lerp3(rShoulder, rElbow, 0.3);
  const rForeArm: Vec3 = { ...rElbow };
  const rHand: Vec3 = { ...rWrist };

  const rFingerDir = { x: rHand.x - rForeArm.x, y: rHand.y - rForeArm.y, z: rHand.z - rForeArm.z };
  const rFingerLen = Math.sqrt(rFingerDir.x ** 2 + rFingerDir.y ** 2 + rFingerDir.z ** 2) || 1;
  const rFD = { x: rFingerDir.x / rFingerLen, y: rFingerDir.y / rFingerLen, z: rFingerDir.z / rFingerLen };
  const rThumb1: Vec3 = { x: rHand.x + rFD.x * 1, y: rHand.y + rFD.y * 1, z: rHand.z + rFD.z * 1 };
  const rThumb2: Vec3 = { x: rThumb1.x + rFD.x * 0.8, y: rThumb1.y + rFD.y * 0.8, z: rThumb1.z + rFD.z * 0.8 };
  const rThumb3: Vec3 = { x: rThumb2.x + rFD.x * 0.7, y: rThumb2.y + rFD.y * 0.7, z: rThumb2.z + rFD.z * 0.7 };
  const rThumb4: Vec3 = { x: rThumb3.x + rFD.x * 0.5, y: rThumb3.y + rFD.y * 0.5, z: rThumb3.z + rFD.z * 0.5 };
  const rIndex1: Vec3 = { x: rHand.x + rFD.x * 1.5, y: rHand.y + rFD.y * 1.5, z: rHand.z + rFD.z * 1.5 };
  const rIndex2: Vec3 = { x: rIndex1.x + rFD.x * 1, y: rIndex1.y + rFD.y * 1, z: rIndex1.z + rFD.z * 1 };
  const rIndex3: Vec3 = { x: rIndex2.x + rFD.x * 0.8, y: rIndex2.y + rFD.y * 0.8, z: rIndex2.z + rFD.z * 0.8 };
  const rIndex4: Vec3 = { x: rIndex3.x + rFD.x * 0.7, y: rIndex3.y + rFD.y * 0.7, z: rIndex3.z + rFD.z * 0.7 };

  // Left leg
  const lLegOffsetX = (lKnee.x - groin.x) * 0.8;
  const lUpLeg: Vec3 = { x: groin.x + lLegOffsetX, y: groin.y, z: groin.z };
  const lLeg: Vec3 = { ...lKnee };
  const lFoot: Vec3 = { x: lKnee.x, y: Math.max(lKnee.y - 4, 0), z: 2 };
  const lToeBase: Vec3 = { x: lFoot.x, y: Math.max(lFoot.y - 3, 0), z: 1 };
  const lToeEnd: Vec3 = { x: lToeBase.x, y: Math.max(lToeBase.y - 2, 0), z: 0 };

  // Right leg
  const rLegOffsetX = (rKnee.x - groin.x) * 0.8;
  const rUpLeg: Vec3 = { x: groin.x + rLegOffsetX, y: groin.y, z: groin.z };
  const rLeg: Vec3 = { ...rKnee };
  const rFoot: Vec3 = { x: rKnee.x, y: Math.max(rKnee.y - 4, 0), z: 2 };
  const rToeBase: Vec3 = { x: rFoot.x, y: Math.max(rFoot.y - 3, 0), z: 1 };
  const rToeEnd: Vec3 = { x: rToeBase.x, y: Math.max(rToeBase.y - 2, 0), z: 0 };

  return {
    Hips: hips, Spine: spine, Spine1: spine1, Spine2: spine2,
    Neck: neck, Head: head,
    LeftShoulder: lShoulder, LeftArm: lArm, LeftForeArm: lForeArm, LeftHand: lHand,
    LeftHandThumb1: lThumb1, LeftHandThumb2: lThumb2, LeftHandThumb3: lThumb3, LeftHandThumb4: lThumb4,
    LeftHandIndex1: lIndex1, LeftHandIndex2: lIndex2, LeftHandIndex3: lIndex3, LeftHandIndex4: lIndex4,
    RightShoulder: rShoulder, RightArm: rArm, RightForeArm: rForeArm, RightHand: rHand,
    RightHandThumb1: rThumb1, RightHandThumb2: rThumb2, RightHandThumb3: rThumb3, RightHandThumb4: rThumb4,
    RightHandIndex1: rIndex1, RightHandIndex2: rIndex2, RightHandIndex3: rIndex3, RightHandIndex4: rIndex4,
    LeftUpLeg: lUpLeg, LeftLeg: lLeg, LeftFoot: lFoot, LeftToeBase: lToeBase, LeftToe_End: lToeEnd,
    RightUpLeg: rUpLeg, RightLeg: rLeg, RightFoot: rFoot, RightToeBase: rToeBase, RightToe_End: rToeEnd,
  };
}

// ========================================================================
// Coordinate helpers
// ========================================================================
export function voxelToViewer(vx: number, vy: number, vz: number, cx: number, cy: number): Vector3 {
  return new Vector3((vx - cx) * SCALE, vz * SCALE, -(vy - cy) * SCALE);
}

// ========================================================================
// Voxel ↔ bone assignment
// ========================================================================
function distToSegmentSq(px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 0.0001) return apx * apx + apy * apy + apz * apz;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lenSq));
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

export function assignVoxelsToBones(
  voxels: VoxelEntry[],
  bones: Record<string, Vec3>,
): Record<string, VoxelEntry[]> {
  const boneNames = Object.keys(bones);
  const result: Record<string, VoxelEntry[]> = {};
  for (const name of boneNames) result[name] = [];

  // Build children map
  const childrenMap = new Map<string, string[]>();
  for (const name of boneNames) childrenMap.set(name, []);
  for (const def of BONE_DEFS) {
    if (boneNames.includes(def.name) && def.parent && boneNames.includes(def.parent)) {
      childrenMap.get(def.parent)!.push(def.name);
    }
  }

  type Segment = { name: string; ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const segments: Segment[] = [];
  for (const name of boneNames) {
    const b = bones[name];
    const children = childrenMap.get(name) ?? [];
    if (children.length > 0) {
      for (const childName of children) {
        const c = bones[childName];
        segments.push({ name, ax: b.x, ay: b.y, az: b.z, bx: c.x, by: c.y, bz: c.z });
      }
    } else {
      segments.push({ name, ax: b.x, ay: b.y, az: b.z, bx: b.x, by: b.y, bz: b.z });
    }
  }

  for (const v of voxels) {
    let bestBone = segments[0].name;
    let bestDist = Infinity;
    for (const seg of segments) {
      const dist = distToSegmentSq(v.x, v.y, v.z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
      if (dist < bestDist) { bestDist = dist; bestBone = seg.name; }
    }
    result[bestBone].push(v);
  }

  // Connectivity check
  const globalMap = new Map<string, string>();
  for (const [boneName, bvs] of Object.entries(result)) {
    for (const v of bvs) globalMap.set(`${v.x},${v.y},${v.z}`, boneName);
  }

  for (const boneName of boneNames) {
    const bvs = result[boneName];
    if (bvs.length === 0) continue;

    const posSet = new Set<string>();
    const posMap = new Map<string, VoxelEntry>();
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      posSet.add(k);
      posMap.set(k, v);
    }

    const visited = new Set<string>();
    const components: VoxelEntry[][] = [];
    for (const v of bvs) {
      const k = `${v.x},${v.y},${v.z}`;
      if (visited.has(k)) continue;
      const component: VoxelEntry[] = [];
      const queue = [k];
      visited.add(k);
      while (queue.length > 0) {
        const ck = queue.pop()!;
        component.push(posMap.get(ck)!);
        const cv = posMap.get(ck)!;
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${cv.x + dx},${cv.y + dy},${cv.z + dz}`;
          if (posSet.has(nk) && !visited.has(nk)) { visited.add(nk); queue.push(nk); }
        }
      }
      components.push(component);
    }

    if (components.length <= 1) continue;
    components.sort((a, b) => b.length - a.length);
    result[boneName] = components[0];
    for (let ci = 1; ci < components.length; ci++) {
      for (const v of components[ci]) {
        let reassignTo: string | null = null;
        let reassignDist = Infinity;
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
          const nb = globalMap.get(nk);
          if (nb && nb !== boneName) {
            for (const seg of segments) {
              if (seg.name !== nb) continue;
              const d = distToSegmentSq(v.x, v.y, v.z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
              if (d < reassignDist) { reassignDist = d; reassignTo = nb; }
            }
          }
        }
        if (!reassignTo) {
          let bestDist = Infinity;
          for (const seg of segments) {
            if (seg.name === boneName) continue;
            const d = distToSegmentSq(v.x, v.y, v.z, seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz);
            if (d < bestDist) { bestDist = d; reassignTo = seg.name; }
          }
        }
        if (reassignTo) {
          result[reassignTo].push(v);
          globalMap.set(`${v.x},${v.y},${v.z}`, reassignTo);
        }
      }
    }
  }
  return result;
}

// ========================================================================
// Sphere caps at bone boundaries
// ========================================================================
export function addSphereCaps(boneVoxels: Record<string, VoxelEntry[]>): void {
  const boneMaps = new Map<string, Map<string, VoxelEntry>>();
  for (const [boneName, voxels] of Object.entries(boneVoxels)) {
    const m = new Map<string, VoxelEntry>();
    for (const v of voxels) m.set(`${v.x},${v.y},${v.z}`, v);
    boneMaps.set(boneName, m);
  }

  const processedPairs = new Set<string>();
  const toAdd = new Map<string, VoxelEntry[]>();
  for (const name of Object.keys(boneVoxels)) toAdd.set(name, []);

  for (const [boneName] of Object.entries(boneVoxels)) {
    const thisMap = boneMaps.get(boneName)!;
    const adjBoundary = new Map<string, Map<string, VoxelEntry>>();
    for (const [k, v] of thisMap) {
      for (const [dx, dy, dz] of FACE_DIRS) {
        const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
        if (thisMap.has(nk)) continue;
        for (const [otherName, otherMap] of boneMaps) {
          if (otherName !== boneName && otherMap.has(nk)) {
            if (!adjBoundary.has(otherName)) adjBoundary.set(otherName, new Map());
            adjBoundary.get(otherName)!.set(k, v);
            break;
          }
        }
      }
    }

    for (const [otherName, thisBnd] of adjBoundary) {
      const pairKey = [boneName, otherName].sort().join('|');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const otherMap = boneMaps.get(otherName)!;
      const otherBnd = new Map<string, VoxelEntry>();
      for (const [, v] of otherMap) {
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
          if (thisMap.has(nk)) { otherBnd.set(`${v.x},${v.y},${v.z}`, v); break; }
        }
      }

      let tx = 0, ty = 0, tz = 0;
      for (const v of thisBnd.values()) { tx += v.x; ty += v.y; tz += v.z; }
      tx /= thisBnd.size; ty /= thisBnd.size; tz /= thisBnd.size;

      let ox = 0, oy = 0, oz = 0;
      for (const v of otherBnd.values()) { ox += v.x; oy += v.y; oz += v.z; }
      ox /= otherBnd.size; oy /= otherBnd.size; oz /= otherBnd.size;

      const mx = (tx + ox) / 2, my = (ty + oy) / 2, mz = (tz + oz) / 2;
      const ndx = ox - tx, ndy = oy - ty, ndz = oz - tz;
      const nLen = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz) || 1;
      const nnx = ndx / nLen, nny = ndy / nLen, nnz = ndz / nLen;

      let maxDistSq = 0;
      for (const v of thisBnd.values()) {
        const dsq = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2;
        if (dsq > maxDistSq) maxDistSq = dsq;
      }
      for (const v of otherBnd.values()) {
        const dsq = (v.x - mx) ** 2 + (v.y - my) ** 2 + (v.z - mz) ** 2;
        if (dsq > maxDistSq) maxDistSq = dsq;
      }
      const radius = Math.max(1, Math.sqrt(maxDistSq) / 2);
      const radiusSq = radius * radius;
      const ri = Math.ceil(radius);

      const allBnd = [...thisBnd.values(), ...otherBnd.values()];
      for (let sx = -ri; sx <= ri; sx++) {
        for (let sy = -ri; sy <= ri; sy++) {
          for (let sz = -ri; sz <= ri; sz++) {
            const vx = Math.round(mx) + sx;
            const vy = Math.round(my) + sy;
            const vz = Math.round(mz) + sz;
            if ((vx - mx) ** 2 + (vy - my) ** 2 + (vz - mz) ** 2 > radiusSq) continue;

            const k = `${vx},${vy},${vz}`;
            let nearestDist = Infinity;
            let nearestColor = { r: 0.5, g: 0.5, b: 0.5 };
            for (const bv of allBnd) {
              const d = (vx - bv.x) ** 2 + (vy - bv.y) ** 2 + (vz - bv.z) ** 2;
              if (d < nearestDist) { nearestDist = d; nearestColor = { r: bv.r, g: bv.g, b: bv.b }; }
            }
            const entry: VoxelEntry = { x: vx, y: vy, z: vz, r: nearestColor.r, g: nearestColor.g, b: nearestColor.b };

            const depthProj = (vx - mx) * nnx + (vy - my) * nny + (vz - mz) * nnz;
            if (depthProj > 0) {
              if (!thisMap.has(k)) toAdd.get(boneName)!.push(entry);
            } else {
              if (!otherMap.has(k)) toAdd.get(otherName)!.push(entry);
            }
          }
        }
      }
    }
  }

  for (const [boneName, addVoxels] of toAdd) {
    if (addVoxels.length > 0) boneVoxels[boneName].push(...addVoxels);
  }
}

// ========================================================================
// Unlit shader material (shared)
// ========================================================================
export function createUnlitMaterial(scene: Scene, name: string): ShaderMaterial {
  Effect.ShadersStore[name + 'VertexShader'] = `
    precision highp float;
    attribute vec3 position;
    attribute vec4 color;
    uniform mat4 worldViewProjection;
    varying vec4 vColor;
    void main() { gl_Position = worldViewProjection * vec4(position, 1.0); vColor = color; }
  `;
  Effect.ShadersStore[name + 'FragmentShader'] = `
    precision highp float;
    varying vec4 vColor;
    void main() { gl_FragColor = vColor; }
  `;
  const mat = new ShaderMaterial(name, scene, { vertex: name, fragment: name }, {
    attributes: ['position', 'color'], uniforms: ['worldViewProjection'],
    needAlphaBlending: false,
  });
  mat.backFaceCulling = false;
  mat.forceDepthWrite = true;
  return mat;
}

// ========================================================================
// Mesh builders
// ========================================================================
function buildBoneMeshLocal(
  voxels: VoxelEntry[], scene: Scene, name: string,
  cx: number, cy: number, bonePos: Vec3,
): Mesh {
  const boneViewX = (bonePos.x - cx) * SCALE;
  const boneViewY = bonePos.z * SCALE;
  const boneViewZ = -(bonePos.y - cy) * SCALE;

  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  for (const voxel of voxels) {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      if (occupied.has(`${voxel.x + dx},${voxel.y + dy},${voxel.z + dz}`)) continue;
      const bi = positions.length / 3;
      const fv = FACE_VERTS[f], fn = FACE_NORMALS[f];
      for (let vi = 0; vi < 4; vi++) {
        positions.push(
          (voxel.x + fv[vi][0] - cx) * SCALE - boneViewX,
          (voxel.z + fv[vi][2]) * SCALE - boneViewY,
          -(voxel.y + fv[vi][1] - cy) * SCALE - boneViewZ,
        );
        normals.push(fn[0], fn[2], -fn[1]);
        colors.push(voxel.r, voxel.g, voxel.b, 1);
      }
      indices.push(bi, bi + 1, bi + 2, bi, bi + 2, bi + 3);
    }
  }
  const vd = new VertexData();
  vd.positions = positions; vd.normals = normals; vd.colors = colors; vd.indices = indices;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = createUnlitMaterial(scene, name + '_unlit');
  return mesh;
}

/**
 * Build a full skeletal voxel character with bone hierarchy.
 * Returns TransformNodes (for animation) and Meshes (for rendering).
 */
export function buildSkeletalCharacter(
  voxels: VoxelEntry[], bones: Record<string, Vec3>,
  scene: Scene, cx: number, cy: number,
  prefix: string = 'char',
): { nodes: Map<string, TransformNode>; meshes: Map<string, Mesh> } {
  const boneVoxels = assignVoxelsToBones(voxels, bones);
  addSphereCaps(boneVoxels);

  const nodes = new Map<string, TransformNode>();
  const meshes = new Map<string, Mesh>();

  for (const boneDef of BONE_DEFS) {
    const bonePos = bones[boneDef.name];
    if (!bonePos) continue;
    const node = new TransformNode(`${prefix}_bone_${boneDef.name}`, scene);
    nodes.set(boneDef.name, node);
  }

  for (const boneDef of BONE_DEFS) {
    const node = nodes.get(boneDef.name);
    const bonePos = bones[boneDef.name];
    if (!node || !bonePos) continue;
    const viewPos = voxelToViewer(bonePos.x, bonePos.y, bonePos.z, cx, cy);

    if (boneDef.parent) {
      const parentNode = nodes.get(boneDef.parent);
      const parentPos = bones[boneDef.parent];
      if (parentNode && parentPos) {
        node.parent = parentNode;
        const parentViewPos = voxelToViewer(parentPos.x, parentPos.y, parentPos.z, cx, cy);
        node.position = viewPos.subtract(parentViewPos);
      } else {
        node.position = viewPos;
      }
    } else {
      node.position = viewPos;
    }
  }

  for (const boneDef of BONE_DEFS) {
    const bv = boneVoxels[boneDef.name];
    const node = nodes.get(boneDef.name);
    const bonePos = bones[boneDef.name];
    if (!bv || bv.length === 0 || !node || !bonePos) continue;

    const mesh = buildBoneMeshLocal(bv, scene, `${prefix}_${boneDef.name}`, cx, cy, bonePos);
    mesh.parent = node;
    mesh.isPickable = false;
    meshes.set(boneDef.name, mesh);
  }

  return { nodes, meshes };
}

// ========================================================================
// Motion clip types
// ========================================================================
export interface BoneFrameData {
  dq: [number, number, number, number];
  dp?: [number, number, number];
}

export interface MotionClip {
  name: string;
  label: string;
  duration: number;
  fps: number;
  frameCount: number;
  fbxBodyHeight: number;
  outputBones: string[];
  bindWorldPositions?: Record<string, [number, number, number]>;
  frames: Record<string, BoneFrameData>[];
}

/**
 * Load a motion clip JSON from URL.
 */
export async function loadMotionClipFromFile(url: string, name: string, label: string): Promise<MotionClip> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}`);
  const data = await resp.json();
  return {
    name, label,
    duration: data.duration,
    fps: data.fps,
    frameCount: data.frameCount,
    fbxBodyHeight: data.fbxBodyHeight || 2.854,
    outputBones: data.outputBones || [],
    bindWorldPositions: data.bindWorldPositions,
    frames: data.frames,
  };
}

/**
 * Convert Three.js quaternion to viewer coordinate system.
 * Viewer = (-Three_x, Three_y, Three_z) → q_viewer = (x, -y, -z, w)
 */
export function threeQuatToViewer(dq: [number, number, number, number]): Quaternion {
  return new Quaternion(dq[0], -dq[1], -dq[2], dq[3]);
}

/**
 * Get bone depth in hierarchy (for UI indentation).
 */
export function getBoneDepth(boneName: string): number {
  let depth = 0;
  let current = BONE_DEFS.find(b => b.name === boneName);
  while (current?.parent) {
    depth++;
    current = BONE_DEFS.find(b => b.name === current!.parent);
  }
  return depth;
}
