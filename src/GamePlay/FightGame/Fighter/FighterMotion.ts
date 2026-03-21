/**
 * FighterMotion: manages motion playback per fighter with cross-fade blending.
 *
 * Each fighter has a "current" and optionally a "previous" motion.
 * During blend-in, both are evaluated and Slerp'd together.
 * When blend completes, previous is discarded.
 */

import { TransformNode, Vector3, Quaternion } from '@babylonjs/core';
import {
  BONE_DEFS, threeQuatToViewer, loadMotionClipFromFile,
} from '@/lib/voxel-skeleton';
import type { MotionClip } from '@/lib/voxel-skeleton';
import { getMotionForAction } from '@/GamePlay/FightGame/Config/MotionConfig';
import type { MotionDef } from '@/GamePlay/FightGame/Config/MotionConfig';
import type { CharacterGender } from '@/lib/model-registry';
import type { FighterState } from '@/GamePlay/FightGame/Fighter/Fighter';

interface ActiveMotion {
  clip: MotionClip;
  def: MotionDef;
  time: number;        // current playback time
}

// ====================================================================
// Procedural attack body overlay
// Adds upper-body twist, forward lean, and hip rotation during attacks
// so that the whole body drives into the strike.
// ====================================================================

interface AttackBodyTwist {
  /** Y-axis twist for Spine/Spine1/Spine2 (radians, negative = twist left/push right side forward) */
  spineTwistY: number;
  /** X-axis lean for Spine/Spine1/Spine2 (radians, positive = lean forward) */
  spineForwardX: number;
  /** Z-axis roll for Spine (radians, positive = lean right, negative = lean left) */
  spineRollZ: number;
  /** Y-axis twist for Hips (radians) */
  hipsTwistY: number;
  /** X-axis lean for Hips (radians, positive = lean forward) */
  hipsForwardX: number;
  /** Z-axis roll for Hips (radians, positive = lean right, negative = lean left) */
  hipsRollZ: number;
}

/** Per-attack procedural body twist configuration.
 *
 * Punches:  torso twists toward the punching arm and leans into it (side lean).
 *           Right punch → twist left + lean left (weight shifts into the punch).
 *           Left punch  → twist right + lean right.
 *
 * Kicks:    hips rotate to drive the kicking leg forward.
 *           Body leans away from the kicking leg for balance (counter-lean).
 *           Right kick → hips twist left, body leans left (away from right leg).
 *           Left kick  → hips twist right, body leans right.
 */
const ATTACK_BODY_TWIST: Record<string, AttackBodyTwist> = {
  // Right punches: twist left + lean left into the punch
  r_punch_upper:  { spineTwistY: -0.45, spineForwardX: 0.12, spineRollZ: -0.18, hipsTwistY: -0.15, hipsForwardX: 0.06, hipsRollZ: -0.08 },
  r_punch_mid:    { spineTwistY: -0.40, spineForwardX: 0.18, spineRollZ: -0.15, hipsTwistY: -0.12, hipsForwardX: 0.10, hipsRollZ: -0.06 },
  r_punch_lower:  { spineTwistY: -0.35, spineForwardX: 0.30, spineRollZ: -0.12, hipsTwistY: -0.10, hipsForwardX: 0.15, hipsRollZ: -0.05 },
  // Left punches: twist right + lean right into the punch
  l_punch_upper:  { spineTwistY:  0.45, spineForwardX: 0.12, spineRollZ:  0.18, hipsTwistY:  0.15, hipsForwardX: 0.06, hipsRollZ:  0.08 },
  l_punch_mid:    { spineTwistY:  0.40, spineForwardX: 0.18, spineRollZ:  0.15, hipsTwistY:  0.12, hipsForwardX: 0.10, hipsRollZ:  0.06 },
  l_punch_lower:  { spineTwistY:  0.35, spineForwardX: 0.30, spineRollZ:  0.12, hipsTwistY:  0.10, hipsForwardX: 0.15, hipsRollZ:  0.05 },
  // Right kicks: hips twist left, body counter-leans left (away from kicking leg)
  r_kick_upper:   { spineTwistY: -0.20, spineForwardX: -0.15, spineRollZ: -0.25, hipsTwistY: -0.35, hipsForwardX: 0.10, hipsRollZ: -0.20 },
  r_kick_mid:     { spineTwistY: -0.15, spineForwardX: 0.10,  spineRollZ: -0.20, hipsTwistY: -0.30, hipsForwardX: 0.12, hipsRollZ: -0.15 },
  r_kick_lower:   { spineTwistY: -0.10, spineForwardX: 0.20,  spineRollZ: -0.12, hipsTwistY: -0.25, hipsForwardX: 0.08, hipsRollZ: -0.10 },
  // Left kicks: mirrored — hips twist right, body counter-leans right
  l_kick_upper:   { spineTwistY:  0.20, spineForwardX: -0.15, spineRollZ:  0.25, hipsTwistY:  0.35, hipsForwardX: 0.10, hipsRollZ:  0.20 },
  l_kick_mid:     { spineTwistY:  0.15, spineForwardX: 0.10,  spineRollZ:  0.20, hipsTwistY:  0.30, hipsForwardX: 0.12, hipsRollZ:  0.15 },
  l_kick_lower:   { spineTwistY:  0.10, spineForwardX: 0.20,  spineRollZ:  0.12, hipsTwistY:  0.25, hipsForwardX: 0.08, hipsRollZ:  0.10 },
};

