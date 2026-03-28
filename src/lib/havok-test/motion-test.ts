/**
 * モーションテスト再生。スイングモーション + バク転等の特殊モーション。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingType } from '@/lib/havok-character/types';
import { getCharacterDirections } from '@/lib/havok-character/character';
import { createSwingMotion, updateSwingMotion, applyBodyMotion } from '@/lib/havok-character/weapon';
import { startSwing, endSwing } from '@/lib/havok-character/weapon';
import {
  createBackflipState, updateBackflip, isBackflipActive,
  type BackflipState,
} from '@/lib/havok-character/actions/backflip';

let _activeMotion: SwingMotion | null = null;
let _backflipState: BackflipState = createBackflipState();

/** バク転状態を取得 (DebugPanel から参照用) */
export function getBackflipStateRef(): BackflipState {
  return _backflipState;
}

/** バク転状態をリセット */
export function resetBackflipState(): void {
  _backflipState = createBackflipState();
}

/**
 * スイングモーションテストを開始する。
 */
export function playMotionTest(
  character: HavokCharacter,
  type: SwingType,
  power: number,
): boolean {
  if (!character.weapon) return false;

  const dirs = getCharacterDirections(character);
  if (!dirs) return false;

  const hitPos = character.root.position
    .add(dirs.forward.scale(1.5))
    .add(new Vector3(0, 1.1, 0));

  _activeMotion = createSwingMotion(character, { targetPos: hitPos, type, power });
  startSwing(character);
  return true;
}

/**
 * モーションテストの毎フレーム更新 (スイング + バク転)。
 * @returns true: 何か再生中, false: 全て完了
 */
export function updateMotionTest(character: HavokCharacter, dt: number): boolean {
  let playing = false;

  // スイングモーション
  if (_activeMotion && _activeMotion.active) {
    const frame = updateSwingMotion(_activeMotion, dt, character.root.position);
    if (frame) {
      character.ikChains.leftArm.target.copyFrom(frame.handTarget);
      character.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
      const dirs = getCharacterDirections(character);
      if (dirs) {
        applyBodyMotion(character, frame.body, dirs.forward, dirs.charRight);
      }
    }

    if (!_activeMotion.active) {
      endSwing(character);
      _activeMotion = null;
    } else {
      playing = true;
    }
  }

  // バク転
  if (isBackflipActive(_backflipState)) {
    updateBackflip(character, _backflipState, dt);
    playing = true;
  }

  return playing;
}

/** モーションテストが再生中か */
export function isMotionTestPlaying(): boolean {
  return (_activeMotion !== null && _activeMotion.active) || isBackflipActive(_backflipState);
}

/** バク転が再生中か (scene-loop から参照) */
export function isBackflipPlaying(): boolean {
  return isBackflipActive(_backflipState);
}

// re-export
export { isBackflipActive } from '@/lib/havok-character/actions/backflip';
