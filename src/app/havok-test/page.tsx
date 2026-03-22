'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, TransformNode,
  Quaternion,
} from '@babylonjs/core';
import {
  initHavok, createHavokCharacter, updateHavokCharacter,
  calculateCenterOfMass, getBalanceDeviation,
  type HavokCharacter,
} from '@/lib/havok-character';

interface BoneEntry {
  name: string;
  parent: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  preRotation: [number, number, number];
  worldPosition: [number, number, number];
}

interface BoneDataFile {
  globalSettings: { unitScaleFactor: number };
  bones: BoneEntry[];
}

// ─── Bone visualization (spheres + lines) with its own TransformNode hierarchy ──

function degToRad(d: number): number { return d * Math.PI / 180; }

function eulerXYZToQuat(xDeg: number, yDeg: number, zDeg: number): Quaternion {
  const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(xDeg));
  const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), degToRad(yDeg));
  const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), degToRad(zDeg));
  return qz.multiply(qy.multiply(qx));
}

function buildBoneHierarchy(
  scene: Scene, data: BoneDataFile, root: TransformNode,
): Map<string, TransformNode> {
  const bones = new Map<string, TransformNode>();
  const scale = data.globalSettings.unitScaleFactor / 100;

  const jointMat = new StandardMaterial('boneVis_jMat', scene);
  jointMat.diffuseColor = new Color3(0.2, 0.8, 0.3);
  const lineMat = new Color3(1, 1, 0);

  for (const entry of data.bones) {
    const node = new TransformNode(`boneVis_${entry.name}`, scene);
    if (entry.parent && bones.has(entry.parent)) {
      node.parent = bones.get(entry.parent)!;
    } else {
      node.parent = root;
    }
    node.position.set(
      entry.localPosition[0] * scale,
      entry.localPosition[1] * scale,
      entry.localPosition[2] * scale,
    );
    const pre = eulerXYZToQuat(entry.preRotation[0], entry.preRotation[1], entry.preRotation[2]);
    const lcl = eulerXYZToQuat(entry.localRotation[0], entry.localRotation[1], entry.localRotation[2]);
    node.rotationQuaternion = pre.multiply(lcl);

    // Joint sphere
    const sphere = MeshBuilder.CreateSphere(`boneVis_s_${entry.name}`, { diameter: 0.025 }, scene);
    sphere.material = jointMat;
    sphere.parent = node;

    bones.set(entry.name, node);
  }

  // Lines: draw after all bones exist (use world positions each frame via observable)
  const lineParent = new TransformNode('boneVis_lines', scene);
  lineParent.parent = root;
  let linesBuilt = false;

  scene.onBeforeRenderObservable.add(() => {
    if (linesBuilt) return;
    linesBuilt = true;
    for (const entry of data.bones) {
      if (!entry.parent) continue;
      const child = bones.get(entry.name);
      const parent = bones.get(entry.parent);
      if (!child || !parent) continue;
      child.computeWorldMatrix(true);
      parent.computeWorldMatrix(true);
      const cp = child.getAbsolutePosition();
      const pp = parent.getAbsolutePosition();
      const line = MeshBuilder.CreateLines(`boneVis_l_${entry.name}`, {
        points: [cp, pp], updatable: false,
      }, scene);
      (line as unknown as { color: Color3 }).color = lineMat;
    }
  });

  return bones;
}

// ─── Main component ──────────────────────────────────────

/** Key bones for selection */
const SELECTABLE_BONES = [
  'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
  'mixamorig:Neck', 'mixamorig:Head',
  'mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand',
  'mixamorig:RightShoulder', 'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand',
  'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:LeftFoot',
  'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'mixamorig:RightFoot',
];

