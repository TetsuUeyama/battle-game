/**
 * Combat AI — ステートマシン・ディスパッチャ。
 *
 * states/  各ステートの遷移条件を定義 (いつ何に切り替えるか)
 * actions/ 再利用可能なアクション (何をするか)
 *
 * 新しいステート追加: states/ にファイルを作成し、STATE_HANDLERS に登録するだけ。
 * 新しいアクション追加: actions/ にファイルを作成し、任意のステートから呼び出す。
 *
 * ■ ステート遷移 (character モード)
 *   idle → pursue → circle → close_in → attack → retreat → recover → circle → ...
 */
import { Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { HavokCharacter, CombatAI, CombatAIState } from '../types';
import { getCharacterDirections } from '../character/directions';
import { turnToward } from './shared';
import type { StateContext, StateHandler } from './context';

// ─── ステートハンドラの登録 ──────────────────────────────
import { handleIdle } from '../states/idle';
import { handlePursue } from '../states/pursue';
import { handleCircle } from '../states/circle';
import { handleCloseIn } from '../states/close-in';
import { handleAttack } from '../states/attack';
import { handleRetreat } from '../states/retreat';
import { handleRecover } from '../states/recover';

const STATE_HANDLERS: Record<CombatAIState, StateHandler> = {
  idle: handleIdle,
  pursue: handlePursue,
  circle: handleCircle,
  close_in: handleCloseIn,
  attack: handleAttack,
  retreat: handleRetreat,
  recover: handleRecover,
};

// ─── 再エクスポート ──────────────────────────────────────

export { createCombatAI, createCombatAIvsCharacter } from './create';
export { createTargetMover, updateTargetMover } from './target-mover';
export { checkWeaponClash, updateClashReaction } from '../effects/clash';
export { updateCombatAI } from './update-target-ai';

// ─── 対キャラ AI (character モード) ──────────────────────

/**
 * 対キャラクターAI更新。毎フレーム呼び出し。
 *
 * 1. 相手方向への自動回転
 * 2. STATE_HANDLERS[ai.state] を呼び出し
 * 3. ヒット結果を返す
 */
export function updateCombatAIvsCharacter(
  ai: CombatAI,
  character: HavokCharacter,
  scene: Scene,
  dt: number,
): { hit: boolean; damage: number } {
  if (!ai.enabled || !character.weapon || !ai.targetCharacter) return { hit: false, damage: 0 };

  const opponent = ai.targetCharacter;
  const targetPos = opponent.root.position.clone();
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

  const ctx: StateContext = { ai, character, opponent, scene, dt, dir, dist, dirs };
  return STATE_HANDLERS[ai.state](ctx);
}
