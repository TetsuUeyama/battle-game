/**
 * Havok Character System — Step 1 of physics-based combat
 *
 * Builds Mixamo skeleton from bone-data.json (TransformNodes only),
 * attaches voxel body meshes, Havok physics capsule,
 * custom 2-bone IK solver, foot planting, and center-of-mass.
 */
import {
  Scene, Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion, Matrix, Ray,
} from '@babylonjs/core';
import { PhysicsBody, PhysicsMotionType, PhysicsShapeCapsule } from '@babylonjs/core/Physics/v2';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';

// ─── Types ───────────────────────────────────────────────

interface BoneEntry {
  name: string;
  parent: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  preRotation: [number, number, number];
  worldPosition: [number, number, number];
}

interface BoneDataFile {
  globalSettings: { upAxis: number; unitScaleFactor: number };
  bones: BoneEntry[];
}

export interface IKChain {
  root: TransformNode;
  mid: TransformNode;
  end: TransformNode;
  lengthA: number; // root→mid
  lengthB: number; // mid→end
  poleHint: Vector3;
  /** IK target position (world space) */
  target: Vector3;
  /** 0=off, 1=full IK */
  weight: number;
}

export interface DebugVisuals {
  comSphere: Mesh;
  supportLines: Mesh | null;
  balanceLine: Mesh | null;
  enabled: boolean;
}

export interface HavokCharacter {
  root: TransformNode;
  /** All 65 Mixamo bones by name (e.g. "mixamorig:Hips") */
  allBones: Map<string, TransformNode>;
  /** 11 combat-compatible bones by short name (e.g. "hips", "leftArm") */
  combatBones: Map<string, TransformNode>;
  /** Voxel body meshes for each of the 11 body parts */
  bodyMeshes: Map<string, Mesh>;
  weaponAttachR: TransformNode;
  weaponAttachL: TransformNode;
  /** Physics */
  physicsBody: PhysicsBody | null;
  physicsMesh: Mesh;
  /** IK */
  ikChains: { leftArm: IKChain; rightArm: IKChain; leftLeg: IKChain; rightLeg: IKChain };
  /** Foot planting */
  footPlant: { leftLocked: Vector3 | null; rightLocked: Vector3 | null };
  /** IK base rotations (instance-level) */
  ikBaseRotations: Map<string, { root: Quaternion; mid: Quaternion }>;
  /** Initial foot Y positions (for scaling) */
  initialFootY: { left: number; right: number };
  /** Debug */
  debug: DebugVisuals;
}

// ─── Combat bone mapping ─────────────────────────────────

/** Short name → Mixamo bone name */
const COMBAT_BONE_MAP: Record<string, string> = {
  hips:      'mixamorig:Hips',
  torso:     'mixamorig:Spine1',
  head:      'mixamorig:Head',
  leftArm:   'mixamorig:LeftArm',
  rightArm:  'mixamorig:RightArm',
  leftHand:  'mixamorig:LeftHand',
  rightHand: 'mixamorig:RightHand',
  leftLeg:   'mixamorig:LeftUpLeg',
  rightLeg:  'mixamorig:RightUpLeg',
  leftFoot:  'mixamorig:LeftFoot',
  rightFoot: 'mixamorig:RightFoot',
};

/**
 * Body part definition: which bone to attach to, the child bone that defines
 * the segment end (for offset/sizing), dimensions [w, h, d], and whether it's skin-colored.
 *
 * The mesh is offset along local Y by half the distance to the child bone,
 * so it sits centered along the bone segment.
 */
interface BodyPartDef {
  bone: string;      // parent Mixamo bone
  childBone: string; // child bone (to measure length for offset)
  size: [number, number, number]; // [w, h, d] in meters (h is overridden by bone length)
  thickness: number; // w and d override (cross-section size)
  skin?: boolean;
}

