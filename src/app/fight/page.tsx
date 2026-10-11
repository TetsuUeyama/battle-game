'use client';

/**
 * /fight — トップページ。左端のタブで 3 機能を切り替える。
 *   1. キャラクターエディット (体格調整)
 *   2. 対戦モード (3D 対戦アクション本体 = ArenaView)
 *   3. 設定 (CPU 難易度・判定表示)
 *
 * 対戦 (Babylon エンジン) はタブを離れても破棄せず display で出し分ける
 * (再ロードの数十MB を避ける)。エディット/設定は軽いので条件レンダリング。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ArenaView from './ArenaView';
import CharacterEdit from './CharacterEdit';
import Settings from './Settings';
import type { FightGame } from './FightGame';

type Tab = 'edit' | 'battle' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'edit', label: 'キャラクター\nエディット', icon: '🛠' },
  { id: 'battle', label: '対戦モード', icon: '⚔' },
  { id: 'settings', label: '設定', icon: '⚙' },
];

export default function FightPage() {
  // SSR と一致させるため初期は 'battle' 固定。マウント後に URL ?tab= を反映
  const [tab, setTab] = useState<Tab>('battle');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'edit' || t === 'settings') setTab(t);
  }, []);
  // ArenaView が生成した FightGame (設定タブの即時反映に使う)
  const gameRef = useRef<FightGame | null>(null);
  const onGameReady = useCallback((game: FightGame) => { gameRef.current = game; }, []);

  return (
    <div style={{
      display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden',
      background: '#07090f', color: '#eef2fa', fontFamily: 'Arial, sans-serif',
    }}>
      {/* 左タブ */}
      <nav style={{
        width: 132, flexShrink: 0, background: '#0c0f16',
        borderRight: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', flexDirection: 'column', padding: '14px 0',
      }}>
        <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1, textAlign: 'center', color: '#ff7788', marginBottom: 16 }}>
          BATTLE<br />GAME
        </div>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '14px 6px', cursor: 'pointer', border: 'none',
                borderLeft: active ? '3px solid #ffd45a' : '3px solid transparent',
                background: active ? 'rgba(255,212,90,0.1)' : 'transparent',
                color: active ? '#ffd45a' : '#9fb0c8',
                fontSize: 11, fontWeight: 700, lineHeight: 1.3, whiteSpace: 'pre-line',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* コンテンツ領域 */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {/* 対戦は常時マウント (エンジン維持)。display で出し分け */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <ArenaView visible={tab === 'battle'} onGameReady={onGameReady} />
        </div>

        {tab === 'edit' && (
          <div style={{ position: 'absolute', inset: 0, background: '#07090f' }}>
            <CharacterEdit />
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ position: 'absolute', inset: 0, background: '#07090f' }}>
            <Settings game={gameRef.current} />
          </div>
        )}
      </div>
    </div>
  );
}
