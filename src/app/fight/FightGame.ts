/**
 * /fight のゲーム本体 (シーン構築・入力・ラウンド進行・カメラ・HUD通知)。
 *
 * fightingGamesystem の責務:
 *   - loadFightingCharacter: Maskman GLB + FAP アニメ GLB のロードとリバインド
 *   - CombatController: 技のフレーム進行と hitbox/hurtbox の衝突判定
 *   - PoseLayerController: キャラ個性 (CPU の前傾)
 *   - loadClipSettings: ループ可否などの再生設定
 * ゲーム層 (このファイル + Fighter/CpuBrain) の責務:
 *   - 移動・向き・ガード・被弾・KO・HP・ラウンド・カメラ・入力・HUD
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { HitEvent } from '@/fighting/fighting/types';
import { loadClipSettings, type ClipSettings } from '@/fighting/loader';
import { preloadAnimations, type PreloadedAnimations } from '@/fighting/retarget';
import { resolvePush } from '@/fighting/combat';
import type { EmotionMood } from '@/fighting/emotion';

import { Fighter, type FighterIntent } from './Fighter';
import { CpuBrain, type CpuDifficulty } from './CpuBrain';
import {
  ANIM_GLB_PATHS, FIGHT_STYLES, STYLE_LABELS, HITSTOP, GUARD_HITSTOP,
  hitStrength, type FightStyle,
} from './moves';
import type { CharacterRecord } from './characterModel';

/** P1 の選択: マイキャラ (record) か、既存スタイル (フォールバック) */
export type P1Choice =
  | { kind: 'mine'; record: CharacterRecord }
  | { kind: 'style'; style: FightStyle };

const ASSET_BASE = '/api/game-assets/fightingGamesystem/assets/';
const ROUND_DURATION = 60;
const WINS_TO_WIN = 2;
const ARENA_X = 3.6;
const ARENA_Z = 2.4;
const START_OFFSET = 1.6;
/** 押し合い判定 (pushbox) の最小間合い */
const MIN_SEPARATION = 0.72;

export type GameMode = 'pvc' | 'cvc' | 'league';

/** リーグ順位表の 1 行 */
export interface LeagueStanding {
  style: FightStyle;
  label: string;
  matchWins: number;
  matchLosses: number;
  roundWins: number;
  roundLosses: number;
}

export interface LeagueHud {
  /** 現在の試合番号 (1 始まり) */
  matchIndex: number;
  totalMatches: number;
  matchLabel: string;
  standings: LeagueStanding[];
  finished: boolean;
  championLabel: string | null;
}

/** HUD 用の感情ゲージスナップショット */
export interface EmotionHud {
  excited: number;
  calm: number;
  mood: EmotionMood;
}

export interface FightHud {
  p1Hp: number;
  cpuHp: number;
  p1MaxHp: number;
  cpuMaxHp: number;
  p1Emotion: EmotionHud;
  cpuEmotion: EmotionHud;
  p1Wins: number;
  cpuWins: number;
  round: number;
  roundTime: number;
  status: string;
  feed: string;
  matchOver: boolean;
  /** 勝者の表示名 (スタイル名/P1 など) */
  matchWinner: string | null;
  /** 勝者がどちら側か (HUD の配色用) */
  matchWinnerSide: 'p1' | 'cpu' | null;
  loading: boolean;
  loadingText: string;
  /** キャラクター選択画面を表示中か */
  selecting: boolean;
  difficulty: CpuDifficulty;
  mode: GameMode;
  p1Label: string;
  cpuLabel: string;
  league: LeagueHud | null;
}

export const INITIAL_HUD: FightHud = {
  p1Hp: 100, cpuHp: 100, p1MaxHp: 100, cpuMaxHp: 100, p1Wins: 0, cpuWins: 0,
  p1Emotion: { excited: 50, calm: 50, mood: 'neutral' },
  cpuEmotion: { excited: 50, calm: 50, mood: 'neutral' },
  round: 1, roundTime: ROUND_DURATION,
  status: 'LOADING', feed: 'アセットを読み込み中...',
  matchOver: false, matchWinner: null, matchWinnerSide: null,
  loading: true, loadingText: 'アセットを読み込み中...',
  selecting: false,
  difficulty: 'normal',
  mode: 'pvc',
  p1Label: 'P1 (YOU)', cpuLabel: 'CPU',
  league: null,
};

export class FightGame {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly onHud: (hud: FightHud) => void;

