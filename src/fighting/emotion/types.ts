/**
 * feature5: emotion — excited / calm の2軸リソースの型契約。
 *
 * 設計の骨子:
 *  - 技性能の補正は「差分」 D = (excited − calm) / max で決まる (絶対値ではない)。
 *      excited 優勢 → 攻撃力↑ / 発生↑(遅) / クールタイム↑
 *      calm    優勢 → 攻撃力↓ / 発生↓(速) / クールタイム↓
 *  - 状態判定は「絶対水準」で決まる:
 *      両方が閾値以上 → Zone (いいところ取り)
 *      両方が閾値以下 → Fear (悪いところ取り)
 *    差分と水準が独立しているため、「性能の調整」と「状態リスクの管理」が
 *    別のゲームとして同時進行する。
 *  - 性格 (EmotionPersonality) は平衡点・回帰速度・イベント感受性で表現する。
 */

// ----------------------------------------------------------------- 状態

/** 2軸ゲージ。どちらも 0..max (既定 0..100) */
export interface EmotionState {
  excited: number;
  calm: number;
}

/** 現在の状態区分 */
export type EmotionMood = "neutral" | "zone" | "fear";

// ----------------------------------------------------------------- イベント

/**
 * ゲージを動かす行動イベント。
 * ★4象限すべてに到達経路を確保するため「両方上げる」(cleanHit) と
 * 「両方下げる」(bigDamage) イベントが必須 (シーソーだけだと Zone/Fear に届かない)。
 */
export type EmotionEventType =
  /** 攻撃を当てた (興奮が上がり、流れで冷静も微増) */
  | "dealHit"
  /** クリーンヒット/カウンター/ジャスト行動の成功 (両方上がる → Zone への道) */
  | "cleanHit"
  /** 被弾した (頭に血が上る: 興奮↑ 冷静↓) */
  | "takeHit"
  /** 大ダメージ/コンボをもらった (両方下がる → Fear への道) */
  | "bigDamage"
  /** 空振り (両方微減) */
  | "whiff"
  /** ガード成功 (冷静↑) */
  | "guardSuccess"
  /** 挑発 (興奮↑ 冷静↓。相手に効かせるかはゲーム側の自由) */
  | "taunt";

/** イベント 1 回あたりの基準変化量 */
export interface EmotionDelta {
  excited: number;
  calm: number;
}

// ----------------------------------------------------------------- 性格

/**
 * キャラクターの性格。ゲージの「変動の仕方」を個体差にする。
 * feature2 (個性ポーズ) のシステム版。
 */
export interface EmotionPersonality {
  /** 放置時にゲージが回帰していく平衡点 (性格の基準値) */
  baseline: EmotionState;
  /** 平衡点への回帰速度 (ゲージ/秒) */
  regenPerSec: number;
  /**
   * イベント感受性。イベントごとの基準変化量に掛ける倍率 (省略 = 1)。
   * 例: 熱血漢は takeHit の excited 倍率が大きい (すぐ頭に血が上る)。
   */
  sensitivity?: Partial<
    Record<EmotionEventType, { excited?: number; calm?: number }>
  >;
}

// ----------------------------------------------------------------- 補正

/** getModifiers() が返す、技に掛ける補正一式 */
export interface EmotionModifiers {
  mood: EmotionMood;
  /** ダメージ倍率 */
  damageMul: number;
  /** 発生時間の倍率 (>1 で遅い)。startup 区間の speedRatio = 1/startupMul で実現 */
  startupMul: number;
  /** クールタイム倍率 */
  cooldownMul: number;
}

// ----------------------------------------------------------------- チューニング

/** バランス調整値。全て外から差し替え可能 */
export interface EmotionTuning {
  /** ゲージ上限 (下限は 0) */
  max: number;
  /** 差分→各倍率のゲイン: mul = 1 + gain × D (D = 差分/max ∈ [-1,1]) */
  diffDamageGain: number;
  diffStartupGain: number;
  diffCooldownGain: number;
  /** 各倍率のクランプ範囲 [min, max] */
  damageMulRange: [number, number];
  startupMulRange: [number, number];
  cooldownMulRange: [number, number];
  /** Zone 突入閾値 (両ゲージ ≥ enter) と離脱閾値 (どちらかが < exit)。enter > exit でヒステリシス */
  zoneEnter: number;
  zoneExit: number;
  /** Fear 突入閾値 (両ゲージ ≤ enter) と離脱閾値 (どちらかが > exit)。enter < exit でヒステリシス */
  fearEnter: number;
  fearExit: number;
  /** Zone 中の固定補正 (いいところ取り) */
  zoneMods: Omit<EmotionModifiers, "mood">;
  /** Fear 中の固定補正 (悪いところ取り) */
  fearMods: Omit<EmotionModifiers, "mood">;
  /** イベントごとの基準変化量 */
  eventDeltas: Record<EmotionEventType, EmotionDelta>;
}
