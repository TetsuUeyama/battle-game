/**
 * 回避アクション — 相手の攻撃から身をかわす。
 *
 * サイドステップ (左右への素早い移動) とバックステップ (後方への跳躍) の2種類。
 * 回避中は短い無敵時間 (iFrame) を持つ。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getCharacterDirections } from '../character/directions';

export type AvoidanceType = 'side_left' | 'side_right' | 'back';

export interface AvoidanceState {
  /** 回避中か */
  active: boolean;
  /** 回避タイプ */
  type: AvoidanceType;
  /** 経過時間 (秒) */
  timer: number;
  /** 回避の全体時間 (秒) */
  duration: number;
  /** 移動方向 (world) */
  direction: Vector3;
  /** 移動速度 (m/s) */
  speed: number;
  /** 無敵フレーム残り時間 (秒) */
  iFrameTimer: number;
}

export function createAvoidanceState(): AvoidanceState {
  return {
    active: false,
    type: 'back',
    timer: 0,
    duration: 0.3,
    direction: Vector3.Zero(),
    speed: 4.0,
    iFrameTimer: 0,
  };
}

/**
 * 回避開始。
 * @param avoidType 回避方向
 */
export function startAvoidance(
  character: HavokCharacter,
  avoidance: AvoidanceState,
  avoidType: AvoidanceType,
): void {
  if (avoidance.active) return;

  const dirs = getCharacterDirections(character);
  if (!dirs) return;

  avoidance.active = true;
  avoidance.type = avoidType;
  avoidance.timer = 0;
  avoidance.duration = avoidType === 'back' ? 0.35 : 0.25;
  avoidance.speed = avoidType === 'back' ? 3.5 : 4.5;
  avoidance.iFrameTimer = 0.15; // 150ms の無敵

  switch (avoidType) {
    case 'side_left':
      avoidance.direction = dirs.charLeft.clone();
      break;
    case 'side_right':
      avoidance.direction = dirs.charRight.clone();
      break;
    case 'back':
      avoidance.direction = dirs.forward.scale(-1);
      break;
  }
  avoidance.direction.y = 0;
  avoidance.direction.normalize();
}

/**
 * 回避更新。毎フレーム呼び出し。
 * @returns 回避継続中か
 */
export function updateAvoidance(
  character: HavokCharacter,
  avoidance: AvoidanceState,
  dt: number,
): boolean {
  if (!avoidance.active) return false;

  avoidance.timer += dt;
  avoidance.iFrameTimer = Math.max(0, avoidance.iFrameTimer - dt);

  if (avoidance.timer >= avoidance.duration) {
    avoidance.active = false;
    return false;
  }

  // 移動 (ease-out: 最初速く → 減速)
  const t = avoidance.timer / avoidance.duration;
  const speedMul = 1.0 - t * t; // ease-out
  const moveVec = avoidance.direction.scale(avoidance.speed * speedMul * dt);
  moveVec.y = 0;
  character.root.position.addInPlace(moveVec);

  return true;
}

/**
 * 回避中にヒットを受けた場合の判定。
 * @returns true = 無敵中 (ダメージ無効)
 */
export function isInIFrame(avoidance: AvoidanceState): boolean {
  return avoidance.active && avoidance.iFrameTimer > 0;
}

/**
 * 相手の攻撃方向に応じて最適な回避方向を決定。
 */
export function pickAvoidanceType(
  character: HavokCharacter,
  opponentDir: Vector3,
): AvoidanceType {
  const dirs = getCharacterDirections(character);
  if (!dirs) return 'back';

  // 相手の攻撃方向と自分の右方向の内積で左右を判定
  const rightDot = Vector3.Dot(opponentDir, dirs.charRight);

  // 相手が右から来ている → 左に避ける、左から来ている → 右に避ける
  if (Math.abs(rightDot) > 0.3) {
    return rightDot > 0 ? 'side_left' : 'side_right';
  }

  // 正面からの攻撃 → バックステップ
  return 'back';
}
