/**
 * 右手系 ↔ 左手系 変換
 *
 * Mixamo FBX (右手系 Y-up) → Babylon.js (左手系 Y-up) の変換。
 * 両方とも Y-up なので軸の入れ替えは不要。利き手だけが違う。
 *
 * ■ 変換方法: Z軸を反転 (ミラー)
 *
 *   位置:     (x, y, z) → (x, y, -z)
 *   クォータニオン: (qx, qy, qz, qw) → (-qx, -qy, qz, qw)
 *   オイラー角:    (rx, ry, rz) → (-rx, -ry, rz)
 *
 * ■ なぜZ反転か
 *   右手系と左手系の差は、1つの軸の向きが逆になること。
 *   Y-up で前方を +Z とした場合:
 *     右手系: +Z = 手前 (カメラの方)
 *     左手系: +Z = 奥   (カメラから離れる)
 *   → Z を反転すれば同じ物理的方向を指す。
 *
 *   回転については、Z反転のミラー変換を適用すると:
 *     X軸まわり: Y→Z の回転方向が逆転 → 角度反転
 *     Y軸まわり: Z→X の回転方向が逆転 → 角度反転
 *     Z軸まわり: X→Y の回転方向は変わらない → そのまま
 *
 *   クォータニオン (qx, qy, qz, qw) では:
 *     qx = sin(θ/2) * axis.x — X軸回転成分 → 反転
 *     qy = sin(θ/2) * axis.y — Y軸回転成分 → 反転
 *     qz = sin(θ/2) * axis.z — Z軸回転成分 → そのまま
 *     qw = cos(θ/2)          — スカラー    → そのまま
 */
import type { Vec3, Quat, EulerDeg } from './types';

/**
 * 位置を右手系Y-up → 左手系Y-up に変換 (Z反転)
 */
export function convertPositionRHtoLH(pos: Vec3): Vec3 {
  return { x: pos.x, y: pos.y, z: -pos.z };
}

/**
 * 位置を左手系Y-up → 右手系Y-up に変換 (Z反転、同じ操作)
 */
export function convertPositionLHtoRH(pos: Vec3): Vec3 {
  return convertPositionRHtoLH(pos); // 自己逆変換
}

/**
 * クォータニオンを右手系Y-up → 左手系Y-up に変換
 */
export function convertQuatRHtoLH(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: q.z, w: q.w };
}

/**
 * クォータニオンを左手系Y-up → 右手系Y-up に変換 (同じ操作)
 */
export function convertQuatLHtoRH(q: Quat): Quat {
  return convertQuatRHtoLH(q);
}

/**
 * オイラー角(度数)を右手系Y-up → 左手系Y-up に変換
 */
export function convertEulerRHtoLH(euler: EulerDeg): EulerDeg {
  return { x: -euler.x, y: -euler.y, z: euler.z };
}

/**
 * オイラー角(度数)を左手系Y-up → 右手系Y-up に変換 (同じ操作)
 */
export function convertEulerLHtoRH(euler: EulerDeg): EulerDeg {
  return convertEulerRHtoLH(euler);
}
