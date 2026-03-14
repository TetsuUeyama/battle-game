/**
 * FightGameEngine: 3v3 team battle — Babylon.js scene, character loading, game loop.
 * Team 1 (3 male Tanks) vs Team 2 (3 female: Ranged, Speed, Assassin).
 * All fighters are AI-controlled.
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color4, Color3, Quaternion,
  TransformNode, MeshBuilder, StandardMaterial,
  ParticleSystem, Mesh,
} from '@babylonjs/core';
import { loadVoxFile, SCALE } from '@/lib/vox-parser';
import type { ModelEntry, CharacterGender } from '@/lib/model-registry';
import {
  BONE_DEFS, calculateAllBones, getDefaultMarkers, voxelToViewer,
  buildSkeletalCharacter,
} from '@/lib/voxel-skeleton';
import { InputHandler } from '@/GamePlay/FightGame/Core/InputHandler';
import {
  createFighter, updateFighter, applyHit,
  canAct, isOpponentInFront,
} from '@/GamePlay/FightGame/Fighter/Fighter';
import type { FighterState } from '@/GamePlay/FightGame/Fighter/Fighter';
import { ATTACKS } from '@/GamePlay/FightGame/Config/AttackConfig';
import {
  STAGE_CONFIG, DEFAULT_FIGHTER_STATS, TEAM1_SPAWNS, TEAM2_SPAWNS,
} from '@/GamePlay/FightGame/Config/FighterConfig';
import { checkHit } from '@/GamePlay/FightGame/Combat/HitboxSystem';
import {
  triggerScreenShake, updateScreenShake,
  createHitParticles, spawnDamageNumber,
  updateDamageNumbers, disposeAllEffects,
} from '@/GamePlay/FightGame/Combat/HitEffects';
import { FighterMotionPlayer } from '@/GamePlay/FightGame/Fighter/FighterMotion';
import {
  createComboState, registerComboHit, updateCombo, resetCombo,
} from '@/GamePlay/FightGame/Combat/ComboSystem';
import type { ComboState } from '@/GamePlay/FightGame/Combat/ComboSystem';
import { FighterAI } from '@/GamePlay/FightGame/Core/FighterAI';
import type { AIDifficulty } from '@/GamePlay/FightGame/Core/FighterAI';
import { buildStage } from '@/GamePlay/FightGame/Stage/StageBuilder';
import { SoundManager } from '@/GamePlay/FightGame/Audio/SoundManager';
import { ProjectileSystem } from '@/GamePlay/FightGame/Combat/ProjectileSystem';
import { ARCHETYPES, TEAM1_ARCHETYPES, TEAM2_ARCHETYPES } from '@/GamePlay/FightGame/Config/ArchetypeConfig';
import type { FighterArchetype } from '@/GamePlay/FightGame/Config/ArchetypeConfig';

export type GameMode = 'menu' | 'battle' | 'training';

// ====================================================================
// Types
// ====================================================================

interface TeamFighter {
  state: FighterState;
  root: TransformNode;
  nodes: Map<string, TransformNode>;
  motion: FighterMotionPlayer | null;
  combo: ComboState;
  ai: FighterAI;
  gender: CharacterGender;
  archetype: FighterArchetype;
  projectileSpawned: boolean;
  hp: number;
  maxHp: number;
  delayHp: number;
  alive: boolean;
  healAura: Mesh | null;
  healParticles: ParticleSystem | null;
  bindVfx: ParticleSystem | null;
  /** Voxel snake meshes that coil around the bound fighter */
  bindSnake: { segments: Mesh[]; elapsed: number } | null;
}

interface SharedModelData {
  mergedVoxels: { x: number; y: number; z: number; r: number; g: number; b: number }[];
  bones: ReturnType<typeof calculateAllBones>;
  cx: number;
  cy: number;
  restPos: Map<string, Vector3>;
  bodyHeight: number;
  gender: CharacterGender;
}

export interface FighterUIInfo {
  hp: number;
  maxHp: number;
  delayHp: number;
  guard: number;
  guardBroken: boolean;
  action: string;
  label: string;
  alive: boolean;
  // Debug info
  bindTimer: number;
  bindDotPerSec: number;
  x: number;
  z: number;
}

export interface FightUIState {
  team1: FighterUIInfo[];
  team2: FighterUIInfo[];
  timer: number;
  phase: string;
  winner: string | null;
  /** 0-1: red damage flash intensity for POV character */
  povDamageFlash: number;
}

// ====================================================================
// Engine
// ====================================================================

export class FightGameEngine {
  private disposed = false;
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private inputHandler: InputHandler;
  private sound: SoundManager;

  private team1: TeamFighter[] = [];
  private team2: TeamFighter[] = [];
  private projectiles: ProjectileSystem | null = null;

  private phase: 'menu' | 'intro' | 'fight' | 'ko' | 'result' = 'menu';
  private phaseTimer = 0;
  private timer = STAGE_CONFIG.roundTime;
  private hitstopTimer = 0;
  private winner: 'team1' | 'team2' | null = null;

