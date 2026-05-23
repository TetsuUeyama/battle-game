'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  Color4,
  CreateLines,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type AnimationGroup,
  type Skeleton,
} from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

type GlbChoice = { label: string; file: string };
const GLB_CHOICES: GlbChoice[] = [
  { label: '★★ qm_skinned.glb (contactform 実利用 body)', file: 'qm_skinned_original.glb' },
  { label: '★ qm_default.glb (派生・Blender 未経由)', file: 'qm_default_original.glb' },
  { label: 'retargeted (qm_default + Snake)', file: 'snake_hiphop.glb' },
  { label: 'direct via Blender (mesh 無し)', file: 'snake_direct.glb' },
  { label: 'direct via FBX2glTF (mesh 無し)', file: 'snake_fbx2gltf.glb' },
];

/** Babylon.js convention (left-hand, Y-up, +Z forward).
 * The labels here describe how Babylon **renders** the world. */
const AXIS_LABELS: Array<{ dir: Vector3; label: string; color: Color3 }> = [
  { dir: new Vector3(1, 0, 0), label: '+X 右/Right', color: new Color3(1, 0.2, 0.2) },
  { dir: new Vector3(-1, 0, 0), label: '-X 左/Left', color: new Color3(0.6, 0.1, 0.1) },
  { dir: new Vector3(0, 1, 0), label: '+Y 上/Up', color: new Color3(0.2, 1, 0.2) },
  { dir: new Vector3(0, -1, 0), label: '-Y 下/Down', color: new Color3(0.1, 0.6, 0.1) },
  { dir: new Vector3(0, 0, 1), label: '+Z 前/Front', color: new Color3(0.3, 0.4, 1) },
  { dir: new Vector3(0, 0, -1), label: '-Z 後/Back', color: new Color3(0.1, 0.2, 0.6) },
];

