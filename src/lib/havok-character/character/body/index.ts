/**
 * Body — 身体パラメータの一元管理。
 *
 * 関節可動域・重心配分・力の伝達・足接地・武器スケーリング・モーション基本値など、
 * キャラクターの物理的な振る舞いを決定するパラメータをこのフォルダに集約。
 *
 * combat-ai/
 *   body/
 *     joints.ts        関節可動域制限
 *     mass.ts          重心配分 (部位別質量比)
 *     foot-plant.ts    足接地 (ステッピング・スタンス幅)
 *     balance.ts       バランス (よろめき閾値・オフハンド補正)
 *     grip.ts          グリップ (手のひらオフセット・座標)
 *     swing-presets.ts 攻撃モーション基本値 + scalePreset
 *     weapon-scale.ts  武器スケーリング基準値
 *     physics.ts       物理カプセル (身長・半径・質量)
 *     turn.ts          回転速度
 */

export { JOINT_CONFIG } from './joints';
export type { JointLimitDef } from './joints';

export { MASS_DISTRIBUTION } from './mass';

export { FOOT_PLANT_CONFIG } from './foot-plant';

export { BALANCE_CONFIG } from './balance';

export { GRIP_CONFIG } from './grip';

export { SWING_PRESETS, scalePreset } from './swing-presets';
export type { BodyMotionPreset, SwingPreset } from './swing-presets';

export { WEAPON_SCALE_CONFIG } from './weapon-scale';

export { PHYSICS_CONFIG } from './physics';

export { TURN_CONFIG } from './turn';
