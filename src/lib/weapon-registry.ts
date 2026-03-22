/**
 * Weapon Registry
 * Data-driven weapon definitions: properties, VOX paths, poses per combat state.
 */
import type { PoseData, AttackHand, AttackMove, AttackHeight } from './weapon-combat-engine';
import { CombatState } from './weapon-combat-engine';

// ─── Weapon Definition ───────────────────────────────────

export type GripType = 'one-handed' | 'two-handed';
export type WeaponSlot = 'right' | 'left' | 'both';

/** key format: "{height}_{motion}" or "{height}_{motion}_upswing" */
export type AttackPoseKey = string;

export interface WeaponPoseSet {
  idle: PoseData;
  block: PoseData;
  hit: PoseData;
  dodge: PoseData;
  ko: PoseData;
  victory: PoseData;
  attacks: Record<string, PoseData>;
  attackWindupFallback: PoseData;
  attackStrikeFallback: PoseData;
}

export interface WeaponDef {
  id: string;
  name: string;
  nameJa: string;
  grip: GripType;
  dualWield: boolean;
  /** VOX file paths (relative to game-assets). Used for legacy weapons. */
  voxPaths: string[];
  /** Which hand(s) to attach weapon meshes */
  slots: WeaponSlot[];
  /** Mesh scale when loaded */
  meshScale: number;
  /** Mesh local offset on attach point */
  meshOffset: [number, number, number];
  /** Damage per hit */
  damage: number;
  /** Stamina cost per attack */
  staminaCost: number;
  /** Max combo chain */
  maxCombo: number;
  /** Pose set for this weapon */
  poses: WeaponPoseSet;
  /** Default weapon reach for legacy weapons (overridden by equipment_meta) */
  defaultReach?: number;
  /** If set, load from wapons/ directory using equipment_meta.json */
  equipmentSource?: {
    category: string;   // e.g. 'swords', 'axes'
    pieceKey: string;   // e.g. 'Adventurer_Sword', 'Axe'
  };
}

// ─── Shared poses (hit, dodge) ───────────────────────────

const POSE_HIT: PoseData = {
  hips:      { pos: [0, 0.82, -0.1], rot: [-0.2, 0, 0.1] },
  torso:     { pos: [0, 0.33, 0], rot: [0.15, 0.1, 0.05] },
  head:      { pos: [0, 0.28, 0], rot: [-0.2, 0.15, 0] },
  leftArm:   { pos: [-0.25, 0.12, -0.05], rot: [0.2, 0, 0.8] },
  rightArm:  { pos: [0.25, 0.12, -0.05], rot: [0.2, 0, -0.8] },
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.12, -0.05, -0.05], rot: [-0.15, 0, 0] },
  rightLeg:  { pos: [0.12, -0.05, 0], rot: [0.1, 0, 0] },
  leftFoot:  { pos: [0, -0.38, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.38, 0], rot: [0, 0, 0] },
};

const POSE_DODGE: PoseData = {
  hips:      { pos: [0.3, 0.75, -0.15], rot: [0.2, -0.4, -0.3] },
  torso:     { pos: [0, 0.34, 0], rot: [-0.1, -0.3, -0.1] },
  head:      { pos: [0, 0.28, 0], rot: [0.1, 0.2, 0] },
  leftArm:   { pos: [-0.2, 0.15, 0], rot: [-0.3, 0, 0.6] },
  rightArm:  { pos: [0.2, 0.15, 0], rot: [-0.3, 0, -0.6] },
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.08, -0.05, 0.1], rot: [0.3, 0, 0.2] },
  rightLeg:  { pos: [0.15, -0.05, -0.1], rot: [-0.3, 0, -0.2] },
  leftFoot:  { pos: [0, -0.36, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.36, 0], rot: [0, 0, 0] },
};

// ─── KO / Victory poses ─────────────────────────────────

