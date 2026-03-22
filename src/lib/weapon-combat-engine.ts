/**
 * Weapon Combat Engine
 * State machine, procedural fighters with VOX weapons, AI, combat system.
 */
import {
  Scene, Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, VertexData,
} from '@babylonjs/core';
import { loadVoxFile, SCALE, FACE_DIRS, FACE_VERTS, FACE_NORMALS, type VoxelEntry } from './vox-parser';

// ─── Combat State Machine ────────────────────────────────

export enum CombatState {
  IDLE = 'IDLE',
  APPROACH = 'APPROACH',
  ATTACK_WINDUP = 'ATTACK_WINDUP',
  ATTACK_STRIKE = 'ATTACK_STRIKE',
  ATTACK_RECOVER = 'ATTACK_RECOVER',
  BLOCK = 'BLOCK',
  HIT_STAGGER = 'HIT_STAGGER',
  DODGE = 'DODGE',
  ROUND_OVER_WIN = 'ROUND_OVER_WIN',
  ROUND_OVER_LOSE = 'ROUND_OVER_LOSE',
}

export type FighterId = 'fighter1' | 'fighter2';

export const ARMOR_PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type ArmorPart = typeof ARMOR_PARTS[number];

export interface ArmorState {
  hp: Record<ArmorPart, number>;      // 0 = destroyed
  maxHp: Record<ArmorPart, number>;
}

function createArmorState(): ArmorState {
  const hp: Record<string, number> = {};
  const maxHp: Record<string, number> = {};
  for (const part of ARMOR_PARTS) {
    const v = part === 'torso' ? 40 : part === 'head' ? 20 : 25;
    hp[part] = v;
    maxHp[part] = v;
  }
  return { hp: hp as Record<ArmorPart, number>, maxHp: maxHp as Record<ArmorPart, number> };
}

export type AttackHand = 'right' | 'left';
export type AttackHeight = 'high' | 'mid' | 'low';
export type AttackMotion = 'vertical' | 'horizontalR' | 'horizontalL' | 'thrust';

export interface AttackMove {
  height: AttackHeight;
  motion: AttackMotion;
  /** vertical after downswing becomes upswing */
  isUpswing?: boolean;
}

export interface CombatFighter {
  id: FighterId;
  hp: number;
  maxHp: number;
  stamina: number;
  state: CombatState;
  stateTimer: number;
  facing: number;
  posX: number;
  posZ: number;
  armor: ArmorState;
  attackHand: AttackHand;
  comboCount: number;
  comboTimer: number;
  currentAttack: AttackMove | null;  // the active attack move
  lastAttack: AttackMove | null;     // previous attack for combo rules
  weaponReach: number;   // own weapon tip reach distance
  safeRange: number;     // standoff distance (just outside opponent's reach)
  strikeRange: number;   // close to this distance so own tip connects
}

export type AttackType = 'thrust' | 'slash';

// ─── Combo Chain Rules ───────────────────────────────────

/**
 * Given a previous attack, returns valid next attacks.
 * Rules:
 * - After vertical downswing: low is free, mid/high become upswing
 * - After vertical upswing: high is free, mid/low become downswing
 * - After horizontalR: must follow with horizontalL (any height)
 * - After horizontalL: must follow with horizontalR (any height)
 * - After thrust: any attack is valid
 * - null (first attack): any attack is valid
 */
export function getValidNextAttacks(prev: AttackMove | null): AttackMove[] {
  const moves: AttackMove[] = [];
  const heights: AttackHeight[] = ['high', 'mid', 'low'];

  if (!prev) {
    // first attack: all options
    for (const h of heights) {
      moves.push({ height: h, motion: 'vertical' });
      moves.push({ height: h, motion: 'horizontalR' });
      moves.push({ height: h, motion: 'horizontalL' });
      moves.push({ height: h, motion: 'thrust' });
    }
    return moves;
  }

  switch (prev.motion) {
    case 'vertical':
      if (!prev.isUpswing) {
        // downswing → low is free (downswing continues), mid/high become upswing
        moves.push({ height: 'low', motion: 'vertical' });
        moves.push({ height: 'low', motion: 'horizontalR' });
        moves.push({ height: 'low', motion: 'horizontalL' });
        moves.push({ height: 'low', motion: 'thrust' });
        moves.push({ height: 'mid', motion: 'vertical', isUpswing: true });
        moves.push({ height: 'high', motion: 'vertical', isUpswing: true });
      } else {
        // upswing → high is free, mid/low become downswing
        moves.push({ height: 'high', motion: 'vertical' });
        moves.push({ height: 'high', motion: 'horizontalR' });
        moves.push({ height: 'high', motion: 'horizontalL' });
        moves.push({ height: 'high', motion: 'thrust' });
        moves.push({ height: 'mid', motion: 'vertical' });
        moves.push({ height: 'low', motion: 'vertical' });
      }
      break;

    case 'horizontalR':
      // must follow with horizontalL at any height
      for (const h of heights) {
        moves.push({ height: h, motion: 'horizontalL' });
      }
      break;

    case 'horizontalL':
      // must follow with horizontalR at any height
      for (const h of heights) {
        moves.push({ height: h, motion: 'horizontalR' });
      }
      break;

    case 'thrust':
      // any attack is valid
      for (const h of heights) {
        moves.push({ height: h, motion: 'vertical' });
        moves.push({ height: h, motion: 'horizontalR' });
        moves.push({ height: h, motion: 'horizontalL' });
        moves.push({ height: h, motion: 'thrust' });
      }
      break;
  }

  return moves;
}

export function getAttackMoveLabel(move: AttackMove): string {
  const heightJa: Record<AttackHeight, string> = { high: '上段', mid: '中段', low: '下段' };
  const motionJa: Record<AttackMotion, string> = {
    vertical: move.isUpswing ? '振り上げ' : '縦振り',
    horizontalR: '右横振り',
    horizontalL: '左横振り',
    thrust: '突き',
  };
  return `${heightJa[move.height]}${motionJa[move.motion]}`;
}

export interface HitInfo {
  target: FighterId;
  part: ArmorPart;
  attackType: AttackType;
  hitLocalX: number;    // normalized hit position within part (-1 to 1)
  hitLocalY: number;
  hitLocalZ: number;
  flesh: boolean;       // hit area has no armor → blood
}

export interface PendingHitCheck {
  attacker: FighterId;
  defender: FighterId;
}

export interface CombatGameState {
  fighters: Record<FighterId, CombatFighter>;
  matchResult: string | null;
  events: string[];
  hitFlash: FighterId | null;
  hitFlashTimer: number;
  lastHit: HitInfo | null;
  pendingHitCheck: PendingHitCheck | null;  // set by engine, consumed by page
}

