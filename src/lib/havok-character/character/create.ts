/**
 * キャラクター生成。スケルトン構築・ボディメッシュ・物理カプセル・IK・足接地の初期化。
 * initHavok を内部で自動呼び出しするため、ページ側は initHavok を意識する必要がない。
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion,
} from '@babylonjs/core';
import { PhysicsBody, PhysicsMotionType, PhysicsShapeCapsule } from '@babylonjs/core/Physics/v2';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import type { HavokCharacter, BoneDataFile, FootStep, CreateCharacterOptions } from '../types';
import {
  createJumpState, createBalanceState, createWeaponSwingState,
  BODY_PARTS, COMBAT_BONE_MAP, BONE_DATA_URL,
} from '../types';
import { eulerDegreesToQuat } from '@/lib/math-utils';
import { createIKChains, initFootPlanting, createDebugVisuals } from './index';
import { FOOT_PLANT_CONFIG, PHYSICS_CONFIG } from './body';

// ─── Havok 物理エンジン初期化 (自動・1回のみ) ───────────

let _havokPlugin: HavokPlugin | null = null;

async function ensureHavok(scene: Scene): Promise<HavokPlugin> {
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
  scene: Scene, boneData: BoneDataFile, root: TransformNode, prefix: string,
): Map<string, TransformNode> {
  const allBones = new Map<string, TransformNode>();
  const scale = boneData.globalSettings.unitScaleFactor / 100;

  for (const entry of boneData.bones) {
    const node = new TransformNode(`${prefix}_${entry.name}`, scene);
    if (entry.parent) {
      const parentNode = allBones.get(entry.parent);
      node.parent = parentNode ?? root;
    } else {
      node.parent = root;
    }
    node.position.set(
      entry.localPosition[0] * scale,
      entry.localPosition[1] * scale,
      entry.localPosition[2] * scale,
    );
    const pre = eulerDegreesToQuat(entry.preRotation[0], entry.preRotation[1], entry.preRotation[2]);
    const lcl = eulerDegreesToQuat(entry.localRotation[0], entry.localRotation[1], entry.localRotation[2]);
    node.rotationQuaternion = pre.multiply(lcl);
    allBones.set(entry.name, node);
  }
  return allBones;
}

// ─── Body Meshes ─────────────────────────────────────────

function createBodyMeshes(
  scene: Scene, allBones: Map<string, TransformNode>, bodyColor: Color3, prefix: string,
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
    const childLocalPos = childBone.position.clone();
    const boneLength = childLocalPos.length();
    if (boneLength < 0.001) continue;

    let crossW: number, crossD: number;
    if (def.thickness > 0) { crossW = def.thickness; crossD = def.thickness; }
    else { crossW = def.size[0]; crossD = def.size[2]; }
    const h = (def.size[1] > 0) ? def.size[1] : boneLength;

    const mesh = MeshBuilder.CreateBox(`${prefix}_body_${partName}`, { width: crossW, height: h, depth: crossD }, scene);
    mesh.material = def.skin ? skinMat : bodyMat;
    mesh.parent = bone;
    const boneDir = childLocalPos.normalize();
    const halfLen = boneLength / 2;
    mesh.position.set(boneDir.x * halfLen, boneDir.y * halfLen, boneDir.z * halfLen);
    const dot = Vector3.Dot(Vector3.Up(), boneDir);
    if (Math.abs(dot) < 0.9999) {
      const axis = Vector3.Cross(Vector3.Up(), boneDir).normalize();
      mesh.rotationQuaternion = Quaternion.RotationAxis(axis, Math.acos(Math.max(-1, Math.min(1, dot))));
    } else if (dot < 0) {
      mesh.rotationQuaternion = Quaternion.RotationAxis(Vector3.Forward(), Math.PI);
    }
    bodyMeshes.set(partName, mesh);
  }
  return bodyMeshes;
}

// ─── Physics Capsule ─────────────────────────────────────

function createPhysicsCapsule(
  scene: Scene, root: TransformNode, prefix: string, enablePhysics: boolean,
): { body: PhysicsBody | null; mesh: Mesh } {
  const height = PHYSICS_CONFIG.capsuleHeight;
  const radius = PHYSICS_CONFIG.capsuleRadius;
  const mesh = MeshBuilder.CreateCapsule(`${prefix}_capsule`, { height, radius }, scene);
  mesh.parent = root;
  mesh.position.y = height / 2;
  mesh.isVisible = false;
  mesh.isPickable = false;

  let body: PhysicsBody | null = null;
  if (enablePhysics) {
    const shape = new PhysicsShapeCapsule(new Vector3(0, radius, 0), new Vector3(0, height - radius, 0), radius, scene);
    body = new PhysicsBody(mesh, PhysicsMotionType.DYNAMIC, false, scene);
    body.shape = shape;
    body.setMassProperties({ mass: PHYSICS_CONFIG.mass });
    body.setAngularDamping(PHYSICS_CONFIG.angularDamping);
  }
  return { body, mesh };
}

// ─── createHavokCharacter ────────────────────────────────

/** ボーンスケーリング用キャッシュ */
export const _baseBonePositions = new Map<string, Map<string, Vector3>>();

