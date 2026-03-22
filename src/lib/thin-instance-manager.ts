/**
 * Thin Instance Manager for mass-combat rendering.
 * Reduces 108 fighters × 11 meshes = ~1200 draw calls → ~19 draw calls
 * by using Babylon.js thin instances with per-instance color.
 */
import {
  Scene, TransformNode, Mesh, MeshBuilder, Matrix, Vector3,
  Color3, StandardMaterial, ShaderMaterial, Effect,
} from '@babylonjs/core';
import { BODY_PART_DEFS, BONES, applyPose, type PoseData } from './weapon-combat-engine';

// ─── Ghost Rig (TransformNodes only, no meshes) ─────────

export interface GhostRig {
  root: TransformNode;
  bones: Map<string, TransformNode>;
  weaponAttachR: TransformNode;
}

/** Bone parent hierarchy (child → parent) */
const BONE_PARENTS: Record<string, string | null> = {
  hips: null, torso: 'hips', head: 'torso',
  leftArm: 'torso', rightArm: 'torso',
  leftHand: 'leftArm', rightHand: 'rightArm',
  leftLeg: 'hips', rightLeg: 'hips',
  leftFoot: 'leftLeg', rightFoot: 'rightLeg',
};

export function buildGhostRig(scene: Scene, prefix: string): GhostRig {
  const root = new TransformNode(`${prefix}_root`, scene);
  const bones = new Map<string, TransformNode>();

  for (const boneName of BONES) {
    const node = new TransformNode(`${prefix}_${boneName}`, scene);
    const parentName = BONE_PARENTS[boneName];
    node.parent = parentName ? bones.get(parentName)! : root;
    bones.set(boneName, node);
  }

  const rHand = bones.get('rightHand')!;
  const weaponAttachR = new TransformNode(`${prefix}_weaponR`, scene);
  weaponAttachR.parent = rHand;
  weaponAttachR.position.set(0, -0.08, 0.05);

  return { root, bones, weaponAttachR };
}

export function applyPoseToGhostRig(rig: GhostRig, pose: PoseData) {
  for (const [name, bp] of Object.entries(pose)) {
    const bone = rig.bones.get(name);
    if (!bone) continue;
    bone.position.set(bp.pos[0], bp.pos[1], bp.pos[2]);
    bone.rotation.set(bp.rot[0], bp.rot[1], bp.rot[2]);
  }
}

// ─── Per-instance color shader ───────────────────────────

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 instanceColor;

// Thin instance world matrix (provided by Babylon.js as mat4 from buffer)
attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;
varying vec3 vNormal;
varying vec4 vColor;
void main() {
  mat4 finalWorld = mat4(world0, world1, world2, world3);
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
  vNormal = (finalWorld * vec4(normal, 0.0)).xyz;
  vColor = instanceColor;
}
`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec3 vNormal;
varying vec4 vColor;
void main() {
  vec3 lightDir = normalize(vec3(-1.0, 2.0, -1.0));
  float ndl = max(dot(normalize(vNormal), lightDir), 0.0);
  float light = 0.4 + 0.6 * ndl;
  gl_FragColor = vec4(vColor.rgb * light, vColor.a);
}
`;

function createInstanceColorMaterial(scene: Scene, name: string): ShaderMaterial {
  if (!Effect.ShadersStore['instanceColorVertexShader']) {
    Effect.ShadersStore['instanceColorVertexShader'] = VERTEX_SHADER;
    Effect.ShadersStore['instanceColorFragmentShader'] = FRAGMENT_SHADER;
  }
  const mat = new ShaderMaterial(name, scene, {
    vertex: 'instanceColor',
    fragment: 'instanceColor',
  }, {
    attributes: ['position', 'normal', 'instanceColor', 'world0', 'world1', 'world2', 'world3'],
    uniforms: ['viewProjection'],
    defines: ['#define THIN_INSTANCES'],
  });
  mat.backFaceCulling = true;
  return mat;
}

// ─── Thin Instance Manager ───────────────────────────────

export interface ThinInstanceManager {
  baseMeshes: Map<string, Mesh>;
  weaponBaseMeshes: Map<string, { mesh: Mesh; rotationMatrix: Matrix | null }>;
  ghostRigs: GhostRig[];
  matrixBuffers: Map<string, Float32Array>;
  colorBuffers: Map<string, Float32Array>;
  maxInstances: number;
  fighterColors: Color3[];
}

