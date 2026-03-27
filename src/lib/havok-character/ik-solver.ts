/**
 * Havok Character System — 2-Bone IK solver and joint angle limits.
 */
import { Vector3, Quaternion, TransformNode } from '@babylonjs/core';
import type { IKChain, HavokCharacter } from './types';
import { JOINT_LIMITS } from './types';
import {
  getWorldPos, distanceBetweenBones, rotationBetweenVectors, applyWorldDeltaRotation,
} from './helpers';

/**
 * Analytic 2-bone IK solver operating on TransformNodes.
 *
 * Algorithm:
 * 1. Compute desired mid-joint position using law of cosines + pole vector
 * 2. Compute world rotations for root and mid joints
 * 3. Convert to local rotations relative to parents
 */
export function solveIK2Bone(chain: IKChain, character: HavokCharacter): void {
  if (chain.weight <= 0) return;

  const { root, mid, end, lengthA, lengthB, target, poleHint } = chain;

  // Use T-pose rotations stored at character creation (never overwritten)
  const chainKey = root.name;
  const baseRots = character.ikBaseRotations.get(chainKey);
  if (!baseRots) return;

  // Reset to base rotations before solving (prevents accumulation)
  root.rotationQuaternion = baseRots.root.clone();
  mid.rotationQuaternion = baseRots.mid.clone();

  // Recompute world matrices after reset
  root.computeWorldMatrix(true);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);

  // Current world positions
  const rootPos = root.getAbsolutePosition().clone();
  const midPos = mid.getAbsolutePosition().clone();
  const endPos = end.getAbsolutePosition().clone();

  // Distance to target
  const toTarget = target.subtract(rootPos);
  let targetDist = toTarget.length();
  if (targetDist < 0.001) return;

  // Clamp to reachable range
  const maxReach = lengthA + lengthB - 0.001;
  const minReach = Math.abs(lengthA - lengthB) + 0.001;
  targetDist = Math.max(minReach, Math.min(maxReach, targetDist));

  // ─── Step 1: Find desired mid-joint position ───

  const cosA = (lengthA * lengthA + targetDist * targetDist - lengthB * lengthB)
    / (2 * lengthA * targetDist);
  const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));

  const targetDir = toTarget.normalize();

  const poleDot = Vector3.Dot(poleHint, targetDir);
  let bendDir = poleHint.subtract(targetDir.scale(poleDot));
  if (bendDir.length() < 0.001) {
    const currentBend = midPos.subtract(rootPos);
    const cd = Vector3.Dot(currentBend, targetDir);
    bendDir = currentBend.subtract(targetDir.scale(cd));
  }
  bendDir.normalize();

  const desiredMid = rootPos
    .add(targetDir.scale(Math.cos(angleA) * lengthA))
    .add(bendDir.scale(Math.sin(angleA) * lengthA));

  // ─── Step 2: Rotate root joint to point at desiredMid ───

  const currentRootToMid = midPos.subtract(rootPos).normalize();
  const desiredRootToMid = desiredMid.subtract(rootPos).normalize();

  const rootDeltaWorld = rotationBetweenVectors(currentRootToMid, desiredRootToMid);
  applyWorldDeltaRotation(root, rootDeltaWorld, chain.weight);

  root.computeWorldMatrix(true);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);

  // ─── Step 3: Rotate mid joint to point end at target ───

  const newMidPos = mid.getAbsolutePosition().clone();
  const newEndPos = end.getAbsolutePosition().clone();

  const currentMidToEnd = newEndPos.subtract(newMidPos).normalize();
  const desiredMidToEnd = target.subtract(newMidPos).normalize();

  const midDeltaWorld = rotationBetweenVectors(currentMidToEnd, desiredMidToEnd);
  applyWorldDeltaRotation(mid, midDeltaWorld, chain.weight);
}

/**
 * IK解決後の関節角度を可動域に制限する。
 * mid joint (肘/膝) の曲げ角度をクランプする。
 */
export function clampJointAngles(chain: IKChain, character: HavokCharacter, limbType: 'arm' | 'leg'): void {
  if (chain.weight <= 0) return;

  const limits = JOINT_LIMITS[limbType];
  const { root, mid, end } = chain;

  root.computeWorldMatrix(true);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);

  const rootPos = root.getAbsolutePosition();
  const midPos = mid.getAbsolutePosition();
  const endPos = end.getAbsolutePosition();

  const v1 = rootPos.subtract(midPos).normalize();
  const v2 = endPos.subtract(midPos).normalize();
  const dot = Math.max(-1, Math.min(1, Vector3.Dot(v1, v2)));
  const currentAngleDeg = Math.acos(dot) * 180 / Math.PI;
  const bendAngle = 180 - currentAngleDeg;

  const minBend = limits.mid.minBendDeg;
  const maxBend = limits.mid.maxBendDeg;

  if (bendAngle < minBend || bendAngle > maxBend) {
    const clampedBend = Math.max(minBend, Math.min(maxBend, bendAngle));
    const targetInternalAngle = 180 - clampedBend;
    const currentInternalAngle = currentAngleDeg;
    const correction = targetInternalAngle - currentInternalAngle;

    if (Math.abs(correction) > 0.1) {
      const normal = Vector3.Cross(v1, v2);
      if (normal.length() > 0.001) {
        normal.normalize();
        const correctionRad = correction * Math.PI / 180;
        const correctionQuat = Quaternion.RotationAxis(normal, correctionRad);
        applyWorldDeltaRotation(mid, correctionQuat, 1.0);
      }
    }
  }
}

export function createIKChains(
  allBones: Map<string, TransformNode>,
): { leftArm: IKChain; rightArm: IKChain; leftLeg: IKChain; rightLeg: IKChain } {
  function getBone(name: string): TransformNode {
    const b = allBones.get(name);
    if (!b) throw new Error(`IK bone not found: ${name}`);
    return b;
  }

  function makeChain(
    rootName: string, midName: string, endName: string, pole: Vector3,
  ): IKChain {
    const r = getBone(rootName);
    const m = getBone(midName);
    const e = getBone(endName);
    return {
      root: r, mid: m, end: e,
      lengthA: distanceBetweenBones(r, m),
      lengthB: distanceBetweenBones(m, e),
      poleHint: pole,
      target: getWorldPos(e).clone(),
      weight: 0,
    };
  }

  return {
    leftArm:  makeChain('mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand', new Vector3(0, 0, -1)),
    rightArm: makeChain('mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand', new Vector3(0, 0, -1)),
    leftLeg:  makeChain('mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot', new Vector3(0, 0, 1)),
    rightLeg: makeChain('mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot', new Vector3(0, 0, 1)),
  };
}