function makeLabelPlane(scene: Scene, text: string, color: Color3, pos: Vector3): Mesh {
  const plane = MeshBuilder.CreatePlane(`lbl_${text}`, { width: 1.2, height: 0.4 }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.position = pos;
  const tex = new DynamicTexture(`tx_${text}`, { width: 384, height: 128 }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 384, 128);
  ctx.fillStyle = `rgba(0,0,0,0.6)`;
  ctx.fillRect(0, 0, 384, 128);
  ctx.fillStyle = `rgb(${(color.r * 255) | 0}, ${(color.g * 255) | 0}, ${(color.b * 255) | 0})`;
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 192, 64);
  tex.update();
  const mat = new StandardMaterial(`mat_${text}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  return plane;
}

function buildAxisGizmo(scene: Scene, radius: number) {
  const r = radius;
  for (const a of AXIS_LABELS) {
    const start = Vector3.Zero();
    const end = a.dir.scale(r);
    const line = CreateLines(`axis_${a.label}`, { points: [start, end] }, scene);
    line.color = a.color;
    makeLabelPlane(scene, a.label, a.color, end.scale(1.05));
  }
}

function computeBoundingInfo(meshes: AbstractMesh[]) {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  let usedMeshCount = 0;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    // Skinned meshes: refresh bbox using skeleton-transformed vertices
    m.refreshBoundingInfo({ applySkeleton: true });
    m.computeWorldMatrix(true);
    const bi = m.getBoundingInfo();
    const wmin = bi.boundingBox.minimumWorld;
    const wmax = bi.boundingBox.maximumWorld;
    if (!isFinite(wmin.x) || !isFinite(wmax.x)) continue;
    min = Vector3.Minimize(min, wmin);
    max = Vector3.Maximize(max, wmax);
    usedMeshCount++;
  }
  if (usedMeshCount === 0) {
    return { min: Vector3.Zero(), max: new Vector3(1, 1, 1), usedMeshCount: 0 };
  }
  return { min, max, usedMeshCount };
}

function dumpMeshInfo(meshes: AbstractMesh[]): string {
  const lines: string[] = [];
  for (const m of meshes) {
    const v = m.getTotalVertices ? m.getTotalVertices() : 0;
    const p = m.position;
    const s = m.scaling;
    lines.push(
      `${m.name} v=${v} pos=[${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}] scale=[${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}] vis=${m.isVisible} enabled=${m.isEnabled()}`,
    );
  }
  return lines.join('\n');
}

interface CharFacing {
  hipsY: number;
  forwardWorld: Vector3;
  upWorld: Vector3;
}

function probeCharacterFacing(skeletons: Skeleton[]): CharFacing | null {
  for (const sk of skeletons) {
    const hips = sk.bones.find((b) => b.name === 'Hips' || b.name === 'mixamorig:Hips');
    if (!hips) continue;
    const w = hips.getWorldMatrix();
    const forward = Vector3.TransformNormal(new Vector3(0, 0, 1), w).normalize();
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), w).normalize();
    return {
      hipsY: hips.getAbsolutePosition().y,
      forwardWorld: forward,
      upWorld: up,
    };
  }
  return null;
}

export default function SnakeTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading...');
  const [animNames, setAnimNames] = useState<string[]>([]);
  const [active, setActive] = useState<string>('');
  const [glbFile, setGlbFile] = useState<string>('qm_skinned_original.glb');
  const [rightHanded, setRightHanded] = useState<boolean>(false);
  const [bbox, setBbox] = useState<string>('');
  const [facing, setFacing] = useState<string>('');
  const [meshDump, setMeshDump] = useState<string>('');
  const groupsRef = useRef<Map<string, AnimationGroup>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.07, 0.07, 0.14, 1);
    scene.useRightHandedSystem = rightHanded;

    const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.4, 5, new Vector3(0, 1, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 500;
    camera.wheelDeltaPercentage = 0.02;
    camera.minZ = 0.05;
    camera.maxZ = 1000;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.7;
    const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.3), scene);
    sun.intensity = 0.6;

    // Floor (huge so it always shows under the character no matter the scale)
    const floor = MeshBuilder.CreateGround('floor', { width: 50, height: 50 }, scene);
    const floorMat = new StandardMaterial('floorMat', scene);
    floorMat.diffuseColor = new Color3(0.18, 0.18, 0.28);
    floor.material = floorMat;

    // World axis gizmo (will be rescaled after we know character size)
    let gizmoRadius = 2;
    buildAxisGizmo(scene, gizmoRadius);

    setStatus(`loading ${glbFile} ...`);
    setBbox('');
    setFacing('');

    SceneLoader.ImportMeshAsync('', '/motion-test/', glbFile, scene)
      .then((res: { meshes: AbstractMesh[]; animationGroups: AnimationGroup[]; skeletons: Skeleton[] }) => {
        if (cancelled) return;

        const groups = new Map<string, AnimationGroup>();
        for (const g of res.animationGroups) {
          g.stop();
          groups.set(g.name, g);
        }
        groupsRef.current = groups;
        const names = Array.from(groups.keys());
        setAnimNames(names);

        // Force all meshes visible / enabled
        for (const m of res.meshes) {
          m.isVisible = true;
          m.setEnabled(true);
        }
        setMeshDump(dumpMeshInfo(res.meshes));

        // Run animation 1 frame so skinned mesh bbox is meaningful
        const pickEarly = names.find((n) => n.toLowerCase().includes('snake')) ?? names[0];
        if (pickEarly) {
          const g = groups.get(pickEarly);
          if (g) {
            g.start(true);
            // Advance one render so skeleton applies
            scene.render();
          }
        }

        // Bounding box
        const info = computeBoundingInfo(res.meshes);
        const { min, max } = info;
        const size = max.subtract(min);
        const center = min.add(size.scale(0.5));
        const maxDim = Math.max(size.x, size.y, size.z);

        setBbox(
          `meshes_with_verts=${info.usedMeshCount} bbox min=[${min.x.toFixed(2)}, ${min.y.toFixed(2)}, ${min.z.toFixed(2)}] ` +
            `max=[${max.x.toFixed(2)}, ${max.y.toFixed(2)}, ${max.z.toFixed(2)}] ` +
            `size=[${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}]`
        );

        // Re-frame camera based on actual size
        camera.setTarget(new Vector3(center.x, center.y, center.z));
        camera.radius = Math.max(2, maxDim * 2.0);
        camera.upperRadiusLimit = Math.max(500, maxDim * 20);
        camera.lowerRadiusLimit = 0.1;
        camera.minZ = 0.01;
        camera.maxZ = Math.max(2000, maxDim * 20);

        // Rescale axis gizmo to ~ character height
        gizmoRadius = Math.max(1, maxDim * 0.7);
        // Clear and re-draw the gizmo at new scale
        for (const node of scene.meshes.filter((m) => m.name.startsWith('axis_') || m.name.startsWith('lbl_'))) {
          node.dispose();
        }
        buildAxisGizmo(scene, gizmoRadius);

        // Set active label (animation was already started above for bbox)
        if (pickEarly) {
          setActive(pickEarly);
        }

        setStatus(`loaded ${glbFile}: meshes=${res.meshes.length}, animations=${names.length}, skeletons=${res.skeletons.length}`);

        // Live-update character facing direction
        const updateFacing = () => {
          const f = probeCharacterFacing(res.skeletons);
          if (!f) return;
          setFacing(
            `Hips world: y=${f.hipsY.toFixed(2)}  ` +
              `forward(localZ)=[${f.forwardWorld.x.toFixed(2)}, ${f.forwardWorld.y.toFixed(2)}, ${f.forwardWorld.z.toFixed(2)}]  ` +
              `up(localY)=[${f.upWorld.x.toFixed(2)}, ${f.upWorld.y.toFixed(2)}, ${f.upWorld.z.toFixed(2)}]`
          );
        };
        scene.onBeforeRenderObservable.add(updateFacing);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setStatus(`ERROR: ${e?.message ?? e}`);
      });

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      scene.dispose();
      engine.dispose();
    };
  }, [glbFile, rightHanded]);

  const play = (name: string) => {
    const groups = groupsRef.current;
    for (const g of groups.values()) g.stop();
    const g = groups.get(name);
    if (g) {
      g.start(true);
      setActive(name);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', color: '#eee', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute', top: 12, left: 12, fontFamily: 'monospace', fontSize: 11,
          background: 'rgba(0,0,0,0.7)', padding: 10, borderRadius: 8, maxWidth: 520,
          lineHeight: 1.5,
        }}
      >
        <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 'bold' }}>Mixamo retarget test</div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
          <button
            onClick={() => setRightHanded(false)}
            style={{
              background: !rightHanded ? '#22aa66' : '#333',
              color: '#fff', border: 'none', padding: '4px 10px',
              borderRadius: 4, cursor: 'pointer', fontSize: 11,
            }}
          >
            左手系 (Babylon default)
          </button>
          <button
            onClick={() => setRightHanded(true)}
            style={{
              background: rightHanded ? '#22aa66' : '#333',
              color: '#fff', border: 'none', padding: '4px 10px',
              borderRadius: 4, cursor: 'pointer', fontSize: 11,
            }}
          >
            右手系 (glTF native)
          </button>
        </div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {GLB_CHOICES.map((c) => (
            <button
              key={c.file}
              onClick={() => setGlbFile(c.file)}
              style={{
                background: c.file === glbFile ? '#ff7755' : '#333',
                color: '#fff', border: 'none', padding: '4px 8px',
                borderRadius: 4, cursor: 'pointer', fontSize: 11,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ color: '#9d9' }}>{status}</div>
        <div style={{ color: '#ccc', marginTop: 4, fontSize: 10 }}>{bbox}</div>
        <div style={{ color: '#fc9', marginTop: 4, fontSize: 10 }}>{facing}</div>
        {meshDump && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ fontSize: 10, color: '#9cf', cursor: 'pointer' }}>mesh dump</summary>
            <pre style={{ fontSize: 9, color: '#bbb', margin: 0, maxHeight: 180, overflowY: 'auto' }}>{meshDump}</pre>
          </details>
        )}
        {active && <div style={{ marginTop: 6 }}>active: <b>{active}</b></div>}
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {animNames.map((n) => (
            <button
              key={n}
              onClick={() => play(n)}
              style={{
                background: n === active ? '#5577ff' : '#333',
                color: '#fff', border: 'none', padding: '4px 8px',
                borderRadius: 4, cursor: 'pointer', fontSize: 11,
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, color: '#aaa', fontSize: 10 }}>
          Babylon.js (左手系, Y-up, +Z forward) の世界軸を表示しています。
          <br />
          赤=±X (右/左), 緑=±Y (上/下), 青=±Z (前/後)
        </div>
      </div>
    </div>
  );
}
