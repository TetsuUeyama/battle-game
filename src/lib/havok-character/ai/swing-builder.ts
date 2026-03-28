/**
 * Combat AI — SwingMotion 構築 (アクション層)。
 *
 * 攻撃タイプ・ターゲット選択などの判断は ai/ 層が担当し、
 * このファイルは決定済みのパラメータから SwingMotion を組み立てる。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, SwingMotion, SwingType, BodyMotion } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import { startSwing } from '../weapon';
import { getWeaponScaleFactors } from '../weapon/attack-swing';
import { SWING_PRESETS, WEAPON_SCALE_CONFIG as WSC, scalePreset } from '../character/body';
import { selectTargetPosition } from './target-select';

export interface BuildSwingOptions {
  character: HavokCharacter;
  opponent: HavokCharacter;
  dir: Vector3;
  dirs: { forward: Vector3; charRight: Vector3; charLeft: Vector3 } | null;
  power: number;          // 0-100
  /** true: コンボ後続 (振りかぶり短縮・速度アップ) */
  isComboFollow?: boolean;
}

/**
 * SwingMotion を構築し、startSwing() を呼び出す。
 */
export function buildSwingMotion(
  swingType: SwingType,
  opts: BuildSwingOptions,
): SwingMotion {
  const { character, opponent, dir, dirs, power, isComboFollow } = opts;
  const weapon = character.weapon!;
  const sf = getWeaponScaleFactors(weapon);
  const bc = sf.bodyCommitment;
  const gc = sf.gripCommitment;
  const rs = sf.reachScale;
  const p = power / 100;

  // ─── ターゲット位置 (ai/target-select が選択) ───
  const hitPos = selectTargetPosition(opponent);
  const handStrikePos = hitPos.subtract(dir.scale(weapon.length * 0.6));

  // ─── 振りかぶり位置 ───
  const headBone = character.combatBones.get('head');
  const headPos = headBone ? getWorldPos(headBone) : character.root.position.add(new Vector3(0, 1.5, 0));
  const handPos = character.weaponSwing.baseHandPos.clone();
  const fwd = dirs?.forward ?? dir;
  const right = dirs?.charRight ?? Vector3.Right();

  let windupPos: Vector3;
  switch (swingType) {
    case 'vertical':
      windupPos = headPos.add(new Vector3(0, 0.15 * p * rs, 0)).add(fwd.scale(-0.1 * p * rs)).add(right.scale(0.05));
      break;
    case 'horizontal':
      windupPos = handPos.add(right.scale(0.4 * p * rs)).add(new Vector3(0, 0.1 * p * rs, 0));
      break;
    default:
      windupPos = handPos.add(fwd.scale(-0.2 * p * rs));
      break;
  }

  // ─── ボディモーション (body-config.ts の SWING_PRESETS から生成) ───
  const presetKey = `${swingType}_vs`;
  const preset = SWING_PRESETS[presetKey] ?? SWING_PRESETS[swingType];
  const windupBody = scalePreset(preset.windup, p, bc, gc);
  const strikeBody = scalePreset(preset.strike, p, bc, gc);

  // ─── SwingMotion 構築 ───
  const rootPos = character.root.position.clone();
  const baseDuration = isComboFollow
    ? (0.35 + (1.0 - p) * 0.08) * sf.durationScale
    : (0.4 + (1.0 - p) * 0.1) * sf.durationScale;

  const motion: SwingMotion = {
    type: swingType,
    progress: 0,
    duration: baseDuration,
    windupRatio: isComboFollow ? 0.3 + p * 0.1 : 0.35 + p * 0.1,
    startPos: handPos,
    windupPos,
    strikePos: handStrikePos,
    active: true,
    power: p,
    windupBody, strikeBody,
    startOffset: handPos.subtract(rootPos),
    windupOffset: windupPos.subtract(rootPos),
    strikeOffset: handStrikePos.subtract(rootPos),
    rootPosAtStart: rootPos,
  };

  if (swingType === 'horizontal') {
    const spineBone = character.combatBones.get('torso');
    const spinePos = spineBone ? getWorldPos(spineBone) : rootPos.add(new Vector3(0, 1.2, 0));
    const spineOffset = spinePos.subtract(rootPos);
    const armLen = character.ikChains.leftArm.lengthA + character.ikChains.leftArm.lengthB;
    const maxAngle = Math.min(Math.PI * 0.6, (Math.PI * 0.39) * p * sf.arcScale);
    motion.arcSwing = {
      centerOffset: spineOffset,
      radius: armLen,
      windupAngle: maxAngle,
      strikeAngle: -maxAngle,
      height: spineOffset.y,
    };
  }

  startSwing(character);
  return motion;
}
