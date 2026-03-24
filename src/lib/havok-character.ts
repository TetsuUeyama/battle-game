/**
 * Havok Character System — Steps 1 & 2 of physics-based combat
 *
 * Builds Mixamo skeleton from bone-data.json (TransformNodes only),
 * attaches voxel body meshes, Havok physics capsule,
 * custom 2-bone IK solver, foot planting, center-of-mass,
 * and weapon physics (grip, inertia, power).
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion, VertexData,
} from '@babylonjs/core';
import { PhysicsBody, PhysicsMotionType, PhysicsShapeCapsule } from '@babylonjs/core/Physics/v2';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import { parseVox, SCALE as VOX_SCALE } from './vox-parser';

// ─── Weapon Physics Types ─────────────────────────────────

export type GripType = 'one-handed' | 'two-handed';

/** 構えの種類 */
export type StanceType = 'front' | 'side' | 'overhead';

export interface WeaponPhysics {
  weight: number;      // kg (仮値: 軽い=1, 重い=5+)
  length: number;      // m  持ち手から先端まで
  gripType: GripType;
  attackPoint: Vector3; // 先端位置 (weapon local space, grip からの相対)
  /** グリップ位置 (weapon local, 柄の中心。デフォルト=原点) */
  gripOffset: Vector3;
  /** 両手持ち時の左手位置 (weapon local, gripからの相対。柄の下端寄り) */
  offHandOffset: Vector3;
  /** 武器メッシュローカル空間でのgrip→tip方向 (正規化) */
  localTipDir: Vector3;
  /** 武器メッシュローカル空間でのグリップ軸 (pommel側grip→tip側grip方向, 正規化) */
  localGripAxis: Vector3;
  /** true: メッシュに直接配置済み。setWeaponDirectionをスキップ */
  directPlacement?: boolean;
}

export interface WeaponSwingState {
  /** 慣性で遅延するIKターゲット (world space) */
  smoothedTarget: Vector3;
  /** 武器装備時の右手ワールド位置 (固定基準点、ドリフト防止) */
  baseHandPos: Vector3;
  /** 前フレームの先端位置 (world space) */
  prevTipPos: Vector3;
  /** フレームごとの先端移動距離 */
  tipSpeed: number;
  /** 累積攻撃威力 (先端移動距離 × weight) */
  power: number;
  /** スイング中フラグ */
  swinging: boolean;
  /** 現在の構え */
  stance: StanceType;
}

/** デフォルト武器 (テスト用仮値) */
export function createDefaultWeapon(): WeaponPhysics {
  return {
    weight: 3.0,       // 仮値 3kg
    length: 1.0,       // 1m
    gripType: 'two-handed',
    attackPoint: new Vector3(0, -1.0, 0),  // grip から先端方向 (local Y-)
    gripOffset: Vector3.Zero(),             // 武器メッシュ原点 = グリップ位置
    offHandOffset: new Vector3(0, 0.2, 0),  // grip から柄の下端側 20cm (local Y+)
    localTipDir: Vector3.Down(),            // デバッグ用ボックスは Y- が先端
    localGripAxis: Vector3.Up(),            // デバッグ用: pommel→tip方向 = Y+
  };
}

export function createWeaponSwingState(): WeaponSwingState {
  return {
    smoothedTarget: Vector3.Zero(),
    baseHandPos: Vector3.Zero(),
    prevTipPos: Vector3.Zero(),
    tipSpeed: 0,
    power: 0,
    swinging: false,
    stance: 'front',
  };
}

/**
 * キャラクターのボーン位置から画面上の方向ベクトルを算出。
 * 重要: Babylon.js左手座標系ではMixamoの左右が画面上で反転する。
 *   Mixamo RightShoulder → 画面左側, Mixamo LeftShoulder → 画面右側
 * この関数は画面上の方向を返す (charRight = 画面上の右方向)。
 */
