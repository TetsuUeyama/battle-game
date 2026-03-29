/**
 * 変換パイプライン
 *
 * bone-data.json / motion.json を読み込み、
 * Babylon.js 左手系 Y-up メートル単位に一括変換する。
 *
 * ■ motion.json のデータ形式 (convert-fbx-motion.mjs で生成)
 *
 *   dq: ワールド空間デルタクォータニオン
 *       = animatedWorldQuat × bindWorldQuat.inverse()
 *       バインドポーズからのワールド空間での回転差分。
 *
 *   dp: ワールド空間デルタ位置 (cm)
 *       = animatedWorldPos - bindWorldPos
 *       位置変化のあるボーンのみ。
 *
 *   bindWorldPositions: バインドポーズの各ボーンのワールド位置 (cm)
 *
 *   FK再構築の方法:
 *     boneVector = childBindWorldPos - parentBindWorldPos
 *     animatedBoneVector = parentDQ.rotate(boneVector)
 *     childWorldPos = parentWorldPos + animatedBoneVector + childDP
 */
import type {
  CoordinateSystem, Vec3, Quat, EulerDeg,
  RawBoneData, ConvertedBoneData, ConvertedBoneEntry,
  RawMotionData, ConvertedMotionData, ConvertedFrameBone,
} from './types';
import { eulerDegToQuat, mulQuat, normalizeQuat } from './math';
import { convertPositionRHtoLH, convertQuatRHtoLH, convertEulerRHtoLH } from './handedness';
import { convertPositionZupToYup, convertQuatZupToYup, convertEulerZupToYup } from './axis-system';
import { getScaleToMeters, cmToMVec3 } from './scale';

// ─── 内部ヘルパー ─────────────────────────────────────────

function convertPosition(pos: Vec3, source: CoordinateSystem): Vec3 {
  switch (source) {
    case 'mixamo':
      return convertPositionRHtoLH(pos);
    case 'blender':
      return convertPositionRHtoLH(convertPositionZupToYup(pos));
    case 'babylon':
      return pos;
  }
}

function convertQuat(q: Quat, source: CoordinateSystem): Quat {
  switch (source) {
    case 'mixamo':
      return convertQuatRHtoLH(q);
    case 'blender':
      return convertQuatRHtoLH(convertQuatZupToYup(q));
    case 'babylon':
      return q;
  }
}

function convertEuler(euler: EulerDeg, source: CoordinateSystem): EulerDeg {
  switch (source) {
    case 'mixamo':
      return convertEulerRHtoLH(euler);
    case 'blender':
      return convertEulerRHtoLH(convertEulerZupToYup(euler));
    case 'babylon':
      return euler;
  }
}

// ─── bone-data.json 変換 ──────────────────────────────────

export function convertBoneData(
  raw: RawBoneData,
  source: CoordinateSystem = 'mixamo',
): ConvertedBoneData {
  const scaleToM = getScaleToMeters(raw.globalSettings.unitScaleFactor);

  const bones: ConvertedBoneEntry[] = raw.bones.map(entry => {
    const localPosCm: Vec3 = {
      x: entry.localPosition[0] * scaleToM,
      y: entry.localPosition[1] * scaleToM,
      z: entry.localPosition[2] * scaleToM,
    };
    const worldPosCm: Vec3 = {
      x: entry.worldPosition[0],
      y: entry.worldPosition[1],
      z: entry.worldPosition[2],
    };

    const localPos = convertPosition(localPosCm, source);
    const worldPos = convertPosition(worldPosCm, source);

    const preEuler: EulerDeg = { x: entry.preRotation[0], y: entry.preRotation[1], z: entry.preRotation[2] };
    const lclEuler: EulerDeg = { x: entry.localRotation[0], y: entry.localRotation[1], z: entry.localRotation[2] };

    const preConverted = convertEuler(preEuler, source);
    const lclConverted = convertEuler(lclEuler, source);

    const preQuat = eulerDegToQuat(preConverted);
    const lclQuat = eulerDegToQuat(lclConverted);
    const localRot = normalizeQuat(mulQuat(preQuat, lclQuat));

    return {
      name: entry.name,
      parent: entry.parent,
      localPosition: localPos,
      localRotation: localRot,
      worldPosition: worldPos,
    };
  });

  return { source: raw.source, coordinateSystem: 'babylon', bones };
}

