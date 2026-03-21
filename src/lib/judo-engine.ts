/**
 * Judo Game Engine
 * State machine, procedural characters, AI, and pose system.
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, TransformNode,
} from '@babylonjs/core';

// ─── State Machine ───────────────────────────────────────

export enum JudoState {
  KUMI_TE = 'KUMI_TE',               // standing grip fight
  THROW_ATTEMPT = 'THROW_ATTEMPT',     // attacker initiating
  THROW_SUCCESS = 'THROW_SUCCESS',     // throw lands
  THROW_DEFENSE = 'THROW_DEFENSE',     // defender blocks
  NE_WAZA = 'NE_WAZA',               // ground fighting
  PIN = 'PIN',                         // osaekomi
  CHOKE = 'CHOKE',                     // shime-waza
  MATCH_OVER = 'MATCH_OVER',
}

export type PlayerId = 'player' | 'ai';

export type PlayerAction =
  | { type: 'throw' }
  | { type: 'defend' }
  | { type: 'pin' }
  | { type: 'choke' }
  | { type: 'escape' };

export interface Fighter {
  id: PlayerId;
  stamina: number;        // 0-100
  wazari: number;
  rootPosition: Vector3;
  facing: number;         // +1 or -1
}

export interface JudoGameState {
  state: JudoState;
  stateTimer: number;
  attacker: PlayerId | null;
  pinTimer: number;
  chokeTimer: number;
  escapeProgress: number;
  fighters: Record<PlayerId, Fighter>;
  matchResult: string | null;
  events: string[];       // UI notifications for current frame
}

const THROW_DURATION = 1.0;
const THROW_RESULT_DURATION = 1.2;
const PIN_IPPON_TIME = 20;
const CHOKE_SUBMIT_TIME = 5;
const ESCAPE_THRESHOLD = 1.0;
const STAMINA_REGEN = 2;    // per second
const THROW_STAMINA_COST = 20;
const ESCAPE_CLICK_BOOST = 0.15;

export function createInitialState(): JudoGameState {
  return {
    state: JudoState.KUMI_TE,
    stateTimer: 0,
    attacker: null,
    pinTimer: 0,
    chokeTimer: 0,
    escapeProgress: 0,
    fighters: {
      player: { id: 'player', stamina: 100, wazari: 0, rootPosition: new Vector3(-0.6, 0, 0), facing: 1 },
      ai: { id: 'ai', stamina: 100, wazari: 0, rootPosition: new Vector3(0.6, 0, 0), facing: -1 },
    },
    matchResult: null,
    events: [],
  };
}

// ─── AI ──────────────────────────────────────────────────

const cpuCooldown: Record<PlayerId, number> = { player: 0, ai: 0 };

function cpuDecide(gs: JudoGameState, dt: number, id: PlayerId): PlayerAction | null {
  cpuCooldown[id] -= dt;
  if (cpuCooldown[id] > 0) return null;

  const fighter = gs.fighters[id];
  const opponent: PlayerId = id === 'player' ? 'ai' : 'player';

  switch (gs.state) {
    case JudoState.KUMI_TE:
      if (fighter.stamina > 30 && Math.random() < 0.3 * dt) {
        cpuCooldown[id] = 2 + Math.random() * 3;
        return { type: 'throw' };
      }
      break;
    case JudoState.THROW_ATTEMPT:
      if (gs.attacker === opponent && Math.random() < 0.5) {
        return { type: 'defend' };
      }
      break;
    case JudoState.NE_WAZA:
      if (gs.attacker === id) {
        cpuCooldown[id] = 0.5;
        return Math.random() < 0.6 ? { type: 'pin' } : { type: 'choke' };
      }
      break;
    case JudoState.PIN:
    case JudoState.CHOKE:
      if (gs.attacker === opponent && Math.random() < 1.5 * dt) {
        return { type: 'escape' };
      }
      break;
  }
  return null;
}

// ─── Update ──────────────────────────────────────────────

export function judoUpdate(
  gs: JudoGameState,
  dt: number,
  playerAction?: PlayerAction | null,
): void {
  gs.events = [];
  if (gs.state === JudoState.MATCH_OVER) return;

  gs.stateTimer += dt;

  // stamina regen
  for (const f of Object.values(gs.fighters)) {
    f.stamina = Math.min(100, f.stamina + STAMINA_REGEN * dt);
  }

  // both sides are CPU
  const p1Action = playerAction ?? cpuDecide(gs, dt, 'player');
  const p2Action = cpuDecide(gs, dt, 'ai');

  switch (gs.state) {
    case JudoState.KUMI_TE:
      handleKumiTe(gs, p1Action, p2Action);
      break;
    case JudoState.THROW_ATTEMPT:
      handleThrowAttempt(gs, dt, p1Action, p2Action);
      break;
    case JudoState.THROW_SUCCESS:
      handleThrowSuccess(gs, dt);
      break;
    case JudoState.THROW_DEFENSE:
      handleThrowDefense(gs, dt);
      break;
    case JudoState.NE_WAZA:
      handleNeWaza(gs, p1Action, p2Action);
      break;
    case JudoState.PIN:
      handlePin(gs, dt, p1Action, p2Action);
      break;
    case JudoState.CHOKE:
      handleChoke(gs, dt, p1Action, p2Action);
      break;
  }
}

function transition(gs: JudoGameState, state: JudoState) {
  gs.state = state;
  gs.stateTimer = 0;
}

function handleKumiTe(gs: JudoGameState, pa: PlayerAction | null, aa: PlayerAction | null) {
  if (pa?.type === 'throw' && gs.fighters.player.stamina >= THROW_STAMINA_COST) {
    gs.fighters.player.stamina -= THROW_STAMINA_COST;
    gs.attacker = 'player';
    gs.events.push('技を仕掛ける！');
    transition(gs, JudoState.THROW_ATTEMPT);
  } else if (aa?.type === 'throw' && gs.fighters.ai.stamina >= THROW_STAMINA_COST) {
    gs.fighters.ai.stamina -= THROW_STAMINA_COST;
    gs.attacker = 'ai';
    gs.events.push('相手が技を仕掛ける！');
    transition(gs, JudoState.THROW_ATTEMPT);
  }
}

function handleThrowAttempt(gs: JudoGameState, dt: number, pa: PlayerAction | null, aa: PlayerAction | null) {
  const defender = gs.attacker === 'player' ? 'ai' : 'player';
  const defAction = defender === 'player' ? pa : aa;

  if (defAction?.type === 'defend') {
    gs.events.push('防御成功！');
    transition(gs, JudoState.THROW_DEFENSE);
    return;
  }

  if (gs.stateTimer >= THROW_DURATION) {
    // throw success probability based on attacker stamina
    const attacker = gs.fighters[gs.attacker!];
    const successRate = 0.4 + attacker.stamina * 0.004; // 40-80%
    if (Math.random() < successRate) {
      // check if ippon (clean throw)
      const isIppon = Math.random() < 0.2;
      if (isIppon) {
        gs.events.push('一本！！');
        gs.matchResult = gs.attacker === 'player' ? '勝利！一本（投げ）' : '敗北…一本（投げ）';
        transition(gs, JudoState.MATCH_OVER);
      } else {
        const isWazari = Math.random() < 0.5;
        if (isWazari) {
          gs.fighters[gs.attacker!].wazari++;
          gs.events.push('技あり！');
          if (gs.fighters[gs.attacker!].wazari >= 2) {
            gs.events.push('合わせて一本！');
            gs.matchResult = gs.attacker === 'player' ? '勝利！合わせて一本' : '敗北…合わせて一本';
            transition(gs, JudoState.MATCH_OVER);
            return;
          }
        } else {
          gs.events.push('投げ成功！');
        }
        transition(gs, JudoState.THROW_SUCCESS);
      }
    } else {
      gs.events.push('防御された');
      transition(gs, JudoState.THROW_DEFENSE);
    }
  }
}

function handleThrowSuccess(gs: JudoGameState, dt: number) {
  if (gs.stateTimer >= THROW_RESULT_DURATION) {
    gs.events.push('寝技へ移行');
    transition(gs, JudoState.NE_WAZA);
  }
}

function handleThrowDefense(gs: JudoGameState, dt: number) {
  if (gs.stateTimer >= 0.8) {
    transition(gs, JudoState.KUMI_TE);
  }
}

function handleNeWaza(gs: JudoGameState, pa: PlayerAction | null, aa: PlayerAction | null) {
  const isPlayerAttacker = gs.attacker === 'player';
  const attackAction = isPlayerAttacker ? pa : aa;

  if (attackAction?.type === 'pin') {
    gs.pinTimer = 0;
    gs.escapeProgress = 0;
    gs.events.push('抑え込み！');
    transition(gs, JudoState.PIN);
  } else if (attackAction?.type === 'choke') {
    gs.chokeTimer = 0;
    gs.escapeProgress = 0;
    gs.events.push('締め技！');
    transition(gs, JudoState.CHOKE);
  }

  // auto-transition if no action for a while
  if (gs.stateTimer > 3) {
    gs.events.push('待て - 立ち技に戻る');
    gs.attacker = null;
    transition(gs, JudoState.KUMI_TE);
  }
}

function handlePin(gs: JudoGameState, dt: number, pa: PlayerAction | null, aa: PlayerAction | null) {
  gs.pinTimer += dt;

  // defender escape
  const defender = gs.attacker === 'player' ? 'ai' : 'player';
  const defAction = defender === 'player' ? pa : aa;
  if (defAction?.type === 'escape') {
    gs.escapeProgress += ESCAPE_CLICK_BOOST;
  }
  // decay escape progress
  gs.escapeProgress = Math.max(0, gs.escapeProgress - 0.3 * dt);

  if (gs.escapeProgress >= ESCAPE_THRESHOLD) {
    gs.events.push('脱出成功！');
    gs.escapeProgress = 0;
    transition(gs, JudoState.NE_WAZA);
    return;
  }

  if (gs.pinTimer >= PIN_IPPON_TIME) {
    gs.events.push('一本！（抑え込み20秒）');
    gs.matchResult = gs.attacker === 'player' ? '勝利！一本（抑え込み）' : '敗北…一本（抑え込み）';
    transition(gs, JudoState.MATCH_OVER);
  } else if (gs.pinTimer >= 10 && gs.pinTimer - dt < 10) {
    gs.fighters[gs.attacker!].wazari++;
    gs.events.push('技あり！（抑え込み10秒）');
    if (gs.fighters[gs.attacker!].wazari >= 2) {
      gs.events.push('合わせて一本！');
      gs.matchResult = gs.attacker === 'player' ? '勝利！合わせて一本' : '敗北…合わせて一本';
      transition(gs, JudoState.MATCH_OVER);
    }
  }
}

function handleChoke(gs: JudoGameState, dt: number, pa: PlayerAction | null, aa: PlayerAction | null) {
  gs.chokeTimer += dt;

  const defender = gs.attacker === 'player' ? 'ai' : 'player';
  const defAction = defender === 'player' ? pa : aa;
  if (defAction?.type === 'escape') {
    gs.escapeProgress += ESCAPE_CLICK_BOOST;
  }
  gs.escapeProgress = Math.max(0, gs.escapeProgress - 0.25 * dt);

  if (gs.escapeProgress >= ESCAPE_THRESHOLD) {
    gs.events.push('脱出成功！');
    gs.escapeProgress = 0;
    transition(gs, JudoState.NE_WAZA);
    return;
  }

  // defender stamina drain
  gs.fighters[defender].stamina -= 8 * dt;

  if (gs.chokeTimer >= CHOKE_SUBMIT_TIME || gs.fighters[defender].stamina <= 0) {
    gs.events.push('一本！（締め落とし）');
    gs.matchResult = gs.attacker === 'player' ? '勝利！一本（締め技）' : '敗北…一本（締め技）';
    transition(gs, JudoState.MATCH_OVER);
  }
}

// ─── Pose System ─────────────────────────────────────────

export interface BonePose {
  pos: [number, number, number];
  rot: [number, number, number];
}
export type PoseData = Record<string, BonePose>;

const BONES = ['hips','torso','head','leftArm','rightArm','leftHand','rightHand','leftLeg','rightLeg','leftFoot','rightFoot'] as const;
export type BoneName = typeof BONES[number];

// === STANDING POSES ===

export const POSE_IDLE: PoseData = {
  hips:      { pos: [0, 0.9, 0], rot: [0, 0, 0] },
  torso:     { pos: [0, 0.35, 0], rot: [0, 0, 0] },
  head:      { pos: [0, 0.3, 0], rot: [0, 0, 0] },
  leftArm:   { pos: [-0.22, 0.15, 0], rot: [0, 0, 0.3] },
  rightArm:  { pos: [0.22, 0.15, 0], rot: [0, 0, -0.3] },
  leftHand:  { pos: [0, -0.25, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.25, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0], rot: [0, 0, 0] },
  rightLeg:  { pos: [0.1, -0.05, 0], rot: [0, 0, 0] },
  leftFoot:  { pos: [0, -0.4, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.4, 0], rot: [0, 0, 0] },
};

// 組み手: arms reaching forward toward opponent
const POSE_KUMI_TE: PoseData = {
  hips:      { pos: [0, 0.82, 0], rot: [0.12, 0, 0] },
  torso:     { pos: [0, 0.34, 0], rot: [-0.15, 0, 0] },
  head:      { pos: [0, 0.28, 0], rot: [0.1, 0, 0] },
  leftArm:   { pos: [-0.15, 0.18, 0.08], rot: [-1.1, 0, 0.3] },   // reaching forward
  rightArm:  { pos: [0.1, 0.2, 0.12], rot: [-1.3, 0, -0.2] },     // gripping lapel
  leftHand:  { pos: [0, -0.18, 0.15], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.15, 0.18], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.12, -0.05, 0.02], rot: [0.1, 0, 0] },
  rightLeg:  { pos: [0.12, -0.05, -0.04], rot: [-0.1, 0, 0] },
  leftFoot:  { pos: [0, -0.38, 0.04], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.38, -0.04], rot: [0, 0, 0] },
};

// 投げ(攻め): hips turned, pulling opponent over hip (背負い投げ風)
const POSE_THROW_ATTACK: PoseData = {
  hips:      { pos: [0, 0.7, 0.1], rot: [0.4, -0.8, 0] },        // deep hip turn
  torso:     { pos: [0, 0.34, 0], rot: [-0.5, -0.4, -0.15] },     // bent forward + rotated
  head:      { pos: [0, 0.26, 0], rot: [0.3, -0.2, 0] },
  leftArm:   { pos: [-0.12, 0.22, 0.15], rot: [-1.5, 0.3, 0.2] }, // pulling sleeve high
  rightArm:  { pos: [0.08, 0.24, 0.2], rot: [-1.6, -0.2, -0.3] }, // pulling lapel over
  leftHand:  { pos: [0, -0.12, 0.2], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.1, 0.22], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.1, -0.05, 0.08], rot: [0.4, 0, 0] },      // stepping in
  rightLeg:  { pos: [0.1, -0.08, -0.06], rot: [-0.3, 0, 0] },
  leftFoot:  { pos: [0, -0.36, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.34, 0], rot: [0, 0, 0] },
};

// 投げられ: airborne, body arcing over
const POSE_THROWN: PoseData = {
  hips:      { pos: [0, 0.8, -0.2], rot: [-1.8, 0, 0.2] },        // flipping over
  torso:     { pos: [0, 0.2, 0], rot: [-0.2, 0, 0] },
  head:      { pos: [0, 0.22, 0], rot: [0.6, 0, 0] },
  leftArm:   { pos: [-0.28, 0.08, -0.05], rot: [0.8, 0, 1.2] },   // arms flailing
  rightArm:  { pos: [0.28, 0.08, -0.05], rot: [0.8, 0, -1.2] },
  leftHand:  { pos: [0, -0.18, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.18, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.12, 0.05, 0.15], rot: [-1.0, 0, 0] },     // legs up in the air
  rightLeg:  { pos: [0.12, 0.05, 0.1], rot: [-0.8, 0, 0] },
  leftFoot:  { pos: [0, -0.32, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.32, 0], rot: [0, 0, 0] },
};

// 投げられ着地: flat on back
const POSE_THROWN_LANDED: PoseData = {
  hips:      { pos: [0, 0.15, 0], rot: [-1.57, 0, 0] },            // lying flat
  torso:     { pos: [0, 0.22, 0], rot: [0, 0, 0] },
  head:      { pos: [0, 0.2, 0], rot: [0.3, 0, 0] },
  leftArm:   { pos: [-0.28, 0.05, 0], rot: [0, 0, 1.4] },         // arms spread on mat
  rightArm:  { pos: [0.28, 0.05, 0], rot: [0, 0, -1.4] },
  leftHand:  { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.14, 0, 0], rot: [-0.1, 0, 0.15] },
  rightLeg:  { pos: [0.14, 0, 0], rot: [-0.1, 0, -0.15] },
  leftFoot:  { pos: [0, -0.36, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.36, 0], rot: [0, 0, 0] },
};

// 防御: low stance bracing
const POSE_DEFEND: PoseData = {
  hips:      { pos: [0, 0.72, 0], rot: [0.2, 0, 0] },
  torso:     { pos: [0, 0.33, 0], rot: [-0.1, 0, 0] },
  head:      { pos: [0, 0.28, 0], rot: [0.2, 0, 0] },
  leftArm:   { pos: [-0.2, 0.12, 0.05], rot: [-0.5, 0, 0.5] },
  rightArm:  { pos: [0.2, 0.12, 0.05], rot: [-0.5, 0, -0.5] },
  leftHand:  { pos: [0, -0.2, 0.05], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.2, 0.05], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.16, -0.05, 0], rot: [0.25, 0, 0] },       // wide stance
  rightLeg:  { pos: [0.16, -0.05, 0], rot: [0.15, 0, 0] },
  leftFoot:  { pos: [0, -0.35, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.35, 0], rot: [0, 0, 0] },
};

// === GROUND POSES ===

// 抑え込み(上): kneeling on opponent, pressing down
const POSE_PIN_TOP: PoseData = {
  hips:      { pos: [0, 0.4, 0], rot: [0.8, 0, 0] },              // leaning forward over opponent
  torso:     { pos: [0, 0.25, 0.08], rot: [-0.3, 0, 0] },
  head:      { pos: [0, 0.22, 0.05], rot: [0.4, 0, 0] },
  leftArm:   { pos: [-0.18, 0.08, 0.18], rot: [-0.8, 0, 0.3] },  // pressing down
  rightArm:  { pos: [0.18, 0.08, 0.18], rot: [-0.8, 0, -0.3] },
  leftHand:  { pos: [0, -0.12, 0.12], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.12, 0.12], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.18, -0.1, -0.08], rot: [0.6, 0, 0.4] },  // knees wide for base
  rightLeg:  { pos: [0.18, -0.1, -0.08], rot: [0.6, 0, -0.4] },
  leftFoot:  { pos: [0, -0.25, -0.05], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.25, -0.05], rot: [0, 0, 0] },
};

// 抑え込まれ(下): pinned on back
const POSE_PIN_BOTTOM: PoseData = {
  hips:      { pos: [0, 0.12, 0], rot: [-1.57, 0, 0] },
  torso:     { pos: [0, 0.22, 0], rot: [0.05, 0, 0] },
  head:      { pos: [0, 0.2, 0], rot: [0.3, 0, 0.1] },
  leftArm:   { pos: [-0.2, 0.08, 0.05], rot: [0.2, 0, 0.8] },    // trying to push off
  rightArm:  { pos: [0.2, 0.08, 0.05], rot: [0.2, 0, -0.8] },
  leftHand:  { pos: [0, -0.18, 0.05], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.18, 0.05], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.13, 0, 0], rot: [-0.2, 0, 0.1] },
  rightLeg:  { pos: [0.13, 0, 0], rot: [-0.2, 0, -0.1] },
  leftFoot:  { pos: [0, -0.35, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.35, 0], rot: [0, 0, 0] },
};

// 締め(攻め): behind opponent, arms around neck
const POSE_CHOKE_TOP: PoseData = {
  hips:      { pos: [0, 0.35, -0.1], rot: [0.6, 0, 0] },
  torso:     { pos: [0, 0.26, 0.12], rot: [-0.4, 0, 0] },
  head:      { pos: [0, 0.22, 0.06], rot: [0.3, 0, 0] },
  leftArm:   { pos: [-0.05, 0.16, 0.22], rot: [-1.4, 0.4, 0.15] }, // wrapping around neck
  rightArm:  { pos: [0.05, 0.16, 0.22], rot: [-1.4, -0.4, -0.15] },
  leftHand:  { pos: [0.06, -0.08, 0.1], rot: [0, 0, 0] },         // hands meet at throat
  rightHand: { pos: [-0.06, -0.08, 0.1], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.18, -0.08, 0.05], rot: [0.4, 0, 0.35] },
  rightLeg:  { pos: [0.18, -0.08, 0.05], rot: [0.4, 0, -0.35] },
  leftFoot:  { pos: [0, -0.28, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.28, 0], rot: [0, 0, 0] },
};

// 締められ(下): being choked, struggling
const POSE_CHOKE_BOTTOM: PoseData = {
  hips:      { pos: [0, 0.15, 0], rot: [-1.4, 0, 0] },
  torso:     { pos: [0, 0.22, 0], rot: [0.1, 0, 0] },
  head:      { pos: [0, 0.18, 0.02], rot: [0.5, 0, 0.15] },       // head tilted from choke
  leftArm:   { pos: [-0.15, 0.1, 0.08], rot: [-0.6, 0, 0.4] },    // pulling at attacker's arms
  rightArm:  { pos: [0.15, 0.1, 0.08], rot: [-0.6, 0, -0.4] },
  leftHand:  { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
  rightHand: { pos: [0, -0.12, 0.1], rot: [0, 0, 0] },
  leftLeg:   { pos: [-0.13, 0, 0], rot: [-0.15, 0, 0.1] },
  rightLeg:  { pos: [0.13, 0, 0], rot: [-0.15, 0, -0.1] },
  leftFoot:  { pos: [0, -0.35, 0], rot: [0, 0, 0] },
  rightFoot: { pos: [0, -0.35, 0], rot: [0, 0, 0] },
};

// ─── Pose helpers ────────────────────────────────────────

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

/** Position and pose data for a state. Returns [attackerPose, defenderPose, attackerPos, defenderPos] */
export function getSceneLayout(gs: JudoGameState): {
  attackerPose: PoseData; defenderPose: PoseData;
  attackerPos: [number, number, number]; defenderPos: [number, number, number];
} {
  const t = gs.stateTimer;
  // positions are in world space. Characters face each other via root Y rotation.
  // attacker is at -Z side (facing +Z), defender at +Z side (facing -Z)
  // X=lateral, Y=up, Z=forward/back (approach axis)
  switch (gs.state) {
    case JudoState.KUMI_TE:
      return {
        attackerPose: POSE_KUMI_TE, defenderPose: POSE_KUMI_TE,
        attackerPos: [0, 0, -0.3], defenderPos: [0, 0, 0.3],
      };
    case JudoState.THROW_ATTEMPT:
      return {
        attackerPose: POSE_THROW_ATTACK, defenderPose: POSE_DEFEND,
        attackerPos: [0, 0, -0.15], defenderPos: [0, 0, 0.15],
      };
    case JudoState.THROW_SUCCESS: {
      const throwT = Math.min(t / THROW_RESULT_DURATION, 1);
      const arcY = Math.sin(throwT * Math.PI) * 0.8;
      const arcZ = 0.1 + throwT * 0.6; // defender flies over
      const defPose = throwT < 0.6 ? POSE_THROWN : lerpPose(POSE_THROWN, POSE_THROWN_LANDED, (throwT - 0.6) / 0.4);
      return {
        attackerPose: POSE_THROW_ATTACK, defenderPose: defPose,
        attackerPos: [0, 0, -0.1], defenderPos: [0, arcY, arcZ],
      };
    }
    case JudoState.THROW_DEFENSE:
      return {
        attackerPose: POSE_KUMI_TE, defenderPose: POSE_DEFEND,
        attackerPos: [0, 0, -0.3], defenderPos: [0, 0, 0.3],
      };
    case JudoState.NE_WAZA:
      return {
        attackerPose: POSE_PIN_TOP, defenderPose: POSE_PIN_BOTTOM,
        attackerPos: [0, 0, -0.1], defenderPos: [0, 0, 0.1],
      };
    case JudoState.PIN:
      return {
        attackerPose: POSE_PIN_TOP, defenderPose: POSE_PIN_BOTTOM,
        attackerPos: [0, 0.08, 0], defenderPos: [0, 0, 0],
      };
    case JudoState.CHOKE:
      return {
        attackerPose: POSE_CHOKE_TOP, defenderPose: POSE_CHOKE_BOTTOM,
        attackerPos: [0, 0.08, -0.12], defenderPos: [0, 0, 0],
      };
    case JudoState.MATCH_OVER:
      return {
        attackerPose: POSE_IDLE, defenderPose: POSE_THROWN_LANDED,
        attackerPos: [0, 0, -0.5], defenderPos: [0, 0, 0.3],
      };
    default:
      return {
        attackerPose: POSE_IDLE, defenderPose: POSE_IDLE,
        attackerPos: [0, 0, -0.6], defenderPos: [0, 0, 0.6],
      };
  }
}