export function getCharacterDirections(character: HavokCharacter): {
  forward: Vector3; charRight: Vector3; charLeft: Vector3;
} | null {
  const mixamoRShoulder = character.allBones.get('mixamorig:RightShoulder');
  const mixamoLShoulder = character.allBones.get('mixamorig:LeftShoulder');
  if (!mixamoRShoulder || !mixamoLShoulder) return null;

  const mixamoRPos = getWorldPos(mixamoRShoulder);
  const mixamoLPos = getWorldPos(mixamoLShoulder);

  // Mixamo Left→Right方向 = 画面上の右方向 (Babylon.js左手座標系での反転)
  const charRight = mixamoLPos.subtract(mixamoRPos).normalize();
  charRight.y = 0; charRight.normalize();
  const charLeft = charRight.scale(-1);
  const forward = Vector3.Cross(charRight, Vector3.Up()).normalize();

  return { forward, charRight, charLeft };
}

/** 手のひら中心オフセット (IK end bone=手首 → 手のひら中心まで 約0.064m) */
const PALM_OFFSET = 0.064;

/**
 * 構えごとのグリップ位置・武器方向・左手位置を算出。
 * 戻り値:
 *   gripPos: グリップのワールド位置 (右手IKターゲットの基準)
 *   weaponDir: 武器の向き (grip→tip方向, 正規化)
 *   offHandPos: 両手持ち時の左手ワールド位置 (null if 片手)
 */
export function getStanceTargets(
  character: HavokCharacter,
  stance: StanceType,
  weapon: WeaponPhysics,
): { rightTarget: Vector3; leftTarget: Vector3 | null; weaponDir: Vector3 } {
  const spine2 = character.combatBones.get('torso');
  const hips = character.combatBones.get('hips');
  const dirs = getCharacterDirections(character);
  if (!spine2 || !hips || !dirs) {
    return { rightTarget: Vector3.Zero(), leftTarget: null, weaponDir: Vector3.Down() };
  }

  const chestPos = getWorldPos(spine2);
  const { forward, charRight, charLeft } = dirs;

  let gripPos: Vector3;
  let weaponDir: Vector3; // grip → tip 方向 (正規化)

  switch (stance) {
    case 'front': {
      // 正面に構える: グリップは胸の前方、やや右寄り
      gripPos = chestPos.add(forward.scale(0.3)).add(charRight.scale(0.1));
      // 武器は前方やや下を向く
      weaponDir = forward.scale(0.7).add(Vector3.Down().scale(0.3)).normalize();
      break;
    }
    case 'side': {
      // 右側面に自然に下げる: グリップは腰の右横
      const hipPos = getWorldPos(hips);
      gripPos = hipPos.add(charRight.scale(0.25)).add(new Vector3(0, -0.05, 0));
      // 武器は真下を向く
      weaponDir = Vector3.Down();
      break;
    }
    case 'overhead': {
      // 頭上に振りかぶり: グリップは頭上やや後方
      const headBone = character.combatBones.get('head');
      const headPos = headBone ? getWorldPos(headBone) : chestPos.add(new Vector3(0, 0.3, 0));
      gripPos = headPos.add(new Vector3(0, 0.15, 0)).add(forward.scale(-0.1)).add(charRight.scale(0.05));
      // 武器は後方下向き (振りかぶった状態)
      weaponDir = forward.scale(-0.5).add(Vector3.Down().scale(0.5)).normalize();
      break;
    }
  }

  // 右手IKターゲット: 画面右手 = Mixamo leftArm チェーン
  const weaponShoulderPos = getWorldPos(character.ikChains.leftArm.root); // 画面右肩
  const shoulderToGrip = gripPos.subtract(weaponShoulderPos).normalize();
  const rightTarget = gripPos.subtract(shoulderToGrip.scale(PALM_OFFSET));

  // 左手IKターゲット (off-hand): 画面左手 = Mixamo rightArm チェーン
  let leftTarget: Vector3 | null = null;
  if (weapon.gripType === 'two-handed') {
    const pommelDir = weaponDir.scale(-1);
    const offHandWorld = gripPos.add(pommelDir.scale(weapon.offHandOffset.y));
    const offHandShoulderPos = getWorldPos(character.ikChains.rightArm.root); // 画面左肩
    const offShoulderToOff = offHandWorld.subtract(offHandShoulderPos).normalize();
    leftTarget = offHandWorld.subtract(offShoulderToOff.scale(PALM_OFFSET));
  }

  return { rightTarget, leftTarget, weaponDir };
}

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
  /** All Mixamo bones by name (e.g. "mixamorig:Hips") */
  allBones: Map<string, TransformNode>;
  /** Combat-compatible bones by short name (e.g. "hips", "leftArm") */
  combatBones: Map<string, TransformNode>;
  /** Voxel body meshes for each body part */
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
  /** T-pose foot world rotations (for keeping feet flat after IK) */
  footBaseWorldRot: { left: Quaternion; right: Quaternion };
  /** Weapon */
  weapon: WeaponPhysics | null;
  weaponSwing: WeaponSwingState;
  /** 武器メッシュ (デバッグ用ボックス) */
  weaponMesh: Mesh | null;
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

