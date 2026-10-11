'use client';

/**
 * キャラクターエディット (Phase 7-4 リデザイン)。
 *
 * 「全スタイル編集」をやめ、自分が作る最大3キャラだけを管理・編集する。
 *   一覧 (3スロット) → 新規/編集 → [名前 / 技スタイル / スキン(取込→ボーン→ボクセル) /
 *   ステータス / 体格] を設定 → 保存 (characterStore 経由でプロジェクト内に保存)。
 *
 * 対戦では自キャラを使い、相手は既存キャラ (ボクサー等)。保存・読込は characterStore
 * (将来 DB へルート差し替え) を通す。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  FIGHT_STYLES, STYLE_LABELS, STYLE_BODY, styleMoveSummary,
  type FightStyle, type MoveOverride,
} from './moves';
import MotionEdit from './MotionEdit';
import {
  STYLE_STATS, STAT_KEYS, STAT_LABELS, STAT_MAX, STAT_TOTAL,
  statMaxHp, statDamageMul, statDefenseMul, statSpeedMul, statTotal,
  type CharStats,
} from './stats';
import SkinEdit from './SkinEdit';
import {
  listCharacters, getCharacter, saveCharacter, deleteCharacter,
  newCharacterId, MAX_CHARACTERS,
} from './characterStore';
import type { CharacterMeta, CharacterRecord, CharacterSkin } from './characterModel';

const STYLE_COLORS: Record<FightStyle, string> = {
  boxer: '#5aa2ff', kicker: '#7ad17a', speed: '#ffd45a', power: '#ff6a5a',
};

/** 編集中ドラフト (stats/body は具体値で保持し、保存時にそのまま書く) */
interface EditDraft {
  id: string;
  name: string;
  style: FightStyle;
  stats: CharStats;
  body: { width: number; height: number };
  /** 技モーション上書き (既定と異なる技だけ)。スタイル変更時はクリアする */
  moves: Record<string, MoveOverride>;
  skin: CharacterSkin | null;
  isNew: boolean;
}

function bodyOf(style: FightStyle): { width: number; height: number } {
  return { width: STYLE_BODY[style].width, height: STYLE_BODY[style].height };
}

