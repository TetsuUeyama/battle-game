/**
 * feature5: emotion — excited / calm の2軸ゲージ本体。
 *
 * 使い方 (ゲーム層):
 * ```ts
 * const meter = new EmotionMeter(HOTBLOOD);          // 性格を渡す
 * combat.onHit((e) => {
 *   meterAtk.notify("dealHit");                       // 行動でゲージが動く
 *   meterDef.notify(e.move.damage! >= 12 ? "bigDamage" : "takeHit");
 * });
 * // 毎フレーム
 * meter.update(dtSec);
 * // 技を出すとき
 * const mod = meter.applyToMove(jab);
 * combat.playMove(mod.move, { fadeSec: 0.12, startupSpeedRatio: mod.startupSpeedRatio });
 * // ダメージ適用 (HP はゲーム側): e.move.damage は補正済み
 * ```
 *
 * Babylon に依存しない純ロジック (テスト・CPU AI からも使える)。
 */

import type { MoveDefinition } from "../fighting/types";
import type {
  EmotionState,
  EmotionMood,
  EmotionEventType,
  EmotionPersonality,
  EmotionModifiers,
  EmotionTuning,
} from "./types";

/** 既定チューニング。ゲーム側で部分上書きできる */
export const DEFAULT_EMOTION_TUNING: EmotionTuning = {
  max: 100,
  diffDamageGain: 0.5,
  diffStartupGain: 0.4,
  diffCooldownGain: 0.5,
  damageMulRange: [0.6, 1.5],
  startupMulRange: [0.7, 1.4],
  cooldownMulRange: [0.6, 1.5],
  zoneEnter: 70,
  zoneExit: 60,
  fearEnter: 25,
  fearExit: 35,
  // Zone: 興奮側の火力と冷静側の速さを両取り
  zoneMods: { damageMul: 1.3, startupMul: 0.8, cooldownMul: 0.7 },
  // Fear: 火力は下がり、動きも重くなる
  fearMods: { damageMul: 0.75, startupMul: 1.25, cooldownMul: 1.4 },
  eventDeltas: {
    dealHit: { excited: 8, calm: 2 },
    cleanHit: { excited: 10, calm: 8 },
    takeHit: { excited: 6, calm: -8 },
    bigDamage: { excited: -10, calm: -12 },
    whiff: { excited: -3, calm: -4 },
    guardSuccess: { excited: -2, calm: 7 },
    taunt: { excited: 12, calm: -5 },
  },
};

/** 性格の既定 (中庸): 平衡点 50/50、回帰 3/秒、感受性は基準どおり */
export const DEFAULT_EMOTION_PERSONALITY: EmotionPersonality = {
  baseline: { excited: 50, calm: 50 },
  regenPerSec: 3,
};

/** applyToMove の戻り */
export interface ModifiedMove {
  /** cooldown / damage を補正済みの MoveDefinition (元オブジェクトは不変) */
  move: MoveDefinition;
  /**
   * startup 区間に適用すべき speedRatio (= 1 / startupMul)。
   * CombatController.playMove の startupSpeedRatio へ渡すと、発生モーションの
   * 「見た目」ごと伸縮し、判定タイミングも masterFrame 追跡で自動的に追従する。
   */
  startupSpeedRatio: number;
  /** 参考値: 適用した補正一式 */
  modifiers: EmotionModifiers;
}

export class EmotionMeter {
  readonly personality: EmotionPersonality;
  readonly tuning: EmotionTuning;

  private excited: number;
  private calm: number;
  private mood: EmotionMood = "neutral";

  constructor(
    personality?: Partial<EmotionPersonality>,
    tuning?: Partial<EmotionTuning>,
  ) {
    this.personality = { ...DEFAULT_EMOTION_PERSONALITY, ...personality };
    this.tuning = { ...DEFAULT_EMOTION_TUNING, ...tuning };
    this.excited = this.personality.baseline.excited;
    this.calm = this.personality.baseline.calm;
    this.refreshMood();
  }

  // -------------------------------------------------------------- 入出力

