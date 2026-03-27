/**
 * Particle FX Engine
 * Reusable liquid/splatter particle system for Babylon.js.
 * Supports: water, blood, poison, mud, etc. via FluidPreset.
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, InstancedMesh,
} from '@babylonjs/core';

// ─── Preset ──────────────────────────────────────────────

export interface FluidPreset {
  /** Display name */
  name: string;
  /** Primary particle color */
  color: Color3;
  /** Specular highlight color */
  specular: Color3;
  /** Ground residue color */
  residueColor: Color3;
  /** Particle opacity (0-1) */
  alpha: number;
  /** Residue opacity (0-1) */
  residueAlpha: number;
  /** Base particle size */
  particleSize: number;
  /** Gravity multiplier (1.0 = normal) */
  gravityMul: number;
  /** Air resistance coefficient */
  airResistance: number;
  /** Viscosity: drip speed on surfaces (lower = stickier) */
  dripSpeed: number;
  /** Time before sticky drops start dripping */
  dripDelay: [number, number]; // [min, max] seconds
  /** Whether to spawn splash on ground impact */
  splashOnGround: boolean;
  /** Whether to spawn splash on mesh impact */
  splashOnMesh: boolean;
  /** Splash particle count multiplier */
  splashMul: number;
  /** Speed multiplier (1.0 = normal). Lower = shorter range */
  speedMul: number;
  /** How much upward angle reduces speed (0 = no effect, 1 = full).
   *  At verticalDamping=1 and 90°, speed becomes nearly zero */
  verticalDamping: number;
}

export const PRESET_WATER: FluidPreset = {
  name: 'Water',
  color: new Color3(0.2, 0.5, 1.0),
  specular: new Color3(0.6, 0.7, 1.0),
  residueColor: new Color3(0.15, 0.4, 0.9),
  alpha: 0.7,
  residueAlpha: 0.55,
  particleSize: 0.025,
  gravityMul: 1.0,
  airResistance: 0.3,
  dripSpeed: 0.015,
  dripDelay: [0.5, 2.0],
  splashOnGround: true,
  splashOnMesh: true,
  splashMul: 1.0,
  speedMul: 1.0,
  verticalDamping: 0,
};

export const PRESET_BLOOD: FluidPreset = {
  name: 'Blood',
  color: new Color3(0.6, 0.02, 0.02),
  specular: new Color3(0.3, 0.05, 0.05),
  residueColor: new Color3(0.4, 0.01, 0.01),
  alpha: 0.85,
  residueAlpha: 0.75,
  particleSize: 0.02,
  gravityMul: 1.1,
  airResistance: 0.4,
  dripSpeed: 0.008,
  dripDelay: [1.0, 3.0],
  splashOnGround: true,
  splashOnMesh: true,
  splashMul: 0.7,
  speedMul: 1.0,
  verticalDamping: 0,
};

export const PRESET_POISON: FluidPreset = {
  name: 'Poison',
  color: new Color3(0.1, 0.7, 0.15),
  specular: new Color3(0.2, 0.5, 0.1),
  residueColor: new Color3(0.08, 0.5, 0.1),
  alpha: 0.65,
  residueAlpha: 0.5,
  particleSize: 0.03,
  gravityMul: 1.8,         // heavy but not overwhelming
  airResistance: 0.6,      // thick fluid
  dripSpeed: 0.02,
  dripDelay: [0.3, 1.5],
  splashOnGround: true,
  splashOnMesh: true,
  splashMul: 1.2,
  speedMul: 0.5,           // half speed
  verticalDamping: 0.5,    // upward is weaker but still visible
};

// ─── Emit pattern ────────────────────────────────────────

export type EmitPattern =
  | { type: 'stream'; direction: Vector3; spread: number; waves: number }
  | { type: 'burst'; normal: Vector3; spread: number }
  | { type: 'slash'; normal: Vector3; slashDir: Vector3; arc: number; spread: number };

