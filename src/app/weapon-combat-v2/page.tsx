'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Quaternion,
} from '@babylonjs/core';
import {
  initHavok, createHavokCharacter, updateHavokCharacter,
  fetchGameAssetWeapons, equipGameAssetWeapon,
  createCombatAIvsCharacter, updateCombatAIvsCharacter,
  resolveCharacterCollision, teleportCharacter, clampToFieldBounds,
  getWeaponTipWorld,
  createClashState, checkWeaponClash, updateClashReaction,
  updateBalance,
  type ClashState,
  type HavokCharacter, type CombatAI, type GameAssetWeaponInfo,
} from '@/lib/havok-character';
import { ParticleFxSystem, PRESET_BLOOD, type FluidPreset } from '@/lib/particle-fx';

// 火花プリセット
const PRESET_SPARK: FluidPreset = {
  name: 'Spark',
  color: new Color3(1.0, 0.8, 0.2),
  specular: new Color3(1.0, 1.0, 0.8),
  residueColor: new Color3(0.3, 0.2, 0.05),
  alpha: 1.0,
  residueAlpha: 0,
  particleSize: 0.012,
  gravityMul: 0.5,
  airResistance: 0.8,
  dripSpeed: 0,
  dripDelay: [10, 10],
  splashOnGround: false,
  splashOnMesh: false,
  splashMul: 0,
  speedMul: 1.5,
  verticalDamping: 0,
};

interface FighterHUD {
  hp: number;
  maxHp: number;
  state: string;
  weaponName: string;
  balance: number; // 0=安定, >0=不安定
  staggered: boolean;
}

