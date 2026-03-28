/**
 * 関節レディネス (構え維持)。
 *
 * IK解決後に各関節が「まっすぐ」になりすぎないよう補正する。
 * まっすぐな関節は力を伝達できないため、常にわずかに曲がった状態を維持する。
 *
 * ■ ルール
 *   - 関節の曲げ角度が minReadyBend° 未満 → minReadyBend° まで曲げる
 *   - 力の伝達チェーンに含まれる全関節に適用
 *   - 補正は柔らかく (1フレームで急に曲げない)
 *
 * ■ 効果
 *   - 構え時: 膝・肘が常にわずかに曲がった自然な姿勢
 *   - 攻撃準備: 関節が曲がっているので即座に力を伝達できる
 *   - 攻撃後: まっすぐに伸びきった関節を自動的に曲げ直す
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter, IKChain } from '../types';
import { getWorldPos } from '@/lib/math-utils';

/** 各関節の最小曲げ角 (度) — これ未満にならないよう維持 */
const MIN_READY_BEND: Record<string, number> = {
  // 膝: 常にわずかに曲げて踏ん張れる状態
  leftLeg: 10,
  rightLeg: 10,
  // 肘: 常にわずかに曲げて力を伝えられる状態
  leftArm: 12,
  rightArm: 12,
};

/** 補正の柔らかさ (0-1): 小さいほどゆっくり補正 */
const CORRECTION_SPEED = 0.15;

/**
 * IK解決後、まっすぐすぎる関節を最小曲げ角まで戻す。
 * updateHavokCharacter() 内で IK + clamp の後に呼び出す。
 */
export function maintainJointReadiness(character: HavokCharacter, dt: number): void {
  const chains = character.ikChains;

  for (const [chainName, chain] of Object.entries(chains) as [string, IKChain][]) {
    const minBend = MIN_READY_BEND[chainName];
    if (minBend === undefined || chain.weight <= 0) continue;

    // mid joint (肘/膝) の現在の曲げ角度を計算
    chain.root.computeWorldMatrix(true);
    chain.mid.computeWorldMatrix(true);
    chain.end.computeWorldMatrix(true);

    const rootPos = chain.root.getAbsolutePosition();
    const midPos = chain.mid.getAbsolutePosition();
    const endPos = chain.end.getAbsolutePosition();

    const v1 = rootPos.subtract(midPos).normalize();
    const v2 = endPos.subtract(midPos).normalize();
    const dot = Math.max(-1, Math.min(1, Vector3.Dot(v1, v2)));
    const currentBend = 180 - Math.acos(dot) * 180 / Math.PI;

    if (currentBend >= minBend) continue; // 十分曲がっている → 補正不要

    // IKターゲットを少し手前に引いて関節を曲げる
    // 原理: ターゲットを root に近づけると mid joint が曲がる
    const rootToTarget = chain.target.subtract(rootPos);
    const currentDist = rootToTarget.length();
    const maxReach = chain.lengthA + chain.lengthB;

    // 曲げ不足分に応じてターゲット距離を短縮
    const bendDeficit = minBend - currentBend; // 度
    const shortenRatio = bendDeficit * 0.003; // 1度あたり0.3%短縮
    const targetDist = currentDist * (1 - shortenRatio * CORRECTION_SPEED);

    // maxReach の 98% を超えないようにする (完全に伸びきらない)
    const clampedDist = Math.min(targetDist, maxReach * 0.98);

    if (clampedDist < currentDist) {
      const dir = rootToTarget.normalize();
      const newTarget = rootPos.add(dir.scale(clampedDist));
      // 柔らかく補間
      Vector3.LerpToRef(chain.target, newTarget, CORRECTION_SPEED, chain.target);
    }
  }
}
