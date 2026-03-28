/**
 * Effects — 戦闘エフェクト。
 *
 * effects/
 *   presets.ts       パーティクルプリセット (血しぶき・火花)
 *   hit-effect.ts    ヒット時の血しぶき発生
 *   clash-spark.ts   武器クラッシュ時の火花発生
 *   clash.ts         武器クラッシュ判定・反動 (pushback + 胴体ぐらつき)
 */

export { PRESET_COMBAT_BLOOD, PRESET_COMBAT_SPARK } from './presets';
export { emitHitBlood } from './hit-effect';
export { emitClashSpark } from './clash-spark';
export { checkWeaponClash, updateClashReaction } from './clash';