export default function HavokTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Initializing...');
  const [selectedBone, setSelectedBone] = useState(SELECTABLE_BONES[0]);
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [rotZ, setRotZ] = useState(0);
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);

  // Refs for scene objects
  const characterRef = useRef<HavokCharacter | null>(null);
  const boneVisRef = useRef<Map<string, TransformNode> | null>(null);
  const baseRotationsRef = useRef<Map<string, Quaternion>>(new Map());
  const basePositionsRef = useRef<Map<string, Vector3>>(new Map());

  // Store base rotations and positions for both hierarchies
  const storeBaseValues = useCallback((boneName: string) => {
    const char = characterRef.current;
    const vis = boneVisRef.current;
    const baseRots = baseRotationsRef.current;
    const basePos = basePositionsRef.current;

    // Character bone
    const cb = char?.allBones.get(boneName);
    if (cb) {
      baseRots.set(`char_${boneName}`, (cb.rotationQuaternion ?? Quaternion.Identity()).clone());
      basePos.set(`char_${boneName}`, cb.position.clone());
    }
    // Vis bone
    const vb = vis?.get(boneName);
    if (vb) {
      baseRots.set(`vis_${boneName}`, (vb.rotationQuaternion ?? Quaternion.Identity()).clone());
      basePos.set(`vis_${boneName}`, vb.position.clone());
    }
  }, []);

  // Apply rotation/position delta to both models
  const applyTransform = useCallback((boneName: string, rx: number, ry: number, rz: number, px: number, py: number, pz: number) => {
    const char = characterRef.current;
    const vis = boneVisRef.current;
    const baseRots = baseRotationsRef.current;
    const basePos = basePositionsRef.current;

    const deltaRot = Quaternion.RotationYawPitchRoll(degToRad(ry), degToRad(rx), degToRad(rz));

    for (const [prefix, bonesMap] of [['char', char?.allBones], ['vis', vis]] as const) {
      if (!bonesMap) continue;
      const bone = bonesMap.get(boneName);
      if (!bone) continue;
      const baseR = baseRots.get(`${prefix}_${boneName}`);
      const baseP = basePos.get(`${prefix}_${boneName}`);
      if (baseR) {
        bone.rotationQuaternion = baseR.multiply(deltaRot);
      }
      if (baseP) {
        bone.position.set(baseP.x + px, baseP.y + py, baseP.z + pz);
      }
    }
  }, []);

  // Handle bone selection change
  const handleBoneSelect = useCallback((boneName: string) => {
    setSelectedBone(boneName);
    setRotX(0); setRotY(0); setRotZ(0);
    setPosX(0); setPosY(0); setPosZ(0);
    storeBaseValues(boneName);
  }, [storeBaseValues]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.12, 0.12, 0.18, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3.2, 4.5, new Vector3(0.5, 0.9, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 10;
    camera.wheelPrecision = 30;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
    new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.8;

    const ground = MeshBuilder.CreateGround('ground', { width: 8, height: 8 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.3, 0.3, 0.25);
    ground.material = gMat;

    (async () => {
      try {
        setStatus('Initializing...');
        await initHavok(scene);
        if (disposed) return;

        // Load bone data
        const boneDataRes = await fetch('/bone-data.json');
        const boneData: BoneDataFile = await boneDataRes.json();

        // Left: bone hierarchy visualization
        const visRoot = new TransformNode('visRoot', scene);
        visRoot.position.x = -1;
        const visBones = buildBoneHierarchy(scene, boneData, visRoot);
        boneVisRef.current = visBones;

        // Right: voxel mesh character
        const character = await createHavokCharacter(scene, {
          bodyColor: new Color3(0.2, 0.35, 0.8),
          prefix: 'test',
          position: new Vector3(1, 0, 0),
          enablePhysics: false,
          enableDebug: false,
        });
        characterRef.current = character;
        if (disposed) return;

        // Store base values for initial bone
        storeBaseValues(SELECTABLE_BONES[0]);

        setStatus(`Left: bones | Right: voxel mesh — Select a bone and use sliders to test`);
      } catch (e) {
        console.error('Init failed:', e);
        setStatus(`Error: ${e}`);
      }
    })();

    engine.runRenderLoop(() => {
      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);
    return () => { disposed = true; window.removeEventListener('resize', handleResize); engine.dispose(); };
  }, [storeBaseValues]);

  // Apply transform whenever sliders change
  useEffect(() => {
    applyTransform(selectedBone, rotX, rotY, rotZ, posX, posY, posZ);
  }, [selectedBone, rotX, rotY, rotZ, posX, posY, posZ, applyTransform]);

  const sliderStyle: React.CSSProperties = { width: '100%', margin: '2px 0' };
  const labelStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#ccc' };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#1a1a2e' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '6px 16px', background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 12,
      }}>
        <b>Bone vs Mesh Comparison</b> | {status}
      </div>

      {/* Control panel */}
      <div style={{
        position: 'absolute', right: 0, top: 40, width: 280, bottom: 0, zIndex: 10,
        background: 'rgba(0,0,0,0.85)', color: '#fff', fontSize: 12,
        padding: '8px 12px', overflow: 'auto',
      }}>
        {/* Bone selector */}
        <div style={{ marginBottom: 8 }}>
          <b>Bone:</b>
          <select
            value={selectedBone}
            onChange={(e) => handleBoneSelect(e.target.value)}
            style={{ width: '100%', marginTop: 4, padding: 4, background: '#333', color: '#fff', border: '1px solid #555' }}
          >
            {SELECTABLE_BONES.map(b => (
              <option key={b} value={b}>{b.replace('mixamorig:', '')}</option>
            ))}
          </select>
        </div>

        {/* Rotation sliders */}
        <div style={{ marginBottom: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
          <b>Rotation (degrees)</b>
          <div style={labelStyle}><span>X: {rotX.toFixed(0)}°</span></div>
          <input type="range" min={-180} max={180} step={1} value={rotX}
            onChange={e => setRotX(Number(e.target.value))} style={sliderStyle} />
          <div style={labelStyle}><span>Y: {rotY.toFixed(0)}°</span></div>
          <input type="range" min={-180} max={180} step={1} value={rotY}
            onChange={e => setRotY(Number(e.target.value))} style={sliderStyle} />
          <div style={labelStyle}><span>Z: {rotZ.toFixed(0)}°</span></div>
          <input type="range" min={-180} max={180} step={1} value={rotZ}
            onChange={e => setRotZ(Number(e.target.value))} style={sliderStyle} />
        </div>

        {/* Position sliders */}
        <div style={{ marginBottom: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
          <b>Position offset (m)</b>
          <div style={labelStyle}><span>X: {posX.toFixed(3)}</span></div>
          <input type="range" min={-0.5} max={0.5} step={0.005} value={posX}
            onChange={e => setPosX(Number(e.target.value))} style={sliderStyle} />
          <div style={labelStyle}><span>Y: {posY.toFixed(3)}</span></div>
          <input type="range" min={-0.5} max={0.5} step={0.005} value={posY}
            onChange={e => setPosY(Number(e.target.value))} style={sliderStyle} />
          <div style={labelStyle}><span>Z: {posZ.toFixed(3)}</span></div>
          <input type="range" min={-0.5} max={0.5} step={0.005} value={posZ}
            onChange={e => setPosZ(Number(e.target.value))} style={sliderStyle} />
        </div>

        {/* Reset button */}
        <button
          onClick={() => { setRotX(0); setRotY(0); setRotZ(0); setPosX(0); setPosY(0); setPosZ(0); }}
          style={{ width: '100%', padding: 6, background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >Reset</button>
      </div>

      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
