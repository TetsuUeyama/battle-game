'use client';

/**
 * 設定タブ。デフォルト CPU 難易度・起動時の判定表示を保存する。
 * 「現在の対戦に即適用」用に、対戦中の FightGame を game prop で受け取る。
 */

import { useState } from 'react';
import type { FightGame } from './FightGame';
import type { CpuDifficulty } from './CpuBrain';
import { loadPrefs, savePrefs } from './prefs';

const DIFFICULTIES: { id: CpuDifficulty; label: string; desc: string }[] = [
  { id: 'easy', label: 'EASY', desc: '反応が遅く、ミスが多い。差し返し・カウンターも控えめ' },
  { id: 'normal', label: 'NORMAL', desc: '見てからガード、硬直に反撃。標準的な強さ' },
  { id: 'hard', label: 'HARD', desc: '高速反応・高確率の差し返しとカウンター。隙を見逃さない' },
];

interface SettingsProps {
  /** 対戦中の FightGame (即時反映用)。未生成なら null */
  game: FightGame | null;
}

export default function Settings({ game }: SettingsProps) {
  const init = loadPrefs();
  const [difficulty, setDifficulty] = useState<CpuDifficulty>(init.difficulty);
  const [showHitboxes, setShowHitboxes] = useState(init.showHitboxes);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const persist = (next: { difficulty?: CpuDifficulty; showHitboxes?: boolean }) => {
    const prefs = loadPrefs();
    savePrefs({
      ...prefs,
      difficulty: next.difficulty ?? difficulty,
      showHitboxes: next.showHitboxes ?? showHitboxes,
    });
    setSavedAt(Date.now());
  };

  const pickDifficulty = (d: CpuDifficulty) => {
    setDifficulty(d);
    game?.setDifficulty(d); // 対戦中なら即反映
    persist({ difficulty: d });
  };

  const toggleHitboxes = (v: boolean) => {
    setShowHitboxes(v);
    game?.setDebugVisible(v); // 対戦中なら即反映
    persist({ showHitboxes: v });
  };

  return (
    <div style={{ padding: '28px 32px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>設定</h2>
      <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 6 }}>
        変更は自動保存され、対戦中であればその場で反映されます。
      </p>

      {/* CPU 難易度 */}
      <section style={{ marginTop: 20, maxWidth: 560 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>CPU 難易度 (デフォルト)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DIFFICULTIES.map((d) => (
            <div
              key={d.id}
              onClick={() => pickDifficulty(d.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                border: difficulty === d.id ? '2px solid #ffd45a' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8, padding: '10px 14px',
                background: difficulty === d.id ? 'rgba(255,212,90,0.08)' : 'rgba(255,255,255,0.02)',
              }}
            >
              <span style={{
                fontSize: 13, fontWeight: 800, width: 64,
                color: difficulty === d.id ? '#ffd45a' : '#c8d4e8',
              }}>{d.label}</span>
              <span style={{ fontSize: 11, color: '#9fb0c8' }}>{d.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 判定表示 */}
      <section style={{ marginTop: 24, maxWidth: 560 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>判定表示 (hitbox / hurtbox)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showHitboxes}
            onChange={(e) => toggleHitboxes(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 12, color: '#c8d4e8' }}>
            攻撃判定 (赤) / 被弾判定 (緑) の球を表示する (対戦中は H キーでも切替)
          </span>
        </label>
      </section>

      {savedAt && (
        <div style={{ fontSize: 12, color: '#7ad17a', marginTop: 20 }}>保存しました。</div>
      )}
    </div>
  );
}
