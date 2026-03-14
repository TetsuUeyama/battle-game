/**
 * ProjectileSystem: manages projectile entities (spawn, move, collide, render).
 *
 * A projectile is spawned when a fighter's projectile attack enters the active phase.
 * It travels forward in a straight line and checks sphere-vs-capsule collision
 * against the opponent's hitzones each frame.
 */

import {
  Scene, Vector3, Color3, Color4,
  MeshBuilder, StandardMaterial, TransformNode,
  ParticleSystem,
} from '@babylonjs/core';
import { HITZONES } from '@/GamePlay/FightGame/Config/FighterConfig';
import { BONE_DEFS } from '@/lib/voxel-skeleton';

/** Runtime projectile instance */
export interface Projectile {
  x: number;
  z: number;
  y: number;
  vx: number;          // velocity X (viewer units/sec)
  vz: number;          // velocity Z
  vy: number;          // velocity Y
  damage: number;
  hitRadius: number;    // collision sphere radius
  hitStun: number;      // stun applied on hit
  knockback: number;    // knockback distance on hit
  ownerIndex: number;   // 1 or 2 (which player fired it)
  lifetime: number;     // remaining seconds before despawn
  mesh: TransformNode;  // visual representation (head)
  particles: ParticleSystem | null;
  defName: string;      // projectile def name (for knockdown type lookup)
  /** Snake body segments (trailing spheres) */
  segments?: TransformNode[];
  /** Elapsed time for wave animation */
  elapsed?: number;
  /** Wave amplitude for snake slither */
  waveAmplitude?: number;
  /** Wave frequency for snake slither */
  waveFrequency?: number;
  /** Position history for snake trail */
  posHistory?: { x: number; y: number; z: number }[];
}

export interface ProjectileHitResult {
  hit: boolean;
  damage: number;
  hitStun: number;
  knockback: number;
  hitPoint: Vector3;
  hitzoneName: string;
  damageMultiplier: number;
  ownerIndex: number;
  defName: string;      // projectile def name
}

/** Projectile definition (static config) */
export interface ProjectileDef {
  speed: number;        // travel speed (viewer units/sec)
  damage: number;       // base damage
  hitRadius: number;    // collision sphere radius
  hitStun: number;      // stun on hit
  knockback: number;    // knockback distance
  maxLifetime: number;  // seconds before auto-despawn
  color: Color3;        // projectile visual color
  size: number;         // visual size
  /** Snake-style projectile: number of trailing body segments */
  segments?: number;
  /** Snake slither: side-to-side wave amplitude */
  waveAmplitude?: number;
  /** Snake slither: wave frequency (radians/sec) */
  waveFrequency?: number;
}

/** Projectile definitions */
export const PROJECTILE_DEFS: Record<string, ProjectileDef> = {
  energy_ball: {
    speed: 8.0,
    damage: 3,
    hitRadius: 0.12,
    hitStun: 0.1,
    knockback: 0.03,
    maxLifetime: 2.0,
    color: new Color3(0.8, 0.2, 1.0),  // purple energy
    size: 0.05,
  },
  thunder_bolt: {
    speed: 10.0,
    damage: 25,
    hitRadius: 0.2,
    hitStun: 0.6,
    knockback: 0.2,
    maxLifetime: 2.5,
    color: new Color3(0.3, 0.8, 1.0),  // electric blue
    size: 0.12,
  },
  vine_whip: {
    speed: 4.0,           // slower, slithering approach
    damage: 5,
    hitRadius: 0.3,       // wide grab radius
    hitStun: 0.3,
    knockback: 0.02,
    maxLifetime: 3.0,     // longer range travel
    color: new Color3(0.1, 0.8, 0.2),  // green vine
    size: 0.06,
    segments: 8,          // snake body segment count
    waveAmplitude: 0.08,  // side-to-side slither amount
    waveFrequency: 12,    // slither speed
  },
};

