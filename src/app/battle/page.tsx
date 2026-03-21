'use client';

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { MODEL_REGISTRY } from '@/lib/model-registry';
import type { FightUIState } from '@/GamePlay/FightGame/Core/FightGameEngine';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<any>(null);
  const [uiState, setUIState] = useState<FightUIState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startGame = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || engineRef.current) return;

    try {
      const { FightGameEngine } = await import(
        '@/GamePlay/FightGame/Core/FightGameEngine'
      );

      const game = new FightGameEngine(canvas);
      engineRef.current = game;
      game.setUICallback((state: FightUIState) => setUIState(state));

      // Team 1: 3 male models, Team 2: 3 female models
      const males = MODEL_REGISTRY.filter(m => m.gender === 'male');
      const females = MODEL_REGISTRY.filter(m => m.gender === 'female');
      const team1 = [males[0], males[0], males[0]];
      const team2 = [females[0], females[1] ?? females[0], females[2] ?? females[0]];

      await game.init(team1, team2);
      game.startGame('normal');
      setLoading(false);
    } catch (e: any) {
      console.error('Game init failed:', e);
      setError(e.message ?? 'Unknown error');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startGame();
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, [startGame]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      {loading && !error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.8)', color: '#fff', fontSize: 24,
        }}>
          Loading...
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.9)', color: '#f44', fontSize: 18,
        }}>
          Error: {error}
        </div>
      )}

      {/* HUD overlay */}
      {uiState && !loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' }}>
          {/* Timer & Phase */}
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <span style={{
              color: '#fff', fontSize: 28, fontWeight: 'bold',
              textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            }}>
              {Math.ceil(uiState.timer)}
            </span>
            {uiState.phase !== 'fight' && (
              <div style={{
                color: '#ff0', fontSize: 20, fontWeight: 'bold',
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
              }}>
                {uiState.phase.toUpperCase()}
              </div>
            )}
            {uiState.winner && (
              <div style={{
                color: '#0f0', fontSize: 32, fontWeight: 'bold',
                textShadow: '0 2px 6px rgba(0,0,0,0.9)',
              }}>
                {uiState.winner} WINS!
              </div>
            )}
          </div>

          {/* Team HP bars */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 16px' }}>
            {/* Team 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {uiState.team1.map((f, i) => (
                <HPBar key={`t1-${i}`} info={f} side="left" />
              ))}
            </div>
            {/* Team 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {uiState.team2.map((f, i) => (
                <HPBar key={`t2-${i}`} info={f} side="right" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* POV damage flash */}
      {uiState && uiState.povDamageFlash > 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `rgba(255,0,0,${uiState.povDamageFlash * 0.3})`,
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

const hpBarTrackStyle: React.CSSProperties = {
  width: 160, height: 12,
  background: 'rgba(0,0,0,0.6)',
  borderRadius: 3, overflow: 'hidden',
  position: 'relative',
  border: '1px solid rgba(255,255,255,0.3)',
};

const hpLabelBaseStyle: React.CSSProperties = {
  color: '#fff', fontSize: 11, fontWeight: 'bold',
  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
  minWidth: 60,
};

const HPBar = memo(function HPBar({ info, side }: { info: any; side: 'left' | 'right' }) {
  const hpPct = Math.max(0, info.hp / info.maxHp) * 100;
  const delayPct = Math.max(0, info.delayHp / info.maxHp) * 100;
  const anchor = side === 'right' ? 'right' : 'left';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      flexDirection: side === 'right' ? 'row-reverse' : 'row',
      opacity: info.alive ? 1 : 0.4,
    }}>
      <span style={{ ...hpLabelBaseStyle, textAlign: anchor }}>
        {info.label}
      </span>
      <div style={hpBarTrackStyle}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          [anchor]: 0,
          width: `${delayPct}%`,
          background: 'rgba(255,255,255,0.4)',
          transition: 'width 0.3s',
        }} />
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          [anchor]: 0,
          width: `${hpPct}%`,
          background: hpPct > 50 ? '#4f4' : hpPct > 25 ? '#ff4' : '#f44',
          transition: 'width 0.15s',
        }} />
      </div>
    </div>
  );
});
