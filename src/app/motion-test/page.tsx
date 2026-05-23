'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AbstractMesh,
  AnimationGroup,
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

type FighterId = 'crimson' | 'azure';
type FighterMode = 'idle' | 'advance' | 'retreat' | 'strafe' | 'run' | 'jump' | 'attack' | 'guard' | 'stunned' | 'ko';
type AttackKind = 'jab' | 'kick' | 'heavy' | 'burst';
type AnimName = 'Wave' | 'Walk' | 'Punch' | 'Squat' | 'Twist' | 'StarJump';

interface FighterRuntime {
  id: FighterId;
  name: string;
  /** ラッパー TransformNode。position / rotation.y を直接書ける。__root__ は子になる */
  root: TransformNode;
  meshes: AbstractMesh[];
  animations: Map<string, AnimationGroup>;
  activeAnimName: string | null;
  hp: number;
  stamina: number;
  wins: number;
  mode: FighterMode;
  prevMode: FighterMode;
  attack: AttackKind | null;
  attackTimer: number;
  attackLanded: boolean;
  cooldown: number;
  guardTimer: number;
  stunTimer: number;
  decisionTimer: number;
  strafeSign: number;
  speed: number;
  /** jump 残り時間 (秒)。0 になったら idle に戻る。StarJump アニメ自体が hip Y モーション
   *  を含んでいるので Y 位置の物理計算は不要。タイマーだけで mode を管理する */
  jumpTimer: number;
  /** jump 連発防止クールダウン秒 */
  jumpCooldown: number;
  color: Color3;
}

interface HudState {
  crimsonHp: number;
  azureHp: number;
  crimsonStamina: number;
  azureStamina: number;
  crimsonWins: number;
  azureWins: number;
  round: number;
  roundTime: number;
  feed: string;
  status: string;
  matchOver: boolean;
  matchWinner: string | null;
  loading: boolean;
}

const ATTACKS: Record<AttackKind, {
  duration: number;
  hitAt: number;
  reach: number;
  damage: number;
  stamina: number;
  stun: number;
  knockback: number;
}> = {
  jab: { duration: 0.42, hitAt: 0.18, reach: 1.25, damage: 7, stamina: 10, stun: 0.14, knockback: 0.16 },
  kick: { duration: 0.62, hitAt: 0.30, reach: 1.55, damage: 11, stamina: 18, stun: 0.20, knockback: 0.25 },
  heavy: { duration: 0.86, hitAt: 0.46, reach: 1.42, damage: 17, stamina: 30, stun: 0.34, knockback: 0.36 },
  burst: { duration: 1.15, hitAt: 0.58, reach: 1.95, damage: 24, stamina: 48, stun: 0.46, knockback: 0.58 },
};

const ROUND_DURATION = 60;
const WINS_TO_WIN_MATCH = 2;
const FIGHTER_GLB: Record<FighterId, string> = {
  crimson: '/motion-test/crimson.glb',
  azure: '/motion-test/azure.glb',
};

/** 通常歩行速度 (m/s)。run はこれの RUN_SPEED_MULT 倍 */
const WALK_SPEED = 1.65;
const RUN_SPEED_MULT = 2.0;
/** 距離がこの値より大きいと CPU は run を選ぶ */
const RUN_DISTANCE_THRESHOLD = 3.0;
/** StarJump アニメ 1 サイクルのおおよその長さ (秒)。jump 中はこの時間 mode が継続する */
const JUMP_DURATION = 0.95;
/** jump 連発防止クールダウン */
const JUMP_COOLDOWN = 2.5;

/**
 * GLB の "正面" 方向が glTF 標準 (+Z forward) と一致しないモデルへの補正角 (radians)。
 *
 * - `0`            : char default forward = +Z (Babylon 8 の現行 glTF ローダー想定)
 * - `Math.PI`      : char default forward = -Z (旧式 __root__ scale.z=-1 想定)
 * - `Math.PI / 2`  : char default forward = -X
 * - `-Math.PI / 2` : char default forward = +X
 *
 * キャラが対戦相手ではなく横/逆方向を向く場合、ここを切り替えて再確認する。
 */
