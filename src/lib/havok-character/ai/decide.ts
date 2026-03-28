/**
 * 行動決定 (Decide) — Situation を基に最終的な行動を決定する。
 *
 * evaluate.ts が「今の状況はどうか」を評価し、
 * このファイルが「だからどうするか」を決定する。
 *
 * ステート側はこの決定結果に従ってアクションを実行するだけ。
 * 新しい判断基準を追加する場合はここに集約する。
 */
import type { CombatAI, CombatAIState, SwingType } from '../types';
import type { Situation } from './evaluate';

/** 行動決定の結果 */
export interface Decision {
  /** 遷移先のステート (null = 現在のステートを維持) */
  nextState: CombatAIState | null;

  // ─── 攻撃関連 ───
  /** 攻撃を開始すべきか (close_in → attack) */
  shouldStartAttack: boolean;
  /** コンボを継続すべきか (attack → 次の振り) */
  shouldContinueCombo: boolean;
  /** 攻撃タイプ */
  attackType: SwingType;
  /** 攻撃パワー (0-100) */
  attackPower: number;
  /** コンボ回数 (攻撃開始時のみ有効) */
  comboCount: number;

  // ─── ターゲット ───
  /** 狙うボーン名 ('head' | 'torso' | 'hips') */
  targetBone: string;

  // ─── 移動関連 ───
  /** circle の横移動方向 (1=右, -1=左) */
  circleDir: number;
  /** circle の持続時間 (秒) */
  circleDuration: number;
}

/**
 * 状況に基づいて行動を決定する。
 */
export function decide(situation: Situation, ai: CombatAI): Decision {
  const s = situation;

  // ─── 攻撃タイプ選択 ───
  const attackType = pickAttackType(s);

  // ─── 攻撃パワー ───
  const attackPower = decideAttackPower(s);

  // ─── コンボ回数 ───
  const comboCount = decideComboCount(s, ai);

  // ─── コンボ継続判断 ───
  const shouldContinueCombo = decideComboContine(s);

  // ─── ステート遷移 ───
  const nextState = decideNextState(s, ai);

  // ─── ターゲットボーン ───
  const targetBone = decideTargetBone(s);

  // ─── circle パラメータ ───
  const { circleDir, circleDuration } = decideCircleParams(s);

  return {
    nextState,
    shouldStartAttack: nextState === 'attack' && ai.state === 'close_in',
    shouldContinueCombo,
    attackType,
    attackPower,
    comboCount,
    targetBone,
    circleDir,
    circleDuration,
  };
}

// ─── 攻撃タイプ選択 ─────────────────────────────────────

function pickAttackType(s: Situation): SwingType {
  const weights = getCategoryWeights(s.weaponCategory);

  // 相手がよろめき中 → 縦振り (大ダメージ) を優先
  if (s.opponentStaggered) {
    weights.vertical += 0.3;
  }

  // 遠距離 → 突きを優先
  if (s.dist > s.weaponLength * 0.8) {
    weights.thrust += 0.2;
  }

  // 相手が振りかぶり中 → 横振りで先制 (相手の構えを崩す)
  if (s.opponentInWindup) {
    weights.horizontal += 0.25;
  }

  // 相手の武器先端が近い → 突きで迎撃
  if (s.opponentAimingAtMe && s.opponentTipDist < 1.0) {
    weights.thrust += 0.3;
  }

  // リーチ有利 → 突きで距離を活かす
  if (s.hasReachAdvantage && s.dist > s.weaponLength * 0.5) {
    weights.thrust += 0.15;
  }

  // 重量有利 → 縦振りで押し切る
  if (s.hasWeightAdvantage) {
    weights.vertical += 0.1;
  }

  // 重み付きランダム選択
  const total = weights.vertical + weights.horizontal + weights.thrust;
  let r = Math.random() * total;
  if ((r -= weights.vertical) <= 0) return 'vertical';
  if ((r -= weights.horizontal) <= 0) return 'horizontal';
  return 'thrust';
}

// ─── 攻撃パワー ─────────────────────────────────────────

function decideAttackPower(s: Situation): number {
  if (s.opponentStaggered) {
    // よろめき中 → フルパワー
    return 85 + Math.random() * 15;
  }
  if (s.opponentInWindup) {
    // 相手が振りかぶり中 → 素早い軽い攻撃で先制
    return 40 + Math.random() * 30;
  }
  if (s.opponentBalanceDeviation > 0.05) {
    // 相手のバランスが崩れている → 強めに打って崩す
    return 75 + Math.random() * 25;
  }
  if (s.comboRemaining > 0) {
    // コンボ後続
    return 50 + Math.random() * 50;
  }
  return 60 + Math.random() * 40;
}

// ─── コンボ回数 ──────────────────────────────────────────