const BODY_PARTS: Record<string, BodyPartDef> = {
  // ── Torso chain ──
  hips:          { bone: 'mixamorig:Hips',    childBone: 'mixamorig:Spine',       size: [0.28, 0, 0.16], thickness: 0 },
  leftPelvis:    { bone: 'mixamorig:Hips',    childBone: 'mixamorig:LeftUpLeg',   size: [0, 0, 0], thickness: 0.12 },
  rightPelvis:   { bone: 'mixamorig:Hips',    childBone: 'mixamorig:RightUpLeg',  size: [0, 0, 0], thickness: 0.12 },
  lowerSpine:    { bone: 'mixamorig:Spine',   childBone: 'mixamorig:Spine1',   size: [0.28, 0, 0.18], thickness: 0 },
  midSpine:      { bone: 'mixamorig:Spine1',  childBone: 'mixamorig:Spine2',   size: [0.28, 0, 0.18], thickness: 0 },
  upperSpine:    { bone: 'mixamorig:Spine2',  childBone: 'mixamorig:Neck',     size: [0.28, 0, 0.18], thickness: 0 },
  neck:          { bone: 'mixamorig:Neck',    childBone: 'mixamorig:Head',     size: [0, 0, 0], thickness: 0.06, skin: true },
  head:          { bone: 'mixamorig:Head',    childBone: 'mixamorig:HeadTop_End', size: [0.16, 0.18, 0.16], thickness: 0, skin: true },
  // ── Shoulders ──
  leftShoulder:  { bone: 'mixamorig:LeftShoulder',  childBone: 'mixamorig:LeftArm',  size: [0, 0, 0], thickness: 0.07 },
  rightShoulder: { bone: 'mixamorig:RightShoulder', childBone: 'mixamorig:RightArm', size: [0, 0, 0], thickness: 0.07 },
  // ── Arms ──
  leftUpperArm:  { bone: 'mixamorig:LeftArm',      childBone: 'mixamorig:LeftForeArm',  size: [0, 0, 0], thickness: 0.07 },
  leftForeArm:   { bone: 'mixamorig:LeftForeArm',  childBone: 'mixamorig:LeftHand',     size: [0, 0, 0], thickness: 0.06 },
  rightUpperArm: { bone: 'mixamorig:RightArm',     childBone: 'mixamorig:RightForeArm', size: [0, 0, 0], thickness: 0.07 },
  rightForeArm:  { bone: 'mixamorig:RightForeArm', childBone: 'mixamorig:RightHand',    size: [0, 0, 0], thickness: 0.06 },
  // ── Hands ──
  leftHand:       { bone: 'mixamorig:LeftHand',          childBone: 'mixamorig:LeftHandMiddle1',  size: [0.08, 0, 0.04], thickness: 0, skin: true },
  rightHand:      { bone: 'mixamorig:RightHand',         childBone: 'mixamorig:RightHandMiddle1', size: [0.08, 0, 0.04], thickness: 0, skin: true },
  // ── Left Fingers ──
  leftThumb1:     { bone: 'mixamorig:LeftHandThumb1',    childBone: 'mixamorig:LeftHandThumb2',   size: [0, 0, 0], thickness: 0.02, skin: true },
  leftThumb2:     { bone: 'mixamorig:LeftHandThumb2',    childBone: 'mixamorig:LeftHandThumb3',   size: [0, 0, 0], thickness: 0.02, skin: true },
  leftIndex1:     { bone: 'mixamorig:LeftHandIndex1',    childBone: 'mixamorig:LeftHandIndex2',   size: [0, 0, 0], thickness: 0.018, skin: true },
  leftIndex2:     { bone: 'mixamorig:LeftHandIndex2',    childBone: 'mixamorig:LeftHandIndex3',   size: [0, 0, 0], thickness: 0.016, skin: true },
  leftMiddle1:    { bone: 'mixamorig:LeftHandMiddle1',   childBone: 'mixamorig:LeftHandMiddle2',  size: [0, 0, 0], thickness: 0.018, skin: true },
  leftMiddle2:    { bone: 'mixamorig:LeftHandMiddle2',   childBone: 'mixamorig:LeftHandMiddle3',  size: [0, 0, 0], thickness: 0.016, skin: true },
  leftRing1:      { bone: 'mixamorig:LeftHandRing1',     childBone: 'mixamorig:LeftHandRing2',    size: [0, 0, 0], thickness: 0.018, skin: true },
  leftRing2:      { bone: 'mixamorig:LeftHandRing2',     childBone: 'mixamorig:LeftHandRing3',    size: [0, 0, 0], thickness: 0.016, skin: true },
  leftPinky1:     { bone: 'mixamorig:LeftHandPinky1',    childBone: 'mixamorig:LeftHandPinky2',   size: [0, 0, 0], thickness: 0.015, skin: true },
  leftPinky2:     { bone: 'mixamorig:LeftHandPinky2',    childBone: 'mixamorig:LeftHandPinky3',   size: [0, 0, 0], thickness: 0.013, skin: true },
  // ── Right Fingers ──
  rightThumb1:    { bone: 'mixamorig:RightHandThumb1',   childBone: 'mixamorig:RightHandThumb2',  size: [0, 0, 0], thickness: 0.02, skin: true },
  rightThumb2:    { bone: 'mixamorig:RightHandThumb2',   childBone: 'mixamorig:RightHandThumb3',  size: [0, 0, 0], thickness: 0.02, skin: true },
  rightIndex1:    { bone: 'mixamorig:RightHandIndex1',   childBone: 'mixamorig:RightHandIndex2',  size: [0, 0, 0], thickness: 0.018, skin: true },
  rightIndex2:    { bone: 'mixamorig:RightHandIndex2',   childBone: 'mixamorig:RightHandIndex3',  size: [0, 0, 0], thickness: 0.016, skin: true },
  rightMiddle1:   { bone: 'mixamorig:RightHandMiddle1',  childBone: 'mixamorig:RightHandMiddle2', size: [0, 0, 0], thickness: 0.018, skin: true },
  rightMiddle2:   { bone: 'mixamorig:RightHandMiddle2',  childBone: 'mixamorig:RightHandMiddle3', size: [0, 0, 0], thickness: 0.016, skin: true },
  rightRing1:     { bone: 'mixamorig:RightHandRing1',    childBone: 'mixamorig:RightHandRing2',   size: [0, 0, 0], thickness: 0.018, skin: true },
  rightRing2:     { bone: 'mixamorig:RightHandRing2',    childBone: 'mixamorig:RightHandRing3',   size: [0, 0, 0], thickness: 0.016, skin: true },
  rightPinky1:    { bone: 'mixamorig:RightHandPinky1',   childBone: 'mixamorig:RightHandPinky2',  size: [0, 0, 0], thickness: 0.015, skin: true },
  rightPinky2:    { bone: 'mixamorig:RightHandPinky2',   childBone: 'mixamorig:RightHandPinky3',  size: [0, 0, 0], thickness: 0.013, skin: true },
  // ── Legs ──
  leftThigh:     { bone: 'mixamorig:LeftUpLeg',  childBone: 'mixamorig:LeftLeg',  size: [0, 0, 0], thickness: 0.10 },
  leftShin:      { bone: 'mixamorig:LeftLeg',    childBone: 'mixamorig:LeftFoot', size: [0, 0, 0], thickness: 0.08 },
  rightThigh:    { bone: 'mixamorig:RightUpLeg', childBone: 'mixamorig:RightLeg', size: [0, 0, 0], thickness: 0.10 },
  rightShin:     { bone: 'mixamorig:RightLeg',   childBone: 'mixamorig:RightFoot',size: [0, 0, 0], thickness: 0.08 },
  // ── Feet + Toes ──
  leftFoot:      { bone: 'mixamorig:LeftFoot',     childBone: 'mixamorig:LeftToeBase',  size: [0.08, 0, 0.06], thickness: 0, skin: true },
  leftToe:       { bone: 'mixamorig:LeftToeBase',  childBone: 'mixamorig:LeftToe_End',  size: [0.07, 0, 0.03], thickness: 0, skin: true },
  rightFoot:     { bone: 'mixamorig:RightFoot',    childBone: 'mixamorig:RightToeBase', size: [0.08, 0, 0.06], thickness: 0, skin: true },
  rightToe:      { bone: 'mixamorig:RightToeBase', childBone: 'mixamorig:RightToe_End', size: [0.07, 0, 0.03], thickness: 0, skin: true },
};

