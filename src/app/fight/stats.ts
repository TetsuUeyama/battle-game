/**
 * キャラクターステータス (Phase 7-1)。
 *
 * 4 ステータスをポイント振り分けで設定する (各 0..10、合計 STAT_TOTAL 固定)。
 * スタイルごとに初期配分が違い、エディットで振り直せる。
 * 体格 (moves.getBody) と同じオーバーライド機構で、エディット → 対戦に反映する。
 */

import type { FightStyle } from './moves';

export interface CharStats {
  /** 体力: 最大 HP */
  vitality: number;
  /** 攻撃: 与ダメージ倍率 */
  power: number;
  /** 防御: 被ダメージ軽減 */
  defense: number;
  /** 機動: 移動速度 */
  agility: number;
}

export const STAT_KEYS = ['vitality', 'power', 'defense', 'agility'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  vitality: '体力',
  power: '攻撃',
  defense: '防御',
  agility: '機動',
};

/** 各ステータスの上限 */
export const STAT_MAX = 10;
/** 振り分けられる合計ポイント (= 既定配分の合計) */
export const STAT_TOTAL = 20;

/** スタイル別の初期ステータス (合計はいずれも STAT_TOTAL) */
export const STYLE_STATS: Record<FightStyle, CharStats> = {
  boxer: { vitality: 5, power: 6, defense: 5, agility: 4 }, // 攻め寄りバランス
  kicker: { vitality: 6, power: 5, defense: 4, agility: 5 }, // 万能・リーチ型
  speed: { vitality: 3, power: 3, defense: 4, agility: 10 }, // 速いが脆い
  power: { vitality: 7, power: 8, defense: 3, agility: 2 }, // 硬く重いが鈍い
};

/** エディットでの上書き (なければ STYLE_STATS) */
const statOverrides: Partial<Record<FightStyle, CharStats>> = {};

export function getStats(style: FightStyle): CharStats {
  return statOverrides[style] ?? STYLE_STATS[style];
}

export function setStatsOverride(style: FightStyle, stats: CharStats | null): void {
  if (stats) statOverrides[style] = stats;
  else delete statOverrides[style];
}

export function statTotal(s: CharStats): number {
  return s.vitality + s.power + s.defense + s.agility;
}

// ----------------------------------------------------------------- 効果計算

/** 最大 HP (体力 5 = 100、±1 で ±8 → 60〜140) */
export function statMaxHp(s: CharStats): number {
  return Math.round(100 + (s.vitality - 5) * 8);
}

/** 与ダメージ倍率 (攻撃 5 = 1.0、±1 で ±0.05 → 0.75〜1.25) */
export function statDamageMul(s: CharStats): number {
  return 1 + (s.power - 5) * 0.05;
}

/** 被ダメージ倍率 (防御 5 = 1.0、防御が高いほど小さい → 0.80〜1.20) */
export function statDefenseMul(s: CharStats): number {
  return 1 - (s.defense - 5) * 0.04;
}

/** 移動速度倍率 (機動 5 = 1.0、±1 で ±0.05 → 0.75〜1.25) */
export function statSpeedMul(s: CharStats): number {
  return 1 + (s.agility - 5) * 0.05;
}
