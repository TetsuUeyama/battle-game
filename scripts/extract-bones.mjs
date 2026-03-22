/**
 * Extract bone hierarchy from Mixamo FBX file → JSON
 *
 * Usage: node scripts/extract-bones.mjs
 *
 * Reads: public/Y Bot.fbx
 * Writes: public/bone-data.json
 */
import { readFileSync, writeFileSync } from 'fs';
import { parseBinary, parseText } from 'fbx-parser';

const FBX_PATH = 'public/Y Bot.fbx';
const OUT_PATH = 'public/bone-data.json';

// ─── Parse FBX ───────────────────────────────────────────

let fbx;
try {
  fbx = parseBinary(readFileSync(FBX_PATH));
} catch {
  fbx = parseText(readFileSync(FBX_PATH, 'utf-8'));
}

function findNode(nodes, name) {
  if (!nodes || !Array.isArray(nodes)) return undefined;
  return nodes.find(n => n.name === name);
}

// Debug: print top-level structure
console.log('FBX top-level keys:', Object.keys(fbx));
if (Array.isArray(fbx)) {
  console.log('FBX is array, first items:', fbx.slice(0, 3).map(n => n.name ?? n));
} else if (fbx.nodes) {
  console.log('FBX.nodes names:', fbx.nodes.map(n => n.name));
} else {
  console.log('FBX structure:', JSON.stringify(fbx).slice(0, 500));
}

// ─── Extract GlobalSettings ──────────────────────────────

// Handle both fbx.nodes and fbx as array
const topNodes = fbx.nodes ?? (Array.isArray(fbx) ? fbx : []);
const globalSettings = findNode(topNodes, 'GlobalSettings');
const gsProps = findNode(globalSettings?.nodes ?? [], 'Properties70');
let upAxis = 1; // default Y-up
let upAxisSign = 1;
let frontAxis = 2;
let frontAxisSign = 1;
let unitScaleFactor = 1;

if (gsProps) {
  for (const p of gsProps.nodes) {
    if (p.props[0] === 'UpAxis') upAxis = Number(p.props[4]);
    if (p.props[0] === 'UpAxisSign') upAxisSign = Number(p.props[4]);
    if (p.props[0] === 'FrontAxis') frontAxis = Number(p.props[4]);
    if (p.props[0] === 'FrontAxisSign') frontAxisSign = Number(p.props[4]);
    if (p.props[0] === 'UnitScaleFactor') unitScaleFactor = Number(p.props[4]);
  }
}

console.log('GlobalSettings:', { upAxis, upAxisSign, frontAxis, frontAxisSign, unitScaleFactor });

// ─── Extract Objects (Models) ────────────────────────────

const objects = findNode(topNodes, 'Objects');
if (!objects) throw new Error('No Objects node in FBX');

// Collect all Model nodes (bones are Model nodes with type "LimbNode" or "Null")
const models = new Map(); // id → { name, type, props }
for (const node of objects.nodes) {
  if (node.name === 'Model') {
    const id = Number(node.props[0]);
    const rawName = String(node.props[1]);
    // FBX names are like "mixamorig:Hips\x00\x01Model"
    const name = rawName.split('\x00')[0].replace('Model::', '');
    const type = String(node.props[2]);

    // Extract properties (Lcl Translation, Lcl Rotation, Lcl Scaling)
    const props70 = findNode(node.nodes, 'Properties70');
    const lclTranslation = [0, 0, 0];
    const lclRotation = [0, 0, 0];
    const lclScaling = [1, 1, 1];
    const preRotation = [0, 0, 0];

    if (props70) {
      for (const p of props70.nodes) {
        const propName = String(p.props[0]);
        if (propName === 'Lcl Translation') {
          lclTranslation[0] = Number(p.props[4]);
          lclTranslation[1] = Number(p.props[5]);
          lclTranslation[2] = Number(p.props[6]);
        } else if (propName === 'Lcl Rotation') {
          lclRotation[0] = Number(p.props[4]);
          lclRotation[1] = Number(p.props[5]);
          lclRotation[2] = Number(p.props[6]);
        } else if (propName === 'Lcl Scaling') {
          lclScaling[0] = Number(p.props[4]);
          lclScaling[1] = Number(p.props[5]);
          lclScaling[2] = Number(p.props[6]);
        } else if (propName === 'PreRotation') {
          preRotation[0] = Number(p.props[4]);
          preRotation[1] = Number(p.props[5]);
          preRotation[2] = Number(p.props[6]);
        }
      }
    }

    models.set(id, { name, type, lclTranslation, lclRotation, lclScaling, preRotation });
  }
}

