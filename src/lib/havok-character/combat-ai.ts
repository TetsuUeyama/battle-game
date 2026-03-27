/**
 * Havok Character System — Combat AI: target pursuit, circling, attack, vs character.
 */
import {
  Scene, Vector3, Quaternion, TransformNode, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';
import type {
  HavokCharacter, CombatAI, TargetMover, WeaponPhysics, SwingMotion, SwingType, BodyMotion,
} from './types';
import { neutralBody } from './types';
import { getWorldPos, getCharacterDirections, getStanceTargets, rotateVectorByQuat } from './helpers';
import {
  startSwing, endSwing, updateWeaponInertia, getWeaponTipWorld,
} from './weapon';
import {
  createSwingMotion, updateSwingMotion, applyBodyMotion,
  getWeaponScaleFactors, getPreferredAttackTypes, pickWeightedAttackType,
} from './swing-motion';

/**
 * CombatAI を作成
 */
export function createCombatAI(targetNode: TransformNode, weapon: WeaponPhysics): CombatAI {
  return {
    state: 'idle',
    mode: 'target',
    targetNode,
    targetCharacter: null,
    attackRange: weapon.length * 0.9,
    pursueRange: 5.0,
    walkSpeed: 1.0,
    runSpeed: 2.5,
    runThreshold: 2.0,
    recoverTime: 0.8,
    recoverTimer: 0,
    safeRange: weapon.length * 0.9 + 0.5,
    circleDir: 1,
    circleTimer: 0,
    retreatSpeed: 1.5,
    currentMotion: null,
    attackIndex: 0,
    enabled: false,
    comboRemaining: 0,
    maxCombo: 3,
  };
}

export function createTargetMover(node: TransformNode, center: Vector3, range: number): TargetMover {
  return {
    node,
    waypoint: node.position.clone(),
    speed: 0.8,
    changeTimer: 0,
    changeInterval: 2.0,
    boundsMin: center.add(new Vector3(-range, 0, -range)),
    boundsMax: center.add(new Vector3(range, 0, range)),
  };
}

export function updateTargetMover(mover: TargetMover, dt: number): void {
  mover.changeTimer += dt;
  if (mover.changeTimer >= mover.changeInterval) {
    mover.changeTimer = 0;
    mover.waypoint = new Vector3(
      mover.boundsMin.x + Math.random() * (mover.boundsMax.x - mover.boundsMin.x),
      0,
      mover.boundsMin.z + Math.random() * (mover.boundsMax.z - mover.boundsMin.z),
    );
  }

  const pos = mover.node.position;
  const toWp = mover.waypoint.subtract(pos);
  toWp.y = 0;
  const dist = toWp.length();
  if (dist > 0.05) {
    const dir = toWp.normalize();
    const step = Math.min(dist, mover.speed * dt);
    pos.addInPlace(dir.scale(step));
  }
}

/**
 * CombatAI 更新。毎フレーム呼び出し。
 */
export function updateCombatAI(
  ai: CombatAI,
  character: HavokCharacter,
  dt: number,
): void {
  if (!ai.enabled || !character.weapon) return;

  const targetPos = ai.targetNode.position.clone();
  targetPos.y = 0;
  const charPos = character.root.position.clone();
  charPos.y = 0;

  const toTarget = targetPos.subtract(charPos);
  const dist = toTarget.length();
  const dir = dist > 0.01 ? toTarget.normalize() : Vector3.Forward();

  // ─── キャラクターを標的に向ける ───
  const dirs = getCharacterDirections(character);
  if (dirs) {
    const currentFwd = dirs.forward;
    const targetAngle = Math.atan2(dir.x, dir.z);
    const currentAngle = Math.atan2(currentFwd.x, currentFwd.z);
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turnSpeed = 5.0;
    const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnSpeed * dt);

    if (Math.abs(turnAmount) > 0.0001) {
      const rotDelta = Quaternion.RotationAxis(Vector3.Up(), turnAmount);
      if (character.root.rotationQuaternion) {
        character.root.rotationQuaternion = rotDelta.multiply(character.root.rotationQuaternion);
      } else {
        character.root.rotationQuaternion = rotDelta.multiply(
          Quaternion.FromEulerAngles(character.root.rotation.x, character.root.rotation.y, character.root.rotation.z),
        );
      }

      const rootPos = character.root.position;
      const rotQuat = rotDelta;
      const stepper = character.footStepper;

      for (const foot of [stepper.left, stepper.right]) {
        const rel = foot.planted.subtract(rootPos);
        const rotated = rotateVectorByQuat(rel, rotQuat);
        foot.planted.copyFrom(rootPos.add(rotated));

        if (foot.stepping) {
          const relT = foot.target.subtract(rootPos);
          const rotatedT = rotateVectorByQuat(relT, rotQuat);
          foot.target.copyFrom(rootPos.add(rotatedT));
        }
      }

      if (character.footPlant.leftLocked) {
        character.footPlant.leftLocked.copyFrom(stepper.left.planted);
      }
      if (character.footPlant.rightLocked) {
        character.footPlant.rightLocked.copyFrom(stepper.right.planted);
      }

      character.footBaseWorldRot.left = rotQuat.multiply(character.footBaseWorldRot.left);
      character.footBaseWorldRot.right = rotQuat.multiply(character.footBaseWorldRot.right);
    }
  }

  // ─── 状態遷移 ───
  switch (ai.state) {
    case 'idle': {
      if (dist < ai.pursueRange) {
        ai.state = 'pursue';
      }
      break;
    }

    case 'pursue': {
      if (character.weapon) {
        const stanceNow = getStanceTargets(character, character.weaponSwing.stance, character.weapon);
        character.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
        updateWeaponInertia(character, stanceNow.rightTarget, dt);
      }

      if (dist <= ai.attackRange) {
        ai.state = 'attack';
        const swingType = pickWeightedAttackType(getPreferredAttackTypes(character.weapon.category));
        ai.attackIndex++;
        const power = 60 + Math.random() * 40;
        const hitPos = targetPos.add(new Vector3(0, 1.1, 0));
        ai.currentMotion = createSwingMotion(character, hitPos, swingType, power);
        startSwing(character);
      } else {
        const speed = dist > ai.runThreshold ? ai.runSpeed : ai.walkSpeed;
        const moveAmount = Math.min(dist - ai.attackRange * 0.8, speed * dt);
        if (moveAmount > 0) {
          character.root.position.addInPlace(dir.scale(moveAmount));
        }
      }
      break;
    }

    case 'attack': {
      if (ai.currentMotion && ai.currentMotion.active) {
        const frame = updateSwingMotion(ai.currentMotion, dt, character.root.position);
        if (frame) {
          character.ikChains.leftArm.target.copyFrom(frame.handTarget);
          character.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
          if (dirs) {
            applyBodyMotion(character, frame.body, dirs.forward, dirs.charRight);
          }
        }
      }
      if (!ai.currentMotion || !ai.currentMotion.active) {
        ai.state = 'recover';
        ai.recoverTimer = ai.recoverTime;
        ai.currentMotion = null;
        endSwing(character);
        const spine = character.allBones.get('mixamorig:Spine1');
        if (spine) {
          const baseRot = character.ikBaseRotations.get(spine.name);
          if (baseRot) spine.rotationQuaternion = baseRot.root.clone();
        }
      }
      break;
    }

    case 'recover': {
      if (character.weapon) {
        const stanceNow = getStanceTargets(character, character.weaponSwing.stance, character.weapon);
        character.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
        updateWeaponInertia(character, stanceNow.rightTarget, dt);
      }
      ai.recoverTimer -= dt;
      if (ai.recoverTimer <= 0) {
        ai.state = 'pursue';
      }
      break;
    }
  }
}

