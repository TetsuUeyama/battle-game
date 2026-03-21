'use client';

import { useRef, useEffect, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color4, Color3, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';
import { loadVoxFile, SCALE } from '@/lib/vox-parser';
import { buildGreedyMesh } from '@/lib/greedy-mesh';

const VILLAGE_BASE = '/api/game-assets/field/village';

interface TileEntry {
  id: string;
  gridX: number;
  gridZ: number;
  voxelSize: number;
  terrainScale: number;
  gamePosition: { x: number; z: number };
}

interface VillageLayout {
  tileGrid: number;
  tileResolution: number;
  fieldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  tiles: TileEntry[];
}

export default function FieldViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [status, setStatus] = useState('Loading layout...');
  const [stats, setStats] = useState('');
  const [tileStates, setTileStates] = useState<Record<string, string>>({});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || engineRef.current) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    engineRef.current = engine;
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.5, 0.7, 0.9, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 4, Math.PI / 3.5, 30, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 1;
    camera.upperRadiusLimit = 200;
    camera.wheelPrecision = 10;

    const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.2), scene);
    light.intensity = 1.2;
    light.groundColor = new Color3(0.3, 0.3, 0.3);

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    (async () => {
      let layout: VillageLayout;
      try {
        const resp = await fetch(`${VILLAGE_BASE}/layout.json?v=${Date.now()}`);
        layout = await resp.json();
      } catch {
        setStatus('Failed to load layout.json');
        return;
      }

      // Calculate field center from gamePositions for camera
      const positions = layout.tiles.map(t => t.gamePosition);
      const tileScale = layout.tiles[0].terrainScale / SCALE;
      const tileSizeGame = (layout.tileResolution + 1) * layout.tiles[0].terrainScale;
      const allX = positions.map(p => p.x);
      const allZ = positions.map(p => p.z);
      const centerX = (Math.min(...allX) + Math.max(...allX) + tileSizeGame) / 2;
      const centerZ = (Math.min(...allZ) + Math.max(...allZ) - tileSizeGame) / 2;
      const fieldWidth = Math.max(...allX) - Math.min(...allX) + tileSizeGame;

      camera.target = new Vector3(centerX, 0, centerZ);
      camera.radius = fieldWidth * 1.2;

      setStatus(`Loading ${layout.tiles.length} tiles (greedy mesh)...`);

      const states: Record<string, string> = {};
      let totalVoxels = 0;
      let totalFaces = 0;

      for (const tile of layout.tiles) {
        states[tile.id] = 'loading';
        setTileStates({ ...states });

        try {
          const t0 = performance.now();
          const { model, voxels } = await loadVoxFile(`${VILLAGE_BASE}/tiles/${tile.id}.vox`);
          totalVoxels += voxels.length;

          const mesh = buildGreedyMesh(voxels, scene, tile.id, model.sizeX, model.sizeY, model.sizeZ);
          const faceCount = mesh.getTotalIndices() / 3;
          totalFaces += faceCount;

          // Use gamePosition and terrainScale from layout
          const s = tile.terrainScale / SCALE;
          mesh.position.set(tile.gamePosition.x, 0, tile.gamePosition.z);
          mesh.scaling.setAll(s);

          const ms = (performance.now() - t0).toFixed(0);
          states[tile.id] = 'done';
          setStatus(`${tile.id}: ${voxels.length.toLocaleString()} voxels → ${faceCount.toLocaleString()} faces (${ms}ms)`);
        } catch (e) {
          states[tile.id] = 'error';
          console.error(`Failed to load ${tile.id}:`, e);
        }
        setTileStates({ ...states });
      }

      const doneCount = Object.values(states).filter(s => s === 'done').length;
      const ratio = totalVoxels > 0 ? (totalFaces / (totalVoxels * 3) * 100).toFixed(1) : '0';
      setStatus(`Loaded ${doneCount}/${layout.tiles.length} tiles`);
      setStats(`${totalVoxels.toLocaleString()} voxels → ${totalFaces.toLocaleString()} faces (${ratio}% of naive)`);
    })();

    return () => {
      window.removeEventListener('resize', onResize);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '8px 16px',
        background: 'rgba(0,0,0,0.6)',
        color: '#fff', fontSize: 14,
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <span style={{ fontWeight: 'bold' }}>Field Viewer</span>
        <span>{status}</span>
        {stats && <span style={{ color: '#4f4' }}>{stats}</span>}
      </div>

      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'grid', gridTemplateColumns: 'repeat(4, 28px)', gap: 3,
      }}>
        {Array.from({ length: 16 }, (_, i) => {
          const gx = i % 4;
          const gz = Math.floor(i / 4);
          const id = `tile_${gx}_${gz}`;
          const st = tileStates[id];
          const bg = st === 'done' ? '#4c4' : st === 'loading' ? '#fc4' : st === 'error' ? '#f44' : '#555';
          return (
            <div key={id} style={{
              width: 28, height: 28, background: bg, borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, color: '#000', fontWeight: 'bold',
            }}>
              {gx},{gz}
            </div>
          );
        })}
      </div>
    </div>
  );
}
