'use client';

/**
 * Unity Uub (Human Basic Motions) Babylon.js 再現
 *
 * Phase 1 (MVP):  HumanM + Idle01 表示
 * Phase 2:        複数アニメ読込 + 切替UI
 * Phase 3:        2レイヤー + Avatar Mask 移植
 * Phase 4:        SpineProxy 機構移植
 * Phase 5:        床トレッドミル + ブロブ影 + カメラ制御
 * Phase 6 (現在): HumanF (♀) 追加 + キャラ切替
 *                  - HumanF の FBX は GlobalSettings.upAxis=2 (Z-up) と記録されているが、
 *                    実データは Y-up と同じ配置 (B-hips Y=96.77cm) なので軸補正は不要
 *                  - HumanF は preRotation 全て 0 (HumanM は非ゼロ)。motion 側で全姿勢が
 *                    焼き込まれているため、本ページの再生パイプライン (preRot=Identity) で問題なし
 *                  - キャラ切替時は scene を再初期化 (boneRuntimes も再構築)
 */
import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, MeshBuilder, StandardMaterial, Mesh,
  Quaternion, Matrix, DynamicTexture, Texture,
  VertexData, ShaderMaterial, Effect,
} from '@babylonjs/core';

// ─── スキニング用 Custom Shader ──────────────────────────
// 56 ボーンの skin matrix (= boneWorld × inverseBind) を uniform で受け取り、
// 各頂点の 4 ボーン影響の加重平均でワールド位置を計算する。
const SKIN_VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 matricesIndices;
attribute vec4 matricesWeights;
uniform mat4 viewProjection;
uniform mat4 boneMatrices[56];
varying vec3 vNormal;
varying vec3 vPosWorld;
void main() {
  mat4 skin = matricesWeights.x * boneMatrices[int(matricesIndices.x)]
            + matricesWeights.y * boneMatrices[int(matricesIndices.y)]
            + matricesWeights.z * boneMatrices[int(matricesIndices.z)]
            + matricesWeights.w * boneMatrices[int(matricesIndices.w)];
  vec4 worldPos = skin * vec4(position, 1.0);
  vPosWorld = worldPos.xyz;
  vNormal = normalize((skin * vec4(normal, 0.0)).xyz);
  gl_Position = viewProjection * worldPos;
}
`;

const SKIN_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vNormal;
varying vec3 vPosWorld;
uniform vec3 lightDir;
uniform vec3 baseColor;
void main() {
  float d = max(0.30, dot(normalize(vNormal), -normalize(lightDir)));
  vec3 col = baseColor * d;
  gl_FragColor = vec4(col, 1.0);
}
`;
Effect.ShadersStore['uubVertexShader'] = SKIN_VERTEX_SHADER;
Effect.ShadersStore['uubFragmentShader'] = SKIN_FRAGMENT_SHADER;

// ─── キャラクター ─────────────────────────────────────────
type CharEntry = { id: 'humanM' | 'humanF'; label: string; boneDataFile: string; animPrefix: string };
const CHARACTERS: CharEntry[] = [
  { id: 'humanM', label: 'HumanM (♂)', boneDataFile: 'bone-data-humanM.json', animPrefix: 'HumanM' },
  { id: 'humanF', label: 'HumanF (♀)', boneDataFile: 'bone-data-humanF.json', animPrefix: 'HumanF' },
];

// ─── アニメ一覧 ─────────────────────────────────────────
// manifest (animations-manifest.json) を初期ロードで取得して使用。
// 各エントリ:
//   - file: motions/ 配下のファイル名
//   - label: 表示名 (Walk01_Forward [RM] など)
//   - folderPath: drill-down UI 用 (Idles, Movement/Walk, Movement/Walk/RootMotion)
//   - character: 'HumanM' | 'HumanF' | 'BOTH' (BOTH は Masked Poses で両キャラで使用可)
//   - hasRootMotion: true なら B-root が前進する RM 版
type AnimChar = 'HumanM' | 'HumanF' | 'BOTH';
type AnimEntry = { label: string; file: string; folderPath: string; character: AnimChar; hasRootMotion?: boolean };

/** 指定フォルダ内の直接サブフォルダと直接アニメを返す */
function browseFolder(folder: string, anims: (AnimEntry & { absIdx: number })[]): {
  subfolders: string[];   // フルパス
  directAnims: (AnimEntry & { absIdx: number })[];
} {
  const subs = new Set<string>();
  const directAnims: (AnimEntry & { absIdx: number })[] = [];
  for (const a of anims) {
    if (a.folderPath === folder) {
      directAnims.push(a);
      continue;
    }
    const prefix = folder === '' ? '' : folder + '/';
    if (a.folderPath.startsWith(prefix)) {
      const rest = a.folderPath.substring(prefix.length);
      const nextSeg = rest.split('/')[0];
      subs.add(folder === '' ? nextSeg : folder + '/' + nextSeg);
    }
  }
  return { subfolders: Array.from(subs).sort(), directAnims };
}

/** 指定キャラ用にデフォルトアニメ index を返す (Idle01 を優先、無ければそのキャラ最初) */
function findDefaultAnimIdx(anims: AnimEntry[], char: AnimChar): number {
  const matches = (a: AnimEntry) => a.character === char || a.character === 'BOTH';
  // Idle01 を探す
  let idx = anims.findIndex(a => matches(a) && a.label === 'Idle01');
  if (idx >= 0) return idx;
  idx = anims.findIndex(a => matches(a) && a.label === 'Idle 01');
  if (idx >= 0) return idx;
  return anims.findIndex(matches);
}

// ─── データ型 ────────────────────────────────────────────
type BoneEntry = {
  name: string;
  parent: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  preRotation: [number, number, number];  // FBX 由来の rest pose 回転 (motion 側では焼き込み済み)
};
type BoneData = { bones: BoneEntry[] };
type MotionFrameBone = {
  name: string;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
};
type MotionData = {
  fps: number;
  duration: number;
  frameCount: number;
  frames: Array<{ time: number; bones: MotionFrameBone[] }>;
};
type MaskData = {
  maskName: string;
  weights: Record<string, number>;
};
type MeshData = {
  vertexCount: number;
  triangleCount: number;
  positions: number[];
  normals: number[];
  indices: number[];
  matricesIndices: number[];
  matricesWeights: number[];
  boneNames: string[];
  bindMatrices: (number[] | null)[];  // 56 × 16 floats (FBX TransformLink, col-major, cm)
};

