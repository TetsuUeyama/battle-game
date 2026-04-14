/**
 * 戦況コンテキストの収集・評価。
 * AI の Situation から CombatContext を構築する。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI, SwingType } from '../types';
import type { CombatContext, StanceIntent, AttackIntent, OpponentPrediction, SelfPosture } from './types';
import { getWorldPos } from '@/lib/math-utils';
import { getWeaponTipWorld } from '../weapon';
import { getCharacterDirections } from '../character/directions';
import type { Situation } from '../ai/evaluate';

/**
 * Situation と現在のキャラクター状態から CombatContext を構築する。
 */
export function buildCombatContext(
  situation: Situation,
  character: HavokCharacter,
  opponent: HavokCharacter,
  stanceIntent: StanceIntent,
  attackIntent: AttackIntent | null,
): CombatContext {
  const opponentPrediction = predictOpponent(situation, opponent, character);
  const selfPosture = assessSelfPosture(character);

  const dirToOpponent = opponent.root.position.subtract(character.root.position);
  dirToOpponent.y = 0;
  if (dirToOpponent.length() > 0.001) dirToOpponent.normalize();

  return {
    opponent: opponentPrediction,
    self: selfPosture,
    stanceIntent,
    attackIntent,
    distance: situation.dist,
    dirToOpponent,
  };
}

/**
 * 相手の状態を予測する。
 */
function predictOpponent(
  situation: Situation,
  opponent: HavokCharacter,
  self: HavokCharacter,
): OpponentPrediction {
  let expectedAttackDir: Vector3 | null = null;
  let expectedSwingType: SwingType | null = null;
  let guardPosition: Vector3 | null = null;
  let weaponTipDir: Vector3 | null = null;
  let balanceDeviationDir: Vector3 | null = null;

  // 相手の武器先端方向
  if (opponent.weapon) {
    const tipWorld = getWeaponTipWorld(opponent);
    const gripWorld = getWorldPos(opponent.weaponAttachR);
    const tipDir = tipWorld.subtract(gripWorld);
    if (tipDir.length() > 0.01) {
      weaponTipDir = tipDir.normalize();
    }

    // ガード位置 = 相手のgrip位置
    guardPosition = gripWorld.clone();
  }

  // 相手が攻撃中 → 攻撃方向を予測
  if (situation.opponentAttacking) {
    const opDirs = getCharacterDirections(opponent);
    if (opDirs) {
      expectedAttackDir = opDirs.forward; // facing方向
      // tipSpeedが高ければ打撃フェーズ → 武器先端方向が攻撃方向
      if (weaponTipDir && situation.opponentInStrike) {
        expectedAttackDir = weaponTipDir.clone();
      }
    }

    // 攻撃タイプの推定: 武器先端の高さから判断
    if (opponent.weapon) {
      const tipWorld = getWeaponTipWorld(opponent);
      const opHips = opponent.combatBones.get('hips');
      const opHead = opponent.combatBones.get('head');
      if (opHips && opHead) {
        const hipsY = getWorldPos(opHips).y;
        const headY = getWorldPos(opHead).y;
        const tipY = tipWorld.y;
        const bodyMid = (hipsY + headY) / 2;
        if (tipY > headY) {
          expectedSwingType = 'vertical'; // 頭上 → 縦振り
        } else if (Math.abs(tipY - bodyMid) < 0.15) {
          expectedSwingType = 'horizontal'; // 体の真ん中 → 横振り
        } else {
          expectedSwingType = 'thrust'; // それ以外 → 突き
        }
      }
    }
  }

  // 相手のバランス偏差方向
  if (situation.opponentBalanceDeviation > 0.02) {
    const opHips = opponent.combatBones.get('hips');
    if (opHips) {
      const hipsPos = getWorldPos(opHips);
      const rootPos = opponent.root.position;
      const deviation = hipsPos.subtract(rootPos);
      deviation.y = 0;
      if (deviation.length() > 0.001) {
        balanceDeviationDir = deviation.normalize();
      }
    }
  }

  // 相手の攻撃圏内にいるか
  const opReach = (opponent.weapon?.length ?? 0.5)
    + (opponent.ikChains?.rightArm
      ? opponent.ikChains.rightArm.lengthA + opponent.ikChains.rightArm.lengthB
      : 0.5);
  const inTheirAttackRange = situation.dist < opReach * 1.1;

  return {
    expectedAttackDir,
    expectedSwingType,
    guardPosition,
    weaponTipDir,
    inTheirAttackRange,
    balanceDeviationDir,
  };
}

/**
 * 自分の現在の体勢を評価する。
 */
function assessSelfPosture(character: HavokCharacter): SelfPosture {
  // 現在のBodyMotion状態
  const currentLean = character.currentBodyMotion?.torsoLean ?? 0;
  const currentTwist = character.currentBodyMotion?.torsoTwist ?? 0;

  // バランス
  const balanceDeviation = character.balance.deviation;
  const balanceDeviationDir = character.balance.staggerDir?.clone() ?? Vector3.Zero();

  // 現在の右手IKターゲット
  const currentRightHandPos = character.ikChains.rightArm.target.clone();

  return {
    currentLean,
    currentTwist,
    balanceDeviation,
    balanceDeviationDir,
    currentRightHandPos,
    lastStrikeEndPos: null, // AI側で管理して設定する
  };
}

// ─── StanceIntent の決定 ─────────────────────────────────

/**
 * Situation から StanceIntent を決定する。
 */
export function decideStanceIntent(situation: Situation): StanceIntent {
  // 自分がよろめき中 or バランス崩れ → recovery
  if (situation.selfStaggered || situation.selfBalanceDeviation > 0.06) {
    return 'recovery';
  }

  // 相手がよろめき中 or バランス崩れ → aggressive (チャンス)
  if (situation.opponentStaggered || situation.opponentBalanceDeviation > 0.05) {
    return 'aggressive';
  }

  // 相手が攻撃中 + 近距離 → defensive
  if (situation.opponentAttacking && situation.opponentTipDist < 1.5) {
    return 'defensive';
  }

  // 相手の攻撃圏外 → neutral
  return 'neutral';
}

// ─── AttackIntent の決定 ─────────────────────────────────

/**
 * Situation から AttackIntent を決定する。
 */
export function decideAttackIntent(situation: Situation): AttackIntent {
  // 相手よろめき中 + (将来: HP低い) → finisher
  if (situation.opponentStaggered && situation.opponentBalanceDeviation > 0.08) {
    return 'finisher';
  }

  // 相手よろめき中 → damage
  if (situation.opponentStaggered) {
    return 'damage';
  }

  // 相手の攻撃後の隙 (攻撃していない + 近距離) → punish
  if (!situation.opponentAttacking && situation.dist < situation.weaponLength * 1.2
      && situation.opponentBalanceDeviation > 0.03) {
    return 'punish';
  }

  // コンボ1発目 → setup
  if (situation.comboRemaining <= 0) {
    return 'setup';
  }

  // コンボ2発目以降 → damage
  if (situation.comboRemaining > 0) {
    return 'damage';
  }

  // 距離が遠い → pressure
  if (situation.dist > situation.weaponLength * 0.8) {
    return 'pressure';
  }

  return 'damage';
}
