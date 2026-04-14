/**
 * 構えの最適化ソルバー。
 *
 * 事前計算 (武器装備時):
 *   球面探索で制約を満たす候補を「有効構えプール」としてキャッシュ。
 *   上段/中段/下段の3基本構えを各目的関数重みで最適点として選択。
 *
 * 動的選択 (構え更新時):
 *   戦況コンテキストに応じて目的関数の重みを微調整し、
 *   有効構えプール内で再スコアリングして最適構えを選択。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, WeaponPhysics } from '../types';
import { PALM_OFFSET } from '../types';
import type {
  StanceLevel, StanceCandidate, StanceResult,
  StanceObjectiveWeights, CombatContext, SolverCache,
} from './types';
import { checkStanceConstraints, calcMaxWristTorque, resetConstraintStats, logConstraintStats } from './constraints';
import type { ConstraintParams } from './constraints';
import { evaluateStanceCandidate } from './objectives';
import type { StanceObjectiveParams } from './objectives';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { solveIK2Bone, clampJointAngles, clampArmRotation } from '../character/ik-solver';

// ─── 3基本構えの目的関数重み ─────────────────────────────

const BASE_STANCE_WEIGHTS: Record<StanceLevel, {
  weights: StanceObjectiveWeights;
  swingTypeBias: number;  // +1=vertical寄り, -1=horizontal/thrust寄り
  guardBias: number;      // +1=頭部, -1=下半身
}> = {
  upper: {
    weights: {
      attackReadiness: 0.30,
      defenceCoverage: 0.15,
      threatProjection: 0.20,
      balanceStability: 0.15,
      forceReadiness: 0.10,
      opponentAttackResponse: 0.10,
      nextActionTransition: 0.00,
    },
    swingTypeBias: 0.8,  // vertical優先
    guardBias: 0.8,      // 頭部ガード
  },
  middle: {
    weights: {
      attackReadiness: 0.20,
      defenceCoverage: 0.20,
      threatProjection: 0.10,
      balanceStability: 0.20,
      forceReadiness: 0.15,
      opponentAttackResponse: 0.15,
      nextActionTransition: 0.00,
    },
    swingTypeBias: 0.0,  // 均等
    guardBias: 0.0,      // 胴体ガード
  },
  lower: {
    weights: {
      attackReadiness: 0.30,
      defenceCoverage: 0.10,
      threatProjection: 0.10,
      balanceStability: 0.20,
      forceReadiness: 0.15,
      opponentAttackResponse: 0.15,
      nextActionTransition: 0.00,
    },
    swingTypeBias: -0.8, // horizontal/thrust優先
    guardBias: -0.8,     // 下半身ガード
  },
};

// ─── 球面探索パラメータ ──────────────────────────────────

const THETA_STEPS = 12;  // 水平角の分割数
const PHI_STEPS = 12;    // 仰角の分割数
const THETA_MIN = -Math.PI * 0.5;  // -90° (右側)
const THETA_MAX = Math.PI * 0.5;   // +90° (左側)
const PHI_MIN = -Math.PI * 0.35;   // -63° (下方)
const PHI_MAX = Math.PI * 0.5;     // +90° (頭上)
const REACH_RATIOS = [0.55, 0.7, 0.85]; // 3段階のリーチ

// ─── 事前計算 ────────────────────────────────────────────

/**
 * 武器装備時に有効構えプールと3基本構えを計算してキャッシュする。
 */