  /** 行動イベントを通知してゲージを動かす。scale で強弱 (既定 1) */
  notify(event: EmotionEventType, scale = 1): void {
    const base = this.tuning.eventDeltas[event];
    const sens = this.personality.sensitivity?.[event];
    this.excited = this.clampGauge(
      this.excited + base.excited * (sens?.excited ?? 1) * scale,
    );
    this.calm = this.clampGauge(
      this.calm + base.calm * (sens?.calm ?? 1) * scale,
    );
    this.refreshMood();
  }

  /** 毎フレーム呼ぶ。平衡点 (性格の基準値) へゆっくり回帰する */
  update(dtSec: number): void {
    const { baseline, regenPerSec } = this.personality;
    const step = regenPerSec * dtSec;
    this.excited = approach(this.excited, baseline.excited, step);
    this.calm = approach(this.calm, baseline.calm, step);
    this.refreshMood();
  }

  /** デバッグ/演出用の直接設定 */
  setState(state: Partial<EmotionState>): void {
    if (state.excited !== undefined) this.excited = this.clampGauge(state.excited);
    if (state.calm !== undefined) this.calm = this.clampGauge(state.calm);
    this.refreshMood();
  }

  getState(): EmotionState {
    return { excited: this.excited, calm: this.calm };
  }

  getMood(): EmotionMood {
    return this.mood;
  }

  // -------------------------------------------------------------- 補正

  /**
   * 現在のゲージから技補正を計算する。
   * neutral: 差分 D = (excited − calm)/max で連続的に決まる。
   * zone / fear: 固定補正で上書き (いいところ取り / 悪いところ取り)。
   */
  getModifiers(): EmotionModifiers {
    const t = this.tuning;
    if (this.mood === "zone") return { mood: "zone", ...t.zoneMods };
    if (this.mood === "fear") return { mood: "fear", ...t.fearMods };

    const d = (this.excited - this.calm) / t.max; // -1..1
    return {
      mood: "neutral",
      damageMul: clampRange(1 + t.diffDamageGain * d, t.damageMulRange),
      startupMul: clampRange(1 + t.diffStartupGain * d, t.startupMulRange),
      cooldownMul: clampRange(1 + t.diffCooldownGain * d, t.cooldownMulRange),
    };
  }

  /**
   * MoveDefinition に現在の補正を適用したコピーを返す (元は不変)。
   * - cooldown: × cooldownMul (四捨五入)
   * - damage:   × damageMul
   * - 発生: 戻り値の startupSpeedRatio を playMove へ渡して実現する
   *   (フレームデータの active 値はクリップ座標のままなので書き換えない)
   */
  applyToMove(move: MoveDefinition): ModifiedMove {
    const m = this.getModifiers();
    return {
      move: {
        ...move,
        cooldown: Math.round(move.cooldown * m.cooldownMul),
        damage:
          move.damage !== undefined ? move.damage * m.damageMul : undefined,
      },
      startupSpeedRatio: 1 / m.startupMul,
      modifiers: m,
    };
  }

  // -------------------------------------------------------------- internal

  /**
   * mood をヒステリシス付きで更新する。
   * 突入と離脱の閾値を分けてあるので、境界上での状態フリッカが起きない。
   */
  private refreshMood(): void {
    const t = this.tuning;
    if (this.mood === "zone") {
      // 離脱: どちらかが exit を割ったら解除
      if (this.excited < t.zoneExit || this.calm < t.zoneExit) {
        this.mood = "neutral";
      }
      return;
    }
    if (this.mood === "fear") {
      // 離脱: どちらかが exit を超えたら解除
      if (this.excited > t.fearExit || this.calm > t.fearExit) {
        this.mood = "neutral";
      }
      return;
    }
    // neutral からの突入判定
    if (this.excited >= t.zoneEnter && this.calm >= t.zoneEnter) {
      this.mood = "zone";
    } else if (this.excited <= t.fearEnter && this.calm <= t.fearEnter) {
      this.mood = "fear";
    }
  }

  private clampGauge(v: number): number {
    return Math.min(this.tuning.max, Math.max(0, v));
  }
}

/** current を target へ最大 step だけ近づける */
function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

function clampRange(v: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, v));
}
