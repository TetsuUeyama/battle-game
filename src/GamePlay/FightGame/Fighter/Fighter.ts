/**
 * Fighter entity: 3D position, facing angle, state, action management.
 * Pure data + logic, no rendering.
 */

import { DEFAULT_FIGHTER_STATS } from '@/GamePlay/FightGame/Config/FighterConfig';
import type { FighterStats } from '@/GamePlay/FightGame/Config/FighterConfig';
import { ATTACKS } from '@/GamePlay/FightGame/Config/AttackConfig';
import type { AttackDef } from '@/GamePlay/FightGame/Config/AttackConfig';
import type { FighterInput } from '@/GamePlay/FightGame/Core/InputHandler';
import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';
import { getGroundHeight } from '@/GamePlay/FightGame/Stage/StageBuilder';

export type FighterAction = 'idle' | 'walk_fwd' | 'walk_back' | 'strafe' | 'jump' | 'block' | 'attack' | 'hitstun' | 'knockdown' | 'grapple' | 'grappled' | 'bound';
export type AttackPhase = 'startup' | 'active' | 'recovery';

export interface FighterState {
  // Position in 3D viewer space (XZ = ground plane, Y = up)
  x: number;
  y: number;           // vertical (0 = ground)
  z: number;           // depth
  vy: number;          // vertical velocity

  // Facing angle in radians (0 = +X direction, PI/2 = +Z direction)
  facingAngle: number;

  // Action
  action: FighterAction;
  actionTimer: number;

  // Attack state
  currentAttack: AttackDef | null;
  attackPhase: AttackPhase;
  attackPhaseTimer: number;
  attackHasHit: boolean;
  bufferedAttack: string | null;  // input buffer for chain attacks

  // Stun
  stunTimer: number;

  // Guard
  guard: number;
  guardRegenCooldown: number;  // seconds until regen starts
  guardBroken: boolean;        // true when guard was broken (can't block until full regen)

  // Stats
  stats: FighterStats;

  // Motion playback
  currentMotion: string | null;
  motionTime: number;

  // Knockdown variant: 'knockdown' (backward) or 'knockdown_fwd' (forward)
  knockdownVariant: string;

  // Grapple motion key: e.g., 'grapple_takedown_atk' or 'grapple_takedown_def'
  grappleMotionKey: string | null;

  // Attack timing multipliers (1.0 = default, >1 = slower)
  startupScale: number;
  recoveryScale: number;

  // Knockdown recovery timer (seconds remaining before standing up)
  knockdownTimer: number;

  // Vine bind state
  bindTimer: number;         // remaining seconds of bind (0 = not bound)
  bindDotPerSec: number;     // DOT damage per second while bound
  bindMashCount: number;     // accumulated mash presses toward escape
  bindMashThreshold: number; // mash presses needed to break free early
}

export function createFighter(spawnX: number, spawnZ: number, facingAngle: number, stats?: Partial<FighterStats>): FighterState {
  return {
    x: spawnX,
    y: STAGE_CONFIG.groundY,
    z: spawnZ,
    vy: 0,
    facingAngle,
    action: 'idle',
    actionTimer: 0,
    currentAttack: null,
    attackPhase: 'startup',
    attackPhaseTimer: 0,
    attackHasHit: false,
    bufferedAttack: null,
    stunTimer: 0,
    guard: DEFAULT_FIGHTER_STATS.maxGuard,
    guardRegenCooldown: 0,
    guardBroken: false,
    stats: { ...DEFAULT_FIGHTER_STATS, ...stats },
    currentMotion: null,
    motionTime: 0,
    knockdownVariant: 'knockdown',
    grappleMotionKey: null,
    startupScale: 1.0,
    recoveryScale: 1.0,
    knockdownTimer: 0,
    bindTimer: 0,
    bindDotPerSec: 0,
    bindMashCount: 0,
    bindMashThreshold: 10,
  };
}

export function isGrounded(f: FighterState): boolean {
  const ground = getGroundHeight(f.x, f.z);
  return f.y <= ground + 0.001;
}

export function canAct(f: FighterState): boolean {
  return f.action === 'idle' || f.action === 'walk_fwd' || f.action === 'walk_back' || f.action === 'strafe';
}


export function canBlock(f: FighterState): boolean {
  return isGrounded(f) && !f.guardBroken && (canAct(f) || f.action === 'block');
}

/** Angle from fighter to opponent (radians) */
function angleToOpponent(f: FighterState, ox: number, oz: number): number {
  return Math.atan2(oz - f.z, ox - f.x);
}

/**
 * Check if opponent is within the fighter's forward arc (±90°).
 * Uses dot product of facing direction and direction to opponent.
 */