const POSE_KO: PoseData = {
  hips:      { pos: [0, 0.12, -0.15], rot: [-1.5, 0.1, 0.2] },
  torso:     { pos: [0, 0.18, 0], rot: [0.1, 0, 0.1] },
  head:      { pos: [0, 0.16, 0], rot: [0.4, 0.2, 0.15] },
  leftArm:   { pos: [-0.28, 0.03, 0.05], rot: [0.1, 0, 1.3] },
  rightArm:  { pos: [0.25, 0.05, -0.08], rot: [0.2, 0, -1.1] },
  leftHand:  { pos: [0, -0.18, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.14, 0, 0.05], rot: [-0.2, 0, 0.15] },
  rightLeg:  { pos: [0.12, 0, -0.05], rot: [-0.1, 0, -0.2] },
  leftFoot:  { pos: [0, -0.35, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.35, 0], rot: [0, 0, 0] },
};

const POSE_VICTORY: PoseData = {
  hips:      { pos: [0, 0.92, 0], rot: [0, 0, 0] },
  torso:     { pos: [0, 0.36, 0], rot: [-0.1, 0, 0] },
  head:      { pos: [0, 0.3, 0], rot: [-0.2, 0, 0] },
  leftArm:   { pos: [-0.2, 0.15, 0], rot: [0, 0, 0.4] },
  rightArm:  { pos: [0.18, 0.3, 0], rot: [0, 0, -2.8] },
  leftHand:  { pos: [0, -0.22, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.15, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0], rot: [0, 0, 0] },
  rightLeg:  { pos: [0.1, -0.05, 0], rot: [0, 0, 0] },
  leftFoot:  { pos: [0, -0.4, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.4, 0], rot: [0, 0, 0] },
};

// ─── Height offsets for attack arms ──────────────────────
// Y offset for right arm position based on attack height
const HEIGHT_ARM_Y: Record<AttackHeight, number> = { high: 0.26, mid: 0.12, low: -0.05 };
const HEIGHT_HAND_Y: Record<AttackHeight, number> = { high: 0.0, mid: -0.1, low: -0.2 };

