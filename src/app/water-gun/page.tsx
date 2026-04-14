'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion,
} from '@babylonjs/core';
import {
  ParticleFxSystem, PRESET_WATER, PRESET_BLOOD, PRESET_POISON,
  type FluidPreset, type VoxelCollider,
  VOXEL_BODY, VOXEL_EQUIPMENT,
} from '@/lib/particle-fx';
import { buildGreedyMesh } from '@/lib/greedy-mesh';
import { SCALE, loadVoxFile } from '@/lib/vox-parser';
import type { VoxelEntry } from '@/lib/vox-parser';

// ─── VOX character loader ────────────────────────────────
interface PartsJson {
  key: string;
  file: string;
  voxels: number;
  category: string;
  default_on?: boolean;
  is_body?: boolean;
}

/** Categories that survive water contact */
const BODY_CATEGORIES = new Set(['body', 'body_segment', 'hair', 'body_region']);

/** body/hair/region系カテゴリはテーマに属さない共通パーツ */
const COMMON_CATEGORIES = new Set(['body', 'body_segment', 'body_region', 'hair']);

/**
 * parts.json からテーマ一覧を抽出する。
 * パーツkeyのパターン: "{キャラ}_{テーマ}_{パーツ}" (例: nina_battlesuit_suit)
 * body/hair等の共通パーツは "default" テーマに分類。
 * default_on: true のパーツも "default" テーマに分類。
 */
function extractThemes(parts: PartsJson[]): { themes: string[]; themePartsMap: Map<string, PartsJson[]> } {
  const themePartsMap = new Map<string, PartsJson[]>();

  for (const part of parts) {
    // 共通パーツ (body, hair等) は常にロード
    if (COMMON_CATEGORIES.has(part.category)) {
      const arr = themePartsMap.get('__common__') ?? [];
      arr.push(part);
      themePartsMap.set('__common__', arr);
      continue;
    }

    // default_on: true のパーツは "default" テーマ
    if (part.default_on) {
      const arr = themePartsMap.get('default') ?? [];
      arr.push(part);
      themePartsMap.set('default', arr);
      continue;
    }

    // keyからテーマを抽出: "nina_battlesuit_suit" → "nina_battlesuit"
    // meshes名からも推測: "Nina Battlesuit - Suit" → "nina_battlesuit"
    const key = part.key;
    // keyの最後のアンダースコア以降がパーツ名、それ以前が「キャラ_テーマ」
    // ただし "queen_marika_default_-_dress" のようなパターンもある
    const dashMatch = key.match(/^(.+?)_-_/);
    if (dashMatch) {
      const theme = dashMatch[1];
      const arr = themePartsMap.get(theme) ?? [];
      arr.push(part);
      themePartsMap.set(theme, arr);
      continue;
    }

    // "nina_battlesuit_suit" → セグメント分割で推測
    // 既知テーマに一致するプレフィックスがあればそれを使う（最長一致優先）
    let matched = false;
    let bestTheme = '';
    for (const existingTheme of Array.from(themePartsMap.keys())) {
      if (existingTheme !== '__common__' && existingTheme !== 'default'
        && key.startsWith(existingTheme + '_')
        && existingTheme.length > bestTheme.length) {
        bestTheme = existingTheme;
      }
    }
    if (bestTheme) {
      themePartsMap.get(bestTheme)!.push(part);
      matched = true;
    }
    if (matched) continue;

    // 新テーマ: keyのセグメント分割でテーマ名を推定
    // パターン: "{キャラ}_{テーマ}_{パーツ}" → テーマは最初の2セグメント
    // ただし "{キャラ}_{テーマパーツ}" (2セグメントのみ) はテーマ名 = key全体
    const segments = key.split('_');
    let theme: string;
    if (segments.length <= 2) {
      // "nina_swimsuit" → テーマ "nina_swimsuit"
      theme = key;
    } else {
      // "nina_battlesuit_suit" → テーマ "nina_battlesuit"
      // "rachel_ninja_gloves_l" → テーマ "rachel_ninja" (最後のアンダースコアで切る)
      const lastUnderscore = key.lastIndexOf('_');
      theme = key.substring(0, lastUnderscore);
    }
    const arr = themePartsMap.get(theme) ?? [];
    arr.push(part);
    themePartsMap.set(theme, arr);
  }

  // テーマ名を整形して返す (common除く)
  const themes = Array.from(themePartsMap.keys()).filter(k => k !== '__common__');
  return { themes, themePartsMap };
}