// timing constants
const WINDUP_DURATION = 0.3;
const STRIKE_DURATION = 0.15;
const RECOVER_DURATION = 0.35;
const BLOCK_DURATION = 0.5;
const STAGGER_DURATION = 0.4;
const DODGE_DURATION = 0.35;
const ATTACK_DAMAGE = 18;
const BLOCK_STAMINA_COST = 12;
const ATTACK_STAMINA_COST = 12;
const DODGE_STAMINA_COST = 10;
const STAMINA_REGEN = 15;
const ATTACK_RANGE = 1.6;      // weapon mesh hit check range (used by AI decision)
const ENGAGE_RANGE = 2.2;     // safe standoff distance (outside weapon reach)
const APPROACH_SPEED = 0.8;
const LUNGE_SPEED = 3.5;      // dash-in speed during attack windup

export function createCombatState(): CombatGameState {
  return {
    fighters: {
      fighter1: {
        id: 'fighter1', hp: 100, maxHp: 100, stamina: 100,
        state: CombatState.IDLE, stateTimer: 0, facing: 1, posX: 0, posZ: -1.5,
        armor: createArmorState(),
        attackHand: 'right', comboCount: 0, comboTimer: 0,
        currentAttack: null, lastAttack: null,
        weaponReach: 1.0, safeRange: 2.2, strikeRange: 0.8,
      },
      fighter2: {
        id: 'fighter2', hp: 100, maxHp: 100, stamina: 100,
        state: CombatState.IDLE, stateTimer: 0, facing: -1, posX: 0, posZ: 1.5,
        armor: createArmorState(),
        attackHand: 'right', comboCount: 0, comboTimer: 0,
        currentAttack: null, lastAttack: null,
        weaponReach: 1.0, safeRange: 2.2, strikeRange: 0.8,
      },
    },
    matchResult: null,
    events: [],
    lastHit: null,
    pendingHitCheck: null,
    hitFlash: null,
    hitFlashTimer: 0,
  };
}

// ─── AI ──────────────────────────────────────────────────

const aiCooldown: Record<FighterId, number> = { fighter1: 0, fighter2: 0 };

type CombatAction = 'attack' | 'block' | 'dodge';
const STRAFE_SPEED = 0.6;
// strafe direction changes randomly over time
const strafeDirState: Record<FighterId, { dir: number; timer: number }> = {
  fighter1: { dir: 1, timer: 0 },
  fighter2: { dir: -1, timer: 0 },
};

function getDist(a: CombatFighter, b: CombatFighter): number {
  const dx = a.posX - b.posX;
  const dz = a.posZ - b.posZ;
  return Math.sqrt(dx * dx + dz * dz);
}

function cpuDecide(gs: CombatGameState, id: FighterId, dt: number): CombatAction | null {
  aiCooldown[id] -= dt;
  if (aiCooldown[id] > 0) return null;

  const me = gs.fighters[id];
  const other = gs.fighters[id === 'fighter1' ? 'fighter2' : 'fighter1'];
  const dist = getDist(me, other);

  if (me.state !== CombatState.IDLE && me.state !== CombatState.APPROACH) return null;

  // react to opponent's attack
  if (other.state === CombatState.ATTACK_WINDUP || other.state === CombatState.ATTACK_STRIKE) {
    if (dist < ATTACK_RANGE + 0.3) {
      aiCooldown[id] = 0.3;
      // 40% block, 20% dodge, 40% fail to react (gets hit)
      const r = Math.random();
      if (r < 0.4) return 'block';
      if (r < 0.6) return 'dodge';
      return null; // too slow to react
    }
  }

  // initiate attack from standoff distance — will dash in during windup
  if (dist < me.safeRange * 1.3 && me.stamina > ATTACK_STAMINA_COST && Math.random() < 2.0 * dt) {
    aiCooldown[id] = 0.5 + Math.random() * 0.8;
    return 'attack';
  }

  return null;
}

/** Move fighter to maintain safe standoff distance based on weapon ranges */
function moveTowardOpponent(f: CombatFighter, other: CombatFighter, dt: number) {
  const dx = other.posX - f.posX;
  const dz = other.posZ - f.posZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.01) return;

  const dirX = dx / dist;
  const dirZ = dz / dist;

  // maintain safe standoff: stay just outside opponent's weapon reach
  if (dist > f.safeRange * 1.15) {
    // too far — approach to standoff distance
    f.posX += dirX * APPROACH_SPEED * dt;
    f.posZ += dirZ * APPROACH_SPEED * dt;
  } else if (dist < f.safeRange * 0.9) {
    // too close — inside opponent's danger zone, back off
    f.posX -= dirX * APPROACH_SPEED * 0.8 * dt;
    f.posZ -= dirZ * APPROACH_SPEED * 0.8 * dt;
  }

  // randomly change strafe direction
  const ss = strafeDirState[f.id];
  ss.timer -= dt;
  if (ss.timer <= 0) {
    ss.dir = Math.random() < 0.5 ? 1 : -1;
    ss.timer = 0.8 + Math.random() * 1.5;
  }

  // circle/strafe perpendicular to opponent
  const perpX = -dirZ * ss.dir;
  const perpZ = dirX * ss.dir;
  f.posX += perpX * STRAFE_SPEED * dt;
  f.posZ += perpZ * STRAFE_SPEED * dt;

  // arena bounds
  f.posX = Math.max(-3, Math.min(3, f.posX));
  f.posZ = Math.max(-3, Math.min(3, f.posZ));
}

// ─── Update ──────────────────────────────────────────────