const SKIN_PART_SET = new Set(['head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot']);

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

function degToRad(d: number): number { return d * Math.PI / 180; }

/**
 * FBX XYZ intrinsic Euler (degrees) → Quaternion.
 * FBX applies rotations in order: X, then Y, then Z (intrinsic).
 * Matrix form: Rz * Ry * Rx. Quaternion form: Qz * Qy * Qx.
 *
 * NOTE: Babylon.js Quaternion.FromEulerAngles uses YXZ order,
 * which is WRONG for FBX. We must compose per-axis quaternions.
 */
function eulerDegreesToQuat(xDeg: number, yDeg: number, zDeg: number): Quaternion {
  const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(xDeg));
  const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), degToRad(yDeg));
  const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), degToRad(zDeg));
  return qz.multiply(qy.multiply(qx));
}

async function loadBoneData(): Promise<BoneDataFile> {
  const res = await fetch('/bone-data.json');
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
    // Compute rotation that takes Vector3.Up() → childLocalPos direction.
    const boneDir = childLocalPos.normalize();
    const up = Vector3.Up();

    // Offset: center the box along the bone direction
    const halfLen = boneLength / 2;
    mesh.position.set(boneDir.x * halfLen, boneDir.y * halfLen, boneDir.z * halfLen);

    // Rotation: align box Y-axis to bone direction
    // If boneDir is nearly parallel to Up, no rotation needed
    const dot = Vector3.Dot(up, boneDir);
    if (Math.abs(dot) < 0.9999) {
      const axis = Vector3.Cross(up, boneDir).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      mesh.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
    } else if (dot < 0) {
      // Opposite direction: rotate 180° around Z
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

// ─── 2-Bone IK Solver ───────────────────────────────────

function getWorldPos(node: TransformNode): Vector3 {
  node.computeWorldMatrix(true);
  return node.getAbsolutePosition();
}

function distanceBetweenBones(a: TransformNode, b: TransformNode): number {
  return Vector3.Distance(getWorldPos(a), getWorldPos(b));
}

/**
 * Analytic 2-bone IK solver operating on TransformNodes.
 *
 * Algorithm:
 * 1. Compute desired mid-joint position using law of cosines + pole vector
 * 2. Compute world rotations for root and mid joints
 * 3. Convert to local rotations relative to parents
 *
 * Stores original rotations on first call so we can blend with IK weight.
 */
let _ikDebugCounter = 0;

export function solveIK2Bone(chain: IKChain, character: HavokCharacter): void {
  if (chain.weight <= 0) return;

  const { root, mid, end, lengthA, lengthB, target, poleHint } = chain;

  // Store base rotations on first call (instance-level)
  const chainKey = root.name;
  const baseMap = character.ikBaseRotations;
  if (!baseMap.has(chainKey)) {
    baseMap.set(chainKey, {
      root: (root.rotationQuaternion ?? Quaternion.Identity()).clone(),
      mid: (mid.rotationQuaternion ?? Quaternion.Identity()).clone(),
    });
  }
  const baseRots = baseMap.get(chainKey)!;

  // Reset to base rotations before solving (prevents accumulation)
  root.rotationQuaternion = baseRots.root.clone();
  mid.rotationQuaternion = baseRots.mid.clone();

  // Recompute world matrices after reset
  root.computeWorldMatrix(true);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);

  // Current world positions
  const rootPos = root.getAbsolutePosition().clone();
  const midPos = mid.getAbsolutePosition().clone();
  const endPos = end.getAbsolutePosition().clone();

  // Distance to target
  const toTarget = target.subtract(rootPos);
  let targetDist = toTarget.length();
  if (targetDist < 0.001) return;

  // Clamp to reachable range
  const maxReach = lengthA + lengthB - 0.001;
  const minReach = Math.abs(lengthA - lengthB) + 0.001;
  targetDist = Math.max(minReach, Math.min(maxReach, targetDist));

  // ─── Step 1: Find desired mid-joint position ───

  // Law of cosines: angle at root
  const cosA = (lengthA * lengthA + targetDist * targetDist - lengthB * lengthB)
    / (2 * lengthA * targetDist);
  const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));

  // Direction from root to target
  const targetDir = toTarget.normalize();

  // Pole vector: defines the bend plane
  // Project poleHint onto the plane perpendicular to targetDir
  const poleDot = Vector3.Dot(poleHint, targetDir);
  let bendDir = poleHint.subtract(targetDir.scale(poleDot));
  if (bendDir.length() < 0.001) {
    // Fallback: use current mid position to determine bend plane
    const currentBend = midPos.subtract(rootPos);
    const cd = Vector3.Dot(currentBend, targetDir);
    bendDir = currentBend.subtract(targetDir.scale(cd));
  }
  bendDir.normalize();

  // Desired mid position: rotate targetDir by angleA toward bendDir
  const desiredMid = rootPos
    .add(targetDir.scale(Math.cos(angleA) * lengthA))
    .add(bendDir.scale(Math.sin(angleA) * lengthA));

  // ─── Step 2: Rotate root joint to point at desiredMid ───

  // Current direction from root to mid (before IK)
  const currentRootToMid = midPos.subtract(rootPos).normalize();
  // Desired direction from root to desiredMid
  const desiredRootToMid = desiredMid.subtract(rootPos).normalize();

  // Rotation from current to desired (in world space)
  const rootDeltaWorld = rotationBetweenVectors(currentRootToMid, desiredRootToMid);

  if (!(_ikDebugCounter % 120)) {
    console.log(`[IK ${root.name}] rootPos=${rootPos.toString()} target=${target.toString()} dist=${targetDist.toFixed(3)}`);
  }

  // Apply delta rotation to root in local space
  applyWorldDeltaRotation(root, rootDeltaWorld, chain.weight);

  // Recompute after root rotation
  root.computeWorldMatrix(true);
  mid.computeWorldMatrix(true);
  end.computeWorldMatrix(true);

  // ─── Step 3: Rotate mid joint to point end at target ───

  const newMidPos = mid.getAbsolutePosition().clone();
  const newEndPos = end.getAbsolutePosition().clone();

  const currentMidToEnd = newEndPos.subtract(newMidPos).normalize();
  const desiredMidToEnd = target.subtract(newMidPos).normalize();

  const midDeltaWorld = rotationBetweenVectors(currentMidToEnd, desiredMidToEnd);
  applyWorldDeltaRotation(mid, midDeltaWorld, chain.weight);

  if (!(_ikDebugCounter % 60)) {
    // Check result
    mid.computeWorldMatrix(true);
    end.computeWorldMatrix(true);
    const finalEnd = end.getAbsolutePosition();
    console.log(`[IK ${root.name}] finalEnd=${finalEnd.toString()} target=${target.toString()} error=${Vector3.Distance(finalEnd, target).toFixed(4)}`);
  }
  _ikDebugCounter++;
}