/**
 * Havokキャラクターを生成する。
 * 物理エンジンの初期化も内部で自動的に行う。
 */
export async function createHavokCharacter(
  scene: Scene, options: CreateCharacterOptions,
): Promise<HavokCharacter> {
  const { bodyColor, prefix, position, enablePhysics = true, enableDebug = true } = options;

  // 物理エンジン初期化 (初回のみ)
  if (enablePhysics) {
    await ensureHavok(scene);
  }

  const root = new TransformNode(`${prefix}_root`, scene);
  if (position) root.position.copyFrom(position);

  const boneData = await loadBoneData();
  const allBones = buildSkeleton(scene, boneData, root, prefix);

  const combatBones = new Map<string, TransformNode>();
  for (const [shortName, mixamoName] of Object.entries(COMBAT_BONE_MAP)) {
    const bone = allBones.get(mixamoName);
    if (bone) combatBones.set(shortName, bone);
  }

  const bodyMeshes = createBodyMeshes(scene, allBones, bodyColor, prefix);

  const weaponAttachR = new TransformNode(`${prefix}_weaponR`, scene);
  const visualRightHand = combatBones.get('leftHand');
  if (visualRightHand) { weaponAttachR.parent = visualRightHand; weaponAttachR.position.set(0, 0.064, 0.035); }
  const weaponAttachL = new TransformNode(`${prefix}_weaponL`, scene);
  const visualLeftHand = combatBones.get('rightHand');
  if (visualLeftHand) { weaponAttachL.parent = visualLeftHand; weaponAttachL.position.set(0, 0.064, 0.035); }

  const palmMarkerMat = new StandardMaterial(`${prefix}_palmMarkerMat`, scene);
  palmMarkerMat.diffuseColor = new Color3(1, 0.2, 0.8);
  palmMarkerMat.alpha = 0.8;
  for (const { hand, localPos } of [
    { hand: allBones.get('mixamorig:LeftHand'), localPos: [-0.028, 0.100, 0.025] as [number, number, number] },
    { hand: allBones.get('mixamorig:LeftHand'), localPos: [0.022, 0.098, 0.025] as [number, number, number] },
    { hand: allBones.get('mixamorig:RightHand'), localPos: [0.028, 0.100, 0.025] as [number, number, number] },
    { hand: allBones.get('mixamorig:RightHand'), localPos: [-0.022, 0.098, 0.025] as [number, number, number] },
  ]) {
    if (!hand) continue;
    const sphere = MeshBuilder.CreateSphere(`${prefix}_palmMark`, { diameter: 0.015 }, scene);
    sphere.material = palmMarkerMat;
    sphere.parent = hand;
    sphere.position.set(localPos[0], localPos[1], localPos[2]);
  }

  const { body: physicsBody, mesh: physicsMesh } = createPhysicsCapsule(scene, root, prefix, enablePhysics);
  const ikChains = createIKChains(allBones);
  const footPlant = { leftLocked: null as Vector3 | null, rightLocked: null as Vector3 | null };
  const mkStep = (): FootStep => ({ planted: Vector3.Zero(), target: Vector3.Zero(), stepping: false, progress: 0, liftPos: Vector3.Zero() });
  const footStepper = { left: mkStep(), right: mkStep(), ...FOOT_PLANT_CONFIG };

  const debug = enableDebug ? createDebugVisuals(scene, prefix) : {
    comSphere: MeshBuilder.CreateSphere(`${prefix}_com_hidden`, { diameter: 0.01 }, scene),
    supportLines: null, balanceLine: null, enabled: false,
  };
  if (!enableDebug) debug.comSphere.isVisible = false;

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
    weapon: null, weaponSwing: createWeaponSwingState(), weaponMesh: null,
  };

  for (const chain of [ikChains.leftLeg, ikChains.rightLeg, ikChains.leftArm, ikChains.rightArm]) {
    character.ikBaseRotations.set(chain.root.name, {
      root: (chain.root.rotationQuaternion ?? Quaternion.Identity()).clone(),
      mid: (chain.mid.rotationQuaternion ?? Quaternion.Identity()).clone(),
    });
  }

  const lFootBone = allBones.get('mixamorig:LeftFoot');
  const rFootBone = allBones.get('mixamorig:RightFoot');
  if (lFootBone) {
    lFootBone.computeWorldMatrix(true);
    character.footBaseWorldRot.left = Quaternion.FromRotationMatrix(lFootBone.getWorldMatrix().getRotationMatrix()).clone();
  }
  if (rFootBone) {
    rFootBone.computeWorldMatrix(true);
    character.footBaseWorldRot.right = Quaternion.FromRotationMatrix(rFootBone.getWorldMatrix().getRotationMatrix()).clone();
  }

  initFootPlanting(character, boneData);
  return character;
}

/**
 * Rebuild all body meshes after bone scaling.
 */
export function rebuildBodyMeshes(
  scene: Scene, character: HavokCharacter, bodyColor: Color3, prefix: string,
): void {
  for (const mesh of character.bodyMeshes.values()) mesh.dispose();
  character.bodyMeshes.clear();
  const newMeshes = createBodyMeshes(scene, character.allBones, bodyColor, prefix);
  for (const [name, mesh] of newMeshes) character.bodyMeshes.set(name, mesh);
}