/**
 * Compute the overlay intensity [0..1] based on attack phase.
 * Ramps up during startup, full during active, ramps down during recovery.
 */
function getOverlayIntensity(fighter: FighterState): number {
  if (fighter.action !== 'attack' || !fighter.currentAttack) return 0;
  const timing = fighter.currentAttack.timing;
  const t = fighter.attackPhaseTimer;
  switch (fighter.attackPhase) {
    case 'startup':
      return Math.min(1, t / Math.max(0.01, timing.startup));
    case 'active':
      return 1;
    case 'recovery':
      return Math.max(0, 1 - t / Math.max(0.01, timing.recovery));
    default:
      return 0;
  }
}

export class FighterMotionPlayer {
  private current: ActiveMotion | null = null;
  private previous: ActiveMotion | null = null;
  private blendTimer = 0;
  private blendDuration = 0;
  private currentMotionKey = '';  // track which motion is playing to avoid redundant switches

  // Cache loaded clips
  private static clipCache = new Map<string, MotionClip>();
  private static loadingFiles = new Map<string, Promise<MotionClip | null>>();

  private gender: CharacterGender;
  private nodes: Map<string, TransformNode>;
  private boneRestPos: Map<string, Vector3>;
  private voxelBodyHeight: number;

  // Pre-allocated reusable objects for per-frame calculations
  private readonly _worldDqs = new Map<string, Quaternion>();
  private readonly _localRots = new Map<string, Quaternion>();
  private readonly _restRots = new Map<string, Quaternion>();
  private readonly _tempQuat = new Quaternion();
  private readonly _tempInvQuat = new Quaternion();
  private readonly _prevDp = new Vector3();
  private readonly _currDp = new Vector3();
  private readonly _overlayQuat = new Quaternion();

  constructor(
    nodes: Map<string, TransformNode>,
    boneRestPos: Map<string, Vector3>,
    voxelBodyHeight: number,
    gender: CharacterGender = 'male',
  ) {
    this.nodes = nodes;
    this.boneRestPos = boneRestPos;
    this.voxelBodyHeight = voxelBodyHeight;
    this.gender = gender;

    // Pre-populate maps with identity quaternions for each bone
    for (const boneDef of BONE_DEFS) {
      this._worldDqs.set(boneDef.name, new Quaternion());
      this._localRots.set(boneDef.name, new Quaternion());
      this._restRots.set(boneDef.name, Quaternion.Identity());
    }
  }

