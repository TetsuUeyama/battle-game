'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Vector3, Color3, TransformNode, Quaternion } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { startJump } from '@/lib/havok-character/character';
import type { HavokCharacter } from '@/lib/havok-character/types';
import {
  useHavokTestState, initScene, useSyncEffects,
  storeBaseValues as storeBase,
  BonePanel, WeaponPanel, DebugPanel, TabContainer,
} from '@/lib/havok-test';
import type { BoneRefs, SceneControls } from '@/lib/havok-test';

export default function HavokTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [s, a] = useHavokTestState();

  const characterRef = useRef<HavokCharacter | null>(null);
  const boneVisRef = useRef<Map<string, TransformNode> | null>(null);
  const baseRotationsRef = useRef<Map<string, Quaternion>>(new Map());
  const basePositionsRef = useRef<Map<string, Vector3>>(new Map());
  const visBasePositionsRef = useRef<Map<string, Vector3>>(new Map());
  const sceneRef = useRef<Scene | null>(null);
  const bodyColorRef = useRef(new Color3(0.2, 0.35, 0.8));
  const controlsRef = useRef<SceneControls | null>(null);

  const boneRefs: BoneRefs = { characterRef, boneVisRef, baseRotationsRef, basePositionsRef };
  const storeBaseValues = useCallback((boneName: string) => storeBase(boneName, boneRefs), []);
  const handleBoneSelect = useCallback((boneName: string) => {
    a.setSelectedBone(boneName);
    a.setRotX(0); a.setRotY(0); a.setRotZ(0);
    a.setPosX(0); a.setPosY(0); a.setPosZ(0);
    storeBaseValues(boneName);
  }, [storeBaseValues, a]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cleanup, controls } = initScene(canvas,
      { characterRef, boneVisRef, visBasePositionsRef, sceneRef },
      { setStatus: a.setStatus, setJointAngles: a.setJointAngles, setMotionTestPlaying: a.setMotionTestPlaying, setTipSpeed: a.setTipSpeed, setSwingPower: a.setSwingPower, setAiState: a.setAiState, storeBaseValues },
    );
    controlsRef.current = controls;
    return cleanup;
  }, [storeBaseValues]);

  useSyncEffects({ s, a, boneRefs, sceneRef, controlsRef, visBasePositionsRef, bodyColorRef, storeBaseValues });

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#1a1a2e' }}>
      {/* Header */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: '8px 16px', background: 'rgba(0,0,0,0.85)', color: '#fff', fontSize: 13 }}>
        <b>Havok Test</b> — {s.status}
      </div>

      {/* Side panel with tabs */}
      <div style={{ position: 'absolute', right: 0, top: 44, width: 320, bottom: 0, zIndex: 10, background: 'rgba(0,0,0,0.9)', color: '#fff', padding: '8px 12px' }}>
        <TabContainer
          defaultTab="bone"
          tabs={[
            {
              id: 'bone', label: 'Bone', color: '#8f8',
              content: <BonePanel state={s} actions={a} onBoneSelect={handleBoneSelect} />,
            },
            {
              id: 'weapon', label: 'Weapon', color: '#f80',
              content: <WeaponPanel state={s} actions={a} onAttack={(t, p) => controlsRef.current?.startAttack(t, p)} />,
            },
            {
              id: 'debug', label: 'Debug', color: '#0af',
              content: <DebugPanel state={s} actions={a} characterRef={characterRef} onJump={() => { const c = characterRef.current; if (c) startJump(c); }} />,
            },
          ]}
        />
      </div>

      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
