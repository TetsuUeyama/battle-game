'use client';

/**
 * スキンエディット (Phase 7-3) — 段階式ボクセル化ウィザード。
 *
 * ① ファイルを選択 (.glb / .fbx)
 * ② 生の 3D データを表示して確認 (まだボクセル化しない)
 * ③ OK なら、現行の格闘モーションモデル (FAP スケルトン) に関節・ボーンを合わせる
 *    (生モデルに骨ラインを重ね、向き・大きさ・上下・構えを調整)
 * ④ ボクセル化 → プレビュー → キャラへ適用
 *
 * ③④の位置合わせ数式は alignSkeleton (computeSkeletonFit) に集約しており、
 * プレビューの見た目と最終ボクセル化が一致する。
 */

import { useEffect, useRef, useState } from 'react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
// 副作用 import: scene.createPickingRay / multiPickWithRay を Scene に生やす
import '@babylonjs/core/Culling/ray';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

import {
  createVoxelFighter, preloadAnimations, loadFightingCharacter,
  collectBoneSegments, boneSegmentLines, skeletonFitInfo, computeSkeletonFit,
  applyPoseFit, TPOSE_CHAINS, triangleMeshBounds,
  readJointMarkers, LANDMARKS, landmarkDefaults, mirrorPlaneX, mirrorLandmark,
  inferMarkersFromLandmarks,
  type PreloadedAnimations, type VoxelFighter, type FightingCharacter,
  type BoneSegment, type SkeletonFitInfo, type TriangleMesh,
  type JointMarkers, type LandmarkPositions,
} from '@/fighting';
import { FIGHT_STYLES, STYLE_LABELS, MODEL_GLB_PATH, type FightStyle } from './moves';
import {
  importToTriangleMesh, importUrlToTriangleMesh, triangleCount, buildDisplayMesh,
} from './importMesh';
import { setSkin, clearSkin, hasSkin } from './skinStore';
import type { CharacterSkin } from './characterModel';

const ASSET_BASE = '/api/game-assets/fightingGamesystem/assets/';
/** プレビューに使うアニメ (idle を出すだけなので movement のみ) */
const PREVIEW_ANIM = ['kb_movement/kb_movement.glb'];

type Stage = 'select' | 'review' | 'align' | 'voxelize';

interface SkinParams {
  fitPose: 'none' | 'tpose';
  yawDeg: number;
  scale: number;
  offsetY: number;
  resolution: number;
}
const DEFAULT_PARAMS: SkinParams = { fitPose: 'none', yawDeg: 0, scale: 1, offsetY: 0, resolution: 56 };

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'ready'; voxels: number }
  | { kind: 'error'; text: string };

const STAGE_LABELS: { id: Stage; n: number; label: string }[] = [
  { id: 'select', n: 1, label: 'ファイル選択' },
  { id: 'review', n: 2, label: '3D 表示で確認' },
  { id: 'align', n: 3, label: '骨を合わせる' },
  { id: 'voxelize', n: 4, label: 'ボクセル化' },
];

