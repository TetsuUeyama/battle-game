/**
 * 構え・攻撃モーションの目的関数。
 * 各目的のスコア (0-1) を計算し、重み付き合計で最終スコアを算出する。
 */
import { Vector3 } from '@babylonjs/core';
import type { WeaponPhysics } from '../types';
import type { StanceCandidate, StanceObjectiveWeights, CombatContext } from './types';

// ─── 構えの目的関数 ──────────────────────────────────────

export interface StanceObjectiveParams {
  /** 肩のワールド位置 */
  shoulderPos: Vector3;
  /** 腕のリーチ (m) */
  armReach: number;
  /** 武器パラメータ */
  weapon: WeaponPhysics;
  /** 体の前方方向 (facing) */
  facing: Vector3;
  /** 頭のワールド位置 */
  headPos: Vector3;
  /** 胴体のワールド位置 (Spine1) */
  torsoPos: Vector3;
  /** 腰のワールド位置 */
  hipsPos: Vector3;
  /** 戦況コンテキスト (null = 事前計算時、動的調整なし) */
  context: CombatContext | null;
}

/**
 * 攻撃準備性: 構えからwindup位置への移動距離が短いほど高スコア。
 * 上段→vertical が近い、下段→horizontal/thrust が近い、等。
 *
 * @param swingTypeBias vertical=1, horizontal=0, thrust=-1 のような偏り
 */
export function scoreAttackReadiness(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
  swingTypeBias: number, // -1 (thrust/horizontal寄り) ~ +1 (vertical寄り)
): number {
  // vertical windup: 肩の上方
  const verticalWindup = params.shoulderPos.add(
    params.facing.scale(params.armReach * 0.3),
  ).add(new Vector3(0, params.armReach * 0.85, 0));

  // horizontal windup: 肩の横
  const horizontalWindup = params.shoulderPos.add(
    params.facing.scale(params.armReach * 0.4),
  ).add(new Vector3(params.facing.z * params.armReach * 0.6, 0, -params.facing.x * params.armReach * 0.6));

  // thrust windup: 腰の横に引く
  const thrustWindup = params.shoulderPos.add(
    params.facing.scale(params.armReach * 0.1),
  );
  thrustWindup.y = params.hipsPos.y + 0.1;

  const dVert = Vector3.Distance(candidate.gripPos, verticalWindup);
  const dHoriz = Vector3.Distance(candidate.gripPos, horizontalWindup);
  const dThrust = Vector3.Distance(candidate.gripPos, thrustWindup);

  // bias に応じて重み付け
  const wVert = Math.max(0.1, 0.33 + swingTypeBias * 0.3);
  const wHoriz = Math.max(0.1, 0.33 - swingTypeBias * 0.15);
  const wThrust = Math.max(0.1, 0.34 - swingTypeBias * 0.15);

  const weightedDist = dVert * wVert + dHoriz * wHoriz + dThrust * wThrust;
  const maxDist = params.armReach * 2.0;
  return Math.max(0, 1 - weightedDist / maxDist);
}

/**
 * 防御カバー: 急所 (頭・胴) への手の移動距離が短いほど高スコア。
 *
 * @param guardBias 'head'=1, 'torso'=0, 'lower'=-1
 */
export function scoreDefenceCoverage(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
  guardBias: number,
): number {
  const dHead = Vector3.Distance(candidate.gripPos, params.headPos);
  const dTorso = Vector3.Distance(candidate.gripPos, params.torsoPos);
  const dHips = Vector3.Distance(candidate.gripPos, params.hipsPos);

  const wHead = Math.max(0.1, 0.33 + guardBias * 0.3);
  const wTorso = Math.max(0.1, 0.34);
  const wHips = Math.max(0.1, 0.33 - guardBias * 0.3);

  const weightedDist = dHead * wHead + dTorso * wTorso + dHips * wHips;
  const maxDist = params.armReach * 1.5;
  return Math.max(0, 1 - weightedDist / maxDist);
}

/**
 * 威圧度: 武器先端が相手方向を向いているほど高スコア。
 */
export function scoreThreatProjection(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
): number {
  // 武器先端方向と体の前方方向の内積
  const dot = Vector3.Dot(candidate.weaponDir, params.facing);
  // 前方を向いているほど高い (-1~+1 → 0~1)
  return (dot + 1) * 0.5;
}

/**
 * バランス安定性: 構え姿勢での重心が安定しているほど高スコア。
 * 武器の位置が体の中心に近いほど安定。
 */
