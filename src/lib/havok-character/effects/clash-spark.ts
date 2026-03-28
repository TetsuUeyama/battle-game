/**
 * 武器クラッシュ火花エフェクト — 武器同士の衝突時の火花発生。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import type { ParticleFxSystem } from '@/lib/particle-fx';
import { getWeaponTipWorld } from '../weapon';

/**
 * 武器クラッシュ時に火花エフェクトを発生させる。
 * @param charA  キャラクターA
 * @param charB  キャラクターB
 * @param fx     火花用 ParticleFxSystem
 */
export function emitClashSpark(
  charA: HavokCharacter,
  charB: HavokCharacter,
  fx: ParticleFxSystem,
): void {
  const tipA = getWeaponTipWorld(charA);
  const tipB = getWeaponTipWorld(charB);
  const midPoint = Vector3.Lerp(tipA, tipB, 0.5);
  fx.emit({
    origin: midPoint,
    pattern: { type: 'burst', normal: Vector3.Up(), spread: 1.5 },
    speed: 5.0,
    count: 30,
    sizeScale: 1.0,
  });
}
