/**
 * シーン初期化 + レンダーループ。
 * useEffect 内の巨大な async/renderLoop をこのファイルに切り出す。
 */
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, TransformNode,
} from '@babylonjs/core';
import type { HavokCharacter, CombatAI, TargetMover, SwingMotion, SwingType } from '@/lib/havok-character/types';
import {
  createHavokCharacter, updateHavokCharacter, getCharacterDirections,
} from '@/lib/havok-character/character';
import {
  createTarget, createSwingMotion, updateSwingMotion, applyBodyMotion,
  startSwing, updateWeaponInertia, createTargetMover, updateTargetMover,
} from '@/lib/havok-character/weapon';
import { getStanceTargets } from '@/lib/havok-character/weapon/stance';
import { createCombatAI, updateCombatAI } from '@/lib/havok-character/ai';
import { buildBoneHierarchy } from './bone-visualizer';
import { ensureBasePos, clearHipsBaseCache, SELECTABLE_BONES } from './constants';
import { computeJointAngles } from './joint-monitor';
import { updateMotionTest, isBackflipPlaying } from './motion-test';
import type { BoneDataFile } from './bone-visualizer';

export interface SceneCallbacks {
  setStatus: (s: string) => void;
  setJointAngles: (a: Record<string, number>) => void;
  setMotionTestPlaying: (v: boolean) => void;
  setTipSpeed: (v: number) => void;
  setSwingPower: (v: number) => void;
  setAiState: (s: string) => void;
  storeBaseValues: (boneName: string) => void;
}

export interface SceneRefs {
  characterRef: React.MutableRefObject<HavokCharacter | null>;
  boneVisRef: React.MutableRefObject<Map<string, TransformNode> | null>;
  visBasePositionsRef: React.MutableRefObject<Map<string, Vector3>>;
  sceneRef: React.MutableRefObject<Scene | null>;
}

export interface SceneControls {
  setHipsOffset: (v: number) => void;
  setSwingTarget: (x: number, y: number, z: number) => void;
  startAttack: (type: SwingType, power: number) => void;
  toggleAI: (enabled: boolean) => void;
}

/**
 * シーンを初期化し、レンダーループを開始する。
 * @returns cleanup 関数
 */
