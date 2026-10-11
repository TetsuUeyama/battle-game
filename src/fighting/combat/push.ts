/**
 * 押し合い判定 (pushbox) の簡易解決。
 *
 * hitbox/hurtbox は攻撃判定専用なので、キャラ同士のめり込み防止は
 * root 位置の XZ 距離で別途解決する。毎フレーム呼ぶ想定。
 */

import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import type { CharacterRig } from "../fighting/types";

/**
 * 押し合いの対象。CharacterRig (rig.root.position を動かす) のほか、
 * 位置を持つ TransformNode を直接渡せる。
 * rig.root の上にラッパー TransformNode を被せて位置・回転を管理する構成
 * (battle-game /fight 方式) では、そのラッパーを渡すこと。
 */
export type PushTarget = CharacterRig | TransformNode;

export interface ResolvePushOptions {
  /**
   * a 側が動く割合 (0..1)。0.5 で両者均等に押し合う。
   * 0 なら a は動かず b だけ押し出される (壁際処理などに)。
   */
  ratioA?: number;
}

/**
 * 2 キャラの位置が minDistance (m) より近ければ、XZ 平面上で互いに
 * 押し戻して重なりを解消する。Y (高さ) は変更しない。
 *
 * 完全に同一点に重なった場合は a の +X 方向へ押し出す。
 * 戻り値は「押し戻しが発生したか」。
 */
export function resolvePush(
  a: PushTarget,
  b: PushTarget,
  minDistance: number,
  opts?: ResolvePushOptions,
): boolean {
  const pa = positionOf(a);
  const pb = positionOf(b);

  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDistance * minDistance) return false;

  const dist = Math.sqrt(distSq);
  // 方向 (a→b)。同一点ならフォールバックで +X。
  let nx = 1;
  let nz = 0;
  if (dist > 1e-6) {
    nx = dx / dist;
    nz = dz / dist;
  }

  const overlap = minDistance - dist;
  const ratioA = clamp01(opts?.ratioA ?? 0.5);
  const ratioB = 1 - ratioA;

  pa.x -= nx * overlap * ratioA;
  pa.z -= nz * overlap * ratioA;
  pb.x += nx * overlap * ratioB;
  pb.z += nz * overlap * ratioB;
  return true;
}

/** 2 キャラの XZ 距離 (m)。間合い判定用の小ヘルパ */
export function rootDistanceXZ(a: PushTarget, b: PushTarget): number {
  const pa = positionOf(a);
  const pb = positionOf(b);
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** PushTarget から「動かすべき position」を取り出す */
function positionOf(t: PushTarget): TransformNode["position"] {
  return "root" in t ? t.root.position : t.position;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
