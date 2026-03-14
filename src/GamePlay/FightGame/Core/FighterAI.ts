/**
 * Simple fighting game AI.
 * Evaluates distance, opponent state, and own state to decide actions.
 *
 * Behaviors:
 *   - Approach when too far, retreat when too close
 *   - Attack when in range, choosing appropriate height
 *   - Block when opponent is attacking
 *   - Strafe occasionally to vary approach angle
 *   - Chain combos when landing hits
 *   - Ranged fighters (hasProjectile) keep distance and fire projectiles
 */

import type { FighterInput } from '@/GamePlay/FightGame/Core/InputHandler';
import type { FighterState } from '@/GamePlay/FightGame/Fighter/Fighter';
import { ATTACKS } from '@/GamePlay/FightGame/Config/AttackConfig';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

interface AIConfig {
  /** Reaction time: min seconds between decisions */
  reactionTime: number;
  /** Probability to block when opponent attacks (0-1) */
  blockChance: number;
  /** Probability to attempt attack when in range (0-1) */
  attackChance: number;
  /** Probability to combo after landing a hit (0-1) */
  comboChance: number;
  /** Preferred engagement distance (melee fighters) */
  preferredDist: number;
  /** Probability to strafe instead of walking straight (0-1) */
  strafeChance: number;
  /** Probability to attempt grapple at close range (0-1) */
  grappleChance: number;
  /** Mash speed during grapple escape (inputs per decision) */
  escapeMashRate: number;
}

const AI_CONFIGS: Record<AIDifficulty, AIConfig> = {
  easy: {
    reactionTime: 0.5,
    blockChance: 0.2,
    attackChance: 0.3,
    comboChance: 0.15,
    preferredDist: 0.5,
    strafeChance: 0.1,
    grappleChance: 0.05,
    escapeMashRate: 1,
  },
  normal: {
    reactionTime: 0.25,
    blockChance: 0.45,
    attackChance: 0.5,
    comboChance: 0.4,
    preferredDist: 0.45,
    strafeChance: 0.25,
    grappleChance: 0.12,
    escapeMashRate: 2,
  },
  hard: {
    reactionTime: 0.1,
    blockChance: 0.7,
    attackChance: 0.7,
    comboChance: 0.65,
    preferredDist: 0.4,
    strafeChance: 0.35,
    grappleChance: 0.2,
    escapeMashRate: 3,
  },
};

// Available attack pools by type
const PUNCH_ATTACKS = ['r_punch_mid', 'l_punch_mid', 'r_punch_upper', 'l_punch_upper', 'r_punch_lower', 'l_punch_lower'];
const KICK_ATTACKS = ['r_kick_mid', 'l_kick_mid', 'r_kick_upper', 'l_kick_upper', 'r_kick_lower', 'l_kick_lower'];

export class FighterAI {
  private config: AIConfig;
  private decisionTimer = 0;
  private currentDecision: FighterInput;
  private lastAttackName: string | null = null;

  /** When true, AI prefers ranged combat with projectiles */
  private hasProjectile = false;
  /** When true, AI periodically uses vine_whip attack */
  private hasVineWhip = false;
  /** Preferred distance for ranged fighters (overrides config.preferredDist) */
  private rangedPreferredDist = 1.8;
  /** Cooldown between projectile shots to avoid spamming */
  private projectileCooldown = 0;
  /** Cooldown between vine whip uses */
  private vineWhipCooldown = 0;

  constructor(difficulty: AIDifficulty = 'normal') {
    this.config = AI_CONFIGS[difficulty];
    this.currentDecision = this.emptyInput();
  }

  setDifficulty(difficulty: AIDifficulty): void {
    this.config = AI_CONFIGS[difficulty];
  }

  /** Enable ranged fighting style (for characters with projectile attacks) */
  setHasProjectile(value: boolean): void {
    this.hasProjectile = value;
  }