export function getWorldPos(node: TransformNode): Vector3 {
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
 */
export function solveIK2Bone(chain: IKChain, character: HavokCharacter): void {
  if (chain.weight <= 0) return;

  const { root, mid, end, lengthA, lengthB, target, poleHint } = chain;

  // Use T-pose rotations stored at character creation (never overwritten)
  const chainKey = root.name;
  const baseRots = character.ikBaseRotations.get(chainKey);
  if (!baseRots) return; // safety: should never happen

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

  // ─── Weapon attach points ───
  // Babylon.js左手座標系: Mixamo Left = 画面右手, Mixamo Right = 画面左手
  const weaponAttachR = new TransformNode(`${prefix}_weaponR`, scene);
  const visualRightHand = combatBones.get('leftHand'); // Mixamo Left = 画面右手
  if (visualRightHand) { weaponAttachR.parent = visualRightHand; weaponAttachR.position.set(0, 0.064, 0.035); }

  const weaponAttachL = new TransformNode(`${prefix}_weaponL`, scene);
  const visualLeftHand = combatBones.get('rightHand'); // Mixamo Right = 画面左手
  if (visualLeftHand) { weaponAttachL.parent = visualLeftHand; weaponAttachL.position.set(0, 0.064, 0.035); }

  // 手のひらデバッグ球: 親指付け根 + 小指根元 (両手)
  // bone-data.json localPos (FBX cm) → meters (scale=0.01)
  const palmMarkerMat = new StandardMaterial(`${prefix}_palmMarkerMat`, scene);
  palmMarkerMat.diffuseColor = new Color3(1, 0.2, 0.8);
  palmMarkerMat.alpha = 0.8;

  const palmMarkerPositions: { hand: TransformNode | undefined; localPos: [number, number, number] }[] = [
    // 画面右手 (=Mixamo LeftHand): 人差し指根元寄り
    { hand: allBones.get('mixamorig:LeftHand'), localPos: [-0.028, 0.100, 0.025] },
    // 画面右手 (=Mixamo LeftHand): 薬指根元寄り
    { hand: allBones.get('mixamorig:LeftHand'), localPos: [0.022, 0.098, 0.025] },
    // 画面左手 (=Mixamo RightHand): 人差し指根元寄り
    { hand: allBones.get('mixamorig:RightHand'), localPos: [0.028, 0.100, 0.025] },
    // 画面左手 (=Mixamo RightHand): 薬指根元寄り
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

  // Foot planting state
  const footPlant = { leftLocked: null as Vector3 | null, rightLocked: null as Vector3 | null };

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
    ikChains, footPlant, debug,
    ikBaseRotations: new Map(),
    initialFootY: { left: 0, right: 0 },
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

  const lFoot = chains.leftLeg.end.getAbsolutePosition().clone();
  const rFoot = chains.rightLeg.end.getAbsolutePosition().clone();

  fp.leftLocked = new Vector3(lFoot.x, initFY.left * factor, lFoot.z);
  fp.rightLocked = new Vector3(rFoot.x, initFY.right * factor, rFoot.z);
  chains.leftLeg.target.copyFrom(fp.leftLocked);
  chains.rightLeg.target.copyFrom(fp.rightLocked);

  // Update IK chain lengths (bone lengths changed with scale)
  for (const chain of [chains.leftLeg, chains.rightLeg, chains.leftArm, chains.rightArm]) {
    chain.root.computeWorldMatrix(true);
    chain.mid.computeWorldMatrix(true);
    chain.end.computeWorldMatrix(true);
    chain.lengthA = Vector3.Distance(chain.root.getAbsolutePosition().clone(), chain.mid.getAbsolutePosition().clone());
    chain.lengthB = Vector3.Distance(chain.mid.getAbsolutePosition().clone(), chain.end.getAbsolutePosition().clone());
  }

  // T-pose base rotations are preserved (they don't change with scale)
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

// ─── Foot Horizontal Lock ────────────────────────────────

/**
 * After IK bends the leg, the foot bone rotates with the shin.
 * This resets the foot to its T-pose world orientation (flat on ground).
 */
function keepFootHorizontal(footBone: TransformNode, tposeWorldRot: Quaternion): void {
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

// ─── Weapon System ───────────────────────────────────────

/**
 * 武器を装備する。
 * weaponMesh が指定されればそれを使用、なければデバッグ用ボックスを生成。
 */
export function equipWeapon(
  scene: Scene, character: HavokCharacter, weapon: WeaponPhysics,
  stance: StanceType = 'front',
  weaponMesh?: Mesh,
): void {
  // 既存の武器メッシュを破棄
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }

  character.weapon = weapon;

  if (weaponMesh) {
    // 外部から渡されたメッシュを使用 (attach位置は呼び出し元で設定済み)
    weaponMesh.parent = character.weaponAttachR;
    character.weaponMesh = weaponMesh;
  } else {
    // デバッグ用ボックス: attach位置をデフォルトに戻す
    character.weaponAttachR.position.set(0, 0.064, 0.035);
    const mesh = MeshBuilder.CreateBox(
      `${character.root.name}_weapon`,
      { width: 0.03, height: weapon.length, depth: 0.03 },
      scene,
    );
    const mat = new StandardMaterial(`${character.root.name}_weaponMat`, scene);
    mat.diffuseColor = new Color3(0.8, 0.8, 0.2);
    mat.specularColor = new Color3(0.3, 0.3, 0.1);
    mesh.material = mat;
    mesh.parent = character.weaponAttachR;
    mesh.position.set(0, -weapon.length / 2, 0);
    character.weaponMesh = mesh;
  }

  // 構えを適用
  applyStance(character, stance);
}

/**
 * 構えを適用する: IKターゲットと武器の向きを設定
 */
function applyStance(character: HavokCharacter, stance: StanceType): void {
  const weapon = character.weapon;
  if (!weapon) return;

  const swing = character.weaponSwing;
  swing.stance = stance;

  const { rightTarget, leftTarget, weaponDir } = getStanceTargets(character, stance, weapon);
  swing.baseHandPos = rightTarget.clone();
  swing.smoothedTarget = rightTarget.clone();

  // 画面右手 = Mixamo leftArm チェーン (weapon hand)
  character.ikChains.leftArm.target.copyFrom(rightTarget);
  character.ikChains.leftArm.weight = 1;

  // 画面左手 = Mixamo rightArm チェーン (off-hand)
  if (weapon.gripType === 'two-handed' && leftTarget) {
    character.ikChains.rightArm.target.copyFrom(leftTarget);
    character.ikChains.rightArm.weight = 1;
  }

  // 武器の向きを設定 (directPlacement の場合はメッシュに直接配置済みなのでスキップ)
  if (!weapon.directPlacement) {
    setWeaponDirection(character, weaponDir);
  }

  const tipWorld = getWeaponTipWorld(character);
  swing.prevTipPos.copyFrom(tipWorld);
  swing.tipSpeed = 0;
  swing.power = 0;
  swing.swinging = false;
}

/**
 * 武器の向きを設定する (2軸アラインメント)。
 * weaponDir: 武器先端が向くワールド方向 (正規化)
 *
 * 1. 武器の localTipDir を weaponDir に合わせる (tip方向)
 * 2. 武器の localGripAxis を手のひらのグリップ軸に合わせる (ロール制御)
 */
function setWeaponDirection(character: HavokCharacter, weaponDir: Vector3): void {
  const attach = character.weaponAttachR;
  const parent = attach.parent as TransformNode;
  const weapon = character.weapon;
  if (!parent || !weapon) return;

  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  // ─── Step 1: tip方向を合わせる ───
  const rot1 = rotationBetweenVectors(weapon.localTipDir, weaponDir);

  // ─── Step 2: グリップ軸のロールを合わせる ───
  // rot1 適用後の武器グリップ軸がどこを向くか計算
  const rotatedGripAxis = weapon.localGripAxis.clone();
  // Quaternion で回転: v' = q * v * q^-1
  const rot1Conj = rot1.clone(); rot1Conj.invertInPlace();
  const tempQ = rot1.multiply(new Quaternion(rotatedGripAxis.x, rotatedGripAxis.y, rotatedGripAxis.z, 0)).multiply(rot1Conj);
  const rotatedGrip = new Vector3(tempQ.x, tempQ.y, tempQ.z).normalize();

  // 手のひらのグリップ軸 (lower→upper) をワールド空間で計算
  // 手のひらのポイントは hand local space なので、parent world rotation で変換
  const palmUpper = PALM_GRIP_POINTS.left_upper;
  const palmLower = PALM_GRIP_POINTS.left_lower;
  const palmAxisLocal = palmUpper.subtract(palmLower).normalize();
  // hand local → world
  const palmAxisQ = parentWorldRot.multiply(
    new Quaternion(palmAxisLocal.x, palmAxisLocal.y, palmAxisLocal.z, 0),
  ).multiply(parentInv);
  const palmAxisWorld = new Vector3(palmAxisQ.x, palmAxisQ.y, palmAxisQ.z).normalize();

  // rotatedGrip を palmAxisWorld に合わせるツイスト回転 (weaponDir軸周り)
  // rotatedGrip と palmAxisWorld を weaponDir に直交する平面に射影
  const projRotated = rotatedGrip.subtract(weaponDir.scale(Vector3.Dot(rotatedGrip, weaponDir))).normalize();
  const projPalm = palmAxisWorld.subtract(weaponDir.scale(Vector3.Dot(palmAxisWorld, weaponDir))).normalize();

  let rot2 = Quaternion.Identity();
  if (projRotated.length() > 0.001 && projPalm.length() > 0.001) {
    rot2 = rotationBetweenVectors(projRotated, projPalm);
  }

  // 合成: まず tip方向を合わせ、次にツイスト
  const worldRot = rot2.multiply(rot1);

  // 親のローカル空間に変換
  attach.rotationQuaternion = parentInv.multiply(worldRot);
}

/**
 * 構えを変更する (装備中に呼び出し)
 */
export function setStance(character: HavokCharacter, stance: StanceType): void {
  if (!character.weapon) return;
  applyStance(character, stance);
}

/**
 * 武器を外す
 */
export function unequipWeapon(character: HavokCharacter): void {
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }
  character.weapon = null;
  character.weaponSwing = createWeaponSwingState();
}

// ─── Game-Assets Weapon Loader ────────────────────────────

export interface GameAssetWeaponInfo {
  category: string;
  pieceKey: string;
  gripPosition: { x: number; y: number; z: number };
  secondaryGripPosition: { x: number; y: number; z: number } | null;
  tipPosition: { x: number; y: number; z: number };
  pommelPosition: { x: number; y: number; z: number };
  weight: number;       // grams
  defaultGrip: string;  // 'one_hand' | 'two_hand'
  switchable: boolean;
  attackVoxels: Record<string, string>;
}

/** 手のひらグリップポイント (hand bone local space) */
export const PALM_GRIP_POINTS = {
  // tip側 (人差し指根元付近)
  right_upper: new Vector3(0.028, 0.100, 0.025),
  // pommel側 (薬指根元付近)
  right_lower: new Vector3(-0.022, 0.098, 0.025),
  left_upper: new Vector3(-0.028, 0.100, 0.025),
  left_lower: new Vector3(0.022, 0.098, 0.025),
};

/**
 * /api/configured-weapons から設定済み武器一覧を取得
 */
export async function fetchGameAssetWeapons(): Promise<GameAssetWeaponInfo[]> {
  try {
    const resp = await fetch('/api/configured-weapons');
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.weapons ?? [];
  } catch {
    return [];
  }
}

/**
 * Game-assetsから武器の.voxモデルを読み込み、
 * 2つのグリップポイントを手のひらの2点に合わせて装備する。
 */
export async function equipGameAssetWeapon(
  scene: Scene,
  character: HavokCharacter,
  info: GameAssetWeaponInfo,
  stance: StanceType = 'front',
): Promise<void> {
  const voxUrl = `/api/game-assets/wapons/${info.category}/${info.pieceKey}/${info.pieceKey}.vox`;

  const resp = await fetch(voxUrl);
  if (!resp.ok) throw new Error(`Failed to load ${voxUrl}: ${resp.status}`);
  const model = parseVox(await resp.arrayBuffer());

  // ボクセル座標 → メートル
  const v2m = (p: { x: number; y: number; z: number }) =>
    new Vector3(p.x * VOX_SCALE, p.y * VOX_SCALE, p.z * VOX_SCALE);

  const primaryGrip = v2m(info.gripPosition);
  const tip = v2m(info.tipPosition);
  const pommel = v2m(info.pommelPosition);

  // secondary grip (なければ primary から pommel方向に少しずらす)
  const secondaryGrip = info.secondaryGripPosition
    ? v2m(info.secondaryGripPosition)
    : Vector3.Lerp(primaryGrip, pommel, 0.15);

  // tip側のグリップ = tipに近い方
  const primaryToTip = Vector3.Distance(primaryGrip, tip);
  const secondaryToTip = Vector3.Distance(secondaryGrip, tip);
  const gripTipSide = primaryToTip < secondaryToTip ? primaryGrip : secondaryGrip;
  const gripPommelSide = primaryToTip < secondaryToTip ? secondaryGrip : primaryGrip;

  // 武器の長さ
  const length = Vector3.Distance(primaryGrip, tip);
  const pommelDist = Vector3.Distance(primaryGrip, pommel);

  // ─── 手のひら2点とのアラインメント ───
  // hand local space の2点
  // 画面右手 = Mixamo LeftHand → left_* ポイントを使用
  const palmUpper = PALM_GRIP_POINTS.left_upper; // 人差し指根元 = tip側
  const palmLower = PALM_GRIP_POINTS.left_lower; // 薬指根元 = pommel側
  const palmMid = Vector3.Lerp(palmUpper, palmLower, 0.5);

  // 武器グリップ軸 (pommel側 → tip側) と 手のひら軸 (lower → upper)
  const weaponGripAxis = gripTipSide.subtract(gripPommelSide).normalize();
  const palmGripAxis = palmUpper.subtract(palmLower).normalize();

  // ─── メッシュ構築: primaryGrip を原点 (回転なし) ───
  const gripToTip = tip.subtract(primaryGrip).normalize();
  const mesh = buildVoxWeaponMesh(scene, model, primaryGrip, gripToTip, character.root.name);

  // ─── 2点アラインメント: 武器グリップ2点 → 手のひら2点 ───
  // 武器グリップ点 (mesh local, primaryGrip=原点)
  const wA = gripTipSide.subtract(primaryGrip).scale(VOX_SCALE / VOX_SCALE); // already in meters via v2m
  // wait - gripTipSide is already in meters from v2m, and primaryGrip is mesh origin
  const weaponPtTip = gripTipSide.subtract(primaryGrip);   // tip側grip in mesh local
  const weaponPtPommel = gripPommelSide.subtract(primaryGrip); // pommel側grip in mesh local

  // 武器グリップ軸 (pommel→tip)
  const weaponGripDir = weaponPtTip.subtract(weaponPtPommel).normalize();
  // 手のひらグリップ軸 (lower→upper)
  const palmGripDir = palmUpper.subtract(palmLower).normalize();

  // 回転: weaponGripDir → palmGripDir
  const alignRot = rotationBetweenVectors(weaponGripDir, palmGripDir);

  // 回転後の武器グリップ中点
  const weaponMid = Vector3.Lerp(weaponPtTip, weaponPtPommel, 0.5);
  // Quaternionでベクトルを回転
  const rotConj = alignRot.clone(); rotConj.invertInPlace();
  const wMidQ = alignRot.multiply(new Quaternion(weaponMid.x, weaponMid.y, weaponMid.z, 0)).multiply(rotConj);
  const rotatedWeaponMid = new Vector3(wMidQ.x, wMidQ.y, wMidQ.z);

  // 平行移動: 回転後の中点 → 手のひら中点
  const translation = palmMid.subtract(rotatedWeaponMid);

  // weaponAttachRをidentityにリセットし、メッシュ自体に変換を適用
  character.weaponAttachR.position.set(0, 0, 0);
  character.weaponAttachR.rotationQuaternion = Quaternion.Identity();
  mesh.rotationQuaternion = alignRot;
  mesh.position.copyFrom(translation);

  // ─── WeaponPhysics ───
  const weapon: WeaponPhysics = {
    weight: info.weight / 1000,
    length,
    gripType: info.defaultGrip === 'two_hand' ? 'two-handed' : 'one-handed',
    attackPoint: new Vector3(0, -length, 0),
    gripOffset: Vector3.Zero(),
    offHandOffset: new Vector3(0, pommelDist * 0.3, 0),
    localTipDir: gripToTip,
    localGripAxis: weaponGripDir,
    directPlacement: true,
  };

  // equipWeaponを使うがsetWeaponDirectionは適用しない (メッシュに直接配置済み)
  // 既存の武器を破棄
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }
  character.weapon = weapon;
  mesh.parent = character.weaponAttachR;
  character.weaponMesh = mesh;

  // IKターゲットのみ applyStance で設定
  applyStance(character, stance);
}

/**
 * ボクセルデータから武器メッシュを構築。
 * grip位置を原点に、grip→tip方向をlocal Y-に揃える。
 */
function buildVoxWeaponMesh(
  scene: Scene,
  model: ReturnType<typeof parseVox>,
  grip: Vector3,
  localDir: Vector3,
  prefix: string,
): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const occupied = new Set<string>();
  for (const v of model.voxels) {
    occupied.add(`${v.x},${v.y},${v.z}`);
  }

  const faceDirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const faceVerts = [
    [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
    [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],
  ];

  for (const v of model.voxels) {
    const col = model.palette[v.colorIndex - 1] ?? { r: 0.8, g: 0.8, b: 0.8 };
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = faceDirs[f];
      if (occupied.has(`${v.x+dx},${v.y+dy},${v.z+dz}`)) continue;

      const baseIdx = positions.length / 3;
      for (const [vx, vy, vz] of faceVerts[f]) {
        // ボクセル座標をメートルに変換し、grip位置を原点にする
        positions.push(
          (v.x + vx) * VOX_SCALE - grip.x,
          (v.y + vy) * VOX_SCALE - grip.y,
          (v.z + vz) * VOX_SCALE - grip.z,
        );
        normals.push(dx, dy, dz);
        colors.push(col.r, col.g, col.b, 1);
      }
      indices.push(baseIdx, baseIdx+1, baseIdx+2, baseIdx, baseIdx+2, baseIdx+3);
    }
  }

  const mesh = new Mesh(`${prefix}_voxWeapon`, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  // マテリアル
  const mat = new StandardMaterial(`${prefix}_voxWeaponMat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  mesh.material = mat;
  mesh.hasVertexAlpha = false;

  // メッシュ回転なし: 武器の向きは setWeaponDirection で一括制御
  // localDir (grip→tip方向) は WeaponPhysics.localTipDir に記録して使う
  return mesh;
}

/**
 * 武器先端のワールド位置を取得
 */
export function getWeaponTipWorld(character: HavokCharacter): Vector3 {
  if (!character.weapon) return getWorldPos(character.weaponAttachR);

  character.weaponAttachR.computeWorldMatrix(true);
  const tipLocal = character.weapon.attackPoint;
  return Vector3.TransformCoordinates(tipLocal, character.weaponAttachR.getWorldMatrix());
}

/**
 * 慣性シミュレーション: weightが重いほどIKターゲットの追従が遅れる。
 * desiredTarget: プレイヤーが指定した目標位置
 * dt: デルタタイム (秒)
 */
export function updateWeaponInertia(
  character: HavokCharacter,
  desiredTarget: Vector3,
  dt: number,
): void {
  // 画面右手 = Mixamo leftArm チェーン
  const weapon = character.weapon;
  if (!weapon) {
    character.ikChains.leftArm.target.copyFrom(desiredTarget);
    return;
  }

  const swing = character.weaponSwing;

  const inertiaFactor = 1.0 / (1.0 + weapon.weight * 2.0);
  const lerpSpeed = inertiaFactor * 10.0;
  const t = Math.min(1.0, lerpSpeed * dt);

  Vector3.LerpToRef(swing.smoothedTarget, desiredTarget, t, swing.smoothedTarget);

  character.ikChains.leftArm.target.copyFrom(swing.smoothedTarget);
}

/**
 * 攻撃威力の算出: 先端移動距離 × weight
 * 毎フレーム呼び出し、スイング中の累積値を返す。
 */
export function updateWeaponPower(character: HavokCharacter, dt: number): number {
  const weapon = character.weapon;
  if (!weapon) return 0;

  const swing = character.weaponSwing;
  const tipWorld = getWeaponTipWorld(character);

  // 先端の移動距離
  const dist = Vector3.Distance(tipWorld, swing.prevTipPos);
  swing.tipSpeed = dt > 0 ? dist / dt : 0;

  // 威力累積 (スイング中のみ)
  if (swing.swinging) {
    swing.power += dist * weapon.weight;
  }

  // 前フレーム位置を更新
  swing.prevTipPos.copyFrom(tipWorld);

  return swing.power;
}

/**
 * スイング開始
 */
export function startSwing(character: HavokCharacter): void {
  const swing = character.weaponSwing;
  swing.swinging = true;
  swing.power = 0;
}

/**
 * スイング終了 → 累積威力を返す
 */
export function endSwing(character: HavokCharacter): number {
  const swing = character.weaponSwing;
  const finalPower = swing.power;
  swing.swinging = false;
  swing.power = 0;
  return finalPower;
}

/**
 * 両手持ち武器で画面左手(off-hand)を切替。
 * release=true で片手持ち(off-hand フリー)、false で両手持ちに戻す。
 * 画面左手 = Mixamo rightArm チェーン
 */
export function releaseOffHand(character: HavokCharacter, release: boolean): void {
  const weapon = character.weapon;
  if (!weapon || weapon.gripType !== 'two-handed') return;

  if (release) {
    character.ikChains.rightArm.weight = 0;
  } else {
    character.ikChains.rightArm.weight = 1;
    const tipWorld = getWeaponTipWorld(character);
    const handWorld = getWorldPos(character.weaponAttachR);
    Vector3.LerpToRef(handWorld, tipWorld, 0.3, character.ikChains.rightArm.target);
  }
}

// ─── Per-Frame Update ────────────────────────────────────

export function updateHavokCharacter(scene: Scene, character: HavokCharacter, dt?: number): void {
  // Solve leg IK (foot planting targets set once via initFootPlanting)
  const chains = character.ikChains;
  solveIK2Bone(chains.leftLeg, character);
  solveIK2Bone(chains.rightLeg, character);
  // Arm IK only when targets are set (weight > 0)
  solveIK2Bone(chains.leftArm, character);
  solveIK2Bone(chains.rightArm, character);

  // Keep feet flat on ground after IK
  keepFootHorizontal(chains.leftLeg.end, character.footBaseWorldRot.left);
  keepFootHorizontal(chains.rightLeg.end, character.footBaseWorldRot.right);

  // Weapon power calculation
  updateWeaponPower(character, dt ?? (1 / 60));

  // 両手持ち時の画面左手(off-hand)追従: Mixamo rightArm チェーン
  if (character.weapon && character.weapon.gripType === 'two-handed'
      && character.ikChains.rightArm.weight > 0) {
    character.weaponAttachR.computeWorldMatrix(true);
    const offLocal = character.weapon.offHandOffset;
    const offWorld = Vector3.TransformCoordinates(offLocal, character.weaponAttachR.getWorldMatrix());
    const offShoulderPos = getWorldPos(character.ikChains.rightArm.root); // 画面左肩
    const dir = offWorld.subtract(offShoulderPos).normalize();
    character.ikChains.rightArm.target.copyFrom(offWorld.subtract(dir.scale(PALM_OFFSET)));
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
