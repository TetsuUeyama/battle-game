'use client';

/**
 * モーション一覧ビューア (/motions)
 *
 * FAP (fightingGamesystem) の全アニメ GLB のクリップを 1 つずつ Maskman モデルで
 * 再生して確認するための開発用ページ。対戦ロジック (Fighter / CombatController) は
 * 一切通さず、リターゲット済み AnimationGroup をそのまま再生する。
 *
 * - クリップ一覧は assets-manifest.json を実行時に取得して作る (手書きリストを持たない)。
 * - モデル GLB は 1 回だけロードし、アニメ GLB はカテゴリを選んだときに遅延ロードして
 *   既存リグへバインドする (preloadAnimations().bindTo)。読み込み済みカテゴリはキャッシュ。
 * - カメラは +Z 側 = 正面から見る (キャラは +Z 向き。alpha=-π/2 だと背面を映して
 *   左右が反転して見える — asset-test と同じ理由)。
 * - FAP クリップは in-place (Root 曲線が全キー 0) なので、その場で再生される。
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Node as BabylonNode } from '@babylonjs/core/node';
import '@babylonjs/loaders/glTF';

import { loadFightingCharacter, preloadAnimations, type CharacterRig } from '@/fighting';
import { MODEL_GLB_PATH } from '../fight/moves';

const ASSET_BASE = '/api/game-assets/fightingGamesystem/assets/';

/** 一覧から除くクリップ (モーションではない) */
const NON_MOTION_CLIPS = new Set(['BindPose', 'tpose', 'TPose', 'T-Pose']);

interface ManifestAsset {
  id: string;
  glbPath: string;
  animationClips: string[];
}

interface Category {
  id: string;
  glbPath: string;
  clips: string[];
}

