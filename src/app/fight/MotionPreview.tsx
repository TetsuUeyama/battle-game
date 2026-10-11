'use client';

/**
 * 技モーションの 3D 実演ビュー (MotionEdit の一区画)。
 *
 * 編集中の技を、実際の格闘モデル (Maskman) で繰り返し再生し、
 * 「発生 → 判定 (active) → 硬直」を CombatController の getStatus() から
 * リアルタイムに読み取って可視化する。判定が出ている瞬間は active hitbox の
 * 赤いワイヤーフレーム球が出る (combat.setDebugVisible)。
 *
 * 重要: 発生/判定/硬直/CT は「クリップ内のどのフレームで判定が出るか・どれだけ
 * 動けないか」を変えるもので、クリップの体の動き自体は変わらない。体の見た目
 * スピードを変えるのは animSpeed (再生速度)。両方ともこのビューで体感できる。
 *
 * 編集値 (overrides) はループの各再生で読み直すので、スライダーを動かすと
 * 次の再生から反映される (「もう一度」ボタン= nonce 更新で即時再生)。
 */

import { useEffect, useRef, useState } from 'react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/loaders/glTF';

import {
  CombatController, loadFightingCharacter, createVoxelFighter,
  type CharacterRig, type CombatPhase,
} from '@/fighting';
import {
  buildMoves, MODEL_GLB_PATH, ANIM_GLB_PATHS, CLIP,
  type FightStyle, type GameMove, type MoveOverride,
} from './moves';
import type { CharacterSkin } from './characterModel';

const ASSET_BASE = '/api/game-assets/fightingGamesystem/assets/';

const PHASE_LABEL: Record<CombatPhase, string> = {
  idle: '待機', startup: '発生', active: '判定発生中!', recovery: '硬直',
};
const PHASE_COLOR: Record<CombatPhase, string> = {
  idle: '#7b8798', startup: '#ffd45a', active: '#ff5a5a', recovery: '#5a78a2',
};

/** 実演バーの区間情報 (total に対する比率) */
interface Bars {
  startup: number;   // 発生フェーズの幅
  active: number;    // 持続フェーズの幅
  recovery: number;  // 硬直フェーズの幅
  invuln: [number, number] | null;
  armor: [number, number] | null;
  damage: number;
  animSpeed: number;
}

function barsFromMove(move: GameMove): Bars {
  const total = move.active[1] + move.recovery;
  const n = (f: number) => (total > 0 ? f / total : 0);
  return {
    startup: n(move.startup),
    active: n(move.active[1] - move.startup),
    recovery: n(move.recovery),
    invuln: move.invuln ? [n(move.invuln[0]), n(move.invuln[1])] : null,
    armor: move.armor ? [n(move.armor[0]), n(move.armor[1])] : null,
    damage: move.damage ?? 0,
    animSpeed: move.animSpeed,
  };
}

export interface MotionPreviewProps {
  style: FightStyle;
  /** 既定と異なる技だけの上書き辞書 (CharacterRecord.moves と同じ) */
  overrides: Record<string, MoveOverride>;
  /** 実演する技 id (null = 待機のみ) */
  moveId: string | null;
  /** 技ラベル (表示用) */
  moveLabel: string;
  /** 「もう一度」相当。値が変わると即時に再生し直す */
  nonce: number;
  /**
   * 表示するスキン。指定があれば自分のボクセルキャラで実演し、
   * 無ければ仮モデル (Maskman) で実演する (スキン未設定でも確認できる)。
   */
  skin?: CharacterSkin | null;
  /** 発生 (active) フレームで停止して攻撃判定 (赤球) を見続ける */
  holdActive?: boolean;
}

