/**
 * バランスシステム設定。よろめき閾値・オフハンド自動補正の強度を定義。
 */

export const BALANCE_CONFIG = {
  /** よろめき発動の重心逸脱閾値 (m) */
  staggerThreshold: 0.08,
  /** よろめき時間の最大値 (秒) */
  maxStaggerTime: 1.0,
  /** よろめき時間の基礎値 (秒) */
  baseStaggerTime: 0.3,
  /** よろめき強度の上限 */
  maxStaggerIntensity: 1.0,
  /** オフハンド補正の発動閾値 (重心逸脱m) */
  offHandCorrectionThreshold: 0.02,
  /** オフハンド補正の最大移動量 (m) */
  offHandMaxCorrection: 0.3,
  /** オフハンド (腕) の実効質量比 */
  offHandArmWeight: 0.06,
} as const;