  /**
   * Update motion based on fighter state. Call every frame.
   * Handles automatic motion switching and blending.
   */
  async update(fighter: FighterState, dt: number): Promise<void> {
    // Determine desired motion
    const attackName = fighter.currentAttack?.name;
    const kdVariant = fighter.action === 'knockdown' ? fighter.knockdownVariant : undefined;
    const grappleKey = (fighter.action === 'grapple' || fighter.action === 'grappled')
      ? fighter.grappleMotionKey : undefined;
    const motionDef = getMotionForAction(fighter.action, attackName, kdVariant, grappleKey, this.gender);
    const motionKey = motionDef?.file
      ? `${motionDef.file}:${motionDef.speed}`
      : `action:${fighter.action}:${attackName ?? ''}:${kdVariant ?? ''}:${grappleKey ?? ''}`;

    // Switch motion if changed
    if (motionKey !== this.currentMotionKey) {
      this.currentMotionKey = motionKey;
      await this.switchMotion(motionDef);
    }

    // Advance time
    if (this.current) {
      const speed = Math.abs(this.current.def.speed);
      this.current.time += dt * speed;

      // Loop or clamp
      if (this.current.def.loop && this.current.clip) {
        this.current.time = this.current.time % this.current.clip.duration;
      } else if (this.current.clip) {
        this.current.time = Math.min(this.current.time, this.current.clip.duration - 0.001);
      }
    }

    if (this.previous) {
      const speed = Math.abs(this.previous.def.speed);
      this.previous.time += dt * speed;
    }

    // Advance blend
    if (this.blendDuration > 0) {
      this.blendTimer += dt;
      if (this.blendTimer >= this.blendDuration) {
        this.previous = null;
        this.blendDuration = 0;
        this.blendTimer = 0;
      }
    }

    // Apply to skeleton
    this.applyToSkeleton();

    // Procedural attack body overlay: twist torso and hips into the strike
    this.applyAttackBodyOverlay(fighter);

    // Floor clamp: prevent character from sinking below ground.
    // When lying flat, hips (body center) must be elevated by the body's
    // cross-section radius so the skin doesn't clip through the floor.
    const hipsNode = this.nodes.get('Hips');
    if (hipsNode) {
      const rootY = (hipsNode.parent instanceof TransformNode) ? hipsNode.parent.position.y : 0;
      // Body radius ≈ 20% of body height (torso thickness when lying down)
      const bodyRadius = this.voxelBodyHeight * 0.2;
      const minLocalY = bodyRadius - rootY;
      if (hipsNode.position.y < minLocalY) {
        hipsNode.position.y = minLocalY;
      }
    }
  }

  /**
   * Switch to a new motion with cross-fade.
   */
  private async switchMotion(motionDef: MotionDef | null): Promise<void> {
    // Save current as previous for blending
    if (this.current) {
      this.previous = this.current;
    }

    if (!motionDef || !motionDef.file) {
      this.current = null;
      this.blendDuration = motionDef?.blendIn ?? 0.2;
      this.blendTimer = 0;
      return;
    }

    const clip = await FighterMotionPlayer.loadClip(motionDef.file);
    if (!clip) {
      this.current = null;
      this.blendDuration = motionDef.blendIn;
      this.blendTimer = 0;
      return;
    }

    this.current = {
      clip,
      def: motionDef,
      time: motionDef.speed < 0 ? clip.duration : 0,
    };
    this.blendDuration = motionDef.blendIn;
    this.blendTimer = 0;
  }

  /**
   * Load a motion clip with caching and deduplication.
   */
  private static async loadClip(file: string): Promise<MotionClip | null> {
    if (FighterMotionPlayer.clipCache.has(file)) {
      return FighterMotionPlayer.clipCache.get(file)!;
    }

    // Deduplicate concurrent loads
    if (FighterMotionPlayer.loadingFiles.has(file)) {
      return FighterMotionPlayer.loadingFiles.get(file)!;
    }

    const promise = (async () => {
      try {
        const clip = await loadMotionClipFromFile(file, file, file);
        FighterMotionPlayer.clipCache.set(file, clip);
        return clip;
      } catch {
        return null;
      } finally {
        FighterMotionPlayer.loadingFiles.delete(file);
      }
    })();

    FighterMotionPlayer.loadingFiles.set(file, promise);
    return promise;
  }

