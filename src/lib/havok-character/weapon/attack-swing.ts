/**
 * 武器の振り方の定義。
 *
 * SwingMotion の生成・毎フレーム更新・ボディモーションのキャラクターへの適用を担当。
 * 武器の長さ・重さに基づいて振りの大きさ・体の動き・速度を自動スケールする。
 *
 * ■ 攻撃タイプ
 *   - vertical:    縦振り (振りかぶり→振り下ろし)
 *   - horizontal:  横振り (薙ぎ払い)。arcSwing使用時は上半身回転で弧を描く
 *   - thrust:      突き。前方直線的な軌道
 *
 * ■ モーション進行 (updateSwingMotion)
 *   progress 0→windupRatio: 構え→振りかぶり (ease-in: t*t)
 *   progress windupRatio→1: 振りかぶり→打撃 (ease-out: 1-(1-t)^2)
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingFrame, BodyMotion, SwingType, WeaponPhysics } from '../types';
import { neutralBody } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getOffHandRestPosition } from './stance';
import { WEAPON_SCALE_CONFIG as WSC, SWING_PRESETS, scalePreset } from '../character/body';

// ─── Weapon Scale Factors ────────────────────────────────

export interface WeaponScaleFactors {
  reachScale: number;
  arcScale: number;
  bodyCommitment: number;
  gripCommitment: number;
  durationScale: number;
}

export function getWeaponScaleFactors(weapon: WeaponPhysics): WeaponScaleFactors {
  const ls = Math.max(WSC.minLengthScale, Math.min(WSC.maxLengthScale, weapon.length / WSC.baseLength));
  const ws = Math.max(WSC.minLengthScale, Math.min(WSC.maxWeightScale, weapon.weight / WSC.baseWeight));

  return {
    reachScale: Math.min(WSC.maxReachScale, 1.0 + (ls - 1.0) * WSC.reachFactor),
    arcScale: Math.min(WSC.maxArcScale, 1.0 + (ls - 1.0) * WSC.arcFactor),
    bodyCommitment: 1.0 + Math.min(ws - 1.0, WSC.bodyCommitmentWeightCap) * WSC.bodyCommitmentFactor,
    gripCommitment: weapon.gripType === 'two-handed' ? WSC.twoHandedGripMul : 1.0,
    durationScale: 1.0 + (ws - 1.0) * WSC.durationFactor,
  };
}

// ─── SwingMotion 生成 ────────────────────────────────────

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
      const minStrike = startPos.add(forward.scale(0.1)).add(new Vector3(0, -0.05, 0));
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
      const minStrike = startPos.add(charRight.scale(-0.1)).add(forward.scale(0.1));
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

  const preset = SWING_PRESETS[type];
  const windupBody = scalePreset(preset.windup, p, bc, gc);
  const strikeBody = scalePreset(preset.strike, p, bc, gc);

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

// ─── SwingMotion 更新 ────────────────────────────────────

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

// ─── BodyMotion 適用 ─────────────────────────────────────

/**
 * ボディモーションをキャラクターに適用。
 */
export function applyBodyMotion(
  character: HavokCharacter,
  body: BodyMotion,
  forward: Vector3,
  charRight: Vector3,
): void {
  const spineBone = character.allBones.get('mixamorig:Spine1');
  if (spineBone) {
    const baseRot = character.ikBaseRotations.get(spineBone.name);
    if (baseRot) {
      const leanQuat = Quaternion.RotationAxis(charRight, body.torsoLean);
      const twistQuat = Quaternion.RotationAxis(Vector3.Up(), body.torsoTwist);
      spineBone.rotationQuaternion = twistQuat.multiply(leanQuat).multiply(baseRot.root);
    }
  }

  const hipsBone = character.allBones.get('mixamorig:Hips');
  if (hipsBone) {
    hipsBone.position.y = character.hipsBaseY + body.hipsOffset;
  }
  if (Math.abs(body.hipsForward) > 0.001) {
    character.root.position.addInPlace(forward.scale(body.hipsForward));
  }

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
