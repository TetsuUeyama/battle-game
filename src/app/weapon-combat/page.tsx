'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh,
} from '@babylonjs/core';
import {
  CombatState, createCombatState, combatUpdate,
  lerpPose, applyPose, buildCombatFighter, loadWeaponMesh, loadEquipmentWeapon,
  getCombatStateLabel, ARMOR_PARTS, applyWeaponHit,
  createVoxelArmorSet, damageArmor, hasArmorAt, rebuildArmorMesh,
  type CombatGameState, type CombatFighterVisual, type PoseData,
  type ArmorPart, type FighterId, type VoxelArmorSet,
} from '@/lib/weapon-combat-engine';
import { ParticleFxSystem, PRESET_BLOOD } from '@/lib/particle-fx';
import {
  WEAPON_ADVENTURER_SWORD, WEAPON_AXE,
  getWeaponPose, fetchConfiguredWeapons, type WeaponDef,
} from '@/lib/weapon-registry';

const ARMOR_BONE_MAP: Record<ArmorPart, string> = {
  head: 'head', torso: 'torso',
  leftArm: 'leftArm', rightArm: 'rightArm',
  leftLeg: 'leftLeg', rightLeg: 'rightLeg',
};

const ARMOR_Y_OFFSET: Record<ArmorPart, number> = {
  head: 1.45, torso: 1.1, leftArm: 1.05, rightArm: 1.05,
  leftLeg: 0.5, rightLeg: 0.5,
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function WeaponCombatPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef<CombatGameState>(createCombatState());
  const resetFnRef = useRef<(() => void) | null>(null);

  const [f1Hp, setF1Hp] = useState(100);
  const [f2Hp, setF2Hp] = useState(100);
  const [f1Stamina, setF1Stamina] = useState(100);
  const [f2Stamina, setF2Stamina] = useState(100);
  const [f1State, setF1State] = useState('');
  const [f2State, setF2State] = useState('');
  const [f1WeaponName, setF1WeaponName] = useState('');
  const [f2WeaponName, setF2WeaponName] = useState('');
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const eventLogRef = useRef<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.12, 0.12, 0.18, 1);
    scene.skipPointerMovePicking = true;

    // camera from the side (X axis) so both fighters on Z axis are visible
    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3.2, 4.5, new Vector3(0, 0.6, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 2;
    camera.upperRadiusLimit = 10;
    camera.wheelPrecision = 35;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, 1), scene);
    dirLight.intensity = 0.8;

    // arena ground
    const ground = MeshBuilder.CreateGround('arena', { width: 8, height: 8 }, scene);
    const gMat = new StandardMaterial('arenaMat', scene);
    gMat.diffuseColor = new Color3(0.35, 0.3, 0.25);
    ground.material = gMat;

    // fighters
    const f1Visual = buildCombatFighter(scene, new Color3(0.2, 0.35, 0.8), 'f1');
    const f2Visual = buildCombatFighter(scene, new Color3(0.8, 0.2, 0.2), 'f2');
    // FX systems
    let bloodFx = new ParticleFxSystem(scene, PRESET_BLOOD, {
      maxParticles: 300, maxResidues: 1000, maxSticky: 500,
    });

    // voxel armor sets
    const f1ArmorData = createVoxelArmorSet();
    const f2ArmorData = createVoxelArmorSet();

    // build initial armor meshes and parent to bones
    function buildAndAttachArmor(armorSet: VoxelArmorSet, fighter: CombatFighterVisual, prefix: string, color: Color3) {
      for (const part of ARMOR_PARTS) {
        const piece = armorSet[part];
        const mesh = rebuildArmorMesh(scene, piece, part, color, prefix);
        const bone = fighter.bones.get(ARMOR_BONE_MAP[part]);
        if (bone) mesh.parent = bone;
      }
    }

    const f1ArmorColor = new Color3(0.7, 0.75, 0.85);  // silver/steel
    const f2ArmorColor = new Color3(0.85, 0.7, 0.3);   // gold/bronze
    buildAndAttachArmor(f1ArmorData, f1Visual, 'f1', f1ArmorColor);
    buildAndAttachArmor(f2ArmorData, f2Visual, 'f2', f2ArmorColor);

    // weapon definitions for each fighter (set dynamically)
    let f1Weapon: WeaponDef = WEAPON_ADVENTURER_SWORD;
    let f2Weapon: WeaponDef = WEAPON_AXE;
    // available weapons (populated by fetchConfiguredWeapons)
    let availableWeapons: WeaponDef[] = [WEAPON_ADVENTURER_SWORD, WEAPON_AXE];

    // register reset function accessible from outside useEffect
    resetFnRef.current = async () => {
      // pick new random weapons
      f1Weapon = pickRandom(availableWeapons);
      f2Weapon = pickRandom(availableWeapons);
      // ensure different weapons if possible
      if (availableWeapons.length > 1) {
        while (f2Weapon.id === f1Weapon.id) f2Weapon = pickRandom(availableWeapons);
      }
      setF1WeaponName(f1Weapon.nameJa);
      setF2WeaponName(f2Weapon.nameJa);

      // reset game state
      gsRef.current = createCombatState();
      eventLogRef.current = [];
      // reset blood particles
      bloodFx.dispose();
      bloodFx = new ParticleFxSystem(scene, PRESET_BLOOD, {
        maxParticles: 300, maxResidues: 1000, maxSticky: 500,
      });
      // rebuild armor from scratch
      const newF1 = createVoxelArmorSet();
      const newF2 = createVoxelArmorSet();
      for (const part of ARMOR_PARTS) {
        f1ArmorData[part].mesh?.dispose();
        f2ArmorData[part].mesh?.dispose();
        Object.assign(f1ArmorData[part], newF1[part]);
        Object.assign(f2ArmorData[part], newF2[part]);
        const m1 = rebuildArmorMesh(scene, f1ArmorData[part], part, f1ArmorColor, 'f1');
        const bone1 = f1Visual.bones.get(ARMOR_BONE_MAP[part]);
        if (bone1) m1.parent = bone1;
        const m2 = rebuildArmorMesh(scene, f2ArmorData[part], part, f2ArmorColor, 'f2');
        const bone2 = f2Visual.bones.get(ARMOR_BONE_MAP[part]);
        if (bone2) m2.parent = bone2;
      }
      // dispose old weapon meshes
      for (const m of f1Visual.weaponMeshes) m.dispose();
      for (const m of f2Visual.weaponMeshes) m.dispose();
      f1Visual.weaponMeshes.length = 0;
      f2Visual.weaponMeshes.length = 0;
      // load new weapons
      try {
        const [f1Reach, f2Reach] = await Promise.all([
          loadAndAttachWeapons(f1Weapon, f1Visual, 'f1'),
          loadAndAttachWeapons(f2Weapon, f2Visual, 'f2'),
        ]);
        const gs = gsRef.current;
        gs.fighters.fighter1.weaponReach = f1Reach;
        gs.fighters.fighter2.weaponReach = f2Reach;
        gs.fighters.fighter1.strikeRange = f1Reach * 0.85;
        gs.fighters.fighter2.strikeRange = f2Reach * 0.85;
        const lungeDist = 1.05;
        const f1AR = gs.fighters.fighter1.strikeRange + lungeDist;
        const f2AR = gs.fighters.fighter2.strikeRange + lungeDist;
        gs.fighters.fighter1.safeRange = Math.max(f2AR + 0.3, f1AR);
        gs.fighters.fighter2.safeRange = Math.max(f1AR + 0.3, f2AR);
      } catch (e) {
        console.error('Failed to reload weapons:', e);
      }
      // reset blend state
      f1PrevPose = getWeaponPose(f1Weapon, CombatState.IDLE);
      f2PrevPose = getWeaponPose(f2Weapon, CombatState.IDLE);
      f1CurPose = f1PrevPose;
      f2CurPose = f2PrevPose;
      f1PrevState = CombatState.IDLE;
      f2PrevState = CombatState.IDLE;
      f1BlendT = 1;
      f2BlendT = 1;

      // countdown before combat restarts
      combatStarted = false;
      setCountdown(3);
      await new Promise(r => setTimeout(r, 1000));
      setCountdown(2);
      await new Promise(r => setTimeout(r, 1000));
      setCountdown(1);
      await new Promise(r => setTimeout(r, 1000));
      setCountdown(null);
      combatStarted = true;
    };

    let combatStarted = false;

    // blend state
    const f1IdlePose = getWeaponPose(f1Weapon, CombatState.IDLE);
    const f2IdlePose = getWeaponPose(f2Weapon, CombatState.IDLE);
    let f1PrevPose: PoseData = f1IdlePose;
    let f2PrevPose: PoseData = f2IdlePose;
    let f1CurPose: PoseData = f1IdlePose;
    let f2CurPose: PoseData = f2IdlePose;
    let f1PrevState = CombatState.IDLE;
    let f2PrevState = CombatState.IDLE;
    let f1BlendT = 1;
    let f2BlendT = 1;

    // load weapons from registry
    let weaponsLoaded = false;
    /** Returns weapon reach in world units */
    async function loadAndAttachWeapons(weaponDef: WeaponDef, fighter: CombatFighterVisual, prefix: string): Promise<number> {
      const attachPoints = { right: fighter.weaponAttachR, left: fighter.weaponAttachL, both: fighter.weaponAttachR };
      let reach = weaponDef.defaultReach ?? 1.0;

      if (weaponDef.equipmentSource) {
        const { category, pieceKey } = weaponDef.equipmentSource;
        for (let i = 0; i < weaponDef.slots.length; i++) {
          const result = await loadEquipmentWeapon(scene, category, pieceKey, `${prefix}_wpn${i}`, weaponDef.meshScale);
          const slot = weaponDef.slots[i] ?? 'right';
          result.mesh.parent = attachPoints[slot];
          fighter.weaponMeshes.push(result.mesh);
          reach = Math.max(reach, result.reach);
        }
      } else {
        for (let i = 0; i < weaponDef.voxPaths.length; i++) {
          const mesh = await loadWeaponMesh(scene, weaponDef.voxPaths[i], `${prefix}_wpn${i}`, weaponDef.meshScale);
          const slot = weaponDef.slots[i] ?? 'right';
          mesh.parent = attachPoints[slot];
          mesh.position.set(...weaponDef.meshOffset);
          mesh.rotation.set(0, 0, 0);
          fighter.weaponMeshes.push(mesh);
        }
      }
      return reach;
    }
    (async () => {
      try {
        // fetch all configured weapons, then pick random
        availableWeapons = await fetchConfiguredWeapons();
        f1Weapon = pickRandom(availableWeapons);
        f2Weapon = pickRandom(availableWeapons);
        if (availableWeapons.length > 1) {
          while (f2Weapon.id === f1Weapon.id) f2Weapon = pickRandom(availableWeapons);
        }
        setF1WeaponName(f1Weapon.nameJa);
        setF2WeaponName(f2Weapon.nameJa);

        const [f1Reach, f2Reach] = await Promise.all([
          loadAndAttachWeapons(f1Weapon, f1Visual, 'f1'),
          loadAndAttachWeapons(f2Weapon, f2Visual, 'f2'),
        ]);

        const gs = gsRef.current;
        const f1 = gs.fighters.fighter1;
        const f2 = gs.fighters.fighter2;

        // set weapon reach
        f1.weaponReach = f1Reach;
        f2.weaponReach = f2Reach;

        // strikeRange: distance from opponent where own tip connects
        // (weapon reach + arm extension, roughly)
        f1.strikeRange = f1Reach * 0.85;
        f2.strikeRange = f2Reach * 0.85;

        // lunge distance during windup: LUNGE_SPEED * WINDUP_DURATION
        // LUNGE_SPEED=3.5, WINDUP_DURATION=0.3 → about 1.05m of dash-in
        const lungeDist = 1.05;

        // safeRange = strikeRange + lunge distance
        // "踏み込んで武器を振ったらtipが当たる位置" で構える
        // also must be outside opponent's (strikeRange + lunge) to not get hit
        const f1AttackRange = f1.strikeRange + lungeDist;  // total distance from which f1 can hit
        const f2AttackRange = f2.strikeRange + lungeDist;

        f1.safeRange = Math.max(f2AttackRange + 0.3, f1AttackRange);
        f2.safeRange = Math.max(f1AttackRange + 0.3, f2AttackRange);

        // initial positions
        const startDist = Math.max(f1.safeRange, f2.safeRange) * 0.55;
        f1.posZ = -startDist;
        f2.posZ = startDist;

        weaponsLoaded = true;
        setLoading(false);

        // countdown before combat starts
        setCountdown(3);
        await new Promise(r => setTimeout(r, 1000));
        setCountdown(2);
        await new Promise(r => setTimeout(r, 1000));
        setCountdown(1);
        await new Promise(r => setTimeout(r, 1000));
        setCountdown(null);
        combatStarted = true;
      } catch (e) {
        console.error('Failed to load weapons:', e);
        setLoading(false);
      }
    })();

    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      const gs = gsRef.current;

      if (combatStarted) combatUpdate(gs, dt);

      const f1 = gs.fighters.fighter1;
      const f2 = gs.fighters.fighter2;

      // detect state changes → reset blend
      if (f1.state !== f1PrevState) {
        f1PrevPose = f1CurPose;
        f1BlendT = 0;
        f1PrevState = f1.state;
      }
      if (f2.state !== f2PrevState) {
        f2PrevPose = f2CurPose;
        f2BlendT = 0;
        f2PrevState = f2.state;
      }

      const blendSpeed = 5; // fast transitions for combat
      f1BlendT = Math.min(1, f1BlendT + dt * blendSpeed);
      f2BlendT = Math.min(1, f2BlendT + dt * blendSpeed);

      f1CurPose = lerpPose(f1PrevPose, getWeaponPose(f1Weapon, f1.state, f1.attackHand, f1.currentAttack), f1BlendT);
      f2CurPose = lerpPose(f2PrevPose, getWeaponPose(f2Weapon, f2.state, f2.attackHand, f2.currentAttack), f2BlendT);

      // positions
      f1Visual.root.position.set(f1.posX, 0, f1.posZ);
      f2Visual.root.position.set(f2.posX, 0, f2.posZ);

      // face each other using atan2
      const f1ToF2Angle = Math.atan2(f2.posX - f1.posX, f2.posZ - f1.posZ);
      f1Visual.root.rotation.y = f1ToF2Angle;
      f2Visual.root.rotation.y = f1ToF2Angle + Math.PI;

      applyPose(f1Visual, f1CurPose);
      applyPose(f2Visual, f2CurPose);

      // spatial hit check: weapon AABB vs defender body part AABBs
      if (gs.pendingHitCheck) {
        const { attacker, defender } = gs.pendingHitCheck;
        const atkVisual = attacker === 'fighter1' ? f1Visual : f2Visual;
        const defVisual = attacker === 'fighter1' ? f2Visual : f1Visual;

        // force world matrix update for accurate AABBs
        scene.updateTransformMatrix(true);
        atkVisual.root.computeWorldMatrix(true);
        defVisual.root.computeWorldMatrix(true);

        // check each weapon mesh against each defender body part
        let hitPart: ArmorPart | null = null;
        outer:
        for (const weaponMesh of atkVisual.weaponMeshes) {
          if (!weaponMesh || weaponMesh.isDisposed()) continue;
          weaponMesh.computeWorldMatrix(true);
          weaponMesh.refreshBoundingInfo();

          for (const part of ARMOR_PARTS) {
            const bodyMesh = defVisual.bodyMeshes.get(ARMOR_BONE_MAP[part]);
            if (!bodyMesh) continue;
            bodyMesh.computeWorldMatrix(true);
            bodyMesh.refreshBoundingInfo();

            if (weaponMesh.intersectsMesh(bodyMesh, false)) {
              hitPart = part;
              break outer;
            }
          }
        }

        applyWeaponHit(gs, attacker, defender, hitPart);
        gs.pendingHitCheck = null;
      }

      // handle hit: carve armor voxels or spawn blood
      if (gs.lastHit) {
        const hit = gs.lastHit;
        const armorData = hit.target === 'fighter1' ? f1ArmorData : f2ArmorData;
        const hitData = gs.fighters[hit.target];
        const attackerId: FighterId = hit.target === 'fighter1' ? 'fighter2' : 'fighter1';
        const attackerData = gs.fighters[attackerId];
        const hitFighter = hit.target === 'fighter1' ? f1Visual : f2Visual;
        const armorColor = hit.target === 'fighter1' ? f1ArmorColor : f2ArmorColor;
        const prefix = hit.target === 'fighter1' ? 'f1' : 'f2';

        // screen shake
        hitFighter.root.position.x += (Math.random() - 0.5) * 0.03;

        const piece = armorData[hit.part];
        const hadArmor = hasArmorAt(piece, hit.hitLocalX, hit.hitLocalY, hit.hitLocalZ);

        if (hadArmor) {
          // carve voxels from armor
          damageArmor(piece, hit.hitLocalX, hit.hitLocalY, hit.hitLocalZ, hit.attackType);
          // rebuild mesh
          if (piece.dirty) {
            const mesh = rebuildArmorMesh(scene, piece, hit.part, armorColor, prefix);
            const bone = hitFighter.bones.get(ARMOR_BONE_MAP[hit.part]);
            if (bone) mesh.parent = bone;
          }
        } else {
          // flesh hit → blood + extra damage
          hitData.hp -= 12; // additional flesh damage (no armor)
          const hitPos = new Vector3(hitData.posX, ARMOR_Y_OFFSET[hit.part], hitData.posZ);
          const awayX = hitData.posX - attackerData.posX;
          const awayZ = hitData.posZ - attackerData.posZ;
          const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ) || 1;
          const impactDir = new Vector3(awayX / awayLen, 0.3, awayZ / awayLen);

          bloodFx.emit({
            origin: hitPos,
            pattern: { type: 'burst', normal: impactDir, spread: 1.2 },
            speed: 3.5,
            count: 50,
            sizeScale: 1.3,
          });

          if (hitData.hp <= 0) {
            hitData.hp = 0;
            const winner = attackerId === 'fighter1' ? `青（${f1Weapon.nameJa}）` : `赤（${f2Weapon.nameJa}）`;
            gs.matchResult = `${winner} の勝利！`;
            gs.fighters[attackerId].state = CombatState.ROUND_OVER_WIN;
            gs.fighters[hit.target].state = CombatState.ROUND_OVER_LOSE;
          }
        }
      }

      // update FX
      bloodFx.update(dt);

      // sync UI
      setF1Hp(f1.hp);
      setF2Hp(f2.hp);
      setF1Stamina(f1.stamina);
      setF2Stamina(f2.stamina);
      setF1State(getCombatStateLabel(f1));
      setF2State(getCombatStateLabel(f2));
      setMatchResult(gs.matchResult);

      if (gs.events.length > 0) {
        eventLogRef.current = [...gs.events, ...eventLogRef.current].slice(0, 10);
        setEvents([...eventLogRef.current]);
      }

      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      bloodFx.dispose();
      engine.dispose();
    };
  }, []);

  const resetMatch = useCallback(() => {
    if (resetFnRef.current) resetFnRef.current();
    setEvents([]);
    setMatchResult(null);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: '#1a1a2e' }}>
      {/* Header with HP bars */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '10px 20px', background: 'rgba(0,0,0,0.8)', color: '#fff',
      }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          {/* Fighter 1 */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: '#6699ff', fontWeight: 'bold' }}>青 ({f1WeaponName})</span>
              <span>{f1State}</span>
            </div>
            <HpBar hp={f1Hp} max={100} color="#4488ff" />
            <StaminaBar stamina={f1Stamina} />
          </div>

          <div style={{ fontSize: 20, fontWeight: 'bold', padding: '0 12px' }}>VS</div>

          {/* Fighter 2 */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: '#ff6666', fontWeight: 'bold' }}>赤 ({f2WeaponName})</span>
              <span>{f2State}</span>
            </div>
            <HpBar hp={f2Hp} max={100} color="#ff4444" />
            <StaminaBar stamina={f2Stamina} />
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 20,
        }}>
          武器モデルを読み込み中...
        </div>
      )}

      {/* Countdown overlay */}
      {countdown !== null && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 25,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 72, fontWeight: 'bold', color: '#ffcc00', textShadow: '0 0 20px rgba(255,200,0,0.5)' }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Event log */}
      <div style={{
        position: 'absolute', left: 16, top: 95, zIndex: 10, color: '#fff', fontSize: 13,
      }}>
        {events.map((e, i) => (
          <div key={i} style={{ opacity: 1 - i * 0.1, marginBottom: 2 }}>{e}</div>
        ))}
      </div>

      {/* Match result overlay */}
      {matchResult && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: '#ffcc00' }}>{matchResult}</div>
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
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '6px 18px', borderRadius: 8,
          color: '#aaa', fontSize: 14,
        }}>
          CPU vs CPU 観戦モード | 右ドラッグ: カメラ回転 | スクロール: ズーム
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

function HpBar({ hp, max, color }: { hp: number; max: number; color: string }) {
  const pct = Math.max(0, (hp / max) * 100);
  return (
    <div style={{ width: '100%', height: 14, background: '#333', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%', background: color,
        borderRadius: 4, transition: 'width 0.15s',
      }} />
    </div>
  );
}

function StaminaBar({ stamina }: { stamina: number }) {
  return (
    <div style={{ width: '100%', height: 5, background: '#222', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
      <div style={{
        width: `${Math.max(0, stamina)}%`, height: '100%', background: '#88cc44',
        borderRadius: 2, transition: 'width 0.2s',
      }} />
    </div>
  );
}
