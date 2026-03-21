'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';
import {
  JudoState, createInitialState, judoUpdate, getSceneLayout,
  lerpPose, applyPose, buildProceduralFighter, getStateLabel,
  POSE_IDLE,
  type JudoGameState, type PoseData,
} from '@/lib/judo-engine';

// ─── Main Component ──────────────────────────────────────
export default function JudoPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef<JudoGameState>(createInitialState());

  const [uiState, setUiState] = useState(JudoState.KUMI_TE);
  const [attacker, setAttacker] = useState<string | null>(null);
  const [pinTimer, setPinTimer] = useState(0);
  const [chokeTimer, setChokeTimer] = useState(0);
  const [escapeProgress, setEscapeProgress] = useState(0);
  const [playerStamina, setPlayerStamina] = useState(100);
  const [aiStamina, setAiStamina] = useState(100);
  const [playerWazari, setPlayerWazari] = useState(0);
  const [aiWazari, setAiWazari] = useState(0);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const eventLogRef = useRef<string[]>([]);

  // Babylon scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.15, 0.15, 0.2, 1);

    // camera from the side so both fighters are visible face-to-face
    const camera = new ArcRotateCamera('cam', 0, Math.PI / 3, 4, new Vector3(0, 0.5, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 8;
    camera.wheelPrecision = 40;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
    const dir = new DirectionalLight('dir', new Vector3(-1, -2, 1), scene);
    dir.intensity = 0.7;

    // tatami (green mat)
    const ground = MeshBuilder.CreateGround('tatami', { width: 6, height: 6 }, scene);
    const gMat = new StandardMaterial('tatamiMat', scene);
    gMat.diffuseColor = new Color3(0.3, 0.55, 0.3);
    ground.material = gMat;

    // boundary line
    const border = MeshBuilder.CreateGround('border', { width: 4, height: 4 }, scene);
    border.position.y = 0.001;
    const bMat = new StandardMaterial('borderMat', scene);
    bMat.diffuseColor = new Color3(0.8, 0.8, 0.2);
    bMat.alpha = 0.3;
    border.material = bMat;

    // fighters
    const playerFighter = buildProceduralFighter(scene, new Color3(0.2, 0.3, 0.8), 'player');
    const aiFighter = buildProceduralFighter(scene, new Color3(0.8, 0.2, 0.2), 'ai');

    // pose blending state
    let prevState = gsRef.current.state;
    let blendT = 1;
    let playerPrevPose: PoseData = POSE_IDLE;
    let aiPrevPose: PoseData = POSE_IDLE;
    let currentPlayerPose: PoseData = POSE_IDLE;
    let currentAiPose: PoseData = POSE_IDLE;
    let playerPrevPos: [number, number, number] = [0, 0, -0.6];
    let aiPrevPos: [number, number, number] = [0, 0, 0.6];

    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      const gs = gsRef.current;

      // CPU vs CPU — no player action passed
      judoUpdate(gs, dt);

      // state change → snapshot current pose as "from", reset blend
      if (gs.state !== prevState) {
        // capture current poses before transition
        playerPrevPose = currentPlayerPose;
        aiPrevPose = currentAiPose;
        playerPrevPos = [playerFighter.root.position.x, playerFighter.root.position.y, playerFighter.root.position.z];
        aiPrevPos = [aiFighter.root.position.x, aiFighter.root.position.y, aiFighter.root.position.z];
        blendT = 0;
        prevState = gs.state;
      }

      blendT = Math.min(1, blendT + dt * 2.5); // ~0.4s transition

      // get layout for current state
      const layout = getSceneLayout(gs);
      const isPlayerAttacker = gs.attacker === 'player' || gs.attacker === null;

      const playerTargetPose = isPlayerAttacker ? layout.attackerPose : layout.defenderPose;
      const aiTargetPose = isPlayerAttacker ? layout.defenderPose : layout.attackerPose;
      const playerTargetPos = isPlayerAttacker ? layout.attackerPos : layout.defenderPos;
      const aiTargetPos = isPlayerAttacker ? layout.defenderPos : layout.attackerPos;

      // lerp poses from previous to target
      currentPlayerPose = lerpPose(playerPrevPose, playerTargetPose, blendT);
      currentAiPose = lerpPose(aiPrevPose, aiTargetPose, blendT);

      // lerp positions
      const pX = playerPrevPos[0] + (playerTargetPos[0] - playerPrevPos[0]) * blendT;
      const pY = playerPrevPos[1] + (playerTargetPos[1] - playerPrevPos[1]) * blendT;
      const pZ = playerPrevPos[2] + (playerTargetPos[2] - playerPrevPos[2]) * blendT;
      const aX = aiPrevPos[0] + (aiTargetPos[0] - aiPrevPos[0]) * blendT;
      const aY = aiPrevPos[1] + (aiTargetPos[1] - aiPrevPos[1]) * blendT;
      const aZ = aiPrevPos[2] + (aiTargetPos[2] - aiPrevPos[2]) * blendT;

      // for throw animation, use layout position directly (it's already animated)
      if (gs.state === JudoState.THROW_SUCCESS) {
        const defPos = isPlayerAttacker ? layout.defenderPos : layout.attackerPos;
        const atkPos = isPlayerAttacker ? layout.attackerPos : layout.defenderPos;
        playerFighter.root.position.set(
          isPlayerAttacker ? atkPos[0] : defPos[0],
          isPlayerAttacker ? atkPos[1] : defPos[1],
          isPlayerAttacker ? atkPos[2] : defPos[2]
        );
        aiFighter.root.position.set(
          isPlayerAttacker ? defPos[0] : atkPos[0],
          isPlayerAttacker ? defPos[1] : atkPos[1],
          isPlayerAttacker ? defPos[2] : atkPos[2]
        );
      } else {
        playerFighter.root.position.set(pX, pY, pZ);
        aiFighter.root.position.set(aX, aY, aZ);
      }

      // rotate root so Z-forward faces the opponent
      // player (left) faces +X → rotateY = -PI/2
      // ai (right) faces -X → rotateY = +PI/2
      playerFighter.root.rotation.y = -Math.PI / 2;
      aiFighter.root.rotation.y = Math.PI / 2;

      applyPose(playerFighter, currentPlayerPose, 1);
      applyPose(aiFighter, currentAiPose, 1); // both use facing=1, root rotation handles mirroring

      // sync UI state
      setUiState(gs.state);
      setAttacker(gs.attacker);
      setPinTimer(gs.pinTimer);
      setChokeTimer(gs.chokeTimer);
      setEscapeProgress(gs.escapeProgress);
      setPlayerStamina(gs.fighters.player.stamina);
      setAiStamina(gs.fighters.ai.stamina);
      setPlayerWazari(gs.fighters.player.wazari);
      setAiWazari(gs.fighters.ai.wazari);
      setMatchResult(gs.matchResult);

      if (gs.events.length > 0) {
        eventLogRef.current = [...gs.events, ...eventLogRef.current].slice(0, 8);
        setEvents([...eventLogRef.current]);
      }

      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
    };
  }, []);

  const resetMatch = useCallback(() => {
    gsRef.current = createInitialState();
    eventLogRef.current = [];
    setEvents([]);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: '#1a1a2e' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '10px 20px', background: 'rgba(0,0,0,0.75)', color: '#fff',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 20, fontWeight: 'bold' }}>{getStateLabel(uiState)}</span>
          </div>
          <div style={{ fontSize: 14 }}>
            <span style={{ color: '#6688ff' }}>Player 技あり: {playerWazari}</span>
            <span style={{ margin: '0 16px' }}>vs</span>
            <span style={{ color: '#ff6666' }}>AI 技あり: {aiWazari}</span>
          </div>
        </div>
        {/* Stamina bars */}
        <div style={{ display: 'flex', gap: 20, marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#8af' }}>Player スタミナ</div>
            <div style={{ width: '100%', height: 8, background: '#333', borderRadius: 4 }}>
              <div style={{ width: `${playerStamina}%`, height: '100%', background: '#4488ff', borderRadius: 4, transition: 'width 0.2s' }} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#f88' }}>AI スタミナ</div>
            <div style={{ width: '100%', height: 8, background: '#333', borderRadius: 4 }}>
              <div style={{ width: `${aiStamina}%`, height: '100%', background: '#ff4444', borderRadius: 4, transition: 'width 0.2s' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Pin/Choke timers */}
      {(uiState === JudoState.PIN || uiState === JudoState.CHOKE) && (
        <div style={{
          position: 'absolute', top: 90, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.7)', padding: '8px 20px', borderRadius: 8, color: '#fff', textAlign: 'center',
        }}>
          {uiState === JudoState.PIN && (
            <div>
              <div style={{ fontSize: 13 }}>抑え込み</div>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{pinTimer.toFixed(1)}s / 20s</div>
              <div style={{ width: 200, height: 6, background: '#333', borderRadius: 3, marginTop: 4 }}>
                <div style={{ width: `${(pinTimer / 20) * 100}%`, height: '100%', background: '#ff8800', borderRadius: 3 }} />
              </div>
            </div>
          )}
          {uiState === JudoState.CHOKE && (
            <div>
              <div style={{ fontSize: 13 }}>締め技</div>
              <div style={{ fontSize: 28, fontWeight: 'bold' }}>{chokeTimer.toFixed(1)}s / 5s</div>
              <div style={{ width: 200, height: 6, background: '#333', borderRadius: 3, marginTop: 4 }}>
                <div style={{ width: `${(chokeTimer / 5) * 100}%`, height: '100%', background: '#ff3333', borderRadius: 3 }} />
              </div>
            </div>
          )}
          {escapeProgress > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11 }}>脱出ゲージ（守り側）</div>
              <div style={{ width: 200, height: 6, background: '#333', borderRadius: 3, marginTop: 2 }}>
                <div style={{ width: `${escapeProgress * 100}%`, height: '100%', background: '#44ff44', borderRadius: 3 }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Event log */}
      <div style={{
        position: 'absolute', left: 16, top: 100, zIndex: 10, color: '#fff', fontSize: 13,
      }}>
        {events.map((e, i) => (
          <div key={i} style={{ opacity: 1 - i * 0.12, marginBottom: 2 }}>{e}</div>
        ))}
      </div>

      {/* Match result overlay */}
      {matchResult && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: matchResult.startsWith('勝') ? '#44ff88' : '#ff4444' }}>
            {matchResult}
          </div>
          <button
            onClick={resetMatch}
            style={{
              marginTop: 20, padding: '10px 30px', fontSize: 18,
              background: '#444', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            }}
          >もう一度</button>
        </div>
      )}

      {/* CPU vs CPU label */}
      {!matchResult && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '6px 18px', borderRadius: 8,
          color: '#aaa', fontSize: 14,
        }}>
          CPU vs CPU 観戦モード
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