  private p1: Fighter | null = null;
  private cpu: Fighter | null = null;
  /** 再ロード用に保持 (将来 DB 化しても変わらない) */
  private preloaded: PreloadedAnimations | null = null;
  private clipSettings: Map<string, ClipSettings> = new Map();
  /** 現在 P1 に乗っているマイキャラ id (既存スタイル時は null)。再ロード要否の判定に使う */
  private p1CharId: string | null = null;
  private readonly brain = new CpuBrain();
  /** CPU vs CPU モード時に P1 側を操る思考。pvc では null */
  private p1Brain: CpuBrain | null = null;
  private mode: GameMode = 'pvc';

  private observer: Observer<Scene> | null = null;
  private disposed = false;

  // 入力
  private readonly held = new Set<string>();
  private attackBuffer: string | null = null;
  private debugVisible = false;

  // 進行
  private round = 1;
  private roundTime = ROUND_DURATION;
  private roundPause = 0;
  private roundOver = false;
  private matchOver = false;
  /** キャラクター選択画面 (試合は止まる) */
  private selecting = false;
  /** CPUvsCPU 観戦/リーグ時のマッチ終了→次へ進むまでの秒数 */
  private autoRestartTimer = 0;
  private feed = '';
  private hudTimer = 0;

  // リーグ戦 (タイプ総当たり)
  private leagueSchedule: [FightStyle, FightStyle][] = [];
  private leagueIndex = 0;
  private leagueStats = new Map<FightStyle, { mw: number; ml: number; rw: number; rl: number }>();
  private leagueFinished = false;

  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => { this.held.delete(e.code); };
  private readonly onResize = () => this.engine.resize();

