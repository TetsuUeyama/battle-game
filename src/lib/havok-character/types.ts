/**
 * Havok Character System — Type definitions, interfaces, and constants.
 */
import {
  Vector3, Color3, Mesh, TransformNode, Quaternion,
} from '@babylonjs/core';
import { PhysicsBody } from '@babylonjs/core/Physics/v2';

// ─── Weapon Types ────────────────────────────────────────

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
  /** 武器カテゴリ (e.g. 'halberds', 'greatswords', 'axes') — 攻撃タイプ選択に使用 */
  category?: string;
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

// ─── Bone Types ──────────────────────────────────────────

export interface BoneEntry {
  name: string;
  parent: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  preRotation: [number, number, number];
  worldPosition: [number, number, number];
}

export interface BoneDataFile {
  globalSettings: { upAxis: number; unitScaleFactor: number };
  bones: BoneEntry[];
}

// ─── IK ──────────────────────────────────────────────────

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

// ─── Jump System ─────────────────────────────────────────

export type JumpPhase = 'none' | 'crouch' | 'airborne' | 'landing';

export interface JumpState {
  /** ジャンプ中か */
  active: boolean;
  /** 現在のフェーズ */
  phase: JumpPhase;
  /** フェーズ内タイマー (秒) */
  phaseTimer: number;
  /** 垂直速度 (m/s) */
  velocityY: number;
  /** 現在の高さオフセット (m) */
  heightOffset: number;
  /** 重力 (m/s²) */
  gravity: number;
  /** ジャンプ初速 (m/s) */
  jumpVelocity: number;
  /** 水平慣性速度 (world space, m/s) — 走り中のジャンプで引き継ぐ */
  horizontalVelocity: Vector3;
  /** 溜め量 (0-1): 溜め時間に比例して跳躍力が変わる */
  crouchPower: number;
}

export function createJumpState(): JumpState {
  return {
    active: false,
    phase: 'none' as JumpPhase,
    phaseTimer: 0,
    velocityY: 0,
    heightOffset: 0,
    gravity: 9.8,
    jumpVelocity: 4.0,
    horizontalVelocity: Vector3.Zero(),
    crouchPower: 0,
  };
}

// ─── Balance System ──────────────────────────────────────

export interface BalanceState {
  /** 現在の重心逸脱度 (0=安定, >0=不安定) */
  deviation: number;
  /** よろめき中か */
  staggered: boolean;
  /** よろめき残り時間 */
  staggerTimer: number;
  /** よろめきの方向 (重心がずれた方向) */
  staggerDir: Vector3;
  /** よろめきの強度 */
  staggerIntensity: number;
}

export function createBalanceState(): BalanceState {
  return {
    deviation: 0,
    staggered: false,
    staggerTimer: 0,
    staggerDir: Vector3.Zero(),
    staggerIntensity: 0,
  };
}

// ─── Foot System ─────────────────────────────────────────

/** 片足のステップ状態 */
export interface FootStep {
  /** 現在の接地位置 (world space) */
  planted: Vector3;
  /** ステップ中の目標位置 */
  target: Vector3;
  /** ステップ中か */
  stepping: boolean;
  /** ステップ進行度 0→1 */
  progress: number;
  /** ステップ開始位置 */
  liftPos: Vector3;
}

/** 両足のステッピングシステム */
export interface FootStepper {
  left: FootStep;   // LeftFoot (左足)
  right: FootStep;  // RightFoot (右足)
  /** ステップ発動距離 (m) */
  stepThreshold: number;
  /** ステップ時の足の持ち上げ高さ (m) */
  stepHeight: number;
  /** ステップにかかる時間 (秒) */
  stepDuration: number;
  /** スタンス幅の半分 (m, 腰からの左右オフセット) */
  stanceHalfWidth: number;
}

// ─── Debug ───────────────────────────────────────────────

export interface DebugVisuals {
  comSphere: Mesh;
  supportLines: Mesh | null;
  balanceLine: Mesh | null;
  enabled: boolean;
}

// ─── HavokCharacter ──────────────────────────────────────

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
  /** Foot stepping system */
  footPlant: { leftLocked: Vector3 | null; rightLocked: Vector3 | null };
  footStepper: FootStepper;
  /** Jump state */
  jumpState: JumpState;
  /** Balance system */
  balance: BalanceState;
  /** IK base rotations (instance-level) */
  ikBaseRotations: Map<string, { root: Quaternion; mid: Quaternion }>;
  /** Initial foot Y positions (for scaling) */
  initialFootY: { left: number; right: number };
  /** Hipsボーンの基準Y位置 (沈み込み防止用) */
  hipsBaseY: number;
  /** T-pose foot world rotations (for keeping feet flat after IK) */
  footBaseWorldRot: { left: Quaternion; right: Quaternion };
  /** Weapon */
  weapon: WeaponPhysics | null;
  weaponSwing: WeaponSwingState;
  /** 武器メッシュ (デバッグ用ボックス) */
  weaponMesh: Mesh | null;
  /** 現在のBodyMotion状態 (レート制限用) */
  currentBodyMotion: BodyMotion;
  /** 前フレームのボーン回転 (レート制限用) */
  prevBoneRotations: Map<string, Quaternion>;
  /** 前フレームのボーン位置Y (レート制限用) */
  prevBonePosY: Map<string, number>;
  /** Debug */
  debug: DebugVisuals;
}

