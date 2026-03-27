/**
 * Havok Character System — Core character lifecycle: init, create, update, scale, teleport.
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion,
} from '@babylonjs/core';
import { PhysicsBody, PhysicsMotionType, PhysicsShapeCapsule } from '@babylonjs/core/Physics/v2';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import type { HavokCharacter, BoneDataFile, FootStep, CreateCharacterOptions } from './types';
import {
  createJumpState, createBalanceState, createWeaponSwingState,
  BODY_PARTS, COMBAT_BONE_MAP, BONE_DATA_URL, PALM_OFFSET,
} from './types';
import {
  eulerDegreesToQuat, getWorldPos, getCharacterDirections, getOffHandRestPosition,
  rotateVectorByQuat,
} from './helpers';
import { solveIK2Bone, clampJointAngles, createIKChains } from './ik-solver';
import {
  initFootPlanting, updateFootStepping, calculateCenterOfMass,
  createDebugVisuals, updateDebugVisuals, keepFootHorizontal,
} from './foot-planting';
import { updateWeaponPower, getWeaponTipWorld } from './weapon';

// ─── Havok Initialization ────────────────────────────────

let _havokPlugin: HavokPlugin | null = null;

export async function initHavok(scene: Scene): Promise<HavokPlugin> {
  if (_havokPlugin) return _havokPlugin;
  const HavokPhysics = (await import('@babylonjs/havok')).default;
  const havokInstance = await HavokPhysics();
  _havokPlugin = new HavokPlugin(true, havokInstance);
  scene.enablePhysics(new Vector3(0, -9.81, 0), _havokPlugin);
  return _havokPlugin;
}

// ─── Skeleton Builder ────────────────────────────────────

async function loadBoneData(): Promise<BoneDataFile> {
  const res = await fetch(BONE_DATA_URL);
  if (!res.ok) throw new Error(`Failed to load bone-data: ${res.status}`);
  return res.json();
}

function buildSkeleton(
  scene: Scene,
  boneData: BoneDataFile,
  root: TransformNode,
  prefix: string,
): Map<string, TransformNode> {
  const allBones = new Map<string, TransformNode>();
  const scale = boneData.globalSettings.unitScaleFactor / 100; // cm → m

  for (const entry of boneData.bones) {
    const node = new TransformNode(`${prefix}_${entry.name}`, scene);

    // Parent
    if (entry.parent) {
      const parentNode = allBones.get(entry.parent);
      if (parentNode) node.parent = parentNode;
      else node.parent = root;
    } else {
      node.parent = root;
    }

    // Local position (cm → m)
    node.position.set(
      entry.localPosition[0] * scale,
      entry.localPosition[1] * scale,
      entry.localPosition[2] * scale,
    );

    // PreRotation * LclRotation
    const pre = eulerDegreesToQuat(entry.preRotation[0], entry.preRotation[1], entry.preRotation[2]);
    const lcl = eulerDegreesToQuat(entry.localRotation[0], entry.localRotation[1], entry.localRotation[2]);
    node.rotationQuaternion = pre.multiply(lcl);

    allBones.set(entry.name, node);
  }

  return allBones;
}

// ─── Voxel Body Meshes ──────────────────────────────────

function createBodyMeshes(
  scene: Scene,
  allBones: Map<string, TransformNode>,
  bodyColor: Color3,
  prefix: string,
): Map<string, Mesh> {
  const bodyMeshes = new Map<string, Mesh>();

  const bodyMat = new StandardMaterial(`${prefix}_bodyMat`, scene);
  bodyMat.diffuseColor = bodyColor;
  bodyMat.specularColor = new Color3(0.2, 0.2, 0.2);
  bodyMat.freeze();

  const skinMat = new StandardMaterial(`${prefix}_skinMat`, scene);
  skinMat.diffuseColor = new Color3(0.9, 0.75, 0.6);
  skinMat.specularColor = new Color3(0.15, 0.15, 0.15);
  skinMat.freeze();

  for (const [partName, def] of Object.entries(BODY_PARTS)) {
    const bone = allBones.get(def.bone);
    const childBone = allBones.get(def.childBone);
    if (!bone || !childBone) continue;

    // Child's local position gives the bone direction and length
    const childLocalPos = childBone.position.clone();
    const boneLength = childLocalPos.length();
    if (boneLength < 0.001) continue;

    // Determine cross-section size
    let crossW: number, crossD: number;
    if (def.thickness > 0) {
      crossW = def.thickness;
      crossD = def.thickness;
    } else {
      crossW = def.size[0];
      crossD = def.size[2];
    }
    const h = (def.size[1] > 0) ? def.size[1] : boneLength;

    // Create box with height along Y
    const mesh = MeshBuilder.CreateBox(
      `${prefix}_body_${partName}`,
      { width: crossW, height: h, depth: crossD },
      scene,
    );
    mesh.material = def.skin ? skinMat : bodyMat;
    mesh.parent = bone;

    // Align mesh Y-axis to the bone direction (child local position).
    const boneDir = childLocalPos.normalize();
    const up = Vector3.Up();

    // Offset: center the box along the bone direction
    const halfLen = boneLength / 2;
    mesh.position.set(boneDir.x * halfLen, boneDir.y * halfLen, boneDir.z * halfLen);

    // Rotation: align box Y-axis to bone direction
    const dot = Vector3.Dot(up, boneDir);
    if (Math.abs(dot) < 0.9999) {
      const axis = Vector3.Cross(up, boneDir).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      mesh.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
    } else if (dot < 0) {
      mesh.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), Math.PI);
    }

    bodyMeshes.set(partName, mesh);
  }

  return bodyMeshes;
}

// ─── Physics Capsule ─────────────────────────────────────

function createPhysicsCapsule(
  scene: Scene,
  root: TransformNode,
  prefix: string,
  enablePhysics: boolean,
): { body: PhysicsBody | null; mesh: Mesh } {
  const height = 1.6;
  const radius = 0.25;

  const mesh = MeshBuilder.CreateCapsule(`${prefix}_capsule`, { height, radius }, scene);
  mesh.parent = root;
  mesh.position.y = height / 2;
  mesh.isVisible = false;
  mesh.isPickable = false;

  let body: PhysicsBody | null = null;
  if (enablePhysics) {
    const shape = new PhysicsShapeCapsule(
      new Vector3(0, radius, 0),
      new Vector3(0, height - radius, 0),
      radius, scene,
    );
    body = new PhysicsBody(mesh, PhysicsMotionType.DYNAMIC, false, scene);
    body.shape = shape;
    body.setMassProperties({ mass: 70 });
    body.setAngularDamping(1000);
  }

  return { body, mesh };
}

// ─── Jump System ─────────────────────────────────────────

/**
 * ジャンプ開始
 */