/** Generate all spear attack poses for every height+motion combo */
function generateSpearAttacks(): Record<string, PoseData> {
  const attacks: Record<string, PoseData> = {};
  const base = {
    hips: { pos: [0, 0.84, 0] as [number,number,number], rot: [0.08, 0, 0] as [number,number,number] },
    torso: { pos: [0, 0.35, 0] as [number,number,number], rot: [-0.1, 0, 0] as [number,number,number] },
    head: { pos: [0, 0.3, 0] as [number,number,number], rot: [0.05, 0, 0] as [number,number,number] },
    leftLeg: { pos: [-0.1, -0.05, 0.06] as [number,number,number], rot: [0.15, 0, 0] as [number,number,number] },
    rightLeg: { pos: [0.12, -0.05, -0.1] as [number,number,number], rot: [-0.25, 0, 0] as [number,number,number] },
    leftFoot: { pos: [0, -0.38, 0] as [number,number,number], rot: [0, 0, 0] as [number,number,number] },
    rightFoot: { pos: [0, -0.38, 0] as [number,number,number], rot: [0, 0, 0] as [number,number,number] },
  };
  const lungeLeg = {
    leftLeg: { pos: [-0.1, -0.05, -0.06] as [number,number,number], rot: [-0.15, 0, 0] as [number,number,number] },
    rightLeg: { pos: [0.1, -0.05, 0.18] as [number,number,number], rot: [0.4, 0, 0] as [number,number,number] },
    rightFoot: { pos: [0, -0.34, 0] as [number,number,number], rot: [0, 0, 0] as [number,number,number] },
  };

  for (const h of ['high', 'mid', 'low'] as AttackHeight[]) {
    const ay = HEIGHT_ARM_Y[h];
    const hy = HEIGHT_HAND_Y[h];

    // ── Thrust ──
    attacks[`${h}_thrust_windup`] = {
      ...base,
      leftArm: { pos: [-0.12, 0.22, 0.18], rot: [-1.1, 0, 0.15] },
      rightArm: { pos: [0.2, ay, -0.2], rot: [0.3, 0.3, -0.4] },  // pulled back
      leftHand: { pos: [0, -0.12, 0.15], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy, -0.15], rot: [0, 0, 0] },
    };
    attacks[`${h}_thrust_strike`] = {
      ...base, ...lungeLeg,
      hips: { pos: [0, 0.82, 0.12], rot: [0.12, -0.15, 0] },
      torso: { pos: [0, 0.35, 0], rot: [-0.15, -0.15, 0] },
      leftArm: { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },
      rightArm: { pos: [0.08, ay - 0.04, 0.3], rot: [-0.5, 0, -0.1] },  // thrust forward
      leftHand: { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy, 0.25], rot: [0, 0, 0] },
    };

    // ── Vertical (downswing) ──
    attacks[`${h}_vertical_windup`] = {
      ...base,
      hips: { pos: [0, 0.84, -0.05], rot: [0.08, 0.2, 0] },
      leftArm: { pos: [-0.12, 0.22, 0.16], rot: [-1.1, 0, 0.15] },
      rightArm: { pos: [0.15, 0.3, -0.1], rot: [0.8, 0.2, -0.6] },  // raised high
      leftHand: { pos: [0, -0.12, 0.14], rot: [0, 0, 0] },
      rightHand: { pos: [0, -0.12, -0.08], rot: [0, 0, 0] },
    };
    attacks[`${h}_vertical_strike`] = {
      ...base, ...lungeLeg,
      hips: { pos: [0, 0.82, 0.1], rot: [0.15, -0.1, 0] },
      leftArm: { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },
      rightArm: { pos: [0.1, ay - 0.08, 0.25], rot: [-0.8, 0, -0.15] },  // swung down to height
      leftHand: { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy - 0.05, 0.2], rot: [0, 0, 0] },
    };

    // ── Vertical (upswing) ──
    attacks[`${h}_vertical_upswing_windup`] = {
      ...base,
      hips: { pos: [0, 0.83, -0.03], rot: [0.1, -0.1, 0] },
      leftArm: { pos: [-0.12, 0.2, 0.14], rot: [-0.9, 0, 0.15] },
      rightArm: { pos: [0.12, -0.05, 0.1], rot: [-0.2, 0, -0.2] },  // low starting position
      leftHand: { pos: [0, -0.12, 0.12], rot: [0, 0, 0] },
      rightHand: { pos: [0, -0.15, 0.08], rot: [0, 0, 0] },
    };
    attacks[`${h}_vertical_upswing_strike`] = {
      ...base, ...lungeLeg,
      hips: { pos: [0, 0.83, 0.08], rot: [0.1, -0.1, 0] },
      leftArm: { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },
      rightArm: { pos: [0.1, ay + 0.1, 0.2], rot: [-0.6, 0, -0.2] },  // swung up to height
      leftHand: { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy + 0.05, 0.15], rot: [0, 0, 0] },
    };

    // ── Horizontal R ──
    attacks[`${h}_horizontalR_windup`] = {
      ...base,
      hips: { pos: [0, 0.84, -0.03], rot: [0.08, 0.4, 0] },
      torso: { pos: [0, 0.35, 0], rot: [-0.08, 0.5, 0] },  // body twisted right
      leftArm: { pos: [-0.12, 0.22, 0.16], rot: [-1.1, 0, 0.15] },
      rightArm: { pos: [0.25, ay, -0.1], rot: [0.1, 0.5, -0.6] },  // weapon far right
      leftHand: { pos: [0, -0.12, 0.14], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy, -0.08], rot: [0, 0, 0] },
    };
    attacks[`${h}_horizontalR_strike`] = {
      ...base, ...lungeLeg,
      hips: { pos: [0, 0.82, 0.08], rot: [0.1, -0.4, 0] },
      torso: { pos: [0, 0.35, 0], rot: [-0.1, -0.5, 0] },  // body twisted left (follow-through)
      leftArm: { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },
      rightArm: { pos: [-0.05, ay, 0.2], rot: [-0.4, -0.4, 0.2] },  // swept to the left
      leftHand: { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy, 0.15], rot: [0, 0, 0] },
    };

    // ── Horizontal L ──
    attacks[`${h}_horizontalL_windup`] = {
      ...base,
      hips: { pos: [0, 0.84, -0.03], rot: [0.08, -0.4, 0] },
      torso: { pos: [0, 0.35, 0], rot: [-0.08, -0.5, 0] },  // body twisted left
      leftArm: { pos: [-0.12, 0.22, 0.16], rot: [-1.1, 0, 0.15] },
      rightArm: { pos: [-0.05, ay, -0.1], rot: [0.1, -0.5, 0.3] },  // weapon far left
      leftHand: { pos: [0, -0.12, 0.14], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy, -0.08], rot: [0, 0, 0] },
    };
    attacks[`${h}_horizontalL_strike`] = {
      ...base, ...lungeLeg,
      hips: { pos: [0, 0.82, 0.08], rot: [0.1, 0.4, 0] },
      torso: { pos: [0, 0.35, 0], rot: [-0.1, 0.5, 0] },  // body twisted right (follow-through)
      leftArm: { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },
      rightArm: { pos: [0.25, ay, 0.2], rot: [-0.4, 0.4, -0.3] },  // swept to the right
      leftHand: { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
      rightHand: { pos: [0, hy, 0.15], rot: [0, 0, 0] },
    };
  }
  return attacks;
}