export function combatUpdate(gs: CombatGameState, dt: number): void {
  gs.events = [];
  gs.lastHit = null;
  gs.pendingHitCheck = null;
  if (gs.matchResult) return;

  // hit flash timer
  if (gs.hitFlashTimer > 0) {
    gs.hitFlashTimer -= dt;
    if (gs.hitFlashTimer <= 0) gs.hitFlash = null;
  }

  const ids: FighterId[] = ['fighter1', 'fighter2'];

  for (const id of ids) {
    const f = gs.fighters[id];
    f.stateTimer += dt;

    // stamina regen when idle/approach
    if (f.state === CombatState.IDLE || f.state === CombatState.APPROACH) {
      f.stamina = Math.min(100, f.stamina + STAMINA_REGEN * dt);
    }
  }

  // AI decisions
  for (const id of ids) {
    const action = cpuDecide(gs, id, dt);
    if (action) applyAction(gs, id, action);
  }

  // state transitions
  for (const id of ids) {
    const f = gs.fighters[id];
    const otherId: FighterId = id === 'fighter1' ? 'fighter2' : 'fighter1';
    const other = gs.fighters[otherId];
    const dist = getDist(f, other);
    // direction from f toward other
    const toOtherX = dist > 0.01 ? (other.posX - f.posX) / dist : 0;
    const toOtherZ = dist > 0.01 ? (other.posZ - f.posZ) / dist : 1;

    switch (f.state) {
      case CombatState.IDLE:
        moveTowardOpponent(f, other, dt);
        if (dist > f.safeRange * 1.3) {
          f.state = CombatState.APPROACH;
          f.stateTimer = 0;
        }
        break;

      case CombatState.APPROACH:
        moveTowardOpponent(f, other, dt);
        if (dist <= f.safeRange * 1.1) {
          f.state = CombatState.IDLE;
          f.stateTimer = 0;
        }
        break;

      case CombatState.ATTACK_WINDUP:
        // dash toward opponent, but stop at strikeRange (tip distance)
        if (dist > f.strikeRange) {
          const closeDist = Math.min(LUNGE_SPEED * dt, dist - f.strikeRange);
          f.posX += toOtherX * closeDist;
          f.posZ += toOtherZ * closeDist;
        }
        if (f.stateTimer >= WINDUP_DURATION) {
          f.state = CombatState.ATTACK_STRIKE;
          f.stateTimer = 0;
          // small final adjustment to exactly strikeRange if still too far
          const strikeDist = getDist(f, other);
          if (strikeDist > f.strikeRange) {
            const adj = Math.min(0.2, strikeDist - f.strikeRange);
            f.posX += toOtherX * adj;
            f.posZ += toOtherZ * adj;
          }
          gs.pendingHitCheck = { attacker: id, defender: otherId };
        }
        break;

      case CombatState.ATTACK_STRIKE:
        if (f.stateTimer >= STRIKE_DURATION) {
          f.state = CombatState.ATTACK_RECOVER;
          f.stateTimer = 0;
          // set combo window
          f.comboTimer = 0.5; // 0.5s to chain next attack
        }
        break;

      case CombatState.ATTACK_RECOVER:
        f.comboTimer -= dt;
        // combo chain: pick next valid attack from rules
        if (f.comboTimer > 0 && f.comboCount < 4 && f.stamina >= ATTACK_STAMINA_COST &&
            f.stateTimer >= RECOVER_DURATION * 0.5) {
          const validMoves = getValidNextAttacks(f.currentAttack);
          if (validMoves.length > 0) {
            const nextMove = validMoves[Math.floor(Math.random() * validMoves.length)];
            f.stamina -= ATTACK_STAMINA_COST;
            f.lastAttack = f.currentAttack;
            f.currentAttack = nextMove;
            // alternate hand for horizontal, keep same for vertical/thrust
            if (nextMove.motion === 'horizontalL') f.attackHand = 'left';
            else if (nextMove.motion === 'horizontalR') f.attackHand = 'right';
            else f.attackHand = f.attackHand === 'right' ? 'left' : 'right';
            f.comboCount++;
            f.state = CombatState.ATTACK_WINDUP;
            f.stateTimer = 0;
            const label = getAttackMoveLabel(nextMove);
            gs.events.push(`${id === 'fighter1' ? '青' : '赤'} 連撃: ${label}`);
            break;
          }
        }
        // step back to safe standoff distance
        if (dist < f.safeRange) {
          f.posX -= toOtherX * 2.5 * dt;
          f.posZ -= toOtherZ * 2.5 * dt;
        }
        if (f.stateTimer >= RECOVER_DURATION) {
          f.state = CombatState.IDLE;
          f.stateTimer = 0;
          f.comboCount = 0;
          f.lastAttack = null;
        }
        break;

      case CombatState.BLOCK:
        if (f.stateTimer >= BLOCK_DURATION) {
          f.state = CombatState.IDLE;
          f.stateTimer = 0;
        }
        break;

      case CombatState.HIT_STAGGER:
        // knockback away from opponent
        f.posX -= toOtherX * 1.2 * dt;
        f.posZ -= toOtherZ * 1.2 * dt;
        if (f.stateTimer >= STAGGER_DURATION) {
          f.state = CombatState.IDLE;
          f.stateTimer = 0;
        }
        break;

      case CombatState.DODGE:
        // sidestep perpendicular to opponent
        { const perpX = -toOtherZ;
          const perpZ = toOtherX;
          const dodgeDir = f.id === 'fighter1' ? 1 : -1;
          f.posX += perpX * dodgeDir * 2.5 * dt;
          f.posZ += perpZ * dodgeDir * 2.5 * dt;
          f.posX = Math.max(-3, Math.min(3, f.posX));
          f.posZ = Math.max(-3, Math.min(3, f.posZ));
        }
        if (f.stateTimer >= DODGE_DURATION) {
          f.state = CombatState.IDLE;
          f.stateTimer = 0;
        }
        break;
    }
  }
}

/** Called by page after spatial hit check determines which body part was hit (or null for miss) */
export function applyWeaponHit(gs: CombatGameState, attackerId: FighterId, defenderId: FighterId, hitPart: ArmorPart | null) {
  const attacker = gs.fighters[attackerId];
  const defender = gs.fighters[defenderId];
  const color = defenderId === 'fighter1' ? '青' : '赤';
  const partNames: Record<ArmorPart, string> = {
    head: '頭', torso: '胴', leftArm: '左腕',
    rightArm: '右腕', leftLeg: '左脚', rightLeg: '右脚',
  };

  if (!hitPart) {
    // miss — weapon didn't reach
    gs.events.push('攻撃が届かない！');
    return;
  }

  if (defender.state === CombatState.BLOCK) {
    defender.stamina -= BLOCK_STAMINA_COST;
    gs.events.push(`${color}がブロック！`);
    if (defender.stamina <= 0) {
      defender.stamina = 0;
      defender.state = CombatState.HIT_STAGGER;
      defender.stateTimer = 0;
      gs.events.push('ガードブレイク！');
    }
    return;
  }

  if (defender.state === CombatState.DODGE) {
    gs.events.push(`${color}が回避！`);
    return;
  }

  // hit lands - derive attack type from current attack move
  const curMove = attacker.currentAttack;
  const attackType: AttackType = curMove?.motion === 'thrust' ? 'thrust' : 'slash';
  const hitLocalX = (Math.random() - 0.5) * 2;
  const hitLocalY = (Math.random() - 0.5) * 2;
  const hitLocalZ = Math.random() < 0.5 ? 1 : -1;

  defender.state = CombatState.HIT_STAGGER;
  defender.stateTimer = 0;
  gs.hitFlash = defenderId;
  gs.hitFlashTimer = 0.15;

  gs.lastHit = {
    target: defenderId, part: hitPart, attackType,
    hitLocalX, hitLocalY, hitLocalZ, flesh: false,
  };

  defender.hp -= Math.floor(ATTACK_DAMAGE * 0.3);
  const typeLabel = attackType === 'thrust' ? '突き' : '斬り';
  gs.events.push(`${color}の${partNames[hitPart]}に${typeLabel}！`);

  if (defender.hp <= 0) {
    defender.hp = 0;
    const winner = attackerId === 'fighter1' ? '青（槍盾）' : '赤（ハンマー）';
    gs.matchResult = `${winner} の勝利！`;
    gs.fighters[attackerId].state = CombatState.ROUND_OVER_WIN;
    gs.fighters[defenderId].state = CombatState.ROUND_OVER_LOSE;
  }
}

