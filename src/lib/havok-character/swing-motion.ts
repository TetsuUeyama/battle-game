/**
 * Havok Character System — Swing motion generation and application.
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial, TransformNode, Quaternion,
} from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingFrame, BodyMotion, SwingType, WeaponPhysics } from './types';
import { neutralBody } from './types';
import { getWorldPos, getCharacterDirections, getStanceTargets, getOffHandRestPosition } from './helpers';

// ─── Weapon Scale Factors ────────────────────────────────

interface WeaponScaleFactors {
  reachScale: number;
  arcScale: number;
  bodyCommitment: number;
  gripCommitment: number;
  durationScale: number;
}

const BASE_LENGTH = 0.5;
const BASE_WEIGHT = 1.0;

export function getWeaponScaleFactors(weapon: WeaponPhysics): WeaponScaleFactors {
  const ls = Math.max(0.8, Math.min(4.0, weapon.length / BASE_LENGTH));
  const ws = Math.max(0.8, Math.min(10.0, weapon.weight / BASE_WEIGHT));

  return {
    reachScale: Math.min(3.0, 1.0 + (ls - 1.0) * 0.5),
    arcScale: Math.min(2.5, 1.0 + (ls - 1.0) * 0.3),
    bodyCommitment: 1.0 + Math.min(ws - 1.0, 3.0) * 0.15,
    gripCommitment: weapon.gripType === 'two-handed' ? 1.3 : 1.0,
    durationScale: 1.0 + (ws - 1.0) * 0.06,
  };
}

// ─── Attack Type Selection ───────────────────────────────

interface AttackTypeWeight {
  type: SwingType;
  weight: number;
}

export function getPreferredAttackTypes(category?: string): AttackTypeWeight[] {
  switch (category) {
    case 'halberds':
    case 'spears':
      return [
        { type: 'vertical', weight: 0.4 },
        { type: 'thrust', weight: 0.45 },
        { type: 'horizontal', weight: 0.15 },
      ];
    case 'greatswords':
    case 'longswords':
      return [
        { type: 'horizontal', weight: 0.4 },
        { type: 'vertical', weight: 0.4 },
        { type: 'thrust', weight: 0.2 },
      ];
    case 'axes':
    case 'hammers':
    case 'maces':
      return [
        { type: 'vertical', weight: 0.6 },
        { type: 'horizontal', weight: 0.3 },
        { type: 'thrust', weight: 0.1 },
      ];
    case 'daggers':
    case 'short_swords':
      return [
        { type: 'thrust', weight: 0.5 },
        { type: 'horizontal', weight: 0.3 },
        { type: 'vertical', weight: 0.2 },
      ];
    default:
      return [
        { type: 'vertical', weight: 0.34 },
        { type: 'horizontal', weight: 0.33 },
        { type: 'thrust', weight: 0.33 },
      ];
  }
}

export function pickWeightedAttackType(weights: AttackTypeWeight[]): SwingType {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weights) {
    r -= w.weight;
    if (r <= 0) return w.type;
  }
  return weights[weights.length - 1].type;
}

/**
 * 標的の作成: 簡易ポスト型 (棒 + 頭部球)
 */
export function createTarget(
  scene: Scene, position: Vector3, prefix: string,
): { root: TransformNode; meshes: import('@babylonjs/core').Mesh[] } {
  const root = new TransformNode(`${prefix}_target`, scene);
  root.position.copyFrom(position);

  const mat = new StandardMaterial(`${prefix}_targetMat`, scene);
  mat.diffuseColor = new Color3(0.7, 0.2, 0.2);

  const body = MeshBuilder.CreateCylinder(`${prefix}_tBody`, {
    height: 1.2, diameter: 0.25,
  }, scene);
  body.material = mat;
  body.parent = root;
  body.position.y = 0.6;

  const head = MeshBuilder.CreateSphere(`${prefix}_tHead`, { diameter: 0.25 }, scene);
  head.material = mat;
  head.parent = root;
  head.position.y = 1.35;

  const base = MeshBuilder.CreateCylinder(`${prefix}_tBase`, {
    height: 0.05, diameter: 0.4,
  }, scene);
  const baseMat = new StandardMaterial(`${prefix}_tBaseMat`, scene);
  baseMat.diffuseColor = new Color3(0.4, 0.4, 0.4);
  base.material = baseMat;
  base.parent = root;
  base.position.y = 0.025;

  return { root, meshes: [body, head, base] };
}

