/**
 * Havok Character System — Foot planting, stepping, balance, center of mass, and debug visuals.
 */
import {
  Scene, Vector3, Color3, MeshBuilder, Mesh, StandardMaterial, TransformNode, Quaternion,
} from '@babylonjs/core';
import type {
  IKChain, HavokCharacter, FootStep, FootStepper, DebugVisuals, BoneDataFile, CombatAI,
} from '../types';
import { COM_WEIGHTS } from '../types';
import { getWorldPos, applyWorldDeltaRotation } from '@/lib/math-utils';
import { getCharacterDirections } from './directions';
import { getOffHandRestPosition } from '../weapon/stance';
import { endSwing } from '../weapon';
import { BALANCE_CONFIG } from './body';

// ─── Center of Mass ──────────────────────────────────────

export function calculateCenterOfMass(combatBones: Map<string, TransformNode>): Vector3 {
  const com = Vector3.Zero();
  let totalWeight = 0;

  for (const [name, weight] of Object.entries(COM_WEIGHTS)) {
    const bone = combatBones.get(name);
    if (!bone) continue;
    com.addInPlace(getWorldPos(bone).scale(weight));
    totalWeight += weight;
  }

  if (totalWeight > 0) com.scaleInPlace(1 / totalWeight);
  return com;
}

export function getBalanceDeviation(com: Vector3, leftFoot: Vector3, rightFoot: Vector3): number {
  const center = leftFoot.add(rightFoot).scale(0.5);
  const radius = Vector3.Distance(leftFoot, rightFoot) / 2 + 0.05;
  const dx = com.x - center.x;
  const dz = com.z - center.z;
  return Math.max(0, Math.sqrt(dx * dx + dz * dz) - radius);
}

// ─── Foot Planting ───────────────────────────────────────

/**
 * Initialize foot plant targets from current T-pose foot positions.
 * Called once after character creation. Targets are fixed to ground.
 */
export function initFootPlanting(character: HavokCharacter, boneData: BoneDataFile): void {
  const chains = character.ikChains;
  const fp = character.footPlant;

  // Use bone-data.json worldPosition directly (reliable, no runtime matrix issues)
  const rootOffset = character.root.position;
  const lFootEntry = boneData.bones.find(b => b.name === 'mixamorig:LeftFoot');
  const rFootEntry = boneData.bones.find(b => b.name === 'mixamorig:RightFoot');

  const lFootY = lFootEntry ? lFootEntry.worldPosition[1] : 0.10;
  const rFootY = rFootEntry ? rFootEntry.worldPosition[1] : 0.10;
  const lFootX = lFootEntry ? lFootEntry.worldPosition[0] + rootOffset.x : rootOffset.x;
  const lFootZ = lFootEntry ? lFootEntry.worldPosition[2] + rootOffset.z : rootOffset.z;
  const rFootX = rFootEntry ? rFootEntry.worldPosition[0] + rootOffset.x : rootOffset.x;
  const rFootZ = rFootEntry ? rFootEntry.worldPosition[2] + rootOffset.z : rootOffset.z;

  character.initialFootY = { left: lFootY, right: rFootY };

  // Hipsの基準Y位置を保存
  const hipsBone = character.allBones.get('mixamorig:Hips');
  if (hipsBone) {
    character.hipsBaseY = hipsBone.position.y;
  }

  fp.leftLocked = new Vector3(lFootX, lFootY, lFootZ);
  fp.rightLocked = new Vector3(rFootX, rFootY, rFootZ);

  chains.leftLeg.target.copyFrom(fp.leftLocked);
  chains.rightLeg.target.copyFrom(fp.rightLocked);
  chains.leftLeg.weight = 1;
  chains.rightLeg.weight = 1;

  // FootStepper 初期化
  character.footStepper.left.planted.copyFrom(fp.leftLocked);
  character.footStepper.right.planted.copyFrom(fp.rightLocked);
}

// ─── Foot Stepping ───────────────────────────────────────

/**
 * 足のステッピング更新。腰の位置から各足の理想位置を計算し、
 * 閾値を超えた足を持ち上げて弧を描きながら着地させる。
 */
