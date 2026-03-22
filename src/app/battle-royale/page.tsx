'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh,
  Matrix, Quaternion,
} from '@babylonjs/core';
import {
  CombatState, lerpPose, loadEquipmentWeapon, buildVoxMesh,
  type PoseData,
} from '@/lib/weapon-combat-engine';
import { loadVoxFile, SCALE as VOX_SCALE } from '@/lib/vox-parser';
import { ParticleFxSystem, PRESET_BLOOD } from '@/lib/particle-fx';
import {
  WEAPON_ADVENTURER_SWORD, WEAPON_AXE,
  getWeaponPose, fetchConfiguredWeapons, type WeaponDef,
} from '@/lib/weapon-registry';
import {
  buildGhostRig, applyPoseToGhostRig, createThinInstanceManager,
  registerWeaponBase, updateThinInstances, disposeThinInstanceManager,
  type GhostRig, type ThinInstanceManager,
} from '@/lib/thin-instance-manager';

// ─── Constants ───────────────────────────────────────────
const TOTAL_FIGHTERS = 108;
const ARENA_SIZE = 80;       // world units
const ARENA_HALF = ARENA_SIZE / 2;
const APPROACH_SPEED = 1.2;
const LUNGE_SPEED = 3.5;
const WINDUP_DURATION = 0.3;
const STRIKE_DURATION = 0.15;
const RECOVER_DURATION = 0.35;
const STAGGER_DURATION = 0.3;
const DODGE_DURATION = 0.3;
const KO_FADE_TIME = 2.0;   // seconds before KO'd fighter disappears

// fallback; replaced at load time by fetchConfiguredWeapons()
let AVAILABLE_WEAPONS: WeaponDef[] = [WEAPON_ADVENTURER_SWORD, WEAPON_AXE];

// (armor not used in battle royale - one-hit KO)

// ─── Fighter State ───────────────────────────────────────
type BRState = 'idle' | 'approach' | 'windup' | 'strike' | 'recover' | 'dodge' | 'ko' | 'winner';

interface BRFighter {
  id: number;
  alive: boolean;
  state: BRState;
  stateTimer: number;
  posX: number;
  posZ: number;
  targetId: number | null;
  weapon: WeaponDef;
  weaponReach: number;
  strikeRange: number;
  koTimer: number;        // time since KO (for fade-out)
  aiCooldown: number;
  strafeDir: number;
  strafeTimer: number;
}

// ─── Color generation ────────────────────────────────────
function fighterColor(id: number): Color3 {
  // distribute colors across hue space
  const hue = (id * 137.508) % 360; // golden angle
  const s = 0.6 + (id % 3) * 0.15;
  const l = 0.4 + (id % 5) * 0.08;
  // HSL to RGB
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return new Color3(r + m, g + m, b + m);
}

