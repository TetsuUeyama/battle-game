'use client';

/**
 * モーション(技)カスタマイズ。マイキャラクター編集 (CharacterEdit) の一区画として使う。
 *
 * 技ごとに「発生 (startup) / 攻撃判定 (active) / 硬直 (recovery) / クールタイム /
 * ダメージ」を編集し、格闘ゲーム風のフレームタイムライン (プログレスバー) で
 * 発生・持続・硬直の長さと無敵/アーマー区間を可視化する。
 *
 * フレーム系の編集値は「クリップ長に対する比率 (pct)」で、実フレーム数は
 * クリップ実長 × pct で決まる (moves.ts の buildMoves と同じ)。実フレーム表示は
 * clipFrames.ts でアニメ GLB のクリップ実長を読み、60fps 換算した値 ("○F")。
 *
 * 親 (CharacterEdit) へは「既定と異なる技だけ」の上書き辞書を onChange で渡す。
 * 保存はキャラ単位 (CharacterRecord.moves) なので、対戦で自キャラに反映される。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  styleMoveSummary, defaultMoveParams, moveDisplayInfo, HITBOX_BONES,
  type FightStyle, type MoveOverride,
} from './moves';
import { getClipFrameInfo, toFrames60, type ClipFrameInfo } from './clipFrames';
import MotionPreview from './MotionPreview';
import type { CharacterSkin } from './characterModel';

const STYLE_COLORS: Record<FightStyle, string> = {
  boxer: '#5aa2ff', kicker: '#7ad17a', speed: '#ffd45a', power: '#ff6a5a',
};

// タイムラインの 3 フェーズ色
const COL_STARTUP = '#ffd45a'; // 発生 (出が遅いほど不利)
const COL_ACTIVE = '#ff5a5a';  // 攻撃判定
const COL_RECOVERY = '#5a78a2'; // 硬直 (隙)

/** 編集中の 1 技分のパラメータ (pct とダメージと再生速度と攻撃判定) */
interface MoveParams {
  startupPct: number;
  activeEndPct: number;
  recoveryEndPct: number;
  cooldownPct: number;
  damage: number;
  animSpeed: number;
  /** 攻撃判定: 付着ボーン (判定位置) */
  hitBone: string;
  /** 攻撃判定: 半径 (攻撃範囲) */
  hitRadius: number;
  /** 攻撃判定: ボーンローカルオフセット (判定位置の微調整) */
  hitOffset: [number, number, number];
}

/** MoveParams のうち数値スライダーで編集できるキー */
type NumericMoveKey = {
  [K in keyof MoveParams]: MoveParams[K] extends number ? K : never;
}[keyof MoveParams];

/** moveId → 既定パラメータ */
function defaultsOf(style: FightStyle): Record<string, MoveParams> {
  const out: Record<string, MoveParams> = {};
  for (const m of styleMoveSummary(style)) {
    const d = defaultMoveParams(style, m.id);
    if (d) out[m.id] = { ...d };
  }
  return out;
}

/** 既定値に上書きをマージして編集中の全技パラメータを作る */
function mergeParams(
  defaults: Record<string, MoveParams>,
  value: Record<string, MoveOverride>,
): Record<string, MoveParams> {
  const out: Record<string, MoveParams> = {};
  for (const id of Object.keys(defaults)) {
    const merged = { ...defaults[id], ...value[id] };
    // hitOffset は配列なので defaults/override と参照を共有しないよう複製
    merged.hitOffset = [...(value[id]?.hitOffset ?? defaults[id].hitOffset)] as [number, number, number];
    out[id] = merged;
  }
  return out;
}

/** 1 技が既定と異なるか */
function isDiff(cur: MoveParams, def: MoveParams): boolean {
  return (
    Math.abs(cur.startupPct - def.startupPct) > 1e-4 ||
    Math.abs(cur.activeEndPct - def.activeEndPct) > 1e-4 ||
    Math.abs(cur.recoveryEndPct - def.recoveryEndPct) > 1e-4 ||
    Math.abs(cur.cooldownPct - def.cooldownPct) > 1e-4 ||
    Math.abs(cur.animSpeed - def.animSpeed) > 1e-4 ||
    cur.damage !== def.damage ||
    cur.hitBone !== def.hitBone ||
    Math.abs(cur.hitRadius - def.hitRadius) > 1e-4 ||
    cur.hitOffset.some((v, i) => Math.abs(v - def.hitOffset[i]) > 1e-4)
  );
}

