/**
 * Character — キャラクター身体制御・生成・更新。
 *
 * character/
 *   directions.ts     キャラクター方向算出
 *   ik-solver.ts      IKソルバー・関節角度制限
 *   foot-planting.ts  足接地・ステッピング・バランス・重心
 *   create.ts         キャラクター生成 (initHavok統合)
 *   update.ts         毎フレーム更新 (IK・足ステップ・武器追従)
 *   scale.ts          ボーンスケーリング
 *   movement.ts       テレポート・衝突回避・フィールド境界
 *   body/             身体パラメータ
 */

// Directions
export { getCharacterDirections } from './directions';

// IK solver
export { solveIK2Bone, clampJointAngles, clampShoulderX, clampArmRotation, clampSpineRotation, createIKChains } from './ik-solver';

// Foot planting & balance
export {
  calculateCenterOfMass, getBalanceDeviation,
  initFootPlanting, updateFootStepping,
  updateBalance,
  createDebugVisuals, updateDebugVisuals,
  keepFootHorizontal,
} from './foot-planting';

// Create & update
export { createHavokCharacter, rebuildBodyMeshes } from './create';
export { updateHavokCharacter } from './update';

// Jump
export { startJump, updateJump } from '../actions/jump';

// Scale
export { scaleBones } from './scale';

// Movement
export { teleportCharacter, resolveCharacterCollision, clampToFieldBounds } from './movement';

// Reset
export { resetSpine } from './reset';

// Body self-collision
export { resolveBodySelfCollision } from './body-collision';

// Force propagation
export { computeForceMultiplier, computeForceDetails, computeChainForce } from './force-propagation';

// Joint readiness
export { maintainJointReadiness } from './joint-readiness';

