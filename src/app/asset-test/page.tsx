'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  type AbstractMesh,
} from '@babylonjs/core';

import {
  UnityAssetLoader,
  validateBoneMapping,
  type Animator,
  type LoadedUnityAsset,
} from '@/runtime';

/**
 * Unity アセットパイプライン E2E デモ。
 *
 * public/assets/assets-manifest.json を起点に UnityAssetLoader で
 * GLB + animator.json + bone-mapping.json を読み込み、構築された Animator を
 * パラメータ操作で駆動する。AnimatorController のステートマシン
 * (Idle/Walk/Dance/Punch、クロスフェード遷移) がそのまま再生される。
 */
export default function AssetTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animatorRef = useRef<Animator | null>(null);

  const [status, setStatus] = useState('loading...');
  const [clips, setClips] = useState<string[]>([]);
  const [currentState, setCurrentState] = useState('');
  const [boneInfo, setBoneInfo] = useState('');
  const [walking, setWalking] = useState(false);
  const [dancing, setDancing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.07, 0.07, 0.14, 1);

    // キャラは +Z を向いている。alpha=+π/2 で +Z 側(正面)から見る
    // (alpha=-π/2 だと背面を映し、左右の手足が反転して見えてしまう)
    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2.3, 5, new Vector3(0, 1, 0), scene);
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.02;
    camera.minZ = 0.05;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.75;
    const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.3), scene);
    sun.intensity = 0.6;

    const floor = MeshBuilder.CreateGround('floor', { width: 50, height: 50 }, scene);
    const floorMat = new StandardMaterial('floorMat', scene);
    floorMat.diffuseColor = new Color3(0.18, 0.18, 0.28);
    floor.material = floorMat;

    const loader = new UnityAssetLoader({ baseUrl: '/assets/' });

    loader
      .load(scene, 'snake')
      .then((asset: LoadedUnityAsset) => {
        if (cancelled) {
          asset.animator?.dispose();
          return;
        }

        animatorRef.current = asset.animator ?? null;
        setClips(asset.animator?.getAvailableClips().slice() ?? []);

        // bone-mapping の必須ボーン充足チェック
        if (asset.boneMapping) {
          const v = validateBoneMapping(asset.boneMapping);
          setBoneInfo(
            v.ok
              ? `bone-mapping OK (${Object.keys(asset.boneMapping.bones).length} bones, rig="${asset.boneMapping.rigType}")`
              : `bone-mapping issues: ${v.issues.map((i) => `${i.bone}:${i.reason}`).join(', ')}`,
          );
        } else {
          setBoneInfo('bone-mapping: none');
        }

        // 1フレーム進めてスキン適用後に bbox を取りカメラを合わせる
        scene.render();
        frameCamera(camera, asset.meshes);

        setStatus(
          `loaded: meshes=${asset.meshes.length}, clips=${asset.animator?.getAvailableClips().length ?? 0}, animator=${asset.animator ? 'yes' : 'no'}`,
        );
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setStatus(`ERROR: ${e?.message ?? e}`);
      });

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    // 現在ステートを定期ポーリングで表示
    const poll = window.setInterval(() => {
      const a = animatorRef.current;
      if (a) setCurrentState(a.getCurrentState() ?? '');
    }, 150);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('resize', onResize);
      animatorRef.current?.dispose();
      animatorRef.current = null;
      scene.dispose();
      engine.dispose();
    };
  }, []);

  const toggleWalk = () => {
    const next = !walking;
    setWalking(next);
    animatorRef.current?.setFloat('speed', next ? 1.5 : 0);
  };

  const toggleDance = () => {
    const next = !dancing;
    setDancing(next);
    animatorRef.current?.setBool('dance', next);
  };

  const punch = () => {
    animatorRef.current?.setTrigger('punch');
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', color: '#eee', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <div
        style={{
          position: 'absolute', top: 12, left: 12, fontFamily: 'monospace', fontSize: 12,
          background: 'rgba(0,0,0,0.72)', padding: 12, borderRadius: 8, maxWidth: 460, lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 6 }}>Unity Asset Pipeline — E2E</div>
        <div style={{ color: '#9ad', fontSize: 10, marginBottom: 8 }}>
          assets-manifest.json → UnityAssetLoader → Animator(AnimatorController)
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={toggleWalk} style={btn(walking ? '#22aa66' : '#333')}>
            {walking ? 'Stop (speed=0)' : 'Walk (speed=1.5)'}
          </button>
          <button onClick={toggleDance} style={btn(dancing ? '#aa55cc' : '#333')}>
            {dancing ? 'Stop Dance' : 'Dance'}
          </button>
          <button onClick={punch} style={btn('#cc5544')}>
            Punch (trigger)
          </button>
        </div>

        <div style={{ color: '#9d9' }}>{status}</div>
        <div style={{ marginTop: 4 }}>
          current state: <b style={{ color: '#ffd479' }}>{currentState || '—'}</b>
        </div>
        <div style={{ color: '#ccc', marginTop: 4, fontSize: 11 }}>{boneInfo}</div>

        {clips.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#aaa' }}>
            clips: {clips.join(', ')}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 10, color: '#888' }}>
          Walk/Dance はパラメータ条件で遷移、Punch は AnyState からのトリガ遷移
          （再生後 exitTime で Idle へ自動復帰）。すべて animator.json 定義のクロスフェードです。
        </div>
      </div>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', padding: '6px 10px',
    borderRadius: 4, cursor: 'pointer', fontSize: 11,
  };
}

/** スキン適用後の全メッシュからワールド bbox を取り、カメラを合わせる。 */
function frameCamera(camera: ArcRotateCamera, meshes: AbstractMesh[]) {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  let used = 0;
  for (const m of meshes) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) continue;
    m.refreshBoundingInfo({ applySkeleton: true });
    m.computeWorldMatrix(true);
    const bi = m.getBoundingInfo();
    const wmin = bi.boundingBox.minimumWorld;
    const wmax = bi.boundingBox.maximumWorld;
    if (!isFinite(wmin.x) || !isFinite(wmax.x)) continue;
    min = Vector3.Minimize(min, wmin);
    max = Vector3.Maximize(max, wmax);
    used++;
  }
  if (used === 0) return;

  const size = max.subtract(min);
  const center = min.add(size.scale(0.5));
  const maxDim = Math.max(size.x, size.y, size.z) || 2;

  camera.setTarget(center);
  camera.radius = Math.max(2, maxDim * 1.8);
  camera.lowerRadiusLimit = 0.1;
  camera.upperRadiusLimit = Math.max(500, maxDim * 20);
  camera.minZ = 0.01;
  camera.maxZ = Math.max(2000, maxDim * 20);
}
