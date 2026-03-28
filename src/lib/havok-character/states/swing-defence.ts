/**
 * swing_defence: 相手の攻撃を武器で弾く防御スイング。
 * 完了後は circle に戻る。
 */
import type { StateContext, StateResult } from '../types';
import { startSwingDefence } from '../actions/swing-defence';
import { endSwing } from '../weapon';
import { updateSwingMotion, applyBodyMotion } from '../weapon/attack-swing';

export function handleSwingDefence(ctx: StateContext): StateResult {
  const { ai, character, opponent, dirs, dt, decision } = ctx;

  // 初回: 防御スイング生成
  if (!ai.currentMotion || !ai.currentMotion.active) {
    const motion = startSwingDefence(character, opponent);
    if (motion) {
      ai.currentMotion = motion;
    } else {
      // 生成失敗 → circle に戻る
      ai.state = 'circle';
      ai.circleTimer = decision.circleDuration;
      return { hit: false, damage: 0 };
    }
  }

  // SwingMotion 進行
  if (ai.currentMotion && ai.currentMotion.active) {
    const frame = updateSwingMotion(ai.currentMotion, dt, character.root.position);
    if (frame) {
      character.ikChains.leftArm.target.copyFrom(frame.handTarget);
      character.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
      if (dirs) {
        applyBodyMotion(character, frame.body, dirs.forward, dirs.charRight);
      }
    }
  }

  // 完了
  if (!ai.currentMotion || !ai.currentMotion.active) {
    endSwing(character);
    ai.currentMotion = null;
    ai.state = 'circle';
    ai.circleTimer = decision.circleDuration;
    ai.circleDir = decision.circleDir;
  }

  return { hit: false, damage: 0 };
}