// ─── 数学ユーティリティ ─────────────────────────────────
const D2R = Math.PI / 180;
const CM_TO_M = 0.01;

function eulerXYZToQuat(rxDeg: number, ryDeg: number, rzDeg: number): Quaternion {
  const rx = rxDeg * D2R, ry = ryDeg * D2R, rz = rzDeg * D2R;
  const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), rx);
  const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), ry);
  const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), rz);
  return qz.multiply(qy).multiply(qx);
}

function fbxPosToBabylon(p: [number, number, number]): Vector3 {
  return new Vector3(p[0] * CM_TO_M, p[1] * CM_TO_M, p[2] * CM_TO_M);
}

// ─── 描画用ランタイム ───────────────────────────────────
type BoneRuntime = {
  name: string;
  parentIndex: number;
  localPos: Vector3;
  localRotQuat: Quaternion;
  worldMatrix: Matrix;
  jointMesh: Mesh | null;
  boneMesh: Mesh | null;
  /** Upper Mask weight (1 = 上半身に有効, 0 = 無効) */
  upperWeight: number;
};

// 表示用カラー
const COLOR_JOINT_BASE = new Color3(0.95, 0.45, 0.25);
const COLOR_JOINT_UPPER = new Color3(0.35, 0.85, 0.95);
const COLOR_BONE_BASE = new Color3(0.6, 0.7, 0.85);
const COLOR_BONE_UPPER = new Color3(0.35, 0.85, 0.95);