/** テーマ名を表示用に整形: "nina_battlesuit" → "Nina Battlesuit" */
function formatThemeName(theme: string): string {
  if (theme === 'default') return 'Default';
  return theme.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface VoxCharacterResult {
  bodyMesh: Mesh;
  equipMesh: Mesh;
  bodyVoxels: VoxelEntry[];
  equipVoxels: VoxelEntry[];
  gx: number; gy: number; gz: number;
}

interface VoxCharacterMeta {
  grid: { gx: number; gy: number; gz: number };
  parts: PartsJson[];
  gender: string;
  themes: string[];
  themePartsMap: Map<string, PartsJson[]>;
}

/** キャラクターのメタデータ（parts.json + grid.json）をロード */
async function loadVoxCharacterMeta(charPath: string): Promise<VoxCharacterMeta> {
  const base = `/api/game-assets/vox/${charPath}`;
  const [gridResp, partsResp] = await Promise.all([
    fetch(`${base}/grid.json`),
    fetch(`${base}/parts.json`),
  ]);
  if (!gridResp.ok || !partsResp.ok) throw new Error('Failed to load character metadata');
  const grid: { gx: number; gy: number; gz: number } = await gridResp.json();
  const parts: PartsJson[] = await partsResp.json();
  const gender = charPath.split('/')[0];
  const { themes, themePartsMap } = extractThemes(parts);
  return { grid, parts, gender, themes, themePartsMap };
}

/** 指定テーマのパーツのみロードしてメッシュを構築 */
async function loadVoxCharacter(
  scene: Scene,
  meta: VoxCharacterMeta,
  selectedTheme: string,
  name: string,
): Promise<VoxCharacterResult> {
  const { grid, gender, themePartsMap } = meta;

  // ロード対象: 共通パーツ + 選択テーマのパーツ (default_on: trueのもののみ共通パーツでフィルタ)
  const commonParts = themePartsMap.get('__common__') ?? [];
  const themeParts = themePartsMap.get(selectedTheme) ?? [];
  const partsToLoad = [...commonParts.filter(p => p.default_on !== false), ...themeParts];

  const bodyVoxels: VoxelEntry[] = [];
  const equipVoxels: VoxelEntry[] = [];

  const loads = partsToLoad.map(async (part) => {
    try {
      const url = `/api/game-assets/vox/${gender}${part.file}`;
      const { voxels } = await loadVoxFile(url);
      const isBody = BODY_CATEGORIES.has(part.category);
      return { voxels, isBody };
    } catch {
      console.warn(`Skipped part: ${part.key}`);
      return { voxels: [] as VoxelEntry[], isBody: true };
    }
  });
  const results = await Promise.all(loads);
  for (const { voxels, isBody } of results) {
    const target = isBody ? bodyVoxels : equipVoxels;
    for (const v of voxels) target.push(v);
  }

  const decimate = (vs: VoxelEntry[]) =>
    vs.length > 100_000 ? vs.filter((_, i) => i % 2 === 0) : vs;

  const bodyMesh = buildGreedyMesh(decimate(bodyVoxels), scene, `${name}_body`, grid.gx, grid.gy, grid.gz);
  const equipMesh = buildGreedyMesh(decimate(equipVoxels), scene, `${name}_equip`, grid.gx, grid.gy, grid.gz);

  return { bodyMesh, equipMesh, bodyVoxels, equipVoxels, gx: grid.gx, gy: grid.gy, gz: grid.gz };
}

/** Shared transform helper for VOX → world coordinates */
function voxToWorld(
  vx: number, vy: number, vz: number,
  cx: number, cy: number, s: number,
  cosY: number, sinY: number,
  posX: number, posY: number, posZ: number,
): [number, number, number] {
  const lx = (vx - cx) * s;
  const ly = vz * s;
  const lz = -(vy - cy) * s;
  return [
    cosY * lx + sinY * lz + posX,
    ly + posY,
    -sinY * lx + cosY * lz + posZ,
  ];
}

/**
 * Build a VoxelCollider with body (VOXEL_BODY=sticky) and
 * equipment (VOXEL_EQUIPMENT=destroyable) categories.
 */
function buildVoxelCollider(
  bodyVoxels: VoxelEntry[],
  equipVoxels: VoxelEntry[],
  gx: number, gy: number, gz: number,
  meshPos: Vector3, meshScale: number, yawRad: number,
  displayMesh: Mesh,
): VoxelCollider {
  const cx = gx / 2, cy = gy / 2;
  const cosY = Math.cos(yawRad), sinY = Math.sin(yawRad);
  const s = SCALE * meshScale;

  const allVoxels = [...bodyVoxels, ...equipVoxels];

  // First pass: bounding box
  let wMinX = Infinity, wMinY = Infinity, wMinZ = Infinity;
  let wMaxX = -Infinity, wMaxY = -Infinity, wMaxZ = -Infinity;
  for (const v of allVoxels) {
    const [wx, wy, wz] = voxToWorld(v.x, v.y, v.z, cx, cy, s, cosY, sinY, meshPos.x, meshPos.y, meshPos.z);
    if (wx < wMinX) wMinX = wx; if (wx > wMaxX) wMaxX = wx;
    if (wy < wMinY) wMinY = wy; if (wy > wMaxY) wMaxY = wy;
    if (wz < wMinZ) wMinZ = wz; if (wz > wMaxZ) wMaxZ = wz;
  }

  const cellSize = s * 3;
  const ngx = Math.ceil((wMaxX - wMinX) / cellSize) + 2;
  const ngy = Math.ceil((wMaxY - wMinY) / cellSize) + 2;
  const ngz = Math.ceil((wMaxZ - wMinZ) / cellSize) + 2;
  const originX = wMinX - cellSize;
  const originY = wMinY - cellSize;
  const originZ = wMinZ - cellSize;

  const grid = new Uint8Array(ngx * ngy * ngz);

  const fillGrid = (voxels: VoxelEntry[], category: number) => {
    for (const v of voxels) {
      const [wx, wy, wz] = voxToWorld(v.x, v.y, v.z, cx, cy, s, cosY, sinY, meshPos.x, meshPos.y, meshPos.z);
      const ix = Math.floor((wx - originX) / cellSize);
      const iy = Math.floor((wy - originY) / cellSize);
      const iz = Math.floor((wz - originZ) / cellSize);
      if (ix >= 0 && ix < ngx && iy >= 0 && iy < ngy && iz >= 0 && iz < ngz) {
        grid[ix + iy * ngx + iz * ngx * ngy] = category;
      }
    }
  };
  // Body first, then equipment overwrites overlapping cells
  // (equipment is on top of body, so it should take priority)
  fillGrid(bodyVoxels, VOXEL_BODY);
  fillGrid(equipVoxels, VOXEL_EQUIPMENT);

  return { grid, gx: ngx, gy: ngy, gz: ngz, originX, originY, originZ, cellSize, displayMesh };
}

// ─── Constants ───────────────────────────────────────────
const CHARGE_MAX = 2.0;

const PRESETS: Record<string, FluidPreset> = {
  water: PRESET_WATER,
  blood: PRESET_BLOOD,
  poison: PRESET_POISON,
};

function getFireParams(chargeTime: number) {
  const t = Math.min(chargeTime / CHARGE_MAX, 1.0);
  return {
    speed: 3 + t * 9,
    count: Math.floor(20 + t * 180),
    spread: 0.03 + t * 0.10,
    sizeScale: 0.5 + t * 0.7,
    waves: Math.floor(1 + t * 3),
  };
}

// ─── Procedural water gun ────────────────────────────────
function buildWaterGun(scene: Scene): { root: Mesh; nozzleTip: TransformNode } {
  const root = new Mesh('waterGun', scene);
  const mat = new StandardMaterial('gunMat', scene);
  mat.diffuseColor = new Color3(0.9, 0.3, 0.1);
  mat.specularColor = new Color3(0.2, 0.2, 0.2);

  const matBlue = new StandardMaterial('gunTank', scene);
  matBlue.diffuseColor = new Color3(0.2, 0.4, 0.9);
  matBlue.alpha = 0.7;

  const matGray = new StandardMaterial('gunNozzle', scene);
  matGray.diffuseColor = new Color3(0.6, 0.6, 0.6);

  const body = MeshBuilder.CreateBox('body', { width: 0.6, height: 0.25, depth: 0.2 }, scene);
  body.material = mat; body.parent = root;

  const grip = MeshBuilder.CreateBox('grip', { width: 0.15, height: 0.35, depth: 0.18 }, scene);
  grip.position = new Vector3(-0.05, -0.28, 0);
  grip.material = mat; grip.parent = root;

  const tank = MeshBuilder.CreateBox('tank', { width: 0.25, height: 0.3, depth: 0.18 }, scene);
  tank.position = new Vector3(-0.1, 0.25, 0);
  tank.material = matBlue; tank.parent = root;

  const barrel = MeshBuilder.CreateBox('barrel', { width: 0.4, height: 0.12, depth: 0.12 }, scene);
  barrel.position = new Vector3(0.5, 0.03, 0);
  barrel.material = matGray; barrel.parent = root;

  const nozzle = MeshBuilder.CreateBox('nozzle', { width: 0.08, height: 0.08, depth: 0.08 }, scene);
  nozzle.position = new Vector3(0.74, 0.03, 0);
  nozzle.material = matGray; nozzle.parent = root;

  // invisible marker at the very tip of the nozzle (for emit origin)
  const nozzleTip = new TransformNode('nozzleTip', scene);
  nozzleTip.position = new Vector3(0.78, 0.03, 0);
  nozzleTip.parent = root;

  return { root, nozzleTip };
}

// ─── Main Component ──────────────────────────────────────
export default function WaterGunPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const gunRef = useRef<Mesh | null>(null);
  const tipRef = useRef<TransformNode | null>(null);
  const fxRef = useRef<ParticleFxSystem | null>(null);
  const chargeStartRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const [chargeLevel, setChargeLevel] = useState(0);
  const [isCharging, setIsCharging] = useState(false);
  const [lastFireInfo, setLastFireInfo] = useState('');
  const [fireAngle, setFireAngle] = useState(5);    // pitch (上下)
  const [fireYaw, setFireYaw] = useState(0);         // yaw (水平) degrees
  const [presetKey, setPresetKey] = useState('water');
  const [fireMode, setFireMode] = useState<'normal' | 'sniper' | 'shotgun'>('normal');
  const [targetChar, setTargetChar] = useState('female/realistic-darkelf');
  const [availableThemes, setAvailableThemes] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState('default');
  const spawnTargetRef = useRef<((charPath: string, theme: string) => void) | null>(null);
  const charMetaRef = useRef<VoxCharacterMeta | null>(null);
  const animFrameRef = useRef<number>(0);

  // charge update loop
  const updateCharge = useCallback(() => {
    if (chargeStartRef.current !== null) {
      const elapsed = (performance.now() - chargeStartRef.current) / 1000;
      setChargeLevel(Math.min(elapsed / CHARGE_MAX, 1.0));
    }
    animFrameRef.current = requestAnimationFrame(updateCharge);
  }, []);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(updateCharge);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [updateCharge]);

  // Babylon scene setup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.85, 0.9, 0.95, 1);
    sceneRef.current = scene;

    const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 5, new Vector3(0, 0.5, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 12;
    camera.wheelPrecision = 30;

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.6;
    const dir = new DirectionalLight('dir', new Vector3(-1, -2, 1), scene);
    dir.intensity = 0.8;

    const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = new Color3(0.6, 0.75, 0.6);
    ground.material = groundMat;

    // water gun
    const { root: gun, nozzleTip } = buildWaterGun(scene);
    gun.position = new Vector3(0, 1.2, 0);
    gunRef.current = gun;
    tipRef.current = nozzleTip;

    // collidable meshes (gun child Meshes, excluding TransformNode-only nodes)
    const collidables: Mesh[] = [];
    gun.getChildMeshes(false).forEach(child => {
      if (child instanceof Mesh) collidables.push(child);
    });

    // FX system (must be before spawnTarget which references fx)
    const fx = new ParticleFxSystem(scene, PRESET_WATER);
    fx.setCollidables(collidables);
    fxRef.current = fx;

    // ── Spawn a vox character target with dissolve ───────
    const TARGET_SCALE = 3;
    const TARGET_YAW = -Math.PI / 2;

    const TARGET_POS = new Vector3(5, 0, 0);
    // Track current target meshes for cleanup on switch
    const currentMeshes: Mesh[] = [];

    let lastCharPath = '';

    const spawnTarget = (charPath: string, theme: string) => {
      // Cleanup previous target
      for (const m of currentMeshes) { if (!m.isDisposed()) m.dispose(); }
      currentMeshes.length = 0;
      fx.clearVoxelColliders();

      const id = charPath.split('/')[1];

      // メタデータのロード (キャラ変更時) またはキャッシュ利用 (テーマ変更のみ)
      const metaPromise = (charMetaRef.current && lastCharPath === charPath)
        ? Promise.resolve(charMetaRef.current)
        : loadVoxCharacterMeta(charPath);
      lastCharPath = charPath;

      metaPromise
        .then(meta => {
          charMetaRef.current = meta;
          setAvailableThemes(meta.themes);
          // 選択テーマが存在しなければ最初のテーマにフォールバック
          const actualTheme = meta.themes.includes(theme) ? theme : (meta.themes[0] ?? 'default');
          if (actualTheme !== theme) setSelectedTheme(actualTheme);
          return loadVoxCharacter(scene, meta, actualTheme, id);
        })
        .then(({ bodyMesh, equipMesh, bodyVoxels, equipVoxels, gx, gy, gz }) => {
          const applyTransform = (m: Mesh) => {
            m.scaling = new Vector3(TARGET_SCALE, TARGET_SCALE, TARGET_SCALE);
            m.position = TARGET_POS.clone();
            m.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), TARGET_YAW);
            m.isPickable = false;
          };
          applyTransform(bodyMesh);
          applyTransform(equipMesh);
          currentMeshes.push(bodyMesh, equipMesh);

          const equipVoxelMap = new Map<string, VoxelEntry>();
          for (const v of equipVoxels) {
            equipVoxelMap.set(`${v.x},${v.y},${v.z}`, v);
          }

          const collider = buildVoxelCollider(
            bodyVoxels, equipVoxels, gx, gy, gz,
            TARGET_POS, TARGET_SCALE, TARGET_YAW, bodyMesh,
          );

          const cx = gx / 2, cy = gy / 2;
          const cosY = Math.cos(TARGET_YAW), sinY = Math.sin(TARGET_YAW);
          const s = SCALE * TARGET_SCALE;
          const destroyRadius = collider.cellSize * 2;
          const r2 = destroyRadius * destroyRadius;
          const equipMeshName = `${id}_equip`;
          let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

          collider.onDestroyHit = (hitPos: Vector3) => {
            const toRemove: string[] = [];
            for (const [key, v] of equipVoxelMap) {
              const [wx, wy, wz] = voxToWorld(v.x, v.y, v.z, cx, cy, s, cosY, sinY, TARGET_POS.x, TARGET_POS.y, TARGET_POS.z);
              const dx = wx - hitPos.x, dy = wy - hitPos.y, dz = wz - hitPos.z;
              if (dx * dx + dy * dy + dz * dz < r2) toRemove.push(key);
            }
            for (const key of toRemove) equipVoxelMap.delete(key);

            const r = Math.ceil(destroyRadius / collider.cellSize);
            const hix = Math.floor((hitPos.x - collider.originX) / collider.cellSize);
            const hiy = Math.floor((hitPos.y - collider.originY) / collider.cellSize);
            const hiz = Math.floor((hitPos.z - collider.originZ) / collider.cellSize);
            for (let dzi = -r; dzi <= r; dzi++) {
              for (let dyi = -r; dyi <= r; dyi++) {
                for (let dxi = -r; dxi <= r; dxi++) {
                  const ix = hix + dxi, iy = hiy + dyi, iz = hiz + dzi;
                  if (ix < 0 || ix >= collider.gx || iy < 0 || iy >= collider.gy || iz < 0 || iz >= collider.gz) continue;
                  const gi = ix + iy * collider.gx + iz * collider.gx * collider.gy;
                  if (collider.grid[gi] === VOXEL_EQUIPMENT) collider.grid[gi] = 0;
                }
              }
            }

            if (rebuildTimer) clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(() => {
              const remaining = [...equipVoxelMap.values()];
              const dec = remaining.length > 100_000 ? remaining.filter((_, i) => i % 2 === 0) : remaining;
              const old = scene.getMeshByName(equipMeshName);
              if (old) old.dispose();
              if (dec.length === 0) return;
              const newMesh = buildGreedyMesh(dec, scene, equipMeshName, gx, gy, gz);
              applyTransform(newMesh);
              currentMeshes.push(newMesh);
            }, 300);
          };

          fx.addVoxelCollider(collider);
        })
        .catch(err => console.warn(`Failed to load ${charPath}:`, err));
    };

    spawnTargetRef.current = spawnTarget;

    // WASD movement
    const MOVE_SPEED = 3;
    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      const keys = keysRef.current;
      if (gun && keys.size > 0) {
        let dx = 0, dz = 0;
        if (keys.has('w') || keys.has('arrowup'))    dx += 1;
        if (keys.has('s') || keys.has('arrowdown'))  dx -= 1;
        if (keys.has('a') || keys.has('arrowleft'))  dz += 1;
        if (keys.has('d') || keys.has('arrowright')) dz -= 1;
        if (dx || dz) {
          gun.position.x += dx * MOVE_SPEED * dt;
          gun.position.z += dz * MOVE_SPEED * dt;
        }
        if (keys.has('q')) gun.position.y += MOVE_SPEED * dt;
        if (keys.has('e')) gun.position.y -= MOVE_SPEED * dt;
      }
      fx.update(dt);
      scene.render();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase());
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    const handleResize = () => engine.resize();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      fx.dispose();
      engine.dispose();
    };
  }, []);

  // switch preset
  useEffect(() => {
    if (fxRef.current && PRESETS[presetKey]) {
      fxRef.current.setPreset(PRESETS[presetKey]);
    }
  }, [presetKey]);

  // switch target character or theme
  useEffect(() => {
    spawnTargetRef.current?.(targetChar, selectedTheme);
  }, [targetChar, selectedTheme]);

  // sync gun rotation (yaw then pitch, via quaternion to avoid euler gimbal issues)
  useEffect(() => {
    const gun = gunRef.current;
    if (!gun) return;
    const yawQ = Quaternion.RotationAxis(Vector3.Up(), -(fireYaw * Math.PI) / 180);
    const pitchQ = Quaternion.RotationAxis(Vector3.Forward(), (fireAngle * Math.PI) / 180);
    gun.rotationQuaternion = yawQ.multiply(pitchQ);
  }, [fireAngle, fireYaw]);

  // fire handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    chargeStartRef.current = performance.now();
    setIsCharging(true);
    setChargeLevel(0);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || chargeStartRef.current === null) return;
    const elapsed = (performance.now() - chargeStartRef.current) / 1000;
    chargeStartRef.current = null;
    setIsCharging(false);
    setChargeLevel(0);

    const gun = gunRef.current;
    const tip = tipRef.current;
    const fx = fxRef.current;
    if (!gun || !tip || !fx) return;

    // force full world matrix chain update: gun → tip
    gun.computeWorldMatrix(true);
    tip.computeWorldMatrix(true);
    const nozzlePos = tip.getAbsolutePosition().clone();

    // derive fire direction from gun's world matrix (local +X = barrel forward)
    const gunWorld = gun.getWorldMatrix();
    const fireDir = Vector3.TransformNormal(Vector3.Right(), gunWorld).normalize();

    if (fireMode === 'sniper') {
      // 狙撃: 5粒、重力なし、まっすぐ、高速
      fx.emit({
        origin: nozzlePos,
        pattern: { type: 'stream', direction: fireDir, spread: 0, waves: 1 },
        speed: 20,
        count: 5,
        sizeScale: 0.8,
        collisionDelay: 0.02,
        gravityOverride: 0,
      });
    } else if (fireMode === 'shotgun') {
      // 散弾: 大量・広範囲・1波
      fx.emit({
        origin: nozzlePos,
        pattern: { type: 'stream', direction: fireDir, spread: 0.35, waves: 1 },
        speed: 8 + elapsed * 4,
        count: 150,
        sizeScale: 0.4,
        collisionDelay: 0.05,
      });
    } else {
      // 通常: チャージ依存
      const params = getFireParams(elapsed);
      fx.emit({
        origin: nozzlePos,
        pattern: { type: 'stream', direction: fireDir, spread: params.spread, waves: params.waves },
        speed: params.speed,
        count: params.count,
        sizeScale: params.sizeScale,
      });
    }

    // DEBUG: show red sphere at emit origin
    const scene = sceneRef.current;
    if (scene) {
      const existing = scene.getMeshByName('_debugEmitPos');
      if (existing) existing.dispose();
      const dbg = MeshBuilder.CreateSphere('_debugEmitPos', { diameter: 0.06 }, scene);
      dbg.position = nozzlePos.clone();
      const dbgMat = new StandardMaterial('_dbgMat', scene);
      dbgMat.diffuseColor = new Color3(1, 0, 0);
      dbgMat.emissiveColor = new Color3(1, 0, 0);
      dbg.material = dbgMat;
    }

    setLastFireInfo(
      `[${fireMode}] 位置: (${nozzlePos.x.toFixed(2)}, ${nozzlePos.y.toFixed(2)}, ${nozzlePos.z.toFixed(2)}) | 方向: (${fireDir.x.toFixed(2)}, ${fireDir.y.toFixed(2)}, ${fireDir.z.toFixed(2)})`
    );
  }, [fireMode]);

  const chargePct = Math.round(chargeLevel * 100);
  const chargeColor = chargeLevel < 0.33 ? '#4CAF50' : chargeLevel < 0.66 ? '#FF9800' : '#F44336';

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: '#1a1a2e' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '12px 20px', background: 'rgba(0,0,0,0.7)', color: '#fff',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Particle FX Prototype</h1>
        <span style={{ fontSize: 13, opacity: 0.7 }}>
          WASD:移動 Q/E:上下 | 左クリック長押し→チャージ→離して発射 | 右ドラッグ→カメラ
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <label style={{ fontSize: 13 }}>モード:</label>
          <select
            value={fireMode}
            onChange={e => setFireMode(e.target.value as 'normal' | 'sniper' | 'shotgun')}
            onPointerDown={e => e.stopPropagation()}
            style={{ fontSize: 13, padding: '2px 6px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4 }}
          >
            <option value="normal">通常</option>
            <option value="sniper">狙撃</option>
            <option value="shotgun">散弾</option>
          </select>
          <label style={{ fontSize: 13, marginLeft: 8 }}>的:</label>
          <select
            value={targetChar}
            onChange={e => { setTargetChar(e.target.value); setSelectedTheme('default'); setAvailableThemes([]); }}
            onPointerDown={e => e.stopPropagation()}
            style={{ fontSize: 13, padding: '2px 6px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4 }}
          >
            <optgroup label="Female">
              <option value="female/realistic-darkelf">DarkElf Blader</option>
              <option value="female/realistic-elfpaladin">Elf Paladin</option>
              <option value="female/realistic-artorialancer-default">Artoria Lancer</option>
              <option value="female/realistic-artorialancer-alter">Artoria Alter</option>
              <option value="female/realistic-artorialancer-bunnysuit">Artoria Bunnysuit</option>
              <option value="female/realistic-highpriestess">High Priestess</option>
              <option value="female/realistic-bunnyakali">Bunny Akali</option>
              <option value="female/realistic-bunnyirelia">Bunny Irelia</option>
              <option value="female/realistic-bunnyirelia-ponytail">Bunny Irelia Ponytail</option>
              <option value="female/realistic-daemongirl">Daemon Girl</option>
              <option value="female/realistic-daemongirl-default">Daemon Girl Default</option>
              <option value="female/realistic-daemongirl-bunny">Daemon Girl Bunny</option>
              <option value="female/realistic-daemongirl-bunnysuit">Daemon Girl Bunnysuit</option>
              <option value="female/realistic-daemongirl-ponytail">Daemon Girl Ponytail</option>
              <option value="female/realistic-pillarwoman">Pillar Woman</option>
              <option value="female/realistic-primrose-egypt">Primrose Egypt</option>
              <option value="female/realistic-primrose-officelady">Primrose OL</option>
              <option value="female/realistic-primrose-bunnysuit">Primrose Bunnysuit</option>
              <option value="female/realistic-primrose-milkapron">Primrose Milk Apron</option>
              <option value="female/realistic-primrose-swimsuit">Primrose Swimsuit</option>
              <option value="female/realistic-queenmarika-default">Queen Marika</option>
              <option value="female/realistic-queenmarika-goldenbikini">Queen Marika Bikini</option>
            </optgroup>
            <optgroup label="Male">
              <option value="male/realistic-spartanhoplite">Spartan Hoplite</option>
              <option value="male/realistic-spartanhoplite-tall">Spartan Hoplite Tall</option>
              <option value="male/realistic-dido">Dido</option>
              <option value="male/realistic-radagon">Radagon</option>
              <option value="male/realistic-radagon-tall">Radagon Tall</option>
              <option value="male/realistic-vagrant">Vagrant</option>
              <option value="male/realistic-vagrant-tall">Vagrant Tall</option>
            </optgroup>
          </select>
          {availableThemes.length > 1 && (
            <>
              <label style={{ fontSize: 13, marginLeft: 8 }}>衣装:</label>
              <select
                value={selectedTheme}
                onChange={e => setSelectedTheme(e.target.value)}
                onPointerDown={e => e.stopPropagation()}
                style={{ fontSize: 13, padding: '2px 6px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4 }}
              >
                {availableThemes.map(t => (
                  <option key={t} value={t}>{formatThemeName(t)}</option>
                ))}
              </select>
            </>
          )}
          <label style={{ fontSize: 13, marginLeft: 8 }}>液体:</label>
          <select
            value={presetKey}
            onChange={e => setPresetKey(e.target.value)}
            onPointerDown={e => e.stopPropagation()}
            style={{ fontSize: 13, padding: '2px 6px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: 4 }}
          >
            <option value="water">Water</option>
            <option value="blood">Blood</option>
            <option value="poison">Poison</option>
          </select>
          <span style={{ fontSize: 13, marginLeft: 12 }}>上下:</span>
          <input
            type="range" min={-90} max={90} value={fireAngle}
            onChange={e => setFireAngle(Number(e.target.value))}
            style={{ width: 80 }}
            onPointerDown={e => e.stopPropagation()}
          />
          <span style={{ fontSize: 13, minWidth: 36 }}>{fireAngle}°</span>
          <span style={{ fontSize: 13, marginLeft: 12 }}>水平:</span>
          <input
            type="range" min={-180} max={180} value={fireYaw}
            onChange={e => setFireYaw(Number(e.target.value))}
            style={{ width: 80 }}
            onPointerDown={e => e.stopPropagation()}
          />
          <span style={{ fontSize: 13, minWidth: 36 }}>{fireYaw}°</span>
        </div>
      </div>

      {/* Charge bar */}
      <div style={{
        position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10, width: 400, textAlign: 'center',
      }}>
        {lastFireInfo && (
          <div style={{ color: '#fff', fontSize: 13, marginBottom: 8, background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: 4 }}>
            {lastFireInfo}
          </div>
        )}
        <div style={{ background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '8px 16px' }}>
          <div style={{ color: '#fff', fontSize: 14, marginBottom: 4 }}>
            {isCharging ? `チャージ中... ${chargePct}%` : 'クリックしてチャージ'}
          </div>
          <div style={{ width: '100%', height: 12, background: 'rgba(255,255,255,0.2)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              width: `${chargePct}%`, height: '100%', background: chargeColor,
              borderRadius: 6, transition: isCharging ? 'none' : 'width 0.2s',
            }} />
          </div>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