export function updateFootStepping(character: HavokCharacter, dt: number): void {
  const stepper = character.footStepper;
  const chains = character.ikChains;
  const dirs = getCharacterDirections(character);
  if (!dirs) return;

  const { forward, charRight } = dirs;
  const hipsBone = character.allBones.get('mixamorig:Hips');
  if (!hipsBone) return;
  const hipsPos = getWorldPos(hipsBone);

  // 地面Y (初期足位置のY = 接地面)
  const groundY = character.initialFootY.left;

  // 各足の理想位置: 腰の真下 ± スタンス幅
  // Mixamo Left = 画面右足, Mixamo Right = 画面左足
  const idealL = hipsPos.add(charRight.scale(stepper.stanceHalfWidth));
  idealL.y = groundY;
  const idealR = hipsPos.add(charRight.scale(-stepper.stanceHalfWidth));
  idealR.y = groundY;

  // 各足の水平距離 (Y無視)
  const distL = Math.sqrt(
    (stepper.left.planted.x - idealL.x) ** 2 + (stepper.left.planted.z - idealL.z) ** 2,
  );
  const distR = Math.sqrt(
    (stepper.right.planted.x - idealR.x) ** 2 + (stepper.right.planted.z - idealR.z) ** 2,
  );

  // ステップ発動: 片足ずつ、より遠い方を優先
  if (!stepper.left.stepping && !stepper.right.stepping) {
    if (distL > stepper.stepThreshold && distL >= distR) {
      // 画面右足 (Mixamo Left) をステップ
      stepper.left.stepping = true;
      stepper.left.progress = 0;
      stepper.left.liftPos = stepper.left.planted.clone();
      // 理想位置より少し先にオーバーシュート (自然な歩行)
      const overshoot = idealL.subtract(stepper.left.planted).normalize().scale(0.03);
      stepper.left.target = idealL.add(overshoot);
      stepper.left.target.y = groundY;
    } else if (distR > stepper.stepThreshold) {
      // 画面左足 (Mixamo Right) をステップ
      stepper.right.stepping = true;
      stepper.right.progress = 0;
      stepper.right.liftPos = stepper.right.planted.clone();
      const overshoot = idealR.subtract(stepper.right.planted).normalize().scale(0.03);
      stepper.right.target = idealR.add(overshoot);
      stepper.right.target.y = groundY;
    }
  }

  // ステップ更新
  updateSingleStep(stepper.left, stepper, chains.leftLeg, groundY, dt);
  updateSingleStep(stepper.right, stepper, chains.rightLeg, groundY, dt);

  // ステップ中でない足は接地位置に固定
  if (!stepper.left.stepping) {
    chains.leftLeg.target.copyFrom(stepper.left.planted);
  }
  if (!stepper.right.stepping) {
    chains.rightLeg.target.copyFrom(stepper.right.planted);
  }

  // footPlant (legacy) も更新
  character.footPlant.leftLocked = stepper.left.planted.clone();
  character.footPlant.rightLocked = stepper.right.planted.clone();
}

/** 片足のステップ進行 */
function updateSingleStep(
  foot: FootStep,
  stepper: FootStepper,
  chain: IKChain,
  groundY: number,
  dt: number,
): void {
  if (!foot.stepping) return;

  foot.progress += dt / stepper.stepDuration;
  if (foot.progress >= 1.0) {
    // 着地完了
    foot.progress = 1.0;
    foot.stepping = false;
    foot.planted.copyFrom(foot.target);
    foot.planted.y = groundY;
    chain.target.copyFrom(foot.planted);
    return;
  }

  const t = foot.progress;
  // XZ: 線形補間
  const posX = foot.liftPos.x + (foot.target.x - foot.liftPos.x) * t;
  const posZ = foot.liftPos.z + (foot.target.z - foot.liftPos.z) * t;
  // Y: 放物線 (0→stepHeight→0)
  const posY = groundY + stepper.stepHeight * 4 * t * (1 - t);

  chain.target.set(posX, posY, posZ);
}

// ─── Balance System ──────────────────────────────────────

/**
 * バランスシステム更新。毎フレーム呼び出し。
 * 重心が支持基底面(両足の間)から外れたらよろめきを発生。
 * オフハンドを重心補正方向に自動移動。
 */