/** Generate hammer attack poses (similar structure, different arm positions) */
function generateHammerAttacks(): Record<string, PoseData> {
  const attacks: Record<string, PoseData> = {};
  const base = {
    hips: { pos: [0, 0.84, 0] as [number,number,number], rot: [0.08, 0, 0] as [number,number,number] },
    torso: { pos: [0, 0.35, 0] as [number,number,number], rot: [-0.1, 0, 0] as [number,number,number] },
    head: { pos: [0, 0.3, 0] as [number,number,number], rot: [0.05, 0, 0] as [number,number,number] },
    leftLeg: { pos: [-0.1, -0.05, 0.04] as [number,number,number], rot: [0.1, 0, 0] as [number,number,number] },
    rightLeg: { pos: [0.1, -0.05, -0.06] as [number,number,number], rot: [-0.15, 0, 0] as [number,number,number] },
    leftFoot: { pos: [0, -0.38, 0] as [number,number,number], rot: [0, 0, 0] as [number,number,number] },
    rightFoot: { pos: [0, -0.38, 0] as [number,number,number], rot: [0, 0, 0] as [number,number,number] },
  };

  for (const h of ['high', 'mid', 'low'] as AttackHeight[]) {
    const ay = HEIGHT_ARM_Y[h];
    const hy = HEIGHT_HAND_Y[h];
    // off-hand is relaxed
    const offArm = { pos: [-0.22, 0.1, -0.03] as [number,number,number], rot: [0.15, 0, 0.45] as [number,number,number] };
    const offHand = { pos: [0, -0.2, 0] as [number,number,number], rot: [0, 0, 0] as [number,number,number] };
    // left-hand versions: swap left/right
    const offArmR = { pos: [0.22, 0.1, -0.03] as [number,number,number], rot: [0.15, 0, -0.45] as [number,number,number] };
    const offHandR = offHand;

    // ── Vertical (R hand) ──
    attacks[`${h}_vertical_windup`] = { ...base,
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.2, 0.3, -0.15], rot: [1.2, 0.3, -0.9] },
      rightHand: { pos: [0, -0.12, -0.1], rot: [0, 0, 0] },
    };
    attacks[`${h}_vertical_strike`] = { ...base,
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.12, ay - 0.05, 0.28], rot: [-1.6, -0.15, -0.2] },
      rightHand: { pos: [0, hy - 0.03, 0.2], rot: [0, 0, 0] },
    };
    // upswing
    attacks[`${h}_vertical_upswing_windup`] = { ...base,
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.12, -0.08, 0.08], rot: [-0.15, 0, -0.2] },
      rightHand: { pos: [0, -0.18, 0.06], rot: [0, 0, 0] },
    };
    attacks[`${h}_vertical_upswing_strike`] = { ...base,
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.12, ay + 0.12, 0.22], rot: [-0.5, 0.1, -0.25] },
      rightHand: { pos: [0, hy + 0.06, 0.16], rot: [0, 0, 0] },
    };

    // ── Horizontal R (R hand swings right→left) ──
    attacks[`${h}_horizontalR_windup`] = { ...base,
      torso: { pos: [0, 0.35, 0], rot: [-0.08, 0.5, 0] },
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.28, ay, -0.08], rot: [0.05, 0.5, -0.6] },
      rightHand: { pos: [0, hy, -0.06], rot: [0, 0, 0] },
    };
    attacks[`${h}_horizontalR_strike`] = { ...base,
      torso: { pos: [0, 0.35, 0], rot: [-0.1, -0.5, 0] },
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [-0.08, ay, 0.22], rot: [-0.35, -0.5, 0.25] },
      rightHand: { pos: [0, hy, 0.16], rot: [0, 0, 0] },
    };

    // ── Horizontal L (L hand swings left→right) ──
    attacks[`${h}_horizontalL_windup`] = { ...base,
      torso: { pos: [0, 0.35, 0], rot: [-0.08, -0.5, 0] },
      rightArm: offArmR, rightHand: offHandR,
      leftArm: { pos: [-0.28, ay, -0.08], rot: [0.05, -0.5, 0.6] },
      leftHand: { pos: [0, hy, -0.06], rot: [0, 0, 0] },
    };
    attacks[`${h}_horizontalL_strike`] = { ...base,
      torso: { pos: [0, 0.35, 0], rot: [-0.1, 0.5, 0] },
      rightArm: offArmR, rightHand: offHandR,
      leftArm: { pos: [0.08, ay, 0.22], rot: [-0.35, 0.5, -0.25] },
      leftHand: { pos: [0, hy, 0.16], rot: [0, 0, 0] },
    };

    // ── Thrust (R hand) ──
    attacks[`${h}_thrust_windup`] = { ...base,
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.18, ay, -0.18], rot: [0.25, 0.2, -0.35] },
      rightHand: { pos: [0, hy, -0.12], rot: [0, 0, 0] },
    };
    attacks[`${h}_thrust_strike`] = { ...base,
      leftArm: offArm, leftHand: offHand,
      rightArm: { pos: [0.08, ay - 0.02, 0.3], rot: [-0.45, 0, -0.1] },
      rightHand: { pos: [0, hy, 0.22], rot: [0, 0, 0] },
    };
  }
  return attacks;
}

