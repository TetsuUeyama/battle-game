/**
 * Grapple move definitions: throws, takedowns, mounts.
 *
 * Each grapple has paired motions for attacker and defender,
 * plus timing phases: grab → execute → finish.
 */

export type GrappleFinish = 'knockdown' | 'knockdown_fwd' | 'mounted';

export interface GrappleDef {
  name: string;
  /** Motion file for the attacker */
  attackerMotion: string;
  /** Motion file for the defender (synchronized) */
  defenderMotion: string;
  /** Grab detection range (viewer units) */
  grabRange: number;
  /** Damage dealt on successful execution */
  damage: number;
  /** Timing phases (seconds) */
  timing: {
    /** Wind-up before grab connects */
    startup: number;
    /** Hold/execute duration (both locked) */
    execute: number;
    /** Attacker recovery after release */
    recovery: number;
  };
  /** Defender's offset from attacker during execute phase (local to attacker facing) */
  lockOffset: { forward: number; lateral: number };
  /** What happens to defender after grapple finishes */
  finishState: GrappleFinish;
  /** Knockback distance applied to defender at finish */
  throwDistance: number;
  /** Can be blocked? */
  blockable: boolean;
  /** Escape window: seconds during execute where mashing can break free */
  escapeWindow: number;
  /** Number of inputs needed to escape */
  escapeInputs: number;
}

export const GRAPPLES: Record<string, GrappleDef> = {
  takedown: {
    name: 'takedown',
    attackerMotion: '/models/character-motion/takedown_atk.motion.json',
    defenderMotion: '/models/character-motion/takedown_def.motion.json',
    grabRange: 0.45,
    damage: 15,
    timing: { startup: 0.2, execute: 0.8, recovery: 0.3 },
    lockOffset: { forward: 0.3, lateral: 0 },
    finishState: 'mounted',
    throwDistance: 0,
    blockable: false,
    escapeWindow: 0.6,
    escapeInputs: 5,
  },
  hip_throw: {
    name: 'hip_throw',
    attackerMotion: '/models/character-motion/hip_throw_atk.motion.json',
    defenderMotion: '/models/character-motion/hip_throw_def.motion.json',
    grabRange: 0.4,
    damage: 20,
    timing: { startup: 0.25, execute: 0.7, recovery: 0.4 },
    lockOffset: { forward: 0.25, lateral: 0.1 },
    finishState: 'knockdown',
    throwDistance: 0.5,
    blockable: false,
    escapeWindow: 0.4,
    escapeInputs: 6,
  },
};