/** Compute shortest rotation quaternion from direction A to direction B */
function rotationBetweenVectors(from: Vector3, to: Vector3): Quaternion {
  const dot = Vector3.Dot(from, to);
  if (dot > 0.9999) return Quaternion.Identity();
  if (dot < -0.9999) {
    // 180° rotation: find perpendicular axis
    let perp = Vector3.Cross(from, Vector3.Right());
    if (perp.length() < 0.001) perp = Vector3.Cross(from, Vector3.Up());
    perp.normalize();
    return Quaternion.RotationAxis(perp, Math.PI);
  }
  const axis = Vector3.Cross(from, to).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return Quaternion.RotationAxis(axis, angle);
}

/** Apply a world-space delta rotation to a node's local rotation */
function applyWorldDeltaRotation(node: TransformNode, deltaWorld: Quaternion, weight: number): void {
  // Get parent's world rotation
  const parent = node.parent as TransformNode;
  if (!parent) return;
  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  // Convert world delta to local delta: localDelta = parentInv * worldDelta * parentRot
  const localDelta = parentInv.multiply(deltaWorld).multiply(parentWorldRot);

  // Apply to current local rotation
  const currentLocal = node.rotationQuaternion ?? Quaternion.Identity();
  const newLocal = localDelta.multiply(currentLocal);

  if (weight >= 1) {
    node.rotationQuaternion = newLocal;
  } else {
    node.rotationQuaternion = Quaternion.Slerp(currentLocal, newLocal, weight);
  }
}

