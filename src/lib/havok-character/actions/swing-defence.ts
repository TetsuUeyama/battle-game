/**
 * 防御スイングアクション — 相手の攻撃を武器で弾く/受け流す。
 *
 * ガードが「受け止める」のに対し、防御スイングは「弾き返す」アクション。
 * 相手の武器先端に向かって短い振りを行い、
 * 相手の攻撃を弾いてよろめきを誘発する (武器クラッシュと連動)。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { getCharacterDirections } from '../character/directions';
import { getWeaponTipWorld } from '../weapon';
import { createSwingMotion } from '../weapon/attack-swing';
import { startSwing } from '../weapon/physics';

export interface SwingDefenceResult {
  /** 防御スイングが完了したか */
  finished: boolean;
  /** SwingMotion */
  motion: SwingMotion | null;
}

/**
 * 防御スイングを開始。相手の武器先端に向かって短い振りを生成。
 */
export function startSwingDefence(
  character: HavokCharacter,
  opponent: HavokCharacter,
): SwingMotion | null {
  if (!character.weapon || !opponent.weapon) return null;

  const dirs = getCharacterDirections(character);
  if (!dirs) return null;

  // 相手の武器先端位置をターゲットにする
  const opTip = getWeaponTipWorld(opponent);

  // 短い・速い防御スイング (パワー低め、振りかぶり小さい)
  const motion = createSwingMotion(character, {
    targetPos: opTip,
    type: 'horizontal',  // 横振りで弾く
    power: 30,            // 軽い振り
    isComboFollow: true,  // 振りかぶり短縮
  });

  startSwing(character);
  return motion;
}
