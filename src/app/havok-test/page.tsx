'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, TransformNode,
  Quaternion,
} from '@babylonjs/core';
import {
  initHavok, createHavokCharacter, updateHavokCharacter,
  scaleBones, rebuildBodyMeshes,
  equipWeapon, unequipWeapon, updateWeaponInertia,
  startSwing, endSwing, releaseOffHand,
  fetchGameAssetWeapons, equipGameAssetWeapon,
  type HavokCharacter, type WeaponPhysics, type StanceType, type GameAssetWeaponInfo,
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

/** Cache for base positions (for hips offset) — cleared on init */
let _hipsBasePosCache = new Map<string, Vector3>();
function ensureBasePos(node: TransformNode, key: string): Vector3 {
  if (!_hipsBasePosCache.has(key)) {
    _hipsBasePosCache.set(key, node.position.clone());
  }
  return _hipsBasePosCache.get(key)!;
}

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
  const [heightScale, setHeightScale] = useState(1.0);
  const [hipsHeight, setHipsHeight] = useState(0);

  // Weapon controls
  const [weaponEquipped, setWeaponEquipped] = useState(false);
  const [weaponWeight, setWeaponWeight] = useState(3.0);
  const [weaponLength, setWeaponLength] = useState(1.0);
  const [gripType, setGripType] = useState<'one-handed' | 'two-handed'>('two-handed');
  const [stance, setStanceState] = useState<StanceType>('front');
  // Game-asset weapons
  const [availableWeapons, setAvailableWeapons] = useState<GameAssetWeaponInfo[]>([]);
  const [selectedAssetWeapon, setSelectedAssetWeapon] = useState<string>(''); // 'category/pieceKey' or ''
  const [useAssetWeapon, setUseAssetWeapon] = useState(false);
  const [offHandReleased, setOffHandReleased] = useState(false);
  const [swingActive, setSwingActive] = useState(false);
  const [tipSpeed, setTipSpeed] = useState(0);
  const [swingPower, setSwingPower] = useState(0);
  // IK target for weapon swing test
  const [swingTargetX, setSwingTargetX] = useState(0);
  const [swingTargetY, setSwingTargetY] = useState(0);
  const [swingTargetZ, setSwingTargetZ] = useState(0);

  // Refs for scene objects
  const characterRef = useRef<HavokCharacter | null>(null);
  const boneVisRef = useRef<Map<string, TransformNode> | null>(null);
  const baseRotationsRef = useRef<Map<string, Quaternion>>(new Map());
  const basePositionsRef = useRef<Map<string, Vector3>>(new Map());
  const visBasePositionsRef = useRef<Map<string, Vector3>>(new Map());
  const sceneRef = useRef<Scene | null>(null);
  const bodyColorRef = useRef(new Color3(0.2, 0.35, 0.8));

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
    sceneRef.current = scene;
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
        // Clear caches from previous hot reloads
        _hipsBasePosCache = new Map();
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

        // Store base positions for bone vis scaling
        const visBase = new Map<string, Vector3>();
        for (const [name, bone] of visBones) {
          visBase.set(name, bone.position.clone());
        }
        visBasePositionsRef.current = visBase;

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

    // Track hips offset for render loop
    let _hipsOffset = 0;
    const setHipsOffsetRef = (v: number) => { _hipsOffset = v; };
    (window as unknown as Record<string, unknown>).__setHipsOffset = setHipsOffsetRef;

    // Weapon swing target (accessed from render loop)
    let _swingTarget = new Vector3(0, 0, 0);
    const setSwingTargetRef = (x: number, y: number, z: number) => {
      _swingTarget = new Vector3(x, y, z);
    };
    (window as unknown as Record<string, unknown>).__setSwingTarget = setSwingTargetRef;

    // Weapon HUD update callback
    let _weaponHudCb: ((speed: number, power: number) => void) | null = null;
    (window as unknown as Record<string, unknown>).__setWeaponHudCb = (cb: (speed: number, power: number) => void) => { _weaponHudCb = cb; };

    let prevTime = performance.now();

    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.1); // cap at 100ms
      prevTime = now;

      // Apply hips height offset to both models
      const char = characterRef.current;
      const vis = boneVisRef.current;
      if (char) {
        const hips = char.allBones.get('mixamorig:Hips');
        if (hips) {
          const base = ensureBasePos(hips, 'char_hips_base');
          hips.position.y = base.y + _hipsOffset;
        }
      }
      if (vis) {
        const hipsVis = vis.get('mixamorig:Hips');
        if (hipsVis) {
          const base = ensureBasePos(hipsVis, 'vis_hips_base');
          hipsVis.position.y = base.y + _hipsOffset;
        }
      }

      // Weapon inertia: 構えの基準位置 + スライダーオフセット
      if (char && char.weapon) {
        const basePos = char.weaponSwing.baseHandPos;
        const desired = basePos.add(_swingTarget);
        updateWeaponInertia(char, desired, dt);
      }

      // Run IK after hips position change
      if (char) {
        updateHavokCharacter(scene, char, dt);

        // Update HUD
        if (_weaponHudCb && char.weapon) {
          _weaponHudCb(char.weaponSwing.tipSpeed, char.weaponSwing.power);
        }
      }
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

  // Sync hips height offset to render loop
  useEffect(() => {
    const fn = (window as unknown as Record<string, unknown>).__setHipsOffset as ((v: number) => void) | undefined;
    if (fn) fn(hipsHeight);
  }, [hipsHeight]);

  // Fetch available game-asset weapons
  useEffect(() => {
    fetchGameAssetWeapons().then(weapons => {
      setAvailableWeapons(weapons);
      if (weapons.length > 0) {
        setSelectedAssetWeapon(`${weapons[0].category}/${weapons[0].pieceKey}`);
      }
    });
  }, []);

  // Sync swing target to render loop
  useEffect(() => {
    const fn = (window as unknown as Record<string, unknown>).__setSwingTarget as ((x: number, y: number, z: number) => void) | undefined;
    if (fn) fn(swingTargetX, swingTargetY, swingTargetZ);
  }, [swingTargetX, swingTargetY, swingTargetZ]);

  // Weapon HUD callback
  useEffect(() => {
    const setFn = (window as unknown as Record<string, unknown>).__setWeaponHudCb as ((cb: (s: number, p: number) => void) => void) | undefined;
    if (setFn) {
      setFn((speed: number, power: number) => {
        setTipSpeed(speed);
        setSwingPower(power);
      });
    }
  }, []);

  // Equip/unequip weapon
  useEffect(() => {
    const char = characterRef.current;
    const scene = sceneRef.current;
    if (!char || !scene) return;
    if (weaponEquipped) {
      if (useAssetWeapon && selectedAssetWeapon) {
        // Game-asset weapon
        const info = availableWeapons.find(
          w => `${w.category}/${w.pieceKey}` === selectedAssetWeapon
        );
        if (info) {
          equipGameAssetWeapon(scene, char, info, stance).catch(console.error);
        }
      } else {
        // Manual/debug weapon
        const weapon: WeaponPhysics = {
          weight: weaponWeight,
          length: weaponLength,
          gripType,
          attackPoint: new Vector3(0, -weaponLength, 0),
          gripOffset: Vector3.Zero(),
          offHandOffset: new Vector3(0, 0.2, 0),
        };
        equipWeapon(scene, char, weapon, stance);
      }
    } else {
      unequipWeapon(char);
      char.ikChains.rightArm.weight = 0;
      char.ikChains.leftArm.weight = 0;
    }
  }, [weaponEquipped, weaponWeight, weaponLength, gripType, stance, useAssetWeapon, selectedAssetWeapon, availableWeapons]);

  // Off-hand release toggle
  useEffect(() => {
    const char = characterRef.current;
    if (!char) return;
    releaseOffHand(char, offHandReleased);
  }, [offHandReleased]);

  // Swing start/stop
  useEffect(() => {
    const char = characterRef.current;
    if (!char) return;
    if (swingActive) {
      startSwing(char);
    } else {
      endSwing(char);
    }
  }, [swingActive]);

  // Apply height scaling
  useEffect(() => {
    const char = characterRef.current;
    const vis = boneVisRef.current;
    const scene = sceneRef.current;
    if (!char || !scene) return;

    // Scale character bones + rebuild meshes
    scaleBones(char, heightScale);
    rebuildBodyMeshes(scene, char, bodyColorRef.current, 'test');

    // Scale bone visualization
    if (vis) {
      const visBase = visBasePositionsRef.current;
      for (const [name, bone] of vis) {
        const base = visBase.get(name);
        if (base) {
          bone.position.set(base.x * heightScale, base.y * heightScale, base.z * heightScale);
        }
      }
    }

    // Re-store base values for current bone (positions changed)
    storeBaseValues(selectedBone);
  }, [heightScale, storeBaseValues, selectedBone]);

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

        {/* Hips height (IK demo) */}
        <div style={{ marginBottom: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
          <b>Hips Height (IK test)</b>
          <div style={labelStyle}><span>{hipsHeight.toFixed(3)}m</span></div>
          <input type="range" min={-0.5} max={0.3} step={0.005} value={hipsHeight}
            onChange={e => setHipsHeight(Number(e.target.value))} style={sliderStyle} />
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
            下げると膝が曲がり足は地面に固定 = IK動作確認
          </div>
        </div>

        {/* Height scale */}
        <div style={{ marginBottom: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
          <b>Height Scale</b>
          <div style={labelStyle}>
            <span>{heightScale.toFixed(2)}x</span>
            <span>≈{(1.78 * heightScale).toFixed(2)}m</span>
          </div>
          <input type="range" min={0.5} max={2.0} step={0.01} value={heightScale}
            onChange={e => setHeightScale(Number(e.target.value))} style={sliderStyle} />
        </div>

        {/* ── Weapon Controls ── */}
        <div style={{ marginBottom: 8, borderTop: '1px solid #f80', paddingTop: 8 }}>
          <b style={{ color: '#f80' }}>Weapon (Step 2)</b>

          {/* Weapon source toggle */}
          <div style={{ marginTop: 4 }}>
            <label>
              <input type="radio" name="weaponSrc" checked={!useAssetWeapon}
                onChange={() => setUseAssetWeapon(false)} />
              {' '}テスト用ボックス
            </label>
            <label style={{ marginLeft: 8 }}>
              <input type="radio" name="weaponSrc" checked={useAssetWeapon}
                onChange={() => setUseAssetWeapon(true)} />
              {' '}Game Assets
            </label>
          </div>

          {/* Game-asset weapon selector */}
          {useAssetWeapon && availableWeapons.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <span>Weapon: </span>
              <select value={selectedAssetWeapon}
                onChange={e => setSelectedAssetWeapon(e.target.value)}
                style={{ width: '100%', background: '#333', color: '#fff', border: '1px solid #555', padding: 2 }}>
                {availableWeapons.map(w => (
                  <option key={`${w.category}/${w.pieceKey}`} value={`${w.category}/${w.pieceKey}`}>
                    {w.category}/{w.pieceKey}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Equip toggle */}
          <div style={{ marginTop: 4 }}>
            <label>
              <input type="checkbox" checked={weaponEquipped}
                onChange={e => setWeaponEquipped(e.target.checked)} />
              {' '}武器装備
            </label>
          </div>

          {weaponEquipped && (<>
            {/* Stance */}
            <div style={{ marginTop: 4 }}>
              <span>Stance: </span>
              <select value={stance} onChange={e => setStanceState(e.target.value as StanceType)}
                style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: 2 }}>
                <option value="front">正面に構える</option>
                <option value="side">右側面に下げる</option>
                <option value="overhead">頭上に振りかぶり</option>
              </select>
            </div>

            {/* Manual weapon controls (only for test box mode) */}
            {!useAssetWeapon && (<>
              {/* Grip type */}
              <div style={{ marginTop: 4 }}>
                <span>Grip: </span>
                <select value={gripType} onChange={e => setGripType(e.target.value as 'one-handed' | 'two-handed')}
                  style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: 2 }}>
                  <option value="one-handed">片手</option>
                  <option value="two-handed">両手</option>
                </select>
              </div>

              {/* Weight (仮値) */}
              <div style={{ marginTop: 4 }}>
                <div style={labelStyle}><span>Weight (仮): {weaponWeight.toFixed(1)}kg</span></div>
                <input type="range" min={0.5} max={10} step={0.1} value={weaponWeight}
                  onChange={e => setWeaponWeight(Number(e.target.value))} style={sliderStyle} />
              </div>

              {/* Length */}
              <div style={{ marginTop: 4 }}>
                <div style={labelStyle}><span>Length: {weaponLength.toFixed(2)}m</span></div>
                <input type="range" min={0.3} max={2.5} step={0.05} value={weaponLength}
                  onChange={e => setWeaponLength(Number(e.target.value))} style={sliderStyle} />
              </div>
            </>)}

            {/* Off-hand release (two-handed only) */}
            {gripType === 'two-handed' && (
              <div style={{ marginTop: 4 }}>
                <label>
                  <input type="checkbox" checked={offHandReleased}
                    onChange={e => setOffHandReleased(e.target.checked)} />
                  {' '}片手持ち切替 (リーチ拡張)
                </label>
              </div>
            )}

            {/* Swing target offsets */}
            <div style={{ marginTop: 6, borderTop: '1px solid #555', paddingTop: 4 }}>
              <b>Swing Target Offset</b>
              <div style={labelStyle}><span>X: {swingTargetX.toFixed(2)}</span></div>
              <input type="range" min={-1.5} max={1.5} step={0.02} value={swingTargetX}
                onChange={e => setSwingTargetX(Number(e.target.value))} style={sliderStyle} />
              <div style={labelStyle}><span>Y: {swingTargetY.toFixed(2)}</span></div>
              <input type="range" min={-1.5} max={1.5} step={0.02} value={swingTargetY}
                onChange={e => setSwingTargetY(Number(e.target.value))} style={sliderStyle} />
              <div style={labelStyle}><span>Z: {swingTargetZ.toFixed(2)}</span></div>
              <input type="range" min={-1.5} max={1.5} step={0.02} value={swingTargetZ}
                onChange={e => setSwingTargetZ(Number(e.target.value))} style={sliderStyle} />
            </div>

            {/* Swing button */}
            <div style={{ marginTop: 6 }}>
              <button
                onMouseDown={() => setSwingActive(true)}
                onMouseUp={() => setSwingActive(false)}
                onMouseLeave={() => setSwingActive(false)}
                style={{
                  width: '100%', padding: 8,
                  background: swingActive ? '#f44' : '#c33',
                  color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >{swingActive ? 'Swinging...' : 'Swing (hold)'}</button>
            </div>

            {/* HUD */}
            <div style={{ marginTop: 6, padding: 6, background: 'rgba(255,128,0,0.15)', borderRadius: 4 }}>
              <div style={{ fontSize: 11 }}>Tip Speed: <b>{tipSpeed.toFixed(2)}</b> m/s</div>
              <div style={{ fontSize: 11 }}>Power: <b>{swingPower.toFixed(2)}</b></div>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                Power = 先端移動距離 x weight (スイング中累積)
              </div>
            </div>
          </>)}
        </div>

        {/* Reset button */}
        <button
          onClick={() => {
            setRotX(0); setRotY(0); setRotZ(0); setPosX(0); setPosY(0); setPosZ(0);
            setHeightScale(1.0); setHipsHeight(0);
            setWeaponEquipped(false); setStanceState('front'); setOffHandReleased(false); setSwingActive(false);
            setSwingTargetX(0); setSwingTargetY(0); setSwingTargetZ(0);
          }}
          style={{ width: '100%', padding: 6, background: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >Reset All</button>
      </div>

      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
