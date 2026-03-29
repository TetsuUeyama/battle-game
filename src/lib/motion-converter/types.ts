/**
 * MotionConverter 型定義
 *
 * 3つの座標系を明確に区別する:
 *
 *   Mixamo FBX (右手系 Y-up)
 *     +X = キャラの左方向, +Y = 上, +Z = 前方
 *     回転: 右手系 (右ねじの法則)
 *     単位: cm, 度数
 *
 *   Blender (右手系 Z-up)
 *     +X = 右, +Y = 奥, +Z = 上
 *     回転: 右手系
 *     単位: m, ラジアン
 *
 *   Babylon.js (左手系 Y-up)
 *     +X = 右, +Y = 上, +Z = 前方(画面奥)
 *     回転: 左手系 (左ねじ — 同じ軸で右手系と逆回り)
 *     単位: m, ラジアン
 *
 * 右手系と左手系の回転の違い:
 *   右手系: +Y軸まわり正の回転 = 上から見て反時計回り
 *   左手系: +Y軸まわり正の回転 = 上から見て時計回り
 *   → 同じ物理的回転を表すには、Y軸・Z軸まわりの角度符号を反転する必要がある
 */

// ─── 座標系ラベル ─────────────────────────────────────────

export type CoordinateSystem = 'mixamo' | 'blender' | 'babylon';

export type Handedness = 'right' | 'left';
export type UpAxis = 'Y' | 'Z';

export interface CoordinateSystemDef {
  name: CoordinateSystem;
  handedness: Handedness;
  upAxis: UpAxis;
  xMeaning: string;
  yMeaning: string;
  zMeaning: string;
  positionUnit: 'cm' | 'm';
  rotationUnit: 'deg' | 'rad';
}

export const COORDINATE_SYSTEMS: Record<CoordinateSystem, CoordinateSystemDef> = {
  mixamo: {
    name: 'mixamo',
    handedness: 'right',
    upAxis: 'Y',
    xMeaning: 'キャラの左 (viewer right)',
    yMeaning: '上',
    zMeaning: '前方',
    positionUnit: 'cm',
    rotationUnit: 'deg',
  },
  blender: {
    name: 'blender',
    handedness: 'right',
    upAxis: 'Z',
    xMeaning: '右',
    yMeaning: '奥 (forward)',
    zMeaning: '上',
    positionUnit: 'm',
    rotationUnit: 'rad',
  },
  babylon: {
    name: 'babylon',
    handedness: 'left',
    upAxis: 'Y',
    xMeaning: '右',
    yMeaning: '上',
    zMeaning: '前方 (画面奥)',
    positionUnit: 'm',
    rotationUnit: 'rad',
  },
};

// ─── ベクトル・クォータニオン ─────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** クォータニオン (x, y, z, w) — w がスカラー部 */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** オイラー角 (度数) */
export interface EulerDeg {
  x: number;
  y: number;
  z: number;
}

// ─── ボーンデータ ─────────────────────────────────────────

export interface RawBoneEntry {
  name: string;
  parent: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  localScaling?: [number, number, number];
  preRotation: [number, number, number];
  worldPosition: [number, number, number];
}

export interface RawBoneData {
  source: string;
  globalSettings: {
    upAxis: number;
    upAxisSign: number;
    frontAxis: number;
    frontAxisSign: number;
    unitScaleFactor: number;
  };
  bones: RawBoneEntry[];
}

export interface ConvertedBoneEntry {
  name: string;
  parent: string | null;
  localPosition: Vec3;
  localRotation: Quat;
  worldPosition: Vec3;
}

export interface ConvertedBoneData {
  source: string;
  coordinateSystem: 'babylon';
  bones: ConvertedBoneEntry[];
}

// ─── モーションデータ ─────────────────────────────────────

export interface MotionHierarchyEntry {
  name: string;
  parent: string | null;
  restPosition: Vec3;
}

/**
 * motion.json の1フレーム・1ボーンのデータ
 *
 * convert-fbx-motion.mjs で生成される。Three.js右手系Y-upの値。
 *
 * dq: ワールド空間デルタクォータニオン [x, y, z, w]
 *     = animatedWorldQuat × bindWorldQuat.inverse()
 *     バインドポーズからのワールド空間での回転差分。
 *     ローカル空間ではないことに注意。IK用。
 *
 * lq: ローカル回転クォータニオン [x, y, z, w]
 *     = bone.quaternion (Three.js)
 *     親ボーン空間でのアニメーション後の回転。FK用。
 *
 * dp: ワールド空間デルタ位置 [x, y, z] (cm)
 *     = animatedWorldPos - bindWorldPos
 *     位置変化があるボーン(主にHips)のみ存在。
 */
export interface RawFrameBone {
  dq: [number, number, number, number];
  lq?: [number, number, number, number];
  dp?: [number, number, number];
}

/**
 * motion.json 全体
 *
 * bindWorldPositions: バインドポーズの各ボーンのワールド位置 (cm, Three.js右手系)
 *   FK計算で使用: ボーンベクトル = childBindWorldPos - parentBindWorldPos
 *   dq でこのベクトルを回転させると、アニメーション後のボーンベクトルになる
 *
 * bindLocalRotations: バインドポーズの各ボーンのローカル回転 (Three.js右手系)
 *   FK用: lq との差分でバインドポーズからの変化量を計算可能
 */
export interface RawMotionData {
  name: string;
  label: string;
  duration: number;
  fps: number;
  frameCount: number;
  fbxBodyHeight?: number;
  hierarchy: MotionHierarchyEntry[];
  outputBones?: string[];
  bindWorldPositions?: Record<string, [number, number, number]>;
  bindLocalRotations?: Record<string, [number, number, number, number]>;
  frames: Record<string, RawFrameBone>[];
}

export interface ConvertedFrameBone {
  /** ワールド空間デルタクォータニオン — Babylon.js左手系 (IK用) */
  dq: Quat;
  /** ローカル回転クォータニオン — Babylon.js左手系 (FK用) */
  lq?: Quat;
  /** ワールド空間デルタ位置 — メートル、Babylon.js左手系 */
  dp?: Vec3;
}

export interface ConvertedMotionData {
  name: string;
  label: string;
  duration: number;
  fps: number;
  frameCount: number;
  coordinateSystem: 'babylon';
  hierarchy: MotionHierarchyEntry[];
  /** バインドポーズのワールド位置 (メートル, Babylon.js左手系) — IK用 */
  bindWorldPositions: Record<string, Vec3>;
  /** バインドポーズのローカル回転 (Babylon.js左手系) — FK用 */
  bindLocalRotations: Record<string, Quat>;
  frames: Record<string, ConvertedFrameBone>[];
}

// ─── IKターゲット ─────────────────────────────────────────

export interface IKTargets {
  leftHand: Vec3;
  rightHand: Vec3;
  leftFoot: Vec3;
  rightFoot: Vec3;
}

export interface IKFrame {
  frame: number;
  time: number;
  targets: IKTargets;
  hipsPosition: Vec3;
  hipsRotation: Quat;
}

export interface IKMotionData {
  name: string;
  label: string;
  duration: number;
  fps: number;
  frameCount: number;
  coordinateSystem: 'babylon';
  ikFrames: IKFrame[];
}

// ─── 初期ポーズ ───────────────────────────────────────────

export type RestPoseType = 't-pose' | 'a-pose' | 'unknown';

export interface APoseConfig {
  leftShoulderAngleDeg: number;
  rightShoulderAngleDeg: number;
}

export const DEFAULT_A_POSE: APoseConfig = {
  leftShoulderAngleDeg: -45,
  rightShoulderAngleDeg: 45,
};