export interface EmitParams {
  origin: Vector3;
  pattern: EmitPattern;
  speed: number;
  count: number;
  sizeScale?: number;   // multiplier on preset's particleSize
  /** Seconds after emit before collision activates (default: 0.15) */
  collisionDelay?: number;
}

// ─── Internal types ──────────────────────────────────────

interface Particle {
  mesh: InstancedMesh;
  velocity: Vector3;
  life: number;
  maxLife: number;
  gravityScale: number;
  isSplash: boolean;
  collisionDelay: number;  // seconds after emit before collision is enabled
}

interface StickyDrop {
  mesh: InstancedMesh;
  parentMesh: Mesh;
  localOffset: Vector3;
  dripTimer: number;
  dripping: boolean;
}

// ─── Engine ──────────────────────────────────────────────

const GRAVITY = -9.8;

export class ParticleFxSystem {
  private scene: Scene;
  private preset: FluidPreset;

  private particleTpl: Mesh | null = null;
  private residueTpl: Mesh | null = null;
  private particles: Particle[] = [];
  private residues: InstancedMesh[] = [];
  private stickyDrops: StickyDrop[] = [];
  private collidables: Mesh[] = [];
  private idCounter = 0;

  readonly maxParticles: number;
  readonly maxResidues: number;
  readonly maxSticky: number;

  constructor(
    scene: Scene,
    preset: FluidPreset,
    opts?: { maxParticles?: number; maxResidues?: number; maxSticky?: number },
  ) {
    this.scene = scene;
    this.preset = preset;
    this.maxParticles = opts?.maxParticles ?? 500;
    this.maxResidues = opts?.maxResidues ?? 2000;
    this.maxSticky = opts?.maxSticky ?? 1500;
  }

  /** Switch preset at runtime (e.g. water → blood) */
  setPreset(preset: FluidPreset) {
    this.preset = preset;
    // recreate templates with new colors
    if (this.particleTpl) { this.particleTpl.dispose(); this.particleTpl = null; }
    if (this.residueTpl) { this.residueTpl.dispose(); this.residueTpl = null; }
  }

  getPreset(): FluidPreset { return this.preset; }

  /** Register meshes that particles should collide with and stick to */
  setCollidables(meshes: Mesh[]) {
    this.collidables = meshes;
  }

  addCollidable(mesh: Mesh) {
    this.collidables.push(mesh);
  }

  // ── Templates ────────────────────────────────────────

  private getParticleTpl(): Mesh {
    if (this.particleTpl && !this.particleTpl.isDisposed()) return this.particleTpl;
    const p = this.preset;
    this.particleTpl = MeshBuilder.CreateBox(`_fxPart_${p.name}`, { size: 1 }, this.scene);
    const mat = new StandardMaterial(`_fxPartMat_${p.name}`, this.scene);
    mat.diffuseColor = p.color;
    mat.specularColor = p.specular;
    mat.alpha = p.alpha;
    this.particleTpl.material = mat;
    this.particleTpl.isVisible = false;
    return this.particleTpl;
  }

  private getResidueTpl(): Mesh {
    if (this.residueTpl && !this.residueTpl.isDisposed()) return this.residueTpl;
    const p = this.preset;
    this.residueTpl = MeshBuilder.CreateBox(`_fxRes_${p.name}`, { size: 1 }, this.scene);
    const mat = new StandardMaterial(`_fxResMat_${p.name}`, this.scene);
    mat.diffuseColor = p.residueColor;
    mat.specularColor = p.specular;
    mat.alpha = p.residueAlpha;
    this.residueTpl.material = mat;
    this.residueTpl.isVisible = false;
    return this.residueTpl;
  }

  // ── Emit ─────────────────────────────────────────────