export function startJump(character: HavokCharacter): void {
  const jump = character.jumpState;
  if (jump.active) return; // 二重ジャンプ防止
  jump.active = true;
  jump.velocityY = jump.jumpVelocity;
}

/**
 * ジャンプ更新。毎フレーム呼び出し。
 */
export function updateJump(character: HavokCharacter, dt: number): void {
  const jump = character.jumpState;
  if (!jump.active) return;

  jump.velocityY -= jump.gravity * dt;
  jump.heightOffset += jump.velocityY * dt;

  if (jump.heightOffset <= 0) {
    jump.heightOffset = 0;
    jump.velocityY = 0;
    jump.active = false;
  }

  character.root.position.y = jump.heightOffset;

  if (jump.active && jump.heightOffset > 0.05) {
    const chains = character.ikChains;
    const groundY = character.initialFootY.left;
    const airFootY = groundY + jump.heightOffset - 0.05;
    chains.leftLeg.target.y = Math.max(groundY, airFootY);
    chains.rightLeg.target.y = Math.max(groundY, airFootY);
  }
}

// ─── Main: Create HavokCharacter ─────────────────────────

export async function createHavokCharacter(
  scene: Scene,
  options: CreateCharacterOptions,
): Promise<HavokCharacter> {
  const { bodyColor, prefix, position, enablePhysics = true, enableDebug = true } = options;

  // Root
  const root = new TransformNode(`${prefix}_root`, scene);
  if (position) root.position.copyFrom(position);

  // Load and build skeleton
  const boneData = await loadBoneData();
  const allBones = buildSkeleton(scene, boneData, root, prefix);

  // Map combat bones
  const combatBones = new Map<string, TransformNode>();
  for (const [shortName, mixamoName] of Object.entries(COMBAT_BONE_MAP)) {
    const bone = allBones.get(mixamoName);
    if (bone) combatBones.set(shortName, bone);
  }

  // Body meshes (uses allBones for precise bone-length measurement)
  const bodyMeshes = createBodyMeshes(scene, allBones, bodyColor, prefix);

  // ─── Weapon attach points ───
  const weaponAttachR = new TransformNode(`${prefix}_weaponR`, scene);
  const visualRightHand = combatBones.get('leftHand'); // Mixamo Left = 画面右手
  if (visualRightHand) { weaponAttachR.parent = visualRightHand; weaponAttachR.position.set(0, 0.064, 0.035); }

  const weaponAttachL = new TransformNode(`${prefix}_weaponL`, scene);
  const visualLeftHand = combatBones.get('rightHand'); // Mixamo Right = 画面左手
  if (visualLeftHand) { weaponAttachL.parent = visualLeftHand; weaponAttachL.position.set(0, 0.064, 0.035); }

  // 手のひらデバッグ球
  const palmMarkerMat = new StandardMaterial(`${prefix}_palmMarkerMat`, scene);
  palmMarkerMat.diffuseColor = new Color3(1, 0.2, 0.8);
  palmMarkerMat.alpha = 0.8;

  const palmMarkerPositions: { hand: TransformNode | undefined; localPos: [number, number, number] }[] = [
    { hand: allBones.get('mixamorig:LeftHand'), localPos: [-0.028, 0.100, 0.025] },
    { hand: allBones.get('mixamorig:LeftHand'), localPos: [0.022, 0.098, 0.025] },
    { hand: allBones.get('mixamorig:RightHand'), localPos: [0.028, 0.100, 0.025] },
    { hand: allBones.get('mixamorig:RightHand'), localPos: [-0.022, 0.098, 0.025] },
  ];

  for (const { hand, localPos } of palmMarkerPositions) {
    if (!hand) continue;
    const sphere = MeshBuilder.CreateSphere(`${prefix}_palmMark`, { diameter: 0.015 }, scene);
    sphere.material = palmMarkerMat;
    sphere.parent = hand;
    sphere.position.set(localPos[0], localPos[1], localPos[2]);
  }

  // Physics capsule
  const { body: physicsBody, mesh: physicsMesh } = createPhysicsCapsule(scene, root, prefix, enablePhysics);

  // IK chains
  const ikChains = createIKChains(allBones);

  // Foot planting state (legacy, kept for init)
  const footPlant = { leftLocked: null as Vector3 | null, rightLocked: null as Vector3 | null };

  // Foot stepping system
  const mkStep = (): FootStep => ({
    planted: Vector3.Zero(),
    target: Vector3.Zero(),
    stepping: false,
    progress: 0,
    liftPos: Vector3.Zero(),
  });
  const footStepper = {
    left: mkStep(),
    right: mkStep(),
    stepThreshold: 0.15,
    stepHeight: 0.08,
    stepDuration: 0.2,
    stanceHalfWidth: 0.1,
  };

  // Debug
  const debug = enableDebug ? createDebugVisuals(scene, prefix) : {
    comSphere: MeshBuilder.CreateSphere(`${prefix}_com_hidden`, { diameter: 0.01 }, scene),
    supportLines: null, balanceLine: null, enabled: false,
  };
  if (!enableDebug) debug.comSphere.isVisible = false;

  // Clear module-level caches (prevents stale data from hot reloads)
  _baseBonePositions.clear();

  const character: HavokCharacter = {
    root, allBones, combatBones, bodyMeshes,
    weaponAttachR, weaponAttachL,
    physicsBody, physicsMesh,
    ikChains, footPlant, footStepper, jumpState: createJumpState(), balance: createBalanceState(), debug,
    ikBaseRotations: new Map(),
    initialFootY: { left: 0, right: 0 },
    hipsBaseY: 0,
    footBaseWorldRot: { left: Quaternion.Identity(), right: Quaternion.Identity() },
    weapon: null,
    weaponSwing: createWeaponSwingState(),
    weaponMesh: null,
  };

  // Store T-pose rotations for IK (must be done before any IK runs)
  for (const chain of [ikChains.leftLeg, ikChains.rightLeg, ikChains.leftArm, ikChains.rightArm]) {
    character.ikBaseRotations.set(chain.root.name, {
      root: (chain.root.rotationQuaternion ?? Quaternion.Identity()).clone(),
      mid: (chain.mid.rotationQuaternion ?? Quaternion.Identity()).clone(),
    });
  }

  // Store T-pose foot world rotations (for keeping feet flat after IK)
  const lFootBone = allBones.get('mixamorig:LeftFoot');
  const rFootBone = allBones.get('mixamorig:RightFoot');
  if (lFootBone) {
    lFootBone.computeWorldMatrix(true);
    character.footBaseWorldRot.left = Quaternion.FromRotationMatrix(
      lFootBone.getWorldMatrix().getRotationMatrix(),
    ).clone();
  }
  if (rFootBone) {
    rFootBone.computeWorldMatrix(true);
    character.footBaseWorldRot.right = Quaternion.FromRotationMatrix(
      rFootBone.getWorldMatrix().getRotationMatrix(),
    ).clone();
  }

  // Initialize foot planting (uses bone-data.json worldPositions for reliable targets)
  initFootPlanting(character, boneData);

  return character;
}