// ─── motion.json 変換 ─────────────────────────────────────

/**
 * motion.json を Babylon.js 座標系に変換する。
 *
 * dq (ワールド空間デルタクォータニオン) と dp (ワールド空間デルタ位置) を
 * Three.js右手系 → Babylon.js左手系に変換。
 * bindWorldPositions も同様に変換。
 */
/**
 * @param targetHipsHeight キャラクターのHips高さ(メートル)。
 *   指定すると、モーションデータをこの高さに合わせてスケーリングする。
 *   bone-data.json の Hips worldPosition Y を渡す。
 */
export function convertMotionData(
  raw: RawMotionData,
  source: CoordinateSystem = 'mixamo',
  targetHipsHeight?: number,
): ConvertedMotionData {
  // ── スケール検出 ──
  // FBXファイルによってcm単位とm単位が混在する。
  const hipsBindY = raw.bindWorldPositions?.['Hips']?.[1] ?? 0;
  let posScale: number;
  if (raw.fbxBodyHeight && raw.fbxBodyHeight > 10) {
    posScale = 1 / 100;
  } else if (raw.fbxBodyHeight && raw.fbxBodyHeight <= 10) {
    posScale = 1;
  } else {
    posScale = Math.abs(hipsBindY) > 10 ? (1 / 100) : 1;
  }

  // targetHipsHeight が指定されている場合、モーションFBXのHips高さに合わせてスケール
  if (targetHipsHeight && Math.abs(hipsBindY * posScale) > 0.01) {
    const motionHipsM = hipsBindY * posScale;
    posScale *= targetHipsHeight / motionHipsM;
  }

  // hierarchy の restPosition を変換
  const hierarchy = raw.hierarchy.map(entry => ({
    name: entry.name,
    parent: entry.parent,
    restPosition: convertPosition({
      x: entry.restPosition.x * posScale,
      y: entry.restPosition.y * posScale,
      z: entry.restPosition.z * posScale,
    }, source),
  }));

  // bindWorldPositions を変換
  const bindWorldPositions: Record<string, Vec3> = {};
  if (raw.bindWorldPositions) {
    for (const [name, pos] of Object.entries(raw.bindWorldPositions)) {
      bindWorldPositions[name] = convertPosition(
        { x: pos[0] * posScale, y: pos[1] * posScale, z: pos[2] * posScale },
        source,
      );
    }
  }

  // bindLocalRotations を変換 (FK用)
  const bindLocalRotations: Record<string, Quat> = {};
  if (raw.bindLocalRotations) {
    for (const [name, q] of Object.entries(raw.bindLocalRotations)) {
      bindLocalRotations[name] = convertQuat(
        { x: q[0], y: q[1], z: q[2], w: q[3] },
        source,
      );
    }
  }

  // 各フレームのデータを変換
  const frames: Record<string, ConvertedFrameBone>[] = raw.frames.map(frame => {
    const converted: Record<string, ConvertedFrameBone> = {};

    for (const [boneName, boneFrame] of Object.entries(frame)) {
      // dq: ワールド空間デルタクォータニオン → 座標系変換 (IK用)
      const rawDQ: Quat = {
        x: boneFrame.dq[0], y: boneFrame.dq[1],
        z: boneFrame.dq[2], w: boneFrame.dq[3],
      };
      const dq = convertQuat(rawDQ, source);

      const entry: ConvertedFrameBone = { dq };

      // lq: ローカル回転 → 座標系変換 (FK用)
      if (boneFrame.lq) {
        entry.lq = convertQuat(
          { x: boneFrame.lq[0], y: boneFrame.lq[1], z: boneFrame.lq[2], w: boneFrame.lq[3] },
          source,
        );
      }

      // dp: ワールド空間デルタ位置 → スケール + 座標系変換
      if (boneFrame.dp) {
        entry.dp = convertPosition(
          { x: boneFrame.dp[0] * posScale, y: boneFrame.dp[1] * posScale, z: boneFrame.dp[2] * posScale },
          source,
        );
      }

      converted[boneName] = entry;
    }

    return converted;
  });

  return {
    name: raw.name,
    label: raw.label,
    duration: raw.duration,
    fps: raw.fps,
    frameCount: raw.frameCount,
    coordinateSystem: 'babylon',
    hierarchy,
    bindWorldPositions,
    bindLocalRotations,
    frames,
  };
}