  emit(params: EmitParams) {
    const available = this.maxParticles - this.particles.length;
    const count = Math.min(params.count, available);
    if (count <= 0) return;

    const tpl = this.getParticleTpl();
    const p = this.preset;
    const sizeScale = params.sizeScale ?? 1.0;

    const { pattern } = params;
    const waves = pattern.type === 'stream' ? pattern.waves : 1;
    const perWave = Math.floor(count / waves);

    for (let wave = 0; wave < waves; wave++) {
      for (let i = 0; i < perWave; i++) {
        const inst = tpl.createInstance(`fx${this.idCounter++}`);
        const size = p.particleSize * sizeScale * (0.7 + Math.random() * 0.6);
        inst.scaling.setAll(size);
        inst.position = params.origin.clone();

        const dir = this.computeDirection(pattern);
        const emitDelay = wave * 0.07 + Math.random() * 0.05;
        // apply preset speed multiplier + vertical damping
        // verticalDamping: abs(dirY) near 1 (up/down) → speed reduced
        const vertFactor = 1.0 - p.verticalDamping * Math.abs(dir.y);
        const speedVar = params.speed * p.speedMul * Math.max(vertFactor, 0.2) * (0.8 + Math.random() * 0.4);
        const velocity = dir.scale(speedVar);
        const gravityScale = this.calcGravityScale(dir);

        this.particles.push({
          mesh: inst,
          velocity,
          life: -emitDelay,
          maxLife: 1.5 + Math.random() * 1.0,
          gravityScale,
          isSplash: false,
          collisionDelay: params.collisionDelay ?? 0.15,
        });
      }
    }
  }

  private computeDirection(pattern: EmitPattern): Vector3 {
    const dir = new Vector3();
    switch (pattern.type) {
      case 'stream': {
        dir.copyFrom(pattern.direction).normalize();
        dir.x += (Math.random() - 0.5) * pattern.spread;
        dir.y += (Math.random() - 0.5) * pattern.spread * 0.5;
        dir.z += (Math.random() - 0.5) * pattern.spread;
        break;
      }
      case 'burst': {
        // hemisphere around normal
        dir.copyFrom(pattern.normal).normalize();
        dir.x += (Math.random() - 0.5) * pattern.spread * 2;
        dir.y += (Math.random() - 0.5) * pattern.spread * 2;
        dir.z += (Math.random() - 0.5) * pattern.spread * 2;
        break;
      }
      case 'slash': {
        // fan along slash direction, biased toward normal
        const t = (Math.random() - 0.5) * pattern.arc;
        dir.copyFrom(pattern.normal).normalize();
        const slashN = pattern.slashDir.clone().normalize();
        dir.addInPlace(slashN.scale(Math.sin(t)));
        dir.x += (Math.random() - 0.5) * pattern.spread;
        dir.y += (Math.random() - 0.5) * pattern.spread;
        dir.z += (Math.random() - 0.5) * pattern.spread;
        break;
      }
    }
    dir.normalize();
    return dir;
  }

  private calcGravityScale(dir: Vector3): number {
    // upward (dirY>0): reduce gravity so it rises before falling
    // downward (dirY<0): increase gravity to accelerate fall
    return 1.0 - dir.y * 0.4;
  }

  // ── Splash ───────────────────────────────────────────

  private spawnSplash(pos: Vector3, count: number) {
    if (this.particles.length >= this.maxParticles) return;
    const n = Math.min(count, this.maxParticles - this.particles.length, 4);
    const tpl = this.getParticleTpl();
    const p = this.preset;

    for (let i = 0; i < n; i++) {
      const inst = tpl.createInstance(`sp${this.idCounter++}`);
      inst.scaling.setAll(p.particleSize * (0.15 + Math.random() * 0.25));
      inst.position = pos.clone();
      inst.position.x += (Math.random() - 0.5) * 0.05;
      inst.position.z += (Math.random() - 0.5) * 0.05;
      inst.position.y += 0.02;

      const angle = Math.random() * Math.PI * 2;
      const hSpeed = 0.2 + Math.random() * 0.5;
      const vSpeed = 0.3 + Math.random() * 0.6;

      this.particles.push({
        mesh: inst,
        velocity: new Vector3(Math.cos(angle) * hSpeed, vSpeed, Math.sin(angle) * hSpeed),
        life: 0,
        maxLife: 0.2 + Math.random() * 0.2,
        gravityScale: 2.0,
        isSplash: true,
        collisionDelay: 0,
      });
    }
  }

