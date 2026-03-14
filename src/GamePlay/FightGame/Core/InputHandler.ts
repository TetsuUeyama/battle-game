/**
 * Keyboard input handler for 2-player 3D fighting game.
 *
 * P1: WASD move + Space(jump) + F(block)
 *     J = right punch, K = right kick, L = left punch, U = left kick
 *     Height modifier: W+attack = upper, S+attack = lower, neutral = mid
 *
 * P2: Arrows move + 0(jump) + 6(block)
 *     1 = right punch, 2 = right kick, 3 = left punch, 4 = left kick
 *     Height modifier: Up+attack = upper, Down+attack = lower, neutral = mid
 */

export interface FighterInput {
  forward: boolean;
  backward: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  jump: boolean;         // just pressed
  /** Attack name or null. Height derived from directional input. */
  attack: string | null; // e.g., 'r_punch_mid', 'l_kick_upper'
  block: boolean;        // held
  /** Grapple input: 'takedown' | 'hip_throw' | null */
  grapple: string | null;
  /** Any button mashed this frame (for grapple escape) */
  mash: boolean;
  /** Special attack (e.g., projectile). Key press only — engine decides what it does. */
  special: boolean;
  /** Strong special attack (e.g., thunder bolt). */
  strongSpecial: boolean;
}

const EMPTY_INPUT: FighterInput = {
  forward: false, backward: false, strafeLeft: false, strafeRight: false,
  jump: false, attack: null, block: false, grapple: null, mash: false, special: false, strongSpecial: false,
};

type Height = 'upper' | 'mid' | 'lower';

function resolveAttack(base: string, height: Height): string {
  return `${base}_${height}`;
}

export class InputHandler {
  private keysDown = new Set<string>();
  private keysJustPressed = new Set<string>();
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onKeyUp: (e: KeyboardEvent) => void;

  constructor() {
    this._onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!this.keysDown.has(key)) {
        this.keysJustPressed.add(key);
      }
      this.keysDown.add(key);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
    }
  }

  consumeFrame(): void {
    this.keysJustPressed.clear();
  }

  private getP1Height(): Height {
    if (this.keysDown.has('w')) return 'upper';
    if (this.keysDown.has('s')) return 'lower';
    return 'mid';
  }

  private getP2Height(): Height {
    if (this.keysDown.has('arrowup')) return 'upper';
    if (this.keysDown.has('arrowdown')) return 'lower';
    return 'mid';
  }

  getP1Input(): FighterInput {
    const h = this.getP1Height();
    let attack: string | null = null;

    if (this.keysJustPressed.has('j')) attack = resolveAttack('r_punch', h);
    else if (this.keysJustPressed.has('k')) attack = resolveAttack('r_kick', h);
    else if (this.keysJustPressed.has('l')) attack = resolveAttack('l_punch', h);
    else if (this.keysJustPressed.has('u')) attack = resolveAttack('l_kick', h);

    // Grapple: G = takedown, H = hip throw
    let grapple: string | null = null;
    if (this.keysJustPressed.has('g')) grapple = 'takedown';
    else if (this.keysJustPressed.has('h')) grapple = 'hip_throw';

    // Mash: any just-pressed key counts for escape
    const mash = this.keysJustPressed.size > 0;

    return {
      forward:     this.keysDown.has('w'),
      backward:    this.keysDown.has('s'),
      strafeLeft:  this.keysDown.has('a'),
      strafeRight: this.keysDown.has('d'),
      jump:        this.keysJustPressed.has(' '),
      attack,
      block:       this.keysDown.has('f'),
      grapple,
      mash,
      special:     this.keysJustPressed.has('i'),
      strongSpecial: this.keysJustPressed.has('o'),
    };
  }

  getP2Input(): FighterInput {
    const h = this.getP2Height();
    let attack: string | null = null;

    if (this.keysJustPressed.has('1')) attack = resolveAttack('r_punch', h);
    else if (this.keysJustPressed.has('2')) attack = resolveAttack('r_kick', h);
    else if (this.keysJustPressed.has('3')) attack = resolveAttack('l_punch', h);
    else if (this.keysJustPressed.has('4')) attack = resolveAttack('l_kick', h);

    // Grapple: 5 = takedown, 7 = hip throw
    let grapple: string | null = null;
    if (this.keysJustPressed.has('5')) grapple = 'takedown';
    else if (this.keysJustPressed.has('7')) grapple = 'hip_throw';

    const mash = this.keysJustPressed.size > 0;

    return {
      forward:     this.keysDown.has('arrowup'),
      backward:    this.keysDown.has('arrowdown'),
      strafeLeft:  this.keysDown.has('arrowleft'),
      strafeRight: this.keysDown.has('arrowright'),
      jump:        this.keysJustPressed.has('0'),
      attack,
      block:       this.keysDown.has('6'),
      grapple,
      mash,
      special:     this.keysJustPressed.has('8'),
      strongSpecial: this.keysJustPressed.has('9'),
    };
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
    }
  }
}

export function emptyInput(): FighterInput {
  return { ...EMPTY_INPUT };
}