// Find parent bone for capsule segments
const boneParentMap = new Map<string, string>();
for (const bd of BONE_DEFS) {
  if (bd.parent) boneParentMap.set(bd.name, bd.parent);
}

function getBoneWorldPos(nodes: Map<string, TransformNode>, boneName: string): Vector3 | null {
  const node = nodes.get(boneName);
  if (!node) return null;
  return node.getAbsolutePosition();
}

/**
 * Minimum distance from a point to a line segment.
 */
function pointSegmentDist(
  point: Vector3, segStart: Vector3, segEnd: Vector3,
): { dist: number; closest: Vector3 } {
  const seg = segEnd.subtract(segStart);
  const lenSq = Vector3.Dot(seg, seg);
  if (lenSq <= 1e-8) {
    return { dist: Vector3.Distance(point, segStart), closest: segStart.clone() };
  }
  let t = Vector3.Dot(point.subtract(segStart), seg) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = segStart.add(seg.scale(t));
  return { dist: Vector3.Distance(point, closest), closest };
}

export class ProjectileSystem {
  private projectiles: Projectile[] = [];
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Spawn a new projectile from a fighter's position toward their facing direction */
  spawn(
    ownerIndex: number,
    x: number, y: number, z: number,
    facingAngle: number,
    defName: string,
  ): void {
    const def = PROJECTILE_DEFS[defName];
    if (!def) return;

    // Offset spawn point slightly in front of the fighter
    const spawnOffset = 0.3;
    const spawnX = x + Math.cos(facingAngle) * spawnOffset;
    const spawnZ = z + Math.sin(facingAngle) * spawnOffset;
    const spawnY = y + 0.25; // roughly chest height

    // Visual: glowing sphere (head)
    const ts = Date.now();
    const sphere = MeshBuilder.CreateSphere(`proj_${ts}`, { diameter: def.size * 2 }, this.scene);
    sphere.position.set(spawnX, spawnY, spawnZ);
    const mat = new StandardMaterial(`projMat_${ts}`, this.scene);
    mat.emissiveColor = def.color;
    mat.disableLighting = true;
    mat.alpha = 0.9;
    sphere.material = mat;
    sphere.isPickable = false;

    // Snake body segments (trailing spheres that follow the head)
    let segments: TransformNode[] | undefined;
    const posHistory: { x: number; y: number; z: number }[] = [];
    if (def.segments && def.segments > 0) {
      segments = [];
      for (let s = 0; s < def.segments; s++) {
        const segSize = def.size * 2 * (1 - s * 0.08); // gradually smaller
        const seg = MeshBuilder.CreateSphere(`projSeg_${ts}_${s}`, { diameter: segSize }, this.scene);
        seg.position.set(spawnX, spawnY, spawnZ);
        const segMat = new StandardMaterial(`projSegMat_${ts}_${s}`, this.scene);
        // Alternate slightly darker/lighter green for scale pattern
        const shade = s % 2 === 0 ? 1.0 : 0.7;
        segMat.emissiveColor = new Color3(def.color.r * shade, def.color.g * shade, def.color.b * shade);
        segMat.disableLighting = true;
        segMat.alpha = 0.85;
        seg.material = segMat;
        seg.isPickable = false;
        segments.push(seg);
        posHistory.push({ x: spawnX, y: spawnY, z: spawnZ });
      }
    }

    // Trailing particles (green mist for snake, normal trail for others)
    const ps = new ParticleSystem(`projPS_${ts}`, 40, this.scene);
    ps.createPointEmitter(Vector3.Zero(), Vector3.Zero());
    ps.emitter = sphere;
    ps.minSize = def.segments ? 0.01 : 0.02;
    ps.maxSize = def.segments ? 0.03 : 0.05;
    ps.minLifeTime = 0.1;
    ps.maxLifeTime = def.segments ? 0.15 : 0.25;
    ps.color1 = new Color4(def.color.r, def.color.g, def.color.b, 1);
    ps.color2 = new Color4(def.color.r * 0.5, def.color.g * 0.5, def.color.b * 0.5, 0.8);
    ps.colorDead = new Color4(0, 0, 0, 0);
    ps.minEmitPower = 0.05;
    ps.maxEmitPower = 0.15;
    ps.emitRate = def.segments ? 30 : 60;
    ps.gravity = Vector3.Zero();
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();

    this.projectiles.push({
      x: spawnX,
      z: spawnZ,
      y: spawnY,
      vx: Math.cos(facingAngle) * def.speed,
      vz: Math.sin(facingAngle) * def.speed,
      vy: 0,
      damage: def.damage,
      hitRadius: def.hitRadius,
      hitStun: def.hitStun,
      knockback: def.knockback,
      ownerIndex,
      lifetime: def.maxLifetime,
      mesh: sphere,
      particles: ps,
      defName,
      segments,
      elapsed: 0,
      waveAmplitude: def.waveAmplitude ?? 0,
      waveFrequency: def.waveFrequency ?? 0,
      posHistory: posHistory.length > 0 ? posHistory : undefined,
    });
  }

