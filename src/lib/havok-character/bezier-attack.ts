/**
 * Havok Character System — Bezier attack trajectory computation.
 */
import { Scene, Vector3 } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingType, BodyMotion, BezierAttackPath } from './types';
import { neutralBody } from './types';
import { getWorldPos, getCharacterDirections } from './helpers';
import { getWeaponTipWorld } from './weapon';

/**
 * De Casteljau アルゴリズムでN次Bezier曲線を評価。
 */
export function evaluateBezier(points: Vector3[], t: number): Vector3 {
  if (points.length === 1) return points[0].clone();
  const next: Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    next.push(Vector3.Lerp(points[i], points[i + 1], t));
  }
  return evaluateBezier(next, t);
}

/**
 * 攻撃軌道をBezier曲線で計算。
 */
export function computeAttackPath(
  scene: Scene,
  attacker: HavokCharacter,
  target: HavokCharacter,
  hitPos: Vector3,
  preferredType: SwingType,
): BezierAttackPath {
  const dirs = getCharacterDirections(attacker);
  if (!dirs || !attacker.weapon) {
    return { controlPoints: [hitPos], resolvedSwingType: preferredType };
  }

  const { forward, charRight } = dirs;
  const weapon = attacker.weapon;

  const handPos = attacker.weaponSwing.baseHandPos.clone();

  const toHit = hitPos.subtract(handPos).normalize();
  const handStrikePos = hitPos.subtract(toHit.scale(weapon.length * 0.6));

  let blocked = false;
  let blockPoint = Vector3.Zero();

  if (target.weaponMesh) {
    const opTip = getWeaponTipWorld(target);
    const opGrip = getWorldPos(target.weaponAttachR);
    const closestDist = distanceLineToLine(handPos, handStrikePos, opGrip, opTip);
    if (closestDist < 0.2) {
      blocked = true;
      blockPoint = Vector3.Lerp(opGrip, opTip, 0.5);
    }
  }

  let controlPoints: Vector3[];
  let resolvedType = preferredType;

  if (blocked) {
    const blockRelY = blockPoint.y - handStrikePos.y;

    if (blockRelY > 0.1) {
      const waypoint = Vector3.Lerp(handPos, handStrikePos, 0.5)
        .add(new Vector3(0, -0.3, 0))
        .add(charRight.scale(0.2));
      controlPoints = [handPos, waypoint, handStrikePos];
      resolvedType = 'horizontal';
    } else if (blockRelY < -0.1) {
      const waypoint = Vector3.Lerp(handPos, handStrikePos, 0.5)
        .add(new Vector3(0, 0.3, 0));
      controlPoints = [handPos, waypoint, handStrikePos];
      resolvedType = 'vertical';
    } else {
      const waypoint = Vector3.Lerp(handPos, handStrikePos, 0.4)
        .add(charRight.scale(0.3));
      controlPoints = [handPos, waypoint, handStrikePos];
      resolvedType = 'thrust';
    }
  } else {
    const headBone = attacker.combatBones.get('head');
    const headPos = headBone ? getWorldPos(headBone) : handPos.add(new Vector3(0, 0.3, 0));
    const hipsBone = attacker.combatBones.get('hips');
    const hipsPos = hipsBone ? getWorldPos(hipsBone) : handPos.add(new Vector3(0, -0.3, 0));

    let windupPos: Vector3;
    switch (preferredType) {
      case 'vertical':
        windupPos = headPos.add(new Vector3(0, 0.15, 0)).add(forward.scale(-0.1)).add(charRight.scale(0.05));
        break;
      case 'horizontal':
        windupPos = handPos.add(charRight.scale(0.4)).add(new Vector3(0, 0.1, 0));
        break;
      default: // thrust
        windupPos = handPos.add(forward.scale(-0.2));
        break;
    }
    controlPoints = [handPos, windupPos, handStrikePos];
  }

  return { controlPoints, resolvedSwingType: resolvedType };
}