console.log(`Found ${models.size} Model nodes`);

// ─── Extract Connections (parent-child) ──────────────────

const connections = findNode(topNodes, 'Connections');
if (!connections) throw new Error('No Connections node in FBX');

// childId → [parentId, parentId, ...] (multiple connections per child)
const parentMultiMap = new Map();
for (const c of connections.nodes) {
  const type = String(c.props[0]);
  if (type === 'OO') {
    const childId = Number(c.props[1]);
    const parentId = Number(c.props[2]);
    if (!parentMultiMap.has(childId)) parentMultiMap.set(childId, []);
    parentMultiMap.get(childId).push(parentId);
  }
}

// Build model-to-model parent map (only where parent is a Model node)
const modelIds = new Set(models.keys());
const parentMap = new Map();
for (const [childId, parentIds] of parentMultiMap) {
  // Find the parent that is a Model (bone), not a NodeAttribute or other object
  const modelParent = parentIds.find(pid => modelIds.has(pid));
  if (modelParent !== undefined) {
    parentMap.set(childId, modelParent);
  } else if (parentIds.includes(0)) {
    parentMap.set(childId, 0); // scene root
  }
}
console.log(`Model→Model connections: ${parentMap.size}`);

// ─── Build bone hierarchy ────────────────────────────────

// Filter to only skeleton bones (LimbNode, Root, Null types that have mixamorig in name)
const bones = [];
const boneIdToIndex = new Map();

for (const [id, model] of models) {
  // Include bones: LimbNode, Root, or Null types with mixamorig prefix
  if (model.name.startsWith('mixamorig:') ||
      model.type === 'LimbNode' ||
      model.type === 'Root') {
    const index = bones.length;
    boneIdToIndex.set(id, index);
    bones.push({
      id,
      name: model.name,
      type: model.type,
      localPosition: model.lclTranslation,
      localRotation: model.lclRotation,   // Euler degrees (XYZ)
      localScaling: model.lclScaling,
      preRotation: model.preRotation,      // Pre-rotation (degrees)
      parentIndex: -1, // filled below
    });
  }
}

// Resolve parent indices
// FBX connections may chain through intermediate nodes (Armature, etc.)
// Follow the chain until we find a bone or reach root (0)
for (const bone of bones) {
  let currentId = parentMap.get(bone.id);
  let depth = 0;
  while (currentId !== undefined && currentId !== 0 && depth < 20) {
    if (boneIdToIndex.has(currentId)) {
      bone.parentIndex = boneIdToIndex.get(currentId);
      break;
    }
    // Follow the chain up
    currentId = parentMap.get(currentId);
    depth++;
  }
  if (bone.parentIndex < 0 && bone.name !== 'mixamorig:Hips') {
    // Debug: show what the parentId chain looks like
    let chain = [];
    let id = parentMap.get(bone.id);
    for (let i = 0; i < 5 && id !== undefined && id !== 0; i++) {
      const m = models.get(id);
      chain.push(m ? `${m.name}(${id})` : `unknown(${id})`);
      id = parentMap.get(id);
    }
    console.log(`  WARN: ${bone.name} no bone parent found. Chain: ${chain.join(' → ')}`);
  }
}

console.log(`Extracted ${bones.length} bones:`);
for (const bone of bones) {
  const parentName = bone.parentIndex >= 0 ? bones[bone.parentIndex].name : 'ROOT';
  console.log(`  ${bone.name} [${bone.type}] parent=${parentName} pos=(${bone.localPosition.map(v => v.toFixed(2)).join(', ')})`);
}