const FRONT_ANGLE_OFFSET = 0;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function makeMaterial(scene: Scene, name: string, color: Color3, emissive = 0) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.25, 0.25, 0.25);
  mat.emissiveColor = color.scale(emissive);
  return mat;
}

async function loadFighter(
  scene: Scene, id: FighterId, name: string, color: Color3, startX: number,
): Promise<FighterRuntime> {
  const url = FIGHTER_GLB[id];
  const result = await SceneLoader.ImportMeshAsync('', '', url, scene);

  // Babylon glTF ローダーは __root__ に rotationQuaternion を設定して LH/RH 変換する
  // ため、__root__.rotation.y を書いても無視される (Quat が Euler を上書き)。
  // 一段上にラッパー TransformNode を被せ、ラッパー側で rotation.y を制御する。
  const glbRoot = result.meshes.find(m => m.name === '__root__') ?? result.meshes[0];
  if (!glbRoot) throw new Error(`GLB ${url} has no root node`);

  const root = new TransformNode(`${id}Wrapper`, scene);
  root.position = new Vector3(startX, 0, 0);
  glbRoot.parent = root;

  // 初回ロード時に __root__ のロード後の transform を 1 度だけ log
  // (FRONT_ANGLE_OFFSET の値を決めるための診断情報)
  if (id === 'crimson') {
    const q = glbRoot.rotationQuaternion;
    const f = (n: number) => n.toFixed(3);
    console.log(`[motion-test] ${id} __root__ after load:`);
    console.log(`  position = (${f(glbRoot.position.x)}, ${f(glbRoot.position.y)}, ${f(glbRoot.position.z)})`);
    console.log(`  rotation = (${f(glbRoot.rotation.x)}, ${f(glbRoot.rotation.y)}, ${f(glbRoot.rotation.z)})`);
    console.log(`  rotationQuaternion = ${q ? `(${f(q.x)}, ${f(q.y)}, ${f(q.z)}, w=${f(q.w)})` : 'null'}`);
    console.log(`  scaling = (${f(glbRoot.scaling.x)}, ${f(glbRoot.scaling.y)}, ${f(glbRoot.scaling.z)})`);
    console.log(`  scene useRightHandedSystem = ${scene.useRightHandedSystem}`);
  }

  const animations = new Map<string, AnimationGroup>();
  for (const g of result.animationGroups) {
    g.stop();
    g.reset();
    animations.set(g.name, g);
  }

  return {
    id,
    name,
    root,
    meshes: result.meshes.slice(),
    animations,
    activeAnimName: null,
    hp: 100,
    stamina: 100,
    wins: 0,
    mode: 'idle',
    prevMode: 'idle',
    attack: null,
    attackTimer: 0,
    attackLanded: false,
    cooldown: 0.4,
    guardTimer: 0,
    stunTimer: 0,
    decisionTimer: 0,
    strafeSign: id === 'crimson' ? 1 : -1,
    speed: WALK_SPEED,
    jumpTimer: 0,
    jumpCooldown: 0,
    color,
  };
}

function playAnim(fighter: FighterRuntime, name: AnimName, loop: boolean, speedRatio = 1) {
  if (fighter.activeAnimName === name) {
    const cur = fighter.animations.get(name);
    if (cur) cur.speedRatio = speedRatio;
    return;
  }
  if (fighter.activeAnimName) {
    const prev = fighter.animations.get(fighter.activeAnimName);
    if (prev) prev.stop();
  }
  const next = fighter.animations.get(name);
  if (!next) return;
  next.speedRatio = speedRatio;
  next.start(loop);
  fighter.activeAnimName = name;
}