// ─── Weapon Clash Reaction ───────────────────────────────

import type { ClashState } from './types';

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
    if (spineBone) {
      const baseRot = character.ikBaseRotations.get(spineBone.name);
      if (baseRot) spineBone.rotationQuaternion = baseRot.root.clone();
    }
  }
}

// ─── Character vs Character Combat ───────────────────────

export function createCombatAIvsCharacter(
  targetCharacter: HavokCharacter,
  weapon: WeaponPhysics,
): CombatAI {
  const armReach = 0.5;
  const lungeReach = 0.25;
  const atkRange = weapon.length + armReach + lungeReach;
  // 軽い武器ほどコンボ数が多い (1kg→3回, 5kg→2回, 10kg→1回)
  const combo = Math.max(1, Math.round(4 - weapon.weight * 0.3));
  return {
    state: 'idle',
    mode: 'character',
    targetNode: targetCharacter.root,
    targetCharacter,
    attackRange: atkRange,
    pursueRange: 8.0,
    walkSpeed: 1.0,
    runSpeed: 2.5,
    runThreshold: 3.0,
    recoverTime: 0.6,
    recoverTimer: 0,
    safeRange: atkRange + 0.5,
    circleDir: Math.random() > 0.5 ? 1 : -1,
    circleTimer: 0,
    retreatSpeed: 1.5,
    currentMotion: null,
    attackIndex: Math.floor(Math.random() * 3),
    enabled: false,
    comboRemaining: 0,
    maxCombo: combo,
  };
}

