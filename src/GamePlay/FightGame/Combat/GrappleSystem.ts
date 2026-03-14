/**
 * GrappleSystem: manages synchronized two-fighter grapple animations.
 *
 * Phases:
 *   startup  — attacker lunges, defender can still act
 *   execute  — both locked, defender position relative to attacker
 *   release  — defender thrown/knocked down, attacker recovers
 *   mounted  — attacker on top, defender pinned (special sub-state)
 */

import type { FighterState } from '@/GamePlay/FightGame/Fighter/Fighter';
import type { GrappleDef } from '@/GamePlay/FightGame/Config/GrappleConfig';
import { GRAPPLES } from '@/GamePlay/FightGame/Config/GrappleConfig';

export interface GrappleState {
  /** Currently active grapple (null if none) */
  active: GrappleDef | null;
  /** Current phase */
  phase: 'startup' | 'execute' | 'release' | 'mounted' | 'none';
  /** Timer within current phase */
  phaseTimer: number;
  /** Index of attacker: 1 or 2 */
  attackerIndex: 1 | 2;
  /** Escape progress (defender mashing) */
  escapeProgress: number;
  /** Mount sub-state: attacker can punch while mounted */
  mountTimer: number;
  /** Mount hit count */
  mountHits: number;
}

export function createGrappleState(): GrappleState {
  return {
    active: null,
    phase: 'none',
    phaseTimer: 0,
    attackerIndex: 1,
    escapeProgress: 0,
    mountTimer: 0,
    mountHits: 0,
  };
}

/** Check if a grapple can be initiated */
export function canInitiateGrapple(
  attacker: FighterState,
  defender: FighterState,
  grapple: GrappleState,
): boolean {
  if (grapple.phase !== 'none') return false;
  if (attacker.action !== 'idle' && attacker.action !== 'walk_fwd' &&
      attacker.action !== 'strafe') return false;
  if (defender.action === 'knockdown') return false;
  if (attacker.stunTimer > 0) return false;
  return true;
}

/** Start a grapple */
export function startGrapple(
  grappleName: string,
  grapple: GrappleState,
  attackerIndex: 1 | 2,
  attacker: FighterState,
  defender: FighterState,
): boolean {
  const def = GRAPPLES[grappleName];
  if (!def) return false;

  // Range check
  const dx = defender.x - attacker.x;
  const dz = defender.z - attacker.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > def.grabRange) return false;

  grapple.active = def;
  grapple.phase = 'startup';
  grapple.phaseTimer = 0;
  grapple.attackerIndex = attackerIndex;
  grapple.escapeProgress = 0;
  grapple.mountTimer = 0;
  grapple.mountHits = 0;

  // Set both fighters to grapple state with motion keys
  attacker.action = 'grapple';
  attacker.currentAttack = null;
  attacker.stunTimer = 0;
  attacker.currentMotion = null;
  attacker.grappleMotionKey = `grapple_${grappleName}_atk`;

  defender.action = 'grappled';
  defender.currentAttack = null;
  defender.stunTimer = 0;
  defender.currentMotion = null;
  defender.grappleMotionKey = `grapple_${grappleName}_def`;

  return true;
}

/** Result of a grapple update tick */
export interface GrappleUpdateResult {
  /** Damage dealt this frame (to defender) */
  damage: number;
  /** Grapple just ended */
  ended: boolean;
  /** Defender escaped */
  escaped: boolean;
  /** Mount punch landed */
  mountPunchLanded: boolean;
}

const MOUNT_PUNCH_INTERVAL = 0.4; // seconds between mount punches
const MOUNT_PUNCH_DAMAGE = 5;
const MOUNT_MAX_DURATION = 3.0; // max mount time before auto-release

/**
 * Update the grapple system for one frame.
 * Handles phase transitions, position locking, and escape.
 */