// ─── Compute world positions ─────────────────────────────

// Simple world position computation (translation-only, ignoring rotation for position)
// This gives approximate world positions for verification
function degToRad(d) { return d * Math.PI / 180; }

function eulerToMatrix(rx, ry, rz) {
  // FBX eEulerXYZ: intrinsic X→Y→Z = matrix Rz * Ry * Rx
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz*cy,  cz*sx*sy - sz*cx,  cz*cx*sy + sz*sx,
    sz*cy,  sz*sx*sy + cz*cx,  sz*cx*sy - cz*sx,
    -sy,    sx*cy,             cx*cy,
  ];
}

function mulMat3Vec(m, v) {
  return [
    m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
    m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
    m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
  ];
}

function mulMat3(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j];
    }
  }
  return r;
}

// Compute world transforms
const worldPositions = [];
const worldRotations = []; // rotation matrices

for (const bone of bones) {
  const preRot = eulerToMatrix(
    degToRad(bone.preRotation[0]),
    degToRad(bone.preRotation[1]),
    degToRad(bone.preRotation[2]),
  );
  const lclRot = eulerToMatrix(
    degToRad(bone.localRotation[0]),
    degToRad(bone.localRotation[1]),
    degToRad(bone.localRotation[2]),
  );
  // Local rotation = PreRotation * LclRotation
  const localRot = mulMat3(preRot, lclRot);
  const localPos = bone.localPosition;

  if (bone.parentIndex < 0) {
    // Root bone
    worldPositions.push([...localPos]);
    worldRotations.push(localRot);
  } else {
    const parentWorldPos = worldPositions[bone.parentIndex];
    const parentWorldRot = worldRotations[bone.parentIndex];
    // worldPos = parentWorldPos + parentWorldRot * localPos
    const rotatedLocal = mulMat3Vec(parentWorldRot, localPos);
    worldPositions.push([
      parentWorldPos[0] + rotatedLocal[0],
      parentWorldPos[1] + rotatedLocal[1],
      parentWorldPos[2] + rotatedLocal[2],
    ]);
    worldRotations.push(mulMat3(parentWorldRot, localRot));
  }
}

// ─── Apply coordinate system correction ──────────────────

// Convert from FBX coordinate system to Y-up meters
// upAxis: 0=X, 1=Y, 2=Z
function convertPosition(pos) {
  const scale = unitScaleFactor / 100; // FBX unitScale to meters (usually 1cm → 0.01m)
  let x = pos[0] * scale;
  let y = pos[1] * scale;
  let z = pos[2] * scale;

  if (upAxis === 2) {
    // Z-up → Y-up: swap Y and Z
    return [x, z * upAxisSign, -y * upAxisSign];
  } else if (upAxis === 0) {
    // X-up → Y-up: swap X and Y
    return [y, x * upAxisSign, z];
  }
  // Already Y-up
  return [x, y * upAxisSign, z];
}

console.log('\nWorld positions (converted to Y-up meters):');
const outputBones = bones.map((bone, i) => {
  const wp = convertPosition(worldPositions[i]);
  const parentName = bone.parentIndex >= 0 ? bones[bone.parentIndex].name : null;
  console.log(`  ${bone.name}: (${wp[0].toFixed(4)}, ${wp[1].toFixed(4)}, ${wp[2].toFixed(4)})`);

  // Remove internal id from output, clean up
  return {
    name: bone.name,
    parent: parentName,
    localPosition: bone.localPosition,
    localRotation: bone.localRotation,
    localScaling: bone.localScaling,
    preRotation: bone.preRotation,
    worldPosition: wp,
  };
});

// ─── Write output ────────────────────────────────────────

const output = {
  source: FBX_PATH,
  globalSettings: { upAxis, upAxisSign, frontAxis, frontAxisSign, unitScaleFactor },
  bones: outputBones,
};

writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
console.log(`\nWritten ${OUT_PATH} (${outputBones.length} bones)`);