export function updateCombatAIvsCharacter(
  ai: CombatAI,
  character: HavokCharacter,
  scene: Scene,
  dt: number,
): { hit: boolean; damage: number } {
  if (!ai.enabled || !character.weapon || !ai.targetCharacter) return { hit: false, damage: 0 };

  const opponent = ai.targetCharacter;
  const targetPos = opponent.root.position.clone();
  targetPos.y = 0;
  const charPos = character.root.position.clone();
  charPos.y = 0;

  const toTarget = targetPos.subtract(charPos);
  const dist = toTarget.length();
  const dir = dist > 0.01 ? toTarget.normalize() : Vector3.Forward();

  // ─── キャラクターを相手に向ける ───
  const dirs = getCharacterDirections(character);
  if (dirs) {
    const currentFwd = dirs.forward;
    const targetAngle = Math.atan2(dir.x, dir.z);
    const currentAngle = Math.atan2(currentFwd.x, currentFwd.z);
    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turnSpeed = 5.0;
    const turnAmount = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turnSpeed * dt);

    if (Math.abs(turnAmount) > 0.0001) {
      const rotDelta = Quaternion.RotationAxis(Vector3.Up(), turnAmount);
      if (character.root.rotationQuaternion) {
        character.root.rotationQuaternion = rotDelta.multiply(character.root.rotationQuaternion);
      } else {
        character.root.rotationQuaternion = rotDelta.multiply(
          Quaternion.FromEulerAngles(character.root.rotation.x, character.root.rotation.y, character.root.rotation.z),
        );
      }

      const rootPos = character.root.position;
      const stepper = character.footStepper;
      for (const foot of [stepper.left, stepper.right]) {
        const rel = foot.planted.subtract(rootPos);
        const rotated = rotateVectorByQuat(rel, rotDelta);
        foot.planted.copyFrom(rootPos.add(rotated));
        if (foot.stepping) {
          const relT = foot.target.subtract(rootPos);
          foot.target.copyFrom(rootPos.add(rotateVectorByQuat(relT, rotDelta)));
        }
      }
      if (character.footPlant.leftLocked) character.footPlant.leftLocked.copyFrom(stepper.left.planted);
      if (character.footPlant.rightLocked) character.footPlant.rightLocked.copyFrom(stepper.right.planted);
      character.footBaseWorldRot.left = rotDelta.multiply(character.footBaseWorldRot.left);
      character.footBaseWorldRot.right = rotDelta.multiply(character.footBaseWorldRot.right);
    }
  }

  let hitResult = { hit: false, damage: 0 };

  if (character.weapon && ai.state !== 'attack') {
    const stanceNow = getStanceTargets(character, character.weaponSwing.stance, character.weapon);
    character.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
    updateWeaponInertia(character, stanceNow.rightTarget, dt);
  }

  // ─── 状態遷移 ───
  switch (ai.state) {
    case 'idle': {
      if (dist < ai.pursueRange) {
        ai.state = 'pursue';
      }
      break;
    }

    case 'pursue': {
      if (dist <= ai.safeRange) {
        ai.state = 'circle';
        ai.circleTimer = 1.0 + Math.random() * 1.5;
        ai.circleDir = Math.random() > 0.5 ? 1 : -1;
      } else {
        const speed = dist > ai.runThreshold ? ai.runSpeed : ai.walkSpeed;
        const moveAmount = Math.min(dist - ai.safeRange, speed * dt);
        if (moveAmount > 0) {
          character.root.position.addInPlace(dir.scale(moveAmount));
        }
      }
      break;
    }

    case 'circle': {
      ai.circleTimer -= dt;

      const distError = dist - ai.safeRange;
      if (Math.abs(distError) > 0.2) {
        const adjustSpeed = 0.8;
        character.root.position.addInPlace(dir.scale(Math.sign(distError) * adjustSpeed * dt));
      }

      if (dirs) {
        const strafeDir = dirs.charRight.scale(ai.circleDir);
        character.root.position.addInPlace(strafeDir.scale(0.6 * dt));
      }

      if (ai.circleTimer <= 0) {
        ai.state = 'close_in';
      }
      break;
    }

    case 'close_in': {
      if (dist <= ai.attackRange) {
        ai.state = 'attack';
        // コンボ開始: maxCombo回の連続攻撃 (ランダムで1〜maxCombo)
        ai.comboRemaining = 1 + Math.floor(Math.random() * ai.maxCombo);
        const preferredType = pickWeightedAttackType(getPreferredAttackTypes(character.weapon.category));
        ai.attackIndex++;
        const power = 60 + Math.random() * 40;

        const sf = getWeaponScaleFactors(character.weapon);
        const bc = sf.bodyCommitment;
        const gc = sf.gripCommitment;
        const rs = sf.reachScale;

        const targetBones = ['head', 'torso', 'hips'];
        const targetBoneName = targetBones[Math.floor(Math.random() * targetBones.length)];
        const targetBone = opponent.combatBones.get(targetBoneName);
        const hitPos = targetBone ? getWorldPos(targetBone) : opponent.root.position.add(new Vector3(0, 1.0, 0));

        const attackDir = dir;
        const handStrikePos = hitPos.subtract(attackDir.scale(character.weapon.length * 0.6));

        const attackerHead = character.combatBones.get('head');
        const attackerHips = character.combatBones.get('hips');
        const headPos = attackerHead ? getWorldPos(attackerHead) : character.root.position.add(new Vector3(0, 1.5, 0));
        const hipsPos = attackerHips ? getWorldPos(attackerHips) : character.root.position.add(new Vector3(0, 1.0, 0));
        const handPos = character.weaponSwing.baseHandPos.clone();

        let windupPos: Vector3;
        const p = power / 100;
        const fwd = dirs?.forward ?? attackDir;
        const right = dirs?.charRight ?? Vector3.Right();

        switch (preferredType) {
          case 'vertical':
            windupPos = headPos.add(new Vector3(0, 0.15 * p * rs, 0)).add(fwd.scale(-0.1 * p * rs)).add(right.scale(0.05));
            break;
          case 'horizontal':
            windupPos = handPos.add(right.scale(0.4 * p * rs)).add(new Vector3(0, 0.1 * p * rs, 0));
            break;
          default:
            windupPos = handPos.add(fwd.scale(-0.2 * p * rs));
            break;
        }

        const rootPos = character.root.position.clone();
        const baseDuration = 0.4 + (1.0 - p) * 0.1;

        let windupBody: BodyMotion, strikeBody: BodyMotion;
        switch (preferredType) {
          case 'vertical':
            windupBody = { torsoLean: -0.25*p*bc*gc, torsoTwist: 0.15*p*bc*gc, hipsOffset: 0.03*p*bc, hipsForward: -0.08*p*bc, footStepR: -0.1*p*bc, offHandOffset: new Vector3(-0.05*p*bc, 0.1*p*bc, -0.05*p*bc) };
            strikeBody = { torsoLean: 0.5*p*bc*gc, torsoTwist: -0.1*p*bc*gc, hipsOffset: -0.12*p*bc, hipsForward: 0.2*p*bc, footStepR: 0.25*p*bc, offHandOffset: new Vector3(0.1*p*bc, -0.1*p*bc, 0.05*p*bc) };
            break;
          case 'horizontal':
            windupBody = {
              torsoLean: -0.1*p*bc*gc, torsoTwist: 0.8*p*bc*gc, hipsOffset: 0.02*p*bc,
              hipsForward: -0.05*p*bc, footStepR: 0.12*p*bc,
              offHandOffset: new Vector3(-0.2*p*bc, 0.08*p*bc, -0.15*p*bc),
            };
            strikeBody = {
              torsoLean: 0.2*p*bc*gc, torsoTwist: -0.8*p*bc*gc, hipsOffset: -0.06*p*bc,
              hipsForward: 0.1*p*bc, footStepR: -0.1*p*bc,
              offHandOffset: new Vector3(0.25*p*bc, -0.08*p*bc, 0.2*p*bc),
            };
            break;
          default:
            windupBody = { torsoLean: -0.15*p*bc*gc, torsoTwist: 0.15*p*bc*gc, hipsOffset: 0.03*p*bc, hipsForward: -0.15*p*bc, footStepR: -0.12*p*bc, offHandOffset: new Vector3(-0.08*p*bc, 0.05*p*bc, -0.1*p*bc) };
            strikeBody = { torsoLean: 0.35*p*bc*gc, torsoTwist: -0.1*p*bc*gc, hipsOffset: -0.06*p*bc, hipsForward: 0.25*p*bc, footStepR: 0.3*p*bc, offHandOffset: new Vector3(0.05*p*bc, -0.08*p*bc, 0) };
            break;
        }

        const motionBase: SwingMotion = {
          type: preferredType,
          progress: 0,
          duration: baseDuration * sf.durationScale,
          windupRatio: 0.35 + p * 0.1,
          startPos: handPos,
          windupPos,
          strikePos: handStrikePos,
          active: true,
          power: p,
          windupBody, strikeBody,
          startOffset: handPos.subtract(rootPos),
          windupOffset: windupPos.subtract(rootPos),
          strikeOffset: handStrikePos.subtract(rootPos),
          rootPosAtStart: rootPos,
        };

        if (preferredType === 'horizontal') {
          const spineBone = character.combatBones.get('torso');
          const spinePos = spineBone ? getWorldPos(spineBone) : rootPos.add(new Vector3(0, 1.2, 0));
          const spineOffset = spinePos.subtract(rootPos);

          const armLen = character.ikChains.leftArm.lengthA + character.ikChains.leftArm.lengthB;

          const maxAngle = Math.min(Math.PI * 0.6, (Math.PI * 0.39) * p * sf.arcScale);
          motionBase.arcSwing = {
            centerOffset: spineOffset,
            radius: armLen,
            windupAngle: maxAngle,
            strikeAngle: -maxAngle,
            height: spineOffset.y,
          };
        }

        ai.currentMotion = motionBase;
        startSwing(character);
      } else {
        const dashSpeed = ai.runSpeed * 1.2;
        const moveAmount = Math.min(dist - ai.attackRange * 0.8, dashSpeed * dt);
        if (moveAmount > 0) {
          character.root.position.addInPlace(dir.scale(moveAmount));
        }
        if (dist > ai.safeRange + 1.0) {
          ai.state = 'pursue';
        }
      }
      break;
    }

    case 'attack': {
      if (ai.currentMotion && ai.currentMotion.active) {
        const frame = updateSwingMotion(ai.currentMotion, dt, character.root.position);
        if (frame) {
          character.ikChains.leftArm.target.copyFrom(frame.handTarget);
          character.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
          if (dirs) {
            applyBodyMotion(character, frame.body, dirs.forward, dirs.charRight);
          }
        }

        if (ai.currentMotion.progress > ai.currentMotion.windupRatio) {
          const tipWorld = getWeaponTipWorld(character);
          // 複数ボーンに対してヒット判定 (torso, head, hips)
          const hitTargets = ['torso', 'head', 'hips'];
          const hitRadius = 0.35 + character.weapon.length * 0.1; // 武器長に応じて判定拡大
          for (const boneName of hitTargets) {
            const bone = opponent.combatBones.get(boneName);
            if (!bone) continue;
            const bonePos = getWorldPos(bone);
            const tipDist = Vector3.Distance(tipWorld, bonePos);
            if (tipDist < hitRadius) {
              const boneMul = boneName === 'head' ? 1.5 : boneName === 'hips' ? 0.8 : 1.0;
              hitResult = { hit: true, damage: Math.floor((character.weaponSwing.power * 5 + 5) * boneMul) };
              ai.currentMotion.active = false;
              break;
            }
          }
        }
      }
      if (!ai.currentMotion || !ai.currentMotion.active) {
        endSwing(character);
        ai.comboRemaining--;

        // コンボ継続: 残り回数があり、射程内なら次の振りを即開始
        if (ai.comboRemaining > 0 && dist <= ai.attackRange * 1.3) {
          const nextType = pickWeightedAttackType(getPreferredAttackTypes(character.weapon.category));
          const nextPower = 50 + Math.random() * 50; // コンボ後半は少しバラつき
          const sf = getWeaponScaleFactors(character.weapon);
          const bc = sf.bodyCommitment;
          const gc = sf.gripCommitment;
          const rs = sf.reachScale;
          const p = nextPower / 100;

          // 相手ボーンをターゲット
          const targetBones = ['head', 'torso', 'hips'];
          const targetBoneName = targetBones[Math.floor(Math.random() * targetBones.length)];
          const targetBone = opponent.combatBones.get(targetBoneName);
          const hitPos = targetBone ? getWorldPos(targetBone) : opponent.root.position.add(new Vector3(0, 1.0, 0));
          const handStrikePos = hitPos.subtract(dir.scale(character.weapon.length * 0.6));

          // 構え位置を更新してから次のスイング
          const stanceNow = getStanceTargets(character, character.weaponSwing.stance, character.weapon);
          character.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
          const handPos = stanceNow.rightTarget.clone();

          const fwd = dirs?.forward ?? dir;
          const right = dirs?.charRight ?? Vector3.Right();
          const headBone = character.combatBones.get('head');
          const headPos = headBone ? getWorldPos(headBone) : character.root.position.add(new Vector3(0, 1.5, 0));

          let windupPos: Vector3;
          switch (nextType) {
            case 'vertical':
              windupPos = headPos.add(new Vector3(0, 0.15 * p * rs, 0)).add(fwd.scale(-0.1 * p * rs)).add(right.scale(0.05));
              break;
            case 'horizontal':
              windupPos = handPos.add(right.scale(0.4 * p * rs)).add(new Vector3(0, 0.1 * p * rs, 0));
              break;
            default:
              windupPos = handPos.add(fwd.scale(-0.2 * p * rs));
              break;
          }

          const rootPos = character.root.position.clone();
          const baseDuration = (0.35 + (1.0 - p) * 0.08) * sf.durationScale; // コンボ後続は少し速い

          let windupBody: BodyMotion, strikeBody: BodyMotion;
          switch (nextType) {
            case 'vertical':
              windupBody = { torsoLean: -0.25*p*bc*gc, torsoTwist: 0.15*p*bc*gc, hipsOffset: 0.03*p*bc, hipsForward: -0.08*p*bc, footStepR: -0.1*p*bc, offHandOffset: new Vector3(-0.05*p*bc, 0.1*p*bc, -0.05*p*bc) };
              strikeBody = { torsoLean: 0.5*p*bc*gc, torsoTwist: -0.1*p*bc*gc, hipsOffset: -0.12*p*bc, hipsForward: 0.2*p*bc, footStepR: 0.25*p*bc, offHandOffset: new Vector3(0.1*p*bc, -0.1*p*bc, 0.05*p*bc) };
              break;
            case 'horizontal':
              windupBody = { torsoLean: -0.1*p*bc*gc, torsoTwist: 0.8*p*bc*gc, hipsOffset: 0.02*p*bc, hipsForward: -0.05*p*bc, footStepR: 0.12*p*bc, offHandOffset: new Vector3(-0.2*p*bc, 0.08*p*bc, -0.15*p*bc) };
              strikeBody = { torsoLean: 0.2*p*bc*gc, torsoTwist: -0.8*p*bc*gc, hipsOffset: -0.06*p*bc, hipsForward: 0.1*p*bc, footStepR: -0.1*p*bc, offHandOffset: new Vector3(0.25*p*bc, -0.08*p*bc, 0.2*p*bc) };
              break;
            default:
              windupBody = { torsoLean: -0.15*p*bc*gc, torsoTwist: 0.15*p*bc*gc, hipsOffset: 0.03*p*bc, hipsForward: -0.15*p*bc, footStepR: -0.12*p*bc, offHandOffset: new Vector3(-0.08*p*bc, 0.05*p*bc, -0.1*p*bc) };
              strikeBody = { torsoLean: 0.35*p*bc*gc, torsoTwist: -0.1*p*bc*gc, hipsOffset: -0.06*p*bc, hipsForward: 0.25*p*bc, footStepR: 0.3*p*bc, offHandOffset: new Vector3(0.05*p*bc, -0.08*p*bc, 0) };
              break;
          }

          const nextMotion: SwingMotion = {
            type: nextType,
            progress: 0,
            duration: baseDuration,
            windupRatio: 0.3 + p * 0.1, // コンボ後続は振りかぶり短め
            startPos: handPos,
            windupPos,
            strikePos: handStrikePos,
            active: true,
            power: p,
            windupBody, strikeBody,
            startOffset: handPos.subtract(rootPos),
            windupOffset: windupPos.subtract(rootPos),
            strikeOffset: handStrikePos.subtract(rootPos),
            rootPosAtStart: rootPos,
          };

          if (nextType === 'horizontal') {
            const spineBone = character.combatBones.get('torso');
            const spinePos = spineBone ? getWorldPos(spineBone) : rootPos.add(new Vector3(0, 1.2, 0));
            const spineOffset = spinePos.subtract(rootPos);
            const armLen = character.ikChains.leftArm.lengthA + character.ikChains.leftArm.lengthB;
            const maxAngle = Math.min(Math.PI * 0.6, (Math.PI * 0.39) * p * sf.arcScale);
            nextMotion.arcSwing = {
              centerOffset: spineOffset, radius: armLen,
              windupAngle: maxAngle, strikeAngle: -maxAngle, height: spineOffset.y,
            };
          }

          ai.currentMotion = nextMotion;
          startSwing(character);
        } else {
          // コンボ終了 → retreat
          ai.state = 'retreat';
          ai.recoverTimer = 0.5 + Math.random() * 0.5;
          ai.currentMotion = null;
          ai.comboRemaining = 0;
          const spine = character.allBones.get('mixamorig:Spine1');
          if (spine) {
            const baseRot = character.ikBaseRotations.get(spine.name);
            if (baseRot) spine.rotationQuaternion = baseRot.root.clone();
          }
        }
      }
      break;
    }

    case 'retreat': {
      ai.recoverTimer -= dt;
      if (dist < ai.safeRange && ai.recoverTimer > 0) {
        character.root.position.addInPlace(dir.scale(-ai.retreatSpeed * dt));
      } else {
        ai.state = 'recover';
        ai.recoverTimer = 0.3 + Math.random() * 0.3;
      }
      break;
    }

    case 'recover': {
      ai.recoverTimer -= dt;
      if (ai.recoverTimer <= 0) {
        ai.state = 'circle';
        ai.circleTimer = 0.8 + Math.random() * 1.2;
        ai.circleDir = Math.random() > 0.5 ? 1 : -1;
      }
      break;
    }
  }

  return hitResult;
}