  // ── Residue (ground) ─────────────────────────────────

  private placeResidue(pos: Vector3, size: number) {
    if (this.maxResidues <= 0) return;
    if (this.residues.length >= this.maxResidues) {
      const old = this.residues.shift();
      if (old) old.dispose();
    }
    const tpl = this.getResidueTpl();
    const inst = tpl.createInstance(`r${this.idCounter++}`);
    const sx = size * (0.6 + Math.random() * 1.0);
    const sz = size * (0.6 + Math.random() * 1.0);
    const sy = size * (0.1 + Math.random() * 0.2);
    inst.scaling.set(sx, sy, sz);
    inst.position.set(
      pos.x + (Math.random() - 0.5) * 0.03,
      0.002 + Math.random() * 0.003,
      pos.z + (Math.random() - 0.5) * 0.03,
    );
    inst.rotation.set(
      (Math.random() - 0.5) * 0.4,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.4,
    );
    inst.visibility = this.preset.residueAlpha * (0.8 + Math.random() * 0.4);
    this.residues.push(inst);
  }

  // ── Sticky (surface) ─────────────────────────────────

  private placeSticky(pos: Vector3, hitMesh: Mesh, size: number) {
    if (this.maxSticky <= 0) return;
    if (this.stickyDrops.length >= this.maxSticky) {
      const old = this.stickyDrops.shift();
      if (old) old.mesh.dispose();
    }
    const tpl = this.getResidueTpl();
    const inst = tpl.createInstance(`st${this.idCounter++}`);
    const s = size * (0.8 + Math.random() * 0.5);
    inst.scaling.setAll(s * 1.5);
    inst.position = pos.clone();
    inst.visibility = this.preset.residueAlpha;

    const parentWorld = hitMesh.getAbsolutePosition();
    const localOffset = pos.subtract(parentWorld);
    const [dMin, dMax] = this.preset.dripDelay;

    this.stickyDrops.push({
      mesh: inst,
      parentMesh: hitMesh,
      localOffset,
      dripTimer: dMin + Math.random() * (dMax - dMin),
      dripping: false,
    });
  }

  // ── Update (call every frame) ────────────────────────

  update(dt: number) {
    this.updateParticles(dt);
    this.updateSticky(dt);
  }

