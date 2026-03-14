/**
 * Hitbox detection: check if attacker's hit bones overlap defender's hitzones.
 * Uses capsule-based collision (line segment between parent-child bones).
 */

import { Vector3 } from '@babylonjs/core';
import { TransformNode } from '@babylonjs/core';
import { HITZONES } from '@/GamePlay/FightGame/Config/FighterConfig';
import { BONE_DEFS } from '@/lib/voxel-skeleton';
import type { AttackDef } from '@/GamePlay/FightGame/Config/AttackConfig';

export interface HitResult {
  hit: boolean;
  damageMultiplier: number;
  hitzoneName: string;
  hitPoint: Vector3;
}

/** Get world position of a bone node */
function getBoneWorldPos(nodes: Map<string, TransformNode>, boneName: string): Vector3 | null {
  const node = nodes.get(boneName);
  if (!node) return null;
  return node.getAbsolutePosition();
}

/** Find the parent bone name from BONE_DEFS */
const boneParentMap = new Map<string, string>();
for (const bd of BONE_DEFS) {
  if (bd.parent) boneParentMap.set(bd.name, bd.parent);
}

/**
 * Minimum distance between two line segments (capsule vs capsule).
 * segment A: p0→p1, segment B: q0→q1
 * Returns the minimum distance and the closest points.
 */
function segmentSegmentDist(
  p0: Vector3, p1: Vector3, q0: Vector3, q1: Vector3,
): { dist: number; closestA: Vector3; closestB: Vector3 } {
  const d1 = p1.subtract(p0); // direction of segment A
  const d2 = q1.subtract(q0); // direction of segment B
  const r = p0.subtract(q0);

  const a = Vector3.Dot(d1, d1);
  const e = Vector3.Dot(d2, d2);
  const f = Vector3.Dot(d2, r);

  let s: number, t: number;

  if (a <= 1e-8 && e <= 1e-8) {
    // Both degenerate to points
    s = t = 0;
  } else if (a <= 1e-8) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = Vector3.Dot(d1, r);
    if (e <= 1e-8) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = Vector3.Dot(d1, d2);
      const denom = a * e - b * b;

      if (Math.abs(denom) > 1e-8) {
        s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
      } else {
        s = 0;
      }
      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  const closestA = p0.add(d1.scale(s));
  const closestB = q0.add(d2.scale(t));
  const dist = Vector3.Distance(closestA, closestB);
  return { dist, closestA, closestB };
}

/**
 * Get a bone segment: [bonePos, parentBonePos] for capsule collision.
 * Falls back to point if no parent found.
 */
function getBoneSegment(
  nodes: Map<string, TransformNode>, boneName: string,
): { start: Vector3; end: Vector3 } | null {
  const pos = getBoneWorldPos(nodes, boneName);
  if (!pos) return null;

  const parentName = boneParentMap.get(boneName);
  if (parentName) {
    const parentPos = getBoneWorldPos(nodes, parentName);
    if (parentPos) {
      return { start: parentPos, end: pos };
    }
  }
  // No parent — use point as degenerate segment
  return { start: pos, end: pos };
}

/**
 * Check if attacker's hitbox bones intersect any of defender's hitzones.
 * Uses capsule-to-capsule collision for better accuracy.
 */
export function checkHit(
  attack: AttackDef,
  attackerNodes: Map<string, TransformNode>,
  defenderNodes: Map<string, TransformNode>,
): HitResult {
  const noHit: HitResult = { hit: false, damageMultiplier: 1, hitzoneName: '', hitPoint: Vector3.Zero() };

  // Get attacker hitbox segments
  const atkSegments: { start: Vector3; end: Vector3 }[] = [];
  for (const boneName of attack.hitBones) {
    const seg = getBoneSegment(attackerNodes, boneName);
    if (seg) atkSegments.push(seg);
  }
  if (atkSegments.length === 0) return noHit;

  // Check each hitzone
  for (const hitzone of HITZONES) {
    for (const defBoneName of hitzone.bones) {
      const defSeg = getBoneSegment(defenderNodes, defBoneName);
      if (!defSeg) continue;

      for (const atkSeg of atkSegments) {
        const { dist, closestA, closestB } = segmentSegmentDist(
          atkSeg.start, atkSeg.end,
          defSeg.start, defSeg.end,
        );

        const threshold = attack.hitRadius + hitzone.radius;

        if (dist < threshold) {
          return {
            hit: true,
            damageMultiplier: hitzone.damageMultiplier,
            hitzoneName: hitzone.label,
            hitPoint: Vector3.Center(closestA, closestB),
          };
        }
      }
    }
  }

  return noHit;
}
