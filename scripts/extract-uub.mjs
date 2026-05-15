/**
 * Extract bone hierarchy + animation from FBX (Kevin Iglesias rig).
 *
 * Usage:
 *   node scripts/extract-uub.mjs bones <fbx-path> <out-json>
 *   node scripts/extract-uub.mjs motion <fbx-path> <out-json>
 *   node scripts/extract-uub.mjs mesh <fbx-path> <out-json>
 *
 * Examples:
 *   node scripts/extract-uub.mjs bones public/uub/HumanM_Model.fbx public/uub-data/bone-data-humanM.json
 *   node scripts/extract-uub.mjs motion public/uub/animations/HumanM@Idle01.fbx public/uub-data/motions/HumanM@Idle01.json
 *   node scripts/extract-uub.mjs mesh public/uub/HumanM_Model.fbx public/uub-data/mesh-humanM.json
 *
 * Output coordinate system:
 *   Positions converted to Y-up meters. Handedness (RH→LH) is NOT applied here
 *   — leave that for the runtime (motion-converter or Babylon page).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { parseBinary, parseText } from 'fbx-parser';

const [, , mode, fbxPath, outPath] = process.argv;
if (!mode || !fbxPath || !outPath) {
  console.error('Usage: node extract-uub.mjs <bones|motion> <fbx-path> <out-json>');
  process.exit(1);
}

// ─── Parse FBX ───────────────────────────────────────────
let fbx;
try { fbx = parseBinary(readFileSync(fbxPath)); }
catch { fbx = parseText(readFileSync(fbxPath, 'utf-8')); }

const findNode = (nodes, name) => nodes?.find(n => n.name === name);
const findAll = (nodes, name) => (nodes ?? []).filter(n => n.name === name);
const topNodes = fbx.nodes ?? (Array.isArray(fbx) ? fbx : []);

// ─── GlobalSettings ──────────────────────────────────────
const gs = { upAxis: 1, upAxisSign: 1, frontAxis: 2, frontAxisSign: 1, unitScaleFactor: 1 };
const gsProps = findNode(findNode(topNodes, 'GlobalSettings')?.nodes ?? [], 'Properties70');
if (gsProps) {
  for (const p of gsProps.nodes) {
    const k = p.props[0];
    if (k === 'UpAxis') gs.upAxis = Number(p.props[4]);
    else if (k === 'UpAxisSign') gs.upAxisSign = Number(p.props[4]);
    else if (k === 'FrontAxis') gs.frontAxis = Number(p.props[4]);
    else if (k === 'FrontAxisSign') gs.frontAxisSign = Number(p.props[4]);
    else if (k === 'UnitScaleFactor') gs.unitScaleFactor = Number(p.props[4]);
  }
}

// ─── Objects ─────────────────────────────────────────────
const objects = findNode(topNodes, 'Objects');
if (!objects) throw new Error('No Objects node in FBX');

// Parse Models (includes bones + mesh + null nodes)
const models = new Map();
for (const node of objects.nodes) {
  if (node.name !== 'Model') continue;
  const id = Number(node.props[0]);
  const rawName = String(node.props[1]);
  const name = rawName.split('\x00')[0].replace('Model::', '');
  const type = String(node.props[2]);

  const props70 = findNode(node.nodes, 'Properties70');
  const lclTranslation = [0, 0, 0];
  const lclRotation = [0, 0, 0];
  const lclScaling = [1, 1, 1];
  const preRotation = [0, 0, 0];
  if (props70) {
    for (const p of props70.nodes) {
      const k = String(p.props[0]);
      if (k === 'Lcl Translation') {
        lclTranslation[0] = Number(p.props[4]);
        lclTranslation[1] = Number(p.props[5]);
        lclTranslation[2] = Number(p.props[6]);
      } else if (k === 'Lcl Rotation') {
        lclRotation[0] = Number(p.props[4]);
        lclRotation[1] = Number(p.props[5]);
        lclRotation[2] = Number(p.props[6]);
      } else if (k === 'Lcl Scaling') {
        lclScaling[0] = Number(p.props[4]);
        lclScaling[1] = Number(p.props[5]);
        lclScaling[2] = Number(p.props[6]);
      } else if (k === 'PreRotation') {
        preRotation[0] = Number(p.props[4]);
        preRotation[1] = Number(p.props[5]);
        preRotation[2] = Number(p.props[6]);
      }
    }
  }

  models.set(id, { id, name, type, lclTranslation, lclRotation, lclScaling, preRotation });
}

// ─── Connections ─────────────────────────────────────────
const connections = findNode(topNodes, 'Connections');
if (!connections) throw new Error('No Connections node in FBX');

const ooConnections = []; // [{ child, parent }]
const opConnections = []; // [{ child, parent, prop }]
for (const c of connections.nodes) {
  if (c.name !== 'C') continue;
  const type = String(c.props[0]);
  if (type === 'OO') {
    ooConnections.push({ child: Number(c.props[1]), parent: Number(c.props[2]) });
  } else if (type === 'OP') {
    opConnections.push({ child: Number(c.props[1]), parent: Number(c.props[2]), prop: String(c.props[3]) });
  }
}

// Model→Model parent map
const modelIds = new Set(models.keys());
const modelParentMap = new Map();
for (const { child, parent } of ooConnections) {
  if (!modelIds.has(child)) continue;
  if (modelIds.has(parent) || parent === 0) {
    if (!modelParentMap.has(child)) modelParentMap.set(child, parent);
  }
}

// ─── Build bone list (only LimbNode / Root / Null bones) ─
// Kevin Iglesias rig: bones are LimbNode (most), with Null for B-handProp, B-spineProxy, B-root
const bones = [];
const boneIdToIndex = new Map();
for (const [id, m] of models) {
  // Skip mesh, but keep LimbNode/Root/Null in skeleton (Null for grouping bones like Rig/B-root)
  if (m.type === 'Mesh') continue;
  // Skip top-level group nodes that aren't part of skeleton (Human_DummyModel_M, Rig)
  // Heuristic: keep nodes whose name starts with "B-" or that are LimbNode/Root type
  const isSkeletonBone = m.name.startsWith('B-') || m.type === 'LimbNode' || m.type === 'Root';
  if (!isSkeletonBone) continue;

  const index = bones.length;
  boneIdToIndex.set(id, index);
  bones.push({
    id, name: m.name, type: m.type,
    localPosition: m.lclTranslation,
    localRotation: m.lclRotation,
    localScaling: m.lclScaling,
    preRotation: m.preRotation,
    parentIndex: -1,
  });
}

// Resolve parent indices (skip non-bone intermediates like Rig/Null)
for (const bone of bones) {
  let currentId = modelParentMap.get(bone.id);
  let depth = 0;
  while (currentId !== undefined && currentId !== 0 && depth < 20) {
    if (boneIdToIndex.has(currentId)) {
      bone.parentIndex = boneIdToIndex.get(currentId);
      break;
    }
    currentId = modelParentMap.get(currentId);
    depth++;
  }
}

// ─── Math helpers ────────────────────────────────────────
const degToRad = d => d * Math.PI / 180;
const eulerToMat = (rx, ry, rz) => {
  // FBX eEulerXYZ: matrix = Rz * Ry * Rx (intrinsic XYZ)
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz*cy, cz*sx*sy - sz*cx, cz*cx*sy + sz*sx,
    sz*cy, sz*sx*sy + cz*cx, sz*cx*sy - cz*sx,
    -sy,   sx*cy,            cx*cy,
  ];
};
const mulMat3 = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i*3+j] = a[i*3]*b[j] + a[i*3+1]*b[3+j] + a[i*3+2]*b[6+j];
  return r;
};
const mulMat3Vec = (m, v) => [
  m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
  m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
  m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
];

// ─── Compute world rest-pose positions (only needed for bones mode) ───
// Sort bones topologically: parent must come before child.
function computeWorldRestPose() {
  // Build child order based on parent depth
  const order = [];
  const depth = new Array(bones.length).fill(0);
  for (let i = 0; i < bones.length; i++) {
    let d = 0, p = bones[i].parentIndex;
    while (p >= 0 && d < 50) { d++; p = bones[p].parentIndex; }
    depth[i] = d;
  }
  const sortedIndices = bones.map((_, i) => i).sort((a, b) => depth[a] - depth[b]);

  const worldPos = new Array(bones.length);
  const worldRot = new Array(bones.length);
  for (const i of sortedIndices) {
    const bone = bones[i];
    const preR = eulerToMat(degToRad(bone.preRotation[0]), degToRad(bone.preRotation[1]), degToRad(bone.preRotation[2]));
    const lclR = eulerToMat(degToRad(bone.localRotation[0]), degToRad(bone.localRotation[1]), degToRad(bone.localRotation[2]));
    const localRot = mulMat3(preR, lclR);
    const lp = bone.localPosition;

    if (bone.parentIndex < 0) {
      worldPos[i] = [lp[0], lp[1], lp[2]];
      worldRot[i] = localRot;
    } else {
      const pPos = worldPos[bone.parentIndex];
      const pRot = worldRot[bone.parentIndex];
      const rotatedLocal = mulMat3Vec(pRot, lp);
      worldPos[i] = [pPos[0] + rotatedLocal[0], pPos[1] + rotatedLocal[1], pPos[2] + rotatedLocal[2]];
      worldRot[i] = mulMat3(pRot, localRot);
    }
  }
  return worldPos;
}

// Convert position: FBX local units (cm if unitScaleFactor=1) → meters, axis system → Y-up
function convertPosition(p) {
  const s = gs.unitScaleFactor / 100;
  const x = p[0] * s, y = p[1] * s, z = p[2] * s;
  if (gs.upAxis === 2) {
    // Z-up → Y-up
    return [x, z * gs.upAxisSign, -y * gs.upAxisSign];
  }
  return [x, y * gs.upAxisSign, z];
}

// ─── Write output ────────────────────────────────────────
mkdirSync(dirname(outPath), { recursive: true });

if (mode === 'bones') {
  const worldPos = computeWorldRestPose();
  const out = {
    source: fbxPath,
    globalSettings: gs,
    bones: bones.map((b, i) => ({
      name: b.name,
      type: b.type,
      parent: b.parentIndex >= 0 ? bones[b.parentIndex].name : null,
      localPosition: b.localPosition,    // cm, FBX axes
      localRotation: b.localRotation,    // degrees, FBX eEulerXYZ
      preRotation: b.preRotation,        // degrees
      localScaling: b.localScaling,
      worldPosition: convertPosition(worldPos[i]),  // meters, Y-up (RH still)
    })),
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`bones: ${bones.length} → ${outPath}`);
  console.log(`GlobalSettings: ${JSON.stringify(gs)}`);

} else if (mode === 'motion') {
  // ─── Extract animation curves ──────────────────────────
  // FBX time unit: 1 FBX-time = 1/46186158000 seconds
  const FBX_TIME_UNIT = 46186158000;

  // Find all AnimationCurveNode, AnimationCurve, AnimationLayer
  const curveNodes = new Map(); // id → { name, props: { dX, dY, dZ } }
  const curves = new Map();     // id → { keyTimes: [], keyValues: [] }
  for (const node of objects.nodes) {
    if (node.name === 'AnimationCurveNode') {
      const id = Number(node.props[0]);
      const rawName = String(node.props[1]);
      const name = rawName.split('\x00')[0];
      curveNodes.set(id, { id, name, defaults: { dX: 0, dY: 0, dZ: 0 } });
      const p70 = findNode(node.nodes, 'Properties70');
      if (p70) {
        for (const p of p70.nodes) {
          const k = String(p.props[0]);
          if (k === 'd|X') curveNodes.get(id).defaults.dX = Number(p.props[4]);
          else if (k === 'd|Y') curveNodes.get(id).defaults.dY = Number(p.props[4]);
          else if (k === 'd|Z') curveNodes.get(id).defaults.dZ = Number(p.props[4]);
        }
      }
    } else if (node.name === 'AnimationCurve') {
      const id = Number(node.props[0]);
      const keyTimes = findNode(node.nodes, 'KeyTime')?.props?.[0] ?? [];
      const keyValues = findNode(node.nodes, 'KeyValueFloat')?.props?.[0] ?? [];
      curves.set(id, {
        keyTimes: Array.from(keyTimes).map(Number),
        keyValues: Array.from(keyValues).map(Number),
      });
    }
  }

  // Curve → CurveNode (OO) and channel name
  // Connections: AnimationCurve → AnimationCurveNode with prop "d|X"|"d|Y"|"d|Z"
  const curveToNodeChannel = new Map(); // curveId → { nodeId, channel }
  for (const { child, parent, prop } of opConnections) {
    if (curves.has(child) && curveNodes.has(parent)) {
      curveToNodeChannel.set(child, { nodeId: parent, channel: prop }); // prop: "d|X"|"d|Y"|"d|Z"
    }
  }
  // Also OO: AnimationCurve → AnimationCurveNode (no channel info, fall back)
  for (const { child, parent } of ooConnections) {
    if (curves.has(child) && curveNodes.has(parent) && !curveToNodeChannel.has(child)) {
      curveToNodeChannel.set(child, { nodeId: parent, channel: '?' });
    }
  }

  // CurveNode → Model (OP) and property ("Lcl Rotation" | "Lcl Translation" | "Lcl Scaling")
  const nodeToModel = new Map(); // nodeId → { modelId, prop }
  for (const { child, parent, prop } of opConnections) {
    if (curveNodes.has(child) && modelIds.has(parent)) {
      nodeToModel.set(child, { modelId: parent, prop });
    }
  }

  // Build: model → { property → { channel → curve } }
  const modelAnim = new Map(); // modelId → { 'Lcl Rotation': { X: curveId, Y: curveId, Z: curveId }, ... }
  for (const [curveId, { nodeId }] of curveToNodeChannel) {
    const link = nodeToModel.get(nodeId);
    if (!link) continue;
    const { modelId, prop } = link;
    if (!modelAnim.has(modelId)) modelAnim.set(modelId, {});
    if (!modelAnim.get(modelId)[prop]) modelAnim.get(modelId)[prop] = { X: null, Y: null, Z: null };
    const cn = curveNodes.get(nodeId);
    const channel = curveToNodeChannel.get(curveId).channel;
    // channel is "d|X"/"d|Y"/"d|Z" or "?"; if "?", we need another way — use AnimationCurveNode property structure
    // The OO from curve to curveNode has the curve's order matching d|X, d|Y, d|Z in the curveNode's defaults
    // For now, trust OP channel info; for OO-only fallback, we'd need to count order
    let chKey = null;
    if (channel === 'd|X') chKey = 'X';
    else if (channel === 'd|Y') chKey = 'Y';
    else if (channel === 'd|Z') chKey = 'Z';
    if (chKey) modelAnim.get(modelId)[prop][chKey] = curveId;
  }

  // For OO-only (some FBX exporters), assign curves in order X,Y,Z to each CurveNode
  // Group curves by their target CurveNode in order
  const curveNodeChildCurves = new Map();
  for (const { child, parent } of ooConnections) {
    if (curves.has(child) && curveNodes.has(parent)) {
      if (!curveNodeChildCurves.has(parent)) curveNodeChildCurves.set(parent, []);
      curveNodeChildCurves.get(parent).push(child);
    }
  }
  // For curves with channel '?', assign by order
  for (const [nodeId, childCurves] of curveNodeChildCurves) {
    const link = nodeToModel.get(nodeId);
    if (!link) continue;
    const { modelId, prop } = link;
    if (!modelAnim.has(modelId)) modelAnim.set(modelId, {});
    if (!modelAnim.get(modelId)[prop]) modelAnim.get(modelId)[prop] = { X: null, Y: null, Z: null };
    const slot = modelAnim.get(modelId)[prop];
    const channelOrder = ['X', 'Y', 'Z'];
    let idx = 0;
    for (const curveId of childCurves) {
      // Find the channel for this curve
      const ch = curveToNodeChannel.get(curveId)?.channel;
      let chKey = null;
      if (ch === 'd|X') chKey = 'X';
      else if (ch === 'd|Y') chKey = 'Y';
      else if (ch === 'd|Z') chKey = 'Z';
      if (chKey && !slot[chKey]) {
        slot[chKey] = curveId;
      } else if (!chKey && idx < 3 && !slot[channelOrder[idx]]) {
        slot[channelOrder[idx]] = curveId;
      }
      idx++;
    }
  }

  // Determine FPS and total frames
  // Find all unique key times across all curves to determine sample range
  let minTime = Infinity, maxTime = -Infinity;
  for (const c of curves.values()) {
    if (c.keyTimes.length === 0) continue;
    minTime = Math.min(minTime, c.keyTimes[0]);
    maxTime = Math.max(maxTime, c.keyTimes[c.keyTimes.length - 1]);
  }

  const FPS = 30;
  const dt = FBX_TIME_UNIT / FPS;
  const totalDurationSec = (maxTime - minTime) / FBX_TIME_UNIT;
  const totalFrames = Math.max(1, Math.round(totalDurationSec * FPS) + 1);

  // Sample each curve at frame times
  function sampleCurve(curveId, frameTime) {
    if (!curveId) return null;
    const c = curves.get(curveId);
    if (!c || c.keyTimes.length === 0) return null;
    if (frameTime <= c.keyTimes[0]) return c.keyValues[0];
    if (frameTime >= c.keyTimes[c.keyTimes.length - 1]) return c.keyValues[c.keyValues.length - 1];
    // Linear interpolation between adjacent keys
    for (let i = 0; i < c.keyTimes.length - 1; i++) {
      if (frameTime >= c.keyTimes[i] && frameTime <= c.keyTimes[i + 1]) {
        const t0 = c.keyTimes[i], t1 = c.keyTimes[i + 1];
        const v0 = c.keyValues[i], v1 = c.keyValues[i + 1];
        const u = (frameTime - t0) / (t1 - t0);
        return v0 + (v1 - v0) * u;
      }
    }
    return c.keyValues[c.keyValues.length - 1];
  }

  // Build hierarchy entries (bones only)
  const hierarchy = bones.map(b => ({
    name: b.name,
    parent: b.parentIndex >= 0 ? bones[b.parentIndex].name : null,
    restLocalPosition: b.localPosition,  // cm
    restLocalRotation: b.localRotation,  // deg
    preRotation: b.preRotation,           // deg
  }));

  const boneIds = new Set(bones.map(b => b.id));

  // Generate frames
  const frames = [];
  for (let f = 0; f < totalFrames; f++) {
    const t = minTime + f * dt;
    const frameBones = [];
    for (const bone of bones) {
      const anim = modelAnim.get(bone.id);
      const rot = [...bone.localRotation];
      const pos = [...bone.localPosition];
      const scl = [...bone.localScaling];
      if (anim) {
        if (anim['Lcl Rotation']) {
          const slot = anim['Lcl Rotation'];
          const x = sampleCurve(slot.X, t);
          const y = sampleCurve(slot.Y, t);
          const z = sampleCurve(slot.Z, t);
          if (x !== null) rot[0] = x;
          if (y !== null) rot[1] = y;
          if (z !== null) rot[2] = z;
        }
        if (anim['Lcl Translation']) {
          const slot = anim['Lcl Translation'];
          const x = sampleCurve(slot.X, t);
          const y = sampleCurve(slot.Y, t);
          const z = sampleCurve(slot.Z, t);
          if (x !== null) pos[0] = x;
          if (y !== null) pos[1] = y;
          if (z !== null) pos[2] = z;
        }
      }
      frameBones.push({ name: bone.name, localPosition: pos, localRotation: rot, localScaling: scl });
    }
    frames.push({ time: f / FPS, bones: frameBones });
  }

  const out = {
    source: fbxPath,
    globalSettings: gs,
    fps: FPS,
    duration: totalDurationSec,
    frameCount: totalFrames,
    hierarchy,
    frames,
  };
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`motion: ${totalFrames} frames @ ${FPS}fps (${totalDurationSec.toFixed(2)}s) → ${outPath}`);
  console.log(`Animated models: ${[...modelAnim.keys()].filter(id => boneIds.has(id)).length} of ${bones.length} bones`);

} else if (mode === 'mesh') {
  // ─── Mesh + Skinning データ抽出 ───────────────────────────
  // FBX Geometry から:
  //   - Vertices (5340 unique 頂点)
  //   - PolygonVertexIndex (sign-bit エンコードでポリゴン終端を示す)
  //   - LayerElementNormal (ByPolygonVertex / Direct)
  // FBX Deformer (Skin/Cluster) から:
  //   - Cluster.Indexes / Weights (各ボーンが影響を与える頂点)
  //   - Cluster.TransformLink (ボーンのバインドポーズ world matrix)
  //
  // 出力は per-polygon-vertex (=三角形頂点ごと) に展開: pos, normal, boneIndices(x4), boneWeights(x4)
  // インデックスは [0,1,2,3,4,5,...] 連番
  // bindMatrices は 56 ボーン分 (inverse bind = inverse(TransformLink))

  const geomNode = objects.nodes.find(n => n.name === 'Geometry' && String(n.props[2]) === 'Mesh');
  if (!geomNode) throw new Error('No Mesh Geometry found');

  const vertsNode = findNode(geomNode.nodes, 'Vertices');
  const polyIdxNode = findNode(geomNode.nodes, 'PolygonVertexIndex');
  if (!vertsNode || !polyIdxNode) throw new Error('Missing Vertices or PolygonVertexIndex');

  const fbxVertices = Array.from(vertsNode.props[0]).map(Number);  // flat [x,y,z, ...] in cm
  const polyVertIdx = Array.from(polyIdxNode.props[0]).map(Number);

  // Normals (ByPolygonVertex / Direct)
  const normalLayer = findNode(geomNode.nodes, 'LayerElementNormal');
  const normalNode = normalLayer && findNode(normalLayer.nodes, 'Normals');
  const fbxNormals = normalNode ? Array.from(normalNode.props[0]).map(Number) : null;
  const normalMapping = normalLayer && String(findNode(normalLayer.nodes, 'MappingInformationType')?.props[0] ?? '');
  const normalRef = normalLayer && String(findNode(normalLayer.nodes, 'ReferenceInformationType')?.props[0] ?? '');

  // ─── Cluster → Bone 紐付け ─────────────────────────────
  // Clusters は Deformer (type="Cluster"), Bone (Model) と OO で繋がっている
  const clusterNodes = objects.nodes.filter(n => n.name === 'Deformer' && String(n.props[2]) === 'Cluster');
  const clusterIdToBoneIdx = new Map();  // clusterId → bone index (in our `bones` array)
  // FBX 接続: Bone (Model) → Cluster の方向 (child=bone, parent=cluster)
  for (const { child, parent } of ooConnections) {
    if (boneIdToIndex.has(child)) {
      // bone が cluster の子になっているケース
      const parentCluster = clusterNodes.find(c => Number(c.props[0]) === parent);
      if (parentCluster) {
        clusterIdToBoneIdx.set(parent, boneIdToIndex.get(child));
      }
    }
  }

  // ─── per-FBX-vertex の影響ボーン蓄積 ─────────────────────
  // vertexInfluences[fbxIdx] = [{ boneIdx, weight }, ...]
  const vertexInfluences = Array.from({ length: fbxVertices.length / 3 }, () => []);
  const bindMatrices = new Array(bones.length).fill(null);  // ボーンごとの inverse bind matrix (16 floats)

  for (const cluster of clusterNodes) {
    const clusterId = Number(cluster.props[0]);
    const boneIdx = clusterIdToBoneIdx.get(clusterId);
    if (boneIdx === undefined) continue;

    const idxNode = findNode(cluster.nodes, 'Indexes');
    const wNode = findNode(cluster.nodes, 'Weights');
    if (!idxNode || !wNode) continue;
    const idxs = Array.from(idxNode.props[0]).map(Number);
    const wghts = Array.from(wNode.props[0]).map(Number);
    for (let i = 0; i < idxs.length; i++) {
      vertexInfluences[idxs[i]].push({ boneIdx, weight: wghts[i] });
    }

    // TransformLink: bone's world matrix at bind time (16 floats, column-major in FBX)
    const linkNode = findNode(cluster.nodes, 'TransformLink');
    if (linkNode) {
      const mFlat = Array.from(linkNode.props[0]).map(Number);  // 16 floats
      // Invert and store as bind matrix
      // For simplicity we store the raw TransformLink; inversion happens at runtime in Babylon
      bindMatrices[boneIdx] = mFlat;
    }
  }

  // ─── 各 FBX 頂点で top 4 影響ボーンに絞り、weight 正規化 ─
  const MAX_INFLUENCES = 4;
  const vertSkin4 = vertexInfluences.map(infs => {
    infs.sort((a, b) => b.weight - a.weight);
    const top = infs.slice(0, MAX_INFLUENCES);
    const sum = top.reduce((s, x) => s + x.weight, 0);
    const norm = sum > 0 ? top.map(x => ({ boneIdx: x.boneIdx, weight: x.weight / sum })) : [];
    while (norm.length < MAX_INFLUENCES) norm.push({ boneIdx: 0, weight: 0 });
    return norm;
  });

  // ─── ポリゴンを三角形に展開 ────────────────────────────
  // PolygonVertexIndex: 各値が頂点インデックス、負値 (-n-1) はポリゴン終端を示す
  // 全ポリゴンが三角形と仮定 (= 3要素ごと)。それ以外なら fan 三角形分割。
  const positions = [];
  const normals = [];
  const matricesIndices = [];  // flat: 4 indices per output vertex
  const matricesWeights = [];  // flat: 4 weights per output vertex
  const indices = [];

  // ポリゴン境界を集める
  const polyEnds = [];  // end indexes (exclusive)
  for (let i = 0; i < polyVertIdx.length; i++) {
    if (polyVertIdx[i] < 0) polyEnds.push(i + 1);
  }
  let polyStart = 0;
  let outVertIdx = 0;
  for (const polyEnd of polyEnds) {
    // この多角形の頂点配列を取り出す
    const polyVerts = [];
    for (let i = polyStart; i < polyEnd; i++) {
      const v = polyVertIdx[i];
      const realIdx = v < 0 ? -v - 1 : v;
      polyVerts.push({ fbxIdx: realIdx, polyVertSlot: i });
    }
    // fan triangulation: (v0, v1, v2), (v0, v2, v3), ...
    for (let t = 1; t < polyVerts.length - 1; t++) {
      const triangle = [polyVerts[0], polyVerts[t], polyVerts[t + 1]];
      for (const pv of triangle) {
        // position from fbxVertices
        positions.push(
          fbxVertices[pv.fbxIdx * 3],
          fbxVertices[pv.fbxIdx * 3 + 1],
          fbxVertices[pv.fbxIdx * 3 + 2],
        );
        // normal: per-polygon-vertex direct
        if (fbxNormals && normalMapping === 'ByPolygonVertex' && normalRef === 'Direct') {
          normals.push(
            fbxNormals[pv.polyVertSlot * 3],
            fbxNormals[pv.polyVertSlot * 3 + 1],
            fbxNormals[pv.polyVertSlot * 3 + 2],
          );
        } else if (fbxNormals && normalMapping === 'ByVertex') {
          normals.push(
            fbxNormals[pv.fbxIdx * 3],
            fbxNormals[pv.fbxIdx * 3 + 1],
            fbxNormals[pv.fbxIdx * 3 + 2],
          );
        } else {
          normals.push(0, 1, 0);  // fallback
        }
        // skin
        const sk = vertSkin4[pv.fbxIdx];
        for (let k = 0; k < 4; k++) {
          matricesIndices.push(sk[k].boneIdx);
          matricesWeights.push(sk[k].weight);
        }
        indices.push(outVertIdx);
        outVertIdx++;
      }
    }
    polyStart = polyEnd;
  }

  // ボーン名一覧 (bindMatrices と対応)
  const boneNames = bones.map(b => b.name);

  const out = {
    source: fbxPath,
    globalSettings: gs,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    positions,             // flat, cm units (FBX raw)
    normals,
    indices,
    matricesIndices,       // bone indices per vertex (4 each)
    matricesWeights,       // bone weights per vertex (4 each)
    boneNames,             // 56 entries
    bindMatrices,          // 56 entries × 16 floats (TransformLink, column-major). null if bone not skinned
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`mesh: ${out.vertexCount} verts, ${out.triangleCount} tris, ${boneNames.length} bones (${bindMatrices.filter(m=>m).length} skinned) → ${outPath}`);

} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}
