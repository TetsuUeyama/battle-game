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
// Hit Particle Burst
// ========================================================================

export function createHitParticles(
  scene: Scene,
  position: Vector3,
  blocked: boolean,
): void {
  const ps = new ParticleSystem('hitPS', 30, scene);

  // Use a simple circle texture generated at runtime
  ps.createPointEmitter(Vector3.Zero(), Vector3.Zero());
  ps.emitter = position.clone();

  // Particle appearance
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

  // Emit in a sphere burst
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = blocked ? 0.6 : 1.2;
  ps.emitRate = 0; // we use manual emit
  ps.gravity = new Vector3(0, -1.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;

  // Burst emit then stop
  ps.manualEmitCount = blocked ? 8 : 20;
  ps.targetStopDuration = 0.4;
  ps.disposeOnStop = true;

  ps.start();
}

// ========================================================================
// Floating Damage Numbers
// ========================================================================

interface DamageNumber {
  mesh: ReturnType<typeof MeshBuilder.CreatePlane>;
  timer: number;
  startY: number;
}

const activeDamageNumbers: DamageNumber[] = [];

export function spawnDamageNumber(
  scene: Scene,
  position: Vector3,
  damage: number,
  blocked: boolean,
): void {
  // Create a small plane with text texture
  const plane = MeshBuilder.CreatePlane('dmgNum', { width: 0.15, height: 0.06 }, scene);
  plane.position = position.clone();
  plane.position.y += 0.05;
  plane.billboardMode = 7; // all axes

  const mat = new StandardMaterial('dmgMat', scene);
  mat.emissiveColor = blocked
    ? new Color3(0.3, 0.5, 1.0)
    : new Color3(1.0, 0.9, 0.2);
  mat.disableLighting = true;
  mat.alpha = 1;

  // Create dynamic texture for damage text
  const tex = new DynamicTexture('dmgTex', { width: 128, height: 48 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
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

  tex.update();
  mat.diffuseTexture = tex;
  mat.opacityTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
  plane.isPickable = false;

  activeDamageNumbers.push({
    mesh: plane,
    timer: 0,
    startY: plane.position.y,
  });
}

const DAMAGE_NUMBER_DURATION = 0.8;

export function updateDamageNumbers(dt: number): void {
  for (let i = activeDamageNumbers.length - 1; i >= 0; i--) {
    const dn = activeDamageNumbers[i];
    dn.timer += dt;

    // Float upward
    dn.mesh.position.y = dn.startY + dn.timer * 0.3;

    // Fade out
    const t = dn.timer / DAMAGE_NUMBER_DURATION;
    const mat = dn.mesh.material as StandardMaterial;
    mat.alpha = Math.max(0, 1 - t);

    // Scale: pop in then shrink
    const scale = t < 0.15 ? t / 0.15 * 1.3 : 1.3 - (t - 0.15) * 0.4;
    dn.mesh.scaling.setAll(Math.max(0.5, scale));

    if (dn.timer >= DAMAGE_NUMBER_DURATION) {
      dn.mesh.dispose();
      activeDamageNumbers.splice(i, 1);
    }
  }
}

/**
 * Dispose all active damage numbers (cleanup on scene destroy).
 */
export function disposeAllEffects(): void {
  for (const dn of activeDamageNumbers) {
    dn.mesh.dispose();
  }
  activeDamageNumbers.length = 0;
}
