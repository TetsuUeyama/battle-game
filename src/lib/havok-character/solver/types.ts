/**
 * MotionSolver 型定義。
 * 行動意図・戦況コンテキスト・ソルバーキャッシュなど。
 */
import { Vector3 } from '@babylonjs/core';
import type { WeaponPhysics, StanceType, SwingType } from '../types';

// ─── 行動意図 ────────────────────────────────────────────

/** 攻撃の意図 */
export type AttackIntent =
  | 'damage'    // ダメージ重視。最大威力
  | 'disrupt'   // 体勢崩し。相手のバランスを崩す
  | 'pressure'  // 牽制。相手を動かす/反応させる
  | 'setup'     // コンボ起点。2発目以降を前提
  | 'punish'    // 確定反撃。相手の隙に差し込む
  | 'finisher'; // 止め。相手HP少/よろめき中

/** 構えの意図 */
export type StanceIntent =
  | 'aggressive' // 攻撃重視
  | 'defensive'  // 防御重視
  | 'neutral'    // バランス型
  | 'recovery';  // 回復。攻撃後/被弾後の体勢立て直し

// ─── 構えの種類 ──────────────────────────────────────────

/** 3段階の構えレベル (上段/中段/下段) */
export type StanceLevel = 'upper' | 'middle' | 'lower';

// ─── 構え候補 ────────────────────────────────────────────

/** 球面探索の候補点 */
export interface StanceCandidate {
  /** 球面上の水平角 (rad) */
  theta: number;
  /** 球面上の仰角 (rad) */
  phi: number;
  /** 右手のグリップ位置 (world space) */
  gripPos: Vector3;
  /** 武器の向き (world space, 正規化) */
  weaponDir: Vector3;
  /** 肩からの距離比率 (0-1, 1=armReach) */
  reachRatio: number;
}

/** 構えのソルバー結果 */
export interface StanceResult {
  /** 右手のIKターゲット位置 (world space) */
  rightTarget: Vector3;
  /** 左手のIKターゲット位置 (world space, 片手武器時null) */
  leftTarget: Vector3 | null;
  /** 武器の向き (world space, 正規化) */
  weaponDir: Vector3;
  /** この構えの目的関数スコア (0-1) */
  score: number;
  /** 元の候補 */
  candidate: StanceCandidate;
}

// ─── 目的関数の重み ──────────────────────────────────────

/** 構え目的関数の重みセット */
export interface StanceObjectiveWeights {
  /** 攻撃準備性 (windup位置への距離) */
  attackReadiness: number;
  /** 防御カバー (急所への手の距離) */
  defenceCoverage: number;
  /** 威圧度 (武器先端の前方投射) */
  threatProjection: number;
  /** バランス安定性 */
  balanceStability: number;
  /** 力伝達準備 (関節の曲げ状態) */
  forceReadiness: number;
  /** 相手攻撃への対応性 */
  opponentAttackResponse: number;
  /** 次行動への移行性 */
  nextActionTransition: number;
}

/** 攻撃目的関数の重みセット */
export interface SwingObjectiveWeights {
  /** 到達性 */
  reachability: number;
  /** 力伝達効率 */
  forceEfficiency: number;
  /** バランス維持 */
  balanceMaintain: number;
  /** 速度 */
  speed: number;
  /** 相手防御回避 */
  defenceAvoidance: number;
  /** 攻撃後体勢 */
  postSwingPosture: number;
}

// ─── 戦況コンテキスト ────────────────────────────────────

/** 相手の状態予測 */
export interface OpponentPrediction {
  /** 相手の予想攻撃方向 (null=攻撃予測なし) */
  expectedAttackDir: Vector3 | null;
  /** 相手の予想攻撃タイプ */
  expectedSwingType: SwingType | null;
  /** 相手のガード位置 (grip位置, null=ガード予測なし) */
  guardPosition: Vector3 | null;
  /** 相手の武器先端方向 */
  weaponTipDir: Vector3 | null;
  /** 相手が攻撃圏内にいるか */
  inTheirAttackRange: boolean;
  /** 相手のバランス偏差方向 */
  balanceDeviationDir: Vector3 | null;
}

/** 自分の体勢状態 */
export interface SelfPosture {
  /** 現在のSpine lean (rad) */
  currentLean: number;
  /** 現在のSpine twist (rad) */
  currentTwist: number;
  /** 現在のバランス偏差 */
  balanceDeviation: number;
  /** 現在のバランス偏差方向 */
  balanceDeviationDir: Vector3;
  /** 現在の右手IKターゲット位置 */
  currentRightHandPos: Vector3;
  /** 前の攻撃のstrike終了位置 (null=前の攻撃なし) */
  lastStrikeEndPos: Vector3 | null;
}

/** 戦況コンテキスト全体 */
export interface CombatContext {
  /** 相手の状態予測 */
  opponent: OpponentPrediction;
  /** 自分の体勢 */
  self: SelfPosture;
  /** 構えの意図 */
  stanceIntent: StanceIntent;
  /** 攻撃の意図 (攻撃時のみ) */
  attackIntent: AttackIntent | null;
  /** 相手までの距離 */
  distance: number;
  /** 相手への方向 (水平) */
  dirToOpponent: Vector3;
}

// ─── ソルバーキャッシュ ──────────────────────────────────

/** 武器装備時の事前計算結果 */
export interface SolverCache {
  /** キャッシュ元の武器 (変更検知用) */
  weapon: WeaponPhysics;
  /** 有効構えプール (制約を満たす全候補) */
  validCandidates: StanceCandidate[];
  /** 3基本構え (上段/中段/下段) */
  baseStances: Record<StanceLevel, StanceResult>;
  /** 手首トルク上限 (weapon依存で計算) */
  maxWristTorque: number;
  /** 腕のリーチ (IKChain lengthA + lengthB) */
  armReach: number;
}

// ─── 運動連鎖 ────────────────────────────────────────────

/** 運動連鎖の関節プロファイル */
export interface KineticJointEntry {
  /** 関節名 */
  joint: string;
  /** モーション開始からの遅延 (秒) */
  startDelay: number;
  /** この関節の回転量 (0-1) */
  magnitude: number;
  /** 最大回転速度に達する時刻 (秒) */
  peakTime: number;
  /** この関節から武器先端までの距離 (m) */
  radiusToTip: number;
  /** この関節の質量 (kg) */
  mass: number;
}

/** 運動連鎖プロファイル全体 */
export interface KineticChainProfile {
  /** 各関節のプロファイル */
  joints: KineticJointEntry[];
  /** 体幹関与度 (0-1) */
  coreInvolvement: number;
  /** 予想される力モーメント */
  estimatedForceMoment: number;
}