  constructor(canvas: HTMLCanvasElement, onHud: (hud: FightHud) => void) {
    this.onHud = onHud;
    this.engine = new Engine(canvas, true, { antialias: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.03, 0.04, 0.07, 1);

    this.camera = new ArcRotateCamera(
      'camera', -Math.PI / 2, Math.PI / 2.6, 6.5, new Vector3(0, 1.1, 0), this.scene,
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 3.5;
    this.camera.upperRadiusLimit = 10;
    this.camera.wheelPrecision = 40;

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.65;
    const key = new DirectionalLight('key', new Vector3(-0.4, -1.2, 0.6), this.scene);
    key.intensity = 1.3;

    this.buildArena();

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private buildArena(): void {
    const ground = MeshBuilder.CreateGround('arena', { width: ARENA_X * 2 + 1.6, height: ARENA_Z * 2 + 1.6 }, this.scene);
    const mat = new StandardMaterial('arenaMat', this.scene);
    mat.diffuseColor = new Color3(0.12, 0.13, 0.15);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    ground.material = mat;

    const edge = MeshBuilder.CreateBox('edge', { width: ARENA_X * 2 + 1.6, height: 0.02, depth: 0.06 }, this.scene);
    const edgeMat = new StandardMaterial('edgeMat', this.scene);
    edgeMat.emissiveColor = new Color3(0.9, 0.75, 0.3);
    edgeMat.disableLighting = true;
    edge.material = edgeMat;
    edge.position.set(0, 0.011, -ARENA_Z - 0.4);
    const edge2 = edge.clone('edge2');
    edge2.position.z = ARENA_Z + 0.4;
  }

  /** アセットをロードして試合を開始する */
  async init(): Promise<void> {
    const hudLoading = (text: string) =>
      this.pushHud({ ...INITIAL_HUD, loadingText: text, feed: text });

    try {
      hudLoading('再生設定 (clip-settings) を読み込み中...');
      const clipSettings = await loadClipSettings(ASSET_BASE);
      if (this.disposed) return;
      this.clipSettings = clipSettings;

      // アニメ GLB は 1 回だけロードして共有バインドする (preloadAnimations)。
      // マイキャラ選択で P1 を再ロードするため、dispose せず保持する。
      const preloaded = await preloadAnimations(this.scene, [...ANIM_GLB_PATHS], {
        baseUrl: ASSET_BASE,
        onProgress: (loaded, total, path) =>
          hudLoading(`FAP モーション読み込み中 ${loaded}/${total}: ${path.split('/')[0]}`),
      });
      if (this.disposed) { preloaded.dispose(); return; }
      this.preloaded = preloaded;

      hudLoading('P1 Maskman モデルを読み込み中...');
      const p1 = await Fighter.load(this.scene, {
        name: 'P1',
        baseUrl: ASSET_BASE,
        startPosition: new Vector3(-START_OFFSET, 0, 0),
        ringColor: new Color3(0.2, 0.55, 1),
        clipSettings,
        style: 'boxer', // 1P: パンチ主体
        preloadedAnimations: preloaded,
      });
      if (this.disposed) { p1.dispose(); preloaded.dispose(); return; }
      this.p1 = p1;

      hudLoading('CPU Maskman モデルを読み込み中...');
      const cpu = await Fighter.load(this.scene, {
        name: 'CPU',
        baseUrl: ASSET_BASE,
        startPosition: new Vector3(START_OFFSET, 0, 0),
        ringColor: new Color3(1, 0.25, 0.2),
        clipSettings,
        style: 'kicker', // 2P: 蹴り・肘・膝主体
        preloadedAnimations: preloaded,
        poseLean: 0.12, // feature2: CPU は少し前傾の個性
      });
      if (this.disposed) { cpu.dispose(); return; }
      this.cpu = cpu;

      // 相互に衝突判定相手として登録し、ヒットをゲームルールへ接続
      this.wireFighters();

      if (this.mode === 'league') {
        this.startLeague();
      } else if (this.mode === 'cvc') {
        this.startRound(1); // URL ?mode=cvc は選択を飛ばして即観戦
      } else {
        // 通常はキャラクター選択画面から (両者は idle で待機)
        p1.resetForRound(new Vector3(-START_OFFSET, 0, 0));
        cpu.resetForRound(new Vector3(START_OFFSET, 0, 0));
        this.selecting = true;
        this.feed = 'キャラクターを選択してください';
        this.pushHudNow();
      }
      this.observer = this.scene.onBeforeRenderObservable.add(() => this.update());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.pushHud({ ...INITIAL_HUD, loading: false, status: 'ERROR', feed: `ロード失敗: ${msg}`, loadingText: '' });
    }
  }

  // ------------------------------------------------------------ 入力

  private handleKeyDown(e: KeyboardEvent): void {
    this.held.add(e.code);
    const attackMap: Record<string, string> = {
      KeyJ: 'jab', KeyK: 'straight', KeyL: 'hook',
      KeyU: 'uppercut', KeyI: 'midKick', KeyO: 'highKick',
      KeyQ: 'sway', KeyE: 'counter', // 防御アクション (技として実装)
    };
    const attack = attackMap[e.code];
    if (attack) this.attackBuffer = attack;
    if (e.code === 'KeyH') this.setDebugVisible(!this.debugVisible);
    if (e.code === 'KeyR' && this.matchOver) this.restart();
    if (e.code === 'Digit1') this.setDifficulty('easy');
    if (e.code === 'Digit2') this.setDifficulty('normal');
    if (e.code === 'Digit3') this.setDifficulty('hard');
    if (e.code === 'KeyC' && !this.selecting) this.setMode(this.mode === 'cvc' ? 'pvc' : 'cvc');
    if (e.code === 'KeyB') this.setMode(this.mode === 'league' ? 'pvc' : 'league');
    if (e.code === 'Escape' && !this.selecting) this.backToSelect();
    if (e.code === 'Space') e.preventDefault();
  }

  private playerIntent(): FighterIntent {
    const fwd = (this.held.has('KeyW') || this.held.has('ArrowUp') ? 1 : 0)
      - (this.held.has('KeyS') || this.held.has('ArrowDown') ? 1 : 0);
    const side = (this.held.has('KeyD') || this.held.has('ArrowRight') ? 1 : 0)
      - (this.held.has('KeyA') || this.held.has('ArrowLeft') ? 1 : 0);
    const attack = this.attackBuffer;
    this.attackBuffer = null;
    return { forward: fwd, side, guard: this.held.has('Space'), attack };
  }

  // ------------------------------------------------------------ ヒット処理

  /** CPU の難易度を変更する (1/2/3 キー or UI ボタン)。CPUvsCPU 時は両側に適用 */
  setDifficulty(d: CpuDifficulty): void {
    this.brain.setDifficulty(d);
    this.p1Brain?.setDifficulty(d);
    this.feed = `CPU 難易度: ${d.toUpperCase()}`;
    this.pushHudNow();
  }

  /**
   * モード切替 (C: pvc↔cvc, B: league)。
   * pvc↔cvc は試合続行のまま。league への出入りは試合を仕切り直す。
   */
  setMode(mode: GameMode): void {
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.attackBuffer = null;
    this.selecting = false;

    if (mode === 'league') {
      this.p1Brain = new CpuBrain();
      this.p1Brain.setDifficulty(this.brain.getDifficulty());
      this.startLeague();
      return;
    }

    // league から戻る場合は既定スタイルへ戻して仕切り直し
    if (prev === 'league') this.exitLeague();

    if (mode === 'cvc') {
      this.p1Brain = new CpuBrain();
      this.p1Brain.setDifficulty(this.brain.getDifficulty());
      this.feed = 'CPU vs CPU 観戦モード (C で操作に戻る)';
    } else {
      this.p1Brain = null;
      this.feed = 'P1 操作モード';
    }
    if (prev === 'league' && this.p1 && this.cpu) {
      this.p1.wins = 0;
      this.cpu.wins = 0;
      this.matchOver = false;
      this.startRound(1);
    }
    this.pushHudNow();
  }

  // ------------------------------------------------------------ リーグ戦

  /** タイプ総当たりのリーグ戦を最初から開始する */
  private startLeague(): void {
    this.leagueSchedule = [];
    for (let i = 0; i < FIGHT_STYLES.length; i++) {
      for (let j = i + 1; j < FIGHT_STYLES.length; j++) {
        this.leagueSchedule.push([FIGHT_STYLES[i], FIGHT_STYLES[j]]);
      }
    }
    this.leagueIndex = 0;
    this.leagueFinished = false;
    this.leagueStats = new Map(
      FIGHT_STYLES.map((s) => [s, { mw: 0, ml: 0, rw: 0, rl: 0 }]),
    );
    this.matchOver = false;
    this.applyLeagueMatch();
  }

  /** 現在の leagueIndex の対戦カードを両キャラに適用して試合開始 */
  private applyLeagueMatch(): void {
    if (!this.p1 || !this.cpu) return; // init 前 (ロード完了後に startLeague が再実行される)
    const [styleA, styleB] = this.leagueSchedule[this.leagueIndex];
    this.p1.setStyle(styleA); // displayName/体格は setStyle が適用する
    this.cpu.setStyle(styleB);
    this.p1.wins = 0;
    this.cpu.wins = 0;
    this.matchOver = false;
    this.startRound(1);
    this.feed = `第${this.leagueIndex + 1}試合: ${this.p1.displayName} vs ${this.cpu.displayName}`;
    this.pushHudNow();
  }

  /** マッチ結果をリーグ成績へ反映する */
  private recordLeagueResult(winner: Fighter): void {
    if (!this.p1 || !this.cpu) return;
    const loser = winner === this.p1 ? this.cpu : this.p1;
    const ws = this.leagueStats.get(winner.style);
    const ls = this.leagueStats.get(loser.style);
    if (!ws || !ls) return;
    ws.mw++;
    ls.ml++;
    ws.rw += winner.wins;
    ws.rl += loser.wins;
    ls.rw += loser.wins;
    ls.rl += winner.wins;
  }

  /** league 終了時にスタイルを既定へ戻す */
  private exitLeague(): void {
    this.leagueFinished = false;
    if (!this.p1 || !this.cpu) return;
    this.p1.setStyle('boxer');
    this.cpu.setStyle('kicker');
  }

  // ------------------------------------------------------- キャラクター選択

  /** 衝突判定相手 + ヒット通知を結線する (両キャラ生成/再ロード後に呼ぶ) */
  private wireFighters(): void {
    const { p1, cpu } = this;
    if (!p1 || !cpu) return;
    p1.combat.addOpponent(cpu.combat);
    cpu.combat.addOpponent(p1.combat);
    p1.combat.onHit((e) => this.handleHit(p1, cpu, e));
    cpu.combat.onHit((e) => this.handleHit(cpu, p1, e));
  }

  /**
   * 両キャラを作り直す (CombatController に removeOpponent が無いため、
   * 片方だけ差し替えると相手側に古い参照が残る。両方新規にして結線し直す)。
   */
  private async reloadFighters(p1Choice: P1Choice, cpuStyle: FightStyle): Promise<void> {
    if (!this.preloaded) return;
    const pre = this.preloaded;
    this.p1?.dispose();
    this.cpu?.dispose();
    this.p1 = null;
    this.cpu = null;

    const p1 = await Fighter.load(this.scene, {
      name: 'P1',
      baseUrl: ASSET_BASE,
      startPosition: new Vector3(-START_OFFSET, 0, 0),
      ringColor: new Color3(0.2, 0.55, 1),
      clipSettings: this.clipSettings,
      style: p1Choice.kind === 'style' ? p1Choice.style : p1Choice.record.style,
      preloadedAnimations: pre,
      character: p1Choice.kind === 'mine' ? p1Choice.record : null,
    });
    if (this.disposed) { p1.dispose(); return; }
    this.p1 = p1;
    this.p1CharId = p1Choice.kind === 'mine' ? p1Choice.record.id : null;

    const cpu = await Fighter.load(this.scene, {
      name: 'CPU',
      baseUrl: ASSET_BASE,
      startPosition: new Vector3(START_OFFSET, 0, 0),
      ringColor: new Color3(1, 0.25, 0.2),
      clipSettings: this.clipSettings,
      style: cpuStyle,
      preloadedAnimations: pre,
      poseLean: 0.12,
    });
    if (this.disposed) { cpu.dispose(); return; }
    this.cpu = cpu;

    this.wireFighters();
    if (this.debugVisible) this.setDebugVisible(true);
  }

  /**
   * 選択画面から試合を開始する。P1 はマイキャラ (record) または既存スタイル。
   * 相手 (CPU) は既存スタイル。両キャラを作り直してから開始する。
   */
  async startMatch(p1Choice: P1Choice, cpuStyle: FightStyle, mode: 'pvc' | 'cvc'): Promise<void> {
    this.selecting = false;
    this.attackBuffer = null;
    this.pushHud({ ...INITIAL_HUD, loading: true, loadingText: 'キャラクターを準備中…' });
    await this.reloadFighters(p1Choice, cpuStyle);
    if (this.disposed || !this.p1 || !this.cpu) return;

    this.mode = mode;
    if (mode === 'cvc') {
      this.p1Brain = new CpuBrain();
      this.p1Brain.setDifficulty(this.brain.getDifficulty());
    } else {
      this.p1Brain = null;
    }
    this.p1.wins = 0;
    this.cpu.wins = 0;
    this.matchOver = false;
    this.startRound(1);
  }

  /** 試合を中断してキャラクター選択画面へ戻る (Esc) */
  backToSelect(): void {
    if (!this.p1 || !this.cpu) return;
    if (this.mode === 'league') this.exitLeague();
    this.mode = 'pvc';
    this.p1Brain = null;
    this.matchOver = false;
    this.roundOver = false;
    this.roundPause = 0;
    this.selecting = true;
    this.p1.resetForRound(new Vector3(-START_OFFSET, 0, 0));
    this.cpu.resetForRound(new Vector3(START_OFFSET, 0, 0));
    this.feed = 'キャラクターを選択してください';
    this.pushHudNow();
  }

  private handleHit(attacker: Fighter, defender: Fighter, e: HitEvent): void {
    if (this.roundOver || this.matchOver) return;

    // e.move.damage は emotion 補正済み。さらにステータス補正
    // (攻撃側の与ダメ倍率 × 防御側の被ダメ倍率) を掛ける
    const rawDamage = e.move.damage ?? 5;
    const damage = Math.max(1, Math.round(rawDamage * attacker.damageMul * defender.defenseMul));
    const moveLabel = e.move.label ?? e.move.id;
    const defenderWasAttacking = defender.state === 'attack';
    // hurtboxBone + hitPosition で高さ・方向別のやられクリップを選択 (新 HitEvent)
    const outcome = defender.applyHit(damage, attacker.node.position, {
      hurtboxBone: e.hurtboxBone,
      hitPosition: e.hitPosition,
    });
    const guarded = outcome === 'guarded';

    // 感情イベント (feature5): 無敵すかし=空振り扱い、ガード=冷静↑、
    // 相手の攻撃を潰したらカウンター (cleanHit = Zone への道)
    if (outcome === 'invuln' || outcome === 'counter') {
      attacker.emotion.notify('whiff');
      attacker.noteHitLanded(); // 技終了時の whiff 二重通知を防ぐ (ここで通知済み)
    } else if (outcome === 'guarded') {
      attacker.noteHitLanded();
      defender.emotion.notify('guardSuccess');
    } else {
      attacker.noteHitLanded();
      attacker.emotion.notify(defenderWasAttacking ? 'cleanHit' : 'dealHit');
      defender.emotion.notify(damage >= 12 ? 'bigDamage' : 'takeHit');
    }

    // CPU 思考への通知 (コンボ継続判断 / 被弾適応)。無敵すかしは「当たっていない」扱い
    if (outcome !== 'invuln') {
      if (attacker === this.cpu) this.brain.onHitLanded(e.move, guarded, attacker.moves);
      if (defender === this.cpu) this.brain.onGotHit();
      if (this.p1Brain) {
        if (attacker === this.p1) this.p1Brain.onHitLanded(e.move, guarded, attacker.moves);
        if (defender === this.p1) this.p1Brain.onGotHit();
      }
    }

    // ヒットストップ (双方の現行クリップを一瞬止める)
    if (outcome === 'hit' || outcome === 'ko' || outcome === 'armor') {
      const stop = HITSTOP[hitStrength(damage)];
      attacker.applyHitstop(stop);
      defender.applyHitstop(stop);
    } else if (outcome === 'guarded') {
      attacker.applyHitstop(GUARD_HITSTOP);
      defender.applyHitstop(GUARD_HITSTOP);
    }

    switch (outcome) {
      case 'invuln':
        this.feed = `${defender.displayName} は無敵ですり抜けた!`;
        break;
      case 'counter':
        // 回避成功 → 自動反撃が始まっている。攻撃側を一瞬止めて反撃を通しやすくする
        attacker.applyHitstop(0.12);
        this.spawnSpark(defender, false, new Color3(0.4, 1, 0.6));
        this.feed = `${defender.displayName} のカウンター!`;
        break;
      case 'armor':
        this.spawnSpark(defender, false, new Color3(1, 0.85, 0.2));
        this.feed = `${defender.displayName} がアーマーで耐えた (${damage})`;
        break;
      case 'guarded':
        this.spawnSpark(defender, true);
        this.feed = `${defender.displayName} が ${attacker.displayName} の ${moveLabel} をガード`;
        break;
      case 'hit':
        this.spawnSpark(defender, false);
        this.feed = `${attacker.displayName} の ${moveLabel} がヒット! (${damage})`;
        break;
      case 'ko':
        this.spawnSpark(defender, false);
        this.feed = `${attacker.displayName} が ${moveLabel} で KO!`;
        this.finishRound(attacker);
        break;
    }
  }

  private spawnSpark(defender: Fighter, guarded: boolean, overrideColor?: Color3): void {
    const color = overrideColor ?? (guarded ? new Color3(0.5, 0.7, 1) : new Color3(1, 0.6, 0.15));
    const mat = new StandardMaterial(`spark${Math.random()}`, this.scene);
    mat.emissiveColor = color;
    mat.disableLighting = true;
    const spark = MeshBuilder.CreateSphere(`spark${Math.random()}`, { diameter: 0.22, segments: 8 }, this.scene);
    // 高さは体格 (身長スケール) に追従
    spark.position = defender.node.position.add(new Vector3(0, 1.3 * defender.verticalScale, 0));
    spark.material = mat;
    spark.isPickable = false;

    let life = 0.25;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      life -= dt;
      spark.scaling.addInPlace(new Vector3(dt * 5, dt * 5, dt * 5));
      mat.alpha = Math.max(0, life / 0.25);
      if (life <= 0) {
        this.scene.onBeforeRenderObservable.remove(obs);
        spark.dispose();
        mat.dispose();
      }
    });
  }

  // ------------------------------------------------------------ ラウンド進行

  private startRound(r: number): void {
    if (!this.p1 || !this.cpu) return;
    this.round = r;
    // リーグ戦は観戦テンポ優先で 1 ラウンドを短めにする
    this.roundTime = this.mode === 'league' ? 45 : ROUND_DURATION;
    this.roundOver = false;
    this.p1.resetForRound(new Vector3(-START_OFFSET, 0, 0));
    this.cpu.resetForRound(new Vector3(START_OFFSET, 0, 0));
    this.brain.resetForRound();
    this.p1Brain?.resetForRound();
    this.lastMoods.set(this.p1, 'neutral');
    this.lastMoods.set(this.cpu, 'neutral');
    this.feed = `Round ${r} 開始!`;
    this.pushHudNow();
  }

  private finishRound(winner: Fighter | null): void {
    if (!this.p1 || !this.cpu || this.roundOver) return;
    this.roundOver = true;
    this.roundPause = 2.8;
    if (winner) winner.wins += 1;
    if (!winner) this.feed = `Round ${this.round} は引き分け`;
    this.pushHudNow();
  }

  restart(): void {
    if (!this.p1 || !this.cpu) return;
    if (this.mode === 'league') {
      this.startLeague(); // リーグは最初からやり直し
      return;
    }
    this.p1.wins = 0;
    this.cpu.wins = 0;
    this.matchOver = false;
    this.startRound(1);
  }

  // ------------------------------------------------------------ 毎フレーム

  private update(): void {
    const p1 = this.p1;
    const cpu = this.cpu;
    if (!p1 || !cpu) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.033);

    this.followCamera(p1, cpu);

    if (this.selecting) return; // キャラクター選択中は試合進行を止める

    if (this.matchOver) {
      if (this.mode === 'league' && !this.leagueFinished) {
        // リーグ戦: 自動で次の試合へ
        this.autoRestartTimer -= dt;
        if (this.autoRestartTimer <= 0) {
          this.leagueIndex++;
          if (this.leagueIndex >= this.leagueSchedule.length) {
            this.leagueFinished = true;
            this.feed = 'リーグ戦終了! (B で操作モード / R で再リーグ)';
            this.pushHudNow();
          } else {
            this.applyLeagueMatch();
          }
        }
      } else if (this.mode === 'cvc') {
        // 観戦モードは自動で再戦する
        this.autoRestartTimer -= dt;
        if (this.autoRestartTimer <= 0) this.restart();
      }
      return;
    }

    if (this.roundPause > 0) {
      this.roundPause -= dt;
      if (this.roundPause <= 0) {
        if (p1.wins >= WINS_TO_WIN || cpu.wins >= WINS_TO_WIN) {
          this.matchOver = true;
          this.autoRestartTimer = this.mode === 'league' ? 4 : 5;
          const winner = p1.wins >= WINS_TO_WIN ? p1 : cpu;
          if (this.mode === 'league') this.recordLeagueResult(winner);
          this.feed = this.mode === 'league'
            ? `${winner.displayName} がマッチ勝利!`
            : this.mode === 'cvc'
              ? `${winner.displayName} がマッチ勝利! (5秒後に自動再戦)`
              : `${winner.displayName} がマッチ勝利! (R キーで再戦)`;
          this.pushHudNow();
        } else {
          this.startRound(this.round + 1);
        }
      }
      return;
    }
    if (this.roundOver) return;

    // タイムアップ判定
    this.roundTime = Math.max(0, this.roundTime - dt);
    if (this.roundTime <= 0) {
      const winner = p1.hp > cpu.hp ? p1 : cpu.hp > p1.hp ? cpu : null;
      this.feed = winner ? `時間切れ — ${winner.displayName} の判定勝ち` : '時間切れ — 引き分け';
      this.finishRound(winner);
      return;
    }

    // 行動更新 (P1 は操作モードなら入力、観戦モードなら CPU 思考)
    if (this.p1Brain) {
      this.attackBuffer = null; // 観戦中のキー入力は捨てる
      p1.update(dt, cpu, this.p1Brain.think(dt, p1, cpu));
    } else {
      p1.update(dt, cpu, this.playerIntent());
    }
    cpu.update(dt, p1, this.brain.think(dt, cpu, p1));

    // Zone / Fear への突入をフィードに流す
    this.checkMoodFeed(p1);
    this.checkMoodFeed(cpu);

    // 押し合い (pushbox): runtime の resolvePush (PushTarget 対応でラッパーを直接渡せる)。
    // 最小間合いは体格 (水平スケール) に追従させる
    if (p1.state !== 'ko' && cpu.state !== 'ko') {
      resolvePush(p1.node, cpu.node, MIN_SEPARATION * (p1.reachScale + cpu.reachScale) / 2);
    }

    // アリーナ内へクランプ
    for (const f of [p1, cpu]) {
      f.node.position.x = Math.max(-ARENA_X, Math.min(ARENA_X, f.node.position.x));
      f.node.position.z = Math.max(-ARENA_Z, Math.min(ARENA_Z, f.node.position.z));
    }

    // HUD (10Hz)
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.pushHudNow();
    }
  }

  /** Zone/Fear への突入・離脱をフィードへ流す */
  private readonly lastMoods = new Map<Fighter, EmotionMood>();

  private checkMoodFeed(f: Fighter): void {
    const mood = f.emotion.getMood();
    const prev = this.lastMoods.get(f) ?? 'neutral';
    if (mood === prev) return;
    this.lastMoods.set(f, mood);
    if (mood === 'zone') this.feed = `${f.displayName} がゾーンに入った!`;
    else if (mood === 'fear') this.feed = `${f.displayName} が萎縮している…`;
    else if (prev === 'zone') this.feed = `${f.displayName} のゾーンが切れた`;
    else if (prev === 'fear') this.feed = `${f.displayName} が立ち直った`;
  }

  private followCamera(p1: Fighter, cpu: Fighter): void {
    const mid = p1.node.position.add(cpu.node.position).scale(0.5);
    const dist = Vector3.Distance(p1.node.position, cpu.node.position);
    this.camera.target = Vector3.Lerp(this.camera.target, mid.add(new Vector3(0, 1.1, 0)), 0.08);
    const desired = Math.max(4.2, Math.min(8.5, 3.4 + dist * 0.85));
    this.camera.radius += (desired - this.camera.radius) * 0.04;
  }

  // ------------------------------------------------------------ HUD

  private pushHudNow(): void {
    const p1 = this.p1;
    const cpu = this.cpu;
    if (!p1 || !cpu) return;

    // キャラクター名 (スタイル名) + 操作主体を表示
    const p1Label = this.mode === 'pvc' ? `${p1.displayName} (YOU)`
      : this.mode === 'cvc' ? `${p1.displayName} (CPU)` : p1.displayName;
    const cpuLabel = this.mode === 'league' ? cpu.displayName : `${cpu.displayName} (CPU)`;

    const winnerSide = this.matchOver
      ? (p1.wins >= WINS_TO_WIN ? 'p1' as const : 'cpu' as const)
      : null;

    let league: LeagueHud | null = null;
    if (this.mode === 'league') {
      const standings: LeagueStanding[] = [...this.leagueStats.entries()]
        .map(([style, s]) => ({
          style,
          label: STYLE_LABELS[style],
          matchWins: s.mw,
          matchLosses: s.ml,
          roundWins: s.rw,
          roundLosses: s.rl,
        }))
        .sort((a, b) =>
          b.matchWins - a.matchWins
          || (b.roundWins - b.roundLosses) - (a.roundWins - a.roundLosses));
      league = {
        matchIndex: Math.min(this.leagueIndex + 1, this.leagueSchedule.length),
        totalMatches: this.leagueSchedule.length,
        matchLabel: `${p1.displayName} vs ${cpu.displayName}`,
        standings,
        finished: this.leagueFinished,
        championLabel: this.leagueFinished ? standings[0]?.label ?? null : null,
      };
    }

    const emotionHud = (f: Fighter): EmotionHud => {
      const s = f.emotion.getState();
      return { excited: s.excited, calm: s.calm, mood: f.emotion.getMood() };
    };

    this.pushHud({
      p1Hp: p1.hp,
      cpuHp: cpu.hp,
      p1MaxHp: p1.maxHp,
      cpuMaxHp: cpu.maxHp,
      p1Emotion: emotionHud(p1),
      cpuEmotion: emotionHud(cpu),
      p1Wins: p1.wins,
      cpuWins: cpu.wins,
      round: this.round,
      roundTime: this.roundTime,
      status: this.matchOver ? 'MATCH OVER' : this.roundOver ? 'ROUND OVER' : `Round ${this.round}`,
      feed: this.feed,
      matchOver: this.matchOver,
      matchWinner: winnerSide === 'p1' ? p1Label : winnerSide === 'cpu' ? cpuLabel : null,
      matchWinnerSide: winnerSide,
      loading: false,
      loadingText: '',
      selecting: this.selecting,
      difficulty: this.brain.getDifficulty(),
      mode: this.mode,
      p1Label,
      cpuLabel,
      league,
    });
  }

  private pushHud(hud: FightHud): void {
    if (!this.disposed) this.onHud(hud);
  }

  /** タブ復帰など、キャンバス表示サイズが変わったときに呼ぶ */
  resize(): void {
    this.engine.resize();
  }

  /** hitbox/hurtbox 判定球の表示を切り替える (H キー / 設定タブから) */
  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    this.p1?.setDebugVisible(visible);
    this.cpu?.setDebugVisible(visible);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer);
    this.p1?.dispose();
    this.cpu?.dispose();
    this.preloaded?.dispose();
    this.engine.dispose();
  }
}
