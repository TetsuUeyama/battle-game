'use client';

/**
 * MotionConverter 検証ページ
 *
 * 左: Babylon.js GLBローダーで直接読み込んだモデル (自動座標変換)
 * 右: MotionConverterで変換したbone-data + motion.jsonの骨格表示
 *
 * 両者が同じ姿勢・方向になっていればMotionConverterの変換が正しい。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh,
  TransformNode, Quaternion, SceneLoader, AbstractMesh, Skeleton,
  Bone,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {
  convertBoneData, convertMotionData, extractIKTargets,
  detectRestPose, convertPositionRHtoLH,
  type RawBoneData, type RawMotionData, type ConvertedBoneData,
  type ConvertedMotionData, type IKMotionData, type Vec3 as MCVec3,
} from '@/lib/motion-converter';

const BONE_DATA_URL = '/api/game-assets/characters/mixamo-ybot/bone-data.json';
const GLB_URL = '/api/game-assets/characters/mixamo-ybot/ybot.glb';

const JOINT_SIZE = 0.018;
const IK_MARKER_SIZE = 0.03;

const AVAILABLE_MOTIONS = [
  'Idle', 'Jump', 'Hip Hop Dancing', 'Mma Kick',
  'Roundhouse Kick', 'Martelo 3', 'Snake Hip Hop Dance',
];

function toV3(v: MCVec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

export default function MotionTestPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Loading...');
  const [selectedMotion, setSelectedMotion] = useState('Idle');
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showGlb, setShowGlb] = useState(false);
  const [showConverter, setShowConverter] = useState(true);
  const [showIK, setShowIK] = useState(true);

  const stateRef = useRef<{
    scene: Scene;
    // GLB側
    glbRoot: TransformNode | null;
    glbSkeleton: Skeleton | null;
    glbBoneNodes: Map<string, TransformNode>;
    glbJoints: Mesh[];
    glbLines: Mesh[];
    glbGroup: TransformNode;
    // Converter側
    cvtGroup: TransformNode;
    cvtNodes: Map<string, Mesh>;
    cvtLines: Mesh[];
    ikMarkers: Map<string, Mesh>;
    // データ
    motionData: ConvertedMotionData | null;
    ikData: IKMotionData | null;
    convertedBoneData: ConvertedBoneData | null;
    targetHipsHeight: number;
    // 再生
    frameRef: { current: number; playing: boolean };
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.08, 0.08, 0.12, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3, 4.5, new Vector3(0, 0.8, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 15;
    camera.wheelPrecision = 30;

    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
    new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.7;

    // 地面
    const ground = MeshBuilder.CreateGround('ground', { width: 8, height: 8 }, scene);
    const gMat = new StandardMaterial('gMat', scene);
    gMat.diffuseColor = new Color3(0.25, 0.25, 0.22);
    ground.material = gMat;

    // 原点の軸表示
    const axisLen = 0.4;
    MeshBuilder.CreateLines('x', { points: [Vector3.Zero(), new Vector3(axisLen, 0, 0)] }, scene).color = new Color3(1, 0, 0);
    MeshBuilder.CreateLines('y', { points: [Vector3.Zero(), new Vector3(0, axisLen, 0)] }, scene).color = new Color3(0, 1, 0);
    const zLine = MeshBuilder.CreateLines('z', { points: [Vector3.Zero(), new Vector3(0, 0, axisLen)] }, scene);
    zLine.color = new Color3(0, 0.5, 1);

    // +Z方向ラベル (前方)
    MeshBuilder.CreateLines('fwd', {
      points: [new Vector3(0, 0.01, 0.5), new Vector3(0, 0.01, 0.8),
               new Vector3(-0.05, 0.01, 0.72), new Vector3(0, 0.01, 0.8), new Vector3(0.05, 0.01, 0.72)],
    }, scene).color = new Color3(0, 0.5, 1);

    // 左: GLBローダー表示
    const glbGroup = new TransformNode('glb_group', scene);
    glbGroup.position.x = -0.7;

    // 右: MotionConverter表示
    const cvtGroup = new TransformNode('cvt_group', scene);
    cvtGroup.position.x = 0.7;

    // IKマーカー
    const ikMarkers = new Map<string, Mesh>();
    const ikMat = new StandardMaterial('ikMat', scene);
    ikMat.diffuseColor = new Color3(1, 0.2, 0.8);
    ikMat.alpha = 0.8;
    const hipsMat = new StandardMaterial('hipsMat', scene);
    hipsMat.diffuseColor = new Color3(1, 1, 0);
    hipsMat.alpha = 0.7;
    for (const name of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'hips']) {
      const m = MeshBuilder.CreateSphere(`ik_${name}`, { diameter: IK_MARKER_SIZE }, scene);
      m.material = name === 'hips' ? hipsMat : ikMat;
      m.parent = cvtGroup;
      ikMarkers.set(name, m);
    }

    const st = {
      scene,
      glbRoot: null as TransformNode | null,
      glbSkeleton: null as Skeleton | null,
      glbBoneNodes: new Map<string, TransformNode>(),
      glbJoints: [] as Mesh[],
      glbLines: [] as Mesh[],
      glbGroup,
      cvtGroup,
      cvtNodes: new Map<string, Mesh>(),
      cvtLines: [] as Mesh[],
      ikMarkers,
      motionData: null as ConvertedMotionData | null,
      ikData: null as IKMotionData | null,
      convertedBoneData: null as ConvertedBoneData | null,
      targetHipsHeight: 0,
      frameRef: { current: 0, playing: false },
    };
    stateRef.current = st;

    (async () => {
      try {
        // --- GLBロード ---
        setStatus('Loading GLB...');
        const result = await SceneLoader.ImportMeshAsync('', GLB_URL, '', scene);
        const meshes = result.meshes;
        const skeletons = result.skeletons;

        // GLBのルートノードをグループに入れる
        const glbRoot = meshes[0]?.parent as TransformNode ?? meshes[0];
        if (glbRoot) {
          glbRoot.parent = glbGroup;
          st.glbRoot = glbRoot;
        }

        // メッシュを半透明ワイヤーフレームに
        for (const mesh of meshes) {
          if (mesh instanceof Mesh) {
            mesh.visibility = 0.15;
          }
        }

        // GLBのスケルトンからボーン位置を球で表示
        if (skeletons.length > 0) {
          st.glbSkeleton = skeletons[0];
          buildGlbBoneVisuals(scene, st as typeof st & { glbSkeleton: Skeleton });
        }

        // --- bone-data.json ロード & 変換 ---
        setStatus('Loading bone-data...');
        const boneRes = await fetch(BONE_DATA_URL);
        const rawBoneData: RawBoneData = await boneRes.json();

        const pose = detectRestPose(rawBoneData);
        const converted = convertBoneData(rawBoneData, 'mixamo');
        st.convertedBoneData = converted;

        // キャラクターのHips高さ (メートル) を取得
        const hipsEntry = converted.bones.find(b => b.name === 'mixamorig:Hips');
        st.targetHipsHeight = hipsEntry ? hipsEntry.worldPosition.y : 1.0;

        // Converter側の骨格表示
        buildConverterSkeleton(scene, st, converted);

        setStatus(`GLB + Converter loaded. Rest pose: ${pose}. Select motion to test.`);
      } catch (e) {
        setStatus(`Error: ${e}`);
      }
    })();

    // レンダーループ
    let lastTime = 0;
    let accumulator = 0;
    engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = lastTime > 0 ? (now - lastTime) / 1000 : 0;
      lastTime = now;

      if (st.frameRef.playing && st.motionData && st.ikData) {
        accumulator += dt;
        const spf = 1 / st.motionData.fps;
        while (accumulator >= spf) {
          accumulator -= spf;
          st.frameRef.current = (st.frameRef.current + 1) % st.motionData.frameCount;
        }
        applyMotionFrame(st, st.frameRef.current);
        setCurrentFrame(st.frameRef.current);
      }

      // GLBのボーン球を毎フレーム更新 (アニメーション追従)
      if (st.glbSkeleton) {
        updateGlbBoneVisuals(st as typeof st & { glbSkeleton: Skeleton });
      }

      scene.render();
    });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
      stateRef.current = null;
    };
  }, []);

  // 表示切替
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    st.glbGroup.setEnabled(showGlb);
    st.cvtGroup.setEnabled(showConverter || showIK);
    for (const m of st.ikMarkers.values()) m.isVisible = showIK;
  }, [showGlb, showConverter, showIK]);

  useEffect(() => {
    if (stateRef.current) stateRef.current.frameRef.playing = playing;
  }, [playing]);

  const onMotionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    setSelectedMotion(name);
    setPlaying(false);
    const st = stateRef.current;
    if (!st) return;

    setStatus(`Loading ${name}...`);
    try {
      const res = await fetch(`/api/game-assets/motion/${name}.motion.json`);
      if (!res.ok) throw new Error(`${res.status}`);
      const rawMotion: RawMotionData = await res.json();
      const converted = convertMotionData(rawMotion, 'mixamo', st.targetHipsHeight);
      const ik = extractIKTargets(converted);

      st.motionData = converted;
      st.ikData = ik;
      st.frameRef.current = 0;
      setTotalFrames(converted.frameCount);
      setCurrentFrame(0);
      applyMotionFrame(st, 0);
      setStatus(`${name}: ${converted.frameCount} frames @ ${converted.fps}fps`);
    } catch (e) {
      setStatus(`Failed: ${e}`);
    }
  };

  const onFrameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = parseInt(e.target.value);
    setCurrentFrame(f);
    const st = stateRef.current;
    if (st) {
      st.frameRef.current = f;
      applyMotionFrame(st, f);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#14141e' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '8px 16px', background: 'rgba(0,0,0,0.85)', color: '#fff', fontSize: 13,
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 'bold' }}>MotionConverter Test</span>
        <span style={{ color: '#aaa' }}>{status}</span>
      </div>

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        padding: '10px 16px', background: 'rgba(0,0,0,0.85)', color: '#fff', fontSize: 13,
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <select value={selectedMotion} onChange={onMotionChange}
          style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '4px 8px', borderRadius: 4 }}>
          {AVAILABLE_MOTIONS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={() => setPlaying(p => !p)}
          style={{ background: playing ? '#c44' : '#4a4', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer' }}>
          {playing ? 'Stop' : 'Play'}
        </button>
        <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={currentFrame}
          onChange={onFrameChange} style={{ flex: 1, minWidth: 150 }} />
        <span style={{ minWidth: 80 }}>Frame {currentFrame}/{totalFrames}</span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showGlb} onChange={e => setShowGlb(e.target.checked)} />
          <span style={{ color: '#f88' }}>GLB Loader (left)</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showConverter} onChange={e => setShowConverter(e.target.checked)} />
          <span style={{ color: '#8f8' }}>Converter (right)</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showIK} onChange={e => setShowIK(e.target.checked)} />
          <span style={{ color: '#f8f' }}>IK targets</span>
        </label>
      </div>

      <div style={{
        position: 'absolute', top: 40, right: 10, zIndex: 10,
        padding: '8px 12px', background: 'rgba(0,0,0,0.7)', color: '#ccc', fontSize: 12,
        borderRadius: 4, lineHeight: 1.6,
      }}>
        <div style={{ color: '#48f' }}>Blue arrow = +Z (Forward in Babylon.js)</div>
        <hr style={{ border: '1px solid #444', margin: '4px 0' }} />
        <div style={{ color: '#f88' }}>Left = GLB loader (Babylon.js auto-convert)</div>
        <div style={{ color: '#8f8' }}>Right = MotionConverter output</div>
        <div style={{ color: '#f8f' }}>Pink = IK targets (hands/feet)</div>
        <div style={{ color: '#ff0' }}>Yellow = Hips</div>
        <hr style={{ border: '1px solid #444', margin: '4px 0' }} />
        <div>Both should match direction &amp; pose</div>
      </div>

      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// ─── GLB ボーン可視化 ─────────────────────────────────────

function buildGlbBoneVisuals(
  scene: Scene,
  st: { glbSkeleton: Skeleton; glbBoneNodes: Map<string, TransformNode>; glbJoints: Mesh[]; glbLines: Mesh[]; glbGroup: TransformNode },
) {
  const mat = new StandardMaterial('glbJointMat', scene);
  mat.diffuseColor = new Color3(1, 0.4, 0.3);

  const skeleton = st.glbSkeleton;
  for (const bone of skeleton.bones) {
    const sphere = MeshBuilder.CreateSphere(`glb_j_${bone.name}`, { diameter: JOINT_SIZE }, scene);
    sphere.material = mat;
    sphere.parent = st.glbGroup;
    st.glbJoints.push(sphere);
    st.glbBoneNodes.set(bone.name, sphere);
  }
}

function updateGlbBoneVisuals(
  st: { glbSkeleton: Skeleton; glbBoneNodes: Map<string, TransformNode>; glbLines: Mesh[]; glbGroup: TransformNode; scene: Scene },
) {
  const skeleton = st.glbSkeleton;

  // 各ボーンのワールド位置で球を更新
  for (const bone of skeleton.bones) {
    const node = st.glbBoneNodes.get(bone.name);
    if (!node) continue;
    const tn = bone.getTransformNode();
    if (tn) {
      tn.computeWorldMatrix(true);
      const worldPos = tn.getAbsolutePosition();
      // glbGroupのオフセットを差し引く (親がglbGroupなので自動でローカル座標になる)
      node.position.copyFrom(worldPos.subtract(st.glbGroup.getAbsolutePosition()));
    }
  }

  // ライン再描画
  for (const line of st.glbLines) line.dispose();
  st.glbLines.length = 0;

  for (const bone of skeleton.bones) {
    const parent = bone.getParent();
    if (!parent) continue;
    const childNode = st.glbBoneNodes.get(bone.name);
    const parentNode = st.glbBoneNodes.get(parent.name);
    if (!childNode || !parentNode) continue;

    const line = MeshBuilder.CreateLines(`glb_l_${bone.name}`, {
      points: [childNode.position, parentNode.position],
    }, st.scene);
    line.color = new Color3(1, 0.4, 0.3);
    line.parent = st.glbGroup;
    st.glbLines.push(line);
  }
}

// ─── Converter 骨格表示 ──────────────────────────────────

function buildConverterSkeleton(
  scene: Scene,
  st: { cvtGroup: TransformNode; cvtNodes: Map<string, Mesh>; cvtLines: Mesh[] },
  boneData: ConvertedBoneData,
) {
  const mat = new StandardMaterial('cvtMat', scene);
  mat.diffuseColor = new Color3(0.3, 1, 0.4);

  for (const bone of boneData.bones) {
    const sphere = MeshBuilder.CreateSphere(`cvt_${bone.name}`, { diameter: JOINT_SIZE }, scene);
    sphere.position.copyFrom(toV3(bone.worldPosition));
    sphere.material = mat;
    sphere.parent = st.cvtGroup;
    st.cvtNodes.set(bone.name, sphere);
  }

  // 初期ライン
  rebuildConverterLines(scene, st, boneData.bones);
}

function rebuildConverterLines(
  scene: Scene,
  st: { cvtGroup: TransformNode; cvtNodes: Map<string, Mesh>; cvtLines: Mesh[] },
  bones: ConvertedBoneData['bones'],
) {
  for (const line of st.cvtLines) line.dispose();
  st.cvtLines.length = 0;

  for (const bone of bones) {
    if (!bone.parent) continue;
    const child = st.cvtNodes.get(bone.name);
    const parent = st.cvtNodes.get(bone.parent);
    if (!child || !parent) continue;
    const line = MeshBuilder.CreateLines(`cvt_l_${bone.name}`, {
      points: [child.position, parent.position],
    }, scene);
    line.color = new Color3(0.3, 1, 0.4);
    line.parent = st.cvtGroup;
    st.cvtLines.push(line);
  }
}

// ─── モーションフレーム適用 ───────────────────────────────

function applyMotionFrame(
  st: {
    scene: Scene;
    motionData: ConvertedMotionData | null;
    ikData: IKMotionData | null;
    convertedBoneData: ConvertedBoneData | null;
    cvtNodes: Map<string, Mesh>;
    cvtLines: Mesh[];
    cvtGroup: TransformNode;
    ikMarkers: Map<string, Mesh>;
  },
  frameIndex: number,
) {
  if (!st.motionData || !st.ikData || !st.convertedBoneData) return;
  if (frameIndex < 0 || frameIndex >= st.motionData.frameCount) return;

  const frame = st.motionData.frames[frameIndex];
  const ikFrame = st.ikData.ikFrames[frameIndex];
  if (!frame || !ikFrame) return;

  // ── 各ボーンの animatedWorldPos = bindWorldPos + dp ──
  // 全52トラック付きボーンにdpがあるので直接計算。
  // 末端15ボーン(指先,目,ToeEnd等)はbindWorldPositionsに無いのでFK補完。
  const bindPos = st.motionData.bindWorldPositions;
  const hierarchy = st.motionData.hierarchy;
  const worldPos = new Map<string, Vector3>();

  // 親マップとrestPosition (ローカル, 変換済み m)
  const parentMap = new Map<string, string | null>();
  const restLocal = new Map<string, Vector3>();
  for (const h of hierarchy) {
    parentMap.set(h.name, h.parent);
    restLocal.set(h.name, toV3(h.restPosition));
  }

  // トポロジカル順序で処理
  const order: string[] = [];
  const visited = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const p = parentMap.get(name);
    if (p) visit(p);
    order.push(name);
  }
  for (const h of hierarchy) visit(h.name);

  for (const boneName of order) {
    const fb = frame[boneName];
    const bp = bindPos[boneName];

    if (bp && fb?.dp) {
      // トラック付きボーン (52個): bindWorldPos + dp
      worldPos.set(boneName, new Vector3(bp.x + fb.dp.x, bp.y + fb.dp.y, bp.z + fb.dp.z));
    } else if (bp) {
      // トラック付きだがdpなし (理論上ないが念のため)
      worldPos.set(boneName, new Vector3(bp.x, bp.y, bp.z));
    } else {
      // 末端ボーン (15個): bindWorldPositions に無い。
      // 親と祖父のbindWorldPosからボーン方向を推定し、restPositionの長さ分延長。
      const parent = parentMap.get(boneName);
      const parentPos = parent ? worldPos.get(parent) : undefined;
      if (!parentPos || !parent) continue;

      const grandParent = parentMap.get(parent);
      const parentBP = bindPos[parent];
      const grandBP = grandParent ? bindPos[grandParent] : undefined;

      if (parentBP && grandBP) {
        // 親のbind方向: grandParent → parent
        const bindDir = new Vector3(
          parentBP.x - grandBP.x,
          parentBP.y - grandBP.y,
          parentBP.z - grandBP.z,
        );
        const bindDirLen = bindDir.length();
        if (bindDirLen > 0.001) bindDir.scaleInPlace(1 / bindDirLen);

        // 親のdqでこの方向を回転
        const parentFB = frame[parent];
        if (parentFB) {
          const parentDQ = new Quaternion(parentFB.dq.x, parentFB.dq.y, parentFB.dq.z, parentFB.dq.w);
          const rotatedDir = Vector3.Zero();
          bindDir.rotateByQuaternionToRef(parentDQ, rotatedDir);
          // restPositionの長さ分だけ延長
          const rest = restLocal.get(boneName) ?? Vector3.Zero();
          const restLen = rest.length();
          worldPos.set(boneName, parentPos.add(rotatedDir.scale(restLen)));
        } else {
          const rest = restLocal.get(boneName) ?? Vector3.Zero();
          worldPos.set(boneName, parentPos.add(bindDir.scale(rest.length())));
        }
      } else {
        // fallback: 親位置をそのまま使用
        worldPos.set(boneName, parentPos.clone());
      }
    }
  }

  // cvtNodes を更新
  // hierarchyに含まれるボーン名のセット
  const motionBoneNames = new Set(hierarchy.map(h => h.name));

  for (const [fullName, node] of st.cvtNodes) {
    const shortName = fullName.replace(/^mixamorig:/, '');
    const pos = worldPos.get(shortName);
    if (pos) {
      node.position.copyFrom(pos);
      node.setEnabled(true);
    } else if (!motionBoneNames.has(shortName)) {
      // このモーションに含まれないボーン → 非表示
      node.setEnabled(false);
    }
  }

  // ラインを再構築
  for (const line of st.cvtLines) line.dispose();
  st.cvtLines.length = 0;
  for (const h of hierarchy) {
    if (!h.parent) continue;
    const cPos = worldPos.get(h.name);
    const pPos = worldPos.get(h.parent);
    if (!cPos || !pPos) continue;
    const line = MeshBuilder.CreateLines(`cvt_l_${h.name}_f`, {
      points: [cPos, pPos],
    }, st.scene);
    line.color = new Color3(0.3, 1, 0.4);
    line.parent = st.cvtGroup;
    st.cvtLines.push(line);
  }

  // IKマーカー更新
  const t = ikFrame.targets;
  st.ikMarkers.get('leftHand')?.position.copyFrom(toV3(t.leftHand));
  st.ikMarkers.get('rightHand')?.position.copyFrom(toV3(t.rightHand));
  st.ikMarkers.get('leftFoot')?.position.copyFrom(toV3(t.leftFoot));
  st.ikMarkers.get('rightFoot')?.position.copyFrom(toV3(t.rightFoot));
  st.ikMarkers.get('hips')?.position.copyFrom(toV3(ikFrame.hipsPosition));
}