// ─── Spear + Shield ─────────────────────────────────────

const SPEAR_IDLE: PoseData = {
  hips:      { pos: [0, 0.88, 0], rot: [0.05, 0.15, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [-0.08, 0.1, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0, -0.1, 0] },
  leftArm:   { pos: [-0.15, 0.2, 0.12], rot: [-0.9, 0, 0.2] },
  rightArm:  { pos: [0.18, 0.18, 0.04], rot: [-0.5, 0, -0.3] },
  leftHand:  { pos: [0, -0.15, 0.12], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0.08], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0.03], rot: [0.05, 0, 0] },
  rightLeg:  { pos: [0.1, -0.05, -0.03], rot: [-0.05, 0, 0] },
  leftFoot:  { pos: [0, -0.4, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.4, 0], rot: [0, 0, 0] },
};

const SPEAR_WINDUP: PoseData = {
  hips:      { pos: [0, 0.84, -0.08], rot: [0.08, 0.25, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [-0.05, 0.3, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0.05, -0.15, 0] },
  leftArm:   { pos: [-0.12, 0.22, 0.18], rot: [-1.1, 0, 0.15] },
  rightArm:  { pos: [0.2, 0.2, -0.2], rot: [0.3, 0.3, -0.4] },
  leftHand:  { pos: [0, -0.12, 0.15], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.18, -0.15], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0.06], rot: [0.15, 0, 0] },
  rightLeg:  { pos: [0.12, -0.05, -0.1], rot: [-0.25, 0, 0] },
  leftFoot:  { pos: [0, -0.38, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.38, 0], rot: [0, 0, 0] },
};

const SPEAR_STRIKE: PoseData = {
  hips:      { pos: [0, 0.82, 0.12], rot: [0.12, -0.15, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [-0.15, -0.15, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0.08, 0.1, 0] },
  leftArm:   { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },
  rightArm:  { pos: [0.08, 0.08, 0.3], rot: [-0.5, 0, -0.1] },
  leftHand:  { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.05, 0.25], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, -0.06], rot: [-0.15, 0, 0] },
  rightLeg:  { pos: [0.1, -0.05, 0.18], rot: [0.4, 0, 0] },
  leftFoot:  { pos: [0, -0.38, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.34, 0], rot: [0, 0, 0] },
};

