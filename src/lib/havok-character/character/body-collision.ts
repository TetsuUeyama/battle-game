/**
 * ボディ自己貫通防止。IK解決後にボーンセグメント間の距離をチェックし、
 * 貫通している場合はIKターゲットを押し戻す。
 *
 * 各ボーンセグメント (parent→child) を半径付きカプセルとして扱い、
 * 腕/手が胴体や脚を貫通しないようにする。
 * 胴体側は 3cm の許容食い込み (softMargin) を設定。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';

/** コリジョンカプセル定義 */
interface CollisionCapsule {
  /** カプセルのグループ ('torso' | 'arm' | 'leg') — 同グループ内はチェックしない */
  group: string;
  /** 開始ボーン名 */
  startBone: string;
  /** 終了ボーン名 */
  endBone: string;
  /** カプセル半径 (m) */
  radius: number;
  /** 許容食い込み量 (m) — 胴体側に設定 */
  softMargin: number;
}

/** チェック対象のカプセルペア定義 */
const CAPSULES: CollisionCapsule[] = [
  // ── 胴体 (softMargin = 0.03m = 3cm の食い込み許容) ──
  { group: 'torso', startBone: 'mixamorig:Hips', endBone: 'mixamorig:Spine1', radius: 0.12, softMargin: 0.03 },
  { group: 'torso', startBone: 'mixamorig:Spine1', endBone: 'mixamorig:Neck', radius: 0.12, softMargin: 0.03 },

  // ── 左腕 ──
  { group: 'leftArm', startBone: 'mixamorig:LeftArm', endBone: 'mixamorig:LeftForeArm', radius: 0.035, softMargin: 0 },
  { group: 'leftArm', startBone: 'mixamorig:LeftForeArm', endBone: 'mixamorig:LeftHand', radius: 0.03, softMargin: 0 },

  // ── 右腕 ──
  { group: 'rightArm', startBone: 'mixamorig:RightArm', endBone: 'mixamorig:RightForeArm', radius: 0.035, softMargin: 0 },
  { group: 'rightArm', startBone: 'mixamorig:RightForeArm', endBone: 'mixamorig:RightHand', radius: 0.03, softMargin: 0 },

  // ── 左脚 ──
  { group: 'leftLeg', startBone: 'mixamorig:LeftUpLeg', endBone: 'mixamorig:LeftLeg', radius: 0.05, softMargin: 0 },
  { group: 'leftLeg', startBone: 'mixamorig:LeftLeg', endBone: 'mixamorig:LeftFoot', radius: 0.04, softMargin: 0 },

  // ── 右脚 ──
  { group: 'rightLeg', startBone: 'mixamorig:RightUpLeg', endBone: 'mixamorig:RightLeg', radius: 0.05, softMargin: 0 },
  { group: 'rightLeg', startBone: 'mixamorig:RightLeg', endBone: 'mixamorig:RightFoot', radius: 0.04, softMargin: 0 },
];

/** チェックするペア (異なるグループ間のみ) */
const CHECK_PAIRS: [string, string][] = [
  // 腕 vs 胴体
  ['leftArm', 'torso'],
  ['rightArm', 'torso'],
  // 腕 vs 脚
  ['leftArm', 'leftLeg'],
  ['leftArm', 'rightLeg'],
  ['rightArm', 'leftLeg'],
  ['rightArm', 'rightLeg'],
  // 脚 vs 胴体 (膝が腹に刺さるケース)
  ['leftLeg', 'torso'],
  ['rightLeg', 'torso'],
];

/**
 * 2つの線分間の最近接点とその距離を計算。
 */
function closestPointsBetweenSegments(
  a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3,
): { closestA: Vector3; closestB: Vector3; dist: number } {
  const u = a1.subtract(a0);
  const v = b1.subtract(b0);
  const w = a0.subtract(b0);

  const uu = Vector3.Dot(u, u);
  const uv = Vector3.Dot(u, v);
  const vv = Vector3.Dot(v, v);
  const uw = Vector3.Dot(u, w);
  const vw = Vector3.Dot(v, w);

  const denom = uu * vv - uv * uv;
  let s: number, t: number;

  if (denom < 0.0001) {
    s = 0;
    t = vw / (vv || 1);
  } else {
    s = (uv * vw - vv * uw) / denom;
    t = (uu * vw - uv * uw) / denom;
  }

  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));

  const closestA = a0.add(u.scale(s));
  const closestB = b0.add(v.scale(t));
  return { closestA, closestB, dist: Vector3.Distance(closestA, closestB) };
}

/**
 * IK解決後のボディ自己貫通チェック・補正。
 * updateHavokCharacter() 内で IK ソルブの後に呼び出す。
 */
export function resolveBodySelfCollision(character: HavokCharacter): void {
  const bones = character.allBones;

  // カプセルのワールド位置をキャッシュ
  const capsulePositions = new Map<CollisionCapsule, { start: Vector3; end: Vector3 }>();
  for (const cap of CAPSULES) {
    const startBone = bones.get(cap.startBone);
    const endBone = bones.get(cap.endBone);
    if (!startBone || !endBone) continue;
    capsulePositions.set(cap, {
      start: getWorldPos(startBone),
      end: getWorldPos(endBone),
    });
  }

  // IKチェーン名→ターゲット のマップ (押し戻し先)
  const chains = character.ikChains;
  const groupToChain: Record<string, { target: Vector3; weight: number } | null> = {
    leftArm: chains.leftArm.weight > 0 ? chains.leftArm : null,
    rightArm: chains.rightArm.weight > 0 ? chains.rightArm : null,
    leftLeg: chains.leftLeg.weight > 0 ? chains.leftLeg : null,
    rightLeg: chains.rightLeg.weight > 0 ? chains.rightLeg : null,
    torso: null, // 胴体は押し戻されない (固定)
  };

  for (const [groupA, groupB] of CHECK_PAIRS) {
    const capsA = CAPSULES.filter(c => c.group === groupA);
    const capsB = CAPSULES.filter(c => c.group === groupB);

    for (const capA of capsA) {
      const posA = capsulePositions.get(capA);
      if (!posA) continue;

      for (const capB of capsB) {
        const posB = capsulePositions.get(capB);
        if (!posB) continue;

        const { closestA, closestB, dist } = closestPointsBetweenSegments(
          posA.start, posA.end, posB.start, posB.end,
        );

        // 許容距離 = 両カプセルの半径合計 - softMargin合計
        const minDist = capA.radius + capB.radius - capA.softMargin - capB.softMargin;

        if (dist < minDist && dist > 0.001) {
          // 貫通量
          const overlap = minDist - dist;

          // 押し戻し方向: B→A (腕/脚をBから離す)
          const pushDir = closestA.subtract(closestB).normalize();
          const pushAmount = overlap;

          // 腕/脚のIKターゲットを押し戻す (胴体は動かさない)
          const chainA = groupToChain[groupA];
          if (chainA) {
            chainA.target.addInPlace(pushDir.scale(pushAmount));
          }
        }
      }
    }
  }
}
