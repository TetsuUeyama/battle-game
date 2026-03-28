/**
 * モーションテスト再生。指定タイプ/パワーのスイングモーションを再生する。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingType } from '@/lib/havok-character/types';
import { getCharacterDirections } from '@/lib/havok-character/character';
import { createSwingMotion, updateSwingMotion, applyBodyMotion } from '@/lib/havok-character/weapon';
import { startSwing, endSwing } from '@/lib/havok-character/weapon';

let _activeMotion: SwingMotion | null = null;

/**
 * モーションテストを開始する。
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
 * モーションテストの毎フレーム更新。
 * @returns true: 再生中, false: 完了
 */
export function updateMotionTest(character: HavokCharacter, dt: number): boolean {
  if (!_activeMotion || !_activeMotion.active) return false;

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
    return false;
  }

  return true;
}

/** モーションテストが再生中か */
export function isMotionTestPlaying(): boolean {
  return _activeMotion !== null && _activeMotion.active;
}