export function isOpponentInFront(f: FighterState, ox: number, oz: number): boolean {
  const toOppX = ox - f.x;
  const toOppZ = oz - f.z;
  const faceDirX = Math.cos(f.facingAngle);
  const faceDirZ = Math.sin(f.facingAngle);
  return (toOppX * faceDirX + toOppZ * faceDirZ) > 0;
}

/**
 * Update fighter for one frame (3D movement).
 * Forward/back is relative to the facing direction (always toward/away from opponent).
 * Strafe is perpendicular to facing.
 */
export function updateFighter(f: FighterState, input: FighterInput, opponentX: number, opponentZ: number, dt: number): void {
  // Check opponent direction BEFORE auto-face (so attacks respect current facing)
  const opponentInFront = isOpponentInFront(f, opponentX, opponentZ);

  // Auto-face opponent
  if (f.action !== 'knockdown') {
    f.facingAngle = angleToOpponent(f, opponentX, opponentZ);
  }

  f.actionTimer += dt;
  f.motionTime += dt;

  // Guard regen
  if (f.action !== 'block') {
    if (f.guardRegenCooldown > 0) {
      f.guardRegenCooldown -= dt;
    } else if (f.guard < f.stats.maxGuard) {
      f.guard = Math.min(f.stats.maxGuard, f.guard + f.stats.guardRegenRate * dt);
      if (f.guardBroken && f.guard >= f.stats.maxGuard) {
        f.guardBroken = false;
      }
    }
  }

  // Stun countdown
  if (f.stunTimer > 0) {
    f.stunTimer -= dt;
    if (f.stunTimer <= 0) {
      f.stunTimer = 0;
      f.action = 'idle';
      f.currentMotion = null;
    }
    return;
  }

  // Attack phase progression
  if (f.action === 'attack' && f.currentAttack) {
    f.attackPhaseTimer += dt;
    const timing = f.currentAttack.timing;
    const scaledStartup = timing.startup * f.startupScale;
    const scaledRecovery = timing.recovery * f.recoveryScale;

    // Lunge: move forward during startup phase
    if (f.attackPhase === 'startup' && f.currentAttack.lunge > 0) {
      const lungeSpeed = f.currentAttack.lunge / scaledStartup;
      const cosA = Math.cos(f.facingAngle);
      const sinA = Math.sin(f.facingAngle);
      f.x += cosA * lungeSpeed * dt;
      f.z += sinA * lungeSpeed * dt;
    }

    // Buffer input during active/recovery for smoother chains
    if (input.attack && (f.attackPhase === 'active' || f.attackPhase === 'recovery')) {
      f.bufferedAttack = input.attack;
    }

    if (f.attackPhase === 'startup' && f.attackPhaseTimer >= scaledStartup) {
      f.attackPhase = 'active';
      f.attackPhaseTimer = 0;
    } else if (f.attackPhase === 'active' && f.attackPhaseTimer >= timing.active) {
      f.attackPhase = 'recovery';
      f.attackPhaseTimer = 0;
    } else if (f.attackPhase === 'recovery' && f.attackPhaseTimer >= scaledRecovery) {
      const canChain = f.currentAttack.canChainInto;
      // Check buffered input or current input
      const nextAttack = input.attack || f.bufferedAttack;
      let chained = false;
      if (canChain && nextAttack && canChain.includes(nextAttack)) {
        startAttack(f, nextAttack);
        chained = true;
      }
      if (!chained) {
        f.action = 'idle';
        f.currentAttack = null;
        f.currentMotion = null;
      }
      f.bufferedAttack = null;
    }
    applyGravity(f, dt);
    clampToArena(f);
    return;
  }

  // Knockdown recovery: stand up after timer expires
  if (f.action === 'knockdown') {
    f.knockdownTimer -= dt;
    if (f.knockdownTimer <= 0) {
      f.knockdownTimer = 0;
      f.action = 'idle';
      f.currentMotion = null;
      f.knockdownVariant = 'knockdown';
    }
    applyGravity(f, dt);
    clampToArena(f);
    return;
  }

  // Bound (vine bind): can't act, only released when timer expires (permanent bind = KO from DOT)
  if (f.action === 'bound') {
    f.bindTimer -= dt;
    if (f.bindTimer <= 0) {
      f.bindTimer = 0;
      f.bindDotPerSec = 0;
      f.bindMashCount = 0;
      f.action = 'idle';
      f.currentMotion = null;
    }
    return;
  }

  // Block
  if (input.block && canBlock(f)) {
    f.action = 'block';
    f.currentMotion = null;
  } else if (f.action === 'block' && !input.block) {
    f.action = 'idle';
  }

  // Attack inputs (only if opponent is in forward arc ±90°)
  if (canAct(f)) {
    if (input.attack && opponentInFront) {
      startAttack(f, input.attack);
      return;
    }

    // Jump
    if (input.jump && isGrounded(f)) {
      f.action = 'jump';
      f.vy = f.stats.jumpVelocity;
      f.actionTimer = 0;
    }

    // 3D Movement (relative to facing direction)
    if (f.action !== 'jump' && f.action !== 'block') {
      const cosA = Math.cos(f.facingAngle);
      const sinA = Math.sin(f.facingAngle);

      // Forward/backward along facing direction
      let moveX = 0, moveZ = 0;
      let newAction: FighterAction = 'idle';

      if (input.forward) {
        moveX += cosA;
        moveZ += sinA;
        newAction = 'walk_fwd';
      }
      if (input.backward) {
        moveX -= cosA;
        moveZ -= sinA;
        newAction = 'walk_back';
      }
      // Strafe: perpendicular to facing (left = -90°, right = +90°)
      if (input.strafeLeft) {
        moveX -= sinA;
        moveZ += cosA;
        newAction = newAction === 'idle' ? 'strafe' : newAction;
      }
      if (input.strafeRight) {
        moveX += sinA;
        moveZ -= cosA;
        newAction = newAction === 'idle' ? 'strafe' : newAction;
      }

      // Normalize diagonal movement
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0.001) {
        const speed = newAction === 'walk_back' ? f.stats.moveSpeed * 0.7 : f.stats.moveSpeed;
        f.x += (moveX / len) * speed * dt;
        f.z += (moveZ / len) * speed * dt;
        f.action = newAction;
      } else {
        f.action = 'idle';
      }
    }
  }

  applyGravity(f, dt);
  clampToArena(f);
}

