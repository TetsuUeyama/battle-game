/**
 * 軸系変換 (Z-up ↔ Y-up)
 *
 * Blender (右手系 Z-up) → 中間 (右手系 Y-up) → Babylon.js (左手系 Y-up)
 *
 * ■ Blender → 右手系 Y-up の軸マッピング
 *
 *   Blender:        +X = 右, +Y = 奥,  +Z = 上
 *   右手系 Y-up:    +X = 右, +Y = 上,  +Z = 手前
 *
 *   変換: (x, y, z) → (x, z, -y)
 *     Blender X → そのまま X
 *     Blender Z (上) → Y (上)
 *     Blender Y (奥) → -Z (手前の逆=奥…だが右手系なので-Y→+Z方向)
 *
 *   回転:
 *     Blender X軸回転 → Y-up系の X軸回転 (ただしY,Z軸が入れ替わるので角度調整要)
 *     具体的には: (rx, ry, rz) → (rx, rz, -ry)
 *
 * ■ Blender FBX Export のデフォルト設定
 *   Forward: -Z, Up: Y
 *   これはBlender内部で Z-up→Y-up 変換してからFBX出力する設定。
 *   この場合、出力されるFBXは既にY-upなので axis-system 変換は不要、
 *   handedness 変換のみ必要。
 *
 *   ただしBlenderのFBXエクスポーターにはバグ(T95408)があり、
 *   軸設定が正しく反映されないケースがある。
 *   その場合はこのモジュールの変換を使う。
 */
import type { Vec3, Quat, EulerDeg } from './types';
import { eulerDegToQuat, quatToEulerDeg } from './math';

/**
 * 位置を Blender Z-up → 右手系 Y-up に変換
 * (x, y, z) → (x, z, -y)
 */
export function convertPositionZupToYup(pos: Vec3): Vec3 {
  return { x: pos.x, y: pos.z, z: -pos.y };
}

/**
 * 位置を 右手系 Y-up → Blender Z-up に変換
 * (x, y, z) → (x, -z, y)
 */
export function convertPositionYupToZup(pos: Vec3): Vec3 {
  return { x: pos.x, y: -pos.z, z: pos.y };
}

/**
 * オイラー角(度数)を Blender Z-up → 右手系 Y-up に変換
 * (rx, ry, rz) → (rx, rz, -ry)
 */
export function convertEulerZupToYup(euler: EulerDeg): EulerDeg {
  return { x: euler.x, y: euler.z, z: -euler.y };
}

/**
 * オイラー角(度数)を 右手系 Y-up → Blender Z-up に変換
 * (rx, ry, rz) → (rx, -rz, ry)
 */
export function convertEulerYupToZup(euler: EulerDeg): EulerDeg {
  return { x: euler.x, y: -euler.z, z: euler.y };
}

/**
 * クォータニオンを Blender Z-up → 右手系 Y-up に変換
 *
 * 軸のリマップ: X→X, Y→-Z, Z→Y なので
 * (qx, qy, qz, qw) → (qx, qz, -qy, qw)
 */
export function convertQuatZupToYup(q: Quat): Quat {
  return { x: q.x, y: q.z, z: -q.y, w: q.w };
}

/**
 * クォータニオンを 右手系 Y-up → Blender Z-up に変換
 * (qx, qy, qz, qw) → (qx, -qz, qy, qw)
 */
export function convertQuatYupToZup(q: Quat): Quat {
  return { x: q.x, y: -q.z, z: q.y, w: q.w };
}
