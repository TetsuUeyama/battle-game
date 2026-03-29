/**
 * 防御的スイング — 相手の武器を回避するBezier軌道ベースの攻撃。
 *
 * 通常の attack-swing (直線的な振り) と異なり、
 * 相手の武器位置を検知して迂回経由点を追加した曲線軌道で攻撃する。
 *
 * ■ 処理フロー
 *   1. computeAttackPath(): 手→打撃目標ラインと相手武器の最短距離を計算
 *      - 0.2m未満で「ブロックあり」→ 障害物位置に応じて迂回経由点を追加
 *      - ブロックなし → スイングタイプに応じた自然なカーブ
 *   2. createDefenceSwingMotion(): Bezier制御点からSwingMotionを生成
 *      - body-config の SWING_PRESETS + 武器スケールで自動調整
 *
 * ■ 迂回ロジック (computeAttackPath)
 *   障害物が打撃位置より上 → 下から回り込み (horizontal に変更)
 *   障害物が打撃位置より下 → 上から回り込み (vertical に変更)
 *   障害物が同じ高さ     → 横から回り込み (thrust に変更)
 */
import { Scene, Vector3 } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingType, BezierAttackPath } from '../types';
import { neutralBody } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getWeaponTipWorld } from './physics';
import { getWeaponScaleFactors } from './attack-swing';
import { SWING_PRESETS, scalePreset } from '../character/body';

// ─── Bezier曲線評価 ─────────────────────────────────────

/** De Casteljau アルゴリズムでN次Bezier曲線を評価 */
export function evaluateBezier(points: Vector3[], t: number): Vector3 {
  if (points.length === 1) return points[0].clone();
  const next: Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    next.push(Vector3.Lerp(points[i], points[i + 1], t));
  }
  return evaluateBezier(next, t);
}

// ─── 攻撃軌道計算 ───────────────────────────────────────

/**
 * 攻撃軌道をBezier曲線で計算。
 * 相手の武器が軌道上にある場合、迂回経由点を追加して回避する。
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
  const sf = getWeaponScaleFactors(weapon);
  const rs = sf.reachScale;

  const handPos = attacker.weaponSwing.baseHandPos.clone();
  const toHit = hitPos.subtract(handPos).normalize();
  const handStrikePos = hitPos.subtract(toHit.scale(weapon.length * 0.6));

  // ─── 障害物検知: 手→打撃位置ラインと相手武器の最短距離 ───
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
    // ─── ブロックあり: 障害物の位置に応じて迂回 ───
    const blockRelY = blockPoint.y - handStrikePos.y;

    if (blockRelY > 0.1) {
      // 障害物が上 → 下から回り込み
      const waypoint = Vector3.Lerp(handPos, handStrikePos, 0.5)
        .add(new Vector3(0, -0.3 * rs, 0))
        .add(charRight.scale(0.2 * rs));
      controlPoints = [handPos, waypoint, handStrikePos];
      resolvedType = 'horizontal';
    } else if (blockRelY < -0.1) {
      // 障害物が下 → 上から回り込み
      const waypoint = Vector3.Lerp(handPos, handStrikePos, 0.5)
        .add(new Vector3(0, 0.3 * rs, 0));
      controlPoints = [handPos, waypoint, handStrikePos];
      resolvedType = 'vertical';
    } else {
      // 障害物が同じ高さ → 横から回り込み
      const waypoint = Vector3.Lerp(handPos, handStrikePos, 0.4)
        .add(charRight.scale(0.3 * rs));
      controlPoints = [handPos, waypoint, handStrikePos];
      resolvedType = 'thrust';
    }
  } else {
    // ─── ブロックなし: スイングタイプに応じた自然なカーブ ───
    const headBone = attacker.combatBones.get('head');
    const headPos = headBone ? getWorldPos(headBone) : handPos.add(new Vector3(0, 0.3, 0));

    let windupPos: Vector3;
    switch (preferredType) {
      case 'vertical':
        windupPos = headPos.add(new Vector3(0, 0.15 * rs, 0)).add(forward.scale(-0.1 * rs)).add(charRight.scale(0.05));
        break;
      case 'horizontal':
        windupPos = handPos.add(charRight.scale(0.4 * rs)).add(new Vector3(0, 0.1 * rs, 0));
        break;
      default:
        windupPos = handPos.add(forward.scale(-0.2 * rs));
        break;
    }
    controlPoints = [handPos, windupPos, handStrikePos];
  }

  return { controlPoints, resolvedSwingType: resolvedType };
}

// ─── 線分間距離 ─────────────────────────────────────────

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

// ─── 防御的SwingMotion生成 ───────────────────────────────

/**
 * Bezier軌道ベースのSwingMotionを作成。
 * body-config の SWING_PRESETS + 武器スケールで自動調整される。
 */
export function createDefenceSwingMotion(
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
      startOffset: Vector3.Zero(), windupOffset: Vector3.Zero(), strikeOffset: Vector3.Zero(), rootPosAtStart: Vector3.Zero(), stepInDistance: 0, stepInDir: Vector3.Zero() };
  }

  const sf = getWeaponScaleFactors(weapon);
  const bc = sf.bodyCommitment;
  const gc = sf.gripCommitment;

  const cp = path.controlPoints;
  const startPos = cp[0].clone();
  const windupPos = cp.length > 2 ? evaluateBezier(cp, 0.35) : Vector3.Lerp(cp[0], cp[cp.length - 1], 0.35);
  const strikePos = cp[cp.length - 1].clone();

  const baseDuration = 0.4 + (1.0 - p) * 0.1;

  // SWING_PRESETS + scalePreset で自動スケール
  const type = path.resolvedSwingType;
  const preset = SWING_PRESETS[type];
  const windupBody = scalePreset(preset.windup, p, bc, gc);
  const strikeBody = scalePreset(preset.strike, p, bc, gc);

  const rootPos = character.root.position.clone();
  return {
    type,
    progress: 0,
    duration: baseDuration * sf.durationScale,
    windupRatio: 0.35 + p * 0.1,
    startPos, windupPos, strikePos,
    active: true,
    power: p,
    windupBody, strikeBody,
    startOffset: startPos.subtract(rootPos),
    windupOffset: windupPos.subtract(rootPos),
    strikeOffset: strikePos.subtract(rootPos),
    rootPosAtStart: rootPos,
    stepInDistance: 0,
    stepInDir: Vector3.Zero(),
  };
}