function startAttack(f: FighterState, attackName: string): void {
  const attack = ATTACKS[attackName];
  if (!attack) return;
  f.action = 'attack';
  f.currentAttack = attack;
  f.attackPhase = 'startup';
  f.attackPhaseTimer = 0;
  f.attackHasHit = false;
  f.actionTimer = 0;
  f.currentMotion = attack.motionFile;
  f.motionTime = 0;
}

function applyGravity(f: FighterState, dt: number): void {
  const ground = getGroundHeight(f.x, f.z);
  if (!isGrounded(f) || f.vy > 0) {
    f.vy -= f.stats.gravity * dt;
    f.y += f.vy * dt;
    if (f.y <= ground) {
      f.y = ground;
      f.vy = 0;
      if (f.action === 'jump') {
        f.action = 'idle';
        f.currentMotion = null;
      }
    }
  } else {
    // Snap to terrain when walking on slopes
    f.y = ground;
  }
}

/** Clamp fighter position to active battle zone and snap to terrain */
function clampToArena(f: FighterState): void {
  const zone = STAGE_CONFIG.activeZone;
  if (f.x > zone.halfX) f.x = zone.halfX;
  else if (f.x < -zone.halfX) f.x = -zone.halfX;
  if (f.z > zone.halfZ) f.z = zone.halfZ;
  else if (f.z < -zone.halfZ) f.z = -zone.halfZ;

  // Snap to ground after position change to prevent sinking/floating
  const ground = getGroundHeight(f.x, f.z);
  if (f.y < ground) f.y = ground;
}

/**
 * Apply hit to fighter (3D knockback along attacker→defender direction).
 */
export function applyHit(
  defender: FighterState,
  attack: AttackDef,
  attackerX: number,
  attackerZ: number,
): boolean {
  if (defender.action === 'knockdown') return false;

  // Knockback direction: from attacker toward defender
  const dx = defender.x - attackerX;
  const dz = defender.z - attackerZ;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1;
  const kbX = (dx / dist) * attack.knockback;
  const kbZ = (dz / dist) * attack.knockback;

  if (defender.action === 'block') {
    // Consume guard gauge
    const guardDmg = attack.damage * 0.8;
    defender.guard -= guardDmg;
    defender.guardRegenCooldown = defender.stats.guardRegenDelay;

    if (defender.guard <= 0) {
      // Guard break!
      defender.guard = 0;
      defender.guardBroken = true;
      defender.stunTimer = attack.hitStun * 1.5; // extra stun on guard break
      defender.action = 'hitstun';
      defender.x += kbX * 0.6;
      defender.z += kbZ * 0.6;
      defender.y = getGroundHeight(defender.x, defender.z);
      clampToArena(defender);
      return true; // guard break counts as hit
    }

    defender.stunTimer = attack.blockStun;
    defender.action = 'hitstun';
    defender.x += kbX * 0.3;
    defender.z += kbZ * 0.3;
    defender.y = getGroundHeight(defender.x, defender.z);
    clampToArena(defender);
    return false;
  }

  defender.stunTimer = attack.hitStun;
  defender.action = 'hitstun';
  defender.currentAttack = null;
  defender.currentMotion = null;
  defender.x += kbX;
  defender.z += kbZ;
  defender.y = getGroundHeight(defender.x, defender.z);
  clampToArena(defender);
  return true;
}