export default function UubDemoPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>('Loading...');
  const [playing, setPlaying] = useState<boolean>(true);
  const playingRef = useRef<boolean>(true);

  // アニメ manifest (動的ロード)
  const [animations, setAnimations] = useState<AnimEntry[]>([]);
  const animationsRef = useRef<AnimEntry[]>([]);
  useEffect(() => { animationsRef.current = animations; }, [animations]);

  // manifest を初回 1 回だけ取得
  useEffect(() => {
    fetch('/uub-data/animations-manifest.json')
      .then(r => r.json())
      .then((arr: AnimEntry[]) => {
        setAnimations(arr);
        // 取得後にデフォルト Idle01 をセット
        const defaultIdx = findDefaultAnimIdx(arr, 'HumanM');
        if (defaultIdx >= 0) setBaseAnimIdx(defaultIdx);
      })
      .catch(e => setStatus(`manifest load error: ${e}`));
  }, []);

  // キャラクター index
  const [characterIdx, setCharacterIdx] = useState<number>(0);

  // Base / Upper 別々のアニメ index. Upper は null = OFF
  const [baseAnimIdx, setBaseAnimIdx] = useState<number>(-1);
  const [upperAnimIdx, setUpperAnimIdx] = useState<number | null>(null);

  const baseAnimIdxRef = useRef<number>(baseAnimIdx);
  const upperAnimIdxRef = useRef<number | null>(upperAnimIdx);

  const [showMask, setShowMask] = useState<boolean>(true);
  const showMaskRef = useRef<boolean>(showMask);

  // SpineProxy ON/OFF
  const [spineProxyEnabled, setSpineProxyEnabled] = useState<boolean>(true);
  const spineProxyEnabledRef = useRef<boolean>(true);

  // 表示モード: 'stick' (球+線) | 'mesh' (スキニングメッシュ)
  const [displayMode, setDisplayMode] = useState<'stick' | 'mesh'>('mesh');
  const displayModeRef = useRef<'stick' | 'mesh'>('mesh');

  // カスタムマスクモード: B-spine をマスクから除外する (SpineProxy効果検証用)
  // 通常マスク: spine も上半身 → SpineProxy ON/OFF で差が見えない (Kevin Iglesias の調整による)
  // カスタム:   spine は下半身扱い → SpineProxy ON で B-spineProxy → B-spine 転写の効果が見える
  const [excludeSpineFromMask, setExcludeSpineFromMask] = useState<boolean>(false);
  const excludeSpineFromMaskRef = useRef<boolean>(false);

  const [frameInfo, setFrameInfo] = useState<{
    baseFrame: number; baseTotal: number;
    upperFrame: number; upperTotal: number;
  }>({ baseFrame: 0, baseTotal: 0, upperFrame: 0, upperTotal: 0 });

  // motion キャッシュ
  const motionCacheRef = useRef<Map<string, MotionData>>(new Map());
  const baseMotionRef = useRef<MotionData | null>(null);
  const upperMotionRef = useRef<MotionData | null>(null);
  const baseResetRef = useRef<boolean>(false);
  const upperResetRef = useRef<boolean>(false);

  // カメラ制御 (UI ボタンから操作)
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const cameraRotationInputRef = useRef<number>(0);  // -1, 0, +1

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { showMaskRef.current = showMask; }, [showMask]);
  useEffect(() => { spineProxyEnabledRef.current = spineProxyEnabled; }, [spineProxyEnabled]);
  useEffect(() => { excludeSpineFromMaskRef.current = excludeSpineFromMask; }, [excludeSpineFromMask]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);

  // motion ロード共通関数
  const loadMotion = async (file: string): Promise<MotionData | null> => {
    const cache = motionCacheRef.current;
    let m = cache.get(file);
    if (m) return m;
    const res = await fetch(`/uub-data/motions/${file}`);
    if (!res.ok) {
      setStatus(`Failed to load ${file}: ${res.status}`);
      return null;
    }
    m = (await res.json()) as MotionData;
    cache.set(file, m);
    return m;
  };

  // Base 切替 (animations が空 or baseAnimIdx<0 ならスキップ)
  useEffect(() => {
    baseAnimIdxRef.current = baseAnimIdx;
    if (baseAnimIdx < 0 || !animations[baseAnimIdx]) return;
    let cancelled = false;
    (async () => {
      const m = await loadMotion(animations[baseAnimIdx].file);
      if (cancelled || !m) return;
      baseMotionRef.current = m;
      baseResetRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [baseAnimIdx, animations]);

  // Upper 切替 (null = OFF)
  useEffect(() => {
    upperAnimIdxRef.current = upperAnimIdx;
    if (upperAnimIdx === null) {
      upperMotionRef.current = null;
      return;
    }
    if (!animations[upperAnimIdx]) return;
    let cancelled = false;
    (async () => {
      const m = await loadMotion(animations[upperAnimIdx].file);
      if (cancelled || !m) return;
      upperMotionRef.current = m;
      upperResetRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [upperAnimIdx, animations]);

  // Babylon 初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: Engine | null = null;
    let scene: Scene | null = null;
    let disposed = false;

    (async () => {
      const char = CHARACTERS[characterIdx];
      setStatus(`Fetching ${char.label} bone/mask/mesh data...`);
      const meshFile = char.id === 'humanM' ? 'mesh-humanM.json' : 'mesh-humanF.json';
      const [boneRes, maskRes, meshRes] = await Promise.all([
        fetch(`/uub-data/${char.boneDataFile}`),
        fetch('/uub-data/masks/upper.json'),
        fetch(`/uub-data/${meshFile}`),
      ]);
      if (!boneRes.ok || !maskRes.ok || !meshRes.ok) {
        setStatus(`Fetch error: bones=${boneRes.status}, mask=${maskRes.status}, mesh=${meshRes.status}`);
        return;
      }
      const boneData = (await boneRes.json()) as BoneData;
      const maskData = (await maskRes.json()) as MaskData;
      const meshData = (await meshRes.json()) as MeshData;
      if (disposed) return;

      setStatus(`${boneData.bones.length} bones, ${meshData.vertexCount} verts, mask "${maskData.maskName}"`);

      engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
      scene = new Scene(engine);
      scene.useRightHandedSystem = true;
      scene.clearColor.set(0.08, 0.10, 0.13, 1);

      const camera = new ArcRotateCamera(
        'cam', Math.PI / 2, Math.PI / 2.4, 3.5, new Vector3(0, 1.0, 0), scene,
      );
      camera.attachControl(canvas, true);
      camera.lowerRadiusLimit = 1.5;
      camera.upperRadiusLimit = 10;
      camera.wheelDeltaPercentage = 0.01;
      camera.fov = 0.8;
      cameraRef.current = camera;

      new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);

      // ─── トレッドミル床 ──────────────────────────────
      // DynamicTexture でグリッド模様を描画。RM アニメ再生時に UV をスクロールさせる。
      const groundSize = 4;
      const groundTexSize = 512;
      const groundTex = new DynamicTexture('groundTex', { width: groundTexSize, height: groundTexSize }, scene, false);
      const ctx = groundTex.getContext() as unknown as CanvasRenderingContext2D;
      // 背景
      ctx.fillStyle = '#2c2f36';
      ctx.fillRect(0, 0, groundTexSize, groundTexSize);
      // グリッド (10x10)
      ctx.strokeStyle = '#5a6068';
      ctx.lineWidth = 1.5;
      for (let i = 0; i <= 10; i++) {
        const x = (i * groundTexSize) / 10;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, groundTexSize); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(groundTexSize, x); ctx.stroke();
      }
      // 中央に方向矢印 (進行方向確認用)
      ctx.fillStyle = '#a8b0bc';
      ctx.beginPath();
      const cx = groundTexSize / 2, cy = groundTexSize / 2;
      ctx.moveTo(cx, cy - 40);
      ctx.lineTo(cx - 20, cy + 20);
      ctx.lineTo(cx + 20, cy + 20);
      ctx.closePath(); ctx.fill();
      groundTex.update();
      groundTex.wrapU = Texture.WRAP_ADDRESSMODE;
      groundTex.wrapV = Texture.WRAP_ADDRESSMODE;
      groundTex.uScale = 2;
      groundTex.vScale = 2;

      const ground = MeshBuilder.CreateGround('ground', { width: groundSize, height: groundSize, subdivisions: 1 }, scene);
      const groundMat = new StandardMaterial('groundMat', scene);
      groundMat.diffuseTexture = groundTex;
      groundMat.specularColor = new Color3(0, 0, 0);
      ground.material = groundMat;

      // ─── ブロブ影 ────────────────────────────────────
      // 半透明の円形 Disc を足元に配置。両足距離からスケール、Y で alpha/scale 補間。
      const shadowTexSize = 256;
      const shadowTex = new DynamicTexture('shadowTex', { width: shadowTexSize, height: shadowTexSize }, scene, false);
      const sctx = shadowTex.getContext() as unknown as CanvasRenderingContext2D;
      const sc = shadowTexSize / 2;
      // 透明背景
      sctx.clearRect(0, 0, shadowTexSize, shadowTexSize);
      // ラジアルグラデーション (中央濃く、外周透明)
      const grad = sctx.createRadialGradient(sc, sc, 0, sc, sc, sc);
      grad.addColorStop(0, 'rgba(0,0,0,0.85)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.4)');
      grad.addColorStop(1, 'rgba(0,0,0,0.0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, shadowTexSize, shadowTexSize);
      shadowTex.update();
      shadowTex.hasAlpha = true;

      const shadow = MeshBuilder.CreatePlane('shadow', { size: 1 }, scene);
      shadow.rotation.x = Math.PI / 2;  // 床に水平 (RH なので +X 軸回転で下向き)
      shadow.position = new Vector3(0, 0.002, 0);
      const shadowMat = new StandardMaterial('shadowMat', scene);
      shadowMat.diffuseTexture = shadowTex;
      shadowMat.useAlphaFromDiffuseTexture = true;
      shadowMat.disableLighting = true;
      shadowMat.emissiveColor = new Color3(0, 0, 0);
      shadow.material = shadowMat;

      // マテリアル (Base/Upper 用に2系統)
      const jointMatBase = new StandardMaterial('jointMatBase', scene);
      jointMatBase.diffuseColor = COLOR_JOINT_BASE;
      jointMatBase.emissiveColor = new Color3(0.25, 0.10, 0.05);

      const jointMatUpper = new StandardMaterial('jointMatUpper', scene);
      jointMatUpper.diffuseColor = COLOR_JOINT_UPPER;
      jointMatUpper.emissiveColor = new Color3(0.05, 0.22, 0.25);

      const boneMatBase = new StandardMaterial('boneMatBase', scene);
      boneMatBase.diffuseColor = COLOR_BONE_BASE;
      boneMatBase.emissiveColor = new Color3(0.15, 0.18, 0.22);

      const boneMatUpper = new StandardMaterial('boneMatUpper', scene);
      boneMatUpper.diffuseColor = COLOR_BONE_UPPER;
      boneMatUpper.emissiveColor = new Color3(0.05, 0.22, 0.25);

      // ─── スキニングメッシュ構築 ────────────────────────
      // FBX TransformLink を Babylon Matrix に変換し、逆行列を計算。
      // FBX m[12,13,14] は column-major 表現の translation、Babylon m[12,13,14] は
      // row-major (= v_row × M 慣習) の translation。両者は数値が一致するため、
      // Matrix.FromArray(bm) は同一の幾何的変換を表す行列を生成する (転置不要)。
      //
      // HumanF 特殊事情:
      //   HumanF の FBX は declared upAxis=2 (Z-up) で、TransformLink は Z-up 座標で
      //   記録されている (例: B-hips translation が (0, -1.68, 96.77) で Z=96.77 が高さ)。
      //   一方、メッシュ頂点と motion データは Y-up で記録されているため整合性が崩れている。
      //   bind matrix にだけ Z-up → Y-up の軸補正 R_x(-90°) を右から掛けて統一する。
      const isFemale = char.id === 'humanF';
      const axisCorrection_ZtoY = Matrix.RotationX(-Math.PI / 2);

      const bindMatricesM: Matrix[] = meshData.bindMatrices.map(bm => {
        if (!bm) return Matrix.Identity();
        const m = Matrix.FromArray(bm);
        // cm → m for translation row
        m.setRowFromFloats(3, m.m[12] * CM_TO_M, m.m[13] * CM_TO_M, m.m[14] * CM_TO_M, 1);
        // HumanF: TransformLink_yup = TransformLink_zup × R_x(-90°)
        return isFemale ? m.multiply(axisCorrection_ZtoY) : m;
      });
      const inverseBindMatrices: Matrix[] = bindMatricesM.map(m => Matrix.Invert(m));

      // Babylon Mesh 構築
      const characterMesh = new Mesh('characterMesh', scene);
      const vd = new VertexData();
      // 位置は FBX cm 単位 → m に変換
      vd.positions = new Float32Array(meshData.positions.length);
      for (let i = 0; i < meshData.positions.length; i++) {
        vd.positions[i] = meshData.positions[i] * CM_TO_M;
      }
      vd.normals = new Float32Array(meshData.normals);
      vd.indices = new Uint32Array(meshData.indices);
      vd.matricesIndices = new Float32Array(meshData.matricesIndices);
      vd.matricesWeights = new Float32Array(meshData.matricesWeights);
      vd.applyToMesh(characterMesh);

      // ShaderMaterial (skinning)
      const skinMat = new ShaderMaterial('skinMat', scene, {
        vertex: 'uub', fragment: 'uub',
      }, {
        attributes: ['position', 'normal', 'matricesIndices', 'matricesWeights'],
        uniforms: ['viewProjection', 'lightDir', 'baseColor', 'boneMatrices'],
      });
      skinMat.setVector3('lightDir', new Vector3(0.3, -1, 0.4));
      skinMat.setColor3('baseColor', char.id === 'humanM' ? new Color3(0.95, 0.75, 0.6) : new Color3(0.95, 0.7, 0.75));
      characterMesh.material = skinMat;

      // ─── ボーンランタイム構築 ────────────────────────
      const nameToIndex = new Map<string, number>();
      boneData.bones.forEach((b, i) => nameToIndex.set(b.name, i));

      const boneRuntimes: BoneRuntime[] = boneData.bones.map(b => {
        const parentIndex = b.parent ? (nameToIndex.get(b.parent) ?? -1) : -1;
        const upperWeight = maskData.weights[b.name] ?? 0;

        const isFinger = b.name.includes('Finger') || b.name.includes('thumb') || b.name.includes('pinky');
        const radius = isFinger ? 0.008 : (b.name === 'B-head' ? 0.08 : 0.02);
        const jointMesh = MeshBuilder.CreateSphere(`j_${b.name}`, { diameter: radius * 2, segments: 8 }, scene!);

        let boneMesh: Mesh | null = null;
        if (parentIndex >= 0) {
          boneMesh = MeshBuilder.CreateCylinder(`b_${b.name}`, { height: 1, diameter: 0.01, tessellation: 6 }, scene!);
        }

        return {
          name: b.name, parentIndex, upperWeight,
          localPos: fbxPosToBabylon(b.localPosition),
          localRotQuat: eulerXYZToQuat(b.localRotation[0], b.localRotation[1], b.localRotation[2]),
          worldMatrix: Matrix.Identity(),
          jointMesh, boneMesh,
        };
      });

      // 深さ順
      const depths = boneRuntimes.map((_, i) => {
        let d = 0, p = boneRuntimes[i].parentIndex;
        while (p >= 0 && d < 50) { d++; p = boneRuntimes[p].parentIndex; }
        return d;
      });
      const sortedByDepth = boneRuntimes.map((_, i) => i).sort((a, b) => depths[a] - depths[b]);

      // ─── SpineProxy 事前計算 ────────────────────────
      // Unity SpineProxy.cs を再現:
      //   起動時: rotationOffset = inverse(B-spineProxy world rot @T-pose) * B-spine world rot @T-pose
      //   毎フレーム最終段: B-spine.worldRot = B-spineProxy.worldRot * rotationOffset
      //   その後 B-spine 子孫の world matrix を再計算
      const spineIdx = nameToIndex.get('B-spine') ?? -1;
      const spineProxyIdx = nameToIndex.get('B-spineProxy') ?? -1;
      let spineRotationOffset = Quaternion.Identity();
      const spineDescendants: number[] = [];

      if (spineIdx >= 0 && spineProxyIdx >= 0) {
        // T-pose world rotation 計算 (bone-data の preRotation を local rot として使う)
        // motion は preRotation を Lcl Rotation に焼き込んでいるが、bone-data は分離されている
        const restWorldMatrices: Matrix[] = new Array(boneData.bones.length);
        for (const i of sortedByDepth) {
          const b = boneData.bones[i];
          const restLocalRot = eulerXYZToQuat(b.preRotation[0], b.preRotation[1], b.preRotation[2]);
          const restLocalPos = fbxPosToBabylon(b.localPosition);
          const m = Matrix.Compose(Vector3.One(), restLocalRot, restLocalPos);
          const parentIdx = boneRuntimes[i].parentIndex;
          restWorldMatrices[i] = parentIdx < 0 ? m : m.multiply(restWorldMatrices[parentIdx]);
        }
        const restSpineRot = Quaternion.FromRotationMatrix(restWorldMatrices[spineIdx]);
        const restProxyRot = Quaternion.FromRotationMatrix(restWorldMatrices[spineProxyIdx]);
        // rotationOffset = inverse(restProxyRot) * restSpineRot
        spineRotationOffset = Quaternion.Inverse(restProxyRot).multiply(restSpineRot);

        // B-spine の子孫を列挙 (深さ順)
        for (let i = 0; i < boneRuntimes.length; i++) {
          if (i === spineIdx) continue;
          let p = boneRuntimes[i].parentIndex;
          while (p >= 0) {
            if (p === spineIdx) {
              spineDescendants.push(i);
              break;
            }
            p = boneRuntimes[p].parentIndex;
          }
        }
        spineDescendants.sort((a, b) => depths[a] - depths[b]);
      }

      // マテリアル割当を毎フレーム更新 (Upper有効/無効、showMask 切替で色が変わる)
      function updateMaterials() {
        const upperActive = upperMotionRef.current !== null;
        const excludeSpine = excludeSpineFromMaskRef.current;
        const isStick = displayModeRef.current === 'stick';
        for (const rt of boneRuntimes) {
          const effW = excludeSpine && rt.name === 'B-spine' ? 0 : rt.upperWeight;
          const isUpper = upperActive && effW > 0 && showMaskRef.current;
          if (rt.jointMesh) {
            rt.jointMesh.material = isUpper ? jointMatUpper : jointMatBase;
            rt.jointMesh.isVisible = isStick;
          }
          if (rt.boneMesh) {
            rt.boneMesh.material = isUpper ? boneMatUpper : boneMatBase;
            rt.boneMesh.isVisible = isStick;
          }
        }
        characterMesh.isVisible = !isStick;
      }

      // ─── スキン行列バッファ ──────────────────────────
      const SKIN_MATRIX_COUNT = 56;
      // ShaderMaterial.setMatrices は Matrix[] を受け取り、内部で Float32Array に変換する。
      // 事前確保した Matrix[] を再利用してアロケーション回避。
      const skinMatricesArr: Matrix[] = Array.from({ length: SKIN_MATRIX_COUNT }, () => Matrix.Identity());
      function updateSkinMatrices() {
        // 各ボーンの skinMatrix = inverseBind × currentWorld (row-major / row-vector 慣習)
        // = 頂点 (バインドポーズワールド座標) → ボーンローカル座標 → 現在ワールド座標
        const n = Math.min(boneRuntimes.length, SKIN_MATRIX_COUNT);
        for (let i = 0; i < n; i++) {
          inverseBindMatrices[i].multiplyToRef(boneRuntimes[i].worldMatrix, skinMatricesArr[i]);
        }
        skinMat.setMatrices('boneMatrices', skinMatricesArr);
      }

      // 1フレーム描画: Base + Upper をミキシング
      function updateBones(baseFrame: { bones: MotionFrameBone[] }, upperFrame: { bones: MotionFrameBone[] } | null) {
        const baseByName = new Map<string, MotionFrameBone>();
        for (const fb of baseFrame.bones) baseByName.set(fb.name, fb);

        const upperByName = upperFrame ? new Map<string, MotionFrameBone>() : null;
        if (upperByName && upperFrame) {
          for (const fb of upperFrame.bones) upperByName.set(fb.name, fb);
        }

        // 各ボーン: upper があり upperWeight>0 なら upper、そうでなければ base
        // カスタムマスクモード時は B-spine を強制的に Base 扱いにする (SpineProxy効果検証用)
        const excludeSpine = excludeSpineFromMaskRef.current;
        for (const rt of boneRuntimes) {
          const effectiveUpperWeight = excludeSpine && rt.name === 'B-spine' ? 0 : rt.upperWeight;
          const useUpper = upperByName !== null && effectiveUpperWeight > 0;
          const src = useUpper ? upperByName!.get(rt.name) : baseByName.get(rt.name);
          if (src) {
            rt.localPos = fbxPosToBabylon(src.localPosition);
            rt.localRotQuat = eulerXYZToQuat(src.localRotation[0], src.localRotation[1], src.localRotation[2]);
          }
        }

        // world 行列
        for (const i of sortedByDepth) {
          const rt = boneRuntimes[i];
          const m = Matrix.Compose(Vector3.One(), rt.localRotQuat, rt.localPos);
          rt.worldMatrix = rt.parentIndex < 0 ? m : m.multiply(boneRuntimes[rt.parentIndex].worldMatrix);
        }

        // ─── SpineProxy 適用 ──────────────────────────
        // B-spine の world rotation を B-spineProxy の world rotation で上書きし、
        // B-spine 子孫を再計算する。これにより、Upper アニメで spineProxy が回ると
        // spine 以降だけが追従し、脚は base アニメに従ったまま維持される。
        if (spineProxyEnabledRef.current && spineIdx >= 0 && spineProxyIdx >= 0) {
          const proxyWorldRot = Quaternion.FromRotationMatrix(boneRuntimes[spineProxyIdx].worldMatrix);
          const newSpineWorldRot = proxyWorldRot.multiply(spineRotationOffset);
          const spineWorldPos = boneRuntimes[spineIdx].worldMatrix.getTranslation();
          boneRuntimes[spineIdx].worldMatrix = Matrix.Compose(
            Vector3.One(), newSpineWorldRot, spineWorldPos,
          );

          // B-spine 子孫を再計算 (深さ順)
          for (const i of spineDescendants) {
            const rt = boneRuntimes[i];
            const localM = Matrix.Compose(Vector3.One(), rt.localRotQuat, rt.localPos);
            rt.worldMatrix = localM.multiply(boneRuntimes[rt.parentIndex].worldMatrix);
          }
        }

        // 描画
        for (const rt of boneRuntimes) {
          if (!rt.jointMesh) continue;
          rt.jointMesh.position = rt.worldMatrix.getTranslation();
        }
        for (const rt of boneRuntimes) {
          if (!rt.boneMesh || rt.parentIndex < 0) continue;
          const childPos = rt.worldMatrix.getTranslation();
          const parentPos = boneRuntimes[rt.parentIndex].worldMatrix.getTranslation();
          const mid = parentPos.add(childPos).scale(0.5);
          const dir = childPos.subtract(parentPos);
          const len = dir.length();
          if (len < 1e-6) {
            rt.boneMesh.scaling.y = 0;
            rt.boneMesh.position = mid;
          } else {
            rt.boneMesh.position = mid;
            rt.boneMesh.scaling.y = len;
            const yAxis = new Vector3(0, 1, 0);
            const ndir = dir.normalize();
            const dot = Vector3.Dot(yAxis, ndir);
            if (Math.abs(dot - 1) < 1e-6) {
              rt.boneMesh.rotationQuaternion = Quaternion.Identity();
            } else if (Math.abs(dot + 1) < 1e-6) {
              rt.boneMesh.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
            } else {
              const axis = Vector3.Cross(yAxis, ndir).normalize();
              const angle = Math.acos(dot);
              rt.boneMesh.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
            }
          }
        }
      }

      // ─── ブロブ影パラメータ ──────────────────────────
      const SHADOW_FLOOR_Y = 0.003;
      const SHADOW_MIN_SCALE = 0.4;
      const SHADOW_MAX_SCALE = 1.2;
      const SHADOW_FOOT_PADDING = 0.18;
      const MAX_JUMP_HEIGHT = 1.0;
      const SHADOW_GROUNDED_SCALE = 1.0;
      const SHADOW_AIR_SCALE = 1.4;
      const SHADOW_GROUNDED_ALPHA = 0.78;
      const SHADOW_AIR_ALPHA = 0.08;

      // トレッドミル設定
      const TREADMILL_MULTIPLIER = 0.5;  // UV オフセット倍率 (床のテクスチャ密度に合わせて調整)

      const leftFootIdx = nameToIndex.get('B-foot.L') ?? -1;
      const rightFootIdx = nameToIndex.get('B-foot.R') ?? -1;
      const rootIdx = nameToIndex.get('B-root') ?? -1;

      // 床テクスチャ UV オフセット (累積)
      let groundOffsetU = 0;
      let groundOffsetV = 0;

      // アニメループ: Base + Upper を独立タイマーで進める
      let baseAcc = 0, upperAcc = 0;
      let lastTime = performance.now();

      // 前フレームの B-root.localPosition (m, RH) を記録 (RM アニメの delta 計算用)
      let prevBaseRootPos: Vector3 | null = null;
      let prevBaseFrameIdx = -1;

      // カメラ回転速度
      const CAMERA_ROT_SPEED = 1.5;

      scene.onBeforeRenderObservable.add(() => {
        const now = performance.now();
        const dtSec = (now - lastTime) / 1000;
        lastTime = now;

        // カメラ回転 (UI ボタン入力に応じて alpha 変更)
        if (cameraRotationInputRef.current !== 0 && cameraRef.current) {
          cameraRef.current.alpha += cameraRotationInputRef.current * CAMERA_ROT_SPEED * dtSec;
        }

        updateMaterials();

        const base = baseMotionRef.current;
        const upper = upperMotionRef.current;
        if (!base) return;

        if (baseResetRef.current) {
          baseAcc = 0; baseResetRef.current = false;
          prevBaseRootPos = null; prevBaseFrameIdx = -1;
        }
        if (upperResetRef.current) { upperAcc = 0; upperResetRef.current = false; }

        if (playingRef.current) {
          baseAcc += dtSec * base.fps;
          if (baseAcc >= base.frameCount) baseAcc -= base.frameCount;
          if (upper) {
            upperAcc += dtSec * upper.fps;
            if (upperAcc >= upper.frameCount) upperAcc -= upper.frameCount;
          }
        }
        const bFrameIdx = Math.floor(baseAcc) % base.frameCount;
        const uFrameIdx = upper ? Math.floor(upperAcc) % upper.frameCount : 0;

        // ─── トレッドミル: Base の B-root delta を取得 ───
        // Base のフレームから B-root の localPosition を取得 (RM アニメなら前進)
        const baseFrame = base.frames[bFrameIdx];
        const rootBoneFrame = baseFrame.bones.find(b => b.name === 'B-root');
        if (rootBoneFrame) {
          const currentRootPos = fbxPosToBabylon(rootBoneFrame.localPosition);
          if (prevBaseRootPos && prevBaseFrameIdx !== bFrameIdx) {
            let dx = currentRootPos.x - prevBaseRootPos.x;
            let dz = currentRootPos.z - prevBaseRootPos.z;
            // ループ境界対策: ジャンプ量が異常に大きければ逆方向ループとみなしてスキップ
            if (Math.abs(dx) > 0.3 || Math.abs(dz) > 0.3) {
              dx = 0; dz = 0;
            }
            // 床テクスチャを反対方向にスクロール (キャラ +Z 前進 → 床 -V スクロール = テクスチャ +V オフセット)
            groundOffsetU -= dx * TREADMILL_MULTIPLIER;
            groundOffsetV += dz * TREADMILL_MULTIPLIER;
            groundTex.uOffset = groundOffsetU;
            groundTex.vOffset = groundOffsetV;
          }
          prevBaseRootPos = currentRootPos;
          prevBaseFrameIdx = bFrameIdx;
        }

        // updateBones に渡す前に、B-root の localPosition を (0, 0, 0) に上書きするため
        // base/upper のフレームをコピーして編集
        const baseFrameCentered = {
          bones: baseFrame.bones.map(b =>
            b.name === 'B-root'
              ? { ...b, localPosition: [0, 0, 0] as [number, number, number] }
              : b
          ),
        };
        const upperFrameCentered = upper ? {
          bones: upper.frames[uFrameIdx].bones.map(b =>
            b.name === 'B-root'
              ? { ...b, localPosition: [0, 0, 0] as [number, number, number] }
              : b
          ),
        } : null;

        updateBones(baseFrameCentered, upperFrameCentered);

        // ─── スキニング行列更新 (メッシュモード時) ──────
        if (displayModeRef.current === 'mesh') {
          updateSkinMatrices();
          // viewProjection を ShaderMaterial に渡す
          skinMat.setMatrix('viewProjection', scene!.getTransformMatrix());
        }

        // ─── ブロブ影更新 ────────────────────────────────
        if (leftFootIdx >= 0 && rightFootIdx >= 0 && rootIdx >= 0) {
          const leftPos = boneRuntimes[leftFootIdx].worldMatrix.getTranslation();
          const rightPos = boneRuntimes[rightFootIdx].worldMatrix.getTranslation();
          const rootPos = boneRuntimes[rootIdx].worldMatrix.getTranslation();
          // 影は (root.x, floor, root.z) に配置
          shadow.position.x = rootPos.x;
          shadow.position.z = rootPos.z;
          shadow.position.y = SHADOW_FLOOR_Y;
          // 両足の中心と距離
          const centerXZ = new Vector3((leftPos.x + rightPos.x) / 2, 0, (leftPos.z + rightPos.z) / 2);
          const distance = Math.max(
            Math.hypot(leftPos.x - centerXZ.x, leftPos.z - centerXZ.z),
            Math.hypot(rightPos.x - centerXZ.x, rightPos.z - centerXZ.z),
          );
          let footScale = distance + SHADOW_FOOT_PADDING;
          footScale = Math.min(SHADOW_MAX_SCALE, Math.max(SHADOW_MIN_SCALE, footScale));
          // ジャンプ高度: root の Y で判定 (静止時は ~0.05m 程度)
          const heightAboveGround = Math.max(0, rootPos.y);
          const t = Math.min(1, heightAboveGround / MAX_JUMP_HEIGHT);
          const heightScale = SHADOW_GROUNDED_SCALE + (SHADOW_AIR_SCALE - SHADOW_GROUNDED_SCALE) * t;
          const alpha = SHADOW_GROUNDED_ALPHA + (SHADOW_AIR_ALPHA - SHADOW_GROUNDED_ALPHA) * t;
          shadow.scaling.x = footScale * heightScale;
          shadow.scaling.y = footScale * heightScale;
          shadow.visibility = alpha;
        }

        setFrameInfo(prev => {
          if (prev.baseFrame === bFrameIdx && prev.upperFrame === uFrameIdx
              && prev.baseTotal === base.frameCount
              && prev.upperTotal === (upper?.frameCount ?? 0)) return prev;
          return {
            baseFrame: bFrameIdx, baseTotal: base.frameCount,
            upperFrame: uFrameIdx, upperTotal: upper?.frameCount ?? 0,
          };
        });
      });

      engine.runRenderLoop(() => { scene?.render(); });
      const resize = () => engine?.resize();
      window.addEventListener('resize', resize);

      setStatus('Running');

      return () => {
        window.removeEventListener('resize', resize);
        engine?.dispose();
      };
    })();

    return () => {
      disposed = true;
      engine?.dispose();
    };
    // characterIdx 変更で scene を再初期化 (bone-data が変わる)
  }, [characterIdx]);

  // キャラ切替時にアニメをそのキャラに自動切替
  const handleCharacterChange = (newIdx: number) => {
    const newChar = CHARACTERS[newIdx];
    setCharacterIdx(newIdx);
    // Base アニメを新キャラ対応に切替
    const newBaseDefault = findDefaultAnimIdx(animations, newChar.animPrefix as AnimChar);
    setBaseAnimIdx(newBaseDefault);
    // Upper アニメも同様 (現在の Upper があれば対応版を探す、無ければ Idle02)
    setUpperAnimIdx(prev => {
      if (prev === null) return null;
      const prevAnim = animations[prev];
      if (!prevAnim) return null;
      // 同じ label のアニメを新キャラから探す
      const matchAnim = (a: AnimEntry) => a.character === newChar.animPrefix || a.character === 'BOTH';
      const match = animations.findIndex(a => matchAnim(a) && a.label === prevAnim.label);
      if (match >= 0) return match;
      return animations.findIndex(a => matchAnim(a) && a.label === 'Idle02');
    });
  };

  // ─── UI ─────────────────────────────────────────────
  const currentChar = CHARACTERS[characterIdx];
  // BOTH (Masked Poses) は両キャラで表示可能
  const filteredAnims = animations
    .map((a, i) => ({ ...a, absIdx: i }))
    .filter(a => a.character === currentChar.animPrefix || a.character === 'BOTH');

  // Base/Upper それぞれの現在フォルダパス
  const [baseFolder, setBaseFolder] = useState<string>('');
  const [upperFolder, setUpperFolder] = useState<string>('');
  // キャラ切替時に Folder をリセット
  useEffect(() => { setBaseFolder(''); setUpperFolder(''); }, [characterIdx]);

  const getFolderName = (path: string) => path.split('/').pop() ?? '';
  const getParentFolder = (path: string) => {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.substring(0, i);
  };

  const renderAnimList = (
    selectedIdx: number | null,
    onSelect: (idx: number | null) => void,
    allowNone: boolean,
    folder: string,
    setFolder: (f: string) => void,
  ) => {
    const { subfolders, directAnims } = browseFolder(folder, filteredAnims);
    return (
      <>
        {/* パンくず: /folder/path 表示 */}
        <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6, wordBreak: 'break-all' }}>
          📁 /{folder}
        </div>

        {/* ← Back (ルート以外) */}
        {folder !== '' && (
          <button
            onClick={() => setFolder(getParentFolder(folder))}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              marginBottom: 3, padding: '4px 8px', cursor: 'pointer',
              background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 12,
            }}
          >← Back</button>
        )}

        {/* (None) ボタン (Upper のみ) */}
        {allowNone && folder === '' && (
          <button
            onClick={() => onSelect(null)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              marginBottom: 3, padding: '4px 8px', cursor: 'pointer',
              background: selectedIdx === null ? '#888' : 'rgba(255,255,255,0.08)',
              color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 12,
            }}
          >
            {selectedIdx === null ? '▶ ' : '  '}(None — base only)
          </button>
        )}

        {/* サブフォルダ */}
        {subfolders.map(sub => (
          <button
            key={sub}
            onClick={() => setFolder(sub)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              marginBottom: 2, padding: '3px 8px', cursor: 'pointer',
              background: 'rgba(255,255,255,0.12)', color: '#fc8', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 12, fontWeight: 'bold',
            }}
          >📁 {getFolderName(sub)} →</button>
        ))}

        {/* 当該フォルダのアニメ */}
        {directAnims.map(a => {
          const isSelected = a.absIdx === selectedIdx;
          return (
            <button
              key={a.file}
              onClick={() => onSelect(a.absIdx)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                marginBottom: 2, padding: '3px 8px', cursor: 'pointer',
                background: isSelected ? '#5a4' : 'rgba(255,255,255,0.08)',
                color: '#fff', border: 'none', borderRadius: 3,
                fontFamily: 'inherit', fontSize: 12,
              }}
            >
              {isSelected ? '▶ ' : '  '}{a.label}
            </button>
          );
        })}

        {directAnims.length === 0 && subfolders.length === 0 && (
          <div style={{ color: '#888', fontSize: 11, padding: '6px 4px' }}>(empty)</div>
        )}
      </>
    );
  };

  // カメラ制御ハンドラ
  const startRotate = (dir: number) => () => { cameraRotationInputRef.current = dir; };
  const stopRotate = () => { cameraRotationInputRef.current = 0; };
  const zoom = (delta: number) => () => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.fov = Math.min(1.5, Math.max(0.4, cam.fov + delta));
  };
  const camBtnStyle: React.CSSProperties = {
    padding: '4px 10px', cursor: 'pointer',
    background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 3,
    fontFamily: 'inherit', fontSize: 11, userSelect: 'none',
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }} />

      {/* 左上: 状態 */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '10px 14px',
        borderRadius: 6, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5,
        maxWidth: 320,
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Unity Uub Demo — Phase 6</div>
        <div>Status: {status}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          {CHARACTERS.map((c, i) => (
            <button
              key={c.id}
              onClick={() => handleCharacterChange(i)}
              style={{
                flex: 1, padding: '4px 10px', cursor: 'pointer',
                background: characterIdx === i ? '#46a' : 'rgba(255,255,255,0.1)',
                color: '#fff', border: 'none', borderRadius: 3,
                fontFamily: 'inherit', fontSize: 11,
              }}
            >
              {characterIdx === i ? '▶ ' : ''}{c.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 4, color: '#fc8' }}>Base: {animations[baseAnimIdx]?.label}</div>
        <div>  Frame: {frameInfo.baseFrame} / {Math.max(0, frameInfo.baseTotal - 1)}</div>
        <div style={{ color: '#8cf' }}>Upper: {upperAnimIdx !== null ? animations[upperAnimIdx]?.label : '(none)'}</div>
        {upperAnimIdx !== null && <div>  Frame: {frameInfo.upperFrame} / {Math.max(0, frameInfo.upperTotal - 1)}</div>}
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button
            onClick={() => setPlaying(p => !p)}
            style={{
              padding: '4px 10px', cursor: 'pointer',
              background: playing ? '#5a4' : '#a55', color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 11,
            }}
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            onClick={() => setShowMask(s => !s)}
            style={{
              padding: '4px 10px', cursor: 'pointer',
              background: showMask ? '#3a7' : '#666', color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 11,
            }}
          >
            {showMask ? '🔵 Color-code mask' : '⬜ Same color'}
          </button>
        </div>
        <div style={{ marginTop: 4 }}>
          <button
            onClick={() => setDisplayMode(m => m === 'stick' ? 'mesh' : 'stick')}
            style={{
              padding: '4px 10px', cursor: 'pointer',
              background: displayMode === 'mesh' ? '#a73' : '#3a7', color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 11, width: '100%',
            }}
            title="球+線 と スキニングメッシュ を切替"
          >
            {displayMode === 'mesh' ? '👤 Mesh Display' : '🦴 Stick Figure'}
          </button>
        </div>
        <div style={{ marginTop: 4 }}>
          <button
            onClick={() => setSpineProxyEnabled(s => !s)}
            style={{
              padding: '4px 10px', cursor: 'pointer',
              background: spineProxyEnabled ? '#73a' : '#444', color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 11, width: '100%',
            }}
            title="Unity SpineProxy 機構: B-spineProxy の世界回転を B-spine に転写する"
          >
            {spineProxyEnabled ? '🦴 SpineProxy ON' : '🦴 SpineProxy OFF'}
          </button>
        </div>
        <div style={{ marginTop: 4 }}>
          <button
            onClick={() => setExcludeSpineFromMask(s => !s)}
            style={{
              padding: '4px 10px', cursor: 'pointer',
              background: excludeSpineFromMask ? '#a73' : '#333', color: '#fff', border: 'none', borderRadius: 3,
              fontFamily: 'inherit', fontSize: 11, width: '100%',
            }}
            title="カスタムマスク: B-spine を Upper Mask から除外する。SpineProxy ON/OFF の効果が見える検証モード"
          >
            {excludeSpineFromMask ? '🔬 Spine ⤖ Base (検証)' : '🔬 Standard Mask'}
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: '#999', lineHeight: 1.3 }}>
          検証手順: ① Base=Walk, Upper=Idle02 を選ぶ ② 🔬 を Spine⤖Base にする
          ③ 🦴 SpineProxy を ON/OFF で切替 → 上半身の姿勢が変わる
        </div>
      </div>

      {/* 右上: Base アニメ */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '10px 12px',
        borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
        maxWidth: 220, maxHeight: '45vh', overflowY: 'auto',
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#fc8' }}>Base Layer (full body)</div>
        {renderAnimList(baseAnimIdx, idx => idx !== null && setBaseAnimIdx(idx), false, baseFolder, setBaseFolder)}
      </div>

      {/* 下中央: カメラ制御 */}
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '8px 14px',
        borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, color: '#aaa' }}>Camera:</span>
        <button
          onMouseDown={startRotate(-1)} onMouseUp={stopRotate} onMouseLeave={stopRotate}
          onTouchStart={startRotate(-1)} onTouchEnd={stopRotate}
          style={camBtnStyle}
        >◀ Rotate L</button>
        <button
          onMouseDown={startRotate(1)} onMouseUp={stopRotate} onMouseLeave={stopRotate}
          onTouchStart={startRotate(1)} onTouchEnd={stopRotate}
          style={camBtnStyle}
        >Rotate R ▶</button>
        <button onClick={zoom(-0.1)} style={camBtnStyle}>🔍+ Zoom In</button>
        <button onClick={zoom(0.1)} style={camBtnStyle}>🔍− Zoom Out</button>
      </div>

      {/* 右下: Upper アニメ */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12,
        background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '10px 12px',
        borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
        maxWidth: 220, maxHeight: '45vh', overflowY: 'auto',
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#8cf' }}>Upper Layer (upper body only)</div>
        {renderAnimList(upperAnimIdx, setUpperAnimIdx, true, upperFolder, setUpperFolder)}
      </div>
    </div>
  );
}
