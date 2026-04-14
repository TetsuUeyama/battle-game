/**
 * AI — 戦闘AIシステム。
 *
 * ■ 処理フロー (毎フレーム)
 *   1. evaluate() — 戦況を一括評価し Situation を生成
 *   2. decide()   — Situation を基に Decision (行動方針) を決定
 *   3. STATE_HANDLERS[state]() — Decision に従ってアクションを実行
 *
 * ■ ステート遷移
 *   target モード:    idle → pursue → attack → recover → pursue → ...
 *   character モード:  idle → pursue → circle → close_in → attack → retreat → recover → circle → ...
 *
 * ■ ファイル構成
 *   ai/
 *     index.ts       ディスパッチャ + ファクトリ (このファイル)
 *     evaluate.ts    戦況評価 (Situation)
 *     decide.ts      行動決定 (Decision)
 */
import { Vector3, TransformNode } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type {
  HavokCharacter, CombatAI, CombatAIState, WeaponPhysics,
  StateContext, StateHandler, StateResult,
} from '../types';
import { getCharacterDirections } from '../character/directions';
import { turnToward } from '../actions/turn-toward';
import { AI_PARAMS as P } from '../character/body';
import { evaluate } from './evaluate';
import { decide } from './decide';
import { buildCombatContext } from '../solver/combat-context';
import { getSolverCache } from '../solver/precompute';

// ─── ステートハンドラの登録 ──────────────────────────────

import { handleIdle } from '../states/idle';
import { handlePursue } from '../states/pursue';
import { handleCircle } from '../states/circle';
import { handleCloseIn } from '../states/close-in';
import { handleAttack } from '../states/attack';
import { handleRetreat } from '../states/retreat';
import { handleRecover } from '../states/recover';
import { handleGuard } from '../states/guard';
import { handleSwingDefence } from '../states/swing-defence';
import { handleAvoidance } from '../states/avoidance';

const STATE_HANDLERS: Record<CombatAIState, StateHandler> = {
  idle: handleIdle,
  pursue: handlePursue,
  circle: handleCircle,
  close_in: handleCloseIn,
  attack: handleAttack,
  retreat: handleRetreat,
  recover: handleRecover,
  guard: handleGuard,
  swing_defence: handleSwingDefence,
  avoidance: handleAvoidance,
};

// ─── ファクトリ ──────────────────────────────────────────

/** CombatAI を作成 (target モード: 静的標的追尾用) */
export function createCombatAI(targetNode: TransformNode, weapon: WeaponPhysics): CombatAI {
  return {
    state: 'idle',
    mode: 'target',
    targetNode,
    targetCharacter: null,
    attackRange: weapon.length * P.attackRangeMul_target,
    pursueRange: P.pursueRange_target,
    walkSpeed: P.walkSpeed,
    runSpeed: P.runSpeed,
    runThreshold: P.runThreshold_target,
    recoverTime: P.recoverTime_target,
    recoverTimer: 0,
    safeRange: weapon.length * P.attackRangeMul_target + P.safeRangeMargin,
    circleDir: 1,
    circleTimer: 0,
    retreatSpeed: P.retreatSpeed,
    currentMotion: null,
    attackIndex: 0,
    enabled: false,
    comboRemaining: 0,
    maxCombo: 3,
    defenseOnly: false,
  };
}

/** 対キャラクターAIを作成 (character モード) */
export function createCombatAIvsCharacter(
  targetCharacter: HavokCharacter,
  weapon: WeaponPhysics,
): CombatAI {
  const atkRange = weapon.length + P.armReach + P.lungeReach;
  const combo = Math.max(1, Math.round(P.comboBase - weapon.weight * P.comboWeightFactor));
  return {
    state: 'idle',
    mode: 'character',
    targetNode: targetCharacter.root,
    targetCharacter,
    attackRange: atkRange,
    pursueRange: P.pursueRange_character,
    walkSpeed: P.walkSpeed,
    runSpeed: P.runSpeed,
    runThreshold: P.runThreshold_character,
    recoverTime: P.recoverTime_character,
    recoverTimer: 0,
    safeRange: atkRange + P.safeRangeMargin,
    circleDir: Math.random() > 0.5 ? 1 : -1,
    circleTimer: 0,
    retreatSpeed: P.retreatSpeed,
    currentMotion: null,
    attackIndex: Math.floor(Math.random() * 3),
    enabled: false,
    comboRemaining: 0,
    maxCombo: combo,
    defenseOnly: false,
  };
}

// ─── ディスパッチ ────────────────────────────────────────

function dispatch(
  ai: CombatAI,
  character: HavokCharacter,
  opponent: HavokCharacter,
  scene: Scene | null,
  dt: number,
): StateResult {
  const targetPos = (ai.mode === 'target' ? ai.targetNode : opponent.root).position.clone();
  targetPos.y = 0;
  const charPos = character.root.position.clone();
  charPos.y = 0;

  const toTarget = targetPos.subtract(charPos);
  const dist = toTarget.length();
  const dir = dist > 0.01 ? toTarget.normalize() : Vector3.Forward();

  const dirs = getCharacterDirections(character);
  if (dirs) {
    turnToward(character, dir, dirs, dt);
  }

  const situation = evaluate(ai, character, opponent, dist);
  const decision = decide(situation, ai);

  // ソルバーキャッシュがあれば戦況コンテキストを構築・保存 (動的構え微調整用)
  if (getSolverCache(character)) {
    const combatCtx = buildCombatContext(
      situation, character, opponent,
      decision.stanceIntent, decision.attackIntent,
    );
    (character as any)._combatContext = combatCtx;
  }

  const handler = STATE_HANDLERS[ai.state];
  if (!handler) return { hit: false, damage: 0 };

  const ctx: StateContext = {
    ai, character, opponent, scene: scene as Scene,
    dt, dir, dist, dirs, situation, decision,
  };
  return handler(ctx);
}

/** 対キャラクターAI更新 (character モード)。毎フレーム呼び出し。 */
export function updateCombatAIvsCharacter(
  ai: CombatAI,
  character: HavokCharacter,
  scene: Scene,
  dt: number,
): { hit: boolean; damage: number } {
  if (!ai.enabled || !character.weapon || !ai.targetCharacter) return { hit: false, damage: 0 };
  return dispatch(ai, character, ai.targetCharacter, scene, dt);
}

/** 標的追尾AI更新 (target モード)。毎フレーム呼び出し。 */
export function updateCombatAI(
  ai: CombatAI,
  character: HavokCharacter,
  dt: number,
): void {
  if (!ai.enabled || !character.weapon) return;
  dispatch(ai, character, character, null, dt);
}