export function precomputeStances(
  character: HavokCharacter,
  weapon: WeaponPhysics,
): SolverCache {
  const dirs = getCharacterDirections(character);
  if (!dirs) {
    throw new Error('Cannot precompute stances: character directions unavailable');
  }

  const facing = dirs.forward;
  const armReach = character.ikChains.rightArm.lengthA + character.ikChains.rightArm.lengthB;
  const maxWristTorque = calcMaxWristTorque(weapon);

  const shoulderBone = character.ikChains.rightArm.root;
  shoulderBone.computeWorldMatrix(true);
  const shoulderPos = shoulderBone.getAbsolutePosition().clone();

  const torsoPos = getWorldPos(character.combatBones.get('torso')!);

  // 制約パラメータ
  const constraintParams: ConstraintParams = {
    armReach,
    shoulderPos,
    weapon,
    maxWristTorque,
    facing,
    bodyCenter: torsoPos,
    bodyRadius: 0.18,
  };

  // ─── 球面探索: 全候補を生成 ───
  const allCandidates: StanceCandidate[] = [];

  for (let ti = 0; ti < THETA_STEPS; ti++) {
    const theta = THETA_MIN + (THETA_MAX - THETA_MIN) * (ti / (THETA_STEPS - 1));
    for (let pi = 0; pi < PHI_STEPS; pi++) {
      const phi = PHI_MIN + (PHI_MAX - PHI_MIN) * (pi / (PHI_STEPS - 1));

      for (const reachRatio of REACH_RATIOS) {
        const candidate = createCandidate(
          theta, phi, reachRatio, shoulderPos, armReach, facing, weapon,
        );
        allCandidates.push(candidate);
      }
    }
  }

  // ─── 制約チェック: 有効候補のみ残す ───
  resetConstraintStats();
  const validCandidates = allCandidates.filter(c =>
    checkStanceConstraints(c, constraintParams),
  );
  logConstraintStats();

  // ─── 3基本構えの選択 ───
  const headPos = getWorldPos(character.combatBones.get('head')!);
  const hipsPos = getWorldPos(character.combatBones.get('hips')!);

  const objectiveParams: StanceObjectiveParams = {
    shoulderPos,
    armReach,
    weapon,
    facing,
    headPos,
    torsoPos,
    hipsPos,
    context: null,
  };

  const baseStances: Record<StanceLevel, StanceResult> = {
    upper: findBestStance(validCandidates, objectiveParams, 'upper', character),
    middle: findBestStance(validCandidates, objectiveParams, 'middle', character),
    lower: findBestStance(validCandidates, objectiveParams, 'lower', character),
  };

  // デバッグ: ソルバーの計算結果をログ出力
  console.log('[StanceSolver] precompute results:', {
    totalCandidates: allCandidates.length,
    validCandidates: validCandidates.length,
    armReach,
    maxWristTorque,
    weaponWeight: weapon.weight,
    weaponLength: weapon.length,
    weaponGrip: weapon.gripType,
    upper: {
      score: baseStances.upper.score,
      gripPos: `(${baseStances.upper.candidate.gripPos.x.toFixed(3)}, ${baseStances.upper.candidate.gripPos.y.toFixed(3)}, ${baseStances.upper.candidate.gripPos.z.toFixed(3)})`,
      theta: (baseStances.upper.candidate.theta * 180 / Math.PI).toFixed(1) + '°',
      phi: (baseStances.upper.candidate.phi * 180 / Math.PI).toFixed(1) + '°',
      reachRatio: baseStances.upper.candidate.reachRatio,
    },
    middle: {
      score: baseStances.middle.score,
      gripPos: `(${baseStances.middle.candidate.gripPos.x.toFixed(3)}, ${baseStances.middle.candidate.gripPos.y.toFixed(3)}, ${baseStances.middle.candidate.gripPos.z.toFixed(3)})`,
      theta: (baseStances.middle.candidate.theta * 180 / Math.PI).toFixed(1) + '°',
      phi: (baseStances.middle.candidate.phi * 180 / Math.PI).toFixed(1) + '°',
      reachRatio: baseStances.middle.candidate.reachRatio,
    },
    lower: {
      score: baseStances.lower.score,
      gripPos: `(${baseStances.lower.candidate.gripPos.x.toFixed(3)}, ${baseStances.lower.candidate.gripPos.y.toFixed(3)}, ${baseStances.lower.candidate.gripPos.z.toFixed(3)})`,
      theta: (baseStances.lower.candidate.theta * 180 / Math.PI).toFixed(1) + '°',
      phi: (baseStances.lower.candidate.phi * 180 / Math.PI).toFixed(1) + '°',
      reachRatio: baseStances.lower.candidate.reachRatio,
    },
    shoulderPos: `(${shoulderPos.x.toFixed(3)}, ${shoulderPos.y.toFixed(3)}, ${shoulderPos.z.toFixed(3)})`,
    facing: `(${facing.x.toFixed(3)}, ${facing.y.toFixed(3)}, ${facing.z.toFixed(3)})`,
  });

  return {
    weapon,
    validCandidates,
    baseStances,
    maxWristTorque,
    armReach,
  };
}

/**
 * 球面上の候補点を生成する。
 */
function createCandidate(
  theta: number,
  phi: number,
  reachRatio: number,
  shoulderPos: Vector3,
  armReach: number,
  facing: Vector3,
  weapon: WeaponPhysics,
): StanceCandidate {
  // 球面座標 → 肩からの方向ベクトル
  // theta: facingを中心とした水平角 (正=右, 負=左)
  // phi: 仰角 (正=上, 負=下)
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  // facingに対して右方向ベクトルを計算
  const right = Vector3.Cross(facing, Vector3.Up()).normalize();
  const up = Vector3.Up();

  // 方向 = facing * cos(theta)*cos(phi) + right * sin(theta)*cos(phi) + up * sin(phi)
  const dir = facing.scale(cosTheta * cosPhi)
    .add(right.scale(sinTheta * cosPhi))
    .add(up.scale(sinPhi));
  dir.normalize();

  const reach = armReach * reachRatio;
  const gripPos = shoulderPos.add(dir.scale(reach));

  // 武器の向き: 腕方向 + 前方バイアス (Down 成分なし)
  // 高い位置 → 前方+上方、中間 → 前方、低い位置 → 前方+下方 (腕方向に従う)
  const weaponDir = dir.scale(0.4)
    .add(facing.scale(0.6))
    .normalize();

  return { theta, phi, gripPos, weaponDir, reachRatio };
}

