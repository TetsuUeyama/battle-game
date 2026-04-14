/**
 * 武器装備時の事前計算とキャッシュ管理。
 */
import type { HavokCharacter, WeaponPhysics } from '../types';
import type { SolverCache } from './types';
import { precomputeStances } from './stance-solver';

/**
 * 武器装備時に呼び出す。ソルバーキャッシュを生成して character に保存する。
 * 武器が同じ場合は再計算しない。
 */
export function initSolverCache(
  character: HavokCharacter,
  weapon: WeaponPhysics,
): SolverCache {
  // 既存キャッシュがあり、同じ武器なら再利用
  const existing = (character as any).solverCache as SolverCache | undefined;
  if (existing && existing.weapon === weapon) {
    return existing;
  }

  const cache = precomputeStances(character, weapon);
  (character as any).solverCache = cache;
  return cache;
}

/**
 * キャッシュを取得する。存在しない場合は null。
 */
export function getSolverCache(character: HavokCharacter): SolverCache | null {
  return (character as any).solverCache ?? null;
}

/**
 * キャッシュをクリアする (武器を外した時)。
 */
export function clearSolverCache(character: HavokCharacter): void {
  (character as any).solverCache = null;
}