  private updateParticles(dt: number) {
    const p = this.preset;
    let writeIdx = 0;

    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      pt.life += dt;

      if (pt.life < 0) {
        pt.mesh.isVisible = false;
        this.particles[writeIdx++] = pt;
        continue;
      }
      pt.mesh.isVisible = true;

      if (pt.life > pt.maxLife || pt.mesh.position.y < -0.3) {
        pt.mesh.dispose();
        continue;
      }

      pt.velocity.y += GRAVITY * p.gravityMul * pt.gravityScale * dt;

      const drag = 1.0 - p.airResistance * dt;
      pt.velocity.x *= drag;
      pt.velocity.z *= drag;

      pt.mesh.position.addInPlace(pt.velocity.scale(dt));

      // mesh collision (point-in-AABB, skip during collision delay after emit)
      let stuck = false;
      if (pt.life > pt.collisionDelay) {
        const pos = pt.mesh.position;
        for (let m = 0; m < this.collidables.length; m++) {
          const target = this.collidables[m];
          if (!target || target.isDisposed()) continue;
          const bb = target.getBoundingInfo().boundingBox;
          const min = bb.minimumWorld;
          const max = bb.maximumWorld;
          if (pos.x >= min.x && pos.x <= max.x &&
              pos.y >= min.y && pos.y <= max.y &&
              pos.z >= min.z && pos.z <= max.z) {
            const dx1 = pos.x - min.x, dx2 = max.x - pos.x;
            const dy1 = pos.y - min.y, dy2 = max.y - pos.y;
            const dz1 = pos.z - min.z, dz2 = max.z - pos.z;
            const minD = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
            const sp = pos.clone();
            if (minD === dx1) sp.x = min.x;
            else if (minD === dx2) sp.x = max.x;
            else if (minD === dy1) sp.y = min.y;
            else if (minD === dy2) sp.y = max.y;
            else if (minD === dz1) sp.z = min.z;
            else sp.z = max.z;

            this.placeSticky(sp, target, pt.mesh.scaling.x);
            if (!pt.isSplash && p.splashOnMesh) {
              const spd = pt.velocity.length();
              if (spd > 1.5) {
                this.spawnSplash(sp, Math.min(Math.floor(spd * 0.5 * p.splashMul), 2));
              }
            }
            pt.mesh.dispose();
            stuck = true;
            break;
          }
        }
      }
      if (stuck) continue;

      // ground collision
      if (pt.mesh.position.y <= 0.01) {
        if (!pt.isSplash && p.splashOnGround) {
          const spd = Math.abs(pt.velocity.y);
          if (spd > 1.5) {
            this.spawnSplash(pt.mesh.position, Math.min(Math.floor(spd * p.splashMul), 3));
          }
        }
        this.placeResidue(pt.mesh.position, pt.mesh.scaling.x);
        pt.mesh.dispose();
        continue;
      }

      const alpha = 1.0 - (pt.life / pt.maxLife);
      pt.mesh.visibility = Math.max(0, alpha * p.alpha);
      pt.mesh.rotation.x += dt * 5;
      pt.mesh.rotation.z += dt * 3;

      this.particles[writeIdx++] = pt;
    }
    this.particles.length = writeIdx;
  }

  private updateSticky(dt: number) {
    const p = this.preset;
    let writeIdx = 0;

    for (let i = 0; i < this.stickyDrops.length; i++) {
      const s = this.stickyDrops[i];
      const parentWorld = s.parentMesh.getAbsolutePosition();
      s.mesh.position.copyFrom(parentWorld.add(s.localOffset));

      s.dripTimer -= dt;
      if (s.dripTimer <= 0) s.dripping = true;

      if (s.dripping) {
        s.localOffset.y -= p.dripSpeed * dt;
      }

      const worldY = s.mesh.position.y;
      if (worldY <= 0.01) {
        this.placeResidue(s.mesh.position, s.mesh.scaling.x);
        s.mesh.dispose();
        continue;
      }

      if (s.dripping) {
        const bounds = s.parentMesh.getBoundingInfo().boundingBox;
        const parentMinY = bounds.minimumWorld.y;
        if (worldY < parentMinY - 0.05) {
          if (this.particles.length < this.maxParticles) {
            const tpl = this.getParticleTpl();
            const inst = tpl.createInstance(`df${this.idCounter++}`);
            inst.scaling.copyFrom(s.mesh.scaling);
            inst.position.copyFrom(s.mesh.position);
            this.particles.push({
              mesh: inst,
              velocity: new Vector3(0, -0.3, 0),
              life: 0,
              maxLife: 2.0,
              gravityScale: 1.0,
              isSplash: true,
              collisionDelay: 0,
            });
          }
          s.mesh.dispose();
          continue;
        }
      }

      this.stickyDrops[writeIdx++] = s;
    }
    this.stickyDrops.length = writeIdx;
  }

  // ── Cleanup ──────────────────────────────────────────

  dispose() {
    this.particles.forEach(p => p.mesh.dispose());
    this.particles = [];
    this.residues.forEach(r => r.dispose());
    this.residues = [];
    this.stickyDrops.forEach(s => s.mesh.dispose());
    this.stickyDrops = [];
    this.collidables = [];
    this.particleTpl?.dispose();
    this.particleTpl = null;
    this.residueTpl?.dispose();
    this.residueTpl = null;
  }

  /** Current active particle count (for debug display) */
  get activeCount() {
    return this.particles.length;
  }

  get residueCount() {
    return this.residues.length;
  }

  get stickyCount() {
    return this.stickyDrops.length;
  }
}
