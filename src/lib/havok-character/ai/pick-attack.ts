/**
 * 攻撃タイプの選択判断。
 * 武器カテゴリに基づく重み付きランダムで攻撃タイプを決定する。
 */
import type { HavokCharacter, SwingType } from '../types';

// ─── 攻撃タイプ重み付け定義 ─────────────────────────────

interface AttackTypeWeight {
  type: SwingType;
  weight: number;
}

/** 武器カテゴリごとの攻撃タイプ確率分布 */
export function getPreferredAttackTypes(category?: string): AttackTypeWeight[] {
  switch (category) {
    case 'halberds':
    case 'spears':
      return [
        { type: 'vertical', weight: 0.4 },
        { type: 'thrust', weight: 0.45 },
        { type: 'horizontal', weight: 0.15 },
      ];
    case 'greatswords':
    case 'longswords':
      return [
        { type: 'horizontal', weight: 0.4 },
        { type: 'vertical', weight: 0.4 },
        { type: 'thrust', weight: 0.2 },
      ];
    case 'axes':
    case 'hammers':
    case 'maces':
      return [
        { type: 'vertical', weight: 0.6 },
        { type: 'horizontal', weight: 0.3 },
        { type: 'thrust', weight: 0.1 },
      ];
    case 'daggers':
    case 'short_swords':
      return [
        { type: 'thrust', weight: 0.5 },
        { type: 'horizontal', weight: 0.3 },
        { type: 'vertical', weight: 0.2 },
      ];
    default:
      return [
        { type: 'vertical', weight: 0.34 },
        { type: 'horizontal', weight: 0.33 },
        { type: 'thrust', weight: 0.33 },
      ];
  }
}

/** 重み付きランダムで攻撃タイプを1つ選択 */
export function pickWeightedAttackType(weights: AttackTypeWeight[]): SwingType {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of weights) {
    r -= w.weight;
    if (r <= 0) return w.type;
  }
  return weights[weights.length - 1].type;
}

/** 武器カテゴリに基づいて攻撃タイプを選択 (ショートカット) */
export function pickAttackType(character: HavokCharacter): SwingType {
  return pickWeightedAttackType(getPreferredAttackTypes(character.weapon?.category));
}

/** 攻撃パワーをランダム生成 (初回攻撃用: 60-100%) */
export function rollAttackPower(): number {
  return 60 + Math.random() * 40;
}

/** コンボ後続のパワーをランダム生成 (50-100%、ややバラつき) */
export function rollComboPower(): number {
  return 50 + Math.random() * 50;
}