/** 全技パラメータ → 「既定と異なる技だけ」の上書き辞書 */
function toOverrides(
  params: Record<string, MoveParams>,
  defaults: Record<string, MoveParams>,
): Record<string, MoveOverride> {
  const out: Record<string, MoveOverride> = {};
  for (const id of Object.keys(defaults)) {
    const cur = params[id];
    if (cur && isDiff(cur, defaults[id])) {
      out[id] = {
        startupPct: cur.startupPct,
        activeEndPct: cur.activeEndPct,
        recoveryEndPct: cur.recoveryEndPct,
        cooldownPct: cur.cooldownPct,
        damage: cur.damage,
        animSpeed: cur.animSpeed,
        hitBone: cur.hitBone,
        hitRadius: cur.hitRadius,
        hitOffset: [...cur.hitOffset],
      };
    }
  }
  return out;
}

/** pct と clip 情報から 60fps 換算のフレーム内訳を出す */
interface FrameBreakdown {
  startup: number;   // 発生フレーム数
  active: number;    // 持続フレーム数
  recovery: number;  // 硬直フレーム数
  total: number;     // 全体 (発生+持続+硬直)
  cooldown: number;  // クールタイム
  /** バー上の位置 (0..total)。無敵/アーマー区間の描画用 */
  invuln?: [number, number];
  armor?: [number, number];
}

function breakdownOf(p: MoveParams, info: ClipFrameInfo, win?: { invulnPct?: [number, number]; armorPct?: [number, number] }): FrameBreakdown {
  const durSec = info.frames / info.fps;
  const f = (pct: number) => Math.round(pct * durSec * 60); // 0..total へ写す 60fps フレーム
  const startupEnd = f(p.startupPct);
  const activeEnd = f(p.activeEndPct);
  const recoveryEnd = f(p.recoveryEndPct);
  const winFrames = (pct?: [number, number]): [number, number] | undefined =>
    pct ? [f(pct[0]), f(pct[1])] : undefined;
  return {
    startup: startupEnd,
    active: Math.max(0, activeEnd - startupEnd),
    recovery: Math.max(0, recoveryEnd - activeEnd),
    total: recoveryEnd,
    cooldown: f(p.cooldownPct),
    invuln: winFrames(win?.invulnPct),
    armor: winFrames(win?.armorPct),
  };
}

export interface MotionEditProps {
  style: FightStyle;
  /** 既定と異なる技だけ入る上書き辞書 (CharacterRecord.moves) */
  value: Record<string, MoveOverride>;
  onChange: (moves: Record<string, MoveOverride>) => void;
  /** 実演に使うスキン (無ければ仮モデルで実演) */
  skin?: CharacterSkin | null;
}