export function updateGrapple(
  grapple: GrappleState,
  attacker: FighterState,
  defender: FighterState,
  defenderEscapeInput: boolean,
  attackerPunchInput: boolean,
  dt: number,
): GrappleUpdateResult {
  const result: GrappleUpdateResult = {
    damage: 0, ended: false, escaped: false, mountPunchLanded: false,
  };

  if (grapple.phase === 'none' || !grapple.active) return result;

  grapple.phaseTimer += dt;
  const def = grapple.active;

  switch (grapple.phase) {
    case 'startup': {
      // Attacker lunges toward defender
      const dx = defender.x - attacker.x;
      const dz = defender.z - attacker.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.01) {
        const speed = 2.0; // lunge speed
        const moveAmt = Math.min(speed * dt, dist - 0.15);
        attacker.x += (dx / dist) * moveAmt;
        attacker.z += (dz / dist) * moveAmt;
      }

      if (grapple.phaseTimer >= def.timing.startup) {
        grapple.phase = 'execute';
        grapple.phaseTimer = 0;
      }
      break;
    }

    case 'execute': {
      // Lock defender position relative to attacker
      lockDefenderPosition(attacker, defender, def);

      // Defender can mash to escape
      if (defenderEscapeInput) {
        grapple.escapeProgress++;
      }

      // Check escape
      if (grapple.phaseTimer <= def.escapeWindow &&
          grapple.escapeProgress >= def.escapeInputs) {
        // Escaped!
        endGrapple(grapple, attacker, defender);
        result.ended = true;
        result.escaped = true;
        // Push attacker back
        const dx = attacker.x - defender.x;
        const dz = attacker.z - defender.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        attacker.x += (dx / dist) * 0.3;
        attacker.z += (dz / dist) * 0.3;
        attacker.stunTimer = 0.3; // brief stun on escape
        attacker.action = 'hitstun';
        return result;
      }

      if (grapple.phaseTimer >= def.timing.execute) {
        result.damage = def.damage;

        if (def.finishState === 'mounted') {
          // Transition to mount
          grapple.phase = 'mounted';
          grapple.phaseTimer = 0;
          grapple.mountTimer = 0;
          grapple.mountHits = 0;
          defender.knockdownVariant = 'knockdown';
        } else {
          // Throw: apply knockback and end
          grapple.phase = 'release';
          grapple.phaseTimer = 0;
          applyThrow(attacker, defender, def);
        }
      }
      break;
    }

    case 'release': {
      if (grapple.phaseTimer >= def.timing.recovery) {
        endGrapple(grapple, attacker, defender);
        result.ended = true;
      }
      break;
    }

    case 'mounted': {
      // Attacker is on top, can punch
      lockDefenderPosition(attacker, defender, def);
      grapple.mountTimer += dt;

      // Auto-punch or manual punch
      if (attackerPunchInput && grapple.phaseTimer >= MOUNT_PUNCH_INTERVAL) {
        grapple.phaseTimer = 0;
        grapple.mountHits++;
        result.damage = MOUNT_PUNCH_DAMAGE;
        result.mountPunchLanded = true;
      }

      // Defender mash to escape
      if (defenderEscapeInput) {
        grapple.escapeProgress++;
      }

      // Escape from mount (needs more inputs)
      const mountEscapeNeeded = def.escapeInputs * 2;
      if (grapple.escapeProgress >= mountEscapeNeeded) {
        endGrapple(grapple, attacker, defender);
        result.ended = true;
        result.escaped = true;
        // Push attacker off
        const dx = attacker.x - defender.x;
        const dz = attacker.z - defender.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;
        attacker.x += (dx / dist) * 0.4;
        attacker.z += (dz / dist) * 0.4;
        return result;
      }

      // Max duration
      if (grapple.mountTimer >= MOUNT_MAX_DURATION) {
        endGrapple(grapple, attacker, defender);
        result.ended = true;
      }
      break;
    }
  }

  return result;
}

/** Lock defender to attacker's front */
function lockDefenderPosition(
  attacker: FighterState,
  defender: FighterState,
  def: GrappleDef,
): void {
  const cosA = Math.cos(attacker.facingAngle);
  const sinA = Math.sin(attacker.facingAngle);
  // Forward offset
  defender.x = attacker.x + cosA * def.lockOffset.forward - sinA * def.lockOffset.lateral;
  defender.z = attacker.z + sinA * def.lockOffset.forward + cosA * def.lockOffset.lateral;
  // Defender faces attacker
  defender.facingAngle = Math.atan2(attacker.z - defender.z, attacker.x - defender.x);
}

/** Apply throw to defender */
function applyThrow(
  attacker: FighterState,
  defender: FighterState,
  def: GrappleDef,
): void {
  const cosA = Math.cos(attacker.facingAngle);
  const sinA = Math.sin(attacker.facingAngle);
  defender.x += cosA * def.throwDistance;
  defender.z += sinA * def.throwDistance;
  defender.action = 'knockdown';
  defender.knockdownVariant = def.finishState === 'knockdown_fwd' ? 'knockdown_fwd' : 'knockdown';
  defender.stunTimer = 0;
  defender.currentMotion = null;
}

/** End grapple and reset both fighters */
function endGrapple(
  grapple: GrappleState,
  attacker: FighterState,
  defender: FighterState,
): void {
  if (attacker.action === 'grapple') {
    attacker.action = 'idle';
    attacker.currentMotion = null;
    attacker.grappleMotionKey = null;
  }
  if (defender.action === 'grappled') {
    defender.action = 'idle';
    defender.currentMotion = null;
    defender.grappleMotionKey = null;
  }
  grapple.active = null;
  grapple.phase = 'none';
  grapple.phaseTimer = 0;
  grapple.escapeProgress = 0;
}

/** Check if grapple is currently active */
export function isGrappleActive(grapple: GrappleState): boolean {
  return grapple.phase !== 'none' && grapple.active !== null;
}