  private gameMode: GameMode = 'menu';
  private resetMatchSignal = false;
  private lastTime = 0;
  /** null = free camera, 0-5 = first-person from that fighter's head */
  private followIndex: number | null = null;
  /** POV damage flash intensity (0-1, decays over time) */
  private povDamageFlash = 0;
  /** POV hit shake offset */
  private povShakeTimer = 0;
  private povShakeIntensity = 0;
  private uiUpdateCounter = 0;
  private onUIUpdate: ((state: FightUIState) => void) | null = null;
  private onResize: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.45, 0.65, 0.90, 1);

    this.camera = new ArcRotateCamera('cam',
      Math.PI / 2, Math.PI / 3.5,
      STAGE_CONFIG.cameraDistance,
      new Vector3(0, STAGE_CONFIG.cameraHeight, 0),
      this.scene,
    );
    this.camera.lowerRadiusLimit = 1;
    this.camera.upperRadiusLimit = 60;
    this.camera.lowerBetaLimit = 0.2;
    this.camera.upperBetaLimit = Math.PI / 1.1;
    this.camera.attachControl(canvas, true);

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.5;
    hemi.groundColor = new Color3(0.05, 0.05, 0.12);
    const dir = new DirectionalLight('dir', new Vector3(-1, -2, 1), this.scene);
    dir.intensity = 0.4;

    this.sound = new SoundManager();
    this.inputHandler = new InputHandler();

    this.onResize = () => this.engine.resize();
    window.addEventListener('resize', this.onResize);
  }

  // ====================================================================
  // Public API
  // ====================================================================

  /**
   * @param partsConfig  modelId → enabled part keys (if omitted, uses default_on)
   */
  async init(
    team1Models: ModelEntry[],
    team2Models: ModelEntry[],
    partsConfig?: Record<string, string[]>,
  ): Promise<void> {
    await buildStage(this.scene);

    // Load shared model data — deduplicate by id
    const uniqueModels = new Map<string, ModelEntry>();
    for (const m of [...team1Models, ...team2Models]) uniqueModels.set(m.id, m);
    const dataMap = new Map<string, SharedModelData>();
    await Promise.all(
      [...uniqueModels.entries()].map(async ([id, model]) => {
        dataMap.set(id, await this.loadSharedModelData(model, partsConfig?.[id]));
      }),
    );
    if (this.disposed) return;

    for (let i = 0; i < team1Models.length; i++) {
      const arch = ARCHETYPES[TEAM1_ARCHETYPES[i]];
      const data = dataMap.get(team1Models[i].id)!;
      this.team1.push(this.buildTeamFighter(data, `t1f${i}`, TEAM1_SPAWNS[i], arch, Math.PI));
    }
    for (let i = 0; i < team2Models.length; i++) {
      const arch = ARCHETYPES[TEAM2_ARCHETYPES[i]];
      const data = dataMap.get(team2Models[i].id)!;
      this.team2.push(this.buildTeamFighter(data, `t2f${i}`, TEAM2_SPAWNS[i], arch, 0));
    }

    this.projectiles = new ProjectileSystem(this.scene);
    this.phase = 'intro';
    this.phaseTimer = 0;

    this.lastTime = performance.now();
    this.scene.registerBeforeRender(() => this.gameLoop());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  setUICallback(cb: (state: FightUIState) => void): void {
    this.onUIUpdate = cb;
  }

  startGame(difficulty: AIDifficulty = 'normal'): void {
    this.gameMode = 'battle';
    for (const tf of [...this.team1, ...this.team2]) {
      tf.ai.setDifficulty(difficulty);
    }
  }

  private trainingMode = false;

  /** Training mode: 1v1 with a dummy defender */
  async initTraining(
    attackerModel: ModelEntry,
    defenderModel: ModelEntry,
    attackerArchetypeId: string,
    partsConfig?: Record<string, string[]>,
  ): Promise<void> {
    await buildStage(this.scene);

    const uniqueModels = new Map<string, ModelEntry>();
    uniqueModels.set(attackerModel.id, attackerModel);
    uniqueModels.set(defenderModel.id, defenderModel);
    const dataMap = new Map<string, SharedModelData>();
    await Promise.all(
      [...uniqueModels.entries()].map(async ([id, model]) => {
        dataMap.set(id, await this.loadSharedModelData(model, partsConfig?.[id]));
      }),
    );
    if (this.disposed) return;

    const atkArch = ARCHETYPES[attackerArchetypeId] ?? ARCHETYPES['tank'];
    const defArch = { ...ARCHETYPES['tank'], id: 'dummy', label: 'Dummy', maxHp: 9999 };
    const atkData = dataMap.get(attackerModel.id)!;
    const defData = dataMap.get(defenderModel.id)!;

    this.team1.push(this.buildTeamFighter(atkData, 'atk', { x: 1.5, z: 0 }, atkArch, Math.PI));
    this.team2.push(this.buildTeamFighter(defData, 'def', { x: -1.5, z: 0 }, defArch, 0));

    this.projectiles = new ProjectileSystem(this.scene);
    this.trainingMode = true;
    this.phase = 'fight';
    this.phaseTimer = 0;
    this.gameMode = 'training';
    this.timer = 9999;

    // Camera closer for training
    this.camera.radius = 5;
    this.camera.target.set(0, 1, 0);

    this.lastTime = performance.now();
    this.scene.registerBeforeRender(() => this.gameLoop());
    this.engine.runRenderLoop(() => this.scene.render());
  }

  /** Training: execute attack from attacker on dummy */
  trainingAttack(attackName: string): void {
    if (!this.trainingMode || this.team1.length === 0) return;
    this.forceAttack(1, 0, attackName);
  }

  /** Training: reset dummy to full HP and idle */
  trainingResetDummy(): void {
    if (!this.trainingMode || this.team2.length === 0) return;
    const tf = this.team2[0];
    tf.hp = tf.maxHp;
    tf.delayHp = tf.maxHp;
    tf.alive = true;
    tf.state.action = 'idle';
    tf.state.stunTimer = 0;
    tf.state.bindTimer = 0;
    tf.state.bindDotPerSec = 0;
    tf.state.bindMashCount = 0;
    tf.state.knockdownTimer = 0;
    tf.state.knockdownVariant = 'knockdown';
    tf.state.currentAttack = null;
    tf.state.currentMotion = null;
    tf.state.guard = tf.state.stats.maxGuard;
    tf.state.guardBroken = false;
    tf.state.x = -1.5;
    tf.state.z = 0;
    tf.state.facingAngle = 0;
    this.removeBindVfx(tf);
  }

  requestReset(): void { this.resetMatchSignal = true; }
  returnToMenu(): void { this.gameMode = 'menu'; }
  getGameMode(): GameMode { return this.gameMode; }
  setMuted(muted: boolean): void { this.sound.setMuted(muted); }

  /** Cycle through fighter POV cameras. null → T1-0 → T1-1 → T1-2 → T2-0 → T2-1 → T2-2 → null */
  cycleFollowCamera(): string | null {
    const total = this.team1.length + this.team2.length;
    if (this.followIndex === null) {
      this.followIndex = 0;
    } else {
      this.followIndex++;
      if (this.followIndex >= total) this.followIndex = null;
    }
    if (this.followIndex !== null) {
      // Disable user camera control in POV mode
      this.camera.detachControl();
      const tf = this.getFighterByIndex(this.followIndex);
      const teamNum = this.followIndex < this.team1.length ? 1 : 2;
      const memberNum = this.followIndex < this.team1.length
        ? this.followIndex + 1
        : this.followIndex - this.team1.length + 1;
      return `Team${teamNum} #${memberNum} (${tf?.archetype.label ?? '?'})`;
    } else {
      // Restore free camera
      this.camera.attachControl(this.engine.getRenderingCanvas()!, true);
      return null;
    }
  }

  /** Get current follow label (for UI) */
  getFollowLabel(): string | null {
    if (this.followIndex === null) return null;
    const tf = this.getFighterByIndex(this.followIndex);
    if (!tf) return null;
    const teamNum = this.followIndex < this.team1.length ? 1 : 2;
    const memberNum = this.followIndex < this.team1.length
      ? this.followIndex + 1
      : this.followIndex - this.team1.length + 1;
    return `Team${teamNum} #${memberNum} (${tf.archetype.label})`;
  }

  // ====================================================================
  // Debug / confirmation mode
  // ====================================================================

  private paused = false;
  private timeScale = 1.0;

  setPaused(paused: boolean): void { this.paused = paused; }
  getPaused(): boolean { return this.paused; }

  setTimeScale(scale: number): void { this.timeScale = Math.max(0.05, Math.min(3.0, scale)); }
  getTimeScale(): number { return this.timeScale; }

  /** Force a specific fighter to use an attack */
  forceAttack(teamIndex: number, fighterIndex: number, attackName: string): void {
    const team = teamIndex === 1 ? this.team1 : this.team2;
    const tf = team[fighterIndex];
    if (!tf || !tf.alive) return;
    // Reset to idle so attack can start
    tf.state.action = 'idle';
    tf.state.stunTimer = 0;
    tf.state.currentAttack = null;
    // Find nearest enemy for facing
    const enemies = teamIndex === 1 ? this.team2 : this.team1;
    const target = this.findNearestAliveEnemy(tf, enemies);
    if (target) {
      tf.state.facingAngle = Math.atan2(target.state.z - tf.state.z, target.state.x - tf.state.x);
    }
    // Create fake input with the attack
    const input = { forward: false, backward: false, strafeLeft: false, strafeRight: false,
      jump: false, attack: attackName, block: false, grapple: null, mash: false,
      special: false, strongSpecial: false };
    updateFighter(tf.state, input, target?.state.x ?? 0, target?.state.z ?? 0, 0.016);
  }

  private getFighterByIndex(index: number): TeamFighter | null {
    if (index < this.team1.length) return this.team1[index];
    const t2i = index - this.team1.length;
    if (t2i < this.team2.length) return this.team2[t2i];
    return null;
  }

  dispose(): void {
    this.disposed = true;
    this.projectiles?.dispose();
    for (const tf of [...this.team1, ...this.team2]) {
      if (tf.healParticles) { tf.healParticles.stop(); tf.healParticles.dispose(); }
      if (tf.healAura) tf.healAura.dispose();
      this.removeBindVfx(tf);
    }
    disposeAllEffects();
    this.sound.dispose();
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    this.inputHandler.dispose();
    this.engine.dispose();
  }

  // ====================================================================
  // Model loading
  // ====================================================================

  private async loadSharedModelData(
    model: ModelEntry,
    enabledPartKeys?: string[],
  ): Promise<SharedModelData> {
    const { model: voxModel, voxels } = await loadVoxFile(model.bodyFile);
    const cx = voxModel.sizeX / 2;
    const cy = voxModel.sizeY / 2;
    const maxZ = voxModel.sizeZ;

    let mergedVoxels = [...voxels];
    try {
      const partsResp = await fetch(model.partsManifest + `?v=${Date.now()}`);
      if (partsResp.ok) {
        const parts = await partsResp.json();
        const defaultParts = enabledPartKeys
          ? parts.filter((p: { key: string }) =>
              p.key !== model.bodyKey && enabledPartKeys.includes(p.key))
          : parts.filter((p: { key: string; default_on: boolean }) =>
              p.key !== model.bodyKey && p.default_on);
        const bodySet = new Set(mergedVoxels.map(v => `${v.x},${v.y},${v.z}`));
        for (const part of defaultParts) {
          try {
            const { voxels: equipVoxels } = await loadVoxFile(part.file);
            for (const v of equipVoxels) {
              const k = `${v.x},${v.y},${v.z}`;
              if (!bodySet.has(k)) { mergedVoxels.push(v); bodySet.add(k); }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* no equipment */ }

    let markers = getDefaultMarkers(cx);
    try {
      const resp = await fetch(`/api/bone-config?dir=${model.dir}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.markers) markers = { ...markers, ...data.markers };
      }
    } catch { /* defaults */ }

    const bones = calculateAllBones(markers, maxZ);
    const restPos = new Map<string, Vector3>();
    for (const boneDef of BONE_DEFS) {
      const bp = bones[boneDef.name];
      if (bp) {
        restPos.set(boneDef.name, voxelToViewer(bp.x, bp.y, bp.z, cx, cy).clone());
      }
    }

    let bodyHeight = 0;
    const hipsPos = bones['Hips'];
    const headPos = bones['Head'];
    if (hipsPos && headPos) {
      bodyHeight = (headPos.z - hipsPos.z) * SCALE;
    }

    return { mergedVoxels, bones, cx, cy, restPos, bodyHeight, gender: model.gender };
  }

  private buildTeamFighter(
    data: SharedModelData,
    prefix: string,
    spawn: { x: number; z: number },
    archetype: FighterArchetype,
    facingAngle: number,
  ): TeamFighter {
    const root = new TransformNode(`${prefix}_root`, this.scene);
    const charBuild = buildSkeletalCharacter(
      data.mergedVoxels, data.bones, this.scene, data.cx, data.cy, prefix,
    );
    const hipsNode = charBuild.nodes.get('Hips');
    if (hipsNode && !hipsNode.parent) hipsNode.parent = root;

    root.position.x = spawn.x;
    root.position.z = spawn.z;
    root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), facingAngle + Math.PI / 2);

    const state = createFighter(spawn.x, spawn.z, facingAngle, {
      maxHp: archetype.maxHp,
      moveSpeed: DEFAULT_FIGHTER_STATS.moveSpeed * archetype.moveSpeedMultiplier,
    });
    state.startupScale = archetype.startupScale;
    state.recoveryScale = archetype.recoveryScale;

    const ai = new FighterAI('normal');
    if (archetype.hasProjectile) ai.setHasProjectile(true);
    if (archetype.hasVineWhip) ai.setHasVineWhip(true);

    const motion = new FighterMotionPlayer(
      charBuild.nodes, data.restPos, data.bodyHeight, data.gender,
    );

    // Heal aura visual for healer archetype
    let healAura: Mesh | null = null;
    let healParticles: ParticleSystem | null = null;
    if (archetype.healPerSec > 0 && archetype.healRadius > 0) {
      healAura = MeshBuilder.CreateTorus(`${prefix}_healAura`, {
        diameter: archetype.healRadius * 2,
        thickness: 0.05,
        tessellation: 48,
      }, this.scene);
      healAura.parent = root;
      healAura.position.y = 0.02;
      const auraMat = new StandardMaterial(`${prefix}_healAuraMat`, this.scene);
      auraMat.emissiveColor = new Color3(0.2, 1.0, 0.4);
      auraMat.disableLighting = true;
      auraMat.alpha = 0.35;
      healAura.material = auraMat;
      healAura.isPickable = false;

      healParticles = new ParticleSystem(`${prefix}_healPS`, 60, this.scene);
      healParticles.createPointEmitter(new Vector3(-0.3, 0, -0.3), new Vector3(0.3, 0.8, 0.3));
      healParticles.emitter = healAura;
      healParticles.minSize = 0.03;
      healParticles.maxSize = 0.06;
      healParticles.minLifeTime = 0.5;
      healParticles.maxLifeTime = 1.0;
      healParticles.color1 = new Color4(0.2, 1.0, 0.4, 0.8);
      healParticles.color2 = new Color4(0.4, 1.0, 0.6, 0.5);
      healParticles.colorDead = new Color4(0, 0.5, 0.2, 0);
      healParticles.emitRate = 30;
      healParticles.gravity = new Vector3(0, 0.3, 0);
      healParticles.blendMode = ParticleSystem.BLENDMODE_ADD;
      healParticles.start();
    }

    return {
      state, root, nodes: charBuild.nodes, motion,
      combo: createComboState(), ai,
      gender: data.gender, archetype,
      projectileSpawned: false,
      hp: archetype.maxHp, maxHp: archetype.maxHp, delayHp: archetype.maxHp,
      alive: true,
      healAura, healParticles,
      bindVfx: null,
      bindSnake: null,
    };
  }

  // ====================================================================
  // Game loop
  // ====================================================================

  private gameLoop(): void {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    const dt = rawDt * this.timeScale;

    if (this.hitstopTimer > 0) { this.hitstopTimer--; return; }
    if (this.gameMode === 'menu') return;
    if (this.paused) { this.updateCamera(); this.pushUIState(); return; }

    // Decay POV damage effects
    if (this.povDamageFlash > 0) this.povDamageFlash = Math.max(0, this.povDamageFlash - dt * 3.0);
    if (this.povShakeTimer > 0) this.povShakeTimer = Math.max(0, this.povShakeTimer - dt);

    if (this.resetMatchSignal) {
      this.resetMatchSignal = false;
      this.resetAllState();
      return;
    }

    this.phaseTimer += dt;

    if (this.phase === 'intro') { this.handleIntroPhase(dt); return; }
    if (this.phase === 'ko') { this.handleKOPhase(dt); return; }
    if (this.phase === 'result') { this.updateCamera(); return; }
    if (this.phase !== 'fight') return;

    this.timer -= dt;
    if (this.timer < 0) this.timer = 0;

    const all = [...this.team1, ...this.team2];

    // === AI + Fighter updates ===
    for (const tf of all) {
      if (!tf.alive) continue;

      const enemies = this.team1.includes(tf) ? this.team2 : this.team1;
      const target = this.findNearestAliveEnemy(tf, enemies);
      if (!target) continue;

      // Training mode: no AI, only process ongoing attack phases
      if (this.trainingMode) {
        if (tf.state.action !== 'attack') tf.projectileSpawned = false;
        // Empty input — just let attack phases progress, bound/knockdown timers tick
        const emptyIn = { forward: false, backward: false, strafeLeft: false, strafeRight: false,
          jump: false, attack: null, block: false, grapple: null, mash: false,
          special: false, strongSpecial: false };
        updateFighter(tf.state, emptyIn, target.state.x, target.state.z, dt);
        // Spawn projectiles for attacker
        if (tf.state.action === 'attack' && tf.state.attackPhase === 'active'
            && tf.state.currentAttack?.projectile && !tf.projectileSpawned) {
          tf.projectileSpawned = true;
          const teamIdx = this.team1.includes(tf) ? 1 : 2;
          this.projectiles?.spawn(
            teamIdx, tf.state.x, tf.state.y, tf.state.z,
            tf.state.facingAngle, tf.state.currentAttack.projectile,
          );
          tf.state.attackHasHit = true;
        }
        continue;
      }

      const input = tf.ai.update(tf.state, target.state, dt);

      // Convert special inputs for projectile archetypes
      if (input.special && tf.archetype.hasProjectile && canAct(tf.state)
          && !input.attack && isOpponentInFront(tf.state, target.state.x, target.state.z)) {
        input.attack = 'energy_ball';
      }
      if (input.strongSpecial && tf.archetype.hasProjectile && canAct(tf.state)
          && !input.attack && isOpponentInFront(tf.state, target.state.x, target.state.z)) {
        input.attack = 'thunder_bolt';
      }

      if (tf.state.action !== 'attack') tf.projectileSpawned = false;

      updateFighter(tf.state, input, target.state.x, target.state.z, dt);

      // Spawn projectiles
      if (tf.state.action === 'attack' && tf.state.attackPhase === 'active'
          && tf.state.currentAttack?.projectile && !tf.projectileSpawned) {
        tf.projectileSpawned = true;
        const teamIdx = this.team1.includes(tf) ? 1 : 2;
        this.projectiles?.spawn(
          teamIdx, tf.state.x, tf.state.y, tf.state.z,
          tf.state.facingAngle, tf.state.currentAttack.projectile,
        );
        tf.state.attackHasHit = true;
      }
    }

    // === Melee hit detection ===
    for (const tf of all) {
      if (!tf.alive) continue;
      const enemies = this.team1.includes(tf) ? this.team2 : this.team1;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        this.processHitDetection(tf, enemy);
      }
    }

    // === Projectile hit detection ===
    if (this.projectiles) {
      const t1Nodes = this.team1.map(tf => tf.nodes);
      const t2Nodes = this.team2.map(tf => tf.nodes);
      const t1Alive = this.team1.map(tf => tf.alive);
      const t2Alive = this.team2.map(tf => tf.alive);
      const projHits = this.projectiles.updateTeams(dt, t1Nodes, t2Nodes, t1Alive, t2Alive);
      for (const hit of projHits) {
        const defTeam = hit.defenderTeam === 1 ? this.team1 : this.team2;
        const defender = defTeam[hit.defenderIndex];
        if (!defender.alive || defender.state.action === 'knockdown' || defender.state.action === 'bound') continue;
        this.applyProjectileHit(hit, defender);
      }
    }

    // === Combos ===
    for (const tf of all) { updateCombo(tf.combo, dt); }

    // === Healer aura ===
    this.processHealAuras(dt);

    // === Vine bind DOT ===
    this.processBindDot(dt);

    // === Win check ===
    this.checkTeamKO();

    // === Sync visuals ===
    for (const tf of all) {
      this.syncFighterPosition(tf);
      if (tf.motion) tf.motion.update(tf.state, dt);
    }

    this.updateCamera();
    updateScreenShake(this.camera, dt);
    updateDamageNumbers(dt);

    // Delayed HP drain
    for (const tf of all) {
      if (tf.delayHp > tf.hp) {
        tf.delayHp = Math.max(tf.hp, tf.delayHp - 30 * dt);
      }
    }

    this.pushUIState();
  }

  // ====================================================================
  // Phase handlers
  // ====================================================================

  private handleIntroPhase(dt: number): void {
    if (this.phaseTimer >= 1.5 && this.phaseTimer < 1.5 + dt * 2) {
      this.sound.play('round_start');
    }
    if (this.phaseTimer >= 2.0) {
      this.phase = 'fight';
      this.phaseTimer = 0;
      this.sound.play('fight');
    }
    for (const tf of [...this.team1, ...this.team2]) {
      if (tf.motion) tf.motion.update(tf.state, dt);
    }
    this.updateCamera();
    this.pushUIState();
  }

  private handleKOPhase(dt: number): void {
    if (this.phaseTimer < dt * 2) {
      this.sound.play('ko');
    }
    const koDt = this.phaseTimer < 0.8 ? dt * 0.3 : dt;
    for (const tf of [...this.team1, ...this.team2]) {
      if (tf.motion) tf.motion.update(tf.state, koDt);
    }
    if (this.phaseTimer >= 4.0) {
      this.phase = 'result';
      this.phaseTimer = 0;
    }
    this.updateCamera();
    this.pushUIState();
  }

  // ====================================================================
  // Combat
  // ====================================================================

  private findNearestAliveEnemy(self: TeamFighter, enemies: TeamFighter[]): TeamFighter | null {
    let nearest: TeamFighter | null = null;
    let minDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.state.x - self.state.x;
      const dz = e.state.z - self.state.z;
      const d = dx * dx + dz * dz;
      if (d < minDist) { minDist = d; nearest = e; }
    }
    return nearest;
  }

  private processHitDetection(attacker: TeamFighter, defender: TeamFighter): void {
    const atk = attacker.state;
    const def = defender.state;

    if (atk.action !== 'attack' || atk.attackPhase !== 'active'
        || atk.attackHasHit || !atk.currentAttack) return;
    if (def.action === 'knockdown' || def.action === 'bound') return;

    const result = checkHit(atk.currentAttack, attacker.nodes, defender.nodes);
    if (!result.hit) return;

    const wasBlocked = def.action === 'block';
    const fullDamage = atk.currentAttack.damage * result.damageMultiplier;
    let actualDamage = wasBlocked
      ? fullDamage * def.stats.blockDamageRatio
      : fullDamage;

    if (!wasBlocked) {
      actualDamage = registerComboHit(attacker.combo, actualDamage);
    }

    applyHit(def, atk.currentAttack, atk.x, atk.z);
    defender.hp = Math.max(0, defender.hp - actualDamage);
    this.hitstopTimer = STAGE_CONFIG.hitstopFrames;
    atk.attackHasHit = true;

    // Apply vine bind if attack has bindDuration and not blocked
    if (!wasBlocked && atk.currentAttack.bindDuration && atk.currentAttack.bindDuration > 0) {
      def.action = 'bound';
      def.bindTimer = atk.currentAttack.bindDuration;
      def.bindDotPerSec = atk.currentAttack.bindDotPerSec ?? 0;
      def.bindMashCount = 0;
      def.stunTimer = 0;
      this.spawnBindVfx(defender);
    }

    createHitParticles(this.scene, result.hitPoint, wasBlocked);
    spawnDamageNumber(this.scene, result.hitPoint, actualDamage, wasBlocked);
    triggerScreenShake(wasBlocked ? 0.01 : 0.025, wasBlocked ? 0.08 : 0.15);
    this.sound.play(wasBlocked
      ? (def.guardBroken ? 'guard_break' : 'block')
      : (actualDamage > 12 ? 'hit_heavy' : 'hit_light'));

    this.triggerPovDamage(defender, actualDamage);
    this.checkFighterKO(defender);
  }

  private applyProjectileHit(
    hit: { damage: number; hitStun: number; knockback: number; hitPoint: Vector3; defName: string },
    defender: TeamFighter,
  ): void {
    const def = defender.state;
    const wasBlocked = def.action === 'block';
    const actualDamage = wasBlocked ? hit.damage * def.stats.blockDamageRatio : hit.damage;

    const attackDef = ATTACKS[hit.defName];
    const knockdownType = attackDef?.knockdownType;

    if (wasBlocked) {
      def.guard -= hit.damage * 0.8;
      def.guardRegenCooldown = def.stats.guardRegenDelay;
      if (def.guard <= 0) {
        def.guard = 0;
        def.guardBroken = true;
        def.stunTimer = hit.hitStun * 1.5;
      } else {
        def.stunTimer = hit.hitStun * 0.5;
      }
      def.action = 'hitstun';
    } else if (!wasBlocked && attackDef?.bindDuration && attackDef.bindDuration > 0) {
      // Vine bind from projectile hit
      def.action = 'bound';
      def.bindTimer = attackDef.bindDuration;
      def.bindDotPerSec = attackDef.bindDotPerSec ?? 0;
      def.bindMashCount = 0;
      def.stunTimer = 0;
      def.currentMotion = null;
      this.spawnBindVfx(defender);
    } else if (knockdownType) {
      def.action = 'knockdown';
      def.knockdownVariant = knockdownType;
      def.knockdownTimer = 3.0;
      def.stunTimer = 0;
    } else {
      def.stunTimer = hit.hitStun;
      def.action = 'hitstun';
    }
    def.currentAttack = null;
    def.currentMotion = null;

    defender.hp = Math.max(0, defender.hp - actualDamage);
    this.hitstopTimer = STAGE_CONFIG.hitstopFrames;

    createHitParticles(this.scene, hit.hitPoint, wasBlocked);
    spawnDamageNumber(this.scene, hit.hitPoint, actualDamage, wasBlocked);
    triggerScreenShake(wasBlocked ? 0.01 : 0.025, wasBlocked ? 0.08 : 0.15);
    this.sound.play(wasBlocked ? 'block' : (actualDamage > 10 ? 'hit_heavy' : 'hit_light'));

    this.triggerPovDamage(defender, actualDamage);
    this.checkFighterKO(defender);
  }

  /** Trigger POV damage effect if the hit fighter is the one being followed */
  private triggerPovDamage(tf: TeamFighter, damage: number): void {
    if (this.followIndex === null) return;
    const followed = this.getFighterByIndex(this.followIndex);
    if (followed !== tf) return;
    // Flash intensity scales with damage (capped at 1.0)
    this.povDamageFlash = Math.min(1.0, this.povDamageFlash + damage / 30);
    this.povShakeIntensity = Math.min(0.15, damage * 0.005);
    this.povShakeTimer = 0.25;
  }

  private checkFighterKO(tf: TeamFighter): void {
    if (tf.hp <= 0 && tf.alive) {
      tf.alive = false;
      tf.state.action = 'knockdown';
      tf.state.knockdownTimer = 999;
      tf.state.stunTimer = 0;
      tf.state.currentAttack = null;
      tf.state.currentMotion = null;
    }
  }

  private checkTeamKO(): void {
    if (this.phase !== 'fight' || this.trainingMode) return;

    const t1AllDown = this.team1.every(tf => !tf.alive);
    const t2AllDown = this.team2.every(tf => !tf.alive);

    if (t1AllDown || t2AllDown || this.timer <= 0) {
      this.phase = 'ko';
      this.phaseTimer = 0;
      if (t1AllDown && t2AllDown) {
        this.winner = null;
      } else if (t1AllDown) {
        this.winner = 'team2';
      } else if (t2AllDown) {
        this.winner = 'team1';
      } else {
        // Time up: compare total HP
        const t1Total = this.team1.reduce((s, tf) => s + tf.hp, 0);
        const t2Total = this.team2.reduce((s, tf) => s + tf.hp, 0);
        this.winner = t1Total > t2Total ? 'team1' : (t2Total > t1Total ? 'team2' : null);
      }
    }
  }

  // ====================================================================
  // Healing
  // ====================================================================

  private processHealAuras(dt: number): void {
    for (const team of [this.team1, this.team2]) {
      for (const healer of team) {
        if (!healer.alive || healer.archetype.healPerSec <= 0) continue;
        const rSq = healer.archetype.healRadius * healer.archetype.healRadius;
        const healAmount = healer.archetype.healPerSec * dt;

        for (const ally of team) {
          if (!ally.alive || ally.hp >= ally.maxHp) continue;
          const dx = ally.state.x - healer.state.x;
          const dz = ally.state.z - healer.state.z;
          if (dx * dx + dz * dz <= rSq) {
            ally.hp = Math.min(ally.maxHp, ally.hp + healAmount);
            if (ally.delayHp < ally.hp) ally.delayHp = ally.hp;
          }
        }
      }
    }
  }

  // ====================================================================
  // Vine bind
  // ====================================================================

  private processBindDot(dt: number): void {
    for (const tf of [...this.team1, ...this.team2]) {
      if (!tf.alive || tf.state.action !== 'bound') {
        // Clean up VFX if no longer bound
        if (tf.bindVfx) this.removeBindVfx(tf);
        continue;
      }
      // Update VFX position to follow fighter
      if (tf.bindVfx) {
        tf.bindVfx.emitter = tf.root.position.clone();
      }
      // Animate snake coiling around body
      if (tf.bindSnake) {
        tf.bindSnake.elapsed += dt;
        this.updateBindSnake(tf);
      }
      // Apply DOT
      if (tf.state.bindDotPerSec > 0) {
        const dotDmg = tf.state.bindDotPerSec * dt;
        tf.hp = Math.max(0, tf.hp - dotDmg);
        this.checkFighterKO(tf);
      }
    }
  }

  /** Bones the snake coils through, from feet to head */
  private static SNAKE_COIL_BONES = [
    'RightFoot', 'RightLeg', 'RightUpLeg',
    'Hips', 'Spine', 'Spine1', 'Spine2',
    'LeftShoulder', 'LeftArm', 'LeftForeArm',
  ];

  private spawnBindVfx(tf: TeamFighter): void {
    if (tf.bindVfx) this.removeBindVfx(tf);

    // Particle aura (subtle green mist)
    const ps = new ParticleSystem(`bind_${Date.now()}`, 40, this.scene);
    ps.createCylinderEmitter(0.3, 0.5, 0, 0);
    ps.emitter = tf.root.position.clone();
    ps.minSize = 0.01;
    ps.maxSize = 0.04;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;
    ps.color1 = new Color4(0.1, 0.8, 0.2, 0.6);
    ps.color2 = new Color4(0.05, 0.5, 0.1, 0.4);
    ps.colorDead = new Color4(0.0, 0.3, 0.05, 0.0);
    ps.emitRate = 30;
    ps.minEmitPower = 0.02;
    ps.maxEmitPower = 0.06;
    ps.gravity = new Vector3(0, 0.05, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    tf.bindVfx = ps;

    // Voxel snake: chain of small cubes that coil around bones
    const segCount = 30;
    const segments: Mesh[] = [];
    const ts = Date.now();
    for (let i = 0; i < segCount; i++) {
      const size = 0.018 - i * 0.0003; // head thicker, tail thinner
      const box = MeshBuilder.CreateBox(`snake_${ts}_${i}`, { size: Math.max(size, 0.008) }, this.scene);
      const mat = new StandardMaterial(`snakeMat_${ts}_${i}`, this.scene);
      // Alternate dark green / bright green for scale pattern
      const shade = i % 2 === 0 ? 1.0 : 0.6;
      mat.emissiveColor = new Color3(0.05 * shade, 0.7 * shade, 0.15 * shade);
      mat.disableLighting = true;
      mat.alpha = 0.9;
      box.material = mat;
      box.isPickable = false;
      segments.push(box);
    }
    tf.bindSnake = { segments, elapsed: 0 };
    this.updateBindSnake(tf);
  }

  /** Position snake segments spiraling around the character's bones */
  private updateBindSnake(tf: TeamFighter): void {
    if (!tf.bindSnake) return;
    const { segments, elapsed } = tf.bindSnake;

    // Collect bone world positions along the coil path
    const bonePositions: Vector3[] = [];
    for (const boneName of FightGameEngine.SNAKE_COIL_BONES) {
      const node = tf.nodes.get(boneName);
      if (node) {
        bonePositions.push(node.getAbsolutePosition());
      }
    }
    if (bonePositions.length < 2) {
      // Fallback: stack vertically from root
      const base = tf.root.position;
      for (let i = 0; i < 5; i++) {
        bonePositions.push(new Vector3(base.x, base.y + i * 0.1, base.z));
      }
    }

    // Total path length for parameterization
    const pathLengths: number[] = [0];
    let totalLen = 0;
    for (let i = 1; i < bonePositions.length; i++) {
      totalLen += Vector3.Distance(bonePositions[i - 1], bonePositions[i]);
      pathLengths.push(totalLen);
    }
    if (totalLen < 0.01) totalLen = 0.01;

    // Place each segment along the path with spiral offset
    const coilSpeed = 1.5; // rotations per second
    const coilRadius = 0.06; // spiral radius around the bone path
    for (let i = 0; i < segments.length; i++) {
      // Parametric position along bone chain (0..1)
      const t = i / segments.length;
      const targetDist = t * totalLen;

      // Find which bone segment we're on
      let segIdx = 0;
      for (let s = 1; s < pathLengths.length; s++) {
        if (pathLengths[s] >= targetDist) { segIdx = s - 1; break; }
        if (s === pathLengths.length - 1) segIdx = s - 1;
      }
      const segLen = pathLengths[segIdx + 1] - pathLengths[segIdx];
      const localT = segLen > 0.001 ? (targetDist - pathLengths[segIdx]) / segLen : 0;

      // Interpolate position along bone segment
      const p0 = bonePositions[segIdx];
      const p1 = bonePositions[Math.min(segIdx + 1, bonePositions.length - 1)];
      const baseX = p0.x + (p1.x - p0.x) * localT;
      const baseY = p0.y + (p1.y - p0.y) * localT;
      const baseZ = p0.z + (p1.z - p0.z) * localT;

      // Spiral offset around the path
      const angle = t * Math.PI * 6 + elapsed * coilSpeed * Math.PI * 2;
      const r = coilRadius * (1 - t * 0.3); // tighter near tail
      const offX = Math.cos(angle) * r;
      const offZ = Math.sin(angle) * r;

      segments[i].position.set(baseX + offX, baseY, baseZ + offZ);
    }
  }

  private removeBindVfx(tf: TeamFighter): void {
    if (tf.bindVfx) {
      tf.bindVfx.stop();
      tf.bindVfx.dispose();
      tf.bindVfx = null;
    }
    if (tf.bindSnake) {
      for (const seg of tf.bindSnake.segments) {
        seg.dispose();
      }
      tf.bindSnake = null;
    }
  }

  // ====================================================================
  // Visuals
  // ====================================================================

  private syncFighterPosition(tf: TeamFighter): void {
    tf.root.position.x = tf.state.x;
    tf.root.position.y = tf.state.y;
    tf.root.position.z = tf.state.z;
    tf.root.rotationQuaternion = Quaternion.RotationAxis(
      Vector3.Up(), tf.state.facingAngle + Math.PI / 2,
    );
  }

  private updateCamera(): void {
    // First-person POV mode
    if (this.followIndex !== null) {
      const tf = this.getFighterByIndex(this.followIndex);
      if (tf) {
        const headNode = tf.nodes.get('Head');
        const eyePos = headNode
          ? headNode.getAbsolutePosition().clone()
          : new Vector3(tf.state.x, tf.state.y + 0.5, tf.state.z);

        // Target = point ahead in facing direction
        const facing = tf.state.facingAngle;
        const lookDist = 0.5;
        this.camera.target.set(
          eyePos.x + Math.cos(facing) * lookDist,
          eyePos.y,
          eyePos.z + Math.sin(facing) * lookDist,
        );
        // alpha = facing + PI places camera at eyePos (behind the target)
        this.camera.alpha = facing + Math.PI;
        this.camera.beta = Math.PI / 2;
        this.camera.radius = lookDist;

        // POV shake when hit
        if (this.povShakeTimer > 0) {
          const shakeX = (Math.random() - 0.5) * 2 * this.povShakeIntensity;
          const shakeY = (Math.random() - 0.5) * 2 * this.povShakeIntensity;
          this.camera.target.x += shakeX;
          this.camera.target.y += shakeY;
        }

        // Clamp camera above ground
        const minY = STAGE_CONFIG.groundY + 0.05;
        if (this.camera.position.y < minY) {
          this.camera.target.y += minY - this.camera.position.y;
        }
        return;
      }
    }

    // Default: center on all alive fighters
    const alive = [...this.team1, ...this.team2].filter(tf => tf.alive);
    if (alive.length === 0) return;
    let sumX = 0, sumZ = 0;
    for (const tf of alive) { sumX += tf.state.x; sumZ += tf.state.z; }
    this.camera.target.x = sumX / alive.length;
    this.camera.target.z = sumZ / alive.length;
    this.camera.target.y = STAGE_CONFIG.cameraHeight;
  }

  // ====================================================================
  // State management
  // ====================================================================

  private resetAllState(): void {
    this.phase = 'intro';
    this.phaseTimer = 0;
    this.timer = STAGE_CONFIG.roundTime;
    this.hitstopTimer = 0;
    this.winner = null;
    this.projectiles?.dispose();
    this.projectiles = new ProjectileSystem(this.scene);

    const resetTeam = (team: TeamFighter[], spawns: { x: number; z: number }[], facing: number) => {
      for (let i = 0; i < team.length; i++) {
        const tf = team[i];
        const s = spawns[i];
        const st = tf.state;
        st.x = s.x; st.y = 0; st.z = s.z; st.vy = 0;
        st.facingAngle = facing;
        st.action = 'idle'; st.stunTimer = 0; st.currentAttack = null;
        st.guard = st.stats.maxGuard; st.guardBroken = false;
        st.currentMotion = null; st.knockdownVariant = 'knockdown';
        st.knockdownTimer = 0; st.startupScale = tf.archetype.startupScale;
        st.recoveryScale = tf.archetype.recoveryScale;
        st.bindTimer = 0; st.bindDotPerSec = 0; st.bindMashCount = 0;
        tf.hp = tf.maxHp; tf.delayHp = tf.maxHp; tf.alive = true;
        tf.projectileSpawned = false;
        this.removeBindVfx(tf);
        resetCombo(tf.combo);
        tf.root.position.set(s.x, 0, s.z);
        tf.root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), facing + Math.PI / 2);
      }
    };

    resetTeam(this.team1, TEAM1_SPAWNS, Math.PI);
    resetTeam(this.team2, TEAM2_SPAWNS, 0);
  }

  private pushUIState(): void {
    this.uiUpdateCounter++;
    if (this.uiUpdateCounter % 6 !== 0 || !this.onUIUpdate) return;

    const mapTeam = (team: TeamFighter[]): FighterUIInfo[] =>
      team.map(tf => ({
        hp: tf.hp,
        maxHp: tf.maxHp,
        delayHp: tf.delayHp,
        guard: tf.state.guard,
        guardBroken: tf.state.guardBroken,
        action: tf.state.action + (tf.state.currentAttack ? `:${tf.state.currentAttack.name}` : ''),
        label: tf.archetype.label,
        alive: tf.alive,
        bindTimer: tf.state.bindTimer,
        bindDotPerSec: tf.state.bindDotPerSec,
        x: tf.state.x,
        z: tf.state.z,
      }));

    this.onUIUpdate({
      team1: mapTeam(this.team1),
      team2: mapTeam(this.team2),
      timer: this.timer,
      phase: this.phase,
      winner: this.winner,
      povDamageFlash: this.povDamageFlash,
    });
  }
}
