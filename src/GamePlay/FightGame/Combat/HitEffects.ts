/**
 * Hit effects: particle burst, screen shake, floating damage numbers.
 * All effects are fire-and-forget, managed via a simple pool updated each frame.
 */

import {
  Scene, Vector3, Color3, Color4,
  MeshBuilder, StandardMaterial, DynamicTexture,
  ParticleSystem, ArcRotateCamera,
} from '@babylonjs/core';

// ========================================================================
// Screen Shake
// ========================================================================

interface ShakeState {
  timer: number;
  duration: number;
  intensity: number;
}

const shakeState: ShakeState = { timer: 0, duration: 0, intensity: 0 };

export function triggerScreenShake(intensity: number, duration: number): void {
  shakeState.timer = 0;
  shakeState.duration = duration;
  shakeState.intensity = intensity;
}

export function updateScreenShake(camera: ArcRotateCamera, dt: number): void {
  if (shakeState.timer >= shakeState.duration) return;
  shakeState.timer += dt;
  const t = shakeState.timer / shakeState.duration;
  const fade = 1 - t; // decay over time
  const ox = (Math.random() - 0.5) * 2 * shakeState.intensity * fade;
  const oy = (Math.random() - 0.5) * 2 * shakeState.intensity * fade;
  camera.target.x += ox;
  camera.target.y += oy;
}

// ========================================================================
// Hit Particle Burst (pooled)
// ========================================================================

const PARTICLE_POOL_SIZE = 12;
let particlePool: ParticleSystem[] = [];
let particlePoolScene: Scene | null = null;

function getOrCreateParticlePool(scene: Scene): ParticleSystem[] {
  if (particlePoolScene === scene && particlePool.length > 0) return particlePool;
  particlePoolScene = scene;
  particlePool = [];
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    const ps = new ParticleSystem(`hitPS_${i}`, 30, scene);
    ps.createPointEmitter(Vector3.Zero(), Vector3.Zero());
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, -1.5, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.disposeOnStop = false;
    particlePool.push(ps);
  }
  return particlePool;
}

export function createHitParticles(
  scene: Scene,
  position: Vector3,
  blocked: boolean,
): void {
  const pool = getOrCreateParticlePool(scene);
  // Find an idle particle system
  let ps = pool.find(p => !p.isStarted);
  if (!ps) {
    // All busy — skip this effect (cosmetic only)
    return;
  }

  ps.emitter = position.clone();

  ps.minSize = 0.01;
  ps.maxSize = blocked ? 0.03 : 0.05;
  ps.minLifeTime = 0.1;
  ps.maxLifeTime = blocked ? 0.2 : 0.35;

  if (blocked) {
    ps.color1 = new Color4(0.4, 0.6, 1.0, 1);
    ps.color2 = new Color4(0.2, 0.3, 0.8, 1);
    ps.colorDead = new Color4(0.1, 0.1, 0.4, 0);
  } else {
    ps.color1 = new Color4(1.0, 0.8, 0.2, 1);
    ps.color2 = new Color4(1.0, 0.3, 0.1, 1);
    ps.colorDead = new Color4(0.5, 0.0, 0.0, 0);
  }

  ps.minEmitPower = 0.3;
  ps.maxEmitPower = blocked ? 0.6 : 1.2;

  ps.manualEmitCount = blocked ? 8 : 20;
  ps.targetStopDuration = 0.4;

  ps.start();
}

// ========================================================================
// Floating Damage Numbers
// ========================================================================

interface DamageNumber {
  mesh: ReturnType<typeof MeshBuilder.CreatePlane>;
  mat: StandardMaterial;
  tex: DynamicTexture;
  timer: number;
  startY: number;
  active: boolean;
}

const DMG_POOL_SIZE = 16;
const DAMAGE_NUMBER_DURATION = 0.8;
let dmgPool: DamageNumber[] = [];
let dmgPoolScene: Scene | null = null;

function getOrCreateDmgPool(scene: Scene): DamageNumber[] {
  if (dmgPoolScene === scene && dmgPool.length > 0) return dmgPool;
  dmgPoolScene = scene;
  dmgPool = [];
  for (let i = 0; i < DMG_POOL_SIZE; i++) {
    const plane = MeshBuilder.CreatePlane(`dmgNum_${i}`, { width: 0.15, height: 0.06 }, scene);
    plane.billboardMode = 7;
    plane.isPickable = false;
    plane.setEnabled(false);

    const mat = new StandardMaterial(`dmgMat_${i}`, scene);
    mat.disableLighting = true;
    mat.useAlphaFromDiffuseTexture = true;

    const tex = new DynamicTexture(`dmgTex_${i}`, { width: 128, height: 48 }, scene, false);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    plane.material = mat;

    dmgPool.push({ mesh: plane, mat, tex, timer: 0, startY: 0, active: false });
  }
  return dmgPool;
}

export function spawnDamageNumber(
  scene: Scene,
  position: Vector3,
  damage: number,
  blocked: boolean,
): void {
  const pool = getOrCreateDmgPool(scene);
  const dn = pool.find(d => !d.active);
  if (!dn) return; // pool exhausted — skip cosmetic

  dn.active = true;
  dn.timer = 0;
  dn.mesh.position.copyFrom(position);
  dn.mesh.position.y += 0.05;
  dn.startY = dn.mesh.position.y;
  dn.mesh.scaling.setAll(1);
  dn.mesh.setEnabled(true);

  dn.mat.emissiveColor = blocked
    ? new Color3(0.3, 0.5, 1.0)
    : new Color3(1.0, 0.9, 0.2);
  dn.mat.alpha = 1;

  const ctx = dn.tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 128, 48);
  ctx.font = 'bold 32px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (blocked) {
    ctx.fillStyle = '#6688ff';
    ctx.fillText('BLOCK', 64, 24);
  } else {
    ctx.fillStyle = '#ffee44';
    ctx.strokeStyle = '#cc4400';
    ctx.lineWidth = 2;
    ctx.strokeText(String(Math.round(damage)), 64, 24);
    ctx.fillText(String(Math.round(damage)), 64, 24);
  }

  dn.tex.update();
}

export function updateDamageNumbers(dt: number): void {
  for (const dn of dmgPool) {
    if (!dn.active) continue;
    dn.timer += dt;

    dn.mesh.position.y = dn.startY + dn.timer * 0.3;

    const t = dn.timer / DAMAGE_NUMBER_DURATION;
    dn.mat.alpha = Math.max(0, 1 - t);

    const scale = t < 0.15 ? t / 0.15 * 1.3 : 1.3 - (t - 0.15) * 0.4;
    dn.mesh.scaling.setAll(Math.max(0.5, scale));

    if (dn.timer >= DAMAGE_NUMBER_DURATION) {
      dn.active = false;
      dn.mesh.setEnabled(false);
    }
  }
}

/**
 * Dispose all damage number pool (cleanup on scene destroy).
 */
export function disposeAllEffects(): void {
  for (const dn of dmgPool) {
    dn.mesh.dispose();
    dn.mat.dispose();
    dn.tex.dispose();
  }
  dmgPool = [];
  dmgPoolScene = null;
  for (const ps of particlePool) {
    ps.dispose();
  }
  particlePool = [];
  particlePoolScene = null;
}
