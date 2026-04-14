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
import { getWorldPos, applyWorldDeltaRotation } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getOffHandRestPosition } from './stance';
import { WEAPON_SCALE_CONFIG as WSC, SWING_PRESETS, scalePreset, JOINT_CONFIG } from '../character/body';

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

/** SwingMotion 生成オプション */
export interface SwingMotionOptions {
  /** 攻撃タイプ */
  type?: SwingType;
  /** 攻撃パワー (0-100) */
  power?: number;
  /** 打撃目標位置 (直接指定、opponent がない場合に使用) */
  targetPos?: Vector3;
  /** 相手キャラクター (ボーン位置から打撃目標を算出) */
  opponent?: HavokCharacter;
  /** 相手方向 (opponent 使用時に必要) */
  dir?: Vector3;
  /** 狙うボーン名 ('head' | 'torso' | 'hips') */
  targetBone?: string;
  /** コンボ後続 (振りかぶり短縮・速度アップ) */
  isComboFollow?: boolean;
  /** 対キャラ用の大きめプリセット (_vs) を使用 */
  useVsPreset?: boolean;
}

/**
 * スイングモーションを生成。
 *
 * target モード: createSwingMotion(character, { targetPos, type, power })
 * character モード: createSwingMotion(character, { opponent, dir, targetBone, type, power, useVsPreset: true })
 */