export default function WeaponCombatV2Page() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [f1, setF1] = useState<FighterHUD>({ hp: 100, maxHp: 100, state: 'idle', weaponName: '', balance: 0, staggered: false });
  const [f2, setF2] = useState<FighterHUD>({ hp: 100, maxHp: 100, state: 'idle', weaponName: '', balance: 0, staggered: false });
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [weaponList, setWeaponList] = useState<GameAssetWeaponInfo[]>([]);
  const [weapon1Key, setWeapon1Key] = useState('');
  const [weapon2Key, setWeapon2Key] = useState('');
  const [fightStarted, setFightStarted] = useState(false);
  const startFightRef = useRef<((w1: string, w2: string) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.1, 0.1, 0.15, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3.5, 6, new Vector3(0, 0.8, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 15;
    camera.wheelPrecision = 30;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
    new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.8;

    const ground = MeshBuilder.CreateGround('arena', { width: 10, height: 10 }, scene);
    const gMat = new StandardMaterial('arenaMat', scene);
    gMat.diffuseColor = new Color3(0.35, 0.3, 0.25);
    ground.material = gMat;

    // Particle FX
    const bloodFx = new ParticleFxSystem(scene, PRESET_BLOOD, {
      maxParticles: 200, maxResidues: 500, maxSticky: 200,
    });
    const sparkFx = new ParticleFxSystem(scene, PRESET_SPARK, {
      maxParticles: 100, maxResidues: 0, maxSticky: 0,
    });

    // State
    let f1Hp = 100, f2Hp = 100;
    let ai1: CombatAI | null = null;
    let ai2: CombatAI | null = null;
    const clash1 = createClashState();
    const clash2 = createClashState();
    let char1: HavokCharacter | null = null;
    let char2: HavokCharacter | null = null;
    let matchEnded = false;

    const eventLog: string[] = [];
    function addEvent(msg: string) {
      eventLog.unshift(msg);
      if (eventLog.length > 8) eventLog.pop();
      setEvents([...eventLog]);
    }

    (async () => {
      try {
        await initHavok(scene);
        if (disposed) return;

        // 2体のキャラクター作成 (同一設定、原点で初期化)
        char1 = await createHavokCharacter(scene, {
          bodyColor: new Color3(0.2, 0.35, 0.8),
          prefix: 'f1',
          position: new Vector3(0, 0, 0),
          enablePhysics: false,
          enableDebug: false,
        });

        char2 = await createHavokCharacter(scene, {
          bodyColor: new Color3(0.8, 0.2, 0.2),
          prefix: 'f2',
          position: new Vector3(0, 0, 0),
          enablePhysics: false,
          enableDebug: false,
        });

        // 初期化完了後にテレポートで配置・向きを設定
        teleportCharacter(char1, new Vector3(0, 0, -2), 0);       // +Z方向を向く
        teleportCharacter(char2, new Vector3(0, 0, 2), Math.PI);  // -Z方向を向く (f1に向かう)

        // 武器一覧を取得してUIに反映
        const weapons = await fetchGameAssetWeapons();
        setWeaponList(weapons);
        if (weapons.length > 0) {
          setWeapon1Key(weapons[0].pieceKey);
          setWeapon2Key(weapons[0].pieceKey);
        }

        // 戦闘開始関数を登録 (UIから呼び出せるようにする)
        startFightRef.current = async (w1Key: string, w2Key: string) => {
          if (!char1 || !char2 || matchEnded) return;

          const w1Info = weapons.find(w => w.pieceKey === w1Key);
          const w2Info = weapons.find(w => w.pieceKey === w2Key);
          if (!w1Info || !w2Info) {
            addEvent('Selected weapon not found');
            return;
          }

          try {
            await equipGameAssetWeapon(scene, char1, w1Info, 'front');
            await equipGameAssetWeapon(scene, char2, w2Info, 'front');

            if (!char1.weapon || !char2.weapon) {
              addEvent('Weapon equip failed');
              return;
            }

            ai1 = createCombatAIvsCharacter(char2, char1.weapon);
            ai2 = createCombatAIvsCharacter(char1, char2.weapon);
            ai1.enabled = true;
            ai2.enabled = true;

            f1Hp = 100; f2Hp = 100;
            matchEnded = false;
            setMatchResult(null);

            setF1(prev => ({ ...prev, hp: 100, weaponName: `${w1Info.category}/${w1Info.pieceKey}` }));
            setF2(prev => ({ ...prev, hp: 100, weaponName: `${w2Info.category}/${w2Info.pieceKey}` }));
            setFightStarted(true);
            addEvent(`Fight! ${w1Info.pieceKey} vs ${w2Info.pieceKey}`);
          } catch (e) {
            console.error('Weapon equip failed:', e);
            addEvent(`Error equipping weapon: ${e}`);
          }
        };

        setLoading(false);
      } catch (e) {
        console.error('Init failed:', e);
        addEvent(`Error: ${e}`);
        setLoading(false);
      }
    })();

    let prevTime = performance.now();
    let hudTimer = 0;

    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.1);
      prevTime = now;

      if (!char1 || !char2 || !ai1 || !ai2 || matchEnded) {
        scene.render();
        return;
      }

      // AI更新
      const hit1 = updateCombatAIvsCharacter(ai1, char1, scene, dt);
      const hit2 = updateCombatAIvsCharacter(ai2, char2, scene, dt);

      // ヒット処理 + パーティクル
      if (hit1.hit && char2) {
        f2Hp = Math.max(0, f2Hp - hit1.damage);
        addEvent(`Fighter1 hits Fighter2! (-${hit1.damage} HP)`);
        // 血しぶき: 武器先端位置から相手方向に噴出
        const tip1 = getWeaponTipWorld(char1);
        const hitDir1 = char2.root.position.subtract(char1.root.position).normalize();
        bloodFx.emit({
          origin: tip1,
          pattern: { type: 'burst', normal: hitDir1, spread: 0.8 },
          speed: 3.0,
          count: 15 + hit1.damage,
          sizeScale: 1.2,
        });
      }
      if (hit2.hit && char1) {
        f1Hp = Math.max(0, f1Hp - hit2.damage);
        addEvent(`Fighter2 hits Fighter1! (-${hit2.damage} HP)`);
        const tip2 = getWeaponTipWorld(char2);
        const hitDir2 = char1.root.position.subtract(char2.root.position).normalize();
        bloodFx.emit({
          origin: tip2,
          pattern: { type: 'burst', normal: hitDir2, spread: 0.8 },
          speed: 3.0,
          count: 15 + hit2.damage,
          sizeScale: 1.2,
        });
      }

      // 武器同士の衝突検知 → 火花 + 反動
      if (char1.weapon && char2.weapon) {
        const clashed = checkWeaponClash(char1, char2, clash1, clash2);
        if (clashed) {
          const tip1 = getWeaponTipWorld(char1);
          const tip2 = getWeaponTipWorld(char2);
          const midPoint = Vector3.Lerp(tip1, tip2, 0.5);
          sparkFx.emit({
            origin: midPoint,
            pattern: { type: 'burst', normal: Vector3.Up(), spread: 1.5 },
            speed: 5.0,
            count: 30,
            sizeScale: 1.0,
          });
          addEvent('Weapons clash!');
        }
      }

      // 武器衝突反動の更新
      if (ai1 && ai2) {
        updateClashReaction(char1, clash1, ai1, dt);
        updateClashReaction(char2, clash2, ai2, dt);
      }

      // パーティクル更新
      bloodFx.update(dt);
      sparkFx.update(dt);

      // バランスシステム更新 (重心監視 + よろめき + オフハンド自動補正)
      updateBalance(char1, ai1, dt);
      updateBalance(char2, ai2, dt);

      // キャラクター間の衝突回避 + フィールド境界
      resolveCharacterCollision(char1, char2);
      clampToFieldBounds(char1, 4.5);
      clampToFieldBounds(char2, 4.5);

      // IK・ステッピング更新
      updateHavokCharacter(scene, char1, dt);
      updateHavokCharacter(scene, char2, dt);

      // 勝敗判定
      if (f1Hp <= 0 || f2Hp <= 0) {
        matchEnded = true;
        ai1.enabled = false;
        ai2.enabled = false;
        const winner = f1Hp > 0 ? 'Fighter 1 (Blue)' : 'Fighter 2 (Red)';
        setMatchResult(`${winner} Wins!`);
        addEvent(`${winner} wins!`);
      }

      // HUD更新 (200msごと)
      hudTimer += dt;
      if (hudTimer > 0.2) {
        hudTimer = 0;
        setF1(prev => ({ hp: f1Hp, maxHp: 100, state: ai1!.state, weaponName: prev.weaponName, balance: char1!.balance.deviation, staggered: char1!.balance.staggered }));
        setF2(prev => ({ hp: f2Hp, maxHp: 100, state: ai2!.state, weaponName: prev.weaponName, balance: char2!.balance.deviation, staggered: char2!.balance.staggered }));
      }

      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);
    return () => { disposed = true; window.removeEventListener('resize', handleResize); engine.dispose(); };
  }, []);

  const hpBarStyle = (hp: number, max: number, color: string): React.CSSProperties => ({
    width: `${(hp / max) * 100}%`,
    height: 16,
    background: color,
    borderRadius: 3,
    transition: 'width 0.3s',
  });

  const stateColor = (s: string) => {
    if (s === 'attack') return '#f44';
    if (s === 'pursue') return '#ff0';
    if (s === 'recover') return '#f80';
    return '#0f0';
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#1a1a2e' }}>
      {/* HUD */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '8px 16px', background: 'rgba(0,0,0,0.85)', color: '#fff',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        {/* Fighter 1 */}
        <div style={{ flex: 1, marginRight: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', color: '#4477ff', marginBottom: 4 }}>
            Fighter 1 — {f1.weaponName}
            <span style={{ marginLeft: 8, fontSize: 11, color: stateColor(f1.state) }}>
              [{f1.state.toUpperCase()}]
            </span>
          </div>
          <div style={{ background: '#333', borderRadius: 4, height: 16 }}>
            <div style={hpBarStyle(f1.hp, f1.maxHp, '#4477ff')} />
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
            HP: {f1.hp}/{f1.maxHp}
            {f1.staggered && <span style={{ marginLeft: 8, color: '#f80', fontWeight: 'bold' }}>STAGGER!</span>}
          </div>
          {/* バランスバー */}
          <div style={{ background: '#222', borderRadius: 2, height: 4, marginTop: 2 }}>
            <div style={{ width: `${Math.min(100, f1.balance * 500)}%`, height: 4, background: f1.balance > 0.06 ? '#f80' : '#0a0', borderRadius: 2, transition: 'width 0.1s' }} />
          </div>
        </div>

        {/* VS */}
        <div style={{ fontSize: 18, fontWeight: 'bold', color: '#888', padding: '0 12px' }}>VS</div>

        {/* Fighter 2 */}
        <div style={{ flex: 1, marginLeft: 16, textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', color: '#ff4444', marginBottom: 4 }}>
            <span style={{ marginRight: 8, fontSize: 11, color: stateColor(f2.state) }}>
              [{f2.state.toUpperCase()}]
            </span>
            Fighter 2 — {f2.weaponName}
          </div>
          <div style={{ background: '#333', borderRadius: 4, height: 16 }}>
            <div style={{ ...hpBarStyle(f2.hp, f2.maxHp, '#ff4444'), marginLeft: 'auto' }} />
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
            HP: {f2.hp}/{f2.maxHp}
            {f2.staggered && <span style={{ marginLeft: 8, color: '#f80', fontWeight: 'bold' }}>STAGGER!</span>}
          </div>
          <div style={{ background: '#222', borderRadius: 2, height: 4, marginTop: 2 }}>
            <div style={{ width: `${Math.min(100, f2.balance * 500)}%`, height: 4, background: f2.balance > 0.06 ? '#f80' : '#0a0', borderRadius: 2, transition: 'width 0.1s', marginLeft: 'auto' }} />
          </div>
        </div>
      </div>

      {/* Match Result */}
      {matchResult && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 20, fontSize: 36, fontWeight: 'bold', color: '#fff',
          textShadow: '0 0 20px rgba(255,100,100,0.8)', textAlign: 'center',
        }}>
          {matchResult}
          <div style={{ fontSize: 14, color: '#aaa', marginTop: 12 }}>
            Reload to restart
          </div>
        </div>
      )}

      {/* Event Log */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        padding: '6px 16px', background: 'rgba(0,0,0,0.7)', color: '#ccc',
        fontSize: 11, maxHeight: 120, overflow: 'hidden',
      }}>
        {events.map((e, i) => (
          <div key={i} style={{ opacity: 1 - i * 0.12 }}>{e}</div>
        ))}
      </div>

      {/* Weapon Selection UI */}
      {!loading && !fightStarted && weaponList.length > 0 && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 25, background: 'rgba(0,0,0,0.92)', borderRadius: 12, padding: '24px 32px',
          color: '#fff', minWidth: 360, textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 16 }}>Select Weapons</div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: '#4477ff', fontWeight: 'bold', marginBottom: 6 }}>Fighter 1 (Blue)</div>
              <select
                value={weapon1Key}
                onChange={e => setWeapon1Key(e.target.value)}
                style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, background: '#222', color: '#fff', border: '1px solid #555', minWidth: 140 }}
              >
                {weaponList.map(w => (
                  <option key={w.pieceKey} value={w.pieceKey}>
                    {w.pieceKey.replace(/_/g, ' ')} ({w.category})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#ff4444', fontWeight: 'bold', marginBottom: 6 }}>Fighter 2 (Red)</div>
              <select
                value={weapon2Key}
                onChange={e => setWeapon2Key(e.target.value)}
                style={{ padding: '6px 12px', fontSize: 14, borderRadius: 4, background: '#222', color: '#fff', border: '1px solid #555', minWidth: 140 }}
              >
                {weaponList.map(w => (
                  <option key={w.pieceKey} value={w.pieceKey}>
                    {w.pieceKey.replace(/_/g, ' ')} ({w.category})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => startFightRef.current?.(weapon1Key, weapon2Key)}
            style={{
              padding: '10px 32px', fontSize: 16, fontWeight: 'bold',
              background: '#e44', color: '#fff', border: 'none', borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            FIGHT!
          </button>
        </div>
      )}

      {loading && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 30, color: '#fff', fontSize: 18,
        }}>Loading...</div>
      )}

      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