/** BodyMotion の線形補間 */
function lerpBody(a: BodyMotion, b: BodyMotion, t: number): BodyMotion {
  return {
    torsoLean: a.torsoLean + (b.torsoLean - a.torsoLean) * t,
    torsoTwist: a.torsoTwist + (b.torsoTwist - a.torsoTwist) * t,
    hipsOffset: a.hipsOffset + (b.hipsOffset - a.hipsOffset) * t,
    hipsForward: a.hipsForward + (b.hipsForward - a.hipsForward) * t,
    footStepR: a.footStepR + (b.footStepR - a.footStepR) * t,
    offHandOffset: Vector3.Lerp(a.offHandOffset, b.offHandOffset, t),
  };
}

/**
 * スイングモーションを生成。
 */
export function createSwingMotion(
  character: HavokCharacter,
  targetPos: Vector3,
  type: SwingType = 'vertical',
  power: number = 100,
): SwingMotion {
  const dirs = getCharacterDirections(character);
  if (!dirs || !character.weapon) {
    return { type, progress: 0, duration: 0.6, windupRatio: 0.4, startPos: Vector3.Zero(), windupPos: Vector3.Zero(), strikePos: Vector3.Zero(), active: false, power: 0, windupBody: neutralBody(), strikeBody: neutralBody(), startOffset: Vector3.Zero(), windupOffset: Vector3.Zero(), strikeOffset: Vector3.Zero(), rootPosAtStart: Vector3.Zero() };
  }

  const { forward, charRight } = dirs;
  const weapon = character.weapon;
  const swing = character.weaponSwing;
  const p = Math.max(0, Math.min(100, power)) / 100;
  const sf = getWeaponScaleFactors(weapon);
  const bc = sf.bodyCommitment;
  const gc = sf.gripCommitment;
  const rs = sf.reachScale;

  const startPos = swing.baseHandPos.clone();

  const headBone = character.combatBones.get('head');
  const headPos = headBone ? getWorldPos(headBone) : startPos.add(new Vector3(0, 0.4, 0));
  const hipsBone = character.combatBones.get('hips');
  const hipsPos = hipsBone ? getWorldPos(hipsBone) : startPos.add(new Vector3(0, -0.3, 0));

  let windupPos: Vector3;
  let strikePos: Vector3;

  switch (type) {
    case 'vertical': {
      const fullWindup = headPos
        .add(forward.scale(-0.2 * rs))
        .add(new Vector3(0, 0.1 * rs, 0))
        .add(charRight.scale(0.05));
      windupPos = Vector3.Lerp(startPos, fullWindup, p);

      const fullStrike = hipsPos
        .add(forward.scale(0.35 * rs))
        .add(new Vector3(0, -0.1 * rs, 0))
        .add(charRight.scale(0.05));
      const minStrike = startPos
        .add(forward.scale(0.1))
        .add(new Vector3(0, -0.05, 0));
      strikePos = Vector3.Lerp(minStrike, fullStrike, p);
      break;
    }
    case 'horizontal': {
      const fullWindup = startPos
        .add(charRight.scale(0.5 * rs))
        .add(new Vector3(0, 0.15 * rs, 0))
        .add(forward.scale(-0.05 * rs));
      windupPos = Vector3.Lerp(startPos.add(charRight.scale(0.1 * rs)), fullWindup, p);

      const fullStrike = startPos
        .add(charRight.scale(-0.4 * rs))
        .add(forward.scale(0.2 * rs))
        .add(new Vector3(0, -0.05, 0));
      const minStrike = startPos
        .add(charRight.scale(-0.1))
        .add(forward.scale(0.1));
      strikePos = Vector3.Lerp(minStrike, fullStrike, p);
      break;
    }
    case 'thrust': {
      const fullWindup = startPos
        .add(forward.scale(-0.3 * rs))
        .add(new Vector3(0, 0.05, 0));
      windupPos = Vector3.Lerp(startPos.add(forward.scale(-0.05)), fullWindup, p);

      const toTarget = targetPos.subtract(startPos).normalize();
      const fullStrike = targetPos.subtract(toTarget.scale(weapon.length * 0.5));
      const minStrike = startPos.add(forward.scale(0.15));
      strikePos = Vector3.Lerp(minStrike, fullStrike, p);
      break;
    }
  }

  // ─── ボディモーション (武器重量・グリップで自動スケール) ───
  let windupBody: BodyMotion;
  let strikeBody: BodyMotion;

  switch (type) {
    case 'vertical':
      windupBody = {
        torsoLean: -0.15 * p * bc * gc, torsoTwist: 0.1 * p * bc * gc, hipsOffset: 0.02 * p * bc,
        hipsForward: -0.03 * p * bc, footStepR: -0.05 * p * bc,
        offHandOffset: new Vector3(-0.05 * p * bc, 0.1 * p * bc, -0.05 * p * bc),
      };
      strikeBody = {
        torsoLean: 0.35 * p * bc * gc, torsoTwist: -0.05 * p * bc * gc, hipsOffset: -0.08 * p * bc,
        hipsForward: 0.08 * p * bc, footStepR: 0.12 * p * bc,
        offHandOffset: new Vector3(0.1 * p * bc, -0.1 * p * bc, 0.05 * p * bc),
      };
      break;
    case 'horizontal':
      windupBody = {
        torsoLean: 0, torsoTwist: 0.35 * p * bc * gc, hipsOffset: 0,
        hipsForward: -0.02 * p * bc, footStepR: 0.05 * p * bc,
        offHandOffset: new Vector3(-0.1 * p * bc, 0.05 * p * bc, -0.08 * p * bc),
      };
      strikeBody = {
        torsoLean: 0.1 * p * bc * gc, torsoTwist: -0.3 * p * bc * gc, hipsOffset: -0.03 * p * bc,
        hipsForward: 0.05 * p * bc, footStepR: -0.03 * p * bc,
        offHandOffset: new Vector3(0.15 * p * bc, -0.05 * p * bc, 0.1 * p * bc),
      };
      break;
    case 'thrust':
      windupBody = {
        torsoLean: -0.1 * p * bc * gc, torsoTwist: 0.1 * p * bc * gc, hipsOffset: 0.02 * p * bc,
        hipsForward: -0.08 * p * bc, footStepR: -0.08 * p * bc,
        offHandOffset: new Vector3(-0.08 * p * bc, 0.05 * p * bc, -0.1 * p * bc),
      };
      strikeBody = {
        torsoLean: 0.25 * p * bc * gc, torsoTwist: -0.05 * p * bc * gc, hipsOffset: -0.04 * p * bc,
        hipsForward: 0.15 * p * bc, footStepR: 0.18 * p * bc,
        offHandOffset: new Vector3(0.05 * p * bc, -0.08 * p * bc, 0),
      };
      break;
  }

  const baseDuration = 0.4 + (1.0 - p) * 0.1;
  const duration = baseDuration * sf.durationScale;

  const rootPos = character.root.position.clone();
  return {
    type, progress: 0, duration, windupRatio: 0.35 + p * 0.1,
    startPos, windupPos, strikePos,
    active: true, power: p, windupBody, strikeBody,
    startOffset: startPos.subtract(rootPos),
    windupOffset: windupPos.subtract(rootPos),
    strikeOffset: strikePos.subtract(rootPos),
    rootPosAtStart: rootPos,
  };
}

