/**
 * FK → IK ターゲット抽出
 *
 * ■ motion.json のデータ構造 (convert-fbx-motion.mjs で生成)
 *
 *   dq: ワールド空間デルタクォータニオン
 *       = animatedWorldQuat × bindWorldQuat.inverse()
 *       → dq × bindWorldQuat = animatedWorldQuat
 *
 *   dp: ワールド空間デルタ位置 (位置変化があるボーンのみ、主にHips)
 *       = animatedWorldPos - bindWorldPos
 *
 *   bindWorldPositions: バインドポーズの各ボーンワールド位置
 *
 * ■ FK再構築アルゴリズム
 *
 *   1. bindBoneVector = childBindWorldPos - parentBindWorldPos
 *      (バインドポーズでの親→子のワールド空間ベクトル)
 *
 *   2. parentWorldQuat = parentDQ × parentBindWorldQuat
 *      (親のアニメーション後ワールド回転)
 *      ※ 簡略化: dqはワールド空間デルタなので、
 *         animatedBoneVec = parentDQ.rotate(bindBoneVector) で直接計算可能
 *
 *   3. childWorldPos = parentWorldPos + parentDQ.rotate(bindBoneVector) + childDP
 */
import type {
  Vec3, Quat, ConvertedMotionData, ConvertedFrameBone,
  IKFrame, IKTargets, IKMotionData,
} from './types';
import { vec3, addVec3, rotateVec3ByQuat, quatIdentity } from './math';
import { IK_END_EFFECTORS } from './bone-mapping';

/**
 * 変換済みモーションデータからIKターゲットを抽出する。
 * 入力は既にBabylon.js座標系に変換済みの ConvertedMotionData。
 */
export function extractIKTargets(motion: ConvertedMotionData): IKMotionData {
  const hierarchy = motion.hierarchy;
  const bindPos = motion.bindWorldPositions;

  // 親→子のバインドポーズベクトル (事前計算)
  const bindBoneVectors = new Map<string, Vec3>();
  const parentMap = new Map<string, string | null>();

  for (const h of hierarchy) {
    parentMap.set(h.name, h.parent);
    if (h.parent && bindPos[h.name] && bindPos[h.parent]) {
      const child = bindPos[h.name];
      const parent = bindPos[h.parent];
      bindBoneVectors.set(h.name, {
        x: child.x - parent.x,
        y: child.y - parent.y,
        z: child.z - parent.z,
      });
    }
  }

  // トポロジカル順序 (親→子)
  const order: string[] = [];
  const visited = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const p = parentMap.get(name);
    if (p) visit(p);
    order.push(name);
  }
  for (const h of hierarchy) visit(h.name);

  const ikFrames: IKFrame[] = [];
  const spf = 1 / motion.fps;

  for (let fi = 0; fi < motion.frames.length; fi++) {
    const frameData = motion.frames[fi];

    // 各ボーンのワールド位置を計算
    const worldPos = new Map<string, Vec3>();

    for (const boneName of order) {
      const fb = frameData[boneName];
      const bp = bindPos[boneName];

      if (!bp) continue;

      const parent = parentMap.get(boneName);

      if (!parent || !worldPos.has(parent)) {
        // ルートボーン (Hips): bindPos + dp
        const pos = { ...bp };
        if (fb?.dp) {
          pos.x += fb.dp.x;
          pos.y += fb.dp.y;
          pos.z += fb.dp.z;
        }
        worldPos.set(boneName, pos);
      } else {
        // 子ボーン: parentWorldPos + parentDQ.rotate(bindBoneVector) + dp
        const parentPos = worldPos.get(parent)!;
        const parentDQ = frameData[parent]?.dq ?? quatIdentity();
        const boneVec = bindBoneVectors.get(boneName);

        if (boneVec) {
          const rotatedVec = rotateVec3ByQuat(boneVec, parentDQ);
          const pos = addVec3(parentPos, rotatedVec);
          // dp があれば加算 (位置変化があるボーンのみ)
          if (fb?.dp) {
            pos.x += fb.dp.x;
            pos.y += fb.dp.y;
            pos.z += fb.dp.z;
          }
          worldPos.set(boneName, pos);
        } else {
          worldPos.set(boneName, { ...bp });
        }
      }
    }

    const targets: IKTargets = {
      leftHand: worldPos.get(IK_END_EFFECTORS.leftHand) ?? vec3(0, 0, 0),
      rightHand: worldPos.get(IK_END_EFFECTORS.rightHand) ?? vec3(0, 0, 0),
      leftFoot: worldPos.get(IK_END_EFFECTORS.leftFoot) ?? vec3(0, 0, 0),
      rightFoot: worldPos.get(IK_END_EFFECTORS.rightFoot) ?? vec3(0, 0, 0),
    };

    const hipsPos = worldPos.get('Hips') ?? vec3(0, 0, 0);
    const hipsDQ = frameData['Hips']?.dq ?? quatIdentity();

    ikFrames.push({
      frame: fi,
      time: fi * spf,
      targets,
      hipsPosition: hipsPos,
      hipsRotation: hipsDQ,
    });
  }

  return {
    name: motion.name,
    label: motion.label,
    duration: motion.duration,
    fps: motion.fps,
    frameCount: motion.frameCount,
    coordinateSystem: 'babylon',
    ikFrames,
  };
}