// ─── Bone Scaling ────────────────────────────────────────

const _baseBonePositions = new Map<string, Map<string, Vector3>>();

function ensureBasePositions(character: HavokCharacter): Map<string, Vector3> {
  const key = character.root.name;
  if (!_baseBonePositions.has(key)) {
    const base = new Map<string, Vector3>();
    for (const [name, bone] of character.allBones) {
      base.set(name, bone.position.clone());
    }
    _baseBonePositions.set(key, base);
  }
  return _baseBonePositions.get(key)!;
}

export function scaleBones(character: HavokCharacter, factor: number): void {
  const base = ensureBasePositions(character);
  for (const [name, bone] of character.allBones) {
    const basePos = base.get(name);
    if (basePos) {
      bone.position.set(basePos.x * factor, basePos.y * factor, basePos.z * factor);
    }
  }

  const initFY = character.initialFootY;
  const chains = character.ikChains;
  const fp = character.footPlant;

  character.root.computeWorldMatrix(true);
  for (const bone of character.allBones.values()) bone.computeWorldMatrix(true);

  const lFoot = chains.leftLeg.end.getAbsolutePosition().clone();
  const rFoot = chains.rightLeg.end.getAbsolutePosition().clone();

  fp.leftLocked = new Vector3(lFoot.x, initFY.left * factor, lFoot.z);
  fp.rightLocked = new Vector3(rFoot.x, initFY.right * factor, rFoot.z);
  chains.leftLeg.target.copyFrom(fp.leftLocked);
  chains.rightLeg.target.copyFrom(fp.rightLocked);

  for (const chain of [chains.leftLeg, chains.rightLeg, chains.leftArm, chains.rightArm]) {
    chain.root.computeWorldMatrix(true);
    chain.mid.computeWorldMatrix(true);
    chain.end.computeWorldMatrix(true);
    chain.lengthA = Vector3.Distance(chain.root.getAbsolutePosition().clone(), chain.mid.getAbsolutePosition().clone());
    chain.lengthB = Vector3.Distance(chain.mid.getAbsolutePosition().clone(), chain.end.getAbsolutePosition().clone());
  }
}

