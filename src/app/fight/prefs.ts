/**
 * /fight のユーザー設定の永続化 (localStorage)。
 * キャラクターエディットの体格上書きと、設定タブのデフォルト難易度などを保存する。
 */

import {
  FIGHT_STYLES, STYLE_BODY, setBodyOverride, setMoveOverrides,
  type FightStyle, type MoveOverride,
} from './moves';
import { setStatsOverride, type CharStats } from './stats';
import type { CpuDifficulty } from './CpuBrain';

const KEY = 'fight-prefs-v1';

export interface FightPrefs {
  /** スタイル → 体格上書き (width/height のみ。未設定なら STYLE_BODY) */
  bodies: Partial<Record<FightStyle, { width: number; height: number }>>;
  /** スタイル → ステータス上書き (未設定なら STYLE_STATS) */
  stats: Partial<Record<FightStyle, CharStats>>;
  /** スタイル → 技ごとのモーション上書き (発生/判定/硬直/CT/ダメージ) */
  motions: Partial<Record<FightStyle, Record<string, MoveOverride>>>;
  /** 対戦開始時のデフォルト CPU 難易度 */
  difficulty: CpuDifficulty;
  /** 起動時に判定 (hitbox/hurtbox) を表示するか */
  showHitboxes: boolean;
}

export const DEFAULT_PREFS: FightPrefs = {
  bodies: {},
  stats: {},
  motions: {},
  difficulty: 'normal',
  showHitboxes: false,
};

/** localStorage から読み込む (SSR / 破損時は既定) */
export function loadPrefs(): FightPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<FightPrefs>;
    return {
      bodies: parsed.bodies ?? {},
      stats: parsed.stats ?? {},
      motions: parsed.motions ?? {},
      difficulty: parsed.difficulty ?? DEFAULT_PREFS.difficulty,
      showHitboxes: parsed.showHitboxes ?? DEFAULT_PREFS.showHitboxes,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** localStorage へ保存する */
export function savePrefs(prefs: FightPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // クォータ超過等は無視 (永続化は best-effort)
  }
}

/**
 * 体格・ステータス上書きを moves.ts / stats.ts のランタイムへ反映する。
 * これ以降に生成/setStyle される Fighter に効く。
 */
export function applyOverrides(prefs: FightPrefs): void {
  for (const style of FIGHT_STYLES) {
    const b = prefs.bodies[style];
    setBodyOverride(
      style,
      b ? { ...STYLE_BODY[style], width: b.width, height: b.height } : null,
    );
    setStatsOverride(style, prefs.stats[style] ?? null);
    setMoveOverrides(style, prefs.motions[style] ?? null);
  }
}

/** @deprecated applyOverrides を使う (体格のみ反映する旧 API) */
export const applyBodyOverrides = applyOverrides;
