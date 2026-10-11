'use client';

/**
 * 対戦モードタブの中身 = 3D 対戦アクション本体 (旧 /fight ページ)。
 * P1 (キーボード) vs CPU。ゲームロジックは FightGame.ts / Fighter.ts / CpuBrain.ts。
 *
 * タブUIに組み込むため:
 *  - visible: 非表示中は display:none (エンジンは破棄せず維持)。復帰時に resize。
 *  - onGameReady: 生成した FightGame を親へ渡す (設定タブからの操作用)。
 */

import { useEffect, useRef, useState } from 'react';
import { FightGame, INITIAL_HUD, type FightHud, type P1Choice } from './FightGame';
import type { CpuDifficulty } from './CpuBrain';
import { STYLE_LABELS, type FightStyle } from './moves';
import { loadPrefs, applyOverrides } from './prefs';
import { listCharacters, getCharacter } from './characterStore';
import type { CharacterMeta } from './characterModel';

const DIFFICULTIES: CpuDifficulty[] = ['easy', 'normal', 'hard'];

/** キャラクター選択画面の表示データ */
const CHARACTERS: { style: FightStyle; name: string; body: string; desc: string }[] = [
  { style: 'boxer', name: 'ボクサー', body: '標準', desc: '手数と発生の速さ。アッパーに出始め無敵。性格: 中庸' },
  { style: 'kicker', name: 'キックボクサー', body: '高身長', desc: 'リーチと蹴り火力。長い手足で間合いの外から触れる。性格: 冷静' },
  { style: 'speed', name: 'スピード', body: '低身長', desc: '小柄で当てにくく高回転。火力は低い。性格: ビビり' },
  { style: 'power', name: 'パワー', body: '太め (標準身長)', desc: '最大火力+剛技アーマー。的はデカい。性格: 熱血' },
];

const CONTROLS: [string, string][] = [
  ['W / S', '前進・後退'],
  ['A / D', '左右ステップ'],
  ['J', 'ジャブ (→K/L へキャンセル)'],
  ['K', 'ワンツー'],
  ['L', 'フック'],
  ['U', 'アッパー'],
  ['I', '前蹴り'],
  ['O', '上段前蹴り'],
  ['Space', 'ガード (長押し/安全)'],
  ['Q', 'スウェー (回避→攻撃キャンセル可)'],
  ['E', 'カウンター (成功で自動反撃)'],
  ['H', '判定表示 ON/OFF'],
  ['1/2/3', 'CPU 難易度'],
  ['C', 'CPU vs CPU 観戦切替'],
  ['B', 'タイプ別リーグ戦'],
];

interface ArenaViewProps {
  visible: boolean;
  onGameReady?: (game: FightGame) => void;
}