  /** Enable vine whip special attack */
  setHasVineWhip(value: boolean): void {
    this.hasVineWhip = value;
  }

  /**
   * Generate input for this AI-controlled fighter.
   */
  update(self: FighterState, opponent: FighterState, dt: number): FighterInput {
    this.decisionTimer -= dt;
    if (this.projectileCooldown > 0) this.projectileCooldown -= dt;
    if (this.vineWhipCooldown > 0) this.vineWhipCooldown -= dt;

    // Only make new decisions at reaction-time intervals
    if (this.decisionTimer > 0) {
      // Clear one-shot inputs after first frame
      const out = { ...this.currentDecision };
      this.currentDecision.attack = null;
      this.currentDecision.jump = false;
      this.currentDecision.special = false;
      this.currentDecision.strongSpecial = false;
      return out;
    }

    this.decisionTimer = this.config.reactionTime * (0.7 + Math.random() * 0.6);
    this.currentDecision = this.decide(self, opponent);

    // Track attack for combo purposes
    if (this.currentDecision.attack) {
      this.lastAttackName = this.currentDecision.attack;
    }

    return { ...this.currentDecision };
  }

  private decide(self: FighterState, opponent: FighterState): FighterInput {
    const input = this.emptyInput();

    // Can't act during stun/knockdown
    if (self.stunTimer > 0 || self.action === 'knockdown') {
      return input;
    }

    const dx = opponent.x - self.x;
    const dz = opponent.z - self.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const opponentAttacking = opponent.action === 'attack' &&
      (opponent.attackPhase === 'startup' || opponent.attackPhase === 'active');

    const canAct = self.action === 'idle' || self.action === 'walk_fwd' ||
      self.action === 'walk_back' || self.action === 'strafe';

    // === DEFENSIVE: Block when opponent attacks nearby ===
    if (opponentAttacking && dist < 0.8 && !self.guardBroken) {
      if (Math.random() < this.config.blockChance) {
        input.block = true;
        return input;
      }
    }

    // === ESCAPE: Mash when grappled ===
    if (self.action === 'grappled') {
      input.mash = Math.random() < 0.5;
      return input;
    }

    // === MOUNT PUNCH: Attack when grappling (mounted) ===
    if (self.action === 'grapple') {
      input.attack = 'r_punch_mid';
      return input;
    }

    // === VINE WHIP: Healer special — bind opponent ===
    // Priority over normal melee: wide range, high probability when off cooldown
    if (this.hasVineWhip && canAct && this.vineWhipCooldown <= 0 && dist < 2.0) {
      if (Math.random() < 0.7) {
        input.attack = 'vine_whip';
        this.vineWhipCooldown = 5.0 + Math.random() * 3.0;
        return input;
      }
    }

    // === RANGED FIGHTER BEHAVIOR ===
    if (this.hasProjectile && canAct) {
      return this.decideRanged(self, opponent, dist, opponentAttacking, input);
    }

    // === GRAPPLE: Very close range ===
    const grappleRange = 0.4;
    if (dist < grappleRange && canAct && Math.random() < this.config.grappleChance) {
      input.grapple = Math.random() < 0.5 ? 'takedown' : 'hip_throw';
      return input;
    }

    // === ATTACK: When in range ===
    const attackRange = 0.65;

    if (dist < attackRange && canAct) {
      // Try combo chain if we just landed a hit
      if (self.action === 'attack' && self.attackPhase === 'recovery' && self.currentAttack?.canChainInto) {
        if (Math.random() < this.config.comboChance) {
          const chains = self.currentAttack.canChainInto;
          input.attack = chains[Math.floor(Math.random() * chains.length)];
          return input;
        }
      }

      if (Math.random() < this.config.attackChance) {
        input.attack = this.chooseAttack(dist);
        return input;
      }
    }

    // === MOVEMENT ===
    this.applyMovement(input, dist, this.config.preferredDist);

    return input;
  }