function applyAction(gs: CombatGameState, id: FighterId, action: CombatAction) {
  const f = gs.fighters[id];
  if (f.state !== CombatState.IDLE && f.state !== CombatState.APPROACH) return;

  switch (action) {
    case 'attack':
      if (f.stamina >= ATTACK_STAMINA_COST) {
        f.stamina -= ATTACK_STAMINA_COST;
        f.state = CombatState.ATTACK_WINDUP;
        f.stateTimer = 0;
        f.comboCount = 0;
        // pick random initial attack
        const firstMoves = getValidNextAttacks(null);
        const firstMove = firstMoves[Math.floor(Math.random() * firstMoves.length)];
        f.currentAttack = firstMove;
        f.lastAttack = null;
        f.attackHand = firstMove.motion === 'horizontalL' ? 'left' : 'right';
        const label = getAttackMoveLabel(firstMove);
        gs.events.push(`${f.id === 'fighter1' ? '青' : '赤'}: ${label}`);
      }
      break;
    case 'block':
      f.state = CombatState.BLOCK;
      f.stateTimer = 0;
      break;
    case 'dodge':
      if (f.stamina >= DODGE_STAMINA_COST) {
        f.stamina -= DODGE_STAMINA_COST;
        f.state = CombatState.DODGE;
        f.stateTimer = 0;
      }
      break;
  }
}

// ─── Pose System ─────────────────────────────────────────

export interface BonePose {
  pos: [number, number, number];
  rot: [number, number, number];
}
export type PoseData = Record<string, BonePose>;

export const BONES = ['hips','torso','head','leftArm','rightArm','leftHand','rightHand','leftLeg','rightLeg','leftFoot','rightFoot'] as const;

/** Body part geometry definitions for procedural fighter */
export const BODY_PART_DEFS = [
  { name: 'hips',      w: 0.28, h: 0.15, d: 0.16, skin: false },
  { name: 'torso',     w: 0.3,  h: 0.32, d: 0.18, skin: false },
  { name: 'head',      w: 0.16, h: 0.18, d: 0.16, skin: true  },
  { name: 'leftArm',   w: 0.08, h: 0.25, d: 0.08, skin: false },
  { name: 'rightArm',  w: 0.08, h: 0.25, d: 0.08, skin: false },
  { name: 'leftHand',  w: 0.07, h: 0.10, d: 0.05, skin: true  },
  { name: 'rightHand', w: 0.07, h: 0.10, d: 0.05, skin: true  },
  { name: 'leftLeg',   w: 0.10, h: 0.35, d: 0.10, skin: false },
  { name: 'rightLeg',  w: 0.10, h: 0.35, d: 0.10, skin: false },
  { name: 'leftFoot',  w: 0.10, h: 0.06, d: 0.14, skin: true  },
  { name: 'rightFoot', w: 0.10, h: 0.06, d: 0.14, skin: true  },
] as const;

// === Spear+Shield (two-handed) poses ===

// 構え: 右手で槍を体の横に構え、左手で盾を前に
export const POSE_IDLE: PoseData = {
  hips:      { pos: [0, 0.88, 0], rot: [0.05, 0.15, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [-0.08, 0.1, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0, -0.1, 0] },
  leftArm:   { pos: [-0.15, 0.2, 0.12], rot: [-0.9, 0, 0.2] },    // shield arm forward
  rightArm:  { pos: [0.18, 0.18, 0.04], rot: [-0.5, 0, -0.3] },   // spear arm at side
  leftHand:  { pos: [0, -0.15, 0.12], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0.08], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0.03], rot: [0.05, 0, 0] },
  rightLeg:  { pos: [0.1, -0.05, -0.03], rot: [-0.05, 0, 0] },
  leftFoot:  { pos: [0, -0.4, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.4, 0], rot: [0, 0, 0] },
};

// 突き準備: 槍を引いて溜める。盾は前でガード。後ろ脚に体重
const POSE_ATTACK_WINDUP: PoseData = {
  hips:      { pos: [0, 0.84, -0.08], rot: [0.08, 0.25, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [-0.05, 0.3, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0.05, -0.15, 0] },
  leftArm:   { pos: [-0.12, 0.22, 0.18], rot: [-1.1, 0, 0.15] },  // shield stays forward
  rightArm:  { pos: [0.2, 0.2, -0.2], rot: [0.3, 0.3, -0.4] },    // spear pulled far back
  leftHand:  { pos: [0, -0.12, 0.15], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.18, -0.15], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0.06], rot: [0.15, 0, 0] },     // front leg
  rightLeg:  { pos: [0.12, -0.05, -0.1], rot: [-0.25, 0, 0] },    // back leg loaded
  leftFoot:  { pos: [0, -0.38, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.38, 0], rot: [0, 0, 0] },
};

// 突き: 槍をまっすぐ前方に突き出す。右脚で大きく踏み込み
const POSE_ATTACK_STRIKE: PoseData = {
  hips:      { pos: [0, 0.82, 0.12], rot: [0.12, -0.15, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [-0.15, -0.15, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0.08, 0.1, 0] },
  leftArm:   { pos: [-0.1, 0.18, 0.12], rot: [-0.8, 0, 0.15] },   // shield slightly aside
  rightArm:  { pos: [0.08, 0.08, 0.3], rot: [-0.5, 0, -0.1] },    // arm extended forward horizontally
  leftHand:  { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.05, 0.25], rot: [0, 0, 0] },            // hand pushed far forward
  leftLeg:   { pos: [-0.1, -0.05, -0.06], rot: [-0.15, 0, 0] },   // back leg
  rightLeg:  { pos: [0.1, -0.05, 0.18], rot: [0.4, 0, 0] },       // deep lunge forward
  leftFoot:  { pos: [0, -0.38, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.34, 0], rot: [0, 0, 0] },
};

// 防御: 盾を正面に大きく構え、槍を体の後ろに
const POSE_BLOCK: PoseData = {
  hips:      { pos: [0, 0.85, 0], rot: [0.1, 0, 0] },
  torso:     { pos: [0, 0.34, 0], rot: [-0.1, -0.1, 0] },
  head:      { pos: [0, 0.28, 0], rot: [0.15, 0, 0] },
  leftArm:   { pos: [-0.08, 0.24, 0.22], rot: [-1.4, 0, 0.1] },  // shield high and center
  rightArm:  { pos: [0.2, 0.12, -0.05], rot: [-0.2, 0, -0.4] },  // spear down and back
  leftHand:  { pos: [0, -0.1, 0.18], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.14, -0.05, 0.02], rot: [0.2, 0, 0] },
  rightLeg:  { pos: [0.14, -0.05, -0.02], rot: [0.1, 0, 0] },
  leftFoot:  { pos: [0, -0.36, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.36, 0], rot: [0, 0, 0] },
};

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

