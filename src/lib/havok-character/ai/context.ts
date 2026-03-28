/**
 * ステートハンドラに渡される共通コンテキスト。
 * 毎フレーム updateCombatAIvsCharacter 内で計算され、各ステートに渡される。
 */
import { Scene, Vector3 } from '@babylonjs/core';
import type { HavokCharacter, CombatAI } from '../types';

export interface StateContext {
  ai: CombatAI;
  character: HavokCharacter;
  opponent: HavokCharacter;
  scene: Scene;
  dt: number;
  /** 相手への水平方向 (Y=0) */
  dir: Vector3;
  /** 相手までの水平距離 */
  dist: number;
  /** キャラクター方向情報 (null の場合あり) */
  dirs: { forward: Vector3; charRight: Vector3; charLeft: Vector3 } | null;
}

/** ステートハンドラの戻り値 */
export interface StateResult {
  hit: boolean;
  damage: number;
}

/** 各ステートハンドラの関数シグネチャ */
export type StateHandler = (ctx: StateContext) => StateResult;
