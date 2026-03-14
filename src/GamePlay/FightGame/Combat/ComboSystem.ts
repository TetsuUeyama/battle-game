/**
 * Combo tracking system.
 * Tracks consecutive hits, applies damage scaling, and manages combo display state.
 */

export interface ComboState {
  hitCount: number;
  totalDamage: number;
  timer: number;        // seconds since last hit (combo drops after timeout)
  displayTimer: number; // seconds to keep showing combo after it ends
}

/** Time window to land next hit before combo drops */
const COMBO_TIMEOUT = 1.2;
/** Time to display combo count after it ends */
const COMBO_DISPLAY_DURATION = 1.5;

/**
 * Damage scaling: each successive hit in a combo deals less damage.
 * Hit 1: 100%, Hit 2: 95%, Hit 3: 85%, Hit 4: 75%, Hit 5+: 65%
 */
const COMBO_SCALING = [1.0, 0.95, 0.85, 0.75, 0.65];

export function createComboState(): ComboState {
  return { hitCount: 0, totalDamage: 0, timer: 0, displayTimer: 0 };
}

/**
 * Get damage scaling factor for current combo hit.
 */
export function getComboScaling(hitCount: number): number {
  const idx = Math.min(hitCount, COMBO_SCALING.length - 1);
  return COMBO_SCALING[idx];
}

/**
 * Register a hit in the combo.
 * Returns the scaled damage.
 */
export function registerComboHit(combo: ComboState, rawDamage: number): number {
  const scaling = getComboScaling(combo.hitCount);
  const scaledDamage = rawDamage * scaling;
  combo.hitCount++;
  combo.totalDamage += scaledDamage;
  combo.timer = 0;
  combo.displayTimer = 0;
  return scaledDamage;
}

/**
 * Update combo state each frame. Call for each player's combo tracker.
 */
export function updateCombo(combo: ComboState, dt: number): void {
  if (combo.hitCount > 0) {
    combo.timer += dt;
    if (combo.timer >= COMBO_TIMEOUT) {
      // Combo ended — start display timer
      combo.displayTimer = COMBO_DISPLAY_DURATION;
      combo.hitCount = 0;
      combo.totalDamage = 0;
      combo.timer = 0;
    }
  }

  if (combo.displayTimer > 0) {
    combo.displayTimer -= dt;
  }
}

/**
 * Reset combo (e.g., on round start).
 */
export function resetCombo(combo: ComboState): void {
  combo.hitCount = 0;
  combo.totalDamage = 0;
  combo.timer = 0;
  combo.displayTimer = 0;
}

/**
 * Whether combo info should be displayed (active combo or recent display).
 */
export function isComboVisible(combo: ComboState): boolean {
  return combo.hitCount >= 2 || combo.displayTimer > 0;
}

/**
 * Get display hit count (show last combo count during display timer).
 */
export function getDisplayHitCount(combo: ComboState, lastCount: number): number {
  if (combo.hitCount >= 2) return combo.hitCount;
  if (combo.displayTimer > 0) return lastCount;
  return 0;
}
