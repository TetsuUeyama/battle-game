/**
 * 物理カプセル設定。キャラクターの身長・半径・質量・ダンピングを定義。
 */

export const PHYSICS_CONFIG = {
  /** キャラクターの身長 (m) */
  capsuleHeight: 1.6,
  /** カプセル半径 (m) */
  capsuleRadius: 0.25,
  /** 質量 (kg) */
  mass: 70,
  /** 角度ダンピング */
  angularDamping: 1000,
} as const;