/**
 * スイングモーション更新。毎フレーム呼び出し。
 */
export function updateSwingMotion(motion: SwingMotion, dt: number, currentRootPos?: Vector3): SwingFrame | null {
  if (!motion.active) return null;

  motion.progress += dt / motion.duration;
  if (motion.progress >= 1.0) {
    motion.progress = 1.0;
    motion.active = false;
  }

  const root = currentRootPos ?? motion.rootPosAtStart;
  const p = motion.progress;
  const wr = motion.windupRatio;
  const zero = neutralBody();

  // 弧を描く攻撃 (horizontal)
  if (motion.arcSwing) {
    const arc = motion.arcSwing;
    const spineCenter = root.add(arc.centerOffset);

    let arcAngle: number;
    let body: BodyMotion;

    if (p < wr) {
      const t = p / wr;
      const eased = t * t;
      arcAngle = arc.windupAngle * eased;
      body = lerpBody(zero, motion.windupBody, eased);
    } else {
      const t = (p - wr) / (1.0 - wr);
      const eased = 1.0 - (1.0 - t) * (1.0 - t);
      arcAngle = arc.windupAngle + (arc.strikeAngle - arc.windupAngle) * eased;
      body = lerpBody(motion.windupBody, motion.strikeBody, eased);
    }

    const fwdDir = motion.strikeOffset.clone();
    fwdDir.y = 0;
    if (fwdDir.length() > 0.01) fwdDir.normalize();
    else fwdDir.set(0, 0, 1);
    const baseAngle = Math.atan2(fwdDir.x, fwdDir.z);

    const twistAngle = baseAngle + arcAngle;
    const shoulderAngle = twistAngle + Math.PI / 2;
    const shoulderDist = 0.15;
    const shoulderPos = new Vector3(
      spineCenter.x + Math.sin(shoulderAngle) * shoulderDist,
      root.y + arc.height,
      spineCenter.z + Math.cos(shoulderAngle) * shoulderDist,
    );

    const armReach = arc.radius;
    const reachBonus = Math.max(0, body.torsoLean) * 0.2;
    const handTarget = new Vector3(
      shoulderPos.x + Math.sin(twistAngle) * (armReach + reachBonus),
      shoulderPos.y - 0.05,
      shoulderPos.z + Math.cos(twistAngle) * (armReach + reachBonus),
    );

    return { handTarget, body };
  }

  // 通常の線形補間
  const start = root.add(motion.startOffset);
  const windup = root.add(motion.windupOffset);
  const strike = root.add(motion.strikeOffset);

  if (p < wr) {
    const t = p / wr;
    const eased = t * t;
    return {
      handTarget: Vector3.Lerp(start, windup, eased),
      body: lerpBody(zero, motion.windupBody, eased),
    };
  } else {
    const t = (p - wr) / (1.0 - wr);
    const eased = 1.0 - (1.0 - t) * (1.0 - t);
    return {
      handTarget: Vector3.Lerp(windup, strike, eased),
      body: lerpBody(motion.windupBody, motion.strikeBody, eased),
    };
  }
}