// ─── Procedural Character ────────────────────────────────

export interface ProceduralFighter {
  root: TransformNode;
  bones: Map<string, TransformNode>;
}

export function buildProceduralFighter(
  scene: Scene, color: Color3, prefix: string,
): ProceduralFighter {
  const root = new TransformNode(`${prefix}_root`, scene);
  const bones = new Map<string, TransformNode>();

  const mat = new StandardMaterial(`${prefix}_mat`, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.2, 0.2, 0.2);

  const skinMat = new StandardMaterial(`${prefix}_skin`, scene);
  skinMat.diffuseColor = new Color3(0.9, 0.75, 0.6);

  function makeBone(name: string, w: number, h: number, d: number, material: StandardMaterial, parent: TransformNode) {
    const node = new TransformNode(`${prefix}_${name}`, scene);
    node.parent = parent;
    const mesh = MeshBuilder.CreateBox(`${prefix}_${name}_mesh`, { width: w, height: h, depth: d }, scene);
    mesh.material = material;
    mesh.parent = node;
    bones.set(name, node);
    return node;
  }

  const hips = makeBone('hips', 0.28, 0.15, 0.16, mat, root);
  const torso = makeBone('torso', 0.3, 0.32, 0.18, mat, hips);
  makeBone('head', 0.16, 0.18, 0.16, skinMat, torso);
  const lArm = makeBone('leftArm', 0.08, 0.25, 0.08, mat, torso);
  const rArm = makeBone('rightArm', 0.08, 0.25, 0.08, mat, torso);
  makeBone('leftHand', 0.07, 0.1, 0.05, skinMat, lArm);
  makeBone('rightHand', 0.07, 0.1, 0.05, skinMat, rArm);
  const lLeg = makeBone('leftLeg', 0.1, 0.35, 0.1, mat, hips);
  const rLeg = makeBone('rightLeg', 0.1, 0.35, 0.1, mat, hips);
  makeBone('leftFoot', 0.1, 0.06, 0.14, skinMat, lLeg);
  makeBone('rightFoot', 0.1, 0.06, 0.14, skinMat, rLeg);

  return { root, bones };
}

export function applyPose(fighter: ProceduralFighter, pose: PoseData, facing: number) {
  for (const [name, bp] of Object.entries(pose)) {
    const bone = fighter.bones.get(name);
    if (!bone) continue;
    bone.position.set(bp.pos[0] * facing, bp.pos[1], bp.pos[2] * facing);
    bone.rotation.set(bp.rot[0], bp.rot[1] * facing, bp.rot[2] * facing);
  }
}

// ─── State label ─────────────────────────────────────────

export function getStateLabel(state: JudoState): string {
  switch (state) {
    case JudoState.KUMI_TE: return '組み手';
    case JudoState.THROW_ATTEMPT: return '技の仕掛け';
    case JudoState.THROW_SUCCESS: return '投げ成功';
    case JudoState.THROW_DEFENSE: return '防御';
    case JudoState.NE_WAZA: return '寝技';
    case JudoState.PIN: return '抑え込み';
    case JudoState.CHOKE: return '締め技';
    case JudoState.MATCH_OVER: return '試合終了';
  }
}