/**
 * 有効候補の中から指定のStanceLevelで最高スコアの構えを選ぶ。
 * IK + 関節クランプで到達可能性を検証し、到達不可能な候補はスキップする。
 */
function findBestStance(
  candidates: StanceCandidate[],
  params: StanceObjectiveParams,
  level: StanceLevel,
  character: HavokCharacter,
): StanceResult {
  const config = BASE_STANCE_WEIGHTS[level];

  // スコア順にソート (降順)
  const scored = candidates.map(candidate => ({
    candidate,
    score: evaluateStanceCandidate(
      candidate, params, config.weights, config.swingTypeBias, config.guardBias,
    ),
  })).sort((a, b) => b.score - a.score);

  // スコア上位から順に IK 検証、最初に通った候補を採用
  for (const { candidate, score } of scored) {
    const result = candidateToResult(candidate, score, params);
    if (validateWithIK(result, character)) {
      return result;
    }
  }

  // 全候補が IK 検証を通らない場合はスコア最高を返す (フォールバック)
  console.warn(`[StanceSolver] No IK-valid candidate for ${level}, using best score`);
  return candidateToResult(scored[0].candidate, scored[0].score, params);
}

// ─── IK 到達性検証 ──────────────────────────────────────

/** IK 到達性の許容誤差 (m) */
const IK_VALIDATION_TOLERANCE = 0.05;

/**
 * 構え候補に対して IK + 関節クランプを実行し、
 * 手が意図した位置に実際に届くかを検証する。
 * ボーンの状態は検証前に保存・検証後に復元する。
 */
function validateWithIK(
  result: StanceResult,
  character: HavokCharacter,
): boolean {
  const chain = character.ikChains.rightArm;

  // 現在の状態を保存
  const savedTarget = chain.target.clone();
  const savedRootRot = chain.root.rotationQuaternion?.clone() ?? null;
  const savedMidRot = chain.mid.rotationQuaternion?.clone() ?? null;

  // IK ターゲットを設定して解決
  chain.target.copyFrom(result.rightTarget);
  solveIK2Bone(chain, character);
  clampJointAngles(chain, character, 'arm');
  clampArmRotation(character);

  // クランプ後の手の位置を確認
  chain.end.computeWorldMatrix(true);
  const actualPos = chain.end.getAbsolutePosition();
  const error = Vector3.Distance(actualPos, result.rightTarget);

  // 状態を復元
  chain.target.copyFrom(savedTarget);
  if (savedRootRot) chain.root.rotationQuaternion = savedRootRot;
  if (savedMidRot) chain.mid.rotationQuaternion = savedMidRot;
  chain.root.computeWorldMatrix(true);
  chain.mid.computeWorldMatrix(true);

  return error < IK_VALIDATION_TOLERANCE;
}

/**
 * StanceCandidate → StanceResult に変換。IKターゲット位置を計算する。
 */
function candidateToResult(
  candidate: StanceCandidate,
  score: number,
  params: StanceObjectiveParams,
): StanceResult {
  // gripPos → IKターゲット: PALM_OFFSET分だけ肩方向にオフセット
  const shoulderToGrip = candidate.gripPos.subtract(params.shoulderPos).normalize();
  const rightTarget = candidate.gripPos.subtract(shoulderToGrip.scale(PALM_OFFSET));

  // 両手持ちの左手位置
  let leftTarget: Vector3 | null = null;
  if (params.weapon.gripType === 'two-handed') {
    const pommelDir = candidate.weaponDir.scale(-1);
    const offHandWorld = candidate.gripPos.add(pommelDir.scale(params.weapon.offHandOffset.y));
    leftTarget = offHandWorld;
  }

  return {
    rightTarget,
    leftTarget,
    weaponDir: candidate.weaponDir.clone(),
    score,
    candidate,
  };
}

// ─── 現在のキャラクター状態から構えを再計算 ────────────────

/**
 * キャッシュ済み候補の角度パラメータ (theta/phi/reachRatio) と
 * 現在のキャラクター状態から、ワールド座標の構え位置を再計算する。
 * ソルバーの事前計算結果は装備時のワールド座標だが、
 * キャラクターが移動/回転するとズレるため毎フレーム再計算が必要。
 */