// KO: collapse to ground
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

// Victory: weapon raised
const POSE_VICTORY: PoseData = {
  hips:      { pos: [0, 0.92, 0], rot: [0, 0, 0] },
  torso:     { pos: [0, 0.36, 0], rot: [-0.1, 0, 0] },
  head:      { pos: [0, 0.3, 0], rot: [-0.2, 0, 0] },
  leftArm:   { pos: [-0.2, 0.15, 0], rot: [0, 0, 0.4] },
  rightArm:  { pos: [0.18, 0.3, 0], rot: [0, 0, -2.8] },   // weapon raised high
  leftHand:  { pos: [0, -0.22, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.15, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0], rot: [0, 0, 0] },
  rightLeg:  { pos: [0.1, -0.05, 0], rot: [0, 0, 0] },
  leftFoot:  { pos: [0, -0.4, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.4, 0], rot: [0, 0, 0] },
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

// ── One-handed (hammer) pose overrides ───────────────────

const POSE_1H_IDLE: PoseData = {
  ...POSE_IDLE,
  leftArm:   { pos: [-0.2, 0.12, 0], rot: [0, 0, 0.4] },       // left arm relaxed at side
  leftHand:  { pos: [0, -0.22, 0], rot: [0, 0, 0] },
  rightArm:  { pos: [0.18, 0.18, 0.08], rot: [-0.7, 0, -0.3] }, // right arm holds weapon forward
  rightHand: { pos: [0, -0.18, 0.1], rot: [0, 0, 0] },
};

const POSE_1H_WINDUP: PoseData = {
  ...POSE_ATTACK_WINDUP,
  leftArm:   { pos: [-0.22, 0.1, -0.05], rot: [0.2, 0, 0.5] },   // left arm back for balance
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightArm:  { pos: [0.2, 0.28, -0.2], rot: [1.2, 0.3, -0.9] },   // hammer raised high behind
  rightHand: { pos: [0, -0.15, -0.12], rot: [0, 0, 0] },
};

const POSE_1H_STRIKE: PoseData = {
  ...POSE_ATTACK_STRIKE,
  leftArm:   { pos: [-0.2, 0.1, 0.05], rot: [-0.3, 0, 0.5] },    // left arm forward for balance
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightArm:  { pos: [0.15, 0.2, 0.3], rot: [-1.8, -0.2, -0.3] },  // hammer slammed down forward
  rightHand: { pos: [0, -0.1, 0.22], rot: [0, 0, 0] },
};

const POSE_1H_BLOCK: PoseData = {
  ...POSE_BLOCK,
  leftArm:   { pos: [-0.15, 0.2, 0.12], rot: [-1.0, 0, 0.3] },   // left arm raised to guard
  leftHand:  { pos: [0, -0.15, 0.08], rot: [0, 0, 0] },
  rightArm:  { pos: [0.18, 0.15, 0.05], rot: [-0.5, 0, -0.4] },   // weapon held back
  rightHand: { pos: [0, -0.18, 0.05], rot: [0, 0, 0] },
};

// Left-hand attack poses (mirrored from right-hand)
const POSE_1H_WINDUP_L: PoseData = {
  ...POSE_1H_WINDUP,
  rightArm:  { pos: [0.22, 0.1, -0.05], rot: [0.2, 0, -0.5] },     // right relaxed for balance
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftArm:   { pos: [-0.2, 0.28, -0.2], rot: [1.2, -0.3, 0.9] },    // left hammer raised
  leftHand:  { pos: [0, -0.15, -0.12], rot: [0, 0, 0] },
};

const POSE_1H_STRIKE_L: PoseData = {
  ...POSE_1H_STRIKE,
  rightArm:  { pos: [0.2, 0.1, 0.05], rot: [-0.3, 0, -0.5] },      // right forward balance
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftArm:   { pos: [-0.15, 0.2, 0.3], rot: [-1.8, 0.2, 0.3] },    // left hammer slam
  leftHand:  { pos: [0, -0.1, 0.22], rot: [0, 0, 0] },
};

export function getPoseForState(state: CombatState, oneHanded = false, hand: AttackHand = 'right'): PoseData {
  if (oneHanded) {
    const isLeft = hand === 'left';
    switch (state) {
      case CombatState.IDLE:
      case CombatState.APPROACH:
        return POSE_1H_IDLE;
      case CombatState.ATTACK_WINDUP:
        return isLeft ? POSE_1H_WINDUP_L : POSE_1H_WINDUP;
      case CombatState.ATTACK_STRIKE:
      case CombatState.ATTACK_RECOVER:
        return isLeft ? POSE_1H_STRIKE_L : POSE_1H_STRIKE;
      case CombatState.BLOCK:
        return POSE_1H_BLOCK;
      case CombatState.HIT_STAGGER:
        return POSE_HIT;
      case CombatState.DODGE:
        return POSE_DODGE;
      case CombatState.ROUND_OVER_WIN:
        return POSE_VICTORY;
      case CombatState.ROUND_OVER_LOSE:
        return POSE_KO;
    }
  }
  switch (state) {
    case CombatState.IDLE:
    case CombatState.APPROACH:
      return POSE_IDLE;
    case CombatState.ATTACK_WINDUP:
      return POSE_ATTACK_WINDUP;
    case CombatState.ATTACK_STRIKE:
    case CombatState.ATTACK_RECOVER:
      return POSE_ATTACK_STRIKE;
    case CombatState.BLOCK:
      return POSE_BLOCK;
    case CombatState.HIT_STAGGER:
      return POSE_HIT;
    case CombatState.DODGE:
      return POSE_DODGE;
    case CombatState.ROUND_OVER_WIN:
      return POSE_VICTORY;
    case CombatState.ROUND_OVER_LOSE:
      return POSE_KO;
  }
}

export function lerpPose(a: PoseData, b: PoseData, t: number): PoseData {
  const result: PoseData = {};
  const tc = Math.max(0, Math.min(1, t));
  for (const key of BONES) {
    const ba = a[key] ?? POSE_IDLE[key];
    const bb = b[key] ?? POSE_IDLE[key];
    result[key] = {
      pos: [
        ba.pos[0] + (bb.pos[0] - ba.pos[0]) * tc,
        ba.pos[1] + (bb.pos[1] - ba.pos[1]) * tc,
        ba.pos[2] + (bb.pos[2] - ba.pos[2]) * tc,
      ],
      rot: [
        ba.rot[0] + (bb.rot[0] - ba.rot[0]) * tc,
        ba.rot[1] + (bb.rot[1] - ba.rot[1]) * tc,
        ba.rot[2] + (bb.rot[2] - ba.rot[2]) * tc,
      ],
    };
  }
  return result;
}

// ─── Procedural Fighter ──────────────────────────────────

export interface CombatFighterVisual {
  root: TransformNode;
  bones: Map<string, TransformNode>;
  bodyMeshes: Map<string, Mesh>;    // body part meshes for hit detection
  weaponAttachR: TransformNode;
  weaponAttachL: TransformNode;
  weaponMeshes: Mesh[];             // weapon meshes for hit detection
  /** LOD: single box proxy for distant rendering (null if not created) */
  lodProxy: Mesh | null;
  /** All detail meshes (body + weapon) for LOD toggling */
  detailMeshes: Mesh[];
}

export interface BuildFighterOptions {
  /** Skip bounding info sync & picking (for mass-combat modes that don't use mesh intersection) */
  lightweight?: boolean;
}

// Material cache: share materials across fighters to reduce draw calls
const _matCache = new Map<string, StandardMaterial>();

function getOrCreateMaterial(scene: Scene, key: string, create: () => StandardMaterial): StandardMaterial {
  // include scene uid to avoid cross-scene stale refs
  const fullKey = `${(scene as any).uid}_${key}`;
  let mat = _matCache.get(fullKey);
  if (mat && mat.getScene() === scene) return mat;
  mat = create();
  mat.freeze();
  _matCache.set(fullKey, mat);
  return mat;
}

export function buildCombatFighter(
  scene: Scene, color: Color3, prefix: string, opts?: BuildFighterOptions,
): CombatFighterVisual {
  const lightweight = opts?.lightweight ?? false;
  const root = new TransformNode(`${prefix}_root`, scene);
  const bones = new Map<string, TransformNode>();

  // share body materials by color key, share skin material globally
  const colorKey = `body_${color.r.toFixed(2)}_${color.g.toFixed(2)}_${color.b.toFixed(2)}`;
  const mat = getOrCreateMaterial(scene, colorKey, () => {
    const m = new StandardMaterial(`mat_${colorKey}`, scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0.2, 0.2, 0.2);
    return m;
  });

  const skinMat = getOrCreateMaterial(scene, 'skin', () => {
    const m = new StandardMaterial('mat_skin', scene);
    m.diffuseColor = new Color3(0.9, 0.75, 0.6);
    return m;
  });

  const bodyMeshes = new Map<string, Mesh>();

  function makeBone(name: string, w: number, h: number, d: number, material: StandardMaterial, parent: TransformNode) {
    const node = new TransformNode(`${prefix}_${name}`, scene);
    node.parent = parent;
    const mesh = MeshBuilder.CreateBox(`${prefix}_${name}_mesh`, { width: w, height: h, depth: d }, scene);
    mesh.material = material;
    mesh.parent = node;
    if (lightweight) {
      mesh.isPickable = false;
      mesh.doNotSyncBoundingInfo = true;
      mesh.cullingStrategy = Mesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;
    }
    bones.set(name, node);
    bodyMeshes.set(name, mesh);
    return node;
  }

  const hips = makeBone('hips', 0.28, 0.15, 0.16, mat, root);
  const torso = makeBone('torso', 0.3, 0.32, 0.18, mat, hips);
  makeBone('head', 0.16, 0.18, 0.16, skinMat, torso);
  const lArm = makeBone('leftArm', 0.08, 0.25, 0.08, mat, torso);
  const rArm = makeBone('rightArm', 0.08, 0.25, 0.08, mat, torso);
  const lHand = makeBone('leftHand', 0.07, 0.1, 0.05, skinMat, lArm);
  const rHand = makeBone('rightHand', 0.07, 0.1, 0.05, skinMat, rArm);
  const lLeg = makeBone('leftLeg', 0.1, 0.35, 0.1, mat, hips);
  const rLeg = makeBone('rightLeg', 0.1, 0.35, 0.1, mat, hips);
  makeBone('leftFoot', 0.1, 0.06, 0.14, skinMat, lLeg);
  makeBone('rightFoot', 0.1, 0.06, 0.14, skinMat, rLeg);

  // weapon attach points
  const weaponAttachR = new TransformNode(`${prefix}_weaponR`, scene);
  weaponAttachR.parent = rHand;
  weaponAttachR.position.set(0, -0.08, 0.05);

  const weaponAttachL = new TransformNode(`${prefix}_weaponL`, scene);
  weaponAttachL.parent = lHand;
  weaponAttachL.position.set(0, -0.08, 0.05);

  // LOD proxy: single box for distant rendering (only in lightweight mode)
  let lodProxy: Mesh | null = null;
  if (lightweight) {
    lodProxy = MeshBuilder.CreateBox(`${prefix}_lod`, { width: 0.3, height: 1.2, depth: 0.2 }, scene);
    lodProxy.material = mat;
    lodProxy.parent = root;
    lodProxy.position.y = 0.8;
    lodProxy.isPickable = false;
    lodProxy.setEnabled(false); // hidden by default; shown when far
  }

  const detailMeshes = Array.from(bodyMeshes.values());

  return { root, bones, bodyMeshes, weaponAttachR, weaponAttachL, weaponMeshes: [], lodProxy, detailMeshes };
}

export function applyPose(fighter: CombatFighterVisual, pose: PoseData) {
  for (const [name, bp] of Object.entries(pose)) {
    const bone = fighter.bones.get(name);
    if (!bone) continue;
    bone.position.set(bp.pos[0], bp.pos[1], bp.pos[2]);
    bone.rotation.set(bp.rot[0], bp.rot[1], bp.rot[2]);
  }
}

// ─── VOX Weapon Mesh Builder ─────────────────────────────

export function buildVoxMesh(scene: Scene, voxels: VoxelEntry[], name: string): Mesh {
  // center voxels
  let cx = 0, cy = 0, cz = 0;
  for (const v of voxels) { cx += v.x; cy += v.y; cz += v.z; }
  cx /= voxels.length; cy /= voxels.length; cz /= voxels.length;

  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const v of voxels) {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      if (occupied.has(`${v.x + dx},${v.y + dy},${v.z + dz}`)) continue;

      const idx = positions.length / 3;
      for (const [fx, fy, fz] of FACE_VERTS[f]) {
        positions.push(
          (v.x - cx + fx) * SCALE,
          (v.y - cy + fy) * SCALE,
          (v.z - cz + fz) * SCALE,
        );
        const [nx, ny, nz] = FACE_NORMALS[f];
        normals.push(nx, ny, nz);
        colors.push(v.r, v.g, v.b, 1);
      }
      indices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
    }
  }

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  (mat as any).useVertexColors = true;  // vertex colors from VOX palette
  mesh.material = mat;

  return mesh;
}