function stopAnim(fighter: FighterRuntime) {
  if (!fighter.activeAnimName) return;
  const cur = fighter.animations.get(fighter.activeAnimName);
  if (cur) cur.stop();
  fighter.activeAnimName = null;
}

function syncFighterAnim(fighter: FighterRuntime) {
  if (fighter.mode === 'ko') {
    stopAnim(fighter);
    return;
  }
  if (fighter.mode === 'stunned') {
    playAnim(fighter, 'Twist', false, 1.6);
    return;
  }
  if (fighter.mode === 'guard') {
    playAnim(fighter, 'Squat', true, 0.7);
    return;
  }
  if (fighter.mode === 'jump') {
    playAnim(fighter, 'StarJump', false, 1.4);
    return;
  }
  if (fighter.mode === 'attack' && fighter.attack) {
    const spec = ATTACKS[fighter.attack];
    const ratio = clamp(0.85 / spec.duration, 0.5, 2.6);
    playAnim(fighter, 'Punch', false, ratio);
    return;
  }
  if (fighter.mode === 'run') {
    playAnim(fighter, 'Walk', true, 2.2);
    return;
  }
  if (fighter.mode === 'advance' || fighter.mode === 'strafe') {
    playAnim(fighter, 'Walk', true, 1.2);
    return;
  }
  if (fighter.mode === 'retreat') {
    playAnim(fighter, 'Walk', true, -1.2);
    return;
  }
  playAnim(fighter, 'Wave', true, 0.55);
}

function faceTarget(fighter: FighterRuntime, target: FighterRuntime) {
  const diff = target.root.position.subtract(fighter.root.position);
  // default forward = +Z 前提で atan2(diff.x, diff.z)。default が異なるモデルは
  // FRONT_ANGLE_OFFSET を加算して補正する。
  fighter.root.rotation.y = Math.atan2(diff.x, diff.z) + FRONT_ANGLE_OFFSET;
}

function forwardOf(fighter: FighterRuntime) {
  // faceTarget が加算した FRONT_ANGLE_OFFSET 分を差し引いて、forward 方向を
  // ワールド座標で計算する。+Z 前提で (sin, 0, cos)。
  const y = fighter.root.rotation.y - FRONT_ANGLE_OFFSET;
  return new Vector3(Math.sin(y), 0, Math.cos(y));
}

function spawnHitSpark(scene: Scene, position: Vector3, color: Color3, power: number) {
  const mat = makeMaterial(scene, `sparkMat${Math.random()}`, color, 0.85);
  const spark = MeshBuilder.CreateSphere(`spark${Math.random()}`, { diameter: 0.18 + power * 0.02, segments: 10 }, scene);
  spark.position.copyFrom(position);
  spark.material = mat;

  let life = 0.28;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() / 1000;
    life -= dt;
    spark.scaling.addInPlace(new Vector3(dt * 3.8, dt * 3.8, dt * 3.8));
    mat.alpha = clamp(life / 0.28, 0, 1);
    if (life <= 0) {
      scene.onBeforeRenderObservable.remove(observer);
      spark.dispose();
      mat.dispose();
    }
  });
}

function chooseAttack(fighter: FighterRuntime, distance: number): AttackKind {
  if (fighter.stamina > 58 && distance < 1.85 && Math.random() < 0.18) return 'burst';
  if (fighter.stamina > 38 && distance < 1.55 && Math.random() < 0.32) return 'heavy';
  if (fighter.stamina > 24 && distance < 1.65 && Math.random() < 0.46) return 'kick';
  return 'jab';
}

