/**
 * Combat AI — ファクトリ関数。
 */
import { Vector3, TransformNode } from '@babylonjs/core';
import type { CombatAI, HavokCharacter, WeaponPhysics } from '../types';

/**
 * CombatAI を作成 (target モード: 静的標的追尾用)
 */
export function createCombatAI(targetNode: TransformNode, weapon: WeaponPhysics): CombatAI {
  return {
    state: 'idle',
    mode: 'target',
    targetNode,
    targetCharacter: null,
    attackRange: weapon.length * 0.9,
    pursueRange: 5.0,
    walkSpeed: 1.0,
    runSpeed: 2.5,
    runThreshold: 2.0,
    recoverTime: 0.8,
    recoverTimer: 0,
    safeRange: weapon.length * 0.9 + 0.5,
    circleDir: 1,
    circleTimer: 0,
    retreatSpeed: 1.5,
    currentMotion: null,
    attackIndex: 0,
    enabled: false,
    comboRemaining: 0,
    maxCombo: 3,
  };
}

/**
 * 対キャラクターAIを作成 (character モード)
 *
 * attackRange = 武器長 + 腕リーチ(0.5m) + 踏み込み(0.25m)
 * safeRange   = attackRange + 0.5m
 * maxCombo    = 武器重量から自動算出 (軽い→多い, 重い→少ない)
 */
export function createCombatAIvsCharacter(
  targetCharacter: HavokCharacter,
  weapon: WeaponPhysics,
): CombatAI {
  const armReach = 0.5;
  const lungeReach = 0.25;
  const atkRange = weapon.length + armReach + lungeReach;
  const combo = Math.max(1, Math.round(4 - weapon.weight * 0.3));
  return {
    state: 'idle',
    mode: 'character',
    targetNode: targetCharacter.root,
    targetCharacter,
    attackRange: atkRange,
    pursueRange: 8.0,
    walkSpeed: 1.0,
    runSpeed: 2.5,
    runThreshold: 3.0,
    recoverTime: 0.6,
    recoverTimer: 0,
    safeRange: atkRange + 0.5,
    circleDir: Math.random() > 0.5 ? 1 : -1,
    circleTimer: 0,
    retreatSpeed: 1.5,
    currentMotion: null,
    attackIndex: Math.floor(Math.random() * 3),
    enabled: false,
    comboRemaining: 0,
    maxCombo: combo,
  };
}
