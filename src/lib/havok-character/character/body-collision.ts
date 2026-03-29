/**
 * ボディ自己貫通防止。
 *
 * IK解決・関節クランプ後に実行し、ボーンセグメント同士が貫通していたら
 * IKターゲットを体の外側に押し出す。
 *
 * 2パスIKの各パスで実行されるため、1回で完全に解決できなくても
 * 2回目のパスで追加補正される。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter } from '../types';
import { getWorldPos } from '@/lib/math-utils';

interface CollisionCapsule {
  group: string;
  startBone: string;
  endBone: string;
  radius: number;
}

const CAPSULES: CollisionCapsule[] = [
  // 胴体
  { group: 'torso', startBone: 'mixamorig:Hips', endBone: 'mixamorig:Spine1', radius: 0.13 },
  { group: 'torso', startBone: 'mixamorig:Spine1', endBone: 'mixamorig:Neck', radius: 0.12 },
  { group: 'torso', startBone: 'mixamorig:Neck', endBone: 'mixamorig:Head', radius: 0.08 },

  // 左腕
  { group: 'leftArm', startBone: 'mixamorig:LeftArm', endBone: 'mixamorig:LeftForeArm', radius: 0.04 },
  { group: 'leftArm', startBone: 'mixamorig:LeftForeArm', endBone: 'mixamorig:LeftHand', radius: 0.03 },

  // 右腕
  { group: 'rightArm', startBone: 'mixamorig:RightArm', endBone: 'mixamorig:RightForeArm', radius: 0.04 },
  { group: 'rightArm', startBone: 'mixamorig:RightForeArm', endBone: 'mixamorig:RightHand', radius: 0.03 },

  // 左脚
  { group: 'leftLeg', startBone: 'mixamorig:LeftUpLeg', endBone: 'mixamorig:LeftLeg', radius: 0.055 },
  { group: 'leftLeg', startBone: 'mixamorig:LeftLeg', endBone: 'mixamorig:LeftFoot', radius: 0.04 },

  // 右脚
  { group: 'rightLeg', startBone: 'mixamorig:RightUpLeg', endBone: 'mixamorig:RightLeg', radius: 0.055 },
  { group: 'rightLeg', startBone: 'mixamorig:RightLeg', endBone: 'mixamorig:RightFoot', radius: 0.04 },
];

/** 異グループ間でチェックするペア */
const CHECK_PAIRS: [string, string][] = [
  ['leftArm', 'torso'],
  ['rightArm', 'torso'],
  ['leftArm', 'leftLeg'],
  ['leftArm', 'rightLeg'],
  ['rightArm', 'leftLeg'],
  ['rightArm', 'rightLeg'],
  ['leftLeg', 'torso'],
  ['rightLeg', 'torso'],
  ['leftArm', 'rightArm'],
];

/** IKターゲットを押し戻すべきグループ → チェーン名のマッピング */
const GROUP_TO_CHAIN: Record<string, string> = {
  leftArm: 'leftArm',
  rightArm: 'rightArm',
  leftLeg: 'leftLeg',
  rightLeg: 'rightLeg',
};

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
 * ボディ自己貫通チェック・補正。
 * IK解決・関節クランプ後に毎パス呼び出す。
 */
export function resolveBodySelfCollision(character: HavokCharacter): void {
  const bones = character.allBones;

  // ワールド行列を更新してからボーン位置を取得
  for (const bone of bones.values()) {
    bone.computeWorldMatrix(true);
  }

  // カプセルのワールド位置をキャッシュ
  const capsulePos = new Map<CollisionCapsule, { start: Vector3; end: Vector3 }>();
  for (const cap of CAPSULES) {
    const startBone = bones.get(cap.startBone);
    const endBone = bones.get(cap.endBone);
    if (!startBone || !endBone) continue;
    capsulePos.set(cap, {
      start: getWorldPos(startBone),
      end: getWorldPos(endBone),
    });
  }

  const chains = character.ikChains;

  // 各ペアでチェック
  for (const [groupA, groupB] of CHECK_PAIRS) {
    const capsA = CAPSULES.filter(c => c.group === groupA);
    const capsB = CAPSULES.filter(c => c.group === groupB);

    for (const capA of capsA) {
      const posA = capsulePos.get(capA);
      if (!posA) continue;

      for (const capB of capsB) {
        const posB = capsulePos.get(capB);
        if (!posB) continue;

        const { closestA, closestB, dist } = closestPointsBetweenSegments(
          posA.start, posA.end, posB.start, posB.end,
        );

        const minDist = capA.radius + capB.radius;

        if (dist < minDist && dist > 0.001) {
          const overlap = minDist - dist;
          const pushDir = closestA.subtract(closestB).normalize();

          // 腕/脚側のIKターゲットを押し出す (余裕を持って1.5倍押す)
          const pushAmount = overlap * 1.5;

          const chainNameA = GROUP_TO_CHAIN[groupA];
          const chainNameB = GROUP_TO_CHAIN[groupB];

          // groupAが腕/脚なら押し出す
          if (chainNameA) {
            const chain = (chains as any)[chainNameA];
            if (chain && chain.weight > 0) {
              chain.target.addInPlace(pushDir.scale(pushAmount));
            }
          }
          // groupBも腕/脚なら逆方向に押し出す
          if (chainNameB) {
            const chain = (chains as any)[chainNameB];
            if (chain && chain.weight > 0) {
              chain.target.addInPlace(pushDir.scale(-pushAmount));
            }
          }
        }
      }
    }
  }
}