export function createSwingMotion(
  character: HavokCharacter,
  opts: SwingMotionOptions = {},
): SwingMotion {
  const type = opts.type ?? 'vertical';
  const power = opts.power ?? 100;

  const dirs = getCharacterDirections(character);
  if (!dirs || !character.weapon) {
    return { type, progress: 0, duration: 0.6, windupRatio: 0.4, startPos: Vector3.Zero(), windupPos: Vector3.Zero(), strikePos: Vector3.Zero(), active: false, power: 0, windupBody: neutralBody(), strikeBody: neutralBody(), startOffset: Vector3.Zero(), windupOffset: Vector3.Zero(), strikeOffset: Vector3.Zero(), rootPosAtStart: Vector3.Zero(), stepInDistance: 0, stepInDir: Vector3.Zero() };
  }

  const { forward, charRight } = dirs; // forward = キャラの視覚的な前方
  const weapon = character.weapon;
  const swing = character.weaponSwing;
  const p = Math.max(0, Math.min(100, power)) / 100;

  const sf = getWeaponScaleFactors(weapon);
  const bc = sf.bodyCommitment;
  const gc = sf.gripCommitment;
  const rs = sf.reachScale;

  // 握り手の位置 (weaponAttachRのワールド位置)
  character.weaponAttachR.computeWorldMatrix(true);
  const startPos = character.weaponAttachR.getAbsolutePosition().clone();

  // ─── 打撃目標位置の決定 ───
  let hitPos: Vector3;
  if (opts.opponent) {
    // character モード: 相手ボーンから算出
    const boneName = opts.targetBone ?? 'torso';
    const bone = opts.opponent.combatBones.get(boneName);
    hitPos = bone ? getWorldPos(bone) : opts.opponent.root.position.add(new Vector3(0, 1.0, 0));
  } else if (opts.targetPos) {
    // target モード: 直接指定
    hitPos = opts.targetPos;
  } else {
    hitPos = character.root.position.add(forward.scale(1.0)).add(new Vector3(0, 1.0, 0));
  }

  const dir = opts.dir ?? forward;

  // ─── 肩位置・腕リーチ ───
  const armLen = character.ikChains.rightArm.lengthA + character.ikChains.rightArm.lengthB;
  const shoulderBone = character.ikChains.rightArm.root;
  shoulderBone.computeWorldMatrix(true);
  const shoulderWorldPos = shoulderBone.getAbsolutePosition();
  const armReach = armLen * 0.95;

  // ─── 自分のボーン位置 ───
  const myHeadBone = character.combatBones.get('head');
  const myHipsBone = character.combatBones.get('hips');
  const myHeadPos = myHeadBone ? getWorldPos(myHeadBone) : shoulderWorldPos.add(new Vector3(0, 0.3, 0));
  const myHipsPos = myHipsBone ? getWorldPos(myHipsBone) : shoulderWorldPos.add(new Vector3(0, -0.4, 0));

  // ─── 相手の通過ポイント (武器先端が通るべき2点) ───
  let tipPass1: Vector3; // 武器先端の通過点1 (振りかぶり側)
  let tipPass2: Vector3; // 武器先端の通過点2 (振り終わり側)

  if (opts.opponent) {
    const oppHead = opts.opponent.combatBones.get('head');
    const oppTorso = opts.opponent.combatBones.get('torso');
    const oppHips = opts.opponent.combatBones.get('hips');
    const oppHeadPos = oppHead ? getWorldPos(oppHead) : hitPos.add(new Vector3(0, 0.4, 0));
    const oppTorsoPos = oppTorso ? getWorldPos(oppTorso) : hitPos;
    const oppHipsPos = oppHips ? getWorldPos(oppHips) : hitPos.add(new Vector3(0, -0.3, 0));

    switch (type) {
      case 'vertical':
        tipPass1 = oppHeadPos.add(new Vector3(0, 0.3, 0));
        tipPass2 = oppHipsPos;
        break;
      case 'horizontal':
      case 'horizontal_r2l':
        tipPass1 = oppTorsoPos.add(charRight.scale(0.4));
        tipPass2 = oppTorsoPos.add(charRight.scale(-0.4));
        break;
      case 'horizontal_l2r':
        tipPass1 = oppTorsoPos.add(charRight.scale(-0.4));
        tipPass2 = oppTorsoPos.add(charRight.scale(0.4));
        break;
      case 'thrust':
      default:
        tipPass1 = oppTorsoPos.add(dir.scale(-0.5));
        tipPass2 = oppTorsoPos;
        break;
    }
  } else {
    switch (type) {
      case 'vertical':
        tipPass1 = hitPos.add(new Vector3(0, 0.5, 0));
        tipPass2 = hitPos.add(new Vector3(0, -0.3, 0));
        break;
      case 'horizontal':
      case 'horizontal_r2l':
        tipPass1 = hitPos.add(charRight.scale(0.4));
        tipPass2 = hitPos.add(charRight.scale(-0.4));
        break;
      case 'horizontal_l2r':
        tipPass1 = hitPos.add(charRight.scale(-0.4));
        tipPass2 = hitPos.add(charRight.scale(0.4));
        break;
      case 'thrust':
      default:
        tipPass1 = hitPos.add(forward.scale(-0.5));
        tipPass2 = hitPos;
        break;
    }
  }

  // ─── 手のIKターゲット位置の算出 ───
  // ルール:
  //   縦振り: 振りかぶり = 手が自分の頭の高さ、振り終わり = 手が自分の腰の高さ
  //   横R2L: 振りかぶり = 手が自分の右半身側、振り終わり = 手が左半身側
  //   横L2R: 振りかぶり = 手が自分の左半身側、振り終わり = 手が右半身側
  //   突き:  振りかぶり = 手を後方に引く、振り終わり = 目標方向に突き出す
  // 全て: 肩からarmReach分離して腕をまっすぐにする

  let windupPos: Vector3;
  let strikePos: Vector3;

  // 武器先端が通過点を通るための握り手の位置を計算する関数
  // 握り手位置 = 通過点から肩方向にweapon.length分戻す
  // かつ肩からarmReach距離を保証 (腕まっすぐ)
  function gripPosForTip(tipTarget: Vector3): Vector3 {
    const tipToShoulder = shoulderWorldPos.subtract(tipTarget).normalize();
    const grip = tipTarget.add(tipToShoulder.scale(weapon.length));
    // 肩からarmReach距離に補正
    const gripDir = grip.subtract(shoulderWorldPos).normalize();
    return shoulderWorldPos.add(gripDir.scale(armReach));
  }

  // 全ての振りかぶり・振り終わりは前方(相手側)で行う。背中側には一切行かない。
  switch (type) {
    case 'vertical': {
      // 振りかぶり: 手を頭上高く、武器先端が背中側を向くように後方寄りに上げる
      windupPos = shoulderWorldPos
        .add(new Vector3(0, armReach * 0.9, 0))
        .add(forward.scale(-armReach * 0.3));

      // 振り下ろし: 前方下方に振り抜く (相手の体を通過する前提)
      strikePos = shoulderWorldPos
        .add(forward.scale(armReach * 0.7))
        .add(new Vector3(0, -armReach * 0.8, 0));
      break;
    }
    case 'horizontal':
    case 'horizontal_r2l': {
      // 振りかぶり: 右側に大きく引く
      const wTarget = shoulderWorldPos.add(forward.scale(armReach * 0.2)).add(charRight.scale(armReach * 0.85));
      wTarget.y = shoulderWorldPos.y;
      const wrDir = wTarget.subtract(shoulderWorldPos).normalize();
      windupPos = shoulderWorldPos.add(wrDir.scale(armReach));

      // 振り終わり: 左側まで大きく薙ぎ払う
      const sTarget = shoulderWorldPos.add(forward.scale(armReach * 0.3)).add(charRight.scale(-armReach * 0.7));
      sTarget.y = shoulderWorldPos.y;
      const slDir = sTarget.subtract(shoulderWorldPos).normalize();
      strikePos = shoulderWorldPos.add(slDir.scale(armReach));
      break;
    }
    case 'horizontal_l2r': {
      // 振りかぶり: 左側に大きく引く
      const wTarget = shoulderWorldPos.add(forward.scale(armReach * 0.2)).add(charRight.scale(-armReach * 0.7));
      wTarget.y = shoulderWorldPos.y;
      const wlDir = wTarget.subtract(shoulderWorldPos).normalize();
      windupPos = shoulderWorldPos.add(wlDir.scale(armReach));

      // 振り終わり: 右側まで大きく薙ぎ払う
      const sTarget = shoulderWorldPos.add(forward.scale(armReach * 0.3)).add(charRight.scale(armReach * 0.85));
      sTarget.y = shoulderWorldPos.y;
      const srDir = sTarget.subtract(shoulderWorldPos).normalize();
      strikePos = shoulderWorldPos.add(srDir.scale(armReach));
      break;
    }
    case 'thrust':
    default: {
      // 振りかぶり: 前方で腰の横に引く (突きの構え)
      const wTarget = shoulderWorldPos.add(forward.scale(armReach * 0.1)).add(charRight.scale(armReach * 0.3));
      wTarget.y = myHipsPos.y + 0.1;
      const wDir = wTarget.subtract(shoulderWorldPos).normalize();
      windupPos = shoulderWorldPos.add(wDir.scale(armReach * 0.6));

      // 振り終わり: 前方にまっすぐ突き出す
      strikePos = gripPosForTip(tipPass2);
      break;
    }
  }

  // ─── ボディモーション (SWING_PRESETS から取得) ───
  const presetKey = opts.opponent ? `${type}_vs` : type;
  const preset = SWING_PRESETS[presetKey] ?? SWING_PRESETS[type];
  const windupBody = preset ? scalePreset(preset.windup, p, bc, gc) : neutralBody();
  const strikeBody = preset ? scalePreset(preset.strike, p, bc, gc) : neutralBody();

  // ─── 踏み込み距離の算出 ───
  // 武器先端が通過点2に届くために必要な距離
  const rootPos = character.root.position.clone();
  const totalReach = armReach + weapon.length * 0.9;
  const distToTip2 = Vector3.Distance(shoulderWorldPos, tipPass2);
  const stepInDistance = Math.max(0, distToTip2 - totalReach);
  const stepInDir = dir.clone();
  stepInDir.y = 0;
  if (stepInDir.length() > 0.001) stepInDir.normalize();
  else stepInDir.copyFrom(forward);

  // ─── 時間 ───
  // 振りかぶり (予備動作) + 振り下ろし (高速攻撃)
  const baseDuration = opts.isComboFollow
    ? (0.25 + (1.0 - p) * 0.05) * sf.durationScale
    : (0.35 + (1.0 - p) * 0.08) * sf.durationScale;

  const motion: SwingMotion = {
    type, progress: 0, duration: baseDuration,
    windupRatio: opts.isComboFollow ? 0.5 : 0.6,  // 振りかぶり60%、振り下ろし40%
    startPos, windupPos, strikePos,
    active: true, power: p, windupBody, strikeBody,
    startOffset: startPos.subtract(rootPos),
    windupOffset: windupPos.subtract(rootPos),
    strikeOffset: strikePos.subtract(rootPos),
    rootPosAtStart: rootPos,
    stepInDistance,
    stepInDir,
    worldStrikePos: strikePos.clone(),
    worldWindupPos: windupPos.clone(),
    shoulderOffset: shoulderWorldPos.subtract(rootPos),
  };

  // 横振り: 弧を描く (arcSwingは使わず、worldWindupPos/worldStrikePosの直線補間で十分)
  // arcSwingを無効化し、ワールド座標ベースのwindup→strike補間に統一

  return motion;
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

  // ── 踏み込み: 打撃フェーズ中にルート位置を前方へ移動 ──
  let root = currentRootPos ?? motion.rootPosAtStart;
  if (motion.stepInDistance > 0.001 && currentRootPos) {
    const p = motion.progress;
    const wr = motion.windupRatio;
    if (p >= wr) {
      // 打撃フェーズ中のみ踏み込み
      const strikeT = (p - wr) / (1.0 - wr);
      // 前半70%で踏み込み完了、ease-out で減速
      const stepT = Math.min(1, strikeT / 0.7);
      const eased = 1 - (1 - stepT) * (1 - stepT);
      const stepSpeed = motion.stepInDistance / (motion.duration * (1 - wr) * 0.7);
      const frameDist = stepSpeed * dt * (1 - stepT + 0.1); // 減速
      currentRootPos.addInPlace(motion.stepInDir.scale(frameDist));
    }
    root = currentRootPos;
  }

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
  const windup = motion.worldWindupPos ?? root.add(motion.windupOffset);
  const strike = motion.worldStrikePos ?? root.add(motion.strikeOffset);

  if (p < wr) {
    // 振りかぶり: start → windup (ease-out: 素早く上げて頂点で減速)
    const t = p / wr;
    const eased = 1.0 - (1.0 - t) * (1.0 - t);
    return {
      handTarget: Vector3.Lerp(start, windup, eased),
      body: lerpBody(zero, motion.windupBody, eased),
    };
  } else {
    // 振り下ろし: windup → strike を直線補間
    // ほぼ線形で高速に振り下ろす (わずかに加速)
    const t = (p - wr) / (1.0 - wr);
    const eased = t * (2.0 - t); // ease-out-ish: 最初から速い
    return {
      handTarget: Vector3.Lerp(windup, strike, eased),
      body: lerpBody(motion.windupBody, motion.strikeBody, eased),
    };
  }
}

