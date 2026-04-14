export type {
  AttackIntent, StanceIntent, StanceLevel,
  StanceCandidate, StanceResult, SolverCache,
  StanceObjectiveWeights, SwingObjectiveWeights,
  CombatContext, OpponentPrediction, SelfPosture,
  KineticChainProfile, KineticJointEntry,
} from './types';

export { precomputeStances, selectDynamicStance, reconstructStance } from './stance-solver';
export { initSolverCache, getSolverCache, clearSolverCache } from './precompute';
export { buildCombatContext, decideStanceIntent, decideAttackIntent } from './combat-context';
export { checkStanceConstraints, calcWristTorque, calcMaxWristTorque } from './constraints';
export { evaluateStanceCandidate } from './objectives';