function decideCpu(fighter: FighterRuntime, target: FighterRuntime, distance: number) {
  fighter.decisionTimer = 0.16 + Math.random() * 0.24;
  if (fighter.hp <= 0) {
    fighter.mode = 'ko';
    return;
  }
  // jump 中 / attack 中 / stunned 中はキャンセル不可
  if (fighter.cooldown > 0 || fighter.mode === 'attack' || fighter.mode === 'stunned' || fighter.mode === 'jump') return;

  const lowStamina = fighter.stamina < 24;
  const enemyAttacking = target.mode === 'attack' && target.attackTimer > 0.08;

  if ((enemyAttacking && distance < 1.75 && Math.random() < 0.62) || lowStamina) {
    fighter.mode = 'guard';
    fighter.guardTimer = lowStamina ? 0.65 : 0.38;
    return;
  }

  // 中距離以下ではアジャイル回避としてジャンプ (低頻度)
  if (fighter.jumpCooldown <= 0 && fighter.stamina > 40
      && distance < 2.5 && Math.random() < 0.10) {
    fighter.mode = 'jump';
    fighter.jumpTimer = JUMP_DURATION;
    fighter.jumpCooldown = JUMP_COOLDOWN;
    fighter.stamina = clamp(fighter.stamina - 14, 0, 100);
    return;
  }

  // 遠距離 → 走って接近、近距離 → 歩いて接近
  if (distance > RUN_DISTANCE_THRESHOLD && fighter.stamina > 28) {
    fighter.mode = 'run';
    return;
  }
  if (distance > 1.85) {
    fighter.mode = 'advance';
    return;
  }

  if (distance < 0.88 && Math.random() < 0.55) {
    fighter.mode = 'retreat';
    return;
  }

  if (Math.random() < 0.24) {
    fighter.mode = 'strafe';
    fighter.strafeSign *= Math.random() < 0.5 ? 1 : -1;
    return;
  }

  fighter.attack = chooseAttack(fighter, distance);
  fighter.attackTimer = 0;
  fighter.attackLanded = false;
  fighter.mode = 'attack';
  fighter.stamina = clamp(fighter.stamina - ATTACKS[fighter.attack].stamina, 0, 100);
}

function resetFighterState(fighter: FighterRuntime) {
  fighter.hp = 100;
  fighter.stamina = 100;
  fighter.mode = 'idle';
  fighter.prevMode = 'idle';
  fighter.attack = null;
  fighter.attackTimer = 0;
  fighter.attackLanded = false;
  fighter.cooldown = 0.7;
  fighter.guardTimer = 0;
  fighter.stunTimer = 0;
  fighter.jumpTimer = 0;
  fighter.jumpCooldown = 0;
  fighter.decisionTimer = 0;
  stopAnim(fighter);
}