export default function MotionPreview({ style, overrides, moveId, moveLabel, nonce, skin, holdActive }: MotionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  // レンダーループから読む最新値 (effect は 1 回だけ走らせる)
  const styleRef = useRef(style);
  const overridesRef = useRef(overrides);
  const moveIdRef = useRef(moveId);
  const nonceRef = useRef(nonce);
  const holdRef = useRef(holdActive);
  const phaseRef = useRef<CombatPhase>('idle');

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CombatPhase>('idle');
  const [bars, setBars] = useState<Bars | null>(null);

  styleRef.current = style;
  overridesRef.current = overrides;
  moveIdRef.current = moveId;
  nonceRef.current = nonce;
  holdRef.current = holdActive;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    const engine = new Engine(canvas, true, { antialias: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.06, 0.09, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2.3, 3.2, new Vector3(0, 0.95, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 1.6;
    camera.upperRadiusLimit = 6;
    camera.wheelDeltaPercentage = 0.01;

    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.9;
    const dir = new DirectionalLight('d', new Vector3(-0.4, -1, -0.6), scene);
    dir.intensity = 0.7;

    // 接地の目安となる薄いグラウンド
    const ground = MeshBuilder.CreateGround('g', { width: 4, height: 4 }, scene);
    const gm = new StandardMaterial('gm', scene);
    gm.diffuseColor = new Color3(0.12, 0.13, 0.17);
    gm.specularColor = new Color3(0, 0, 0);
    ground.material = gm;
    ground.isPickable = false;

    engine.runRenderLoop(() => { if (!disposed) scene.render(); });
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    let rig: CharacterRig | null = null;
    let combat: CombatController | null = null;
    let voxelDispose: (() => void) | null = null;
    let currentMove: GameMove | null = null;
    let lastKey = '';
    let pause = 0;
    let idleOn = false;

    const startIdle = () => {
      if (!rig) return;
      const g = rig.clips.get(CLIP.idle);
      if (!g) return;
      g.start(true, 1, g.from, g.to, false);
      idleOn = true;
    };
    const stopIdle = () => {
      if (!rig) return;
      rig.clips.get(CLIP.idle)?.stop();
      idleOn = false;
    };
    const replay = () => {
      if (!rig || !combat) return;
      const id = moveIdRef.current;
      if (!id) { currentMove = null; setBars(null); startIdle(); return; }
      const moves = buildMoves(rig.clips, styleRef.current, 1, overridesRef.current);
      const move = moves.get(id);
      if (!move) { currentMove = null; setBars(null); startIdle(); return; }
      stopIdle();
      combat.forceCancel(); // 進行中なら畳んで先頭から
      const ok = combat.playMove(move, { startupSpeedRatio: move.animSpeed });
      if (ok) {
        currentMove = move;
        pause = 0;
        setBars(barsFromMove(move));
      }
    };

    // スキンがあれば自分のボクセルで、無ければ仮モデル (Maskman) で実演する。
    const buildRig: Promise<CharacterRig> = skin
      ? createVoxelFighter(scene, {
          triangles: skin.triangles,
          modelGlbPath: MODEL_GLB_PATH,
          animGlbPaths: ANIM_GLB_PATHS,
          baseUrl: ASSET_BASE,
          fitPose: skin.fitPose,
          yawDeg: skin.yawDeg,
          scale: skin.scale,
          offsetY: skin.offsetY,
          resolution: skin.resolution,
          markers: skin.markers,
        }).then((vf) => { voxelDispose = vf.dispose; return vf.rig; })
      : loadFightingCharacter(scene, {
          modelGlbPath: MODEL_GLB_PATH,
          animGlbPaths: ANIM_GLB_PATHS,
          baseUrl: ASSET_BASE,
        }).then((ch) => ch.rig);

    buildRig.then((built) => {
      if (disposed) return;
      rig = built;
      combat = new CombatController(rig);
      combat.setDebugVisible(true); // active 中の hitbox (赤) を見せる
      setLoaded(true);
      startIdle();

      scene.onBeforeRenderObservable.add(() => {
        if (disposed || !rig || !combat) return;
        const dt = engine.getDeltaTime() / 1000;

        // 実演対象 or 「もう一度」が変わったら即再生
        const key = `${moveIdRef.current ?? ''}#${nonceRef.current}`;
        if (key !== lastKey) {
          lastKey = key;
          replay();
        }

        const st = combat.getStatus();

        // 速度維持 / 判定停止。combat は active 移行で speedRatio=1 に戻すため毎フレーム再設定。
        if (currentMove) {
          const g = rig.clips.get(currentMove.clip);
          if (g) {
            if (holdRef.current && st.phase === 'active') {
              g.speedRatio = 0; // 発生(active)フレームで停止 → 攻撃判定 (赤球) を見続ける
            } else if (st.phase === 'active' || st.phase === 'recovery') {
              g.speedRatio = currentMove.animSpeed;
            }
          }
        }

        // プレイヘッド (React 再描画を避けるため DOM 直更新)
        if (headRef.current) {
          if (currentMove && st.phase !== 'idle') {
            const total = currentMove.active[1] + currentMove.recovery;
            const p = total > 0 ? Math.min(1, Math.max(0, st.frame / total)) : 0;
            headRef.current.style.left = `${p * 100}%`;
            headRef.current.style.opacity = '1';
          } else {
            headRef.current.style.opacity = '0';
          }
        }

        // フェーズ表示は変化時のみ更新
        if (st.phase !== phaseRef.current) {
          phaseRef.current = st.phase;
          setPhase(st.phase);
        }

        // ループ: 待機 + CT 明け + 小休止で再生し直す
        if (moveIdRef.current && st.phase === 'idle') {
          if (!idleOn) startIdle();
          const cooling = Object.keys(st.cooldowns).length > 0;
          if (!cooling) {
            pause += dt;
            if (pause > 0.5) replay();
          }
        }
      });
    }).catch((e) => {
      if (!disposed) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      voxelDispose?.();
      scene.dispose();
      engine.dispose();
    };
    // skin が変わったらキャラを作り直す (それ以外は ref 経由でレンダーループが読む)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin]);

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, overflow: 'hidden',
      background: 'rgba(0,0,0,0.25)',
    }}>
      <div style={{ position: 'relative', width: '100%', height: 300, background: '#0c0e15' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }} />
        {!loaded && !error && (
          <div style={overlayCenter}>モデルを読み込み中… (初回のみ少し時間がかかります)</div>
        )}
        {error && (
          <div style={{ ...overlayCenter, color: '#ff9a6a' }}>
            プレビューの読み込みに失敗しました: {error}
          </div>
        )}
        {/* 現在のフェーズ表示 */}
        {loaded && (
          <div style={{
            position: 'absolute', top: 10, left: 12, display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13, fontWeight: 800, textShadow: '0 1px 3px rgba(0,0,0,0.8)',
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              background: skin ? 'rgba(122,209,122,0.18)' : 'rgba(159,176,200,0.18)',
              color: skin ? '#7ad17a' : '#9fb0c8', border: `1px solid ${skin ? '#7ad17a55' : '#9fb0c855'}`,
            }}>
              {skin ? 'マイキャラ' : '仮モデル'}
            </span>
            <span style={{ color: '#e8eef8' }}>{moveLabel || '待機'}</span>
            <span style={{ color: PHASE_COLOR[phase] }}>{PHASE_LABEL[phase]}</span>
            {bars && (
              <span style={{ color: '#9fb0c8', fontWeight: 600 }}>
                速度 ×{bars.animSpeed.toFixed(2)} / ダメ {Math.round(bars.damage)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 実演タイムライン (発生|持続|硬直 + 無敵/アーマー帯 + プレイヘッド) */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ position: 'relative', height: 8, marginBottom: 3 }}>
          {bars?.invuln && (
            <div title="無敵" style={{
              position: 'absolute', left: `${bars.invuln[0] * 100}%`,
              width: `${(bars.invuln[1] - bars.invuln[0]) * 100}%`, top: 0, height: 8,
              background: '#9af0ff', borderRadius: 4,
            }} />
          )}
          {bars?.armor && (
            <div title="アーマー" style={{
              position: 'absolute', left: `${bars.armor[0] * 100}%`,
              width: `${(bars.armor[1] - bars.armor[0]) * 100}%`, top: 0, height: 8,
              background: '#ffd45a', borderRadius: 4,
            }} />
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'flex', height: 22, borderRadius: 5, overflow: 'hidden',
            background: 'rgba(255,255,255,0.06)',
          }}>
            {bars ? (
              <>
                <Seg w={bars.startup} c="#ffd45a" label="発生" />
                <Seg w={bars.active} c="#ff5a5a" label="持続" />
                <Seg w={bars.recovery} c="#5a78a2" label="硬直" />
              </>
            ) : (
              <div style={{ margin: 'auto', fontSize: 11, color: '#7b8798' }}>
                技を「実演」すると再生されます
              </div>
            )}
          </div>
          {/* プレイヘッド (DOM 直更新) */}
          <div ref={headRef} style={{
            position: 'absolute', top: -2, width: 2, height: 26, marginLeft: -1,
            background: '#ffffff', boxShadow: '0 0 6px rgba(255,255,255,0.9)',
            opacity: 0, pointerEvents: 'none', transition: 'opacity 0.15s',
          }} />
        </div>
        <div style={{ fontSize: 10, color: '#7b8798', marginTop: 6, lineHeight: 1.5 }}>
          発生/持続/硬直/CT は「判定の出るタイミングと動けない長さ」を変えます (体の動き自体は不変)。
          体の速さを変えるのは <b style={{ color: '#c8d4e8' }}>速度 (animSpeed)</b>。編集はループの次の再生で反映されます。
        </div>
      </div>
    </div>
  );
}

function Seg({ w, c, label }: { w: number; c: string; label: string }) {
  if (w <= 0) return null;
  return (
    <div title={label} style={{
      width: `${w * 100}%`, background: c, height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.55)', overflow: 'hidden', whiteSpace: 'nowrap',
    }}>
      {w > 0.12 ? label : ''}
    </div>
  );
}

const overlayCenter: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 12, color: '#aeb8c8', textAlign: 'center', padding: 20, pointerEvents: 'none',
};