export default function ArenaView({ visible, onGameReady }: ArenaViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<FightGame | null>(null);
  const [hud, setHud] = useState<FightHud>(INITIAL_HUD);
  // キャラクター選択画面のローカル状態
  // P1: マイキャラ id (優先) / 無ければ既存スタイル (フォールバック)
  const [p1Mine, setP1Mine] = useState<string | null>(null);
  const [p1Style, setP1Style] = useState<FightStyle>('boxer');
  const [cpuSel, setCpuSel] = useState<FightStyle>('kicker');
  const [ownChars, setOwnChars] = useState<CharacterMeta[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // キャラクターエディットの体格・ステータス上書きを反映してから生成
    const prefs = loadPrefs();
    applyOverrides(prefs);

    const game = new FightGame(canvas, setHud);
    gameRef.current = game;
    onGameReady?.(game);
    game.setDifficulty(prefs.difficulty);
    if (prefs.showHitboxes) game.setDebugVisible(true);

    // ?mode=cvc / ?mode=league で最初からそのモードにする
    const urlMode = new URLSearchParams(window.location.search).get('mode');
    if (urlMode === 'cvc' || urlMode === 'league') {
      game.setMode(urlMode);
    }
    void game.init();
    return () => {
      gameRef.current = null;
      game.dispose();
    };
  }, [onGameReady]);

  // タブ復帰でキャンバスサイズが変わるので resize する
  useEffect(() => {
    if (visible) gameRef.current?.resize();
  }, [visible]);

  // 選択画面に入ったとき / 対戦タブに復帰したときにマイキャラ一覧を読み直す。
  // (visible を入れないと、別タブで作成・保存したキャラが選択画面に出てこない)
  useEffect(() => {
    if (visible && hud.selecting) {
      void listCharacters().then((cs) => {
        setOwnChars(cs);
        // 未選択なら先頭のマイキャラを既定選択。選択中の id が消えていたら解除
        setP1Mine((cur) =>
          cur && cs.some((c) => c.id === cur) ? cur : (cs[0]?.id ?? null));
      });
    }
  }, [hud.selecting, visible]);

  /** 1対1 開始: P1=マイキャラ or 既存スタイル、相手=既存スタイル */
  const onStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      let choice: P1Choice;
      if (p1Mine) {
        const rec = await getCharacter(p1Mine);
        if (!rec) {
          setStartError('マイキャラの読み込みに失敗しました。保存し直してください。');
          setStarting(false);
          return;
        }
        choice = { kind: 'mine', record: rec };
      } else {
        choice = { kind: 'style', style: p1Style };
      }
      setStartError(null);
      await gameRef.current?.startMatch(choice, cpuSel, 'pvc');
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const bar = (value: number, color: string, reverse = false) => (
    <div style={{
      height: 14, background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      display: 'flex', justifyContent: reverse ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, value))}%`, height: '100%',
        background: color, transition: 'width 120ms linear',
      }} />
    </div>
  );

  const pips = (wins: number, color: string) => (
    <span>
      {[0, 1].map(i => (
        <span key={i} style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          marginRight: 4,
          background: i < wins ? color : 'rgba(255,255,255,0.18)',
          boxShadow: i < wins ? `0 0 6px ${color}` : 'none',
        }} />
      ))}
    </span>
  );

  /** 感情ゲージ (興奮=橙 / 冷静=水色) + ZONE/FEAR バッジ */
  const emotionMeter = (e: { excited: number; calm: number; mood: string }) => {
    const miniBar = (label: string, value: number, color: string) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
        <span style={{ fontSize: 9, color: '#9fb0c8', width: 20 }}>{label}</span>
        <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.1)' }}>
          <div style={{
            width: `${Math.max(0, Math.min(100, value))}%`, height: '100%',
            background: color, transition: 'width 150ms linear',
          }} />
        </div>
      </div>
    );
    return (
      <div style={{ marginTop: 6, position: 'relative' }}>
        {miniBar('興奮', e.excited, '#ff8c3a')}
        {miniBar('冷静', e.calm, '#3ac8ff')}
        {e.mood !== 'neutral' && (
          <span style={{
            position: 'absolute', right: 0, top: -16, fontSize: 10, fontWeight: 800,
            padding: '1px 6px', borderRadius: 3,
            background: e.mood === 'zone' ? '#ffd45a' : '#5a6478',
            color: '#0b0d12',
          }}>{e.mood === 'zone' ? 'ZONE' : 'FEAR'}</span>
        )}
      </div>
    );
  };

  return (
    <main style={{
      width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
      background: '#07090f', color: '#eef2fa', fontFamily: 'Arial, sans-serif',
      display: visible ? 'block' : 'none',
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />

      {/* 上部 HUD */}
      <section style={{
        position: 'absolute', top: 14, left: 14, right: 14,
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, pointerEvents: 'none',
      }}>
        <div style={{ background: 'rgba(8,12,18,0.75)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 6 }}>
            <span style={{ color: '#5aa2ff' }}>{hud.p1Label}</span>
            <span>{Math.ceil(hud.p1Hp)} / {hud.p1MaxHp}</span>
          </div>
          {bar(hud.p1Hp / hud.p1MaxHp * 100, '#2d8cff')}
          <div style={{ marginTop: 6 }}>{pips(hud.p1Wins, '#2d8cff')}</div>
          {emotionMeter(hud.p1Emotion)}
        </div>

        <div style={{
          minWidth: 150, textAlign: 'center', background: 'rgba(8,12,18,0.85)',
          border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '8px 16px',
        }}>
          <div style={{ fontSize: 12, color: '#9fb0c8' }}>BEST OF 3</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Round {hud.round}</div>
          <div style={{
            fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: hud.roundTime <= 10 ? '#ff5d5d' : '#eef2fa',
          }}>
            {Math.ceil(hud.roundTime).toString().padStart(2, '0')}
          </div>
          <div style={{ fontSize: 11, color: '#c8d4e8' }}>{hud.status}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'center', pointerEvents: 'auto' }}>
            {DIFFICULTIES.map(d => (
              <button
                key={d}
                onClick={() => gameRef.current?.setDifficulty(d)}
                style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer',
                  background: hud.difficulty === d ? '#ffd45a' : 'rgba(255,255,255,0.08)',
                  color: hud.difficulty === d ? '#0b0d12' : '#c8d4e8',
                }}
              >{d.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'center', pointerEvents: 'auto' }}>
            <button
              onClick={() => gameRef.current?.setMode(hud.mode === 'cvc' ? 'pvc' : 'cvc')}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer',
                background: hud.mode === 'cvc' ? '#7ad17a' : 'rgba(255,255,255,0.08)',
                color: hud.mode === 'cvc' ? '#0b0d12' : '#c8d4e8',
              }}
            >{hud.mode === 'cvc' ? 'CPU vs CPU 観戦中' : 'CPU vs CPU'}</button>
            <button
              onClick={() => gameRef.current?.setMode(hud.mode === 'league' ? 'pvc' : 'league')}
              style={{
                fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer',
                background: hud.mode === 'league' ? '#c79bff' : 'rgba(255,255,255,0.08)',
                color: hud.mode === 'league' ? '#0b0d12' : '#c8d4e8',
              }}
            >{hud.mode === 'league' ? 'リーグ戦 開催中' : 'タイプ別リーグ戦'}</button>
          </div>
          {hud.league && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#d8c8f8' }}>
              第{hud.league.matchIndex}/{hud.league.totalMatches}試合: {hud.league.matchLabel}
            </div>
          )}
        </div>

        <div style={{ background: 'rgba(8,12,18,0.75)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 6 }}>
            <span>{Math.ceil(hud.cpuHp)} / {hud.cpuMaxHp}</span>
            <span style={{ color: '#ff6a5a' }}>{hud.cpuLabel}</span>
          </div>
          {bar(hud.cpuHp / hud.cpuMaxHp * 100, '#ff4630', true)}
          <div style={{ marginTop: 6, textAlign: 'right' }}>{pips(hud.cpuWins, '#ff4630')}</div>
          {emotionMeter(hud.cpuEmotion)}
        </div>
      </section>

      {/* フィード */}
      <div style={{
        position: 'absolute', left: 14, bottom: 14, maxWidth: 460,
        background: 'rgba(8,12,18,0.75)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8, padding: '8px 12px', fontSize: 13, pointerEvents: 'none',
      }}>
        {hud.feed}
      </div>

      {/* 操作説明 */}
      <div style={{
        position: 'absolute', right: 14, bottom: 14,
        background: 'rgba(8,12,18,0.75)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#b8c4d8', pointerEvents: 'none',
      }}>
        {CONTROLS.map(([key, desc]) => (
          <div key={key} style={{ display: 'flex', gap: 8, lineHeight: 1.7 }}>
            <span style={{ minWidth: 52, fontWeight: 700, color: '#e8eef8' }}>{key}</span>
            <span>{desc}</span>
          </div>
        ))}
      </div>

      {/* キャラクター選択 */}
      {hud.selecting && !hud.loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,14,0.82)', backdropFilter: 'blur(3px)',
        }}>
          <div style={{
            background: 'rgba(12,16,24,0.96)', border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 12, padding: '24px 32px', maxWidth: 760, width: '90%',
          }}>
            <div style={{ fontSize: 14, letterSpacing: 5, color: '#aeb8c8', textAlign: 'center' }}>
              CHARACTER SELECT
            </div>

            {/* P1: マイキャラ + 既存スタイル(フォールバック) */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2d8cff', marginBottom: 6 }}>
                あなた (P1)
              </div>
              {ownChars.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
                  {ownChars.map(c => {
                    const sel = p1Mine === c.id;
                    return (
                      <div
                        key={c.id}
                        onClick={() => setP1Mine(c.id)}
                        style={{
                          border: sel ? '2px solid #2d8cff' : '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 8, padding: '10px', cursor: 'pointer',
                          background: sel ? 'rgba(45,140,255,0.12)' : 'rgba(255,255,255,0.02)',
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 800 }}>{c.name}</div>
                        <div style={{ fontSize: 10, color: '#ffd45a', marginTop: 2 }}>
                          マイキャラ ・ {STYLE_LABELS[c.style]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: 10, color: '#7b8798', margin: '2px 0 6px' }}>
                {ownChars.length > 0 ? '— または既存キャラを使う —' : 'マイキャラ未作成 (エディットタブで作成可)。既存キャラで対戦できます:'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {CHARACTERS.map(c => {
                  const sel = !p1Mine && p1Style === c.style;
                  return (
                    <div
                      key={c.style}
                      onClick={() => { setP1Mine(null); setP1Style(c.style); }}
                      style={{
                        border: sel ? '2px solid #2d8cff' : '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 8, padding: '8px', cursor: 'pointer',
                        background: sel ? 'rgba(45,140,255,0.1)' : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{c.name}</div>
                      <div style={{ fontSize: 10, color: '#9fb0c8', marginTop: 2 }}>{c.body}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 相手 (CPU): 既存スタイル */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#ff4630', marginBottom: 6 }}>相手 (CPU)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {CHARACTERS.map(c => (
                  <div
                    key={c.style}
                    onClick={() => setCpuSel(c.style)}
                    style={{
                      border: cpuSel === c.style ? '2px solid #ff4630' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 8, padding: '10px', cursor: 'pointer',
                      background: cpuSel === c.style ? 'rgba(255,70,48,0.1)' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: '#ffd45a', marginTop: 2 }}>{c.body}</div>
                    <div style={{ fontSize: 10, color: '#9fb0c8', marginTop: 4, lineHeight: 1.5 }}>{c.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {startError && (
              <div style={{ color: '#ff8c8c', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                {startError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center' }}>
              <button
                onClick={() => void onStart()}
                disabled={starting}
                style={{
                  fontSize: 16, fontWeight: 800, padding: '10px 36px', borderRadius: 6,
                  border: 'none', cursor: starting ? 'default' : 'pointer',
                  background: starting ? 'rgba(255,255,255,0.2)' : '#ffd45a', color: '#0b0d12',
                }}
              >{starting ? '準備中…' : '1対1 で対戦'}</button>
              <button
                onClick={() => gameRef.current?.setMode('league')}
                style={{
                  fontSize: 12, fontWeight: 700, padding: '10px 16px', borderRadius: 6,
                  border: '1px solid rgba(199,155,255,0.5)', cursor: 'pointer',
                  background: 'rgba(199,155,255,0.15)', color: '#d8c8f8',
                }}
              >タイプ別リーグ戦 (既存4体)</button>
            </div>
            <div style={{ fontSize: 10, color: '#7b8798', textAlign: 'center', marginTop: 10 }}>
              試合中は Esc でこの画面に戻れます ・ リーグ/トーナメントの自キャラ参戦は次の更新で対応
            </div>
          </div>
        </div>
      )}

      {/* ローディング */}
      {hud.loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12,
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,14,0.72)', backdropFilter: 'blur(2px)', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 15, letterSpacing: 5, color: '#aeb8c8' }}>LOADING</div>
          <div style={{ fontSize: 12, color: '#8794a8' }}>{hud.loadingText}</div>
        </div>
      )}

      {/* リーグ順位表 (リーグ戦中は常時表示) */}
      {hud.league && (
        <div style={{
          position: 'absolute', left: 14, top: 170,
          background: 'rgba(8,12,18,0.8)', border: '1px solid rgba(199,155,255,0.35)',
          borderRadius: 8, padding: '10px 12px', fontSize: 12, pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, color: '#d8c8f8', marginBottom: 6 }}>
            リーグ順位表
          </div>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#9fb0c8', fontSize: 10 }}>
                <th style={{ textAlign: 'left', padding: '2px 8px 2px 0' }}>タイプ</th>
                <th style={{ padding: '2px 6px' }}>勝</th>
                <th style={{ padding: '2px 6px' }}>敗</th>
                <th style={{ padding: '2px 6px' }}>R得失</th>
              </tr>
            </thead>
            <tbody>
              {hud.league.standings.map((s, i) => (
                <tr key={s.style} style={{
                  color: i === 0 && (s.matchWins > 0 || hud.league!.finished) ? '#ffd45a' : '#dde6f4',
                }}>
                  <td style={{ padding: '2px 8px 2px 0' }}>{i + 1}. {s.label}</td>
                  <td style={{ textAlign: 'center', padding: '2px 6px' }}>{s.matchWins}</td>
                  <td style={{ textAlign: 'center', padding: '2px 6px' }}>{s.matchLosses}</td>
                  <td style={{ textAlign: 'center', padding: '2px 6px' }}>
                    {s.roundWins - s.roundLosses >= 0 ? '+' : ''}{s.roundWins - s.roundLosses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* リーグ最終結果 */}
      {hud.league?.finished && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,14,0.8)', backdropFilter: 'blur(2px)', pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(12,16,24,0.95)', border: '1px solid rgba(199,155,255,0.4)',
            borderRadius: 12, padding: '26px 44px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, letterSpacing: 4, color: '#aeb8c8' }}>LEAGUE CHAMPION</div>
            <div style={{ fontSize: 38, fontWeight: 900, marginTop: 6, color: '#ffd45a' }}>
              {hud.league.championLabel}
            </div>
            <table style={{ borderCollapse: 'collapse', margin: '14px auto 0', fontSize: 13 }}>
              <tbody>
                {hud.league.standings.map((s, i) => (
                  <tr key={s.style} style={{ color: i === 0 ? '#ffd45a' : '#dde6f4' }}>
                    <td style={{ textAlign: 'left', padding: '2px 10px 2px 0' }}>{i + 1}. {s.label}</td>
                    <td style={{ padding: '2px 6px' }}>{s.matchWins}勝{s.matchLosses}敗</td>
                    <td style={{ padding: '2px 6px' }}>
                      R{s.roundWins - s.roundLosses >= 0 ? '+' : ''}{s.roundWins - s.roundLosses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 13, color: '#ffd45a', marginTop: 16 }}>
              R: もう一度リーグ / B: 操作モードへ
            </div>
          </div>
        </div>
      )}

      {/* マッチ終了 (リーグ最終結果の表示中は出さない) */}
      {hud.matchOver && !hud.league?.finished && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,14,0.78)', backdropFilter: 'blur(2px)', pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(12,16,24,0.95)', border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 12, padding: '26px 44px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, letterSpacing: 4, color: '#aeb8c8' }}>WINNER</div>
            <div style={{
              fontSize: 40, fontWeight: 900, marginTop: 6,
              color: hud.matchWinnerSide === 'p1' ? '#5aa2ff' : '#ff6a5a',
            }}>
              {hud.matchWinner}
            </div>
            <div style={{ fontSize: 13, color: '#bac6da', marginTop: 6 }}>
              {hud.p1Wins} – {hud.cpuWins}
            </div>
            <div style={{ fontSize: 13, color: '#ffd45a', marginTop: 16 }}>
              {hud.mode === 'league' ? 'まもなく次の試合'
                : hud.mode === 'cvc' ? '5秒後に自動再戦' : 'R キーで再戦'}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