/**
 * ボディモーションをキャラクターに適用。
 */
export function applyBodyMotion(
  character: HavokCharacter,
  body: BodyMotion,
  forward: Vector3,
  charRight: Vector3,
): void {
  // ─── 胴体回転 (Spine1 = 'torso') ───
  const spineBone = character.allBones.get('mixamorig:Spine1');
  if (spineBone) {
    const baseRot = character.ikBaseRotations.get(spineBone.name);
    if (baseRot) {
      const leanQuat = Quaternion.RotationAxis(charRight, body.torsoLean);
      const twistQuat = Quaternion.RotationAxis(Vector3.Up(), body.torsoTwist);
      spineBone.rotationQuaternion = twistQuat.multiply(leanQuat).multiply(baseRot.root);
    }
  }

  // ─── 腰の移動 ───
  const hipsBone = character.allBones.get('mixamorig:Hips');
  if (hipsBone) {
    hipsBone.position.y = character.hipsBaseY + body.hipsOffset;
  }
  if (Math.abs(body.hipsForward) > 0.001) {
    character.root.position.addInPlace(forward.scale(body.hipsForward));
  }

  // オフハンド(画面左手)の揺れ
  if (character.weapon && character.weapon.gripType === 'one-handed'
      && character.ikChains.rightArm.weight > 0) {
    const restPos = getOffHandRestPosition(character);
    if (restPos) {
      const offset = forward.scale(body.offHandOffset.x)
        .add(Vector3.Up().scale(body.offHandOffset.y))
        .add(charRight.scale(body.offHandOffset.z));
      character.ikChains.rightArm.target.copyFrom(restPos.add(offset));
    }
  }
}