export function updateBalance(
  character: HavokCharacter,
  ai: CombatAI | null,
  dt: number,
): void {
  const bal = character.balance;
  const combatBones = character.combatBones;

  // 重心計算
  const com = calculateCenterOfMass(combatBones);
  const lFoot = getWorldPos(combatBones.get('leftFoot')!);
  const rFoot = getWorldPos(combatBones.get('rightFoot')!);

  // 重心逸脱度
  bal.deviation = getBalanceDeviation(com, lFoot, rFoot);

  // ─── よろめき判定 ───
  if (!bal.staggered && bal.deviation > BALANCE_CONFIG.staggerThreshold) {
    bal.staggered = true;
    // よろめき時間: 逸脱度に比例 (0.3〜1.0秒)
    bal.staggerTimer = Math.min(1.0, 0.3 + bal.deviation * 3);
    bal.staggerIntensity = Math.min(1.0, bal.deviation * 5);

    // 重心がずれた方向
    const footCenter = lFoot.add(rFoot).scale(0.5);
    bal.staggerDir = com.subtract(footCenter);
    bal.staggerDir.y = 0;
    if (bal.staggerDir.length() > 0.01) bal.staggerDir.normalize();

    // AIの攻撃を強制中断
    if (ai && (ai.state === 'attack' || ai.state === 'close_in')) {
      if (ai.currentMotion) ai.currentMotion.active = false;
      endSwing(character);
      ai.state = 'recover';
      ai.recoverTimer = bal.staggerTimer + 0.2;
    }
  }

  // ─── よろめき中の処理 ───
  if (bal.staggered) {
    bal.staggerTimer -= dt;
    const t = bal.staggerTimer;

    // 体を横にぐらつかせる (Y方向には変化させない)
    const spineBone = character.allBones.get('mixamorig:Spine1');
    if (spineBone) {
      const baseRot = character.ikBaseRotations.get(spineBone.name);
      if (baseRot) {
        spineBone.rotationQuaternion = baseRot.root.clone();
        const wobbleRot = Quaternion.RotationAxis(
          Vector3.Forward(),
          Math.sin(t * 12) * bal.staggerIntensity * 0.08,
        );
        applyWorldDeltaRotation(spineBone, wobbleRot, 1.0);
      }
    }

    // よろめき方向に水平にのみ押される (Y変化なし)
    const pushForce = bal.staggerIntensity * 0.3 * Math.max(0, t);
    const pushVec = bal.staggerDir.scale(pushForce * dt);
    pushVec.y = 0;
    character.root.position.addInPlace(pushVec);

    if (bal.staggerTimer <= 0) {
      bal.staggered = false;
      bal.staggerIntensity = 0;
    }
  }

  // ─── オフハンド自動バランス補正 ───
  // 重心がずれている方向の逆にオフハンドを移動 → 重心を実際に補正
  if (character.weapon && character.weapon.gripType === 'one-handed'
      && character.ikChains.rightArm.weight > 0 && bal.deviation > BALANCE_CONFIG.offHandCorrectionThreshold) {
    const footCenter = lFoot.add(rFoot).scale(0.5);
    const comOffset = com.subtract(footCenter);
    comOffset.y = 0;

    const restPos = getOffHandRestPosition(character);
    if (restPos) {
      const counterDir = comOffset.scale(-1);
      if (counterDir.length() > 0.01) counterDir.normalize();
      const counterAmount = Math.min(0.3, bal.deviation * 2);
      const balancedPos = restPos.add(counterDir.scale(counterAmount)).add(new Vector3(0, counterAmount * 0.5, 0));

      const current = character.ikChains.rightArm.target;
      Vector3.LerpToRef(current, balancedPos, Math.min(1, 6 * dt), current);

      // オフハンドの補正効果: 左手が動いた分だけ重心逸脱を軽減
      const armWeight = 0.06;
      const balanceEffect = counterAmount * armWeight * 5;
      bal.deviation = Math.max(0, bal.deviation - balanceEffect);

      // よろめき中: 左手の補正でよろめき時間を短縮
      if (bal.staggered && counterAmount > 0.05) {
        bal.staggerTimer -= counterAmount * dt * 2;
        bal.staggerIntensity *= (1 - counterAmount * dt);
      }
    }
  }
}

// ─── Debug Visuals ───────────────────────────────────────

export function createDebugVisuals(scene: Scene, prefix: string): DebugVisuals {
  const comSphere = MeshBuilder.CreateSphere(`${prefix}_com`, { diameter: 0.06 }, scene);
  const comMat = new StandardMaterial(`${prefix}_comMat`, scene);
  comMat.diffuseColor = new Color3(1, 0.2, 0.2);
  comMat.alpha = 0.6;
  comSphere.material = comMat;
  comSphere.isPickable = false;

  return { comSphere, supportLines: null, balanceLine: null, enabled: true };
}

export function updateDebugVisuals(
  scene: Scene,
  debug: DebugVisuals,
  com: Vector3,
  leftFoot: Vector3,
  rightFoot: Vector3,
  prefix: string,
): void {
  if (!debug.enabled) return;

  // CoM sphere
  debug.comSphere.position.copyFrom(com);

  // Support polygon lines
  if (debug.supportLines) debug.supportLines.dispose();
  debug.supportLines = MeshBuilder.CreateLines(`${prefix}_support`, {
    points: [
      new Vector3(leftFoot.x, 0.01, leftFoot.z),
      new Vector3(rightFoot.x, 0.01, rightFoot.z),
    ],
  }, scene);
  (debug.supportLines as unknown as { color: Color3 }).color = new Color3(0, 0.8, 0);

  // Balance line (CoM projected to ground)
  const deviation = getBalanceDeviation(com, leftFoot, rightFoot);
  if (debug.balanceLine) debug.balanceLine.dispose();
  debug.balanceLine = MeshBuilder.CreateLines(`${prefix}_balance`, {
    points: [com, new Vector3(com.x, 0.01, com.z)],
  }, scene);
  (debug.balanceLine as unknown as { color: Color3 }).color = deviation > 0 ? new Color3(1, 0, 0) : new Color3(0, 1, 0);
}

// ─── Foot Horizontal Lock ────────────────────────────────

/**
 * After IK bends the leg, the foot bone rotates with the shin.
 * This resets the foot to its T-pose world orientation (flat on ground).
 */
export function keepFootHorizontal(footBone: TransformNode, tposeWorldRot: Quaternion): void {
  const parent = footBone.parent as TransformNode;
  if (!parent) return;

  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  // localRot = inverse(parentWorldRot) * desiredWorldRot
  footBone.rotationQuaternion = parentInv.multiply(tposeWorldRot);
}