function decideComboCount(s: Situation, ai: CombatAI): number {
  let count = 1 + Math.floor(Math.random() * ai.maxCombo);

  // 相手がよろめき中 → コンボ延長
  if (s.opponentStaggered) {
    count = Math.min(count + 1, ai.maxCombo + 1);
  }

  // 相手のバランスが崩れている → 追撃チャンス
  if (s.opponentBalanceDeviation > 0.05) {
    count = Math.min(count + 1, ai.maxCombo + 1);
  }

  // 相手が攻撃中 → コンボ控えめ (カウンターされるリスク)
  if (s.opponentAttacking && !s.opponentStaggered) {
    count = Math.max(1, count - 1);
  }

  return count;
}

// ─── コンボ継続判断 ──────────────────────────────────────

function decideComboContine(s: Situation): boolean {
  // 自分がよろめき中 → コンボ中断
  if (s.selfStaggered) return false;

  // コンボ残りなし or 射程外
  if (!s.canContinueCombo) return false;

  // 相手が打撃フェーズ中 → 被弾リスクが高いのでコンボ中断して回避
  if (s.opponentInStrike && s.opponentTipDist < 1.5) return false;

  // 自分のバランスが大きく崩れている → 無理しない
  if (s.selfBalanceDeviation > 0.06) return false;

  return true;
}

// ─── ステート遷移 ────────────────────────────────────────

function decideNextState(s: Situation, ai: CombatAI): CombatAIState | null {
  switch (ai.state) {
    case 'idle':
      if (s.inPursueRange) return 'pursue';
      break;

    case 'pursue':
      if (ai.mode === 'target') {
        if (s.inAttackRange) return 'attack';
      } else {
        if (s.inSafeRange) return 'circle';
      }
      break;

    case 'circle':
      // 相手がよろめき中 or バランス崩れ → 即攻撃チャンス
      if (s.opponentStaggered && s.inAttackRange) return 'close_in';
      if (s.opponentBalanceDeviation > 0.06 && s.inSafeRange) return 'close_in';
      // 相手が攻撃後の回復中（swinging でない + 近距離） → 反撃チャンス
      if (!s.opponentAttacking && s.dist < ai.safeRange * 1.2) {
        if (s.circleTimer <= 0) return 'close_in';
      }
      if (s.circleTimer <= 0) return 'close_in';
      break;

    case 'close_in':
      if (s.inAttackRange) return 'attack';
      if (s.tooFarForCloseIn) return 'pursue';
      // 相手が攻撃を始めた → 一旦引いて回避
      if (s.opponentInStrike && s.opponentTipDist < 1.5) return 'pursue';
      break;

    case 'attack':
      break;

    case 'retreat':
      if (s.dist >= ai.safeRange || s.recoverTimer <= 0) return 'recover';
      break;

    case 'recover':
      if (s.recoverTimer <= 0) return ai.mode === 'target' ? 'pursue' : 'circle';
      break;
  }

  return null;
}

// ─── ターゲットボーン ────────────────────────────────────

function decideTargetBone(s: Situation): string {
  const BONES = ['head', 'torso', 'hips'];

  // よろめき中 → 頭 (高ダメージ)
  if (s.opponentStaggered) return 'head';

  // バランス崩れ → 胴体 (安定してヒットしやすい)
  if (s.opponentBalanceDeviation > 0.05) return 'torso';

  // 相手が攻撃中 → 腰 (低い位置で相手の攻撃を避けつつ当てる)
  if (s.opponentAttacking) return 'hips';

  return BONES[Math.floor(Math.random() * BONES.length)];
}

// ─── circle パラメータ ───────────────────────────────────

function decideCircleParams(s: Situation): { circleDir: number; circleDuration: number } {
  const circleDir = Math.random() > 0.5 ? 1 : -1;

  let circleDuration: number;
  if (s.opponentAttacking) {
    // 相手が攻撃中 → 短めに様子見して反撃チャンスを狙う
    circleDuration = 0.5 + Math.random() * 0.5;
  } else if (s.opponentStaggered || s.opponentBalanceDeviation > 0.05) {
    // 相手が弱っている → 即攻撃
    circleDuration = 0.2 + Math.random() * 0.3;
  } else if (s.hasReachAdvantage) {
    // リーチ有利 → じっくり間合い管理
    circleDuration = 1.5 + Math.random() * 1.5;
  } else {
    circleDuration = 1.0 + Math.random() * 1.5;
  }

  return { circleDir, circleDuration };
}

// ─── 武器カテゴリ別基本重み ──────────────────────────────

function getCategoryWeights(category?: string): { vertical: number; horizontal: number; thrust: number } {
  switch (category) {
    case 'halberds':
    case 'spears':
      return { vertical: 0.4, horizontal: 0.15, thrust: 0.45 };
    case 'greatswords':
    case 'longswords':
      return { vertical: 0.4, horizontal: 0.4, thrust: 0.2 };
    case 'axes':
    case 'hammers':
    case 'maces':
      return { vertical: 0.6, horizontal: 0.3, thrust: 0.1 };
    case 'daggers':
    case 'short_swords':
      return { vertical: 0.2, horizontal: 0.3, thrust: 0.5 };
    default:
      return { vertical: 0.34, horizontal: 0.33, thrust: 0.33 };
  }
}
