/**
 * attack: SwingMotion を進行し、ヒット判定。
 * 振り完了後: decision.shouldContinueCombo で次の振り or retreat。
 */
import type { StateContext, StateResult } from '../types';
import { updateStance } from '../weapon/stance';
import { endSwing, startSwing } from '../weapon';
import { swingAttack, createSwingMotion } from '../actions/swing-attack';

export function handleAttack(ctx: StateContext): StateResult {
  const { ai, character, opponent, dir, dirs, dt, decision } = ctx;

  const result = swingAttack(ai, character, opponent, dirs, dt);

  if (result.finished) {
    endSwing(character);
    ai.comboRemaining--;

    if (decision.shouldContinueCombo) {
      updateStance(character, dt);
      ai.currentMotion = createSwingMotion(character, {
        type: decision.attackType,
        power: decision.attackPower,
        opponent, dir,
        targetBone: decision.targetBone,
        isComboFollow: true,
        useVsPreset: ai.mode === 'character',
      });
      startSwing(character);
    } else {
      ai.state = ai.mode === 'target' ? 'recover' : 'retreat';
      ai.recoverTimer = ai.recoverTime;
      ai.currentMotion = null;
      ai.comboRemaining = 0;
      // Spine/Hipsリセットは updateHavokCharacter の毎フレーム gradual reset が担当
    }
  }

  return { hit: result.hit, damage: result.damage };
}