export function reconstructStance(
  stanceResult: StanceResult,
  character: HavokCharacter,
  weapon: WeaponPhysics,
): { rightTarget: Vector3; leftTarget: Vector3 | null; weaponDir: Vector3 } {
  const dirs = getCharacterDirections(character);
  if (!dirs) {
    return {
      rightTarget: stanceResult.rightTarget.clone(),
      leftTarget: stanceResult.leftTarget?.clone() ?? null,
      weaponDir: stanceResult.weaponDir.clone(),
    };
  }

  const facing = dirs.forward;
  const shoulderBone = character.ikChains.rightArm.root;
  shoulderBone.computeWorldMatrix(true);
  const shoulderPos = shoulderBone.getAbsolutePosition();
  const armReach = character.ikChains.rightArm.lengthA + character.ikChains.rightArm.lengthB;

  const c = stanceResult.candidate;
  const fresh = createCandidate(c.theta, c.phi, c.reachRatio, shoulderPos, armReach, facing, weapon);
  const freshResult = candidateToResult(fresh, stanceResult.score, {
    shoulderPos,
    armReach,
    weapon,
    facing,
    headPos: Vector3.Zero(), // candidateToResult では使わない
    torsoPos: Vector3.Zero(),
    hipsPos: Vector3.Zero(),
    context: null,
  });

  return {
    rightTarget: freshResult.rightTarget,
    leftTarget: freshResult.leftTarget,
    weaponDir: freshResult.weaponDir,
  };
}

// ─── 動的選択 (構え更新時) ───────────────────────────────

/**
 * 戦況コンテキストに応じて構えを微調整する。
 * 事前計算済みの有効プールから再スコアリングして最適構えを選択。
 */
export function selectDynamicStance(
  cache: SolverCache,
  character: HavokCharacter,
  stanceLevel: StanceLevel,
  context: CombatContext,
): StanceResult {
  const dirs = getCharacterDirections(character);
  if (!dirs || cache.validCandidates.length === 0) {
    return cache.baseStances[stanceLevel];
  }

  const facing = dirs.forward;
  const shoulderBone = character.ikChains.rightArm.root;
  shoulderBone.computeWorldMatrix(true);
  const shoulderPos = shoulderBone.getAbsolutePosition();

  const headPos = getWorldPos(character.combatBones.get('head')!);
  const torsoPos = getWorldPos(character.combatBones.get('torso')!);
  const hipsPos = getWorldPos(character.combatBones.get('hips')!);

  const params: StanceObjectiveParams = {
    shoulderPos,
    armReach: cache.armReach,
    weapon: cache.weapon,
    facing,
    headPos,
    torsoPos,
    hipsPos,
    context,
  };

  // StanceIntentに応じて重みを調整
  const baseConfig = BASE_STANCE_WEIGHTS[stanceLevel];
  const adjustedWeights = adjustWeightsForIntent(baseConfig.weights, context);

  // 基本構えからの偏差ペナルティ
  const baseStance = cache.baseStances[stanceLevel];
  const baseGripPos = baseStance.candidate.gripPos;

  let bestScore = -Infinity;
  let bestCandidate = cache.validCandidates[0];

  for (const candidate of cache.validCandidates) {
    let score = evaluateStanceCandidate(
      candidate, params, adjustedWeights, baseConfig.swingTypeBias, baseConfig.guardBias,
    );

    // 基本構えからの偏差ペナルティ (大きく逸脱しない)
    const deviation = Vector3.Distance(candidate.gripPos, baseGripPos);
    const deviationPenalty = Math.min(0.3, deviation * 0.5);
    score -= deviationPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return candidateToResult(bestCandidate, bestScore, params);
}

/**
 * StanceIntent に応じて目的関数の重みを調整する。
 */
function adjustWeightsForIntent(
  base: StanceObjectiveWeights,
  context: CombatContext,
): StanceObjectiveWeights {
  const w = { ...base };

  switch (context.stanceIntent) {
    case 'aggressive':
      w.attackReadiness *= 1.5;
      w.threatProjection *= 1.3;
      w.defenceCoverage *= 0.7;
      break;
    case 'defensive':
      w.defenceCoverage *= 1.5;
      w.opponentAttackResponse *= 1.5;
      w.attackReadiness *= 0.7;
      w.threatProjection *= 0.5;
      break;
    case 'recovery':
      w.balanceStability *= 2.0;
      w.nextActionTransition *= 1.5;
      w.attackReadiness *= 0.5;
      w.threatProjection *= 0.3;
      break;
    case 'neutral':
    default:
      break;
  }

  // 相手が攻撃圏内にいる場合、防御の重みを上げる
  if (context.opponent.inTheirAttackRange) {
    w.defenceCoverage *= 1.3;
    w.opponentAttackResponse *= 1.3;
  }

  // 前の攻撃の終了位置がある場合 (コンボ後)、遷移コストを重視
  if (context.self.lastStrikeEndPos) {
    w.nextActionTransition *= 1.5;
  }

  return w;
}