function createIKChains(
  allBones: Map<string, TransformNode>,
): { leftArm: IKChain; rightArm: IKChain; leftLeg: IKChain; rightLeg: IKChain } {
  function getBone(name: string): TransformNode {
    const b = allBones.get(name);
    if (!b) throw new Error(`IK bone not found: ${name}`);
    return b;
  }

  function makeChain(
    rootName: string, midName: string, endName: string, pole: Vector3,
  ): IKChain {
    const r = getBone(rootName);
    const m = getBone(midName);
    const e = getBone(endName);
    return {
      root: r, mid: m, end: e,
      lengthA: distanceBetweenBones(r, m),
      lengthB: distanceBetweenBones(m, e),
      poleHint: pole,
      target: getWorldPos(e).clone(), // MUST clone — getAbsolutePosition returns internal reference
      weight: 0, // off by default
    };
  }

  return {
    leftArm:  makeChain('mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand', new Vector3(0, 0, -1)),
    rightArm: makeChain('mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand', new Vector3(0, 0, -1)),
    leftLeg:  makeChain('mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot', new Vector3(0, 0, 1)),
    rightLeg: makeChain('mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot', new Vector3(0, 0, 1)),
  };
}

// ─── Center of Mass ──────────────────────────────────────

const COM_WEIGHTS: Record<string, number> = {
  hips: 0.20, torso: 0.20, head: 0.08,
  leftArm: 0.05, rightArm: 0.05,
  leftHand: 0.01, rightHand: 0.01,
  leftLeg: 0.10, rightLeg: 0.10,
  leftFoot: 0.015, rightFoot: 0.015,
};

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

  fp.leftLocked = new Vector3(lFootX, lFootY, lFootZ);
  fp.rightLocked = new Vector3(rFootX, rFootY, rFootZ);

  chains.leftLeg.target.copyFrom(fp.leftLocked);
  chains.rightLeg.target.copyFrom(fp.rightLocked);
  chains.leftLeg.weight = 1;
  chains.rightLeg.weight = 1;

  console.log(`[initFootPlanting] L target=${fp.leftLocked.toString()} R target=${fp.rightLocked.toString()}`);
}