export function rebuildBodyMeshes(
  scene: Scene, character: HavokCharacter, bodyColor: Color3, prefix: string,
): void {
  for (const mesh of character.bodyMeshes.values()) {
    mesh.dispose();
  }
  character.bodyMeshes.clear();

  const newMeshes = createBodyMeshes(scene, character.allBones, bodyColor, prefix);
  for (const [name, mesh] of newMeshes) {
    character.bodyMeshes.set(name, mesh);
  }
}

// ─── Per-Frame Update ────────────────────────────────────

export function updateHavokCharacter(scene: Scene, character: HavokCharacter, dt?: number): void {
  const deltaTime = dt ?? (1 / 60);

  // Jump update
  updateJump(character, deltaTime);

  // 地面に固定 (ジャンプ中以外)
  if (!character.jumpState.active) {
    character.root.position.y = 0;
  }

  // Foot stepping
  if (!character.jumpState.active) {
    updateFootStepping(character, deltaTime);
  }

  // ポールヒントをキャラの向きに合わせて更新
  const charDirs = getCharacterDirections(character);
  const chains = character.ikChains;
  if (charDirs) {
    chains.leftLeg.poleHint.copyFrom(charDirs.forward);
    chains.rightLeg.poleHint.copyFrom(charDirs.forward);
    const backward = charDirs.forward.scale(-1);
    chains.leftArm.poleHint.copyFrom(backward);
    chains.rightArm.poleHint.copyFrom(backward);
  }

  // Solve IK
  solveIK2Bone(chains.leftLeg, character);
  solveIK2Bone(chains.rightLeg, character);
  solveIK2Bone(chains.leftArm, character);
  solveIK2Bone(chains.rightArm, character);

  // 関節角度制限
  clampJointAngles(chains.leftLeg, character, 'leg');
  clampJointAngles(chains.rightLeg, character, 'leg');
  clampJointAngles(chains.leftArm, character, 'arm');
  clampJointAngles(chains.rightArm, character, 'arm');

  // Keep feet flat on ground after IK
  keepFootHorizontal(chains.leftLeg.end, character.footBaseWorldRot.left);
  keepFootHorizontal(chains.rightLeg.end, character.footBaseWorldRot.right);

  // Weapon power calculation
  updateWeaponPower(character, dt ?? (1 / 60));

  // 画面左手(off-hand) = Mixamo rightArm チェーン
  if (character.weapon && character.ikChains.rightArm.weight > 0) {
    if (character.weapon.gripType === 'two-handed') {
      character.weaponAttachR.computeWorldMatrix(true);
      const offLocal = character.weapon.offHandOffset;
      const offWorld = Vector3.TransformCoordinates(offLocal, character.weaponAttachR.getWorldMatrix());
      const offShoulderPos = getWorldPos(character.ikChains.rightArm.root);
      const dir = offWorld.subtract(offShoulderPos).normalize();
      character.ikChains.rightArm.target.copyFrom(offWorld.subtract(dir.scale(PALM_OFFSET)));
    } else {
      const restPos = getOffHandRestPosition(character);
      if (restPos) {
        const current = character.ikChains.rightArm.target;
        Vector3.LerpToRef(current, restPos, Math.min(1, 8 * deltaTime), current);
      }
    }
  }

  // Center of mass
  const com = calculateCenterOfMass(character.combatBones);
  const lFoot = getWorldPos(character.combatBones.get('leftFoot')!);
  const rFoot = getWorldPos(character.combatBones.get('rightFoot')!);

  // Debug visuals
  if (character.debug.enabled) {
    updateDebugVisuals(scene, character.debug, com, lFoot, rFoot, character.root.name);
  }
}

