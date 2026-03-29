/**
 * スケール変換
 *
 * FBX/Mixamoのデフォルト単位はセンチメートル (cm)。
 * Babylon.js / Blender はメートル (m)。
 *
 * bone-data.json の unitScaleFactor:
 *   1   → FBX内部値がそのままcm
 *   100 → FBX内部値がm (×100でcm表記)
 *
 * motion.json の restPosition / dp:
 *   常にcm (Mixamo FBX標準)
 */
import type { Vec3 } from './types';

/** cm → m */
export function cmToM(v: number): number {
  return v / 100;
}

/** m → cm */
export function mToCm(v: number): number {
  return v * 100;
}

/** Vec3を cm → m */
export function cmToMVec3(v: Vec3): Vec3 {
  return { x: v.x / 100, y: v.y / 100, z: v.z / 100 };
}

/** Vec3を m → cm */
export function mToCmVec3(v: Vec3): Vec3 {
  return { x: v.x * 100, y: v.y * 100, z: v.z * 100 };
}

/**
 * bone-data.json の unitScaleFactor に基づいてスケール係数を返す。
 * localPosition に掛けるとメートルになる。
 */
export function getScaleToMeters(unitScaleFactor: number): number {
  // unitScaleFactor=1 → 値はcm → /100
  // unitScaleFactor=100 → 値はm(表記上cm扱い) → /100
  // どちらも /100 でメートルになる
  return unitScaleFactor / 100;
}
