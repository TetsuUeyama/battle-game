/**
 * Weapon — 武器システムの再エクスポート。
 *
 * weapon/
 *   equip.ts     装備・解除・構え変更
 *   loader.ts    game-assetsからの武器ロード・メッシュ構築
 *   physics.ts   先端位置追跡・慣性・パワー・スイング状態
 */

// 装備・構え
export { equipWeapon, setStance, unequipWeapon, applyStance } from './equip';

// ローダー
export { fetchGameAssetWeapons, equipGameAssetWeapon } from './loader';

// 物理
export {
  getWeaponTipWorld, updateWeaponInertia, updateWeaponPower,
  startSwing, endSwing, releaseOffHand,
} from './physics';

// 攻撃スイング (武器の振り方)
export {
  getWeaponScaleFactors, createSwingMotion, updateSwingMotion, applyBodyMotion,
} from './attack-swing';
export type { WeaponScaleFactors, SwingMotionOptions } from './attack-swing';

// 防御的スイング (相手武器を回避するBezier軌道攻撃)
export {
  evaluateBezier, computeAttackPath, createDefenceSwingMotion,
} from './defence-swing';

// 構え位置
export { getOffHandRestPosition, getStanceTargets, updateStance } from './stance';

// 手首回転・武器慣性
export { updateWristRotation } from './wrist-control';

// 練習用標的 (作成 + ランダム移動)
export { createTarget, createTargetMover, updateTargetMover } from './target';
