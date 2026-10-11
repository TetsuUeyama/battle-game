'use client';

// box5 の新モデル (qm_mustardui) を battle-game 自前の voxel パイプライン
// (vox-parser + greedy-mesh) で直接読み込んで表示する。GLB / born-editer は不使用。
// アセットは /api/game-assets/vox-model/box5/<id>/ (= game-assets) から取得。

import { useEffect, useRef, useState } from 'react';
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine,
  HemisphericLight, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3,
} from '@babylonjs/core';
import { buildGreedyMesh } from '@/lib/greedy-mesh';
import { loadVoxFile } from '@/lib/vox-parser';

// darkelfblader_arp は単一 body.vox を持たず chunk (body_c*.vox) 形式のため
// 現状は body.vox を持つ qm_mustardui のみ対応 (chunk 読み込みは後続)。
type CharId = 'qm_mustardui';
const CHARS: Record<CharId, { label: string; parts: string[] }> = {
  qm_mustardui: { label: 'QM Mustard UI', parts: ['body', 'hair'] },
};
const baseUrl = (id: CharId) => `/api/game-assets/vox-model/box5/${id}`;

export default function QmModelPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [charId, setCharId] = useState<CharId>('qm_mustardui');
  const [status, setStatus] = useState('loading...');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.07, 0.07, 0.14, 1);
    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2.3, 4, new Vector3(0, 1.2, 0), scene);
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.02;
    camera.minZ = 0.01;
    new HemisphericLight('h', new Vector3(0, 1, 0), scene).intensity = 0.85;
    const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.3), scene);
    sun.intensity = 0.6;
    const floor = MeshBuilder.CreateGround('floor', { width: 50, height: 50 }, scene);
    const fm = new StandardMaterial('fm', scene); fm.diffuseColor = new Color3(0.18, 0.18, 0.28); floor.material = fm;

    const base = baseUrl(charId);
    setStatus(`loading ${charId} ...`);

    (async () => {
      try {
        const grid: { gx: number; gy: number; gz: number } = await fetch(`${base}/grid.json`).then((r) => {
          if (!r.ok) throw new Error(`grid.json ${r.status}`);
          return r.json();
        });
        const meshes: Mesh[] = [];
        let totalVerts = 0;
        for (const part of CHARS[charId].parts) {
          try {
            const { voxels } = await loadVoxFile(`${base}/${part}.vox`);
            if (cancelled) return;
            const m = buildGreedyMesh(voxels, scene, `${charId}_${part}`, grid.gx, grid.gy, grid.gz);
            totalVerts += m.getTotalVertices();
            meshes.push(m);
          } catch (e) {
            console.warn(`part ${part} skipped:`, e);
          }
        }
        if (cancelled) return;
        scene.render();
        frameCamera(camera, meshes);
        setStatus(`loaded ${charId}: parts=${meshes.length}, verts=${totalVerts}, grid=${grid.gx}×${grid.gy}×${grid.gz}`);
      } catch (e) {
        if (cancelled) return;
        setStatus(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
        console.error('[qm-model]', e);
      }
    })();

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => { cancelled = true; window.removeEventListener('resize', onResize); scene.dispose(); engine.dispose(); };
  }, [charId]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', color: '#eee', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'absolute', top: 12, left: 12, fontFamily: 'monospace', fontSize: 12, background: 'rgba(0,0,0,0.7)', padding: 12, borderRadius: 8 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 6 }}>QM Model Viewer (box5 voxel, battle-game native)</div>
        <select
          value={charId}
          onChange={(e) => setCharId(e.target.value as CharId)}
          style={{ background: '#222', color: '#eee', padding: '4px 8px', fontFamily: 'monospace', marginBottom: 8 }}
        >
          {Object.entries(CHARS).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
        </select>
        <div style={{ color: '#9d9' }}>{status}</div>
        <div style={{ color: '#888', fontSize: 10, marginTop: 6 }}>
          src: /api/game-assets/vox-model/box5/{charId}（vox-parser + greedy-mesh）
        </div>
      </div>
    </div>
  );
}

function frameCamera(camera: ArcRotateCamera, meshes: Mesh[]) {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  let used = 0;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    m.computeWorldMatrix(true);
    const bi = m.getBoundingInfo();
    min = Vector3.Minimize(min, bi.boundingBox.minimumWorld);
    max = Vector3.Maximize(max, bi.boundingBox.maximumWorld);
    used++;
  }
  if (!used) return;
  const size = max.subtract(min);
  const center = min.add(size.scale(0.5));
  const maxDim = Math.max(size.x, size.y, size.z) || 2;
  camera.setTarget(center);
  camera.radius = maxDim * 1.7;
  camera.lowerRadiusLimit = 0.1;
  camera.upperRadiusLimit = maxDim * 20;
}