// ─── BodyMotion 適用 ─────────────────────────────────────

/**
 * ボディモーションをキャラクターに適用。
 *
 * Spine / Spine1 / Spine2 の3つに回転を分散して大きな弧を描く:
 *   横振り: torsoTwist をY軸回転として3骨に配分 → 上半身全体がひねる
 *   縦振り: torsoLean をX軸回転として3骨に配分 → 上半身全体が前傾/後傾
 *
 * 各Spineへの配分率:
 *   Spine  (腰上): 30% — 下半身に近いので小さめ
 *   Spine1 (胸):   45% — メインの回転
 *   Spine2 (上胸): 25% — 肩に近いので補助
 */
export function applyBodyMotion(
  character: HavokCharacter,
  body: BodyMotion,
  forward: Vector3,
  charRight: Vector3,
): void {
  // torsoLean/torsoTwist を -1〜+1 の「使用率」として解釈し、
  // 各Spineの可動域制限の端まで回転させる。
  // lean>0 → 前傾, lean<0 → 後傾
  // twist>0 → 右ひねり, twist<0 → 左ひねり
  const leanNorm = Math.max(-1, Math.min(1, body.torsoLean * 3.0));  // radを正規化 (0.33rad≒1.0)
  const twistNorm = Math.max(-1, Math.min(1, body.torsoTwist * 1.5)); // radを正規化 (0.67rad≒1.0)

  const spineConfigs = [
    { name: 'mixamorig:Spine',  limits: JOINT_CONFIG.spine },
    { name: 'mixamorig:Spine1', limits: JOINT_CONFIG.spine1 },
    { name: 'mixamorig:Spine2', limits: JOINT_CONFIG.spine2 },
  ] as const;

  const toRad = Math.PI / 180;

  for (const { name, limits } of spineConfigs) {
    const bone = character.allBones.get(name);
    if (!bone) continue;

    const ikBase = character.ikBaseRotations.get(bone.name);
    if (!ikBase) continue;

    // まず基準回転にリセット
    bone.rotationQuaternion = ikBase.root.clone();

    // X軸: leanNorm の符号に応じて min or max まで回転
    const xDeg = leanNorm >= 0
      ? leanNorm * limits.x.max
      : -leanNorm * limits.x.min;

    // Y軸: twistNorm の符号に応じて min or max まで回転
    const yDeg = twistNorm >= 0
      ? twistNorm * limits.y.max
      : -twistNorm * limits.y.min;

    // ワールド空間のデルタ回転を作成し、親の回転を考慮してローカルに変換
    const leanWorld = Quaternion.RotationAxis(charRight, xDeg * toRad);
    const twistWorld = Quaternion.RotationAxis(Vector3.Up(), yDeg * toRad);
    const deltaWorld = twistWorld.multiply(leanWorld);

    applyWorldDeltaRotation(bone, deltaWorld, 1.0);
  }

  // 腰
  const hipsBone = character.allBones.get('mixamorig:Hips');
  if (hipsBone) {
    hipsBone.position.y = character.hipsBaseY + body.hipsOffset;
  }
  if (Math.abs(body.hipsForward) > 0.001) {
    character.root.position.addInPlace(forward.scale(body.hipsForward));
  }

  // オフハンド (左手)
  if (character.weapon && character.weapon.gripType === 'one-handed'
      && character.ikChains.leftArm.weight > 0) {
    const restPos = getOffHandRestPosition(character);
    if (restPos) {
      const offset = forward.scale(body.offHandOffset.x)
        .add(Vector3.Up().scale(body.offHandOffset.y))
        .add(charRight.scale(body.offHandOffset.z));
      character.ikChains.leftArm.target.copyFrom(restPos.add(offset));
    }
  }
}