export default function BattleRoyalePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState('');
  const [aliveCount, setAliveCount] = useState(TOTAL_FIGHTERS);
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const [winnerWeapon, setWinnerWeapon] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const eventLogRef = useRef<string[]>([]);
  const resetFnRef = useRef<(() => void) | null>(null);
  const winnerFoundRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    // reduce render resolution for performance (1 = native, 2 = half)
    engine.setHardwareScalingLevel(1.5);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.08, 0.1, 0.14, 1);

    // scene-level performance flags
    scene.autoClear = false;
    scene.autoClearDepthAndStencil = false;
    scene.skipPointerMovePicking = true;
    scene.blockMaterialDirtyMechanism = true;
    scene.skipFrustumClipping = true;

    // camera - top-down angled view to see the whole field
    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 4, 55, new Vector3(0, 0, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 120;
    camera.wheelPrecision = 20;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.6;
    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, 1), scene);
    dirLight.intensity = 0.7;

    // arena ground
    const ground = MeshBuilder.CreateGround('arena', { width: ARENA_SIZE, height: ARENA_SIZE }, scene);
    const gMat = new StandardMaterial('arenaMat', scene);
    gMat.diffuseColor = new Color3(0.25, 0.3, 0.2);
    gMat.freeze();
    ground.material = gMat;

    // ─── Field decoration (trees, mushrooms) via thin instances ─
    // Use only low-poly models + reduced counts to keep GPU vertex load under 500K
    const FIELD_OBJECTS: { folder: string; files: string[]; scale: number; count: number; maxVoxels?: number }[] = [
      {
        folder: 'field/mushroom',
        files: ['chanterelle'],       // ~2,800 voxels (lightest)
        scale: 2.5,
        count: 12,
      },
      {
        folder: 'field/tree',
        files: ['tree_010'],          // ~4,900 voxels
        scale: 5,
        count: 8,
      },
      {
        folder: 'field/tree2',
        files: ['poplar1'],           // ~5,700 voxels
        scale: 5,
        count: 6,
      },
      {
        folder: 'field/tree3',
        files: ['generic_tree1'],     // ~3,900 voxels (lightest tree)
        scale: 5,
        count: 8,
      },
    ];
    const fieldMeshes: Mesh[] = []; // for cleanup

    (async () => {
      for (const group of FIELD_OBJECTS) {
        const bases: { mesh: Mesh; halfHeightZ: number }[] = [];
        for (const file of group.files) {
          try {
            const url = `/api/game-assets/${group.folder}/${file}.vox`;
            const { voxels } = await loadVoxFile(url);
            // decimate: skip every other voxel for large models to halve vertex count
            const decimated = voxels.length > 3000
              ? voxels.filter((_, idx) => idx % 2 === 0)
              : voxels;

            // compute Z extent before buildVoxMesh centers them
            // buildVoxMesh centers around mean, so half-height = (max_z - mean_z) * SCALE
            let sumZ = 0, minZ = Infinity, maxZ = -Infinity;
            for (const v of decimated) {
              sumZ += v.z;
              if (v.z < minZ) minZ = v.z;
              if (v.z > maxZ) maxZ = v.z;
            }
            const meanZ = sumZ / decimated.length;
            // after centering, bottom is at (minZ - meanZ) * SCALE
            // VOX Z becomes world Y after -90° X rotation
            // to place bottom at ground (y=0): offset = -bottomZ * scale
            const bottomZ = (minZ - meanZ) * VOX_SCALE;
            const halfHeightZ = -bottomZ; // positive offset to lift mesh up

            const mesh = buildVoxMesh(scene, decimated, `field_${file}`);
            mesh.isPickable = false;
            mesh.doNotSyncBoundingInfo = true;
            mesh.freezeWorldMatrix();
            bases.push({ mesh, halfHeightZ });
            fieldMeshes.push(mesh);
          } catch { /* skip broken files */ }
        }
        if (bases.length === 0) continue;

        const perBase = Math.ceil(group.count / bases.length);
        for (const { mesh: base, halfHeightZ } of bases) {
          const matrices = new Float32Array(perBase * 16);
          // Y offset: lift so bottom touches ground (y=0)
          const yOffset = halfHeightZ * group.scale;
          for (let i = 0; i < perBase; i++) {
            const px = (Math.random() - 0.5) * (ARENA_SIZE - 4);
            const pz = (Math.random() - 0.5) * (ARENA_SIZE - 4);
            const rotY = Math.random() * Math.PI * 2;
            const s = group.scale;
            // VOX Z-up → rotate -90° around X to stand upright, then random Y rotation
            const qStand = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2);
            const qYaw = Quaternion.RotationAxis(Vector3.Up(), rotY);
            const q = qYaw.multiply(qStand);
            const m = Matrix.Compose(new Vector3(s, s, s), q, new Vector3(px, yOffset, pz));
            m.copyToArray(matrices, i * 16);
          }
          base.thinInstanceSetBuffer('matrix', matrices, 16, false);
          base.thinInstanceCount = perBase;
        }
      }
    })();

    // blood FX (reduced budget for mass combat)
    let bloodFx = new ParticleFxSystem(scene, PRESET_BLOOD, {
      maxParticles: 300, maxResidues: 500, maxSticky: 0,
    });

    // ─── Build all fighters (ghost rigs + thin instances) ─
    const fighters: BRFighter[] = [];
    const ghostRigs: GhostRig[] = [];
    const blendStates: { prevPose: PoseData; curPose: PoseData; prevState: BRState; blendT: number }[] = [];
    const fColors: Color3[] = [];

    // pre-compute colors
    for (let i = 0; i < TOTAL_FIGHTERS; i++) fColors.push(fighterColor(i));

    // thin instance manager
    let tiManager: ThinInstanceManager = createThinInstanceManager(scene, TOTAL_FIGHTERS, fColors);

    function buildFighters(weapons: WeaponDef[]) {
      for (let i = 0; i < TOTAL_FIGHTERS; i++) {
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        const rig = buildGhostRig(scene, `f${i}`);

        const posX = (Math.random() - 0.5) * (ARENA_SIZE - 2);
        const posZ = (Math.random() - 0.5) * (ARENA_SIZE - 2);

        rig.root.position.set(posX, 0, posZ);
        ghostRigs.push(rig);
        tiManager.ghostRigs.push(rig);

        const idlePose = getWeaponPose(weapon, CombatState.IDLE);
        blendStates.push({
          prevPose: idlePose,
          curPose: idlePose,
          prevState: 'idle',
          blendT: 1,
        });

        fighters.push({
          id: i,
          alive: true,
          state: 'idle',
          stateTimer: 0,
          posX, posZ,
          targetId: null,
          weapon,
          weaponReach: weapon.defaultReach ?? 1.0,
          strikeRange: (weapon.defaultReach ?? 1.0) * 0.85,
          koTimer: 0,
          aiCooldown: Math.random() * 1.5,
          strafeDir: Math.random() < 0.5 ? 1 : -1,
          strafeTimer: 0.8 + Math.random() * 1.5,
        });
      }
    }

    // ─── Load weapons (batched) ──────────────────────────
    let weaponsLoaded = false;

    (async () => {
      try {
        setLoadProgress('設定済み武器を検索中...');
        AVAILABLE_WEAPONS = await fetchConfiguredWeapons();
        setLoadProgress(`${AVAILABLE_WEAPONS.length}種の武器を検出 - ファイター生成中...`);

        buildFighters(AVAILABLE_WEAPONS);

        // load weapon meshes and register as thin instance bases
        for (const wDef of AVAILABLE_WEAPONS) {
          if (wDef.equipmentSource) {
            const { category, pieceKey } = wDef.equipmentSource;
            setLoadProgress(`武器モデル読み込み: ${wDef.name}...`);
            const result = await loadEquipmentWeapon(scene, category, pieceKey, `cache_${wDef.id}`, wDef.meshScale);
            registerWeaponBase(tiManager, wDef.id, result.mesh);
            // update reach for fighters with this weapon
            for (const f of fighters) {
              if (f.weapon.id === wDef.id) {
                f.weaponReach = result.reach;
                f.strikeRange = result.reach * 0.85;
              }
            }
          }
        }

        weaponsLoaded = true;
        setLoading(false);
      } catch (e) {
        console.error('Failed to load weapons:', e);
        setLoadProgress('読み込みエラー');
      }
    })();

    // ─── Helpers ──────────────────────────────────────────
    function getDistSq(a: BRFighter, b: BRFighter): number {
      const dx = a.posX - b.posX;
      const dz = a.posZ - b.posZ;
      return dx * dx + dz * dz;
    }
    function getDist(a: BRFighter, b: BRFighter): number {
      return Math.sqrt(getDistSq(a, b));
    }

    function findNearestAlive(f: BRFighter): BRFighter | null {
      let best: BRFighter | null = null;
      let bestDistSq = Infinity;
      for (const other of fighters) {
        if (other.id === f.id || !other.alive) continue;
        const d = getDistSq(f, other);
        if (d < bestDistSq) {
          bestDistSq = d;
          best = other;
        }
      }
      return best;
    }

    // batch target assignment (avoid O(n^2) every frame)
    let targetAssignTimer = 0;
    function batchAssignTargets() {
      for (const f of fighters) {
        if (!f.alive) continue;
        if (f.targetId !== null && fighters[f.targetId]?.alive) continue;
        const nearest = findNearestAlive(f);
        f.targetId = nearest?.id ?? null;
      }
    }

    function mapBRStateToCombat(s: BRState): CombatState {
      switch (s) {
        case 'idle': return CombatState.IDLE;
        case 'approach': return CombatState.APPROACH;
        case 'windup': return CombatState.ATTACK_WINDUP;
        case 'strike': return CombatState.ATTACK_STRIKE;
        case 'recover': return CombatState.ATTACK_RECOVER;
        case 'dodge': return CombatState.DODGE;
        case 'ko': return CombatState.ROUND_OVER_LOSE;
        case 'winner': return CombatState.ROUND_OVER_WIN;
      }
    }

    function addEvent(msg: string) {
      eventLogRef.current = [msg, ...eventLogRef.current].slice(0, 15);
    }

    // ─── KO a fighter ────────────────────────────────────
    function knockOut(attacker: BRFighter, defender: BRFighter) {
      defender.alive = false;
      defender.state = 'ko';
      defender.stateTimer = 0;
      defender.koTimer = 0;

      // blood burst (scale down when many fighters remain)
      const hitPos = new Vector3(defender.posX, 1.0, defender.posZ);
      const dx = defender.posX - attacker.posX;
      const dz = defender.posZ - attacker.posZ;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      let aliveNow = 0;
      for (const fi of fighters) { if (fi.alive) aliveNow++; }
      const fxScale = aliveNow > 50 ? 0.3 : aliveNow > 20 ? 0.6 : 1.0;
      bloodFx.emit({
        origin: hitPos,
        pattern: { type: 'burst', normal: new Vector3(dx / len, 0.3, dz / len), spread: 1.2 },
        speed: 3.5,
        count: Math.floor(40 * fxScale),
        sizeScale: 1.2,
      });
      addEvent(`#${attacker.id}(${attacker.weapon.nameJa}) が #${defender.id} をKO! 残り${aliveNow}人`);

      // check for winner
      if (aliveNow === 1) {
        attacker.state = 'winner';
        attacker.stateTimer = 0;
        addEvent(`#${attacker.id}(${attacker.weapon.nameJa}) が優勝!`);
      }
    }

    // ─── AI update per fighter ────────────────────────────
    function updateFighter(f: BRFighter, dt: number) {
      if (!f.alive) return;

      // use cached target (assigned by batchAssignTargets)
      if (f.targetId !== null && !fighters[f.targetId]?.alive) f.targetId = null;
      const target = f.targetId !== null ? fighters[f.targetId] : null;
      if (!target) return;

      const dist = getDist(f, target);
      const dx = target.posX - f.posX;
      const dz = target.posZ - f.posZ;
      const dirX = dist > 0.01 ? dx / dist : 0;
      const dirZ = dist > 0.01 ? dz / dist : 1;

      switch (f.state) {
        case 'idle':
        case 'approach': {
          f.aiCooldown -= dt;

          // move toward target
          const safeRange = f.strikeRange + 1.2; // lunge distance buffer
          if (dist > safeRange * 1.2) {
            f.posX += dirX * APPROACH_SPEED * dt;
            f.posZ += dirZ * APPROACH_SPEED * dt;
            f.state = 'approach';
          } else if (dist < safeRange * 0.8) {
            f.posX -= dirX * APPROACH_SPEED * 0.6 * dt;
            f.posZ -= dirZ * APPROACH_SPEED * 0.6 * dt;
            f.state = 'idle';
          } else {
            f.state = 'idle';
          }

          // strafe
          f.strafeTimer -= dt;
          if (f.strafeTimer <= 0) {
            f.strafeDir = Math.random() < 0.5 ? 1 : -1;
            f.strafeTimer = 0.5 + Math.random() * 1.0;
          }
          f.posX += -dirZ * f.strafeDir * 0.5 * dt;
          f.posZ += dirX * f.strafeDir * 0.5 * dt;

          // react to incoming attack: dodge chance
          if (target.state === 'windup' || target.state === 'strike') {
            if (dist < safeRange + 0.5 && f.aiCooldown <= 0 && Math.random() < 0.15) {
              f.state = 'dodge';
              f.stateTimer = 0;
              f.aiCooldown = 0.5;
              break;
            }
          }

          // decide to attack
          if (f.aiCooldown <= 0 && dist < safeRange * 1.4 && Math.random() < 2.5 * dt) {
            f.state = 'windup';
            f.stateTimer = 0;
            f.aiCooldown = 0.4 + Math.random() * 0.6;
          }
          break;
        }

        case 'windup': {
          // lunge toward target
          if (dist > f.strikeRange) {
            const closeDist = Math.min(LUNGE_SPEED * dt, dist - f.strikeRange);
            f.posX += dirX * closeDist;
            f.posZ += dirZ * closeDist;
          }
          if (f.stateTimer >= WINDUP_DURATION) {
            f.state = 'strike';
            f.stateTimer = 0;

            // hit check: is target in range and alive?
            const strikeDist = getDist(f, target);
            if (strikeDist <= f.strikeRange + 0.3 && target.alive) {
              // dodge check for target
              if (target.state === 'dodge') {
                addEvent(`#${target.id} が回避!`);
              } else {
                knockOut(f, target);
              }
            }
          }
          break;
        }

        case 'strike':
          if (f.stateTimer >= STRIKE_DURATION) {
            f.state = 'recover';
            f.stateTimer = 0;
          }
          break;

        case 'recover':
          // step back
          f.posX -= dirX * 1.5 * dt;
          f.posZ -= dirZ * 1.5 * dt;
          if (f.stateTimer >= RECOVER_DURATION) {
            f.state = 'idle';
            f.stateTimer = 0;
            f.targetId = null; // re-evaluate target
          }
          break;

        case 'dodge': {
          const perpX = -dirZ;
          const perpZ = dirX;
          f.posX += perpX * f.strafeDir * 3.0 * dt;
          f.posZ += perpZ * f.strafeDir * 3.0 * dt;
          if (f.stateTimer >= DODGE_DURATION) {
            f.state = 'idle';
            f.stateTimer = 0;
          }
          break;
        }
      }

      // arena bounds
      f.posX = Math.max(-ARENA_HALF + 0.5, Math.min(ARENA_HALF - 0.5, f.posX));
      f.posZ = Math.max(-ARENA_HALF + 0.5, Math.min(ARENA_HALF - 0.5, f.posZ));
    }

    // ─── Reset function ──────────────────────────────────
    resetFnRef.current = () => {
      for (let i = 0; i < TOTAL_FIGHTERS; i++) {
        const f = fighters[i];
        f.alive = true;
        f.state = 'idle';
        f.stateTimer = 0;
        f.koTimer = 0;
        f.targetId = null;
        f.aiCooldown = Math.random() * 1.5;
        f.strafeDir = Math.random() < 0.5 ? 1 : -1;
        f.strafeTimer = 0.8 + Math.random() * 1.5;

        const newWeapon = AVAILABLE_WEAPONS[Math.floor(Math.random() * AVAILABLE_WEAPONS.length)];
        f.weapon = newWeapon;
        f.weaponReach = newWeapon.defaultReach ?? 1.0;
        f.strikeRange = f.weaponReach * 0.85;

        f.posX = (Math.random() - 0.5) * (ARENA_SIZE - 2);
        f.posZ = (Math.random() - 0.5) * (ARENA_SIZE - 2);

        lodLevel[i] = 0;
        const pose = getWeaponPose(f.weapon, CombatState.IDLE);
        blendStates[i] = { prevPose: pose, curPose: pose, prevState: 'idle', blendT: 1 };
      }
      eventLogRef.current = [];
      winnerFoundRef.current = false;
      bloodFx.dispose();
      bloodFx = new ParticleFxSystem(scene, PRESET_BLOOD, {
        maxParticles: 300, maxResidues: 500, maxSticky: 0,
      });
    };

    // ─── Render loop ─────────────────────────────────────
    let frameCount = 0;
    let prevAliveCount = TOTAL_FIGHTERS;

    // 3-tier LOD thresholds (distance² from camera target)
    const LOD_NEAR_SQ = 60 * 60;   // full detail within 60 units (covers most of arena)
    const LOD_MID_SQ  = 80 * 80;   // proxy beyond 80 units
    const lodLevel: (0 | 1 | 2)[] = new Array(TOTAL_FIGHTERS).fill(0);

    engine.runRenderLoop(() => {
      if (!weaponsLoaded) { scene.render(); return; }
      frameCount++;

      const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);

      // batch target assignment every 0.5s
      targetAssignTimer -= dt;
      if (targetAssignTimer <= 0) {
        batchAssignTargets();
        targetAssignTimer = 0.5;
      }

      // count alive
      let aliveNow = 0;
      for (const f of fighters) { if (f.alive) aliveNow++; }

      // stagger AI updates: split fighters into 3 groups
      const aiGroup = frameCount % 3;
      for (let i = 0; i < TOTAL_FIGHTERS; i++) {
        const f = fighters[i];
        if (!f.alive) { f.koTimer += dt; continue; }
        f.stateTimer += dt;
        if (i % 3 === aiGroup || f.state === 'windup' || f.state === 'strike' || f.state === 'dodge') {
          updateFighter(f, dt);
        } else if (f.state === 'approach' && f.targetId !== null) {
          const tgt = fighters[f.targetId];
          if (tgt?.alive) {
            const tdx = tgt.posX - f.posX;
            const tdz = tgt.posZ - f.posZ;
            const td = Math.sqrt(tdx * tdx + tdz * tdz);
            if (td > 0.1) {
              f.posX += (tdx / td) * APPROACH_SPEED * dt;
              f.posZ += (tdz / td) * APPROACH_SPEED * dt;
            }
          }
        }
      }

      // compute LOD levels + update ghost rig poses
      const camTgt = camera.target;
      for (let i = 0; i < TOTAL_FIGHTERS; i++) {
        const f = fighters[i];
        const rig = ghostRigs[i];
        const bs = blendStates[i];

        if (!f.alive && f.koTimer > KO_FADE_TIME) {
          lodLevel[i] = 2;
          continue;
        }

        rig.root.position.set(f.posX, 0, f.posZ);

        // face target
        if (f.targetId !== null && fighters[f.targetId]) {
          const tgt = fighters[f.targetId];
          rig.root.rotation.y = Math.atan2(tgt.posX - f.posX, tgt.posZ - f.posZ);
        }

        const dxCam = f.posX - camTgt.x;
        const dzCam = f.posZ - camTgt.z;
        const distSqCam = dxCam * dxCam + dzCam * dzCam;

        if (distSqCam > LOD_MID_SQ) {
          lodLevel[i] = 2;
        } else if (distSqCam > LOD_NEAR_SQ) {
          lodLevel[i] = 1;
        } else {
          lodLevel[i] = 0;
          // full pose blending for near LOD
          const combatState = mapBRStateToCombat(f.state);
          if (f.state !== bs.prevState) {
            bs.prevPose = bs.curPose;
            bs.blendT = 0;
            bs.prevState = f.state;
          }
          bs.blendT = Math.min(1, bs.blendT + dt * 5);
          const targetPose = getWeaponPose(f.weapon, combatState);
          bs.curPose = lerpPose(bs.prevPose, targetPose, bs.blendT);
          applyPoseToGhostRig(rig, bs.curPose);
        }
      }

      // push all visible fighters into thin instance buffers (single pass)
      updateThinInstances(tiManager, fighters, lodLevel, KO_FADE_TIME, fighters);

      // update FX
      bloodFx.update(dt);

      // throttle React state updates to every 10th frame
      if (frameCount % 10 === 0) {
        if (aliveNow !== prevAliveCount) {
          setAliveCount(aliveNow);
          prevAliveCount = aliveNow;
        }
        if (aliveNow === 1 && !winnerFoundRef.current) {
          winnerFoundRef.current = true;
          for (const f of fighters) {
            if (f.alive) {
              setWinnerId(f.id);
              setWinnerWeapon(f.weapon.nameJa);
              break;
            }
          }
        }
        if (eventLogRef.current.length > 0) {
          setEvents([...eventLogRef.current]);
        }
      }

      // camera auto-follow
      if (aliveNow > 0 && aliveNow <= 10) {
        let cx = 0, cz = 0, count = 0;
        for (const f of fighters) {
          if (!f.alive) continue;
          cx += f.posX; cz += f.posZ; count++;
        }
        cx /= count; cz /= count;
        camera.target = Vector3.Lerp(camera.target, new Vector3(cx, 0, cz), dt * 2);
        const targetRadius = Math.max(5, count * 2);
        camera.radius += (targetRadius - camera.radius) * dt * 2;
      }

      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      bloodFx.dispose();
      for (const m of fieldMeshes) m.dispose();
      disposeThinInstanceManager(tiManager);
      engine.dispose();
    };
  }, []);

  const resetMatch = useCallback(() => {
    if (resetFnRef.current) resetFnRef.current();
    winnerFoundRef.current = false;
    setWinnerId(null);
    setWinnerWeapon('');
    setEvents([]);
    setAliveCount(TOTAL_FIGHTERS);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: '#141820' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '10px 20px', background: 'rgba(0,0,0,0.8)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 18, fontWeight: 'bold' }}>
          BATTLE ROYALE
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 14 }}>
            生存: <span style={{
              fontSize: 22, fontWeight: 'bold',
              color: aliveCount <= 10 ? '#ff4444' : aliveCount <= 30 ? '#ffaa00' : '#44ff44',
            }}>{aliveCount}</span>
            <span style={{ color: '#888' }}> / {TOTAL_FIGHTERS}</span>
          </div>
          <ProgressBar alive={aliveCount} total={TOTAL_FIGHTERS} />
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.85)', color: '#fff',
        }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>BATTLE ROYALE</div>
          <div style={{ fontSize: 16, color: '#aaa' }}>108人バトルロイヤル</div>
          <div style={{ fontSize: 14, color: '#888', marginTop: 16 }}>{loadProgress || '武器モデルを読み込み中...'}</div>
        </div>
      )}

      {/* Event log */}
      <div style={{
        position: 'absolute', left: 16, top: 60, zIndex: 10, color: '#fff', fontSize: 12,
        maxHeight: '40vh', overflow: 'hidden',
      }}>
        {events.map((e, i) => (
          <div key={i} style={{ opacity: 1 - i * 0.06, marginBottom: 2, textShadow: '0 0 4px #000' }}>{e}</div>
        ))}
      </div>

      {/* Winner overlay */}
      {winnerId !== null && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontSize: 20, color: '#aaa', marginBottom: 8 }}>WINNER</div>
          <div style={{ fontSize: 42, fontWeight: 'bold', color: '#ffcc00' }}>
            Fighter #{winnerId}
          </div>
          <div style={{ fontSize: 16, color: '#ccc', marginTop: 4 }}>
            武器: {winnerWeapon}
          </div>
          <button
            onClick={resetMatch}
            style={{
              marginTop: 24, padding: '12px 36px', fontSize: 18,
              background: '#444', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >もう一度</button>
        </div>
      )}

      {/* Controls label */}
      {winnerId === null && !loading && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '6px 18px', borderRadius: 8,
          color: '#aaa', fontSize: 13,
        }}>
          108人バトルロイヤル | 1発KO | 右ドラッグ: カメラ回転 | スクロール: ズーム
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function ProgressBar({ alive, total }: { alive: number; total: number }) {
  const pct = (alive / total) * 100;
  return (
    <div style={{ width: 160, height: 10, background: '#333', borderRadius: 5, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: alive <= 10 ? '#ff4444' : alive <= 30 ? '#ffaa00' : '#44cc44',
        borderRadius: 5, transition: 'width 0.3s',
      }} />
    </div>
  );
}
