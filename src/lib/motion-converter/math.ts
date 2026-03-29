/**
 * MotionConverter 数学ユーティリティ
 *
 * 外部依存なし。Babylon.jsやThree.jsがなくても動作する。
 */
import type { Vec3, Quat, EulerDeg } from './types';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD2DEG;
}

// ─── Vec3 ─────────────────────────────────────────────────

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

// ─── Quaternion ───────────────────────────────────────────

export function quat(x: number, y: number, z: number, w: number): Quat {
  return { x, y, z, w };
}

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

/** クォータニオン乗算: a * b (aの後にbを適用) */
export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** クォータニオンの共役 (逆回転) */
export function conjugateQuat(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** クォータニオンの正規化 */
export function normalizeQuat(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-10) return quatIdentity();
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** クォータニオンでベクトルを回転: q * v * q^-1 */
export function rotateVec3ByQuat(v: Vec3, q: Quat): Vec3 {
  const vq: Quat = { x: v.x, y: v.y, z: v.z, w: 0 };
  const result = mulQuat(mulQuat(q, vq), conjugateQuat(q));
  return { x: result.x, y: result.y, z: result.z };
}

/**
 * オイラー角 (度数, XYZ intrinsic order) → クォータニオン
 *
 * FBXのpreRotation/localRotationはXYZ順。
 * 回転は X → Y → Z の順に適用される (intrinsic)。
 * 行列としては Rz * Ry * Rx。
 */
export function eulerDegToQuat(euler: EulerDeg): Quat {
  const hx = euler.x * DEG2RAD * 0.5;
  const hy = euler.y * DEG2RAD * 0.5;
  const hz = euler.z * DEG2RAD * 0.5;

  const cx = Math.cos(hx), sx = Math.sin(hx);
  const cy = Math.cos(hy), sy = Math.sin(hy);
  const cz = Math.cos(hz), sz = Math.sin(hz);

  // Rz * Ry * Rx の順 (intrinsic XYZ = extrinsic ZYX)
  return normalizeQuat({
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  });
}

/**
 * クォータニオン → オイラー角 (度数, XYZ intrinsic order)
 */
export function quatToEulerDeg(q: Quat): EulerDeg {
  // Rz * Ry * Rx から逆算
  const sinp = 2 * (q.w * q.y - q.z * q.x);
  let rx: number, ry: number, rz: number;

  if (Math.abs(sinp) >= 0.9999) {
    // ジンバルロック
    ry = Math.sign(sinp) * Math.PI / 2;
    rx = Math.atan2(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    rz = 0;
  } else {
    ry = Math.asin(sinp);
    rx = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
    rz = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  }

  return { x: rx * RAD2DEG, y: ry * RAD2DEG, z: rz * RAD2DEG };
}

/** 軸+角度 → クォータニオン */
export function axisAngleToQuat(axis: Vec3, angleDeg: number): Quat {
  const half = angleDeg * DEG2RAD * 0.5;
  const s = Math.sin(half);
  const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
  if (len < 1e-10) return quatIdentity();
  return normalizeQuat({
    x: (axis.x / len) * s,
    y: (axis.y / len) * s,
    z: (axis.z / len) * s,
    w: Math.cos(half),
  });
}

/** Slerp補間 */
export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const bAdj = dot < 0
    ? { x: -b.x, y: -b.y, z: -b.z, w: -b.w }
    : b;
  dot = Math.abs(dot);

  if (dot > 0.9995) {
    // 線形補間 + 正規化
    return normalizeQuat({
      x: a.x + (bAdj.x - a.x) * t,
      y: a.y + (bAdj.y - a.y) * t,
      z: a.z + (bAdj.z - a.z) * t,
      w: a.w + (bAdj.w - a.w) * t,
    });
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return {
    x: wa * a.x + wb * bAdj.x,
    y: wa * a.y + wb * bAdj.y,
    z: wa * a.z + wb * bAdj.z,
    w: wa * a.w + wb * bAdj.w,
  };
}