  /**
   * Apply current (and optionally blended previous) motion to skeleton nodes.
   */
  private applyToSkeleton(): void {
    const hasCurrent = this.current?.clip;
    const hasPrevious = this.previous?.clip;
    const isBlending = this.blendDuration > 0 && hasPrevious;

    if (!hasCurrent && !hasPrevious) {
      // No motion: rest pose
      this.applyRestPose();
      return;
    }

    if (!hasCurrent && hasPrevious) {
      // Blending from previous to rest pose
      const t = Math.min(1, this.blendTimer / this.blendDuration);
      const prevRotations = this.evaluateClip(this.previous!);
      const restRotations = this.getRestRotations();
      this.applyBlendedRotations(prevRotations, restRotations, t);
      this.applyHipsPosition(this.previous!, 1 - t);
      return;
    }

    if (hasCurrent && !isBlending) {
      // Just current, no blend
      this.applyClipToNodes(this.current!);
      return;
    }

    // Blending previous → current
    const t = Math.min(1, this.blendTimer / this.blendDuration);
    const prevRotations = hasPrevious
      ? this.evaluateClip(this.previous!)
      : this.getRestRotations();
    const currRotations = this.evaluateClip(this.current!);
    this.applyBlendedRotations(prevRotations, currRotations, t);

    // Hips position: blend
    if (hasPrevious) {
      this.applyHipsPositionBlended(this.previous!, this.current!, t);
    } else {
      this.applyHipsPosition(this.current!, 1);
    }
  }

  /**
   * Evaluate a clip at its current time, returning per-bone local rotations.
   */
  private evaluateClip(active: ActiveMotion): Map<string, Quaternion> {
    const clip = active.clip;
    const frameDuration = 1.0 / clip.fps;
    let time = active.time;

    // Handle reverse playback
    if (active.def.speed < 0) {
      time = clip.duration - active.time;
    }

    const frameIndex = Math.min(
      Math.max(0, Math.floor(time / frameDuration)),
      clip.frameCount - 1,
    );
    const frame = clip.frames[frameIndex];
    if (!frame) return this._localRots;

    // Compute world dqs (reuse pre-allocated map)
    for (const boneDef of BONE_DEFS) {
      const data = frame[boneDef.name];
      const target = this._worldDqs.get(boneDef.name)!;
      if (data) {
        const q = threeQuatToViewer(data.dq);
        target.copyFrom(q);
      } else {
        target.copyFromFloats(0, 0, 0, 1); // Identity
      }
    }

    // Convert to local rotations (reuse pre-allocated map)
    for (const boneDef of BONE_DEFS) {
      const worldDq = this._worldDqs.get(boneDef.name)!;
      const localRot = this._localRots.get(boneDef.name)!;
      if (boneDef.parent) {
        const parentWorldDq = this._worldDqs.get(boneDef.parent)!;
        // Compute inverse in-place then multiply
        parentWorldDq.invertInPlace();
        parentWorldDq.multiplyToRef(worldDq, localRot);
        // Restore parentWorldDq (re-invert)
        parentWorldDq.invertInPlace();
      } else {
        localRot.copyFrom(worldDq);
      }
    }
    return this._localRots;
  }

  private getRestRotations(): Map<string, Quaternion> {
    return this._restRots;
  }