/** マーカーモードで描く骨リンク (推定済み全関節を結ぶ。parent→child) */
const SKEL_LINKS: [string, string][] = [
  ['Hips', 'Spine'], ['Spine', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'],
  ['Spine2', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
  ['Spine2', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
  ['Hips', 'LeftUpLeg'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'],
  ['Hips', 'RightUpLeg'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
];

export interface SkinEditProps {
  /**
   * 指定すると「マイキャラクター」モード: スタイルへの適用 (skinStore) ではなく、
   * 完成したスキンを CharacterSkin として親へ渡す。スタイル選択UIは出さない。
   */
  onApply?: (skin: CharacterSkin) => void;
  /** 既存スキンを再編集する場合の初期値 (voxelize 段階から開始) */
  initialSkin?: CharacterSkin | null;
  /** 確定ボタンのラベル (既定 "このスキンを使う") */
  applyLabel?: string;
}

export default function SkinEdit({ onApply, initialSkin, applyLabel }: SkinEditProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const preRef = useRef<PreloadedAnimations | null>(null);

  // 生データ + 各ステージの表示物
  const trisRef = useRef<TriangleMesh | null>(null);
  const displayRef = useRef<Mesh | null>(null);
  const wrapRef = useRef<TransformNode | null>(null);
  const skelRef = useRef<FightingCharacter | null>(null);
  const skelFitPoseRef = useRef<SkinParams['fitPose'] | null>(null);
  const fitInfoRef = useRef<SkeletonFitInfo | null>(null);
  const boneVisRef = useRef<Mesh | null>(null);
  const jointVisRef = useRef<Mesh | null>(null);
  const vfRef = useRef<VoxelFighter | null>(null);
  const vf2Ref = useRef<VoxelFighter | null>(null); // 比較表示用 (マーカー無し)
  const srcRef = useRef<{ file?: File; url?: string } | null>(null); // 取込元 (元モデル参照表示用)
  const origRef = useRef<{ root: TransformNode; groups: { dispose: () => void }[] } | null>(null);

  // Mixamo 式マーカー関節合わせ
  const autoRotateRef = useRef(true);
  const fapDefaultRef = useRef<JointMarkers | null>(null); // FAP rest の全関節座標
  const landmarksRef = useRef<LandmarkPositions>({});       // 10 点の現在位置
  const markerSpheresRef = useRef<Map<string, Mesh>>(new Map());
  const markerLinesRef = useRef<Mesh | null>(null);
  const markersRef = useRef<JointMarkers | null>(null);     // 推定済み全関節 (確定用)

  const [stage, setStage] = useState<Stage>('select');
  const [selStyle, setSelStyle] = useState<FightStyle>('boxer');
  const [fileName, setFileName] = useState<string | null>(null);
  const [triCount, setTriCount] = useState(0);
  const [params, setParams] = useState<SkinParams>(DEFAULT_PARAMS);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [markerMode, setMarkerMode] = useState(false);
  const [symmetry, setSymmetry] = useState(true);
  const [hasMarkers, setHasMarkers] = useState(false);
  const [appliedTo, setAppliedTo] = useState<FightStyle[]>(
    () => FIGHT_STYLES.filter((s) => hasSkin(s)),
  );

  // --------------------------------------------------------------- Babylon init
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { antialias: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.05, 0.06, 0.09, 1);
    sceneRef.current = scene;

    const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.4, 3.4, new Vector3(0, 0.95, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.4;
    camera.upperRadiusLimit = 40;
    camera.wheelPrecision = 40;
    cameraRef.current = camera;
    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.85;
    const key = new DirectionalLight('k', new Vector3(-0.4, -1, 0.5), scene);
    key.intensity = 1.0;

    // ゆっくり自動回転 (マーカーモード中は停止)
    scene.onBeforeRenderObservable.add(() => {
      if (autoRotateRef.current) camera.alpha += engine.getDeltaTime() / 1000 * 0.25;
    });
    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    // idle アニメを先読み。initialSkin があれば再編集として voxelize から開始、
    // 無く ?autosample=1 ならサンプルを自動取り込み
    preloadAnimations(scene, PREVIEW_ANIM, { baseUrl: ASSET_BASE })
      .then((pre) => {
        preRef.current = pre;
        if (initialSkin) { loadInitialSkin(initialSkin); return; }
        const q = new URLSearchParams(window.location.search).get('autosample');
        if (q) void loadSample(q.startsWith('/') ? q : undefined);
      })
      .catch(() => { /* プレビューアニメ無しでも形状は見える */ });

    return () => {
      window.removeEventListener('resize', onResize);
      disposeAllStageObjects();
      preRef.current?.dispose();
      engine.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------------- 破棄ヘルパ
  const disposeDisplay = () => {
    displayRef.current?.dispose();
    displayRef.current = null;
    wrapRef.current?.dispose();
    wrapRef.current = null;
  };
  /** マーカー球 + 推定骨線を破棄 (状態は呼び出し側で戻す) */
  const disposeMarkerVis = () => {
    for (const s of markerSpheresRef.current.values()) s.dispose();
    markerSpheresRef.current.clear();
    markerLinesRef.current?.dispose();
    markerLinesRef.current = null;
  };
  const disposeSkeleton = () => {
    disposeMarkerVis();
    boneVisRef.current?.dispose();
    boneVisRef.current = null;
    jointVisRef.current?.dispose(); // インスタンスも一緒に破棄される
    jointVisRef.current = null;
    if (skelRef.current) {
      skelRef.current.rig.skeleton?.dispose();
      skelRef.current.rig.root.dispose();
      skelRef.current = null;
    }
    skelFitPoseRef.current = null;
    fitInfoRef.current = null;
    fapDefaultRef.current = null;
  };
  const disposeVoxel = () => {
    vfRef.current?.dispose();
    vfRef.current = null;
    vf2Ref.current?.dispose();
    vf2Ref.current = null;
    if (origRef.current) {
      for (const g of origRef.current.groups) g.dispose();
      origRef.current.root.dispose();
      origRef.current = null;
    }
  };
  const disposeAllStageObjects = () => {
    disposeDisplay();
    disposeSkeleton();
    disposeVoxel();
  };

  // --------------------------------------------------------------- カメラ寄せ
  const frameCamera = (targetY: number, radius: number) => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.setTarget(new Vector3(0, targetY, 0));
    cam.radius = radius;
  };

  // --------------------------------------------------------------- ① 取り込み
  const onPickFile = async (file: File | undefined) => {
    const scene = sceneRef.current;
    if (!file || !scene) return;
    setStatus({ kind: 'busy', text: `${file.name} を読み込み中…` });
    try {
      const tris = await importToTriangleMesh(scene, file);
      trisRef.current = tris;
      srcRef.current = { file };
      setFileName(file.name);
      setTriCount(triangleCount(tris));
      setParams(DEFAULT_PARAMS);
      setStatus({ kind: 'idle' });
      setStage('review');
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** URL から GLB を取り込む (サンプル/共有用) */
  const loadSample = async (url?: string) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const target = url ?? ASSET_BASE + MODEL_GLB_PATH;
    setStatus({ kind: 'busy', text: '読み込み中…' });
    try {
      const tris = await importUrlToTriangleMesh(scene, target);
      trisRef.current = tris;
      srcRef.current = { url: target };
      setFileName(target.split('/').pop() ?? target);
      setTriCount(triangleCount(tris));
      setParams(DEFAULT_PARAMS);
      setStatus({ kind: 'idle' });
      setStage('review');
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  // --------------------------------------------------------------- ② 生3D表示
  // stage が review のとき、生メッシュをそのまま (向き・色のまま) 表示する。
  useEffect(() => {
    if (stage !== 'review') return;
    const scene = sceneRef.current;
    const tris = trisRef.current;
    if (!scene || !tris) return;
    disposeDisplay();
    const mesh = buildDisplayMesh(scene, tris, { name: 'rawDisplay', alpha: 1 });
    displayRef.current = mesh;
    // 生スケール (cm/m 不定) に合わせてカメラを寄せる
    const b = triangleMeshBounds(tris);
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;
    mesh.position.set(-cx, -cy, -cz); // 原点中心へ寄せる (表示のみ)
    const ext = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    frameCamera(0, Math.max(0.8, ext * 1.5));
    return () => disposeDisplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // --------------------------------------------------------------- ③ 骨合わせ
  /** FAP スケルトンを (fitPose 適用で) ロードし、骨ライン/関節を描く */
  const ensureSkeleton = async (fitPose: SkinParams['fitPose']) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (skelRef.current && skelFitPoseRef.current === fitPose) return; // 既に同条件

    disposeSkeleton();
    setStatus({ kind: 'busy', text: 'スケルトン読込中…' });
    // モデル GLB のみ (アニメ不要 = 軽い)。メッシュは隠して骨だけ重ねる
    const fc = await loadFightingCharacter(scene, {
      modelGlbPath: MODEL_GLB_PATH,
      baseUrl: ASSET_BASE,
    });
    for (const m of fc.rig.meshes) m.setEnabled(false);
    fc.rig.root.computeWorldMatrix(true);
    if (fitPose === 'tpose') applyPoseFit(fc.rig, TPOSE_CHAINS);

    const segments = collectBoneSegments(fc.rig);
    if (segments.length === 0) {
      fc.rig.skeleton?.dispose();
      fc.rig.root.dispose();
      setStatus({ kind: 'error', text: 'ボーンが見つかりません' });
      return;
    }
    skelRef.current = fc;
    skelFitPoseRef.current = fitPose;
    fitInfoRef.current = skeletonFitInfo(segments);
    drawBones(segments);
    setStatus({ kind: 'idle' });
  };

  /** 骨ライン + 関節スフィアを描く */
  const drawBones = (segments: BoneSegment[]) => {
    const scene = sceneRef.current;
    if (!scene) return;
    boneVisRef.current?.dispose();
    jointVisRef.current?.dispose();

    const lines = MeshBuilder.CreateLineSystem(
      'boneLines', { lines: boneSegmentLines(segments) }, scene,
    );
    lines.color = new Color3(0.35, 0.82, 1);
    lines.isPickable = false;
    boneVisRef.current = lines as unknown as Mesh;

    // 関節スフィア (head にインスタンス配置)
    const info = fitInfoRef.current;
    const r = info ? Math.max(0.01, info.skelHeight * 0.014) : 0.02;
    const base = MeshBuilder.CreateSphere('joint', { diameter: r * 2, segments: 6 }, scene);
    const mat = new StandardMaterial('jointMat', scene);
    mat.emissiveColor = new Color3(1, 0.82, 0.2);
    mat.disableLighting = true;
    base.material = mat;
    base.isPickable = false;
    base.position.copyFrom(segments[0].head);
    for (let i = 1; i < segments.length; i++) {
      const inst = base.createInstance('joint' + i);
      inst.position.copyFrom(segments[i].head);
      inst.isPickable = false;
    }
    jointVisRef.current = base;
  };

  /** 生メッシュ (半透明) をラッパー下に作る */
  const ensureAlignDisplay = () => {
    const scene = sceneRef.current;
    const tris = trisRef.current;
    if (!scene || !tris || displayRef.current) return;
    const wrap = new TransformNode('alignWrap', scene);
    const mesh = buildDisplayMesh(scene, tris, { name: 'alignDisplay', alpha: 0.55 });
    mesh.parent = wrap;
    mesh.isPickable = false;
    wrapRef.current = wrap;
    displayRef.current = mesh;
  };

  /** 現在のパラメータでラッパー変換を更新 (骨へ位置合わせ) */
  const applyFitToWrapper = (p: SkinParams) => {
    const wrap = wrapRef.current;
    const tris = trisRef.current;
    const info = fitInfoRef.current;
    if (!wrap || !tris || !info) return;
    const fit = computeSkeletonFit(tris, info, { yawDeg: p.yawDeg, scale: p.scale, offsetY: p.offsetY });
    wrap.scaling.set(fit.appliedScale, fit.appliedScale, fit.appliedScale);
    wrap.rotation.set(0, fit.yawRad, 0);
    wrap.position.set(fit.translate[0], fit.translate[1], fit.translate[2]);
  };

  // align 入場 / fitPose 変更時: スケルトン (再)ロード → 表示 → 位置合わせ → カメラ
  useEffect(() => {
    if (stage !== 'align') return;
    let cancelled = false;
    (async () => {
      await ensureSkeleton(params.fitPose);
      if (cancelled || stage !== 'align') return;
      ensureAlignDisplay();
      applyFitToWrapper(params);
      const info = fitInfoRef.current;
      if (info) frameCamera(info.sMinY + info.skelHeight / 2, info.skelHeight * 1.7);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, params.fitPose]);

  // align 中の yaw/scale/offsetY 変更: ラッパー変換のみ更新 (再ロード無し)。
  // マーカーは現在のフィット位置のメッシュに対して置いたワールド座標なので、
  // 粗フィットが変わると不整合になる。マーカーがあればクリアして整合を保つ。
  useEffect(() => {
    if (stage !== 'align') return;
    applyFitToWrapper(params);
    if (hasMarkers || markerMode) {
      markersRef.current = null;
      landmarksRef.current = {};
      setHasMarkers(false);
      setMarkerMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.yawDeg, params.scale, params.offsetY, params.fitPose]);

  // --------------------------------------------------- Mixamo 式マーカー関節合わせ
  const symmetryRef = useRef(symmetry);
  useEffect(() => { symmetryRef.current = symmetry; }, [symmetry]);
  const activeDragRef = useRef<string | null>(null);   // ドラッグ中のランドマーク id
  // マーカードラッグの DOM ハンドラ (scene.onPointerObservable の配線に依存しないよう自前)
  const pointerHandlersRef = useRef<{
    canvas: HTMLCanvasElement;
    down: (e: PointerEvent) => void;
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  } | null>(null);

  /**
   * ポインタ (キャンバス相対 x,y) からマーカーの新しいワールド座標を求める。
   * モデルにレイが当たれば「表裏ヒットの中点 = 手足の中心」へ吸い付かせる
   * (どの視点でもモデルに乗る)。外れていればカメラ正対平面へ投影して追従させる。
   */
  const pointerToMarkerPos = (x: number, y: number): Vector3 | null => {
    const scene = sceneRef.current;
    const cam = cameraRef.current;
    const disp = displayRef.current;
    if (!scene || !cam) return null;
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), cam);
    if (disp) {
      const picks = scene.multiPickWithRay(ray, (m) => m === disp);
      if (picks && picks.length > 0) {
        let near = Infinity, far = -Infinity;
        let nearP: Vector3 | null = null, farP: Vector3 | null = null;
        for (const p of picks) {
          if (!p.pickedPoint) continue;
          if (p.distance < near) { near = p.distance; nearP = p.pickedPoint; }
          if (p.distance > far) { far = p.distance; farP = p.pickedPoint; }
        }
        if (nearP && farP) return Vector3.Center(nearP, farP); // 体積の中心
        if (nearP) return nearP;
      }
    }
    // フォールバック: モデルから外れたら現在の奥行きのカメラ正対平面へ投影
    const sph = activeDragRef.current
      ? markerSpheresRef.current.get(activeDragRef.current)
      : null;
    if (!sph) return null;
    const n = cam.position.subtract(sph.position).normalize(); // 平面法線 = カメラ向き
    const denom = Vector3.Dot(ray.direction, n);
    if (Math.abs(denom) < 1e-6) return null;
    const t = Vector3.Dot(sph.position.subtract(ray.origin), n) / denom;
    return ray.origin.add(ray.direction.scale(t));
  };

  /**
   * ポインタ (キャンバス相対 x,y) のレイに最も近いマーカー球の id を返す (掴み判定)。
   * モデルを無視し、球中心とレイの最短距離が球半径の数倍以内なら掴める。
   */
  const pickNearestMarker = (x: number, y: number): string | null => {
    const scene = sceneRef.current;
    const cam = cameraRef.current;
    if (!scene || !cam) return null;
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), cam);
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const [id, sph] of markerSpheresRef.current) {
      const toC = sph.position.subtract(ray.origin);
      const t = Vector3.Dot(toC, ray.direction); // レイ上の最近点パラメータ
      if (t < 0) continue; // カメラ後方
      const closest = ray.origin.add(ray.direction.scale(t));
      const d = Vector3.Distance(closest, sph.position);
      // 球の半径 (世界) の 2.4 倍までは掴めるよう許容 (小さい的を掴みやすく)
      const grab = sph.getBoundingInfo().boundingSphere.radiusWorld * 2.4;
      if (d <= grab && d < bestD) { bestD = d; bestId = id; }
    }
    return bestId;
  };

  /** ランドマークを target へ移動 (左右対称ミラー込み) し、再推定 */
  const moveLandmark = (id: string, target: Vector3) => {
    const sph = markerSpheresRef.current.get(id);
    if (sph) sph.position.copyFrom(target);
    landmarksRef.current[id] = [target.x, target.y, target.z];
    if (symmetryRef.current) {
      const planeX = mirrorPlaneX(landmarksRef.current, fapDefaultRef.current ?? {});
      const m = mirrorLandmark(id, [target.x, target.y, target.z], planeX);
      if (m) {
        landmarksRef.current[m.id] = m.pos;
        const ms = markerSpheresRef.current.get(m.id);
        if (ms) ms.position.set(m.pos[0], m.pos[1], m.pos[2]);
      }
    }
    recomputeMarkers();
  };

  /** 推定済み全関節から骨線を再描画 */
  const redrawMarkerLines = (markers: JointMarkers) => {
    const scene = sceneRef.current;
    if (!scene) return;
    markerLinesRef.current?.dispose();
    const lines: Vector3[][] = [];
    for (const [a, b] of SKEL_LINKS) {
      const pa = markers[a]; const pb = markers[b];
      if (pa && pb) {
        lines.push([new Vector3(pa[0], pa[1], pa[2]), new Vector3(pb[0], pb[1], pb[2])]);
      }
    }
    const ls = MeshBuilder.CreateLineSystem('markerLines', { lines }, scene);
    ls.color = new Color3(0.35, 0.82, 1);
    ls.isPickable = false;
    ls.renderingGroupId = 2;
    markerLinesRef.current = ls as unknown as Mesh;
  };

  /** ランドマーク → 全関節を推定して保存し、骨線を更新 */
  const recomputeMarkers = () => {
    const fap = fapDefaultRef.current;
    if (!fap) return;
    const markers = inferMarkersFromLandmarks(landmarksRef.current, fap);
    markersRef.current = markers;
    setHasMarkers(true);
    redrawMarkerLines(markers);
  };

  /** 10 個のマーカー球を作る (ドラッグはシーンの pointer observer で処理) */
  const buildMarkerSpheres = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    disposeMarkerVis();
    const info = fitInfoRef.current;
    const r = info ? Math.max(0.016, info.skelHeight * 0.028) : 0.04;
    for (const lm of LANDMARKS) {
      const p = landmarksRef.current[lm.id];
      if (!p) continue;
      const sph = MeshBuilder.CreateSphere('lm_' + lm.id, { diameter: r * 2, segments: 10 }, scene);
      sph.position.set(p[0], p[1], p[2]);
      const mat = new StandardMaterial('lmMat_' + lm.id, scene);
      mat.emissiveColor = lm.side === 'center' ? new Color3(1, 0.5, 0.15)
        : lm.side === 'left' ? new Color3(0.3, 1, 0.45) : new Color3(1, 0.4, 0.55);
      mat.disableLighting = true;
      sph.material = mat;
      sph.renderingGroupId = 2; // 半透明モデルより前に描画 (常に見える)
      sph.isPickable = true;
      markerSpheresRef.current.set(lm.id, sph);
    }
  };

  // マーカーモード切替: 入場で正面寄せ・自動回転停止・球生成・pointer observer、退場で後片付け
  useEffect(() => {
    const scene = sceneRef.current;
    const cam = cameraRef.current;
    const canvas = canvasRef.current;
    if (!scene || !cam) return;
    if (markerMode) {
      if (stage !== 'align' || !skelRef.current) { setMarkerMode(false); return; }
      autoRotateRef.current = false;
      cam.alpha = Math.PI / 2; // +Z 正面
      cam.beta = Math.PI / 2;
      if (!fapDefaultRef.current) {
        fapDefaultRef.current = readJointMarkers(skelRef.current.rig);
      }
      if (Object.keys(landmarksRef.current).length === 0 && fapDefaultRef.current) {
        landmarksRef.current = landmarkDefaults(fapDefaultRef.current);
      }
      const info = fitInfoRef.current;
      if (info) frameCamera(info.sMinY + info.skelHeight / 2, info.skelHeight * 1.5);
      boneVisRef.current?.setEnabled(false);
      jointVisRef.current?.setEnabled(false);
      if (displayRef.current) displayRef.current.isPickable = true;
      buildMarkerSpheres();
      recomputeMarkers();

      // モデル表面に吸い付くドラッグ (球を掴む→なぞる→離す)。
      // scene.onPointerObservable の配線に依存せず、キャンバスの DOM ポインタ
      // イベントで直接処理する (座標はキャンバス相対)。球は半透明モデルの内側に
      // あり Babylon 既定 pick だと手前のモデルを拾うため、モデルを無視して
      // 「ポインタのレイに最も近い球」を掴む (多少のズレも許容)。
      if (canvas) {
        const rel = (e: PointerEvent) => {
          const r = canvas.getBoundingClientRect();
          return { x: e.clientX - r.left, y: e.clientY - r.top };
        };
        const down = (e: PointerEvent) => {
          const { x, y } = rel(e);
          const id = pickNearestMarker(x, y);
          if (id) {
            activeDragRef.current = id;
            cam.detachControl(); // ドラッグ中はカメラ回転を止める
            e.preventDefault();
          }
        };
        const move = (e: PointerEvent) => {
          const id = activeDragRef.current;
          if (!id) return;
          const { x, y } = rel(e);
          const t = pointerToMarkerPos(x, y);
          if (t) moveLandmark(id, t);
        };
        const up = () => {
          if (activeDragRef.current) {
            activeDragRef.current = null;
            cam.attachControl(canvas, true);
          }
        };
        canvas.addEventListener('pointerdown', down);
        // move/up は window で受けてキャンバス外でもドラッグ継続
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        pointerHandlersRef.current = { canvas, down, move, up };
      }
    } else {
      autoRotateRef.current = true;
      activeDragRef.current = null;
      disposeMarkerVis();
      boneVisRef.current?.setEnabled(true);
      jointVisRef.current?.setEnabled(true);
      if (displayRef.current) displayRef.current.isPickable = false;
    }
    // クリーンアップ: DOM リスナーを外す (markerMode 変化時・アンマウント時の両方)
    return () => {
      const h = pointerHandlersRef.current;
      if (h) {
        h.canvas.removeEventListener('pointerdown', h.down);
        window.removeEventListener('pointermove', h.move);
        window.removeEventListener('pointerup', h.up);
        pointerHandlersRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerMode]);

  /** マーカーを既定 (FAP) へリセット */
  const resetMarkers = () => {
    if (!fapDefaultRef.current) return;
    landmarksRef.current = landmarkDefaults(fapDefaultRef.current);
    for (const lm of LANDMARKS) {
      const p = landmarksRef.current[lm.id];
      const sph = markerSpheresRef.current.get(lm.id);
      if (p && sph) sph.position.set(p[0], p[1], p[2]);
    }
    recomputeMarkers();
  };

  /**
   * 取込元の「リグ付き元モデル」をそのままロードして参照表示する。
   * voxel と同じくらいの身長へフィットし、x オフセットへ配置。自前アニメがあれば再生。
   */
  const loadOriginalModel = async (targetHeight: number, xOffset: number) => {
    const scene = sceneRef.current;
    const src = srcRef.current;
    if (!scene || !src) return;
    let res;
    try {
      res = src.file
        ? await ImportMeshAsync(src.file, scene)
        : src.url ? await ImportMeshAsync(src.url, scene) : null;
    } catch {
      return; // 元モデル参照は best-effort
    }
    if (!res) return;
    const meshes = res.meshes.filter((m: AbstractMesh) => !/_LOD[1-9]/i.test(m.name));
    for (const m of res.meshes) if (/_LOD[1-9]/i.test(m.name)) m.setEnabled(false);
    const root = (res.transformNodes.find((n) => n.name === '__root__')
      ?? res.meshes.find((m) => m.name === '__root__')
      ?? res.transformNodes.find((n) => !n.parent)) as TransformNode | undefined;
    if (!root) return;

    const bounds = () => {
      let mn = new Vector3(Infinity, Infinity, Infinity);
      let mx = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const m of meshes) {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        mn = Vector3.Minimize(mn, bb.minimumWorld);
        mx = Vector3.Maximize(mx, bb.maximumWorld);
      }
      return { mn, mx };
    };
    let { mn, mx } = bounds();
    const h = Math.max(1e-3, mx.y - mn.y);
    const s = targetHeight / h;
    root.scaling.scaleInPlace(s);
    root.computeWorldMatrix(true);
    ({ mn, mx } = bounds());
    root.position.x += xOffset - (mn.x + mx.x) / 2;
    root.position.y += -mn.y;
    root.position.z += -(mn.z + mx.z) / 2;
    root.computeWorldMatrix(true);

    for (const g of res.animationGroups) g.stop();
    if (res.animationGroups[0]) res.animationGroups[0].start(true);
    origRef.current = { root, groups: res.animationGroups };
  };

  // --------------------------------------------------------------- ④ ボクセル化
  const buildVoxel = async (p: SkinParams) => {
    const scene = sceneRef.current;
    const tris = trisRef.current;
    if (!scene || !tris) return;
    setStatus({ kind: 'busy', text: 'ボクセル化中…' });
    disposeVoxel();
    try {
      const vf = await createVoxelFighter(scene, {
        triangles: tris,
        modelGlbPath: MODEL_GLB_PATH,
        preloadedAnimations: preRef.current ?? undefined,
        animGlbPaths: preRef.current ? undefined : PREVIEW_ANIM,
        baseUrl: ASSET_BASE,
        fitPose: p.fitPose,
        yawDeg: p.yawDeg,
        scale: p.scale,
        offsetY: p.offsetY,
        resolution: p.resolution,
        markers: markersRef.current ?? undefined,
      });
      vfRef.current = vf;
      // 手足が大きく動く歩きを優先再生 (差が見えやすい)
      const playClip = (rig: VoxelFighter): void => {
        const clips = [...rig.rig.clips.values()];
        const pick = clips.find((g) => /walkfwd/i.test(g.name))
          ?? clips.find((g) => /walk|fwd|forward|run/i.test(g.name))
          ?? clips.find((g) => /idle/i.test(g.name))
          ?? clips[0];
        if (pick) pick.start(true);
      };

      // 比較表示: 元モデル(リグ付き) | マーカー有り voxel | マーカー無し voxel を並べる。
      // 「元モデルのモーション」と「voxel の動き」を直接見比べられるようにする。
      const charH = 1.7; // 元モデルのフィット身長 (voxel とおおよそ同じ)
      if (markersRef.current) {
        const vfNo = await createVoxelFighter(scene, {
          triangles: tris, modelGlbPath: MODEL_GLB_PATH,
          preloadedAnimations: preRef.current ?? undefined,
          animGlbPaths: preRef.current ? undefined : PREVIEW_ANIM,
          baseUrl: ASSET_BASE,
          fitPose: p.fitPose, yawDeg: p.yawDeg, scale: p.scale,
          offsetY: p.offsetY, resolution: p.resolution,
          markers: undefined, // 比較: マーカー無し
        });
        vf2Ref.current = vfNo;
        vf.rig.root.position.x = -0.3;        // 中 = マーカー有り
        vfNo.rig.root.position.x = 0.9;        // 右 = マーカー無し
        vf.rig.root.computeWorldMatrix(true);
        vfNo.rig.root.computeWorldMatrix(true);
        playClip(vf);
        playClip(vfNo);
        await loadOriginalModel(charH, -1.6);  // 左 = 元モデル(リグ付き)
        frameCamera(0.95, 5.2);
        // eslint-disable-next-line no-console
        console.log('[skinPreview] 比較: 左=元モデル / 中=マーカー有り / 右=マーカー無し');
      } else {
        vf.resetPose();
        vf.rig.root.position.x = 0.6;          // 右 = voxel
        vf.rig.root.computeWorldMatrix(true);
        playClip(vf);
        await loadOriginalModel(charH, -0.9);  // 左 = 元モデル
        frameCamera(0.95, 4.4);
      }
      setStatus({ kind: 'ready', voxels: vf.stats.voxels });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** 既存スキンを再編集として読み込む (voxelize 段階から開始) */
  const loadInitialSkin = (sk: CharacterSkin) => {
    trisRef.current = sk.triangles;
    setFileName(sk.fileName);
    setTriCount(triangleCount(sk.triangles));
    if (sk.markers) { markersRef.current = sk.markers; setHasMarkers(true); }
    const p: SkinParams = {
      fitPose: sk.fitPose, yawDeg: sk.yawDeg, scale: sk.scale,
      offsetY: sk.offsetY, resolution: sk.resolution,
    };
    setParams(p);
    setStage('voxelize');
    void buildVoxel(p);
  };

  // --------------------------------------------------------------- ナビゲーション
  // goReview/restart はマーカーをクリア (モデル/フィットが変わるため)。
  // goVoxelize は markersRef を保持して確定に使う。
  const clearMarkers = () => {
    setMarkerMode(false);
    markersRef.current = null;
    landmarksRef.current = {};
    setHasMarkers(false);
  };
  const goReview = () => { clearMarkers(); disposeSkeleton(); disposeVoxel(); disposeDisplay(); setStatus({ kind: 'idle' }); setStage('review'); };
  const goAlign = () => { setMarkerMode(false); disposeVoxel(); disposeDisplay(); setStatus({ kind: 'idle' }); setStage('align'); };
  const goVoxelize = () => { setMarkerMode(false); disposeSkeleton(); disposeDisplay(); setStage('voxelize'); void buildVoxel(params); };
  const restart = () => {
    clearMarkers();
    disposeAllStageObjects();
    trisRef.current = null;
    setFileName(null);
    setTriCount(0);
    setParams(DEFAULT_PARAMS);
    setStatus({ kind: 'idle' });
    setStage('select');
  };

  // --------------------------------------------------------------- 適用
  /** 現在の状態から CharacterSkin を組む */
  const buildCharacterSkin = (): CharacterSkin | null => {
    if (!trisRef.current) return null;
    return {
      triangles: trisRef.current,
      markers: markersRef.current ?? undefined,
      fitPose: params.fitPose,
      yawDeg: params.yawDeg,
      scale: params.scale,
      offsetY: params.offsetY,
      resolution: params.resolution,
      fileName: fileName ?? 'skin',
    };
  };

  const apply = () => {
    if (!trisRef.current) return;
    // マイキャラクターモード: スキンを親へ渡す
    if (onApply) {
      const sk = buildCharacterSkin();
      if (sk) onApply(sk);
      return;
    }
    // 旧: スタイルへ適用 (skinStore)
    setSkin(selStyle, {
      triangles: trisRef.current,
      fileName: fileName ?? 'skin',
      fitPose: params.fitPose,
      yawDeg: params.yawDeg,
      scale: params.scale,
      offsetY: params.offsetY,
      resolution: params.resolution,
      markers: markersRef.current ?? undefined,
    });
    setAppliedTo(FIGHT_STYLES.filter((s) => hasSkin(s)));
  };
  const removeSkin = (style: FightStyle) => {
    clearSkin(style);
    setAppliedTo(FIGHT_STYLES.filter((s) => hasSkin(s)));
  };

  // --------------------------------------------------------------- スライダー
  const num = (
    label: string, key: 'yawDeg' | 'scale' | 'offsetY' | 'resolution',
    min: number, max: number, step: number,
  ) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: '#9fb0c8', width: 64 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={params[key]}
        onChange={(e) => setParams((p) => ({ ...p, [key]: parseFloat(e.target.value) }))}
        style={{ flex: 1 }}
      />
      <span style={{ fontSize: 11, color: '#e8eef8', width: 44, textAlign: 'right' }}>
        {key === 'scale' ? params.scale.toFixed(2) : key === 'offsetY' ? params.offsetY.toFixed(2) : params[key]}
      </span>
    </div>
  );

  const btn = (label: string, onClick: () => void, primary = false, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 13, fontWeight: 800, padding: '9px 20px', borderRadius: 6,
        border: primary ? 'none' : '1px solid rgba(255,255,255,0.2)',
        cursor: disabled ? 'default' : 'pointer',
        background: disabled ? 'rgba(255,255,255,0.1)' : primary ? '#ffd45a' : 'rgba(255,255,255,0.08)',
        color: disabled ? '#7b8798' : primary ? '#0b0d12' : '#e8eef8',
      }}
    >{label}</button>
  );

  // --------------------------------------------------------------- render
  const stageIdx = STAGE_LABELS.findIndex((s) => s.id === stage);

  return (
    <div style={{ padding: '20px 32px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      {/* ステップインジケータ */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        {STAGE_LABELS.map((s, i) => {
          const done = i < stageIdx;
          const active = i === stageIdx;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 700,
                background: active ? '#ffd45a' : done ? 'rgba(122,209,122,0.18)' : 'rgba(255,255,255,0.06)',
                color: active ? '#0b0d12' : done ? '#7ad17a' : '#9fb0c8',
                border: active ? 'none' : '1px solid rgba(255,255,255,0.12)',
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11,
                  background: active ? 'rgba(0,0,0,0.25)' : done ? '#7ad17a' : 'rgba(255,255,255,0.12)',
                  color: active ? '#0b0d12' : done ? '#0b0d12' : '#c8d4e8',
                }}>{done ? '✓' : s.n}</span>
                {s.label}
              </div>
              {i < STAGE_LABELS.length - 1 && (
                <span style={{ color: '#3a4658', fontSize: 12 }}>›</span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* 左: ステージ別操作パネル */}
        <div style={{ width: 340, flexShrink: 0 }}>
          {stage === 'select' && (
            <div>
              <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 0, lineHeight: 1.7 }}>
                GLB / FBX を取り込み、形を確認してから FAP スケルトンに合わせてボクセル化します。
                <b style={{ color: '#c8d4e8' }}>直立または T ポーズの静止モデル</b>を推奨します。
              </p>
              <label style={{
                display: 'inline-block', fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 6,
                background: '#ffd45a', color: '#0b0d12', cursor: 'pointer',
              }}>
                ファイルを選択 (.glb / .fbx)
                <input
                  type="file" accept=".glb,.gltf,.fbx" style={{ display: 'none' }}
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
              </label>
            </div>
          )}

          {stage === 'review' && (
            <div>
              <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 0, lineHeight: 1.7 }}>
                取り込んだ <b style={{ color: '#c8d4e8' }}>生の 3D データ</b>です。
                正しいモデル・破損が無いことを確認してください。問題なければ次へ。
              </p>
              {fileName && (
                <div style={{ fontSize: 11, color: '#c8d4e8', marginBottom: 12 }}>
                  {fileName} ・ {triCount.toLocaleString()} 三角形
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                {btn('やり直す', restart)}
                {btn('OK → 骨を合わせる', goAlign, true)}
              </div>
            </div>
          )}

          {stage === 'align' && !markerMode && (
            <div>
              <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 0, lineHeight: 1.7 }}>
                <span style={{ color: '#5ad1ff' }}>水色の線</span>が現行モーションモデルのボーンです。
                まず生モデル (半透明) を向き・大きさ・上下でボーンへ<b style={{ color: '#c8d4e8' }}>大まかに</b>重ね、
                ポーズが違う場合は下の「関節を合わせる」で関節ごとに合わせます。
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#9fb0c8', width: 64 }}>構え</span>
                {(['none', 'tpose'] as const).map((fp) => (
                  <button
                    key={fp}
                    onClick={() => setParams((p) => ({ ...p, fitPose: fp }))}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: params.fitPose === fp ? '#5aa2ff' : 'rgba(255,255,255,0.08)',
                      color: params.fitPose === fp ? '#0b0d12' : '#c8d4e8',
                    }}
                  >{fp === 'none' ? '構えそのまま' : 'Tポーズ'}</button>
                ))}
              </div>
              {num('向き (度)', 'yawDeg', -180, 180, 90)}
              {num('大きさ', 'scale', 0.5, 1.8, 0.05)}
              {num('上下', 'offsetY', -0.5, 0.5, 0.02)}

              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#c8d4e8', marginBottom: 4 }}>
                  関節を合わせる (Mixamo 式)
                </div>
                <p style={{ fontSize: 11, color: '#9fb0c8', margin: '0 0 8px', lineHeight: 1.6 }}>
                  ポーズの違うモデルはこちら。正面でマーカーを実際の関節へドラッグすると、
                  ゲーム骨をその位置へ合わせます{hasMarkers ? ' (調整済み)' : ''}。
                </p>
                {btn(hasMarkers ? '関節を再調整する' : '関節を合わせる', () => setMarkerMode(true),
                  false, status.kind === 'busy')}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                {btn('戻る', goReview)}
                {btn('ボクセル化する', goVoxelize, true)}
              </div>
            </div>
          )}

          {stage === 'align' && markerMode && (
            <div>
              <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 0, lineHeight: 1.7 }}>
                <b style={{ color: '#c8d4e8' }}>マーカー球を掴んでモデルの関節をなぞる</b>と、
                その部位の中心に吸い付きます (あご / 肘手首 / 股下 / 膝 / 足首)。
                奥行きは自動。視点を回しながら合わせられます。
              </p>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#c8d4e8', marginTop: 4 }}>
                <input type="checkbox" checked={symmetry} onChange={(e) => setSymmetry(e.target.checked)} />
                左右対称 (片側を動かすと反対側もミラー)
              </label>

              <div style={{ fontSize: 11, color: '#9fb0c8', marginTop: 10, lineHeight: 1.7 }}>
                <span style={{ color: '#ff9030' }}>● 橙</span>=中央(あご/股下) /
                <span style={{ color: '#4dff72' }}> ● 緑</span>=左 /
                <span style={{ color: '#ff6688' }}> ● 桃</span>=右
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                {btn('リセット', resetMarkers)}
                {btn('完了', () => setMarkerMode(false), true)}
              </div>
            </div>
          )}

          {stage === 'voxelize' && (
            <div>
              <p style={{ fontSize: 12, color: '#9fb0c8', marginTop: 0, lineHeight: 1.7 }}>
                <b style={{ color: '#7ad17a' }}>左=元モデル(リグ付き)</b> /
                <b style={{ color: '#5ad1ff' }}> 中=マーカー有り voxel</b> /
                <b style={{ color: '#ff9a6a' }}> 右=マーカー無し voxel</b> を並べて再生中です
                (マーカー未設定なら 左=元モデル / 右=voxel)。
                元モデルの動きと voxel の動きを見比べてください。
              </p>
              {num('解像度', 'resolution', 24, 96, 4)}
              <div style={{ marginTop: 8 }}>
                {btn('再ボクセル化', () => void buildVoxel(params), false, status.kind === 'busy')}
              </div>

              {onApply ? (
                /* マイキャラクターモード: スキンを確定して親へ渡す */
                <button
                  onClick={apply}
                  disabled={status.kind !== 'ready'}
                  style={{
                    marginTop: 16, fontSize: 14, fontWeight: 800, padding: '10px 26px', borderRadius: 6,
                    border: 'none', cursor: status.kind === 'ready' ? 'pointer' : 'default',
                    background: status.kind === 'ready' ? '#7ad17a' : 'rgba(255,255,255,0.12)',
                    color: status.kind === 'ready' ? '#0b0d12' : '#7b8798',
                  }}
                >{applyLabel ?? 'このスキンを使う'}</button>
              ) : (
                <>
                  <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>適用するキャラ</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {FIGHT_STYLES.map((s) => (
                        <button
                          key={s}
                          onClick={() => setSelStyle(s)}
                          style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                            border: selStyle === s ? '2px solid #ffd45a' : '1px solid rgba(255,255,255,0.2)',
                            background: 'rgba(255,255,255,0.05)', color: '#e8eef8',
                          }}
                        >{STYLE_LABELS[s]}{hasSkin(s) ? ' ●' : ''}</button>
                      ))}
                    </div>
                    <button
                      onClick={apply}
                      disabled={status.kind !== 'ready'}
                      style={{
                        marginTop: 12, fontSize: 13, fontWeight: 800, padding: '9px 22px', borderRadius: 6,
                        border: 'none', cursor: status.kind === 'ready' ? 'pointer' : 'default',
                        background: status.kind === 'ready' ? '#7ad17a' : 'rgba(255,255,255,0.12)',
                        color: status.kind === 'ready' ? '#0b0d12' : '#7b8798',
                      }}
                    >{STYLE_LABELS[selStyle]} に適用</button>
                  </div>

                  {appliedTo.length > 0 && (
                    <div style={{ marginTop: 16, fontSize: 11, color: '#9fb0c8' }}>
                      <div style={{ marginBottom: 4 }}>スキン適用中 (対戦で反映):</div>
                      {appliedTo.map((s) => (
                        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                          <span style={{ color: '#7ad17a' }}>● {STYLE_LABELS[s]}</span>
                          <button
                            onClick={() => removeSkin(s)}
                            style={{
                              fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                              border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#9fb0c8',
                            }}
                          >解除</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                {btn('戻る (骨合わせ)', goAlign)}
                {btn('別のファイル', restart)}
              </div>
            </div>
          )}

          {/* ステータス */}
          <div style={{ marginTop: 14, fontSize: 11, minHeight: 16,
            color: status.kind === 'error' ? '#ff8c8c' : status.kind === 'ready' ? '#7ad17a' : '#c8d4e8' }}>
            {status.kind === 'busy' && status.text}
            {status.kind === 'ready' && `ボクセル化完了 (${status.voxels.toLocaleString()} voxel)`}
            {status.kind === 'error' && `エラー: ${status.text}`}
          </div>
        </div>

        {/* 右: プレビュー */}
        <div style={{ flex: 1, minWidth: 360 }}>
          <canvas
            ref={canvasRef}
            style={{
              width: '100%', height: 460, display: 'block', borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.12)', background: '#0b0e15', touchAction: 'none',
            }}
          />
          <div style={{ fontSize: 10, color: '#7b8798', marginTop: 6 }}>
            {markerMode
              ? 'マーカー球を掴んでモデルの関節をなぞると吸い付く。背景ドラッグで視点回転 / ホイールでズーム。'
              : 'ドラッグで回転 / ホイールでズーム。'}
            {stage === 'align' && !markerMode && ' 水色=ボーン / 黄=関節。生モデルを重ねます。'}
          </div>
        </div>
      </div>
    </div>
  );
}
