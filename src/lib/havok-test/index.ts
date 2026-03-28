/**
 * havok-test ページ用ライブラリ。
 *
 * havok-test/
 *   bone-visualizer.ts  ボーン可視化 (関節球 + ライン)
 *   constants.ts        定数・ユーティリティ (SELECTABLE_BONES, ensureBasePos)
 *   scene-setup.ts      Babylon.js シーン初期化
 *   joint-monitor.ts    関節角度リアルタイム計算
 *   motion-test.ts      モーションテスト再生
 */

export { buildBoneHierarchy } from './bone-visualizer';
export type { BoneEntry, BoneDataFile } from './bone-visualizer';

export { SELECTABLE_BONES, ensureBasePos, clearHipsBaseCache } from './constants';

export { setupScene } from './scene-setup';
export type { SceneObjects } from './scene-setup';

export { computeJointAngles } from './joint-monitor';
export type { JointAngleMap } from './joint-monitor';

export { playMotionTest, updateMotionTest, isMotionTestPlaying } from './motion-test';

export { useHavokTestState } from './use-havok-state';
export type { HavokTestState, HavokTestActions } from './use-havok-state';

export { BonePanel, WeaponPanel, DebugPanel, TabContainer } from './panels';

export { storeBaseValues, applyTransform } from './bone-controls';
export type { BoneRefs } from './bone-controls';

export { initScene } from './scene-loop';
export type { SceneCallbacks, SceneRefs, SceneControls } from './scene-loop';

export { useSyncEffects } from './use-sync-effects';