export function scoreBalanceStability(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
): number {
  // 武器重心の水平オフセット
  const weaponCom = candidate.gripPos.add(
    candidate.weaponDir.scale(params.weapon.length * 0.5),
  );
  const offset = weaponCom.subtract(params.torsoPos);
  offset.y = 0;

  const horizontalDist = offset.length();
  const weightedDist = horizontalDist * params.weapon.weight;
  // 軽い武器は遠くてもOK、重い武器は近くないと不安定
  const maxAllowed = 3.0; // Nm
  return Math.max(0, 1 - weightedDist / maxAllowed);
}

/**
 * 力伝達準備: 肩の曲げ角が適度にある (腕が伸びきっていない) ほど高スコア。
 */
export function scoreForceReadiness(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
): number {
  // 肩から手までの距離 / armReach = 伸び率
  const distFromShoulder = Vector3.Distance(candidate.gripPos, params.shoulderPos);
  const extensionRatio = distFromShoulder / params.armReach;
  // 0.65~0.85 が最適 (適度に曲がっている)
  if (extensionRatio < 0.4) return 0.3; // 曲がりすぎ
  if (extensionRatio > 0.95) return 0.2; // 伸びすぎ
  if (extensionRatio >= 0.6 && extensionRatio <= 0.85) return 1.0; // 最適
  // 0.4~0.6 or 0.85~0.95: 線形補間
  if (extensionRatio < 0.6) return 0.3 + (extensionRatio - 0.4) / 0.2 * 0.7;
  return 1.0 - (extensionRatio - 0.85) / 0.1 * 0.8;
}

/**
 * 相手攻撃への対応性: 相手の予想攻撃に対してガード/回避に移行しやすいほど高スコア。
 */
export function scoreOpponentAttackResponse(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
): number {
  const ctx = params.context;
  if (!ctx || !ctx.opponent.expectedAttackDir) {
    // 戦況不明 → ニュートラルスコア
    return 0.5;
  }

  // 相手の攻撃方向から防御位置への距離
  // 相手の攻撃方向の逆側に手があると防御しやすい
  const attackDir = ctx.opponent.expectedAttackDir;
  const handToTorso = params.torsoPos.subtract(candidate.gripPos).normalize();
  const blockAngle = Vector3.Dot(handToTorso, attackDir);
  // blockAngle が負 (手が攻撃方向の反対側) → 防御しやすい
  return Math.max(0, Math.min(1, (1 - blockAngle) * 0.5));
}

/**
 * 次行動への移行性: 次に取りたい行動への姿勢変更コストが小さいほど高スコア。
 */
export function scoreNextActionTransition(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
): number {
  const ctx = params.context;
  if (!ctx) return 0.5;

  // 前の攻撃のstrike終了位置からの距離 (コンボ継続時)
  if (ctx.self.lastStrikeEndPos) {
    const transitionDist = Vector3.Distance(candidate.gripPos, ctx.self.lastStrikeEndPos);
    return Math.max(0, 1 - transitionDist / (params.armReach * 1.5));
  }

  // 現在の手位置からの遷移コスト
  const currentDist = Vector3.Distance(candidate.gripPos, ctx.self.currentRightHandPos);
  return Math.max(0, 1 - currentDist / (params.armReach * 1.5));
}

// ─── 統合スコア計算 ──────────────────────────────────────

/**
 * 全目的関数のスコアを計算し、重み付き合計を返す。
 */
export function evaluateStanceCandidate(
  candidate: StanceCandidate,
  params: StanceObjectiveParams,
  weights: StanceObjectiveWeights,
  swingTypeBias: number,
  guardBias: number,
): number {
  const scores = {
    attackReadiness: scoreAttackReadiness(candidate, params, swingTypeBias),
    defenceCoverage: scoreDefenceCoverage(candidate, params, guardBias),
    threatProjection: scoreThreatProjection(candidate, params),
    balanceStability: scoreBalanceStability(candidate, params),
    forceReadiness: scoreForceReadiness(candidate, params),
    opponentAttackResponse: scoreOpponentAttackResponse(candidate, params),
    nextActionTransition: scoreNextActionTransition(candidate, params),
  };

  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(weights) as (keyof StanceObjectiveWeights)[]) {
    total += scores[key] * weights[key];
    weightSum += weights[key];
  }

  return weightSum > 0 ? total / weightSum : 0;
}