export async function loadWeaponMesh(
  scene: Scene, voxPath: string, name: string, scale: number,
): Promise<Mesh> {
  const url = `/api/game-assets${voxPath}`;
  const { voxels } = await loadVoxFile(url);
  const mesh = buildVoxMesh(scene, voxels, name);
  mesh.scaling.setAll(scale);
  return mesh;
}

// ─── Equipment Meta Weapon Loader ────────────────────────

export interface EquipmentMeta {
  version: number;
  model_dir: string;
  pieces: Record<string, EquipmentPiece>;
}

export interface EquipmentPiece {
  key: string;
  equipment_type: string;
  grip_config: {
    default_grip: string;
    dominant_hand: string;
    primary_grip: { position: { x: number; y: number; z: number } } | null;
  };
  attack_methods: string[];
  weight: number;
  durability: number;
  direction?: {
    tip_position: { x: number; y: number; z: number };
    pommel_position: { x: number; y: number; z: number };
  };
}

export interface LoadedEquipmentWeapon {
  mesh: Mesh;
  piece: EquipmentPiece;
  gripWorld: Vector3;
  tipDir: Vector3;
  /** Distance from grip to tip in world units (after scale) */
  reach: number;
}

/**
 * Load a weapon from the wapons/ asset directory using equipment_meta.json.
 * - Reads equipment_meta.json for grip/tip/pommel
 * - Loads the .vox file
 * - Re-centers mesh so grip is at origin
 * - Rotates mesh so tip points along +Z (forward in hand)
 */