const SPEAR_BLOCK: PoseData = {
  hips:      { pos: [0, 0.85, 0], rot: [0.1, 0, 0] },
  torso:     { pos: [0, 0.34, 0], rot: [-0.1, -0.1, 0] },
  head:      { pos: [0, 0.28, 0], rot: [0.15, 0, 0] },
  leftArm:   { pos: [-0.08, 0.24, 0.22], rot: [-1.4, 0, 0.1] },
  rightArm:  { pos: [0.2, 0.12, -0.05], rot: [-0.2, 0, -0.4] },
  leftHand:  { pos: [0, -0.1, 0.18], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.14, -0.05, 0.02], rot: [0.2, 0, 0] },
  rightLeg:  { pos: [0.14, -0.05, -0.02], rot: [0.1, 0, 0] },
  leftFoot:  { pos: [0, -0.36, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.36, 0], rot: [0, 0, 0] },
};

export const WEAPON_SPEAR_SHIELD: WeaponDef = {
  id: 'spear-shield',
  name: 'Spear + Shield',
  nameJa: '槍+盾',
  grip: 'two-handed',
  dualWield: false,
  voxPaths: ['/vox/female/realistic-elfpaladin-weapons/body/body.vox'],
  slots: ['right'],
  meshScale: 0.4,
  meshOffset: [0, 0, 0.1],
  damage: 18,
  staminaCost: 12,
  maxCombo: 2,
  defaultReach: 1.8,
  poses: {
    idle: SPEAR_IDLE,
    block: SPEAR_BLOCK,
    hit: POSE_HIT,
    dodge: POSE_DODGE,
    ko: POSE_KO,
    victory: POSE_VICTORY,
    attacks: generateSpearAttacks(),
    attackWindupFallback: SPEAR_WINDUP,
    attackStrikeFallback: SPEAR_STRIKE,
  },
};

// ─── Dual Hammers ────────────────────────────────────────

const HAMMER_IDLE: PoseData = {
  ...SPEAR_IDLE,
  leftArm:   { pos: [-0.2, 0.12, 0], rot: [0, 0, 0.4] },
  leftHand:  { pos: [0, -0.22, 0], rot: [0, 0, 0] },
  rightArm:  { pos: [0.18, 0.18, 0.08], rot: [-0.7, 0, -0.3] },
  rightHand: { pos: [0, -0.18, 0.1], rot: [0, 0, 0] },
};

const HAMMER_WINDUP_R: PoseData = {
  ...SPEAR_WINDUP,
  leftArm:   { pos: [-0.22, 0.1, -0.05], rot: [0.2, 0, 0.5] },
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightArm:  { pos: [0.2, 0.28, -0.2], rot: [1.2, 0.3, -0.9] },
  rightHand: { pos: [0, -0.15, -0.12], rot: [0, 0, 0] },
};

const HAMMER_STRIKE_R: PoseData = {
  ...SPEAR_STRIKE,
  leftArm:   { pos: [-0.2, 0.1, 0.05], rot: [-0.3, 0, 0.5] },
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightArm:  { pos: [0.15, 0.2, 0.3], rot: [-1.8, -0.2, -0.3] },
  rightHand: { pos: [0, -0.1, 0.22], rot: [0, 0, 0] },
};