export function createThinInstanceManager(
  scene: Scene,
  maxInstances: number,
  fighterColors: Color3[],
): ThinInstanceManager {
  const baseMeshes = new Map<string, Mesh>();
  const matrixBuffers = new Map<string, Float32Array>();
  const colorBuffers = new Map<string, Float32Array>();

  // color material for non-skin parts
  const colorMat = createInstanceColorMaterial(scene, 'thinColorMat');

  // skin material (fixed color, also use instance color shader with same color)
  const skinMat = createInstanceColorMaterial(scene, 'thinSkinMat');

  // Create one base mesh per body part type
  for (const def of BODY_PART_DEFS) {
    const mesh = MeshBuilder.CreateBox(`base_${def.name}`, {
      width: def.w, height: def.h, depth: def.d,
    }, scene);
    mesh.material = def.skin ? skinMat : colorMat;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceCount = 0;
    baseMeshes.set(def.name, mesh);

    matrixBuffers.set(def.name, new Float32Array(maxInstances * 16));
    colorBuffers.set(def.name, new Float32Array(maxInstances * 4));
  }

  // LOD proxy base mesh
  const lodMesh = MeshBuilder.CreateBox('base_lod', {
    width: 0.3, height: 1.2, depth: 0.2,
  }, scene);
  lodMesh.material = colorMat;
  lodMesh.isPickable = false;
  lodMesh.doNotSyncBoundingInfo = true;
  lodMesh.thinInstanceCount = 0;
  baseMeshes.set('_lod', lodMesh);
  matrixBuffers.set('_lod', new Float32Array(maxInstances * 16));
  colorBuffers.set('_lod', new Float32Array(maxInstances * 4));

  return {
    baseMeshes,
    weaponBaseMeshes: new Map(),
    ghostRigs: [],
    matrixBuffers,
    colorBuffers,
    maxInstances,
    fighterColors,
  };
}

/** Register a weapon type for thin instance rendering */
export function registerWeaponBase(
  manager: ThinInstanceManager,
  weaponId: string,
  mesh: Mesh,
) {
  // extract weapon's local rotation as a matrix
  let rotationMatrix: Matrix | null = null;
  if (mesh.rotationQuaternion) {
    rotationMatrix = new Matrix();
    mesh.rotationQuaternion.toRotationMatrix(rotationMatrix);
  }
  // clone mesh as base, hide original
  const base = mesh.clone(`base_wpn_${weaponId}`, null)!;
  if (mesh.rotationQuaternion) {
    base.rotationQuaternion = null;
    base.rotation.set(0, 0, 0);
  }
  base.position.set(0, 0, 0);
  base.scaling.setAll(1);
  base.isPickable = false;
  base.doNotSyncBoundingInfo = true;
  base.thinInstanceCount = 0;
  mesh.setEnabled(false);

  manager.weaponBaseMeshes.set(weaponId, { mesh: base, rotationMatrix });
  manager.matrixBuffers.set(`wpn_${weaponId}`, new Float32Array(manager.maxInstances * 16));
}

// Skin color constant
const SKIN_R = 0.9, SKIN_G = 0.75, SKIN_B = 0.6;

// temp matrices to avoid allocation
const _tmpWorldMat = Matrix.Identity();
const _tmpRotMat = Matrix.Identity();
const _tmpScaleMat = Matrix.Identity();
const _tmpFinalMat = Matrix.Identity();

