/**
 * 力の伝達計算。地面(反力)から末端(武器先端)に向かってボーンチェーンを伝播。
 *
 * ■ フロー
 *   地面反力 → 足首 → 膝 → 腰 → 胴体 → 肩 → 肘 → 手首 → 武器先端
 *
 * ■ 各関節のルール
 *   曲がっている (minBendForForce° 以上):
 *     「伸ばす力」を生成し、上流から伝わった力に加算
 *     force = upstreamForce × passthrough + bendRatio × maxForceGain
 *
 *   まっすぐ (minBendForForce° 未満):
 *     自身で力を加えられず、上流の力を通過させるのみ (減衰)
 *     force = upstreamForce × passthrough
 *
 * ■ 結果
 *   terminalForce: 武器先端に到達する力
 *   → BodyMotion のスケール係数として使用
 *     全関節が曲がっている (踏み込み攻撃) → 大きい → 全身で振る
 *     下半身がまっすぐ (手打ち)           → 小さい → 体が動かない
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';
import type { ForceChain, ForceOutput } from './body/force-chain';
import { FORCE_CHAIN_PARAMS, FORCE_CHAINS } from './body/force-chain';

/**
 * 関節の曲げ角度を計算 (degrees)。
 * parent→bone→child の角度。
 */
function getJointBendAngle(character: HavokCharacter, boneName: string): number {
  const bone = character.allBones.get(boneName);
  if (!bone) return 0;

  const parentNode = bone.parent;
  if (!parentNode || !('getAbsolutePosition' in parentNode)) return 0;

  let childBone: import('@babylonjs/core').TransformNode | null = null;
  for (const child of bone.getChildren()) {
    if ('getAbsolutePosition' in child) {
      childBone = child as import('@babylonjs/core').TransformNode;
      break;
    }
  }
  if (!childBone) return 0;

  bone.computeWorldMatrix(true);
  (parentNode as import('@babylonjs/core').TransformNode).computeWorldMatrix(true);
  childBone.computeWorldMatrix(true);

  const parentPos = (parentNode as import('@babylonjs/core').TransformNode).getAbsolutePosition();
  const bonePos = bone.getAbsolutePosition();
  const childPos = childBone.getAbsolutePosition();

  const v1 = parentPos.subtract(bonePos).normalize();
  const v2 = childPos.subtract(bonePos).normalize();
  const dot = Math.max(-1, Math.min(1, Vector3.Dot(v1, v2)));
  return 180 - Math.acos(dot) * 180 / Math.PI;
}

/**
 * 足が接地しているかを判定。
 */
function isFootGrounded(character: HavokCharacter): boolean {
  return !character.jumpState.active;
}

/**
 * 単一チェーンの力伝達を計算 (地面→末端)。
 */
export function computeChainForce(character: HavokCharacter, chain: ForceChain): ForceOutput {
  const jointForces = new Map<string, number>();
  let activeJoints = 0;

  // 地面からの初期反力
  const grounded = isFootGrounded(character);
  const groundReaction = grounded
    ? FORCE_CHAIN_PARAMS.groundReactionForce
    : FORCE_CHAIN_PARAMS.airReactionForce;

  let currentForce = groundReaction;

  // 地面側 → 末端の順に伝播
  for (const { boneName, params } of chain.joints) {
    const bendAngle = getJointBendAngle(character, boneName);

    // 上流の力を通過 (常に減衰)
    currentForce *= params.passthrough;

    if (bendAngle >= params.minBendForForce) {
      // 関節が曲がっている → 「伸ばす力」を生成して加算
      const bendRange = FORCE_CHAIN_PARAMS.fullBendAngle - params.minBendForForce;
      const bendRatio = Math.min(1, (bendAngle - params.minBendForForce) / Math.max(1, bendRange));
      const generatedForce = bendRatio * params.maxForceGain;
      currentForce += generatedForce;
      activeJoints++;
    }
    // まっすぐな場合: 何も加算しない (通過のみ)

    // 質量による慣性減衰 (重い関節は力を吸収する)
    currentForce *= (1 - params.massRatio * 0.2);

    jointForces.set(boneName, currentForce);
  }

  return {
    jointForces,
    terminalForce: currentForce,
    activeJoints,
    groundReaction,
  };
}

/**
 * 全チェーンの力伝達を計算し、BodyMotion のスケール倍率を返す。
 *
 * 返り値 (0.15〜1.0):
 *   低い = 下半身がまっすぐで力が伝わらない (手打ち)
 *   高い = 全関節が曲がり全身の力が武器先端に到達 (フルスイング)
 */
export function computeForceMultiplier(character: HavokCharacter): number {
  let maxTerminal = 0;

  for (const chain of FORCE_CHAINS) {
    const output = computeChainForce(character, chain);
    maxTerminal = Math.max(maxTerminal, output.terminalForce);
  }

  // 正規化: groundReaction(1.0)が全関節まっすぐで通過した場合の最低値(≈0.5)を基準に
  // 全関節が力を生成した場合(≈2.0)で1.0にスケール
  const normalized = Math.min(1, maxTerminal / 1.8);

  // 0.15〜1.0 にクランプ (完全に0だと不自然)
  return 0.15 + normalized * 0.85;
}

/**
 * デバッグ/UI用: 全チェーンの力伝達詳細を返す。
 */
export function computeForceDetails(character: HavokCharacter): Map<string, ForceOutput> {
  const results = new Map<string, ForceOutput>();
  for (const chain of FORCE_CHAINS) {
    results.set(chain.name, computeChainForce(character, chain));
  }
  return results;
}
