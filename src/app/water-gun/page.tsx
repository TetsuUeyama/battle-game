'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, TransformNode,
} from '@babylonjs/core';
import {
  ParticleFxSystem, PRESET_WATER, PRESET_BLOOD, PRESET_POISON,
  type FluidPreset,
} from '@/lib/particle-fx';

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

  const [chargeLevel, setChargeLevel] = useState(0);
  const [isCharging, setIsCharging] = useState(false);
  const [lastFireInfo, setLastFireInfo] = useState('');
  const [fireAngle, setFireAngle] = useState(5);
  const [presetKey, setPresetKey] = useState('water');
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

    for (let d = 2; d <= 8; d += 3) {
      const box = MeshBuilder.CreateBox(`target${d}`, { width: 0.6, height: 0.6, depth: 0.6 }, scene);
      box.position = new Vector3(d, 0.3, 0);
      const bmat = new StandardMaterial(`tmat${d}`, scene);
      bmat.diffuseColor = new Color3(0.85, 0.85, 0.8);
      box.material = bmat;
      collidables.push(box);
    }

    for (let d = 2; d <= 10; d += 2) {
      const marker = MeshBuilder.CreateBox(`marker${d}`, { width: 0.5, height: 0.02, depth: 0.5 }, scene);
      marker.position = new Vector3(d, 0.01, 0);
      const mmat = new StandardMaterial(`mmat${d}`, scene);
      mmat.diffuseColor = new Color3(0.9, 0.9, 0.9);
      mmat.alpha = 0.5;
      marker.material = mmat;
    }

    // FX system
    const fx = new ParticleFxSystem(scene, PRESET_WATER);
    fx.setCollidables(collidables);
    fxRef.current = fx;

    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      fx.update(dt);
      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
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

  // sync gun rotation
  useEffect(() => {
    if (gunRef.current) {
      gunRef.current.rotation.z = (fireAngle * Math.PI) / 180;
    }
  }, [fireAngle]);

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

    const rad = (fireAngle * Math.PI) / 180;
    const fireDir = new Vector3(Math.cos(rad), Math.sin(rad), 0);
    const params = getFireParams(elapsed);

    fx.emit({
      origin: nozzlePos,
      pattern: { type: 'stream', direction: fireDir, spread: params.spread, waves: params.waves },
      speed: params.speed,
      count: params.count,
      sizeScale: params.sizeScale,
    });

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

    const gravLabel = fireAngle > 15 ? '強' : fireAngle > -5 ? '中' : '弱';
    setLastFireInfo(
      `発射位置: (${nozzlePos.x.toFixed(2)}, ${nozzlePos.y.toFixed(2)}, ${nozzlePos.z.toFixed(2)}) | 角度: ${fireAngle}° | 重力: ${gravLabel} | 数: ${params.count}`
    );
  }, [fireAngle]);

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
          左クリック長押し→チャージ→離して発射 | 右ドラッグ→カメラ回転
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <label style={{ fontSize: 13 }}>プリセット:</label>
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
          <span style={{ fontSize: 13, marginLeft: 12 }}>角度:</span>
          <input
            type="range" min={-90} max={90} value={fireAngle}
            onChange={e => setFireAngle(Number(e.target.value))}
            style={{ width: 100 }}
            onPointerDown={e => e.stopPropagation()}
          />
          <span style={{ fontSize: 13, minWidth: 36 }}>{fireAngle}°</span>
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