/** Per-frame update: compute world matrices and push to thin instance buffers */
export function updateThinInstances(
  manager: ThinInstanceManager,
  fighters: { posX: number; posZ: number; alive: boolean; koTimer: number; targetId: number | null; weapon: { id: string; meshScale: number } }[],
  lodLevels: (0 | 1 | 2)[],
  koFadeTime: number,
  allFighters: typeof fighters,
) {
  const { baseMeshes, weaponBaseMeshes, ghostRigs, matrixBuffers, colorBuffers, fighterColors } = manager;

  // Reset counts
  const counts = new Map<string, number>();
  for (const key of baseMeshes.keys()) counts.set(key, 0);
  for (const key of weaponBaseMeshes.keys()) counts.set(`wpn_${key}`, 0);

  const totalFighters = fighters.length;

  for (let i = 0; i < totalFighters; i++) {
    const f = fighters[i];
    const lod = lodLevels[i];
    if (lod === 2) continue;
    if (!f.alive && f.koTimer > koFadeTime) continue;

    const rig = ghostRigs[i];
    const color = fighterColors[i];

    // force world matrix computation on root (cascades to children)
    rig.root.computeWorldMatrix(true);

    if (lod === 0) {
      // Near LOD: full skeleton
      for (const def of BODY_PART_DEFS) {
        const bone = rig.bones.get(def.name)!;
        const wm = bone.getWorldMatrix();
        const partKey = def.name;
        const idx = counts.get(partKey)!;
        const mb = matrixBuffers.get(partKey)!;
        wm.copyToArray(mb, idx * 16);

        const cb = colorBuffers.get(partKey)!;
        if (def.skin) {
          cb[idx * 4 + 0] = SKIN_R;
          cb[idx * 4 + 1] = SKIN_G;
          cb[idx * 4 + 2] = SKIN_B;
        } else {
          cb[idx * 4 + 0] = color.r;
          cb[idx * 4 + 1] = color.g;
          cb[idx * 4 + 2] = color.b;
        }
        cb[idx * 4 + 3] = 1.0;
        counts.set(partKey, idx + 1);
      }

      // Weapon thin instance
      const wpnEntry = weaponBaseMeshes.get(f.weapon.id);
      if (wpnEntry) {
        const wpnKey = `wpn_${f.weapon.id}`;
        const idx = counts.get(wpnKey)!;
        const mb = matrixBuffers.get(wpnKey)!;

        // weapon world matrix = attachPoint world matrix × weapon local rotation × scale
        const attachWm = rig.weaponAttachR.getWorldMatrix();
        if (wpnEntry.rotationMatrix) {
          Matrix.ScalingToRef(f.weapon.meshScale, f.weapon.meshScale, f.weapon.meshScale, _tmpScaleMat);
          wpnEntry.rotationMatrix.multiplyToRef(_tmpScaleMat, _tmpRotMat);
          _tmpRotMat.multiplyToRef(attachWm, _tmpFinalMat);
          _tmpFinalMat.copyToArray(mb, idx * 16);
        } else {
          attachWm.copyToArray(mb, idx * 16);
        }
        counts.set(wpnKey, idx + 1);
      }
    } else {
      // Mid LOD: single proxy box at fighter position
      const lodKey = '_lod';
      const idx = counts.get(lodKey)!;
      const mb = matrixBuffers.get(lodKey)!;

      // face target
      let rotY = 0;
      if (f.targetId !== null && allFighters[f.targetId]) {
        const tgt = allFighters[f.targetId];
        rotY = Math.atan2(tgt.posX - f.posX, tgt.posZ - f.posZ);
      }
      Matrix.RotationYToRef(rotY, _tmpRotMat);
      _tmpRotMat.setTranslation(new Vector3(f.posX, 0.8, f.posZ));
      _tmpRotMat.copyToArray(mb, idx * 16);

      const cb = colorBuffers.get(lodKey)!;
      cb[idx * 4 + 0] = color.r;
      cb[idx * 4 + 1] = color.g;
      cb[idx * 4 + 2] = color.b;
      cb[idx * 4 + 3] = 1.0;
      counts.set(lodKey, idx + 1);
    }
  }

  // flush to GPU
  for (const [key, mesh] of baseMeshes) {
    const count = counts.get(key) ?? 0;
    if (count === 0) {
      mesh.thinInstanceCount = 0;
      continue;
    }
    mesh.thinInstanceSetBuffer('matrix', matrixBuffers.get(key)!.subarray(0, count * 16), 16, false);
    mesh.thinInstanceSetBuffer('color', colorBuffers.get(key)!.subarray(0, count * 4), 4, false);
    mesh.thinInstanceCount = count;
  }

  for (const [weaponId, entry] of weaponBaseMeshes) {
    const wpnKey = `wpn_${weaponId}`;
    const count = counts.get(wpnKey) ?? 0;
    if (count === 0) {
      entry.mesh.thinInstanceCount = 0;
      continue;
    }
    entry.mesh.thinInstanceSetBuffer('matrix', matrixBuffers.get(wpnKey)!.subarray(0, count * 16), 16, false);
    entry.mesh.thinInstanceCount = count;
  }
}

/** Dispose all managed resources */
export function disposeThinInstanceManager(manager: ThinInstanceManager) {
  for (const mesh of manager.baseMeshes.values()) mesh.dispose();
  for (const entry of manager.weaponBaseMeshes.values()) entry.mesh.dispose();
  for (const rig of manager.ghostRigs) rig.root.dispose();
}