export default function CharacterEdit() {
  const [list, setList] = useState<CharacterMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [editingSkin, setEditingSkin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setList(await listCharacters());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // ----------------------------------------------------------- ナビゲーション
  const startNew = () => {
    if (list.length >= MAX_CHARACTERS) return;
    setError(null);
    setDraft({
      id: newCharacterId(),
      name: `マイキャラ${list.length + 1}`,
      style: 'boxer',
      stats: { ...STYLE_STATS.boxer },
      body: bodyOf('boxer'),
      moves: {},
      skin: null,
      isNew: true,
    });
    setEditingSkin(false);
  };

  const startEdit = async (id: string) => {
    setError(null);
    setBusy('読み込み中…');
    const rec = await getCharacter(id);
    setBusy(null);
    if (!rec) { setError('キャラの読み込みに失敗しました'); return; }
    setDraft({
      id: rec.id,
      name: rec.name,
      style: rec.style,
      stats: rec.stats ?? { ...STYLE_STATS[rec.style] },
      body: rec.body ?? bodyOf(rec.style),
      moves: rec.moves ?? {},
      skin: rec.skin,
      isNew: false,
    });
    setEditingSkin(false);
  };

  const removeChar = async (id: string, name: string) => {
    if (!window.confirm(`「${name}」を削除しますか?`)) return;
    setBusy('削除中…');
    await deleteCharacter(id);
    setBusy(null);
    await refresh();
  };

  const cancelEdit = () => { setDraft(null); setEditingSkin(false); setError(null); };

  const save = async () => {
    if (!draft) return;
    if (!draft.skin) { setError('先にスキン (取込→ボーン→ボクセル化) を設定してください'); return; }
    const rec: CharacterRecord = {
      id: draft.id,
      name: draft.name.trim() || 'マイキャラ',
      style: draft.style,
      stats: draft.stats,
      body: draft.body,
      moves: Object.keys(draft.moves).length > 0 ? draft.moves : null,
      skin: draft.skin,
      updatedAt: Date.now(),
    };
    setBusy('保存中…');
    try {
      await saveCharacter(rec);
      setBusy(null);
      setDraft(null);
      await refresh();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSkinApply = (skin: CharacterSkin) => {
    setDraft((d) => (d ? { ...d, skin } : d));
    setEditingSkin(false);
  };

  // ----------------------------------------------------------- スキン編集 (全面)
  if (draft && editingSkin) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 32px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setEditingSkin(false)} style={backBtn}>← 戻る</button>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
            「{draft.name}」のスキン作成
          </h2>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <SkinEdit onApply={onSkinApply} initialSkin={draft.skin} applyLabel="このスキンを使う" />
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------- キャラ編集フォーム
  if (draft) {
    return (
      <EditForm
        draft={draft}
        setDraft={setDraft}
        onEditSkin={() => setEditingSkin(true)}
        onSave={save}
        onCancel={cancelEdit}
        busy={busy}
        error={error}
      />
    );
  }

  // ----------------------------------------------------------- 一覧 (3スロット)
  return (
    <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>マイキャラクター</h2>
      <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 8, lineHeight: 1.7 }}>
        自分のキャラを最大 {MAX_CHARACTERS} 体まで作れます。FBX / GLB を読み込んでボーン設定と
        ボクセル化をすると保存でき、対戦モードで自キャラとして使えます。
      </p>

      {error && <div style={{ color: '#ff8c8c', fontSize: 12, marginTop: 8 }}>{error}</div>}
      {busy && <div style={{ color: '#c8d4e8', fontSize: 12, marginTop: 8 }}>{busy}</div>}

      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${MAX_CHARACTERS}, 1fr)`,
        gap: 16, marginTop: 18, maxWidth: 920,
      }}>
        {Array.from({ length: MAX_CHARACTERS }).map((_, i) => {
          const c = list[i];
          if (c) {
            const color = STYLE_COLORS[c.style];
            return (
              <div key={c.id} style={{
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}66`,
                borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{c.name}</div>
                <div style={{ fontSize: 12, color }}>{STYLE_LABELS[c.style]}</div>
                <div style={{ fontSize: 10, color: '#7b8798', wordBreak: 'break-all' }}>
                  {c.skin.fileName}
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => void startEdit(c.id)} style={primaryBtn}>編集</button>
                  <button onClick={() => void removeChar(c.id, c.name)} style={ghostBtn}>削除</button>
                </div>
              </div>
            );
          }
          // 空きスロット
          const canAdd = list.length === i; // 連番の最初の空きだけ「新規」に
          return (
            <div key={`empty-${i}`} style={{
              border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 12, padding: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 150,
            }}>
              {loading ? (
                <span style={{ fontSize: 12, color: '#7b8798' }}>読み込み中…</span>
              ) : canAdd ? (
                <button onClick={startNew} style={{
                  fontSize: 13, fontWeight: 800, padding: '12px 20px', borderRadius: 8, cursor: 'pointer',
                  border: 'none', background: '#ffd45a', color: '#0b0d12',
                }}>＋ 新規作成</button>
              ) : (
                <span style={{ fontSize: 12, color: '#5a6478' }}>空きスロット</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===================================================================== 編集フォーム

interface EditFormProps {
  draft: EditDraft;
  setDraft: React.Dispatch<React.SetStateAction<EditDraft | null>>;
  onEditSkin: () => void;
  onSave: () => void;
  onCancel: () => void;
  busy: string | null;
  error: string | null;
}

function EditForm({ draft, setDraft, onEditSkin, onSave, onCancel, busy, error }: EditFormProps) {
  const color = STYLE_COLORS[draft.style];
  const remain = STAT_TOTAL - statTotal(draft.stats);

  const setName = (name: string) => setDraft((d) => (d ? { ...d, name } : d));
  // スタイルを変えると技の既定値が変わるので、技モーション上書きはクリアする
  const setStyle = (style: FightStyle) => setDraft((d) => (d ? { ...d, style, moves: {} } : d));
  const setMoves = (moves: Record<string, MoveOverride>) => setDraft((d) => (d ? { ...d, moves } : d));
  const bumpStat = (key: typeof STAT_KEYS[number], delta: number) =>
    setDraft((d) => {
      if (!d) return d;
      const cur = d.stats;
      const next = cur[key] + delta;
      if (next < 0 || next > STAT_MAX) return d;
      if (delta > 0 && statTotal(cur) >= STAT_TOTAL) return d;
      return { ...d, stats: { ...cur, [key]: next } };
    });
  const setBody = (key: 'width' | 'height', value: number) =>
    setDraft((d) => (d ? { ...d, body: { ...d.body, [key]: value } } : d));
  const resetStats = () => setDraft((d) => (d ? { ...d, stats: { ...STYLE_STATS[d.style] } } : d));
  const resetBody = () => setDraft((d) => (d ? { ...d, body: bodyOf(d.style) } : d));

  return (
    <div style={{ padding: '20px 32px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onCancel} style={backBtn}>← 一覧へ</button>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
          {draft.isNew ? 'キャラを作成' : 'キャラを編集'}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 24, marginTop: 18, maxWidth: 900 }}>
        {/* 左: 名前 / 技スタイル / スキン */}
        <div>
          <label style={labelStyle}>名前</label>
          <input
            value={draft.name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            style={{
              width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '8px 10px',
              borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.05)', color: '#eef2fa', marginBottom: 16,
            }}
          />

          <label style={labelStyle}>技スタイル (動き)</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {FIGHT_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                style={{
                  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
                  border: draft.style === s ? `2px solid ${STYLE_COLORS[s]}` : '1px solid rgba(255,255,255,0.2)',
                  background: draft.style === s ? `${STYLE_COLORS[s]}22` : 'rgba(255,255,255,0.05)',
                  color: draft.style === s ? STYLE_COLORS[s] : '#c8d4e8',
                }}
              >{STYLE_LABELS[s]}</button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#8794a8', lineHeight: 1.7, marginBottom: 16 }}>
            {styleMoveSummary(draft.style).map((m) => (
              <span key={m.id} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
                {m.label.replace(/\s*\([A-Z]\)/, '')}<span style={{ color: '#ff9a6a' }}> {m.damage}</span>
              </span>
            ))}
          </div>

          <label style={labelStyle}>スキン (見た目)</label>
          <div style={{
            border: `1px solid ${draft.skin ? '#7ad17a66' : 'rgba(255,255,255,0.2)'}`,
            borderRadius: 8, padding: 12, marginBottom: 8,
          }}>
            <div style={{ fontSize: 12, color: draft.skin ? '#7ad17a' : '#ff9a6a', marginBottom: 8 }}>
              {draft.skin ? `設定済み: ${draft.skin.fileName}` : '未設定 (FBX/GLBから作成が必要)'}
            </div>
            <button onClick={onEditSkin} style={primaryBtn}>
              {draft.skin ? 'スキンを作り直す/調整' : 'スキンを作成 (取込→ボーン→ボクセル)'}
            </button>
          </div>
        </div>

        {/* 右: ステータス / 体格 */}
        <div>
          {/* ステータス */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={labelStyle}>ステータス (合計 {STAT_TOTAL})</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: remain > 0 ? '#ffd45a' : '#7b8798' }}>残 {remain}</span>
              <button onClick={resetStats} style={ghostBtn}>既定</button>
            </div>
          </div>
          {STAT_KEYS.map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#c8d4e8', width: 36 }}>{STAT_LABELS[key]}</span>
              <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                {Array.from({ length: STAT_MAX }).map((_, i) => (
                  <div key={i} style={{
                    flex: 1, height: 8, borderRadius: 2,
                    background: i < draft.stats[key] ? color : 'rgba(255,255,255,0.1)',
                  }} />
                ))}
              </div>
              <span style={{ fontSize: 12, color: '#e8eef8', width: 18, textAlign: 'right' }}>{draft.stats[key]}</span>
              <button onClick={() => bumpStat(key, -1)} style={stepBtn}>−</button>
              <button onClick={() => bumpStat(key, +1)} style={stepBtn}>＋</button>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 10, color: '#8794a8', lineHeight: 1.7 }}>
            最大HP <b style={{ color: '#e8eef8' }}>{statMaxHp(draft.stats)}</b> ・
            与ダメ <b style={{ color: '#ff9a6a' }}>×{statDamageMul(draft.stats).toFixed(2)}</b> ・
            被ダメ <b style={{ color: '#9ad7ff' }}>×{statDefenseMul(draft.stats).toFixed(2)}</b> ・
            速度 <b style={{ color: '#9af0a0' }}>×{statSpeedMul(draft.stats).toFixed(2)}</b>
          </div>

          {/* 体格 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
            <label style={labelStyle}>体格</label>
            <button onClick={resetBody} style={ghostBtn}>既定</button>
          </div>
          {(['width', 'height'] as const).map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 11, color: '#9fb0c8', width: 40 }}>{key === 'width' ? '横幅' : '身長'}</span>
              <input
                type="range" min={key === 'width' ? 0.7 : 0.75} max={key === 'width' ? 1.5 : 1.3} step={0.01}
                value={draft.body[key]}
                onChange={(e) => setBody(key, parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 11, color: '#e8eef8', width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {draft.body[key].toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* モーション(技): 発生/判定/硬直/CT/ダメージをタイムラインで編集 */}
      <div style={{ marginTop: 26, maxWidth: 900 }}>
        <label style={{ ...labelStyle, marginBottom: 10 }}>モーション (技)</label>
        <MotionEdit key={draft.style} style={draft.style} value={draft.moves} onChange={setMoves} skin={draft.skin} />
      </div>

      {error && <div style={{ color: '#ff8c8c', fontSize: 12, marginTop: 14 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
        <button
          onClick={onSave}
          disabled={!!busy}
          style={{
            fontSize: 14, fontWeight: 800, padding: '10px 28px', borderRadius: 6,
            border: 'none', cursor: busy ? 'default' : 'pointer',
            background: busy ? 'rgba(255,255,255,0.15)' : '#7ad17a', color: '#0b0d12',
          }}
        >保存</button>
        <button onClick={onCancel} style={ghostBtn}>キャンセル</button>
        {busy && <span style={{ fontSize: 12, color: '#c8d4e8' }}>{busy}</span>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- styles
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 700, color: '#c8d4e8', marginBottom: 6 };
const primaryBtn: CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  border: 'none', background: '#ffd45a', color: '#0b0d12',
};
const ghostBtn: CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#c8d4e8',
};
const backBtn: CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#c8d4e8',
};
const stepBtn: CSSProperties = {
  width: 22, height: 22, borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 800,
  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#e8eef8',
  lineHeight: 1, padding: 0,
};