  /**
   * Ranged fighter decision logic:
   * - Keep distance (preferredDist ~1.8)
   * - Fire projectiles frequently
   * - Retreat + strafe when opponent approaches
   * - Only melee as a last resort when cornered
   */
  private decideRanged(
    self: FighterState,
    _opponent: FighterState,
    dist: number,
    opponentAttacking: boolean,
    input: FighterInput,
  ): FighterInput {
    // Retreat urgently when opponent is very close and attacking
    if (dist < 0.6 && opponentAttacking) {
      input.backward = true;
      if (Math.random() < 0.6) {
        if (Math.random() < 0.5) input.strafeLeft = true;
        else input.strafeRight = true;
      }
      return input;
    }

    // Close range: melee kick to push opponent back, then retreat
    if (dist < 0.5) {
      if (Math.random() < 0.6) {
        // Kick to create space
        const kickPool = ['r_kick_mid', 'l_kick_mid', 'r_kick_lower'];
        input.attack = kickPool[Math.floor(Math.random() * kickPool.length)];
      } else {
        input.backward = true;
      }
      return input;
    }

    // Mid range (0.5 ~ 1.2): retreat to get to preferred range while strafing
    if (dist < this.rangedPreferredDist - 0.3) {
      input.backward = true;
      // Strafe while retreating to be harder to catch
      if (Math.random() < 0.7) {
        if (Math.random() < 0.5) input.strafeLeft = true;
        else input.strafeRight = true;
      }
      return input;
    }

    // Optimal range (1.2 ~ 3.0): fire projectiles
    if (dist >= this.rangedPreferredDist - 0.3 && dist < 3.5) {
      if (this.projectileCooldown <= 0) {
        // 15% chance for strong attack, 85% for rapid fire
        if (Math.random() < 0.15) {
          input.strongSpecial = true;
          this.projectileCooldown = 1.5 + Math.random() * 1.0;
        } else {
          input.special = true;
          this.projectileCooldown = 0.15 + Math.random() * 0.15; // rapid fire
        }
        return input;
      }
      // Strafe while waiting for cooldown
      if (Math.random() < 0.8) {
        if (Math.random() < 0.5) input.strafeLeft = true;
        else input.strafeRight = true;
      }
      return input;
    }

    // Too far: approach to projectile range
    if (dist >= 3.5) {
      input.forward = true;
      if (Math.random() < this.config.strafeChance) {
        if (Math.random() < 0.5) input.strafeLeft = true;
        else input.strafeRight = true;
      }
      return input;
    }

    return input;
  }

  private applyMovement(input: FighterInput, dist: number, preferredDist: number): void {
    if (dist > preferredDist + 0.15) {
      input.forward = true;
      if (Math.random() < this.config.strafeChance) {
        if (Math.random() < 0.5) input.strafeLeft = true;
        else input.strafeRight = true;
      }
    } else if (dist < preferredDist - 0.1) {
      input.backward = true;
    } else {
      if (Math.random() < this.config.strafeChance * 2) {
        if (Math.random() < 0.5) input.strafeLeft = true;
        else input.strafeRight = true;
      }
    }
  }

  private chooseAttack(dist: number): string {
    const useKick = dist > 0.45 ? 0.7 : 0.3;
    const pool = Math.random() < useKick ? KICK_ATTACKS : PUNCH_ATTACKS;

    if (this.lastAttackName) {
      const lastAttack = ATTACKS[this.lastAttackName];
      if (lastAttack?.canChainInto && lastAttack.canChainInto.length > 0 &&
          Math.random() < this.config.comboChance) {
        const chains = lastAttack.canChainInto;
        return chains[Math.floor(Math.random() * chains.length)];
      }
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  private emptyInput(): FighterInput {
    return {
      forward: false, backward: false,
      strafeLeft: false, strafeRight: false,
      jump: false, attack: null, block: false,
      grapple: null, mash: false, special: false, strongSpecial: false,
    };
  }
}