export async function loadEquipmentWeapon(
  scene: Scene,
  category: string,    // e.g. 'swords', 'axes'
  pieceKey: string,    // e.g. 'Adventurer_Sword', 'Axe'
  meshName: string,
  scale: number,
): Promise<LoadedEquipmentWeapon> {
  // load equipment_meta.json
  const metaUrl = `/api/game-assets/wapons/${category}/equipment_meta.json?v=${Date.now()}`;
  const metaResp = await fetch(metaUrl);
  if (!metaResp.ok) throw new Error(`Failed to load ${metaUrl}`);
  const meta: EquipmentMeta = await metaResp.json();

  const piece = meta.pieces[pieceKey];
  if (!piece) throw new Error(`Piece '${pieceKey}' not found in ${category}/equipment_meta.json`);

  // load grid.json for voxel_size
  const gridUrl = `/api/game-assets/wapons/${category}/${pieceKey}/grid.json?v=${Date.now()}`;
  const gridResp = await fetch(gridUrl);
  const grid = gridResp.ok ? await gridResp.json() : null;
  const voxelSize = grid?.voxel_size ?? 0.007;

  // load vox
  const voxUrl = `/api/game-assets/wapons/${category}/${pieceKey}/${pieceKey}.vox`;
  const { voxels } = await loadVoxFile(voxUrl);

  // get grip position in voxel coords
  const grip = piece.grip_config.primary_grip?.position ?? { x: 0, y: 0, z: 0 };
  const dir = piece.direction;
  const tip = dir?.tip_position ?? { x: 0, y: 0, z: 1 };
  const pommel = dir?.pommel_position ?? { x: 0, y: 0, z: 0 };

  // compute tip direction (pommel→tip)
  const tipDirRaw = new Vector3(
    tip.x - pommel.x,
    tip.y - pommel.y,
    tip.z - pommel.z,
  );
  if (tipDirRaw.length() < 0.01) tipDirRaw.set(0, 0, 1);
  tipDirRaw.normalize();

  // re-center voxels so grip is at origin, then build mesh
  const centeredVoxels = voxels.map(v => ({
    ...v,
    x: v.x - grip.x,
    y: v.y - grip.y,
    z: v.z - grip.z,
  }));

  // build mesh with voxel coordinates (not SCALE, use raw voxelSize)
  const mesh = buildVoxMeshRaw(scene, centeredVoxels, meshName, voxelSize);
  mesh.scaling.setAll(scale);

  // rotate mesh so tip points along +Z (forward from hand)
  // use rotationQuaternion for all rotations to avoid euler/quaternion conflict
  const { Quaternion } = await import('@babylonjs/core');
  const targetDir = new Vector3(0, 0, 1);
  let qAlign = Quaternion.Identity();

  const rotAxis = Vector3.Cross(tipDirRaw, targetDir);
  if (rotAxis.length() > 0.001) {
    rotAxis.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(tipDirRaw, targetDir))));
    qAlign = Quaternion.RotationAxis(rotAxis, angle);
  } else if (Vector3.Dot(tipDirRaw, targetDir) < 0) {
    qAlign = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI);
  }

  // additional 90° around Z for grip orientation
  const qGrip = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI / 2);
  mesh.rotationQuaternion = qGrip.multiply(qAlign);

  // compute reach: distance from grip to tip in voxel units, scaled to world
  const gripToTipDist = Math.sqrt(
    (tip.x - grip.x) ** 2 + (tip.y - grip.y) ** 2 + (tip.z - grip.z) ** 2
  );
  const reach = gripToTipDist * voxelSize * scale;

  return { mesh, piece, gripWorld: Vector3.Zero(), tipDir: tipDirRaw, reach };
}

/** Build vox mesh with raw voxel size (not using SCALE constant) */
function buildVoxMeshRaw(scene: Scene, voxels: VoxelEntry[], name: string, voxelSize: number): Mesh {
  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(`${v.x},${v.y},${v.z}`);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const v of voxels) {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      if (occupied.has(`${v.x + dx},${v.y + dy},${v.z + dz}`)) continue;

      const idx = positions.length / 3;
      for (const [fx, fy, fz] of FACE_VERTS[f]) {
        positions.push(
          (v.x + fx) * voxelSize,
          (v.y + fy) * voxelSize,
          (v.z + fz) * voxelSize,
        );
        const [nx, ny, nz] = FACE_NORMALS[f];
        normals.push(nx, ny, nz);
        colors.push(v.r, v.g, v.b, 1);
      }
      indices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
    }
  }

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  (mat as any).useVertexColors = true;
  mesh.material = mat;

  return mesh;
}

// ─── Voxel Armor System ──────────────────────────────────

/** Voxel grid dimensions per armor part [gx, gy, gz] */
const ARMOR_GRID_SIZES: Record<ArmorPart, [number, number, number]> = {
  head:     [8, 9, 8],
  torso:    [12, 14, 8],
  leftArm:  [5, 12, 5],
  rightArm: [5, 12, 5],
  leftLeg:  [5, 16, 5],
  rightLeg: [5, 16, 5],
};

/** World-space size of each armor part mesh (slightly larger than body to avoid z-fighting) */
const ARMOR_WORLD_SIZES: Record<ArmorPart, [number, number, number]> = {
  head:     [0.24, 0.26, 0.24],
  torso:    [0.42, 0.42, 0.28],
  leftArm:  [0.16, 0.32, 0.16],
  rightArm: [0.16, 0.32, 0.16],
  leftLeg:  [0.18, 0.42, 0.18],
  rightLeg: [0.18, 0.42, 0.18],
};

export interface VoxelArmorPiece {
  grid: boolean[][][];  // [x][y][z] true = voxel exists
  gx: number; gy: number; gz: number;
  dirty: boolean;       // needs mesh rebuild
  mesh: Mesh | null;
  totalVoxels: number;
}