/** 2本の線分間の最短距離 */
function distanceLineToLine(
  a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3,
): number {
  const u = a1.subtract(a0);
  const v = b1.subtract(b0);
  const w = a0.subtract(b0);

  const uu = Vector3.Dot(u, u);
  const uv = Vector3.Dot(u, v);
  const vv = Vector3.Dot(v, v);
  const uw = Vector3.Dot(u, w);
  const vw = Vector3.Dot(v, w);

  const denom = uu * vv - uv * uv;
  let s: number, t: number;

  if (denom < 0.0001) {
    s = 0; t = uw / (uv || 1);
  } else {
    s = (uv * vw - vv * uw) / denom;
    t = (uu * vw - uv * uw) / denom;
  }

  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));

  const closest1 = a0.add(u.scale(s));
  const closest2 = b0.add(v.scale(t));
  return Vector3.Distance(closest1, closest2);
}

/**
 * Bezier軌道ベースのSwingMotionを作成。
 */
export function createBezierSwingMotion(
  character: HavokCharacter,
  path: BezierAttackPath,
  power: number = 100,
): SwingMotion {
  const p = Math.max(0, Math.min(100, power)) / 100;
  const weapon = character.weapon;
  if (!weapon) {
    return { type: path.resolvedSwingType, progress: 0, duration: 0.6, windupRatio: 0.4,
      startPos: Vector3.Zero(), windupPos: Vector3.Zero(), strikePos: Vector3.Zero(),
      active: false, power: 0, windupBody: neutralBody(), strikeBody: neutralBody(),
      startOffset: Vector3.Zero(), windupOffset: Vector3.Zero(), strikeOffset: Vector3.Zero(), rootPosAtStart: Vector3.Zero() };
  }

  const cp = path.controlPoints;
  const startPos = cp[0].clone();
  const windupPos = cp.length > 2 ? evaluateBezier(cp, 0.35) : Vector3.Lerp(cp[0], cp[cp.length - 1], 0.35);
  const strikePos = cp[cp.length - 1].clone();

  const baseDuration = 0.4 + (1.0 - p) * 0.1;
  const weightFactor = 1.0 + (weapon.weight - 1.0) * 0.08;

  const type = path.resolvedSwingType;
  let windupBody: BodyMotion, strikeBody: BodyMotion;

  switch (type) {
    case 'vertical':
      windupBody = { torsoLean: -0.15 * p, torsoTwist: 0.1 * p, hipsOffset: 0.02 * p,
        hipsForward: -0.03 * p, footStepR: -0.05 * p,
        offHandOffset: new Vector3(-0.05 * p, 0.1 * p, -0.05 * p) };
      strikeBody = { torsoLean: 0.35 * p, torsoTwist: -0.05 * p, hipsOffset: -0.08 * p,
        hipsForward: 0.08 * p, footStepR: 0.12 * p,
        offHandOffset: new Vector3(0.1 * p, -0.1 * p, 0.05 * p) };
      break;
    case 'horizontal':
      windupBody = { torsoLean: 0, torsoTwist: 0.35 * p, hipsOffset: 0,
        hipsForward: -0.02 * p, footStepR: 0.05 * p,
        offHandOffset: new Vector3(-0.1 * p, 0.05 * p, -0.08 * p) };
      strikeBody = { torsoLean: 0.1 * p, torsoTwist: -0.3 * p, hipsOffset: -0.03 * p,
        hipsForward: 0.05 * p, footStepR: -0.03 * p,
        offHandOffset: new Vector3(0.15 * p, -0.05 * p, 0.1 * p) };
      break;
    default: // thrust
      windupBody = { torsoLean: -0.1 * p, torsoTwist: 0.1 * p, hipsOffset: 0.02 * p,
        hipsForward: -0.08 * p, footStepR: -0.08 * p,
        offHandOffset: new Vector3(-0.08 * p, 0.05 * p, -0.1 * p) };
      strikeBody = { torsoLean: 0.25 * p, torsoTwist: -0.05 * p, hipsOffset: -0.04 * p,
        hipsForward: 0.15 * p, footStepR: 0.18 * p,
        offHandOffset: new Vector3(0.05 * p, -0.08 * p, 0) };
      break;
  }

  const rootPos = character.root.position.clone();
  return {
    type,
    progress: 0,
    duration: baseDuration * weightFactor,
    windupRatio: 0.35 + p * 0.1,
    startPos, windupPos, strikePos,
    active: true,
    power: p,
    windupBody, strikeBody,
    startOffset: startPos.subtract(rootPos),
    windupOffset: windupPos.subtract(rootPos),
    strikeOffset: strikePos.subtract(rootPos),
    rootPosAtStart: rootPos,
  };
}