// ─── Debug Visuals ───────────────────────────────────────

function createDebugVisuals(scene: Scene, prefix: string): DebugVisuals {
  const comSphere = MeshBuilder.CreateSphere(`${prefix}_com`, { diameter: 0.06 }, scene);
  const comMat = new StandardMaterial(`${prefix}_comMat`, scene);
  comMat.diffuseColor = new Color3(1, 0.2, 0.2);
  comMat.alpha = 0.6;
  comSphere.material = comMat;
  comSphere.isPickable = false;

  return { comSphere, supportLines: null, balanceLine: null, enabled: true };
}

function updateDebugVisuals(
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

// ─── Main: Create HavokCharacter ─────────────────────────

export interface CreateCharacterOptions {
  bodyColor: Color3;
  prefix: string;
  position?: Vector3;
  enablePhysics?: boolean;
  enableDebug?: boolean;
}

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

  // Weapon attach points
  const weaponAttachR = new TransformNode(`${prefix}_weaponR`, scene);
  const rHand = combatBones.get('rightHand');
  if (rHand) { weaponAttachR.parent = rHand; weaponAttachR.position.set(0, -0.08, 0.05); }

  const weaponAttachL = new TransformNode(`${prefix}_weaponL`, scene);
  const lHand = combatBones.get('leftHand');
  if (lHand) { weaponAttachL.parent = lHand; weaponAttachL.position.set(0, -0.08, 0.05); }

  // Physics capsule
  const { body: physicsBody, mesh: physicsMesh } = createPhysicsCapsule(scene, root, prefix, enablePhysics);

  // IK chains
  const ikChains = createIKChains(allBones);

  // Foot planting state
  const footPlant = { leftLocked: null as Vector3 | null, rightLocked: null as Vector3 | null };

  // Debug
  const debug = enableDebug ? createDebugVisuals(scene, prefix) : {
    comSphere: MeshBuilder.CreateSphere(`${prefix}_com_hidden`, { diameter: 0.01 }, scene),
    supportLines: null, balanceLine: null, enabled: false,
  };
  if (!enableDebug) debug.comSphere.isVisible = false;

  const character: HavokCharacter = {
    root, allBones, combatBones, bodyMeshes,
    weaponAttachR, weaponAttachL,
    physicsBody, physicsMesh,
    ikChains, footPlant, debug,
    ikBaseRotations: new Map(),
    initialFootY: { left: 0, right: 0 },
  };

  _ikDebugCounter = 0;

  // Initialize foot planting (uses bone-data.json worldPositions for reliable targets)
  initFootPlanting(character, boneData);

  return character;
}