  /**
   * Update all projectiles: move, check collisions, despawn expired.
   * Returns array of hits that occurred this frame.
   */
  update(
    dt: number,
    defenderNodes: Map<string, TransformNode>,
    defenderOwnerIndex: number,
  ): ProjectileHitResult[] {
    const hits: ProjectileHitResult[] = [];

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      this.moveProjectile(p, dt);

      // Check collision only against the opponent
      if (defenderOwnerIndex !== p.ownerIndex) {
        const hitResult = this.checkProjectileHit(p, defenderNodes);
        if (hitResult) {
          hits.push({ ...hitResult, ownerIndex: p.ownerIndex });
          this.destroyProjectile(i);
          continue;
        }
      }

      // Despawn if expired
      if (p.lifetime <= 0) {
        this.destroyProjectile(i);
      }
    }

    return hits;
  }

  /**
   * Full update for 2-player fight: check each projectile against the correct defender.
   */
  updateAll(
    dt: number,
    p1Nodes: Map<string, TransformNode>,
    p2Nodes: Map<string, TransformNode>,
  ): ProjectileHitResult[] {
    const hits: ProjectileHitResult[] = [];

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      this.moveProjectile(p, dt);

      // Check collision against the opponent (projectile from P1 hits P2, and vice versa)
      const targetNodes = p.ownerIndex === 1 ? p2Nodes : p1Nodes;
      const hitResult = this.checkProjectileHit(p, targetNodes);
      if (hitResult) {
        hits.push({ ...hitResult, ownerIndex: p.ownerIndex, defName: p.defName });
        this.destroyProjectile(i);
        continue;
      }

      // Despawn if expired
      if (p.lifetime <= 0) {
        this.destroyProjectile(i);
      }
    }

    return hits;
  }

  /**
   * Team-based update: check each projectile against all alive fighters on the opposing team.
   * Returns hits with defenderTeam (1 or 2) and defenderIndex.
   */
  updateTeams(
    dt: number,
    team1NodesList: Map<string, TransformNode>[],
    team2NodesList: Map<string, TransformNode>[],
    team1Alive: boolean[],
    team2Alive: boolean[],
  ): (ProjectileHitResult & { defenderTeam: number; defenderIndex: number })[] {
    const hits: (ProjectileHitResult & { defenderTeam: number; defenderIndex: number })[] = [];

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      this.moveProjectile(p, dt);

      const targetNodes = p.ownerIndex === 1 ? team2NodesList : team1NodesList;
      const targetAlive = p.ownerIndex === 1 ? team2Alive : team1Alive;
      const defTeam = p.ownerIndex === 1 ? 2 : 1;

      let hitFound = false;
      for (let j = 0; j < targetNodes.length; j++) {
        if (!targetAlive[j]) continue;
        const hitResult = this.checkProjectileHit(p, targetNodes[j]);
        if (hitResult) {
          hits.push({ ...hitResult, ownerIndex: p.ownerIndex, defenderTeam: defTeam, defenderIndex: j });
          this.destroyProjectile(i);
          hitFound = true;
          break;
        }
      }

      if (!hitFound && p.lifetime <= 0) {
        this.destroyProjectile(i);
      }
    }

    return hits;
  }

  /** Check if a projectile sphere overlaps any defender hitzone */
  private checkProjectileHit(
    proj: Projectile,
    defenderNodes: Map<string, TransformNode>,
  ): Omit<ProjectileHitResult, 'ownerIndex'> | null {
    const projPos = new Vector3(proj.x, proj.y, proj.z);

    for (const hitzone of HITZONES) {
      for (const boneName of hitzone.bones) {
        const bonePos = getBoneWorldPos(defenderNodes, boneName);
        if (!bonePos) continue;

        // Build capsule segment for this bone
        const parentName = boneParentMap.get(boneName);
        let segStart = bonePos;
        let segEnd = bonePos;
        if (parentName) {
          const parentPos = getBoneWorldPos(defenderNodes, parentName);
          if (parentPos) {
            segStart = parentPos;
            segEnd = bonePos;
          }
        }

        const { dist, closest } = pointSegmentDist(projPos, segStart, segEnd);
        const threshold = proj.hitRadius + hitzone.radius;

        if (dist < threshold) {
          return {
            hit: true,
            damage: proj.damage * hitzone.damageMultiplier,
            hitStun: proj.hitStun,
            knockback: proj.knockback,
            hitPoint: closest,
            hitzoneName: hitzone.label,
            damageMultiplier: hitzone.damageMultiplier,
            defName: proj.defName,
          };
        }
      }
    }

    return null;
  }

  /** Move a projectile and update snake body segments */
  private moveProjectile(p: Projectile, dt: number): void {
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.y += p.vy * dt;
    p.lifetime -= dt;

    if (p.elapsed !== undefined) p.elapsed += dt;

    // Snake slither: offset head position perpendicular to velocity
    let displayX = p.x;
    let displayZ = p.z;
    if (p.waveAmplitude && p.waveFrequency && p.elapsed !== undefined) {
      const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
      if (speed > 0.01) {
        // Perpendicular direction to velocity
        const perpX = -p.vz / speed;
        const perpZ = p.vx / speed;
        const wave = Math.sin(p.elapsed * p.waveFrequency) * p.waveAmplitude;
        displayX = p.x + perpX * wave;
        displayZ = p.z + perpZ * wave;
      }
    }

    p.mesh.position.set(displayX, p.y, displayZ);

    // Update snake body: each segment follows the previous position with delay
    if (p.segments && p.posHistory) {
      // Push current head position to front of history
      p.posHistory.unshift({ x: displayX, y: p.y, z: displayZ });
      // Keep history length proportional to segments
      const maxHistory = p.segments.length * 3 + 1;
      if (p.posHistory.length > maxHistory) {
        p.posHistory.length = maxHistory;
      }
      // Position each segment at spaced intervals in the history
      for (let s = 0; s < p.segments.length; s++) {
        const histIdx = Math.min((s + 1) * 3, p.posHistory.length - 1);
        const h = p.posHistory[histIdx];
        p.segments[s].position.set(h.x, h.y, h.z);
      }
    }
  }

  private destroyProjectile(index: number): void {
    const p = this.projectiles[index];
    if (p.particles) {
      p.particles.stop();
      p.particles.dispose();
    }
    // Dispose snake body segments
    if (p.segments) {
      for (const seg of p.segments) {
        seg.dispose();
      }
    }
    p.mesh.dispose();
    this.projectiles.splice(index, 1);
  }

  /** Get active projectile count (for UI or debugging) */
  get count(): number {
    return this.projectiles.length;
  }

  /** Dispose all projectiles */
  dispose(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.destroyProjectile(i);
    }
  }
}
