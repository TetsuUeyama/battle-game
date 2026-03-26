'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh,
} from '@babylonjs/core';

interface BoneEntry {
  name: string;
  parent: string | null;
  worldPosition: [number, number, number];
}

export default function BoneCheckPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.12, 0.12, 0.18, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3, 3.5, new Vector3(0, 0.9, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 10;
    camera.wheelPrecision = 30;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.6;
    new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.7;

    // Ground
    const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.3, 0.3, 0.25);
    ground.material = gMat;

    (async () => {
      const res = await fetch('/api/game-assets/characters/mixamo-ybot/bone-data.json');
      const data = await res.json();
      const bones: BoneEntry[] = data.bones;

      // Build parent lookup
      const boneByName = new Map<string, BoneEntry>();
      for (const b of bones) boneByName.set(b.name, b);

      const jointMat = new StandardMaterial('jointMat', scene);
      jointMat.diffuseColor = new Color3(0.2, 0.8, 0.3);

      const lineMat = new StandardMaterial('lineMat', scene);
      lineMat.diffuseColor = new Color3(1, 1, 0);

      for (const bone of bones) {
        const [x, y, z] = bone.worldPosition;

        // Joint sphere
        const sphere = MeshBuilder.CreateSphere(bone.name, { diameter: 0.025 }, scene);
        sphere.position.set(x, y, z);
        sphere.material = jointMat;

        // Line to parent
        if (bone.parent) {
          const parentBone = boneByName.get(bone.parent);
          if (parentBone) {
            const [px, py, pz] = parentBone.worldPosition;
            const line = MeshBuilder.CreateLines(`line_${bone.name}`, {
              points: [new Vector3(x, y, z), new Vector3(px, py, pz)],
            }, scene);
            line.color = new Color3(1, 1, 0);
          }
        }
      }

      setStatus(`${bones.length} bones loaded — drag to rotate, scroll to zoom`);
    })();

    engine.runRenderLoop(() => scene.render());
    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); engine.dispose(); };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#1a1a2e' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '8px 16px', background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 13,
      }}>
        Bone Data Verification | {status}
      </div>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
