/**
 * 構え・攻撃モーションの制約関数。
 * 制約を満たさない候補は不可として除外する。
 */
import { Vector3 } from '@babylonjs/core';
import type { HavokCharacter, WeaponPhysics } from '../types';
import type { StanceCandidate } from './types';

// ─── 手首トルク制限 ──────────────────────────────────────

/**
 * 手首にかかるトルクを計算する。
 * 重い武器を高い角度で持つほどトルクが大きい。
 *
 * torque = weight × length × sin(gripAngle)
 *   gripAngle: 武器の向きと鉛直下方向のなす角。
 *   真下に持てば0 (トルクなし)、水平なら最大。
 */
export function calcWristTorque(
  weaponDir: Vector3,
  weapon: WeaponPhysics,
): number {
  // weaponDir は先端方向。鉛直下向き (0,-1,0) との角度が小さいほどトルクが小さい
  const downDot = Vector3.Dot(weaponDir, Vector3.Down());
  // downDot=1 → 真下向き (sin=0), downDot=0 → 水平 (sin=1), downDot=-1 → 真上 (sin=0だが不安定)
  const sinAngle = Math.sqrt(1 - downDot * downDot);
  return weapon.weight * weapon.length * sinAngle;
}

/**
 * 手首トルクの上限を計算する。
 * 人間が片手で持続的に保持できるトルクの上限。
 * 両手持ちの場合は1.8倍。
 */
export function calcMaxWristTorque(weapon: WeaponPhysics): number {
  const baseMax = 8.0; // Nm (片手で持続可能な上限の目安)
  return weapon.gripType === 'two-handed' ? baseMax * 1.8 : baseMax;
}

// ─── 制約チェック ────────────────────────────────────────

export interface ConstraintParams {
  /** 腕のリーチ (m) */
  armReach: number;
  /** 肩のワールド位置 */
  shoulderPos: Vector3;
  /** 武器パラメータ */
  weapon: WeaponPhysics;
  /** 手首トルク上限 */
  maxWristTorque: number;
  /** 体の前方方向 (facing) */
  facing: Vector3;
  /** 体の中心位置 (Spine1あたり) */
  bodyCenter: Vector3;
  /** 体の胴体半径 (自己貫通チェック用) */
  bodyRadius: number;
}

// デバッグ用: 制約ごとの棄却カウント
const _rejectCounts = { reach: 0, tooClose: 0, wristTorque: 0, tipPenetration: 0, weaponPenetration: 0, behindShoulder: 0, balance: 0, total: 0 };
let _debugLogged = false;

export function logConstraintStats(): void {
  if (!_debugLogged && _rejectCounts.total > 0) {
    console.log('[Constraints] rejection stats:', { ..._rejectCounts });
    _debugLogged = true;
  }
}

export function resetConstraintStats(): void {
  _rejectCounts.reach = 0;
  _rejectCounts.tooClose = 0;
  _rejectCounts.wristTorque = 0;
  _rejectCounts.tipPenetration = 0;
  _rejectCounts.weaponPenetration = 0;
  _rejectCounts.behindShoulder = 0;
  _rejectCounts.balance = 0;
  _rejectCounts.total = 0;
  _debugLogged = false;
}

/**
 * 構え候補が全制約を満たすか判定する。
 * 1つでも違反があれば false を返す。
 */
export function checkStanceConstraints(
  candidate: StanceCandidate,
  params: ConstraintParams,
): boolean {
  _rejectCounts.total++;

  // 1. 腕のリーチ内か
  const distFromShoulder = Vector3.Distance(candidate.gripPos, params.shoulderPos);
  if (distFromShoulder > params.armReach * 0.98) { _rejectCounts.reach++; return false; }
  // 近すぎる (腕を畳みすぎ) も不可
  if (distFromShoulder < params.armReach * 0.3) { _rejectCounts.tooClose++; return false; }

  // 2. 武器が体に貫通しないか (簡易: gripPosから武器方向にlength分伸ばした先端が体中心に近すぎないか)
  const tipPos = candidate.gripPos.add(candidate.weaponDir.scale(params.weapon.length));
  const tipToBody = tipPos.subtract(params.bodyCenter);
  // 武器先端からbodyCenter方向への最短距離
  const tipBodyDist = tipToBody.length();
  if (tipBodyDist < params.bodyRadius) { _rejectCounts.tipPenetration++; return false; }

  // 武器の柄 (gripPos→tipPos) と体中心の距離もチェック
  const gripToTip = tipPos.subtract(candidate.gripPos);
  const gripToBody = params.bodyCenter.subtract(candidate.gripPos);
  const t = Math.max(0, Math.min(1, Vector3.Dot(gripToBody, gripToTip) / gripToTip.lengthSquared()));
  const closestOnWeapon = candidate.gripPos.add(gripToTip.scale(t));
  const weaponBodyDist = Vector3.Distance(closestOnWeapon, params.bodyCenter);
  if (weaponBodyDist < params.bodyRadius * 0.8) { _rejectCounts.weaponPenetration++; return false; }

  // 4. 背中側に構えていないか (gripPosが肩より後方は不可)
  const shoulderToGrip = candidate.gripPos.subtract(params.shoulderPos);
  const forwardDot = Vector3.Dot(shoulderToGrip, params.facing);
  if (forwardDot < -0.05) { _rejectCounts.behindShoulder++; return false; }

  // 5. バランス制約 (構え位置による重心ずれ)
  // 重い武器が体の遠くにあると重心がずれる
  // 簡易チェック: 武器の重心モーメント (weight × 距離) が上限以内
  const weaponCenterOfMass = candidate.gripPos.add(candidate.weaponDir.scale(params.weapon.length * 0.5));
  const comOffset = weaponCenterOfMass.subtract(params.bodyCenter);
  comOffset.y = 0; // 水平方向のみ
  const comMoment = comOffset.length() * params.weapon.weight;
  if (comMoment > 5.0) { _rejectCounts.balance++; return false; }

  return true;
}