export function initScene(
  canvas: HTMLCanvasElement,
  refs: SceneRefs,
  cbs: SceneCallbacks,
): { cleanup: () => void; controls: SceneControls } {
  let disposed = false;
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  refs.sceneRef.current = scene;
  scene.clearColor = new Color4(0.12, 0.12, 0.18, 1);

  const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3.2, 4.5, new Vector3(0.5, 0.9, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 0.5;
  camera.upperRadiusLimit = 10;
  camera.wheelPrecision = 30;

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
  new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.8;

  const ground = MeshBuilder.CreateGround('ground', { width: 10, height: 10 }, scene);
  const gMat = new StandardMaterial('gMat', scene);
  gMat.diffuseColor = new Color3(0.3, 0.3, 0.25);
  ground.material = gMat;

  // Mutable state for render loop
  let _targetMover: TargetMover | null = null;
  let _combatAI: CombatAI | null = null;
  let _jointHudTimer = 0;
  let _motionTestWasPlaying = false;
  let _hipsOffset = 0;
  let _swingTarget = new Vector3(0, 0, 0);
  let _currentMotion: SwingMotion | null = null;

  const controls: SceneControls = {
    setHipsOffset: (v) => { _hipsOffset = v; },
    setSwingTarget: (x, y, z) => { _swingTarget = new Vector3(x, y, z); },
    startAttack: (type, power) => {
      const c = refs.characterRef.current;
      if (!c?.weapon) return;
      const dirs = getCharacterDirections(c);
      if (!dirs) return;
      const hitPos = c.root.position.add(dirs.forward.scale(1.5)).add(new Vector3(0, 1.1, 0));
      _currentMotion = createSwingMotion(c, { targetPos: hitPos, type, power });
      startSwing(c);
    },
    toggleAI: (enabled) => {
      const c = refs.characterRef.current;
      if (enabled && _targetMover && c?.weapon) {
        _combatAI = createCombatAI(_targetMover.node, c.weapon);
        _combatAI.enabled = true;
      } else if (_combatAI) {
        _combatAI.enabled = false;
        _combatAI.state = 'idle';
      }
    },
  };

  // Async init
  (async () => {
    try {
      cbs.setStatus('Initializing...');
      clearHipsBaseCache();
      if (disposed) return;

      const boneDataRes = await fetch('/api/game-assets/characters/mixamo-ybot/bone-data.json');
      const boneData: BoneDataFile = await boneDataRes.json();

      const visRoot = new TransformNode('visRoot', scene);
      visRoot.position.x = -1;
      const visBones = buildBoneHierarchy(scene, boneData, visRoot);
      refs.boneVisRef.current = visBones;

      const visBase = new Map<string, Vector3>();
      for (const [name, bone] of visBones) visBase.set(name, bone.position.clone());
      refs.visBasePositionsRef.current = visBase;

      const character = await createHavokCharacter(scene, {
        bodyColor: new Color3(0.2, 0.35, 0.8),
        prefix: 'test',
        position: new Vector3(1, 0, 0),
        enablePhysics: false,
        enableDebug: false,
      });
      refs.characterRef.current = character;
      if (disposed) return;

      const targetDirs = getCharacterDirections(character);
      if (targetDirs) {
        const charPos = character.root.position;
        const targetObj = createTarget(scene, charPos.add(targetDirs.forward.scale(1.5)), 'target');
        _targetMover = createTargetMover(targetObj.root, charPos, 3.0);
      }

      cbs.storeBaseValues(SELECTABLE_BONES[0]);
      cbs.setStatus('Left: bones | Right: voxel mesh — Select a bone and use sliders to test');
    } catch (e) {
      console.error('Init failed:', e);
      cbs.setStatus(`Error: ${e}`);
    }
  })();

  // Render loop
  let prevTime = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - prevTime) / 1000, 0.1);
    prevTime = now;

    const char = refs.characterRef.current;
    const vis = refs.boneVisRef.current;

    // Hips offset
    if (char) {
      const hips = char.allBones.get('mixamorig:Hips');
      if (hips) { const base = ensureBasePos(hips, 'char_hips_base'); hips.position.y = base.y + _hipsOffset; }
    }
    if (vis) {
      const hipsVis = vis.get('mixamorig:Hips');
      if (hipsVis) { const base = ensureBasePos(hipsVis, 'vis_hips_base'); hipsVis.position.y = base.y + _hipsOffset; }
    }

    // AI
    if (_targetMover) updateTargetMover(_targetMover, dt);
    if (_combatAI?.enabled && char) updateCombatAI(_combatAI, char, dt);

    // Motion test
    if (char) {
      const playing = updateMotionTest(char, dt);
      if (!playing && _motionTestWasPlaying) cbs.setMotionTestPlaying(false);
      _motionTestWasPlaying = playing;
    }

    // Swing / manual
    if (char?.weapon && (!_combatAI || !_combatAI.enabled)) {
      if (_currentMotion?.active) {
        const frame = updateSwingMotion(_currentMotion, dt, char.root.position);
        if (frame) {
          char.ikChains.leftArm.target.copyFrom(frame.handTarget);
          char.weaponSwing.smoothedTarget.copyFrom(frame.handTarget);
          const dirs = getCharacterDirections(char);
          if (dirs) applyBodyMotion(char, frame.body, dirs.forward, dirs.charRight);
        }
        if (!_currentMotion.active) {
          const spine = char.allBones.get('mixamorig:Spine1');
          if (spine) { const br = char.ikBaseRotations.get(spine.name); if (br) spine.rotationQuaternion = br.root.clone(); }
          _currentMotion = null;
        }
      } else {
        const stanceNow = getStanceTargets(char, char.weaponSwing.stance, char.weapon);
        char.weaponSwing.baseHandPos.copyFrom(stanceNow.rightTarget);
        updateWeaponInertia(char, stanceNow.rightTarget.add(_swingTarget), dt);
      }
    }

    // IK + HUD (バク転中はupdateHavokCharacterをスキップ — position.yやIKが上書きされるのを防ぐ)
    if (char && !isBackflipPlaying()) {
      updateHavokCharacter(scene, char, dt);
    }
    if (char) {
      if (char.weapon) cbs.setTipSpeed(char.weaponSwing.tipSpeed); cbs.setSwingPower(char.weaponSwing.power);
      if (_combatAI) cbs.setAiState(_combatAI.state);
      _jointHudTimer += dt;
      if (_jointHudTimer > 0.05) { _jointHudTimer = 0; cbs.setJointAngles(computeJointAngles(char)); }
    }

    scene.render();
  });

  const handleResize = () => engine.resize();
  window.addEventListener('resize', handleResize);

  const cleanup = () => {
    disposed = true;
    window.removeEventListener('resize', handleResize);
    engine.dispose();
  };

  return { cleanup, controls };
}
