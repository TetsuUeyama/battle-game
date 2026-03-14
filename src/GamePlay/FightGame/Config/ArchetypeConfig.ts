/**
 * Fighter archetypes: define stat variations for team battle.
 * Team 1 = 3 Tanks (male), Team 2 = Ranged + Speed + Assassin (female).
 */

export interface FighterArchetype {
  id: string;
  label: string;
  maxHp: number;
  moveSpeedMultiplier: number;
  startupScale: number;
  recoveryScale: number;
  hasProjectile: boolean;
  /** Area heal: HP restored per second to nearby allies within healRadius */
  healPerSec: number;
  /** Radius (viewer units) within which allies are healed */
  healRadius: number;
  /** Can use vine_whip attack */
  hasVineWhip: boolean;
}

export const ARCHETYPES: Record<string, FighterArchetype> = {
  tank: {
    id: 'tank', label: 'Tank',
    maxHp: 200, moveSpeedMultiplier: 0.5,
    startupScale: 2.0, recoveryScale: 2.0,
    hasProjectile: false,
    healPerSec: 0, healRadius: 0,
    hasVineWhip: false,
  },
  ranged: {
    id: 'ranged', label: 'Ranged',
    maxHp: 100, moveSpeedMultiplier: 2.0,
    startupScale: 1.0, recoveryScale: 1.0,
    hasProjectile: true,
    healPerSec: 0, healRadius: 0,
    hasVineWhip: false,
  },
  healer: {
    id: 'healer', label: 'Healer',
    maxHp: 120, moveSpeedMultiplier: 3.0,
    startupScale: 1.0, recoveryScale: 1.0,
    hasProjectile: false,
    healPerSec: 5, healRadius: 3.0,
    hasVineWhip: true,
  },
  assassin: {
    id: 'assassin', label: 'Assassin',
    maxHp: 100, moveSpeedMultiplier: 2.0,
    startupScale: 0.5, recoveryScale: 0.5,
    hasProjectile: false,
    healPerSec: 0, healRadius: 0,
    hasVineWhip: false,
  },
};

export const TEAM1_ARCHETYPES = ['tank', 'tank', 'tank'];
export const TEAM2_ARCHETYPES = ['ranged', 'healer', 'assassin'];
