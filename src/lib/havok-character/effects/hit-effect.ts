/**
 * ヒットエフェクト — 攻撃命中時の血しぶき発生。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import type { ParticleFxSystem } from '@/lib/particle-fx';
import { getWeaponTipWorld } from '../weapon';

/**
 * 攻撃命中時に血しぶきエフェクトを発生させる。
 * @param attacker 攻撃側キャラクター (武器先端位置を取得)
 * @param target   被弾側キャラクター (方向計算用)
 * @param damage   ダメージ量 (パーティクル数に影響)
 * @param fx       血しぶき用 ParticleFxSystem
 */
export function emitHitBlood(
  attacker: HavokCharacter,
  target: HavokCharacter,
  damage: number,
  fx: ParticleFxSystem,
): void {
  const tip = getWeaponTipWorld(attacker);
  const hitDir = target.root.position.subtract(attacker.root.position).normalize();
  fx.emit({
    origin: tip,
    pattern: { type: 'burst', normal: hitDir, spread: 0.8 },
    speed: 3.0,
    count: 15 + damage,
    sizeScale: 1.2,
  });
}
