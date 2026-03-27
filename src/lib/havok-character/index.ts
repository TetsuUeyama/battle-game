/**
 * Havok Character System — Re-exports for backward compatibility.
 * All existing imports from '@/lib/havok-character' continue to work.
 */

// Types & constants
export type {
  GripType, StanceType, WeaponPhysics, WeaponSwingState,
  BoneEntry, BoneDataFile,
  IKChain, JumpState, BalanceState, FootStep, FootStepper, DebugVisuals,
  HavokCharacter, BodyPartDef, CreateCharacterOptions,
  SwingType, BodyMotion, SwingMotion, SwingFrame,
  CombatAIState, CombatAIMode, CombatAI, TargetMover,
  ClashState, GameAssetWeaponInfo, BezierAttackPath,
  JointLimits,
} from './types';
export {
  createDefaultWeapon, createWeaponSwingState,
  createJumpState, createBalanceState, createClashState,
  neutralBody,
  BODY_PARTS, COMBAT_BONE_MAP, PALM_OFFSET, PALM_GRIP_POINTS,
  COM_WEIGHTS, JOINT_LIMITS, BONE_DATA_URL,
} from './types';

// Helpers
export {
  degToRad, eulerDegreesToQuat,
  rotateVectorByQuat, rotationBetweenVectors, applyWorldDeltaRotation,
  getWorldPos, distanceBetweenBones,
  getCharacterDirections, getOffHandRestPosition, getStanceTargets,
} from './helpers';

// IK solver
export { solveIK2Bone, clampJointAngles, createIKChains } from './ik-solver';

// Foot planting & balance
export {
  calculateCenterOfMass, getBalanceDeviation,
  initFootPlanting, updateFootStepping,
  updateBalance,
  createDebugVisuals, updateDebugVisuals,
  keepFootHorizontal,
} from './foot-planting';

// Core character lifecycle
export {
  initHavok,
  createHavokCharacter, updateHavokCharacter,
  startJump, updateJump,
  scaleBones, rebuildBodyMeshes,
  teleportCharacter, resolveCharacterCollision, clampToFieldBounds,
} from './core';

// Weapon system
export {
  equipWeapon, setStance, unequipWeapon,
  fetchGameAssetWeapons, equipGameAssetWeapon,
  getWeaponTipWorld, updateWeaponInertia, updateWeaponPower,
  startSwing, endSwing, releaseOffHand,
} from './weapon';

// Swing motion
export {
  createTarget, createSwingMotion, updateSwingMotion, applyBodyMotion,
  getWeaponScaleFactors, getPreferredAttackTypes, pickWeightedAttackType,
} from './swing-motion';

// Combat AI
export {
  createCombatAI, createTargetMover, updateTargetMover, updateCombatAI,
  checkWeaponClash, updateClashReaction,
  createCombatAIvsCharacter, updateCombatAIvsCharacter,
} from './combat-ai';

// Bezier attack
export {
  evaluateBezier, computeAttackPath, createBezierSwingMotion,
} from './bezier-attack';
