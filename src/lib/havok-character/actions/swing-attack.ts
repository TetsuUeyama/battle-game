/**
 * 攻撃スイングアクション。
 * - createSwingMotion: SwingMotion の生成 (weapon/attack-swing から再エクスポート)
 * - swingAttack: SwingMotion の毎フレーム進行 + ヒット判定
 */
export { createSwingMotion } from '../weapon/attack-swing';
export type { SwingMotionOptions } from '../weapon/attack-swing';

import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getWeaponTipWorld } from '../weapon';
import { updateSwingMotion, applyBodyMotion } from '../weapon/attack-swing';
import { checkWeaponBlock } from './guard';

export interface SwingAttackResult {
  hit: boolean;
  damage: number;
  /** 武器でブロックされたか */
  blocked: boolean;
  /** 現在のモーションが完了したか */
  finished: boolean;
}

export function swingAttack(
  ai: CombatAI,
  character: HavokCharacter,
  opponent: HavokCharacter,
  dirs: { forward: Vector3; charRight: Vector3; charLeft: Vector3 } | null,
  dt: number,
): SwingAttackResult {
  let hit = false;
  let blocked = false;
  let damage = 0;
  let finished = false;

  if (ai.currentMotion && ai.currentMotion.active) {
    const frame = updateSwingMotion(ai.currentMotion, dt, character.root.position);
    if (frame) {
      character.ikChains.rightArm.target.copyFrom(frame.handTarget);
      character.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
      if (dirs) {
        applyBodyMotion(character, frame.body, dirs.forward, dirs.charRight);
      }
    }

    // ヒット判定: Strike フェーズの20%以降から開始
    // ヒットしてもモーションは止めない (武器は体を貫通/押し切る)
    const hitStartProgress = ai.currentMotion.windupRatio + (1 - ai.currentMotion.windupRatio) * 0.2;
    if (!hit && !blocked && ai.currentMotion.progress > hitStartProgress) {
      const tipWorld = getWeaponTipWorld(character);

      // 1. まず相手の武器でブロックされるかチェック
      if (opponent.weapon && checkWeaponBlock(opponent, tipWorld)) {
        blocked = true;
        // ブロック時: ダメージ大幅軽減
        damage = Math.floor((character.weaponSwing.power * 0.3 + 0.5));
      } else {
        // 2. ブロックされなければ体へのヒット判定
        const hitTargets = ['torso', 'head', 'hips'];
        const hitRadius = 0.4 + character.weapon!.length * 0.15;
        for (const boneName of hitTargets) {
          const bone = opponent.combatBones.get(boneName);
          if (!bone) continue;
          const bonePos = getWorldPos(bone);
          const tipDist = Vector3.Distance(tipWorld, bonePos);
          if (tipDist < hitRadius) {
            const boneMul = boneName === 'head' ? 1.5 : boneName === 'hips' ? 0.8 : 1.0;
            hit = true;
            damage = Math.floor((character.weaponSwing.power * 1 + 1.5) * boneMul);
            break;
          }
        }
      }
    }
  }

  if (!ai.currentMotion || !ai.currentMotion.active) {
    finished = true;
  }

  return { hit, damage, blocked, finished };
}
