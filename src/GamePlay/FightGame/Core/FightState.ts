/**
 * Fight match state: rounds, HP, timer, win conditions.
 */

import { STAGE_CONFIG } from '@/GamePlay/FightGame/Config/FighterConfig';

export type RoundPhase = 'intro' | 'fight' | 'ko' | 'result';

export interface FightMatchState {
  phase: RoundPhase;
  roundNumber: number;
  p1Wins: number;
  p2Wins: number;
  p1Hp: number;
  p2Hp: number;
  maxHp: number;
  p1MaxHp: number;         // per-fighter max HP (may differ from maxHp)
  p2MaxHp: number;
  timer: number;           // seconds remaining
  hitstopTimer: number;    // frames remaining for hitstop (both fighters freeze)
  phaseTimer: number;      // time in current phase (for intro/ko animations)
  winner: 'p1' | 'p2' | 'draw' | null;
  matchWinner: 'p1' | 'p2' | null;
}

export function createInitialFightState(maxHp: number): FightMatchState {
  return {
    phase: 'intro',
    roundNumber: 1,
    p1Wins: 0,
    p2Wins: 0,
    p1Hp: maxHp,
    p2Hp: maxHp,
    maxHp,
    p1MaxHp: maxHp,
    p2MaxHp: maxHp,
    timer: STAGE_CONFIG.roundTime,
    hitstopTimer: 0,
    phaseTimer: 0,
    winner: null,
    matchWinner: null,
  };
}

export function startNewRound(state: FightMatchState): void {
  state.phase = 'intro';
  state.p1Hp = state.p1MaxHp;
  state.p2Hp = state.p2MaxHp;
  state.timer = STAGE_CONFIG.roundTime;
  state.hitstopTimer = 0;
  state.phaseTimer = 0;
  state.winner = null;
  state.roundNumber++;
}

export function checkRoundEnd(state: FightMatchState): void {
  if (state.phase !== 'fight') return;

  let roundWinner: 'p1' | 'p2' | 'draw' | null = null;

  if (state.p1Hp <= 0 && state.p2Hp <= 0) {
    roundWinner = 'draw';
  } else if (state.p1Hp <= 0) {
    roundWinner = 'p2';
  } else if (state.p2Hp <= 0) {
    roundWinner = 'p1';
  } else if (state.timer <= 0) {
    // Time up: higher HP wins
    if (state.p1Hp > state.p2Hp) roundWinner = 'p1';
    else if (state.p2Hp > state.p1Hp) roundWinner = 'p2';
    else roundWinner = 'draw';
  }

  if (roundWinner) {
    state.phase = 'ko';
    state.phaseTimer = 0;
    state.winner = roundWinner;
    if (roundWinner === 'p1') state.p1Wins++;
    else if (roundWinner === 'p2') state.p2Wins++;

    // Check match winner
    if (state.p1Wins >= STAGE_CONFIG.roundsToWin) {
      state.matchWinner = 'p1';
    } else if (state.p2Wins >= STAGE_CONFIG.roundsToWin) {
      state.matchWinner = 'p2';
    }
  }
}