const HAMMER_WINDUP_L: PoseData = {
  ...HAMMER_WINDUP_R,
  rightArm:  { pos: [0.22, 0.1, -0.05], rot: [0.2, 0, -0.5] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftArm:   { pos: [-0.2, 0.28, -0.2], rot: [1.2, -0.3, 0.9] },
  leftHand:  { pos: [0, -0.15, -0.12], rot: [0, 0, 0] },
};

const HAMMER_STRIKE_L: PoseData = {
  ...HAMMER_STRIKE_R,
  rightArm:  { pos: [0.2, 0.1, 0.05], rot: [-0.3, 0, -0.5] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftArm:   { pos: [-0.15, 0.2, 0.3], rot: [-1.8, 0.2, 0.3] },
  leftHand:  { pos: [0, -0.1, 0.22], rot: [0, 0, 0] },
};

const HAMMER_BLOCK: PoseData = {
  ...SPEAR_BLOCK,
  leftArm:   { pos: [-0.15, 0.2, 0.12], rot: [-1.0, 0, 0.3] },
  leftHand:  { pos: [0, -0.15, 0.08], rot: [0, 0, 0] },
  rightArm:  { pos: [0.18, 0.15, 0.05], rot: [-0.5, 0, -0.4] },
  rightHand: { pos: [0, -0.18, 0.05], rot: [0, 0, 0] },
};

export const WEAPON_DUAL_HAMMERS: WeaponDef = {
  id: 'dual-hammers',
  name: 'Dual Hammers',
  nameJa: '双槌',
  grip: 'one-handed',
  dualWield: true,
  voxPaths: [
    '/vox/male/realistic-radagon-weapons/body/body.vox',
    '/vox/male/realistic-radagon-weapons/body/body.vox',
  ],
  slots: ['right', 'left'],
  meshScale: 0.3,
  meshOffset: [0, 0, 0.1],
  damage: 22,
  staminaCost: 14,
  maxCombo: 3,
  defaultReach: 0.9,
  poses: {
    idle: HAMMER_IDLE,
    block: HAMMER_BLOCK,
    hit: POSE_HIT,
    dodge: POSE_DODGE,
    ko: POSE_KO,
    victory: POSE_VICTORY,
    attacks: generateHammerAttacks(),
    attackWindupFallback: HAMMER_WINDUP_R,
    attackStrikeFallback: HAMMER_STRIKE_R,
  },
};

// ─── Lance (placeholder for future) ─────────────────────

export const WEAPON_LANCE: WeaponDef = {
  id: 'lance',
  name: 'Lance',
  nameJa: '大槍',
  grip: 'two-handed',
  dualWield: false,
  voxPaths: ['/vox/female/realistic-artorialancer-weapons/body/body.vox'],
  slots: ['right'],
  meshScale: 0.35,
  meshOffset: [0, 0, 0.1],
  damage: 25,
  staminaCost: 18,
  maxCombo: 1,
  defaultReach: 2.0,
  poses: {
    idle: SPEAR_IDLE,
    block: SPEAR_BLOCK,
    hit: POSE_HIT,
    dodge: POSE_DODGE,
    ko: POSE_KO,
    victory: POSE_VICTORY,
    attacks: generateSpearAttacks(),
    attackWindupFallback: SPEAR_WINDUP,
    attackStrikeFallback: SPEAR_STRIKE,
  },
};

// ─── Equipment-meta based weapons ────────────────────────

export const WEAPON_ADVENTURER_SWORD: WeaponDef = {
  id: 'adventurer-sword',
  name: 'Adventurer Sword',
  nameJa: '冒険者の剣',
  grip: 'one-handed',
  dualWield: false,
  voxPaths: [],  // loaded via equipmentSource
  slots: ['right'],
  meshScale: 1.5,
  meshOffset: [0, 0, 0],
  damage: 16,
  staminaCost: 10,
  maxCombo: 4,
  equipmentSource: { category: 'swords', pieceKey: 'Adventurer_Sword' },
  poses: {
    idle: HAMMER_IDLE,  // one-handed idle works well for sword too
    block: HAMMER_BLOCK,
    hit: POSE_HIT,
    dodge: POSE_DODGE,
    ko: POSE_KO,
    victory: POSE_VICTORY,
    attacks: generateHammerAttacks(), // slash/swing motions fit sword
    attackWindupFallback: HAMMER_WINDUP_R,
    attackStrikeFallback: HAMMER_STRIKE_R,
  },
};

export const WEAPON_AXE: WeaponDef = {
  id: 'axe',
  name: 'Axe',
  nameJa: '斧',
  grip: 'one-handed',
  dualWield: false,
  voxPaths: [],
  slots: ['right'],
  meshScale: 1.8,
  meshOffset: [0, 0, 0],
  damage: 20,
  staminaCost: 13,
  maxCombo: 3,
  equipmentSource: { category: 'axes', pieceKey: 'Axe' },
  poses: {
    idle: HAMMER_IDLE,
    block: HAMMER_BLOCK,
    hit: POSE_HIT,
    dodge: POSE_DODGE,
    ko: POSE_KO,
    victory: POSE_VICTORY,
    attacks: generateHammerAttacks(),
    attackWindupFallback: HAMMER_WINDUP_R,
    attackStrikeFallback: HAMMER_STRIKE_R,
  },
};

// ─── Registry ────────────────────────────────────────────

export const WEAPON_REGISTRY: Record<string, WeaponDef> = {
  'spear-shield': WEAPON_SPEAR_SHIELD,
  'dual-hammers': WEAPON_DUAL_HAMMERS,
  'lance': WEAPON_LANCE,
  'adventurer-sword': WEAPON_ADVENTURER_SWORD,
  'axe': WEAPON_AXE,
};

export function getWeaponById(id: string): WeaponDef | undefined {
  return WEAPON_REGISTRY[id];
}

export function getAllWeapons(): WeaponDef[] {
  return Object.values(WEAPON_REGISTRY);
}

// ─── Dynamic weapon builder from equipment_meta ─────────

export interface ConfiguredWeaponInfo {
  category: string;
  pieceKey: string;
  gripPosition: { x: number; y: number; z: number };
  tipPosition: { x: number; y: number; z: number };
  pommelPosition: { x: number; y: number; z: number };
}

/**
 * Build a WeaponDef from a configured weapon discovered via /api/configured-weapons.
 * Uses one-handed hammer poses as default (works well for swords, axes, maces, etc.)
 */
export function buildWeaponDefFromConfig(info: ConfiguredWeaponInfo): WeaponDef {
  const id = `equip_${info.category}_${info.pieceKey}`;
  // check if this weapon is already in the static registry
  const existing = Object.values(WEAPON_REGISTRY).find(
    w => w.equipmentSource?.category === info.category && w.equipmentSource?.pieceKey === info.pieceKey
  );
  if (existing) return existing;

  return {
    id,
    name: info.pieceKey.replace(/_/g, ' '),
    nameJa: info.pieceKey.replace(/_/g, ' '),
    grip: 'one-handed',
    dualWield: false,
    voxPaths: [],
    slots: ['right'],
    meshScale: 1.5,
    meshOffset: [0, 0, 0],
    damage: 18,
    staminaCost: 11,
    maxCombo: 3,
    equipmentSource: { category: info.category, pieceKey: info.pieceKey },
    poses: {
      idle: HAMMER_IDLE,
      block: HAMMER_BLOCK,
      hit: POSE_HIT,
      dodge: POSE_DODGE,
      ko: POSE_KO,
      victory: POSE_VICTORY,
      attacks: generateHammerAttacks(),
      attackWindupFallback: HAMMER_WINDUP_R,
      attackStrikeFallback: HAMMER_STRIKE_R,
    },
  };
}

/**
 * Fetch all configured weapons from the server and return WeaponDef array.
 * Falls back to static WEAPON_ADVENTURER_SWORD + WEAPON_AXE on error.
 */
export async function fetchConfiguredWeapons(): Promise<WeaponDef[]> {
  try {
    const resp = await fetch('/api/configured-weapons');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: { weapons: ConfiguredWeaponInfo[] } = await resp.json();
    if (!data.weapons || data.weapons.length === 0) {
      return [WEAPON_ADVENTURER_SWORD, WEAPON_AXE];
    }
    return data.weapons.map(buildWeaponDefFromConfig);
  } catch {
    return [WEAPON_ADVENTURER_SWORD, WEAPON_AXE];
  }
}

// ─── Pose resolver ───────────────────────────────────────

function attackPoseKey(move: AttackMove, phase: 'windup' | 'strike'): string {
  const base = `${move.height}_${move.motion}`;
  return move.isUpswing ? `${base}_upswing_${phase}` : `${base}_${phase}`;
}

export function getWeaponPose(
  weapon: WeaponDef, state: CombatState,
  hand: AttackHand = 'right', currentAttack?: AttackMove | null,
): PoseData {
  const p = weapon.poses;
  switch (state) {
    case CombatState.IDLE:
    case CombatState.APPROACH:
      return p.idle;
    case CombatState.ATTACK_WINDUP: {
      if (currentAttack) {
        const key = attackPoseKey(currentAttack, 'windup');
        if (p.attacks[key]) return p.attacks[key];
      }
      return p.attackWindupFallback;
    }
    case CombatState.ATTACK_STRIKE:
    case CombatState.ATTACK_RECOVER: {
      if (currentAttack) {
        const key = attackPoseKey(currentAttack, 'strike');
        if (p.attacks[key]) return p.attacks[key];
      }
      return p.attackStrikeFallback;
    }
    case CombatState.BLOCK:
      return p.block;
    case CombatState.HIT_STAGGER:
      return p.hit;
    case CombatState.DODGE:
      return p.dodge;
    case CombatState.ROUND_OVER_WIN:
      return p.victory;
    case CombatState.ROUND_OVER_LOSE:
      return p.ko;
  }
}
