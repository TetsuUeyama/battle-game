/**
 * 武器クラッシュ判定・反動エフェクト。
 * 武器先端同士の衝突検知 → pushback + 胴体ぐらつき。
 */
import { Vector3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter, CombatAI, ClashState } from '../types';
import { getWeaponTipWorld } from '../weapon';

/**
 * 武器同士の衝突を検知し、反作用を適用。
 * 武器先端同士の距離が 0.25m 未満でクラッシュ発生。
 * 軽い方がより大きく弾かれる (重量比で反動を分配)。
 */
export function checkWeaponClash(
  charA: HavokCharacter,
  charB: HavokCharacter,
  clashA: ClashState,
  clashB: ClashState,
): boolean {
  if (!charA.weapon || !charB.weapon) return false;

  const tipA = getWeaponTipWorld(charA);
  const tipB = getWeaponTipWorld(charB);
  const dist = Vector3.Distance(tipA, tipB);

  if (dist >= 0.25) return false;

  const wA = charA.weapon.weight;
  const wB = charB.weapon.weight;
  const totalW = wA + wB;

  const forceOnA = wB / totalW;
  const forceOnB = wA / totalW;

  const dirAtoB = charB.root.position.subtract(charA.root.position);
  dirAtoB.y = 0;
  if (dirAtoB.length() > 0.01) dirAtoB.normalize();

  const basePush = 1.5;
  const baseStagger = 0.4;

  if (!clashA.staggered) {
    clashA.staggered = true;
    clashA.timer = baseStagger * forceOnA;
    clashA.pushDir = dirAtoB.scale(-1);
    clashA.pushForce = basePush * forceOnA;
    clashA.wobbleIntensity = forceOnA;
  }

  if (!clashB.staggered) {
    clashB.staggered = true;
    clashB.timer = baseStagger * forceOnB;
    clashB.pushDir = dirAtoB.clone();
    clashB.pushForce = basePush * forceOnB;
    clashB.wobbleIntensity = forceOnB;
  }

  return true;
}

/**
 * よろめき状態の更新。毎フレーム呼び出し。
 * 腰の位置を揺らし、キャラを後方に押す。
 */
export function updateClashReaction(
  character: HavokCharacter,
  clash: ClashState,
  ai: CombatAI,
  dt: number,
): void {
  if (!clash.staggered) return;

  clash.timer -= dt;

  const pushDecay = Math.max(0, clash.timer * 2);
  const pushVec = clash.pushDir.scale(clash.pushForce * pushDecay * dt);
  pushVec.y = 0;
  character.root.position.addInPlace(pushVec);

  const clashWobbleT = (1 - clash.timer / 0.4) * Math.PI * 4;
  const spineBone = character.allBones.get('mixamorig:Spine1');
  if (spineBone) {
    const baseRot = character.ikBaseRotations.get(spineBone.name);
    if (baseRot) {
      const wobbleRot = Quaternion.RotationAxis(
        Vector3.Forward(),
        Math.sin(clashWobbleT * 1.3) * clash.wobbleIntensity * 0.1,
      );
      spineBone.rotationQuaternion = wobbleRot.multiply(baseRot.root);
    }
  }

  if (ai.state === 'attack' || ai.state === 'close_in') {
    if (ai.currentMotion) ai.currentMotion.active = false;
    ai.state = 'recover';
    ai.recoverTimer = clash.timer + 0.3;
  }

  if (clash.timer <= 0) {
    clash.staggered = false;
    clash.wobbleIntensity = 0;
    // Spine / Spine1 / Spine2 を全てリセット
    for (const sn of ['mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2']) {
      const sb = character.allBones.get(sn);
      if (sb) {
        const br = character.ikBaseRotations.get(sb.name);
        if (br) sb.rotationQuaternion = br.root.clone();
      }
    }
  }
}