// ─── Character Teleport / Reposition ─────────────────────

export function teleportCharacter(
  character: HavokCharacter,
  position: Vector3,
  facingAngleY: number,
): void {
  const oldPos = character.root.position.clone();
  const oldRot = character.root.rotationQuaternion?.clone() ?? Quaternion.Identity();

  character.root.position.copyFrom(position);
  const newRot = Quaternion.RotationAxis(Vector3.Up(), facingAngleY);
  character.root.rotationQuaternion = newRot;

  const oldRotInv = oldRot.clone(); oldRotInv.invertInPlace();
  const deltaRot = newRot.multiply(oldRotInv);

  const stepper = character.footStepper;
  for (const foot of [stepper.left, stepper.right]) {
    const rel = foot.planted.subtract(oldPos);
    const rotated = rotateVectorByQuat(rel, deltaRot);
    foot.planted.copyFrom(position.add(rotated));
  }

  if (character.footPlant.leftLocked) {
    const rel = character.footPlant.leftLocked.subtract(oldPos);
    character.footPlant.leftLocked.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }
  if (character.footPlant.rightLocked) {
    const rel = character.footPlant.rightLocked.subtract(oldPos);
    character.footPlant.rightLocked.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }

  character.footBaseWorldRot.left = deltaRot.multiply(character.footBaseWorldRot.left);
  character.footBaseWorldRot.right = deltaRot.multiply(character.footBaseWorldRot.right);

  const chains = character.ikChains;
  for (const chain of [chains.leftLeg, chains.rightLeg]) {
    const rel = chain.target.subtract(oldPos);
    chain.target.copyFrom(position.add(rotateVectorByQuat(rel, deltaRot)));
  }
}

// ─── Character Collision Avoidance ───────────────────────

export function resolveCharacterCollision(
  a: HavokCharacter,
  b: HavokCharacter,
  radius: number = 0.25,
): void {
  const posA = a.root.position;
  const posB = b.root.position;

  const dx = posB.x - posA.x;
  const dz = posB.z - posA.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  const minDist = radius * 2;
  if (dist >= minDist || dist < 0.001) return;

  const overlap = minDist - dist;
  const nx = dx / dist;
  const nz = dz / dist;
  const push = overlap * 0.5;

  posA.x -= nx * push;
  posA.z -= nz * push;
  posB.x += nx * push;
  posB.z += nz * push;
}

// ─── Field Bounds ────────────────────────────────────────

export function clampToFieldBounds(character: HavokCharacter, halfSize: number = 4.5): void {
  const pos = character.root.position;
  pos.x = Math.max(-halfSize, Math.min(halfSize, pos.x));
  pos.z = Math.max(-halfSize, Math.min(halfSize, pos.z));
}