// ─── Bone Scaling ────────────────────────────────────────

/** Base bone positions (stored on first call for delta scaling) */
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

/**
 * Scale all bone lengths uniformly.
 * factor=1.0 is original, 0.5 is half height, 2.0 is double.
 */
export function scaleBones(character: HavokCharacter, factor: number): void {
  const base = ensureBasePositions(character);
  for (const [name, bone] of character.allBones) {
    const basePos = base.get(name);
    if (basePos) {
      bone.position.set(basePos.x * factor, basePos.y * factor, basePos.z * factor);
    }
  }

  // Update IK targets proportionally
  const initFY = character.initialFootY;
  const chains = character.ikChains;
  const fp = character.footPlant;

  // Recompute foot positions after scaling
  character.root.computeWorldMatrix(true);
  for (const bone of character.allBones.values()) bone.computeWorldMatrix(true);

  const lFoot = chains.leftLeg.end.getAbsolutePosition();
  const rFoot = chains.rightLeg.end.getAbsolutePosition();

  // Target: use scaled foot Y (ankle height scales with character)
  fp.leftLocked = new Vector3(lFoot.x, initFY.left * factor, lFoot.z);
  fp.rightLocked = new Vector3(rFoot.x, initFY.right * factor, rFoot.z);
  chains.leftLeg.target.copyFrom(fp.leftLocked);
  chains.rightLeg.target.copyFrom(fp.rightLocked);

  // Update IK chain lengths (bone lengths changed with scale)
  for (const chain of [chains.leftLeg, chains.rightLeg, chains.leftArm, chains.rightArm]) {
    chain.root.computeWorldMatrix(true);
    chain.mid.computeWorldMatrix(true);
    chain.end.computeWorldMatrix(true);
    chain.lengthA = Vector3.Distance(chain.root.getAbsolutePosition(), chain.mid.getAbsolutePosition());
    chain.lengthB = Vector3.Distance(chain.mid.getAbsolutePosition(), chain.end.getAbsolutePosition());
  }

  // Clear IK base rotations (bone orientations need re-capture)
  character.ikBaseRotations.clear();
}

/**
 * Rebuild all body meshes after bone scaling.
 * Disposes old meshes and creates new ones matching current bone lengths.
 */
export function rebuildBodyMeshes(
  scene: Scene, character: HavokCharacter, bodyColor: Color3, prefix: string,
): void {
  // Dispose old meshes
  for (const mesh of character.bodyMeshes.values()) {
    mesh.dispose();
  }
  character.bodyMeshes.clear();

  // Create new meshes
  const newMeshes = createBodyMeshes(scene, character.allBones, bodyColor, prefix);
  for (const [name, mesh] of newMeshes) {
    character.bodyMeshes.set(name, mesh);
  }
}

// ─── Per-Frame Update ────────────────────────────────────

export function updateHavokCharacter(scene: Scene, character: HavokCharacter): void {
  // Solve leg IK (foot planting targets set once via initFootPlanting)
  const chains = character.ikChains;
  solveIK2Bone(chains.leftLeg, character);
  solveIK2Bone(chains.rightLeg, character);
  // Arm IK only when targets are set (weight > 0)
  solveIK2Bone(chains.leftArm, character);
  solveIK2Bone(chains.rightArm, character);

  // Center of mass
  const com = calculateCenterOfMass(character.combatBones);
  const lFoot = getWorldPos(character.combatBones.get('leftFoot')!);
  const rFoot = getWorldPos(character.combatBones.get('rightFoot')!);

  // Debug visuals
  if (character.debug.enabled) {
    updateDebugVisuals(scene, character.debug, com, lFoot, rFoot, character.root.name);
  }
}
