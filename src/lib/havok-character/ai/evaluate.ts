/**
 * 状況評価 (Evaluate) — 毎フレームの戦況を一括評価し、判断材料を構造化する。
 */
import type { CombatAI, HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getWeaponTipWorld } from '../weapon';

/** 毎フレームの戦況 */
export interface Situation {
  // ─── 距離 ───
  /** 相手までの水平距離 (m) */
  dist: number;
  /** 攻撃射程内か */
  inAttackRange: boolean;
  /** 安全距離内か */
  inSafeRange: boolean;
  /** 追尾開始距離内か */
  inPursueRange: boolean;
  /** close_in を諦めるべき距離か */
  tooFarForCloseIn: boolean;

  // ─── 自分の状態 ───
  /** 自分のHP比率 (0-1) — 将来用 */
  selfHpRatio: number;
  /** コンボ残り回数 */
  comboRemaining: number;
  /** コンボ継続可能か (残りがあり射程内) */
  canContinueCombo: boolean;
  /** 現在のスイングモーションが完了したか */
  swingFinished: boolean;
  /** よろめき中か */
  selfStaggered: boolean;
  /** 自分のバランス逸脱度 (0=安定, 大きいほど不安定) */
  selfBalanceDeviation: number;

  // ─── 相手の状態 ───
  /** 相手がよろめき中か */
  opponentStaggered: boolean;
  /** 相手が攻撃中 (スイング中) か */
  opponentAttacking: boolean;
  /** 相手のスイング進行度 (0-1, 攻撃中でなければ 0) */
  opponentSwingProgress: number;
  /** 相手が振りかぶり中か (windupフェーズ) */
  opponentInWindup: boolean;
  /** 相手が打撃フェーズ中か (strikeフェーズ) */
  opponentInStrike: boolean;
  /** 相手が回復中 (recover/retreat) か */
  opponentRecovering: boolean;
  /** 相手の武器先端が自分に向かっているか (先端→自分の角度が小さい) */
  opponentAimingAtMe: boolean;
  /** 相手の武器先端までの距離 (m) */
  opponentTipDist: number;
  /** 相手のバランス逸脱度 */
  opponentBalanceDeviation: number;
  /** 相手の武器重量 (kg) */
  opponentWeaponWeight: number;
  /** 相手の武器長 (m) */
  opponentWeaponLength: number;

  // ─── 武器 ───
  /** 武器重量 (kg) */
  weaponWeight: number;
  /** 武器長 (m) */
  weaponLength: number;
  /** 武器カテゴリ */
  weaponCategory: string | undefined;
  /** 自分の武器が相手より長いか */
  hasReachAdvantage: boolean;
  /** 自分の武器が相手より重いか */
  hasWeightAdvantage: boolean;

  // ─── タイマー ───
  /** 回復タイマー残り (秒) */
  recoverTimer: number;
  /** circleタイマー残り (秒) */
  circleTimer: number;
}

/**
 * 現在の戦況を一括評価する。
 */
export function evaluate(
  ai: CombatAI,
  character: HavokCharacter,
  opponent: HavokCharacter,
  dist: number,
): Situation {
  const weapon = character.weapon;
  const opWeapon = opponent.weapon;

  // 相手のスイング状態
  const opSwinging = opponent.weaponSwing.swinging;
  const opMotion = opSwinging && ai.targetCharacter
    ? (opponent as any)._aiMotion ?? null  // AI経由でないスイングには _aiMotion はない
    : null;
  // CombatAI の currentMotion にアクセスできないため、weaponSwing から判定
  const opSwingProgress = opSwinging ? opponent.weaponSwing.tipSpeed > 0.1 ? 0.7 : 0.3 : 0;

  // 相手の武器先端が自分に向かっているか
  let opponentAimingAtMe = false;
  let opponentTipDist = Infinity;
  if (opWeapon) {
    const opTip = getWeaponTipWorld(opponent);
    const myPos = character.root.position;
    opponentTipDist = opTip.subtract(myPos).length();
    // 先端が自分から2m以内なら「狙われている」
    opponentAimingAtMe = opponentTipDist < 2.0;
  }

  return {
    // 距離
    dist,
    inAttackRange: dist <= ai.attackRange,
    inSafeRange: dist <= ai.safeRange,
    inPursueRange: dist < ai.pursueRange,
    tooFarForCloseIn: dist > ai.safeRange + 1.0,

    // 自分の状態
    selfHpRatio: 1.0,
    comboRemaining: ai.comboRemaining,
    canContinueCombo: ai.comboRemaining > 0 && dist <= ai.attackRange * 1.3,
    swingFinished: !ai.currentMotion || !ai.currentMotion.active,
    selfStaggered: character.balance.staggered,
    selfBalanceDeviation: character.balance.deviation,

    // 相手の状態
    opponentStaggered: opponent.balance.staggered,
    opponentAttacking: opSwinging,
    opponentSwingProgress: opSwingProgress,
    opponentInWindup: opSwinging && opSwingProgress < 0.4,
    opponentInStrike: opSwinging && opSwingProgress >= 0.4,
    opponentRecovering: false, // 相手のAIステートにはアクセスできないため、swinging でない = 非攻撃中と判断
    opponentAimingAtMe,
    opponentTipDist,
    opponentBalanceDeviation: opponent.balance.deviation,
    opponentWeaponWeight: opWeapon?.weight ?? 1.0,
    opponentWeaponLength: opWeapon?.length ?? 0.5,

    // 武器
    weaponWeight: weapon?.weight ?? 1.0,
    weaponLength: weapon?.length ?? 0.5,
    weaponCategory: weapon?.category,
    hasReachAdvantage: (weapon?.length ?? 0.5) > (opWeapon?.length ?? 0.5),
    hasWeightAdvantage: (weapon?.weight ?? 1.0) > (opWeapon?.weight ?? 1.0),

    // タイマー
    recoverTimer: ai.recoverTimer,
    circleTimer: ai.circleTimer,
  };
}