export default function MotionEdit({ style, value, onChange, skin }: MotionEditProps) {
  const defaults = useMemo(() => defaultsOf(style), [style]);
  const [params, setParams] = useState<Record<string, MoveParams>>(() => mergeParams(defaults, value));
  const [clipInfo, setClipInfo] = useState<Map<string, ClipFrameInfo> | null>(null);
  const [clipError, setClipError] = useState(false);
  // 3D 実演ビュー (重いので初回 [実演] クリックまで遅延マウント)
  const [previewOn, setPreviewOn] = useState(false);
  const [demoId, setDemoId] = useState<string | null>(null);
  const [demoNonce, setDemoNonce] = useState(0);
  // 判定編集用: 発生フレームで停止して攻撃判定 (赤球) を見続けるモード
  const [holdActive, setHoldActive] = useState(false);
  const color = STYLE_COLORS[style];
  const summary = styleMoveSummary(style);

  /** 技を 3D で実演する (プレビュー未起動なら起動) */
  const demo = (moveId: string) => {
    setPreviewOn(true);
    setDemoId(moveId);
    setDemoNonce((n) => n + 1);
  };
  /** 実演中の技を編集したら即座に再生し直して反映を見せる */
  const bumpIfDemoed = (moveId: string) => {
    if (previewOn && moveId === demoId) setDemoNonce((n) => n + 1);
  };
  const demoLabel = demoId ? summary.find((m) => m.id === demoId)?.label ?? '' : '';

  // クリップ実長を 1 回ロード (セッション内キャッシュ)
  useEffect(() => {
    let alive = true;
    getClipFrameInfo()
      .then((m) => { if (alive) setClipInfo(m); })
      .catch(() => { if (alive) setClipError(true); });
    return () => { alive = false; };
  }, []);

  const commit = (next: Record<string, MoveParams>) => {
    setParams(next);
    onChange(toOverrides(next, defaults));
  };

  const update = (moveId: string, key: NumericMoveKey, v: number) => {
    const next = { ...params, [moveId]: { ...params[moveId], [key]: v } };
    // 整合性: 発生 ≤ 判定終了 ≤ 硬直終了 を保つ
    const m = next[moveId];
    if (key === 'startupPct') m.activeEndPct = Math.max(m.activeEndPct, m.startupPct + 0.02);
    if (key === 'activeEndPct') {
      m.startupPct = Math.min(m.startupPct, m.activeEndPct - 0.02);
      m.recoveryEndPct = Math.max(m.recoveryEndPct, m.activeEndPct + 0.02);
    }
    if (key === 'recoveryEndPct') m.activeEndPct = Math.min(m.activeEndPct, m.recoveryEndPct - 0.02);
    commit(next);
    bumpIfDemoed(moveId);
  };

  /** 攻撃判定の付着ボーン (判定位置) を変える */
  const updateBone = (moveId: string, bone: string) => {
    commit({ ...params, [moveId]: { ...params[moveId], hitBone: bone } });
    bumpIfDemoed(moveId);
  };

  /** 攻撃判定のオフセット 1 軸 (判定位置の微調整) を変える */
  const updateOffset = (moveId: string, axis: 0 | 1 | 2, v: number) => {
    const off = [...params[moveId].hitOffset] as [number, number, number];
    off[axis] = v;
    commit({ ...params, [moveId]: { ...params[moveId], hitOffset: off } });
    bumpIfDemoed(moveId);
  };

  const cloneParams = (p: MoveParams): MoveParams => ({ ...p, hitOffset: [...p.hitOffset] });
  const resetOne = (moveId: string) => {
    commit({ ...params, [moveId]: cloneParams(defaults[moveId]) });
    bumpIfDemoed(moveId);
  };
  const resetAll = () => {
    const next: Record<string, MoveParams> = {};
    for (const id of Object.keys(defaults)) next[id] = cloneParams(defaults[id]);
    commit(next);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 11, color: '#8794a8', margin: 0, lineHeight: 1.6, maxWidth: 620 }}>
          技ごとに発生・攻撃判定・硬直・クールタイム・ダメージを調整します。バーは実フレーム
          (60fps 換算) で <span style={{ color: COL_STARTUP }}>発生</span> /{' '}
          <span style={{ color: COL_ACTIVE }}>持続</span> /{' '}
          <span style={{ color: COL_RECOVERY }}>硬直</span> を表します。保存すると対戦で自キャラに反映されます。
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {previewOn && (
            <button onClick={() => { setPreviewOn(false); setDemoId(null); }} style={ghostMini}>
              実演を閉じる
            </button>
          )}
          <button onClick={resetAll} style={ghostMini}>全て既定に戻す</button>
        </div>
      </div>

      {/* 3D 実演ビュー (各技の [実演] で再生。実演中の技を編集すると即再生) */}
      {previewOn && (
        <div style={{ marginTop: 12 }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
            color: '#9fb0c8', marginBottom: 8, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={holdActive} onChange={(e) => { setHoldActive(e.target.checked); setDemoNonce((n) => n + 1); }} />
            判定で停止 (発生フレームで止めて攻撃範囲・位置を確認しながら編集)
          </label>
          <MotionPreview
            style={style}
            overrides={toOverrides(params, defaults)}
            moveId={demoId}
            moveLabel={demoLabel}
            nonce={demoNonce}
            skin={skin}
            holdActive={holdActive}
          />
        </div>
      )}

      {clipError && (
        <div style={{ fontSize: 11, color: '#ff9a6a', marginTop: 8 }}>
          クリップ長の取得に失敗しました。比率は編集できますが実フレーム数は表示されません。
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 12 }}>
        {summary.map((m) => {
          const p = params[m.id];
          if (!p) return null;
          const def = defaults[m.id];
          const moveChanged = isDiff(p, def);
          const info = m.id ? clipInfo?.get(moveDisplayInfo(style, m.id)?.clip ?? '') : undefined;
          const win = moveDisplayInfo(style, m.id);
          const bd = info ? breakdownOf(p, info, win) : null;

          return (
            <div key={m.id} style={{
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}55`,
              borderRadius: 10, padding: 14,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 800, color }}>
                  {m.label}
                  {m.trait && <span style={{ fontSize: 10, color, marginLeft: 6 }}>{m.trait}</span>}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => demo(m.id)}
                    style={{
                      ...ghostMini, border: `1px solid ${color}`,
                      color: demoId === m.id && previewOn ? '#0c0e15' : color,
                      background: demoId === m.id && previewOn ? color : 'rgba(255,255,255,0.06)',
                      fontWeight: 800,
                    }}>
                    {demoId === m.id && previewOn ? '● 実演中' : '▶ 実演'}
                  </button>
                  <button onClick={() => resetOne(m.id)} disabled={!moveChanged}
                    style={{ ...ghostMini, opacity: moveChanged ? 1 : 0.4, cursor: moveChanged ? 'pointer' : 'default' }}>
                    既定
                  </button>
                </div>
              </div>

              {/* フレームタイムライン (プログレスバー) */}
              <Timeline bd={bd} />

              {/* フレーム数の内訳 */}
              {bd ? (
                <div style={{ display: 'flex', gap: 12, fontSize: 11, marginTop: 6, flexWrap: 'wrap' }}>
                  <Frag label="発生" v={`${bd.startup}F`} c={COL_STARTUP} />
                  <Frag label="持続" v={`${bd.active}F`} c={COL_ACTIVE} />
                  <Frag label="硬直" v={`${bd.recovery}F`} c={COL_RECOVERY} />
                  <Frag label="全体" v={`${bd.total}F`} c="#c8d4e8" />
                  <Frag label="CT" v={`${bd.cooldown}F`} c="#9fb0c8" />
                  <Frag label="ダメ" v={String(Math.round(p.damage))} c="#ff9a6a" />
                </div>
              ) : (
                <div style={{ fontSize: 10, color: '#7b8798', marginTop: 6 }}>
                  {clipInfo ? 'このクリップの長さが取得できませんでした' : 'クリップ長を読み込み中…'}
                </div>
              )}

              {/* スライダー */}
              <div style={{ marginTop: 8 }}>
                {slider(p, def, 'startupPct', '発生', 0.05, 0.40, 0.01, color, (k, v) => update(m.id, k, v))}
                {slider(p, def, 'activeEndPct', '判定終了', 0.30, 0.70, 0.01, color, (k, v) => update(m.id, k, v))}
                {slider(p, def, 'recoveryEndPct', '硬直終了', 0.50, 1.00, 0.01, color, (k, v) => update(m.id, k, v))}
                {slider(p, def, 'cooldownPct', 'クールタイム', 0.40, 1.60, 0.01, color, (k, v) => update(m.id, k, v))}
                {slider(p, def, 'damage', 'ダメージ', 1, 30, 1, color, (k, v) => update(m.id, k, v))}
                {slider(p, def, 'animSpeed', '速度(見た目)', 0.5, 1.8, 0.05, color, (k, v) => update(m.id, k, v))}
              </div>

              {/* 攻撃判定 (範囲・位置) */}
              <div style={{
                marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#c8d4e8', marginBottom: 6 }}>
                  攻撃判定 (範囲・位置)
                  {hitChanged(p, def) && <span style={{ color, marginLeft: 6, fontSize: 10 }}>編集済み</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: '#9fb0c8', width: 76 }}>判定位置(骨)</span>
                  <select value={p.hitBone} onChange={(e) => updateBone(m.id, e.target.value)}
                    style={{
                      flex: 1, fontSize: 11, padding: '3px 6px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.06)', color: '#e8eef8',
                      border: `1px solid ${p.hitBone !== def.hitBone ? color : 'rgba(255,255,255,0.2)'}`,
                    }}>
                    {HITBOX_BONES.map((b) => (
                      <option key={b.bone} value={b.bone} style={{ color: '#000' }}>{b.label}</option>
                    ))}
                  </select>
                </div>
                {slider(p, def, 'hitRadius', '攻撃範囲(半径)', 0.08, 0.40, 0.01, color, (k, v) => update(m.id, k, v))}
                {offsetSlider(p, def, 0, '位置 左右(X)', color, (v) => updateOffset(m.id, 0, v))}
                {offsetSlider(p, def, 1, '位置 上下(Y)', color, (v) => updateOffset(m.id, 1, v))}
                {offsetSlider(p, def, 2, '位置 前後(Z)', color, (v) => updateOffset(m.id, 2, v))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- パーツ

/** 発生/持続/硬直の積み上げバー + 無敵/アーマー区間のオーバーレイ */
function Timeline({ bd }: { bd: FrameBreakdown | null }) {
  if (!bd || bd.total <= 0) {
    return <div style={{ height: 18, marginTop: 10, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />;
  }
  const pct = (f: number) => `${(f / bd.total) * 100}%`;
  const seg = (w: number, c: string, title: string) =>
    w > 0 ? <div title={title} style={{ width: pct(w), background: c, height: '100%' }} /> : null;
  return (
    <div style={{ marginTop: 10 }}>
      {/* 無敵/アーマーのオーバーレイ (バー上端に細帯) */}
      <div style={{ position: 'relative', height: 6 }}>
        {bd.invuln && (
          <div title="無敵" style={{
            position: 'absolute', left: pct(bd.invuln[0]), width: pct(bd.invuln[1] - bd.invuln[0]),
            top: 0, height: 6, background: '#9af0ff', borderRadius: 3,
          }} />
        )}
        {bd.armor && (
          <div title="アーマー" style={{
            position: 'absolute', left: pct(bd.armor[0]), width: pct(bd.armor[1] - bd.armor[0]),
            top: 0, height: 6, background: '#ffd45a', borderRadius: 3,
          }} />
        )}
      </div>
      {/* 発生 | 持続 | 硬直 */}
      <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
        {seg(bd.startup, COL_STARTUP, `発生 ${bd.startup}F`)}
        {seg(bd.active, COL_ACTIVE, `持続 ${bd.active}F`)}
        {seg(bd.recovery, COL_RECOVERY, `硬直 ${bd.recovery}F`)}
      </div>
    </div>
  );
}

function Frag({ label, v, c }: { label: string; v: string; c: string }) {
  return (
    <span style={{ color: '#8794a8' }}>
      {label} <b style={{ color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</b>
    </span>
  );
}

function slider(
  p: MoveParams, def: MoveParams, key: NumericMoveKey, label: string,
  min: number, max: number, step: number, color: string,
  onChange: (key: NumericMoveKey, v: number) => void,
) {
  const cur = p[key];
  const changed = Math.abs(cur - def[key]) > step / 2;
  const fmt = key === 'damage' ? String(Math.round(cur)) : cur.toFixed(2);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
      <span style={{ fontSize: 11, color: '#9fb0c8', width: 76 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={cur}
        onChange={(e) => onChange(key, parseFloat(e.target.value))} style={{ flex: 1 }} />
      <span style={{
        fontSize: 11, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        color: changed ? color : '#e8eef8',
      }}>{fmt}</span>
    </div>
  );
}

/** 攻撃判定オフセット 1 軸のスライダー (-0.4〜0.4 m) */
function offsetSlider(
  p: MoveParams, def: MoveParams, axis: 0 | 1 | 2, label: string, color: string,
  onChange: (v: number) => void,
) {
  const cur = p.hitOffset[axis];
  const changed = Math.abs(cur - def.hitOffset[axis]) > 0.01;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
      <span style={{ fontSize: 11, color: '#9fb0c8', width: 76 }}>{label}</span>
      <input type="range" min={-0.4} max={0.4} step={0.02} value={cur}
        onChange={(e) => onChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
      <span style={{
        fontSize: 11, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        color: changed ? color : '#e8eef8',
      }}>{cur.toFixed(2)}</span>
    </div>
  );
}

/** 攻撃判定 (ボーン/半径/オフセット) が既定と異なるか */
function hitChanged(cur: MoveParams, def: MoveParams): boolean {
  return (
    cur.hitBone !== def.hitBone ||
    Math.abs(cur.hitRadius - def.hitRadius) > 1e-4 ||
    cur.hitOffset.some((v, i) => Math.abs(v - def.hitOffset[i]) > 1e-4)
  );
}

const ghostMini: React.CSSProperties = {
  fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#c8d4e8',
};
