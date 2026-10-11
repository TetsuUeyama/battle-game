/**
 * feature5: emotion — excited / calm 2軸リソースの公開 API。
 *
 * 差分 (excited − calm) が技性能のトレードオフを、絶対水準が Zone / Fear を
 * 決める。Babylon 非依存の純ロジックで、combat へは
 * `playMove(mod.move, { startupSpeedRatio: mod.startupSpeedRatio })` で接続する。
 */

export {
  EmotionMeter,
  DEFAULT_EMOTION_TUNING,
  DEFAULT_EMOTION_PERSONALITY,
  type ModifiedMove,
} from "./EmotionMeter";

export {
  EMOTION_PERSONALITIES,
  HOTBLOOD,
  COOLHEADED,
  STEADY,
  TIMID,
  type EmotionPersonalityId,
} from "./presets";

export type {
  EmotionState,
  EmotionMood,
  EmotionEventType,
  EmotionDelta,
  EmotionPersonality,
  EmotionModifiers,
  EmotionTuning,
} from "./types";