// ─── Body Part Definitions ───────────────────────────────

export interface BodyPartDef {
  bone: string;      // parent Mixamo bone
  childBone: string; // child bone (to measure length for offset)
  size: [number, number, number]; // [w, h, d] in meters (h is overridden by bone length)
  thickness: number; // w and d override (cross-section size)
  skin?: boolean;
}

export const BODY_PARTS: Record<string, BodyPartDef> = {
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

/** Short name → Mixamo bone name */
export const COMBAT_BONE_MAP: Record<string, string> = {
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

// ─── Character Options ───────────────────────────────────

export interface CreateCharacterOptions {
  bodyColor: Color3;
  prefix: string;
  position?: Vector3;
  enablePhysics?: boolean;
  enableDebug?: boolean;
}

// ─── Swing Motion Types ──────────────────────────────────

export type SwingType = 'vertical' | 'horizontal' | 'horizontal_r2l' | 'horizontal_l2r' | 'thrust';

/** 胴体・下半身のモーションデータ */
export interface BodyMotion {
  /** 胴体の前傾角度 (ラジアン, + = 前傾) */
  torsoLean: number;
  /** 胴体のツイスト角度 (ラジアン, + = 右回転) */
  torsoTwist: number;
  /** 腰のY方向オフセット (m, - = しゃがみ) */
  hipsOffset: number;
  /** 腰の前方オフセット (m) */
  hipsForward: number;
  /** 右足(画面右)の前方踏み出し (m) */
  footStepR: number;
  /** オフハンド(左手)のオフセット [forward, up, right] (m) */
  offHandOffset: Vector3;
}

export interface SwingMotion {
  type: SwingType;
  progress: number;
  duration: number;
  windupRatio: number;
  startPos: Vector3;
  windupPos: Vector3;
  strikePos: Vector3;
  active: boolean;
  /** パワー (0-1) */
  power: number;
  /** 振りかぶり時のボディモーション */
  windupBody: BodyMotion;
  /** 打撃時のボディモーション */
  strikeBody: BodyMotion;
  /** キャラ相対座標 (rootからのオフセット) */
  startOffset: Vector3;
  windupOffset: Vector3;
  strikeOffset: Vector3;
  /** モーション開始時のキャラroot位置 */
  rootPosAtStart: Vector3;
  /** 踏み込み距離 (m)。打撃フェーズ中にこの距離だけ前方に移動する */
  stepInDistance: number;
  /** 踏み込み方向 (正規化済み) */
  stepInDir: Vector3;
  /** ワールド空間の打撃目標位置 */
  worldStrikePos?: Vector3;
  /** ワールド空間の振りかぶり位置 */
  worldWindupPos?: Vector3;
  /** 肩位置の root からのオフセット (円弧補間用) */
  shoulderOffset?: Vector3;
  /** 弧を描く攻撃 (horizontal用) */
  arcSwing?: {
    /** 弧の中心 (root相対) = 肩位置 */
    centerOffset: Vector3;
    /** 弧の半径 (腕の長さ) */
    radius: number;
    /** 振りかぶり角度 (ラジアン, 右が正) */
    windupAngle: number;
    /** 打撃終了角度 (ラジアン, 左が負) */
    strikeAngle: number;
    /** 弧の高さ (Y位置, root相対) */
    height: number;
  };
}

export interface SwingFrame {
  handTarget: Vector3;
  body: BodyMotion;
}

/** ニュートラルなボディモーション */
export function neutralBody(): BodyMotion {
  return { torsoLean: 0, torsoTwist: 0, hipsOffset: 0, hipsForward: 0, footStepR: 0, offHandOffset: Vector3.Zero() };
}

// ─── Combat AI Types ─────────────────────────────────────

export type CombatAIState = 'idle' | 'pursue' | 'circle' | 'close_in' | 'attack' | 'retreat' | 'recover' | 'guard' | 'swing_defence' | 'avoidance';
export type CombatAIMode = 'target' | 'character'; // 標的追尾 or 対キャラ

export interface CombatAI {
  state: CombatAIState;
  mode: CombatAIMode;
  /** 標的の TransformNode */
  targetNode: TransformNode;
  /** 対戦相手のキャラクター (mode='character'時) */
  targetCharacter: HavokCharacter | null;
  /** 攻撃射程 (m) */
  attackRange: number;
  /** 追尾開始距離 (m) */
  pursueRange: number;
  /** 歩き速度 (m/s) */
  walkSpeed: number;
  /** 走り速度 (m/s) */
  runSpeed: number;
  /** 走り切替距離 (m, これ以上離れていたら走る) */
  runThreshold: number;
  /** 攻撃後の回復時間 (秒) */
  recoverTime: number;
  /** 回復タイマー */
  recoverTimer: number;
  /** 安全距離 (相手の攻撃が届かない距離) */
  safeRange: number;
  /** circle時の横移動方向 (1=右, -1=左) */
  circleDir: number;
  /** circleタイマー */
  circleTimer: number;
  /** retreat速度 */
  retreatSpeed: number;
  /** 現在のスイングモーション */
  currentMotion: SwingMotion | null;
  /** 攻撃タイプのローテーション */
  attackIndex: number;
  /** 有効か */
  enabled: boolean;
  /** コンボ: 残り追加攻撃回数 */
  comboRemaining: number;
  /** コンボ: 1セットの最大攻撃回数 */
  maxCombo: number;
  /** 防御専用モード (攻撃しない、ガード/防御スイング/回避のみ) */
  defenseOnly: boolean;
}

/** 標的のランダム移動 */
export interface TargetMover {
  node: TransformNode;
  waypoint: Vector3;
  speed: number;
  changeTimer: number;
  changeInterval: number;
  boundsMin: Vector3;
  boundsMax: Vector3;
}

// ─── Clash Types ─────────────────────────────────────────

export interface ClashState {
  /** よろめき中か */
  staggered: boolean;
  /** 残り時間 (秒) */
  timer: number;
  /** 押し戻し方向 (world, 正規化) */
  pushDir: Vector3;
  /** 押し戻し強度 */
  pushForce: number;
  /** 揺れの強度 (時間で減衰) */
  wobbleIntensity: number;
}

export function createClashState(): ClashState {
  return { staggered: false, timer: 0, pushDir: Vector3.Zero(), pushForce: 0, wobbleIntensity: 0 };
}

// ─── Game Asset Weapon Types ─────────────────────────────

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

// ─── Bezier Types ────────────────────────────────────────

export interface BezierAttackPath {
  controlPoints: Vector3[];
  resolvedSwingType: SwingType;
}

// ─── Shared Constants ────────────────────────────────────

/** 手のひら中心オフセット (IK end bone=手首 → 手のひら中心まで 約0.064m) */
export const PALM_OFFSET = 0.064;

/** 手のひらグリップポイント (hand bone local space) */
export const PALM_GRIP_POINTS = {
  // tip側 (人差し指根元付近) — Babylon.js左手系のボーンローカル空間
  right_upper: new Vector3(0.028, 0.100, -0.025),
  // pommel側 (薬指根元付近)
  right_lower: new Vector3(-0.022, 0.098, -0.025),
  left_upper: new Vector3(-0.028, 0.100, -0.025),
  left_lower: new Vector3(0.022, 0.098, -0.025),
};

export const COM_WEIGHTS: Record<string, number> = {
  hips: 0.20, torso: 0.20, head: 0.08,
  leftArm: 0.05, rightArm: 0.05,
  leftHand: 0.01, rightHand: 0.01,
  leftLeg: 0.10, rightLeg: 0.10,
  leftFoot: 0.015, rightFoot: 0.015,
};

/** 関節の曲がり角度制限 (度数) */
export interface JointLimits {
  /** 最小曲げ角 (0 = 完全に伸びた状態) */
  minBendDeg: number;
  /** 最大曲げ角 */
  maxBendDeg: number;
}

/** 各IKチェーンの関節制限 */
export const JOINT_LIMITS: Record<string, { root: JointLimits; mid: JointLimits }> = {
  // 肘: 0°(伸展) 〜 150°(屈曲)
  arm: {
    root: { minBendDeg: 0, maxBendDeg: 170 }, // 肩はほぼ自由
    mid:  { minBendDeg: 5, maxBendDeg: 150 },  // 肘
  },
  // 膝: 0°(伸展) 〜 140°(屈曲)
  leg: {
    root: { minBendDeg: 0, maxBendDeg: 120 }, // 股関節
    mid:  { minBendDeg: 5, maxBendDeg: 140 },  // 膝
  },
};

/** bone-data.jsonのロードパス (game-assetsから参照) */
export const BONE_DATA_URL = '/api/game-assets/characters/mixamo-ybot/bone-data.json';

// ─── AI State Types ──────────────────────────────────────

import type { Scene } from '@babylonjs/core';
import type { Situation } from './ai/evaluate';
import type { Decision } from './ai/decide';

/** ステートハンドラに渡される共通コンテキスト */
export interface StateContext {
  ai: CombatAI;
  character: HavokCharacter;
  opponent: HavokCharacter;
  scene: Scene;
  dt: number;
  /** 相手への水平方向 (Y=0) */
  dir: Vector3;
  /** 相手までの水平距離 */
  dist: number;
  /** キャラクター方向情報 (null の場合あり) */
  dirs: { forward: Vector3; charRight: Vector3; charLeft: Vector3 } | null;
  /** 戦況評価の結果 */
  situation: Situation;
  /** 行動決定の結果 */
  decision: Decision;
}

/** ステートハンドラの戻り値 */
export interface StateResult {
  hit: boolean;
  damage: number;
  blocked?: boolean;
}

/** 各ステートハンドラの関数シグネチャ */
export type StateHandler = (ctx: StateContext) => StateResult;