export default function MotionList() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameTextRef = useRef<HTMLSpanElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);

  // Babylon 側の保持物 (再レンダリングと無関係なので ref)
  const sceneRef = useRef<Scene | null>(null);
  const targetNodesRef = useRef<BabylonNode[]>([]);
  /** カテゴリ id → (クリップ名 → AnimationGroup)。バインド済みのキャッシュ */
  const boundRef = useRef<Map<string, Map<string, AnimationGroup>>>(new Map());
  const currentGroupRef = useRef<AnimationGroup | null>(null);
  const loopRef = useRef(true);
  const speedRef = useRef(1);
  const seekingRef = useRef(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [clipName, setClipName] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('モデル読み込み中...');
  const [modelReady, setModelReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [range, setRange] = useState<{ from: number; to: number; fps: number } | null>(null);

  // --------------------------------------------------------------- Babylon 初期化

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    sceneRef.current = scene;
    scene.clearColor = new Color4(0.07, 0.08, 0.12, 1);

    // キャラは +Z を向いている。alpha=+π/2 で +Z 側 (正面) から見る
    const camera = new ArcRotateCamera(
      'cam', Math.PI / 2, Math.PI / 2.35, 4.2, new Vector3(0, 1, 0), scene,
    );
    camera.attachControl(canvas, true);
    camera.wheelDeltaPercentage = 0.02;
    camera.minZ = 0.05;
    camera.lowerRadiusLimit = 1;
    camera.upperRadiusLimit = 20;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.8;
    const dir = new DirectionalLight('dir', new Vector3(-0.4, -1, 0.5), scene);
    dir.intensity = 1.1;

    const ground = MeshBuilder.CreateGround('ground', { width: 8, height: 8 }, scene);
    const gm = new StandardMaterial('groundMat', scene);
    gm.diffuseColor = new Color3(0.16, 0.17, 0.22);
    gm.specularColor = new Color3(0, 0, 0);
    ground.material = gm;
    ground.isPickable = false;

    // 正面 (+Z) の目印。向きの取り違えを目視で防ぐ
    const marker = MeshBuilder.CreateBox('frontMarker', { width: 0.5, height: 0.02, depth: 0.08 }, scene);
    marker.position = new Vector3(0, 0.01, 1.2);
    const mm = new StandardMaterial('frontMat', scene);
    mm.emissiveColor = new Color3(0.2, 0.7, 1);
    mm.disableLighting = true;
    marker.material = mm;
    marker.isPickable = false;

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    // 再生位置の表示は毎フレーム DOM を直接更新する (React 再描画を避ける)
    const frameObserver = scene.onBeforeRenderObservable.add(() => {
      const g = currentGroupRef.current;
      if (!g) return;
      const cur = g.getCurrentFrame();
      if (frameTextRef.current) {
        frameTextRef.current.textContent = `${cur.toFixed(1)} / ${g.to.toFixed(0)}`;
      }
      if (seekRef.current && !seekingRef.current) {
        seekRef.current.value = String(cur);
      }
    });

    // マニフェスト取得 → モデルロード
    (async () => {
      try {
        const res = await fetch(`${ASSET_BASE}assets-manifest.json`);
        if (!res.ok) throw new Error(`assets-manifest.json: HTTP ${res.status}`);
        const manifest = (await res.json()) as { assets: ManifestAsset[] };
        if (cancelled) return;

        const cats: Category[] = manifest.assets
          .map((a) => ({
            id: a.id,
            glbPath: a.glbPath,
            clips: (a.animationClips ?? []).filter((c) => !NON_MOTION_CLIPS.has(c)),
          }))
          .filter((c) => c.clips.length > 0);
        setCategories(cats);

        setStatus('Maskman モデルを読み込み中...');
        const character = await loadFightingCharacter(scene, {
          modelGlbPath: MODEL_GLB_PATH,
          baseUrl: ASSET_BASE,
        });
        if (cancelled) return;

        const rig: CharacterRig = character.rig;
        // リターゲット先 = モデル側の全ノード (loadFightingCharacter と同じ組み立て)
        targetNodesRef.current = [...rig.nodesByName.values(), ...rig.meshes];
        setModelReady(true);
        setStatus(`モデル OK (ボーン ${rig.nodesByName.size}) — カテゴリを選んでください`);
      } catch (e) {
        if (!cancelled) setStatus(`読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      scene.onBeforeRenderObservable.remove(frameObserver);
      window.removeEventListener('resize', onResize);
      currentGroupRef.current = null;
      boundRef.current.clear();
      targetNodesRef.current = [];
      sceneRef.current = null;
      scene.dispose();
      engine.dispose();
    };
  }, []);

  // --------------------------------------------------------------- 再生制御

  const playClip = useCallback((name: string, cid: string) => {
    const group = boundRef.current.get(cid)?.get(name);
    if (!group) return;

    const prev = currentGroupRef.current;
    if (prev && prev !== group) prev.stop();
    currentGroupRef.current = group;

    const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    setRange({ from: group.from, to: group.to, fps });
    setClipName(name);

    group.start(loopRef.current, speedRef.current, group.from, group.to, false);
    group.setWeightForAllAnimatables(1);
    setPlaying(true);
  }, []);

  /** カテゴリを選ぶ (未バインドならアニメ GLB を読んでバインド) */
  const selectCategory = useCallback(async (cat: Category) => {
    const scene = sceneRef.current;
    if (!scene || busy) return;

    setCategoryId(cat.id);
    setFilter('');

    const cached = boundRef.current.get(cat.id);
    if (cached) {
      setClipNames([...cached.keys()]);
      setStatus(`${cat.id}: ${cached.size} クリップ (キャッシュ)`);
      return;
    }

    setBusy(true);
    setStatus(`${cat.id} を読み込み中...`);
    try {
      const preloaded = await preloadAnimations(scene, [cat.glbPath], { baseUrl: ASSET_BASE });
      const bound = preloaded.bindTo(targetNodesRef.current);
      // ソース GLB はバインド (clone) 済みなので破棄してよい
      preloaded.dispose();

      const map = new Map<string, AnimationGroup>();
      for (const [name, g] of bound.clips) {
        if (NON_MOTION_CLIPS.has(name)) { g.dispose(); continue; }
        g.stop();
        map.set(name, g);
      }
      boundRef.current.set(cat.id, map);
      setClipNames([...map.keys()]);

      const stat = bound.stats[0];
      setStatus(
        `${cat.id}: ${map.size} クリップ` +
        (stat ? ` / リターゲット ${stat.groups.length} グループ` : ''),
      );
    } catch (e) {
      setStatus(`${cat.id} 読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const togglePlay = useCallback(() => {
    const g = currentGroupRef.current;
    if (!g) return;
    if (g.isPlaying) {
      g.pause();
      setPlaying(false);
    } else {
      g.play(loopRef.current);
      setPlaying(true);
    }
  }, []);

  const restart = useCallback(() => {
    const g = currentGroupRef.current;
    if (!g) return;
    g.start(loopRef.current, speedRef.current, g.from, g.to, false);
    g.setWeightForAllAnimatables(1);
    setPlaying(true);
  }, []);

  /** 一覧内で前後のクリップへ移動 (1 つずつ確認する用) */
  const step = useCallback((delta: number) => {
    if (!categoryId || !clipName) return;
    const list = clipNames.filter((n) => !filter || n.toLowerCase().includes(filter.toLowerCase()));
    const i = list.indexOf(clipName);
    if (i < 0) return;
    const next = list[i + delta];
    if (next) playClip(next, categoryId);
  }, [categoryId, clipName, clipNames, filter, playClip]);

  // URL の ?cat=&clip= で初期選択 (hydration 不一致を避けるため必ず effect 内で読む)
  const autoDoneRef = useRef(false);
  useEffect(() => {
    if (autoDoneRef.current || !modelReady || categories.length === 0) return;
    const q = new URLSearchParams(window.location.search);
    const cat = q.get('cat');
    if (!cat) { autoDoneRef.current = true; return; }
    const target = categories.find((c) => c.id === cat);
    if (!target) { autoDoneRef.current = true; return; }
    autoDoneRef.current = true;
    const wanted = q.get('clip');
    void selectCategory(target).then(() => {
      const map = boundRef.current.get(target.id);
      if (!map) return;
      const name = wanted && map.has(wanted) ? wanted : [...map.keys()][0];
      if (name) playClip(name, target.id);
    });
  }, [modelReady, categories, selectCategory, playClip]);

  // loop / speed の変更を再生中のグループへ反映
  useEffect(() => {
    loopRef.current = loop;
    const g = currentGroupRef.current;
    if (g) g.loopAnimation = loop;
  }, [loop]);

  useEffect(() => {
    speedRef.current = speed;
    const g = currentGroupRef.current;
    if (g) g.speedRatio = speed;
  }, [speed]);

  // キーボード: ↑↓ で前後のクリップ、Space で再生/一時停止
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, togglePlay]);

  const visibleClips = clipNames.filter(
    (n) => !filter || n.toLowerCase().includes(filter.toLowerCase()),
  );
  const totalClips = categories.reduce((s, c) => s + c.clips.length, 0);
  const durationSec = range ? (range.to - range.from) / range.fps : 0;

  // --------------------------------------------------------------- UI

  return (
    <div style={S.page}>
      <aside style={S.side}>
        <h1 style={S.title}>モーション一覧</h1>
        <div style={S.sub}>
          FAP {categories.length} カテゴリ / 全 {totalClips} クリップ
        </div>

        <div style={S.sectionLabel}>カテゴリ (GLB)</div>
        <div style={S.catList}>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => void selectCategory(c)}
              disabled={!modelReady || busy}
              style={{
                ...S.catBtn,
                ...(c.id === categoryId ? S.catBtnActive : null),
                opacity: !modelReady || busy ? 0.5 : 1,
              }}
            >
              <span>{c.id}</span>
              <span style={S.count}>
                {c.clips.length}
                {boundRef.current.has(c.id) ? ' ✓' : ''}
              </span>
            </button>
          ))}
        </div>

        <div style={S.sectionLabel}>
          クリップ {categoryId ? `(${visibleClips.length}/${clipNames.length})` : ''}
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="絞り込み (例: Hook, Kick, Idle)"
          style={S.filter}
        />
        <div style={S.clipList}>
          {visibleClips.map((n) => (
            <button
              key={n}
              onClick={() => categoryId && playClip(n, categoryId)}
              style={{ ...S.clipBtn, ...(n === clipName ? S.clipBtnActive : null) }}
            >
              {n}
            </button>
          ))}
          {categoryId && visibleClips.length === 0 && (
            <div style={S.empty}>該当なし</div>
          )}
          {!categoryId && <div style={S.empty}>カテゴリを選んでください</div>}
        </div>
      </aside>

      <main style={S.main}>
        <div style={S.statusBar}>
          <span>{status}</span>
        </div>

        <div style={S.canvasWrap}>
          <canvas ref={canvasRef} style={S.canvas} />
          <div style={S.clipBadge}>{clipName ?? '—'}</div>
        </div>

        <div style={S.controls}>
          <button onClick={togglePlay} disabled={!clipName} style={S.ctrlBtn}>
            {playing ? '⏸ 一時停止' : '▶ 再生'}
          </button>
          <button onClick={restart} disabled={!clipName} style={S.ctrlBtn}>⟲ 最初から</button>
          <button onClick={() => step(-1)} disabled={!clipName} style={S.ctrlBtn}>↑ 前の技</button>
          <button onClick={() => step(1)} disabled={!clipName} style={S.ctrlBtn}>↓ 次の技</button>

          <label style={S.ctrlLabel}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            ループ
          </label>

          <label style={S.ctrlLabel}>
            速度 {speed.toFixed(2)}x
            <input
              type="range" min={0.05} max={2} step={0.05} value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              style={{ width: 120 }}
            />
          </label>

          <span style={S.frameText}>
            frame <span ref={frameTextRef}>0 / 0</span>
            {range && ` @ ${range.fps}fps (${durationSec.toFixed(2)}s)`}
          </span>
        </div>

        <div style={S.seekRow}>
          <input
            ref={seekRef}
            type="range"
            min={range?.from ?? 0}
            max={range?.to ?? 1}
            step={0.5}
            defaultValue={0}
            disabled={!clipName}
            onPointerDown={() => { seekingRef.current = true; }}
            onPointerUp={() => { seekingRef.current = false; }}
            onChange={(e) => {
              const g = currentGroupRef.current;
              if (!g) return;
              if (g.isPlaying) { g.pause(); setPlaying(false); }
              g.goToFrame(Number(e.target.value));
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={S.hint}>
          ↑/↓ = 前後のクリップ / Space = 再生・一時停止 / ドラッグで視点、ホイールでズーム。
          水色の線が +Z (キャラの正面)。FAP クリップは in-place なのでその場で再生されます。
        </div>
      </main>
    </div>
  );
}

// --------------------------------------------------------------------- styles

const S: Record<string, CSSProperties> = {
  page: { display: 'flex', height: '100vh', background: '#0d0f16', color: '#e6e9f0',
    font: '13px/1.6 system-ui, sans-serif', overflow: 'hidden' },
  side: { width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column',
    borderRight: '1px solid #232838', padding: '12px 10px', gap: 6, overflow: 'hidden' },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  sub: { fontSize: 11, color: '#8b93a7' },
  sectionLabel: { marginTop: 8, fontSize: 11, color: '#8b93a7', letterSpacing: 0.5 },
  catList: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' },
  catBtn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 8px', background: '#161a26', color: '#cfd6e6', border: '1px solid #232838',
    borderRadius: 4, cursor: 'pointer', fontSize: 12, textAlign: 'left' },
  catBtnActive: { background: '#1f4f8a', borderColor: '#2f7fd0', color: '#fff' },
  count: { fontSize: 10, color: '#8b93a7' },
  filter: { padding: '5px 8px', background: '#11141d', color: '#e6e9f0',
    border: '1px solid #232838', borderRadius: 4, fontSize: 12 },
  clipList: { flex: 1, display: 'flex', flexDirection: 'column', gap: 1,
    overflowY: 'auto', marginTop: 4 },
  clipBtn: { padding: '4px 8px', background: 'transparent', color: '#cfd6e6',
    border: '1px solid transparent', borderRadius: 3, cursor: 'pointer',
    fontSize: 12, textAlign: 'left', fontFamily: 'ui-monospace, monospace' },
  clipBtnActive: { background: '#2a6fb8', color: '#fff', borderColor: '#4a9be8' },
  empty: { padding: 8, fontSize: 11, color: '#6f7a8f' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  statusBar: { padding: '8px 12px', borderBottom: '1px solid #232838',
    fontSize: 12, color: '#9fb0c9' },
  canvasWrap: { position: 'relative', flex: 1, minHeight: 0 },
  canvas: { width: '100%', height: '100%', display: 'block', outline: 'none' },
  clipBadge: { position: 'absolute', left: 12, top: 10, padding: '4px 10px',
    background: 'rgba(0,0,0,0.55)', borderRadius: 4, fontSize: 13,
    fontFamily: 'ui-monospace, monospace', color: '#8fd0ff' },
  controls: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    padding: '8px 12px', borderTop: '1px solid #232838' },
  ctrlBtn: { padding: '5px 10px', background: '#1b2130', color: '#dbe3f0',
    border: '1px solid #2c3446', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  ctrlLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9fb0c9' },
  frameText: { marginLeft: 'auto', fontSize: 12, color: '#9fb0c9',
    fontFamily: 'ui-monospace, monospace' },
  seekRow: { padding: '0 12px 8px' },
  hint: { padding: '0 12px 10px', fontSize: 11, color: '#6f7a8f' },
};
