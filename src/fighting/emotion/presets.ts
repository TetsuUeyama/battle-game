/**
 * 性格プリセット。EmotionMeter のコンストラクタへそのまま渡せる。
 * ゲーム側はこれを下敷きに sensitivity を上書きしてキャラ差を作る。
 */

import type { EmotionPersonality } from "./types";

/** 熱血漢: 平衡点が興奮寄り。被弾・挑発ですぐ頭に血が上り、Zone も Fear も興奮側から近い */
export const HOTBLOOD: EmotionPersonality = {
  baseline: { excited: 62, calm: 40 },
  regenPerSec: 4,
  sensitivity: {
    takeHit: { excited: 1.5 },
    taunt: { excited: 1.4 },
    guardSuccess: { calm: 0.7 }, // ガードしても冷静になりにくい
  },
};

/** 冷静沈着: 平衡点が冷静寄り。ガードで整い、被弾でも乱れにくいが火力が乗りにくい */
export const COOLHEADED: EmotionPersonality = {
  baseline: { excited: 38, calm: 64 },
  regenPerSec: 4,
  sensitivity: {
    takeHit: { excited: 0.6, calm: 0.6 }, // 被弾で乱れにくい
    guardSuccess: { calm: 1.4 },
    dealHit: { excited: 0.8 }, // 当てても燃えにくい
  },
};

/** 中庸: 平衡点 50/50。クリーンヒットへの感度が高く Zone を狙いやすい */
export const STEADY: EmotionPersonality = {
  baseline: { excited: 50, calm: 50 },
  regenPerSec: 3,
  sensitivity: {
    cleanHit: { excited: 1.2, calm: 1.2 },
  },
};

/** ビビり: 平衡点が低め。大ダメージで一気に Fear へ落ちるが、回帰が速く立ち直りも早い */
export const TIMID: EmotionPersonality = {
  baseline: { excited: 40, calm: 42 },
  regenPerSec: 6,
  sensitivity: {
    bigDamage: { excited: 1.4, calm: 1.4 },
    whiff: { excited: 1.3, calm: 1.3 },
  },
};

export const EMOTION_PERSONALITIES = {
  hotblood: HOTBLOOD,
  coolheaded: COOLHEADED,
  steady: STEADY,
  timid: TIMID,
} as const;

export type EmotionPersonalityId = keyof typeof EMOTION_PERSONALITIES;