export default function MotionTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restartRef = useRef<(() => void) | null>(null);
  const [hud, setHud] = useState<HudState>({
    crimsonHp: 100,
    azureHp: 100,
    crimsonStamina: 100,
    azureStamina: 100,
    crimsonWins: 0,
    azureWins: 0,
    round: 1,
    roundTime: ROUND_DURATION,
    feed: 'Loading arena & motions...',
    status: 'CPU vs CPU',
    matchOver: false,
    matchWinner: null,
    loading: true,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted = true;
    const safeSetHud = (updater: (h: HudState) => HudState) => {
      if (mounted) setHud(updater);
    };

    const engine = new Engine(canvas, true, { antialias: true, preserveDrawingBuffer: true });
    const scene = new Scene(engine);
    // 参照実装 (contactform/skinned-voxel-demo, cloth-test) は Babylon デフォルトの
    // LH scene で qm 系 GLB を再生している。LH では glTF ローダーが __root__ に
    // scaling.z=-1 を入れ、AnimationGroup の bone quaternion はそれを前提に補正済み。
    // ここで RH に切り替えると補正前提が崩れ、ラッパー TransformNode を被せると
    // rot Y と Z-flip が非可換になって関節の左右が反転する。LH のまま動かす。
    scene.clearColor = new Color4(0.035, 0.045, 0.07, 1);

    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.85, 6.8, new Vector3(0, 1.1, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 4.2;
    camera.upperRadiusLimit = 9.5;
    camera.wheelPrecision = 40;

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.58;
    const keyLight = new DirectionalLight('key', new Vector3(-0.4, -1.2, 0.7), scene);
    keyLight.intensity = 1.35;
    const glow = new GlowLayer('glow', scene);
    glow.intensity = 0.42;

    const ground = MeshBuilder.CreateGround('ring', { width: 8.4, height: 5.2 }, scene);
    const groundMat = makeMaterial(scene, 'ringMat', new Color3(0.12, 0.13, 0.14), 0.02);
    ground.material = groundMat;

    const lineMat = makeMaterial(scene, 'lineMat', new Color3(0.95, 0.78, 0.28), 0.25);
    const centerLine = MeshBuilder.CreateBox('centerLine', { width: 0.035, height: 0.012, depth: 5.2 }, scene);
    centerLine.position.y = 0.012;
    centerLine.material = lineMat;

    const backWallMat = makeMaterial(scene, 'backWallMat', new Color3(0.075, 0.08, 0.1), 0.04);
    const backWall = MeshBuilder.CreateBox('backWall', { width: 8.4, height: 1.6, depth: 0.08 }, scene);
    backWall.position.set(0, 0.78, 2.64);
    backWall.material = backWallMat;

    engine.runRenderLoop(() => scene.render());

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);

    let renderObserver: ReturnType<typeof scene.onBeforeRenderObservable.add> | null = null;
    let crimson: FighterRuntime | null = null;
    let azure: FighterRuntime | null = null;

    (async () => {
      try {
        const [c, a] = await Promise.all([
          loadFighter(scene, 'crimson', 'Crimson CPU', new Color3(1, 0.18, 0.16), -1.8),
          loadFighter(scene, 'azure', 'Azure CPU', new Color3(0.1, 0.55, 1), 1.8),
        ]);
        if (!mounted) {
          c.root.dispose();
          a.root.dispose();
          return;
        }
        crimson = c;
        azure = a;

        let round = 1;
        let roundPause = 0;
        let hudTimer = 0;
        let feed = 'CPU fighters are reading the distance.';
        let roundTime = ROUND_DURATION;
        let matchOver = false;
        let matchWinner: FighterRuntime | null = null;

        const startRound = (r: number) => {
          if (!crimson || !azure) return;
          resetFighterState(crimson);
          resetFighterState(azure);
          crimson.root.position.set(-1.8, 0, 0);
          azure.root.position.set(1.8, 0, 0);
          roundTime = ROUND_DURATION;
          safeSetHud(h => ({
            ...h,
            round: r,
            roundTime: ROUND_DURATION,
            crimsonHp: 100,
            azureHp: 100,
            crimsonStamina: 100,
            azureStamina: 100,
            status: `Round ${r}`,
            feed: 'CPU fighters are reading the distance.',
            loading: false,
          }));
        };

        const finishRound = (winner: FighterRuntime | null) => {
          if (!crimson || !azure) return;
          if (winner) {
            winner.wins += 1;
            feed = `${winner.name} wins Round ${round}.`;
          } else {
            feed = `Round ${round} ends in a draw.`;
          }
          roundPause = 2.4;
          safeSetHud(h => ({
            ...h,
            crimsonHp: crimson!.hp,
            azureHp: azure!.hp,
            crimsonStamina: crimson!.stamina,
            azureStamina: azure!.stamina,
            crimsonWins: crimson!.wins,
            azureWins: azure!.wins,
            feed,
            status: winner ? `${winner.name} wins` : 'Draw',
          }));
        };

        restartRef.current = () => {
          if (!crimson || !azure) return;
          crimson.wins = 0;
          azure.wins = 0;
          round = 1;
          roundPause = 0;
          matchOver = false;
          matchWinner = null;
          safeSetHud(h => ({
            ...h,
            crimsonWins: 0,
            azureWins: 0,
            matchOver: false,
            matchWinner: null,
          }));
          startRound(1);
        };

        startRound(round);

        renderObserver = scene.onBeforeRenderObservable.add(() => {
          if (!crimson || !azure) return;
          const dt = Math.min(engine.getDeltaTime() / 1000, 0.033);

          if (matchOver) {
            syncFighterAnim(crimson);
            syncFighterAnim(azure);
            return;
          }

          if (roundPause > 0) {
            syncFighterAnim(crimson);
            syncFighterAnim(azure);
            roundPause -= dt;
            if (roundPause <= 0) {
              if (crimson.wins >= WINS_TO_WIN_MATCH || azure.wins >= WINS_TO_WIN_MATCH) {
                matchOver = true;
                matchWinner = crimson.wins >= WINS_TO_WIN_MATCH ? crimson : azure;
                safeSetHud(h => ({
                  ...h,
                  matchOver: true,
                  matchWinner: matchWinner!.name,
                  feed: `${matchWinner!.name} wins the match!`,
                  status: 'MATCH OVER',
                }));
              } else {
                round += 1;
                startRound(round);
              }
            }
            return;
          }

          roundTime = Math.max(0, roundTime - dt);
          if (roundTime <= 0) {
            const winner = crimson.hp > azure.hp ? crimson : (azure.hp > crimson.hp ? azure : null);
            finishRound(winner);
            return;
          }

          const fighters: [FighterRuntime, FighterRuntime][] = [[crimson, azure], [azure, crimson]];

          for (const [fighter, target] of fighters) {
            faceTarget(fighter, target);
            fighter.cooldown = Math.max(0, fighter.cooldown - dt);
            fighter.decisionTimer -= dt;
            fighter.jumpCooldown = Math.max(0, fighter.jumpCooldown - dt);
            // run はスタミナ消費。それ以外は回復 (guard は速め)
            const staminaDelta = fighter.mode === 'run' ? -16
              : fighter.mode === 'guard' ? 22 : 13;
            fighter.stamina = clamp(fighter.stamina + dt * staminaDelta, 0, 100);

            if (fighter.mode === 'stunned') {
              fighter.stunTimer -= dt;
              fighter.root.position.addInPlace(forwardOf(target).scale(dt * 0.55));
              if (fighter.stunTimer <= 0) fighter.mode = 'idle';
            }

            if (fighter.mode === 'guard') {
              fighter.guardTimer -= dt;
              if (fighter.guardTimer <= 0) fighter.mode = 'idle';
            }

            // jump 中: StarJump アニメの hip Y モーションが既に上下動を含むため
            // 手動 Y 物理は加えない。タイマー経過まで mode を保持し、終了で idle へ
            if (fighter.mode === 'jump') {
              fighter.jumpTimer -= dt;
              fighter.root.position.addInPlace(forwardOf(fighter).scale(fighter.speed * 0.55 * dt));
              if (fighter.jumpTimer <= 0) fighter.mode = 'idle';
            }

            const distance = Vector3.Distance(fighter.root.position, target.root.position);
            if (fighter.decisionTimer <= 0) decideCpu(fighter, target, distance);

            const forward = forwardOf(fighter);
            const right = new Vector3(forward.z, 0, -forward.x);
            if (fighter.mode === 'advance') fighter.root.position.addInPlace(forward.scale(fighter.speed * dt));
            if (fighter.mode === 'run') fighter.root.position.addInPlace(forward.scale(fighter.speed * RUN_SPEED_MULT * dt));
            if (fighter.mode === 'retreat') fighter.root.position.addInPlace(forward.scale(-fighter.speed * 1.25 * dt));
            if (fighter.mode === 'strafe') fighter.root.position.addInPlace(right.scale(fighter.strafeSign * fighter.speed * 0.78 * dt));

            fighter.root.position.x = clamp(fighter.root.position.x, -3.7, 3.7);
            fighter.root.position.z = clamp(fighter.root.position.z, -2.05, 2.05);
          }

          for (const [attacker, defender] of fighters) {
            if (attacker.mode !== 'attack' || !attacker.attack) continue;

            const spec = ATTACKS[attacker.attack];
            attacker.attackTimer += dt;
            const hitMoment = attacker.attackTimer >= spec.hitAt && attacker.attackTimer - dt < spec.hitAt;

            if (hitMoment && !attacker.attackLanded) {
              const distance = Vector3.Distance(attacker.root.position, defender.root.position);
              const toward = defender.root.position.subtract(attacker.root.position).normalize();
              const facing = Vector3.Dot(forwardOf(attacker), toward);
              if (distance <= spec.reach && facing > 0.45 && defender.mode !== 'ko') {
                const guarded = defender.mode === 'guard' && defender.stamina > 6;
                const damage = guarded ? Math.ceil(spec.damage * 0.32) : spec.damage;
                defender.hp = clamp(defender.hp - damage, 0, 100);
                defender.stamina = clamp(defender.stamina - (guarded ? 8 : 16), 0, 100);
                defender.stunTimer = guarded ? 0.05 : spec.stun;
                defender.mode = defender.hp <= 0 ? 'ko' : (guarded ? 'guard' : 'stunned');
                defender.root.position.addInPlace(forwardOf(attacker).scale(spec.knockback));
                attacker.attackLanded = true;
                feed = guarded
                  ? `${defender.name} blocked ${attacker.name}'s ${attacker.attack}.`
                  : `${attacker.name} landed ${attacker.attack} for ${damage}.`;
                const sparkPos = defender.root.position.add(new Vector3(0, 1.35, 0)).subtract(forwardOf(attacker).scale(0.2));
                spawnHitSpark(scene, sparkPos, attacker.color, spec.damage);
              }
            }

            if (attacker.attackTimer >= spec.duration) {
              attacker.mode = 'idle';
              attacker.attack = null;
              attacker.cooldown = 0.16 + Math.random() * 0.22;
            }
          }

          if (crimson.hp <= 0 || azure.hp <= 0) {
            const winner = crimson.hp > azure.hp ? crimson : azure;
            finishRound(winner);
          }

          syncFighterAnim(crimson);
          syncFighterAnim(azure);
          crimson.prevMode = crimson.mode;
          azure.prevMode = azure.mode;

          const midpoint = crimson.root.position.add(azure.root.position).scale(0.5);
          camera.target = Vector3.Lerp(camera.target, midpoint.add(new Vector3(0, 1.15, 0)), 0.08);

          hudTimer -= dt;
          if (hudTimer <= 0) {
            hudTimer = 0.1;
            safeSetHud(h => ({
              ...h,
              crimsonHp: crimson!.hp,
              azureHp: azure!.hp,
              crimsonStamina: crimson!.stamina,
              azureStamina: azure!.stamina,
              crimsonWins: crimson!.wins,
              azureWins: azure!.wins,
              roundTime,
              feed,
              status: `${crimson!.mode.toUpperCase()} / ${azure!.mode.toUpperCase()}`,
            }));
          }
        });
      } catch (err) {
        if (mounted) {
          safeSetHud(h => ({ ...h, feed: `Failed to load fighters: ${err instanceof Error ? err.message : String(err)}`, loading: false }));
        }
      }
    })();

    return () => {
      mounted = false;
      window.removeEventListener('resize', handleResize);
      if (renderObserver) scene.onBeforeRenderObservable.remove(renderObserver);
      restartRef.current = null;
      glow.dispose();
      engine.dispose();
    };
  }, []);

  const handleRestart = useCallback(() => {
    restartRef.current?.();
  }, []);

  const bar = (value: number, color: string) => (
    <div style={{ height: 10, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.16)' }}>
      <div style={{ width: `${clamp(value, 0, 100)}%`, height: '100%', background: color, transition: 'width 120ms linear' }} />
    </div>
  );

  const winPip = (active: boolean, color: string) => (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: active ? color : 'rgba(255,255,255,0.18)', marginRight: 4,
      boxShadow: active ? `0 0 6px ${color}` : 'none',
    }} />
  );

  const timeLabel = `${Math.ceil(hud.roundTime).toString().padStart(2, '0')}`;
  const timerColor = hud.roundTime <= 10 ? '#ff5d5d' : '#e7edf8';

  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', background: '#090b11', color: '#f4f7fb', fontFamily: 'Arial, sans-serif' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} />

      <section style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'start', pointerEvents: 'none' }}>
        <div style={{ background: 'rgba(8,12,18,0.72)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontWeight: 700 }}>
            <span>Crimson CPU</span><span>{Math.ceil(hud.crimsonHp)} HP</span>
          </div>
          {bar(hud.crimsonHp, '#ff3434')}
          <div style={{ marginTop: 8 }}>{bar(hud.crimsonStamina, '#ffd45a')}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#bac4d6', display: 'flex', alignItems: 'center' }}>
            {[...Array(WINS_TO_WIN_MATCH)].map((_, i) => (
              <span key={i}>{winPip(i < hud.crimsonWins, '#ff3434')}</span>
            ))}
            <span style={{ marginLeft: 4 }}>Wins {hud.crimsonWins}</span>
          </div>
        </div>

        <div style={{ minWidth: 180, textAlign: 'center', background: 'rgba(8,12,18,0.82)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '12px 18px' }}>
          <div style={{ fontSize: 13, color: '#aeb8c8' }}>CPU vs CPU · Best of {WINS_TO_WIN_MATCH * 2 - 1}</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>Round {hud.round}</div>
          <div style={{ marginTop: 6, fontSize: 30, fontWeight: 800, color: timerColor, fontVariantNumeric: 'tabular-nums' }}>{timeLabel}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#d9e2f2' }}>{hud.status}</div>
        </div>

        <div style={{ background: 'rgba(8,12,18,0.72)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontWeight: 700 }}>
            <span>Azure CPU</span><span>{Math.ceil(hud.azureHp)} HP</span>
          </div>
          {bar(hud.azureHp, '#2d8cff')}
          <div style={{ marginTop: 8 }}>{bar(hud.azureStamina, '#ffd45a')}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#bac4d6', display: 'flex', alignItems: 'center' }}>
            {[...Array(WINS_TO_WIN_MATCH)].map((_, i) => (
              <span key={i}>{winPip(i < hud.azureWins, '#2d8cff')}</span>
            ))}
            <span style={{ marginLeft: 4 }}>Wins {hud.azureWins}</span>
          </div>
        </div>
      </section>

      <div style={{ position: 'absolute', left: 16, bottom: 16, maxWidth: 520, background: 'rgba(8,12,18,0.72)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#e7edf8', pointerEvents: 'none' }}>
        {hud.feed}
      </div>

      {hud.loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,14,0.65)', backdropFilter: 'blur(2px)', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 14, letterSpacing: 4, color: '#aeb8c8' }}>LOADING SKELETONS...</div>
        </div>
      )}

      {hud.matchOver && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,8,14,0.78)', backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            background: 'rgba(12,16,24,0.95)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12,
            padding: '28px 44px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 14, letterSpacing: 4, color: '#aeb8c8' }}>MATCH WINNER</div>
            <div style={{
              fontSize: 42, fontWeight: 900, marginTop: 8,
              color: hud.matchWinner?.startsWith('Crimson') ? '#ff5d5d' : '#5db1ff',
            }}>{hud.matchWinner}</div>
            <div style={{ fontSize: 13, color: '#bac4d6', marginTop: 6 }}>
              {hud.crimsonWins} – {hud.azureWins}
            </div>
            <button
              onClick={handleRestart}
              style={{
                marginTop: 22, padding: '10px 28px', fontSize: 15, fontWeight: 700, color: '#0b0d12',
                background: '#ffd45a', border: 'none', borderRadius: 6, cursor: 'pointer',
              }}
            >Restart Match</button>
          </div>
        </div>
      )}
    </main>
  );
}