  private applyBlendedRotations(
    from: Map<string, Quaternion>,
    to: Map<string, Quaternion>,
    t: number,
  ): void {
    for (const boneDef of BONE_DEFS) {
      const node = this.nodes.get(boneDef.name);
      if (!node) continue;

      const fromQ = from.get(boneDef.name) ?? Quaternion.Identity();
      const toQ = to.get(boneDef.name) ?? Quaternion.Identity();
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = new Quaternion();
      }
      Quaternion.SlerpToRef(fromQ, toQ, t, node.rotationQuaternion);
    }
  }

  private applyClipToNodes(active: ActiveMotion): void {
    const clip = active.clip;
    const scaleFactor = clip.fbxBodyHeight > 0
      ? this.voxelBodyHeight / clip.fbxBodyHeight : 1;
    const voxelHipsPos = this.boneRestPos.get('Hips') ?? Vector3.Zero();

    const frameDuration = 1.0 / clip.fps;
    let time = active.time;
    if (active.def.speed < 0) time = clip.duration - active.time;

    const frameIndex = Math.min(
      Math.max(0, Math.floor(time / frameDuration)),
      clip.frameCount - 1,
    );
    const frame = clip.frames[frameIndex];
    if (!frame) return;

    // World dqs (reuse pre-allocated map)
    for (const boneDef of BONE_DEFS) {
      const data = frame[boneDef.name];
      const target = this._worldDqs.get(boneDef.name)!;
      if (data) {
        const q = threeQuatToViewer(data.dq);
        target.copyFrom(q);
      } else {
        target.copyFromFloats(0, 0, 0, 1);
      }
    }

    // Apply local rotations
    for (const boneDef of BONE_DEFS) {
      const node = this.nodes.get(boneDef.name);
      if (!node) continue;
      const worldDq = this._worldDqs.get(boneDef.name)!;
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = new Quaternion();
      }
      if (boneDef.parent) {
        const parentWorldDq = this._worldDqs.get(boneDef.parent)!;
        parentWorldDq.invertInPlace();
        parentWorldDq.multiplyToRef(worldDq, node.rotationQuaternion);
        parentWorldDq.invertInPlace();
      } else {
        node.rotationQuaternion.copyFrom(worldDq);
      }
    }

    // Hips dp
    const hipsData = frame['Hips'];
    const hipsNode = this.nodes.get('Hips');
    if (hipsNode && hipsData?.dp) {
      hipsNode.position.x = voxelHipsPos.x + (-hipsData.dp[0]) * scaleFactor;
      hipsNode.position.y = voxelHipsPos.y + hipsData.dp[1] * scaleFactor;
      hipsNode.position.z = voxelHipsPos.z + hipsData.dp[2] * scaleFactor;
    } else if (hipsNode) {
      hipsNode.position.copyFrom(voxelHipsPos);
    }
  }

  private applyHipsPosition(active: ActiveMotion, weight: number): void {
    const clip = active.clip;
    const scaleFactor = clip.fbxBodyHeight > 0
      ? this.voxelBodyHeight / clip.fbxBodyHeight : 1;
    const voxelHipsPos = this.boneRestPos.get('Hips') ?? Vector3.Zero();

    const frameDuration = 1.0 / clip.fps;
    let time = active.time;
    if (active.def.speed < 0) time = clip.duration - active.time;

    const frameIndex = Math.min(
      Math.max(0, Math.floor(time / frameDuration)),
      clip.frameCount - 1,
    );
    const frame = clip.frames[frameIndex];
    const hipsData = frame?.['Hips'];
    const hipsNode = this.nodes.get('Hips');

    if (hipsNode && hipsData?.dp) {
      const dx = (-hipsData.dp[0]) * scaleFactor * weight;
      const dy = hipsData.dp[1] * scaleFactor * weight;
      const dz = hipsData.dp[2] * scaleFactor * weight;
      hipsNode.position.x = voxelHipsPos.x + dx;
      hipsNode.position.y = voxelHipsPos.y + dy;
      hipsNode.position.z = voxelHipsPos.z + dz;
    } else if (hipsNode) {
      hipsNode.position.copyFrom(voxelHipsPos);
    }
  }

  private applyHipsPositionBlended(prev: ActiveMotion, curr: ActiveMotion, t: number): void {
    const voxelHipsPos = this.boneRestPos.get('Hips') ?? Vector3.Zero();
    const hipsNode = this.nodes.get('Hips');
    if (!hipsNode) return;

    const fillHipsDp = (active: ActiveMotion, out: Vector3): void => {
      const clip = active.clip;
      const sf = clip.fbxBodyHeight > 0 ? this.voxelBodyHeight / clip.fbxBodyHeight : 1;
      const fd = 1.0 / clip.fps;
      let time = active.time;
      if (active.def.speed < 0) time = clip.duration - active.time;
      const fi = Math.min(Math.max(0, Math.floor(time / fd)), clip.frameCount - 1);
      const frame = clip.frames[fi];
      const hd = frame?.['Hips'];
      if (hd?.dp) {
        out.set((-hd.dp[0]) * sf, hd.dp[1] * sf, hd.dp[2] * sf);
      } else {
        out.set(0, 0, 0);
      }
    };

    fillHipsDp(prev, this._prevDp);
    fillHipsDp(curr, this._currDp);
    const it = 1 - t;
    hipsNode.position.x = voxelHipsPos.x + this._prevDp.x * it + this._currDp.x * t;
    hipsNode.position.y = voxelHipsPos.y + this._prevDp.y * it + this._currDp.y * t;
    hipsNode.position.z = voxelHipsPos.z + this._prevDp.z * it + this._currDp.z * t;
  }

  private applyRestPose(): void {
    for (const boneDef of BONE_DEFS) {
      const node = this.nodes.get(boneDef.name);
      if (!node) continue;
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = new Quaternion();
      }
      node.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
      if (!boneDef.parent) {
        const rest = this.boneRestPos.get(boneDef.name);
        if (rest) node.position.copyFrom(rest);
      } else {
        const bonePos = this.boneRestPos.get(boneDef.name);
        const parentPos = this.boneRestPos.get(boneDef.parent);
        if (bonePos && parentPos) {
          node.position.set(
            bonePos.x - parentPos.x,
            bonePos.y - parentPos.y,
            bonePos.z - parentPos.z,
          );
        }
      }
    }
  }

  /**
   * Apply procedural body twist during attacks.
   * Adds rotation to Spine, Spine1, Spine2 and Hips
   * based on attack type and phase progress.
   */
  private applyAttackBodyOverlay(fighter: FighterState): void {
    if (fighter.action !== 'attack' || !fighter.currentAttack) return;

    const twist = ATTACK_BODY_TWIST[fighter.currentAttack.name];
    if (!twist) return;

    const intensity = getOverlayIntensity(fighter);
    if (intensity <= 0) return;

    // Smooth ease-in-out for more natural feel
    const eased = intensity < 0.5
      ? 2 * intensity * intensity
      : 1 - 2 * (1 - intensity) * (1 - intensity);

    // Apply twist to spine bones (distributed across Spine, Spine1, Spine2)
    const spineBones = ['Spine', 'Spine1', 'Spine2'];
    const spineWeights = [0.25, 0.35, 0.40]; // more twist at upper spine

    for (let i = 0; i < spineBones.length; i++) {
      const node = this.nodes.get(spineBones[i]);
      if (!node) continue;

      const w = spineWeights[i];
      const twistY = twist.spineTwistY * w * eased;
      const leanX = twist.spineForwardX * w * eased;
      const rollZ = twist.spineRollZ * w * eased;

      // Create overlay rotation: lean forward (X), twist (Y), side lean (Z)
      Quaternion.RotationYawPitchRollToRef(twistY, leanX, rollZ, this._overlayQuat);
      if (node.rotationQuaternion) {
        node.rotationQuaternion.multiplyInPlace(this._overlayQuat);
      }
    }

    // Apply twist to Hips
    const hipsNode = this.nodes.get('Hips');
    if (hipsNode) {
      const hipTwistY = twist.hipsTwistY * eased;
      const hipLeanX = twist.hipsForwardX * eased;
      const hipRollZ = twist.hipsRollZ * eased;
      Quaternion.RotationYawPitchRollToRef(hipTwistY, hipLeanX, hipRollZ, this._overlayQuat);
      if (hipsNode.rotationQuaternion) {
        hipsNode.rotationQuaternion.multiplyInPlace(this._overlayQuat);
      }
    }
  }
}