export type VoxelArmorSet = Record<ArmorPart, VoxelArmorPiece>;

/** Create a shell of voxels (hollow box) for one armor part */
function createArmorGrid(gx: number, gy: number, gz: number): boolean[][][] {
  const grid: boolean[][][] = [];
  for (let x = 0; x < gx; x++) {
    grid[x] = [];
    for (let y = 0; y < gy; y++) {
      grid[x][y] = [];
      for (let z = 0; z < gz; z++) {
        // shell: only voxels on the surface
        const isEdge = x === 0 || x === gx - 1 || y === 0 || y === gy - 1 || z === 0 || z === gz - 1;
        grid[x][y][z] = isEdge;
      }
    }
  }
  return grid;
}

function countVoxels(grid: boolean[][][], gx: number, gy: number, gz: number): number {
  let c = 0;
  for (let x = 0; x < gx; x++)
    for (let y = 0; y < gy; y++)
      for (let z = 0; z < gz; z++)
        if (grid[x][y][z]) c++;
  return c;
}

export function createVoxelArmorSet(): VoxelArmorSet {
  const set: Partial<VoxelArmorSet> = {};
  for (const part of ARMOR_PARTS) {
    const [gx, gy, gz] = ARMOR_GRID_SIZES[part];
    const grid = createArmorGrid(gx, gy, gz);
    set[part] = { grid, gx, gy, gz, dirty: true, mesh: null, totalVoxels: countVoxels(grid, gx, gy, gz) };
  }
  return set as VoxelArmorSet;
}

/**
 * Remove voxels from armor at a local hit position.
 * - thrust: small sphere removal (radius ~1-2 voxels)
 * - slash: wide line removal across one axis
 * Returns number of voxels removed.
 */
export function damageArmor(
  piece: VoxelArmorPiece,
  hitLocalX: number, hitLocalY: number, hitLocalZ: number,
  attackType: AttackType,
): number {
  const { grid, gx, gy, gz } = piece;
  // convert normalized coords (-1..1) to grid coords
  const cx = Math.floor(((hitLocalX + 1) / 2) * gx);
  const cy = Math.floor(((hitLocalY + 1) / 2) * gy);
  const cz = hitLocalZ > 0 ? gz - 1 : 0; // front or back face

  let removed = 0;

  if (attackType === 'thrust') {
    // small sphere: radius 1-2 voxels
    const r = 2;
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) {
          if (x < 0 || x >= gx || y < 0 || y >= gy || z < 0 || z >= gz) continue;
          const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (d2 <= r * r && grid[x][y][z]) {
            grid[x][y][z] = false;
            removed++;
          }
        }
  } else {
    // slash: horizontal line across X, narrow in Y, all Z depth
    const halfW = Math.floor(gx * 0.4); // wide slash
    const halfH = 1;
    for (let x = cx - halfW; x <= cx + halfW; x++)
      for (let y = cy - halfH; y <= cy + halfH; y++)
        for (let z = 0; z < gz; z++) {
          if (x < 0 || x >= gx || y < 0 || y >= gy) continue;
          if (grid[x][y][z]) {
            grid[x][y][z] = false;
            removed++;
          }
        }
  }

  if (removed > 0) {
    piece.dirty = true;
    piece.totalVoxels -= removed;
  }
  return removed;
}

/** Check if armor has voxels near a hit position */
export function hasArmorAt(
  piece: VoxelArmorPiece,
  hitLocalX: number, hitLocalY: number, hitLocalZ: number,
): boolean {
  const { grid, gx, gy, gz } = piece;
  const cx = Math.floor(((hitLocalX + 1) / 2) * gx);
  const cy = Math.floor(((hitLocalY + 1) / 2) * gy);
  const cz = hitLocalZ > 0 ? gz - 1 : 0;
  // check small area around hit
  for (let x = cx - 1; x <= cx + 1; x++)
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let z = cz - 1; z <= cz + 1; z++) {
        if (x < 0 || x >= gx || y < 0 || y >= gy || z < 0 || z >= gz) continue;
        if (grid[x][y][z]) return true;
      }
  return false;
}

/** Build or rebuild a mesh from armor voxel grid */
export function rebuildArmorMesh(
  scene: Scene, piece: VoxelArmorPiece, part: ArmorPart,
  color: Color3, prefix: string,
): Mesh {
  if (piece.mesh) piece.mesh.dispose();

  const { grid, gx, gy, gz } = piece;
  const [wx, wy, wz] = ARMOR_WORLD_SIZES[part];
  const voxSizeX = wx / gx;
  const voxSizeY = wy / gy;
  const voxSizeZ = wz / gz;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const r = color.r, g = color.g, b = color.b;

  for (let x = 0; x < gx; x++)
    for (let y = 0; y < gy; y++)
      for (let z = 0; z < gz; z++) {
        if (!grid[x][y][z]) continue;
        // check 6 faces
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = FACE_DIRS[f];
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx >= 0 && nx < gx && ny >= 0 && ny < gy && nz >= 0 && nz < gz && grid[nx][ny][nz]) continue;

          const idx = positions.length / 3;
          for (const [fx, fy, fz] of FACE_VERTS[f]) {
            positions.push(
              (x + fx - gx / 2) * voxSizeX,
              (y + fy - gy / 2) * voxSizeY,
              (z + fz - gz / 2) * voxSizeZ,
            );
            const [fnx, fny, fnz] = FACE_NORMALS[f];
            normals.push(fnx, fny, fnz);
            // slight color variation per voxel
            const v = 0.9 + Math.random() * 0.2;
            colors.push(r * v, g * v, b * v, 1);
          }
          indices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
        }
      }

  const mesh = new Mesh(`${prefix}_armor_${part}`, scene);
  if (positions.length > 0) {
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.normals = normals;
    vertexData.colors = colors;
    vertexData.indices = indices;
    vertexData.applyToMesh(mesh);
  }

  const mat = new StandardMaterial(`${prefix}_armor_${part}_mat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.6, 0.6, 0.5);  // metallic sheen
  mat.specularPower = 32;
  (mat as any).useVertexColors = true;
  mesh.material = mat;

  piece.mesh = mesh;
  piece.dirty = false;
  return mesh;
}

// ─── State label ─────────────────────────────────────────

export function getCombatStateLabel(f: CombatFighter): string {
  switch (f.state) {
    case CombatState.IDLE: return '構え';
    case CombatState.APPROACH: return '接近';
    case CombatState.ATTACK_WINDUP: return '攻撃準備';
    case CombatState.ATTACK_STRIKE: return '攻撃！';
    case CombatState.ATTACK_RECOVER: return '隙';
    case CombatState.BLOCK: return '防御';
    case CombatState.HIT_STAGGER: return '被弾';
    case CombatState.DODGE: return '回避';
    case CombatState.ROUND_OVER_WIN: return '勝利';
    case CombatState.ROUND_OVER_LOSE: return 'KO';
  }
}
