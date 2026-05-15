'use client';

/**
 * 人形モデル + モーション学習デモ
 *
 * シンプルな15ボーン人形を使って:
 *   - FK（体幹・頭）とIK（両腕両脚）の使い分け
 *   - プリセット切替・モーション再生
 *   - ポーズ修正の方法
 * を体感する。
 *
 * 実装方針（学習のため透過性重視）:
 *   本物のスケルトン階層ではなく、毎フレーム「Pose値 → 全関節のワールド位置」を
 *   計算してメッシュを直接配置する。データフローが一目で分かる。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, MeshBuilder, StandardMaterial, Mesh,
  Quaternion,
} from '@babylonjs/core';

// ========================================
// ポーズ定義
// ========================================

/**
 * Pose: 1フレームの人形の姿勢を定義する全パラメータ
 * - rootY: 腰の上下位置（ワールド）
 * - spine: 体幹の回転（FK, 度数）
 * - head: 頭の回転（FK, 度数）
 * - leftHand/rightHand: 手のIK目標位置（腰からの相対）
 * - leftFoot/rightFoot: 足のIK目標位置（腰からの相対）
 */
type SpineRot = { pitch: number; yaw: number; roll: number };

type Pose = {
  rootY: number;
  // 体幹を3分割: 腰椎→胸椎→胸上部。各関節が独立に回転し、親から子へ積み重なる
  spine1: SpineRot;  // 腰椎: 前傾の基盤
  spine2: SpineRot;  // 胸椎: 中間
  chest:  SpineRot;  // 胸椎上部: 捻りの主役（肩と連動）
  head: { pitch: number; yaw: number };
  leftHand: { x: number; y: number; z: number };
  rightHand: { x: number; y: number; z: number };
  leftFoot: { x: number; y: number; z: number };
  rightFoot: { x: number; y: number; z: number };
};

// 身体寸法（固定）
const DIM = {
  spine1Len: 0.17,     // hips → spine1（合計 0.5 ≒ 旧torsoLen）
  spine2Len: 0.17,     // spine1 → spine2
  chestLen:  0.16,     // spine2 → chest
  neckLen: 0.1,        // chest→首
  headLen: 0.15,       // 首→頭頂
  shoulderHalfW: 0.12, // 胸の中心→肩の距離
  hipHalfW: 0.08,      // 腰の中心→股関節の距離
  upperArm: 0.28,
  foreArm: 0.26,
  upperLeg: 0.38,
  lowerLeg: 0.38,
};

const Z: SpineRot = { pitch: 0, yaw: 0, roll: 0 };

// ========================================
// プリセット
// ========================================

const tPose: Pose = {
  rootY: 0,
  spine1: { ...Z }, spine2: { ...Z }, chest: { ...Z },
  head: { pitch: 0, yaw: 0 },
  leftHand: { x: -0.7, y: 0.5, z: 0 },
  rightHand: { x: 0.7, y: 0.5, z: 0 },
  leftFoot: { x: -0.12, y: -0.76, z: 0 },
  rightFoot: { x: 0.12, y: -0.76, z: 0 },
};

const guardPose: Pose = {
  rootY: -0.05,
  // 前傾8°を 3:3:2 で配分（腰が主役）
  spine1: { pitch: 3, yaw: 0, roll: 0 },
  spine2: { pitch: 3, yaw: 0, roll: 0 },
  chest:  { pitch: 2, yaw: 0, roll: 0 },
  head: { pitch: 5, yaw: 0 },
  leftHand: { x: -0.15, y: 0.2, z: 0.35 },
  rightHand: { x: 0.18, y: 0.15, z: 0.3 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};

// 縦振り攻撃: 3キーフレーム（start → windup → strike）
const swingStart: Pose = { ...guardPose };

// 振りかぶり: 腰はやや反らし、胸を強く捻って右肩を引く
const swingWindup: Pose = {
  rootY: -0.02,
  spine1: { pitch: -3, yaw: 0,  roll: 0 },   // 腰は少し反る
  spine2: { pitch: -3, yaw: 20, roll: 0 },   // 胸椎で捻り始め
  chest:  { pitch: -4, yaw: 40, roll: 0 },   // 上胸で大きく捻る（右肩を後ろへ）
  head: { pitch: -5, yaw: -10 },
  leftHand: { x: -0.1, y: 0.3, z: 0.2 },
  rightHand: { x: 0.2, y: 0.3, z: -0.15 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};

// 打撃: 前傾して胸を逆方向に捻り戻す（腰→胸の連鎖で鞭のような動き）
const swingStrike: Pose = {
  rootY: -0.08,
  spine1: { pitch: 8,  yaw: -8,  roll: 0 },   // 腰は前傾主体
  spine2: { pitch: 7,  yaw: -12, roll: 0 },   // 胸椎で捻り戻し
  chest:  { pitch: 5,  yaw: -20, roll: 0 },   // 上胸で強い捻り戻し（右肩を前へ）
  head: { pitch: 15, yaw: 5 },
  leftHand: { x: -0.18, y: 0.5, z: 0.2 },
  rightHand: { x: 0.15, y: 0.3, z: 0.7 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.05 },
  rightFoot: { x: 0.2, y: -0.8, z: 0.1 },
};

const crouchPose: Pose = {
  rootY: -0.25,
  // しゃがみの前傾15°は腰主役で配分
  spine1: { pitch: 8, yaw: 0, roll: 0 },
  spine2: { pitch: 5, yaw: 0, roll: 0 },
  chest:  { pitch: 2, yaw: 0, roll: 0 },
  head: { pitch: 10, yaw: 0 },
  leftHand: { x: -0.25, y: 0.3, z: 0.1 },
  rightHand: { x: 0.25, y: 0.3, z: 0.1 },
  leftFoot: { x: -0.2, y: -0.55, z: 0.05 },
  rightFoot: { x: 0.2, y: -0.55, z: 0.05 },
};

// ========================================
// ポーズ補間
// ========================================

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function lerpRot(a: SpineRot, b: SpineRot, t: number): SpineRot {
  return {
    pitch: lerp(a.pitch, b.pitch, t),
    yaw: lerp(a.yaw, b.yaw, t),
    roll: lerp(a.roll, b.roll, t),
  };
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    rootY: lerp(a.rootY, b.rootY, t),
    spine1: lerpRot(a.spine1, b.spine1, t),
    spine2: lerpRot(a.spine2, b.spine2, t),
    chest: lerpRot(a.chest, b.chest, t),
    head: {
      pitch: lerp(a.head.pitch, b.head.pitch, t),
      yaw: lerp(a.head.yaw, b.head.yaw, t),
    },
    leftHand: {
      x: lerp(a.leftHand.x, b.leftHand.x, t),
      y: lerp(a.leftHand.y, b.leftHand.y, t),
      z: lerp(a.leftHand.z, b.leftHand.z, t),
    },
    rightHand: {
      x: lerp(a.rightHand.x, b.rightHand.x, t),
      y: lerp(a.rightHand.y, b.rightHand.y, t),
      z: lerp(a.rightHand.z, b.rightHand.z, t),
    },
    leftFoot: {
      x: lerp(a.leftFoot.x, b.leftFoot.x, t),
      y: lerp(a.leftFoot.y, b.leftFoot.y, t),
      z: lerp(a.leftFoot.z, b.leftFoot.z, t),
    },
    rightFoot: {
      x: lerp(a.rightFoot.x, b.rightFoot.x, t),
      y: lerp(a.rightFoot.y, b.rightFoot.y, t),
      z: lerp(a.rightFoot.z, b.rightFoot.z, t),
    },
  };
}

// 縦振りモーション（3キーフレーム）を progress 0→1 で補間
function getSwingPose(progress: number): Pose {
  const windupRatio = 0.5;
  if (progress < windupRatio) {
    // start → windup (ease-in)
    const t = progress / windupRatio;
    const eased = t * t;
    return lerpPose(swingStart, swingWindup, eased);
  } else {
    // windup → strike (ease-out)
    const t = (progress - windupRatio) / (1 - windupRatio);
    const eased = 1 - (1 - t) * (1 - t);
    return lerpPose(swingWindup, swingStrike, eased);
  }
}

// ========================================
// 2ボーンIK（前回デモと同じロジック）
// ========================================

/**
 * 2ボーンIKを解く
 * @param root 根本の位置（肩 or 股関節）
 * @param target 末端の目標位置（手 or 足）
 * @param pole ポールヒント位置
 * @param L1 上腕長 or 上腿長
 * @param L2 前腕長 or 下腿長
 * @returns 中間関節（肘 or 膝）と末端のワールド位置
 */
function solveIK(
  root: Vector3, target: Vector3, pole: Vector3, L1: number, L2: number,
): { mid: Vector3; end: Vector3 } {
  const toTarget = target.subtract(root);
  const d = toTarget.length();
  const maxReach = L1 + L2;

  if (d >= maxReach) {
    // 届かない → 直線に伸ばす
    const dir = toTarget.normalize();
    return {
      mid: root.add(dir.scale(L1)),
      end: root.add(dir.scale(maxReach)),
    };
  }

  // 余弦定理で肩→中間関節 のなす角 α
  const cosAlpha = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));

  const dir = toTarget.normalize();

  // ポールから目標線への垂線方向
  const poleVec = pole.subtract(root);
  const poleOnLine = dir.scale(Vector3.Dot(poleVec, dir));
  let bendDir = poleVec.subtract(poleOnLine);
  if (bendDir.lengthSquared() < 1e-6) {
    bendDir = new Vector3(0, -1, 0);
  }
  bendDir = bendDir.normalize();

  // 中間関節の位置
  const mid = root.add(
    dir.scale(L1 * Math.cos(alpha)).add(bendDir.scale(L1 * Math.sin(alpha))),
  );
  return { mid, end: target.clone() };
}

// ========================================
// ポーズ → 全関節のワールド位置
// ========================================

type Skeleton = {
  hips: Vector3;
  spine1: Vector3;
  spine2: Vector3;
  chest: Vector3;
  neck: Vector3;
  head: Vector3;
  leftShoulder: Vector3;
  leftElbow: Vector3;
  leftHand: Vector3;
  rightShoulder: Vector3;
  rightElbow: Vector3;
  rightHand: Vector3;
  leftHip: Vector3;
  leftKnee: Vector3;
  leftFoot: Vector3;
  rightHip: Vector3;
  rightKnee: Vector3;
  rightFoot: Vector3;
};

function rotFrom(r: SpineRot): Quaternion {
  const d2r = Math.PI / 180;
  return Quaternion.RotationYawPitchRoll(r.yaw * d2r, r.pitch * d2r, r.roll * d2r);
}

function poseToSkeleton(pose: Pose): Skeleton {
  const deg2rad = (d: number) => d * Math.PI / 180;

  // 腰（Root）位置
  const hips = new Vector3(0, pose.rootY, 0);

  // === Spine階層: 親から子へ回転を積み重ねる ===
  // rot1 = spine1のローカル回転
  // rot2 = rot1 × spine2のローカル回転（spine1の回転を引き継いだ上で、さらに自分の回転）
  // rotC = rot2 × chestのローカル回転
  // これを「親の回転が子に伝搬する」という。
  const rot1 = rotFrom(pose.spine1);
  const rot2 = rot1.multiply(rotFrom(pose.spine2));
  const rotC = rot2.multiply(rotFrom(pose.chest));

  // 各関節の位置: 親の位置に、親の累積回転を適用した骨ベクトルを足す
  const spine1 = hips.add(applyQuat(rot1, new Vector3(0, DIM.spine1Len, 0)));
  const spine2 = spine1.add(applyQuat(rot2, new Vector3(0, DIM.spine2Len, 0)));
  const chest  = spine2.add(applyQuat(rotC, new Vector3(0, DIM.chestLen, 0)));

  // 首（chestから上、rotCで回転）
  const neck = chest.add(applyQuat(rotC, new Vector3(0, DIM.neckLen, 0)));

  // 頭（rotC × headローカル回転）
  const headLocal = Quaternion.RotationYawPitchRoll(
    deg2rad(pose.head.yaw), deg2rad(pose.head.pitch), 0,
  );
  const headRot = rotC.multiply(headLocal);
  const head = neck.add(applyQuat(headRot, new Vector3(0, DIM.headLen, 0)));

  // 肩の位置（chestに付くので rotC で回転）
  const leftShoulder = chest.add(applyQuat(rotC, new Vector3(-DIM.shoulderHalfW, 0, 0)));
  const rightShoulder = chest.add(applyQuat(rotC, new Vector3(DIM.shoulderHalfW, 0, 0)));

  // 股関節の位置（Spineとは独立、Rootに固定）
  const leftHip = hips.add(new Vector3(-DIM.hipHalfW, 0, 0));
  const rightHip = hips.add(new Vector3(DIM.hipHalfW, 0, 0));

  // 手の目標位置（腰からの相対 → ワールド）
  const lhTarget = hips.add(new Vector3(pose.leftHand.x, pose.leftHand.y, pose.leftHand.z));
  const rhTarget = hips.add(new Vector3(pose.rightHand.x, pose.rightHand.y, pose.rightHand.z));
  const lfTarget = hips.add(new Vector3(pose.leftFoot.x, pose.leftFoot.y, pose.leftFoot.z));
  const rfTarget = hips.add(new Vector3(pose.rightFoot.x, pose.rightFoot.y, pose.rightFoot.z));

  // ポールヒント（肘は後方、膝は前方）
  const armPoleL = leftShoulder.add(new Vector3(-0.2, -0.3, -0.5));
  const armPoleR = rightShoulder.add(new Vector3(0.2, -0.3, -0.5));
  const legPoleL = leftHip.add(new Vector3(-0.1, -0.2, 0.5));
  const legPoleR = rightHip.add(new Vector3(0.1, -0.2, 0.5));

  // 両腕両脚をIKで解く
  const la = solveIK(leftShoulder, lhTarget, armPoleL, DIM.upperArm, DIM.foreArm);
  const ra = solveIK(rightShoulder, rhTarget, armPoleR, DIM.upperArm, DIM.foreArm);
  const ll = solveIK(leftHip, lfTarget, legPoleL, DIM.upperLeg, DIM.lowerLeg);
  const rl = solveIK(rightHip, rfTarget, legPoleR, DIM.upperLeg, DIM.lowerLeg);

  return {
    hips, spine1, spine2, chest, neck, head,
    leftShoulder, leftElbow: la.mid, leftHand: la.end,
    rightShoulder, rightElbow: ra.mid, rightHand: ra.end,
    leftHip, leftKnee: ll.mid, leftFoot: ll.end,
    rightHip, rightKnee: rl.mid, rightFoot: rl.end,
  };
}

function applyQuat(q: Quaternion, v: Vector3): Vector3 {
  const r = new Vector3();
  v.rotateByQuaternionToRef(q, r);
  return r;
}

// ========================================
// React コンポーネント
// ========================================

type Mode = 'preset' | 'edit';
type PresetName = 'T-Pose' | 'Guard' | 'Swing' | 'Crouch';

export default function PuppetLearningPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<Mode>('preset');
  const [preset, setPreset] = useState<PresetName>('Guard');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [editPose, setEditPose] = useState<Pose>(guardPose);

  const meshesRef = useRef<{
    scene: Scene | null;
    joints: Map<string, Mesh>;
    bones: Mesh[];
    ikMarkers: Map<string, Mesh>;
  }>({ scene: null, joints: new Map(), bones: [], ikMarkers: new Map() });

  // シーン初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color3(0.1, 0.1, 0.15).toColor4();

    const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 2.3, 3.5, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 80;

    new HemisphericLight('light', new Vector3(0, 1, 0), scene);

    // 地面
    const ground = MeshBuilder.CreateGround('ground', { width: 3, height: 3, subdivisions: 20 }, scene);
    const gm = new StandardMaterial('gm', scene);
    gm.wireframe = true;
    gm.emissiveColor = new Color3(0.2, 0.2, 0.3);
    ground.material = gm;
    ground.position.y = -0.88;

    // ジョイント（球）を作成
    const joints = new Map<string, Mesh>();
    const jointDefs: { name: string; size: number; color: Color3 }[] = [
      { name: 'hips', size: 0.08, color: new Color3(1, 0.5, 0) },
      { name: 'spine1', size: 0.05, color: new Color3(1, 0.65, 0.15) },
      { name: 'spine2', size: 0.05, color: new Color3(1, 0.75, 0.25) },
      { name: 'chest', size: 0.06, color: new Color3(1, 0.8, 0.3) },
      { name: 'neck', size: 0.04, color: new Color3(0.8, 0.8, 0.8) },
      { name: 'head', size: 0.12, color: new Color3(1, 0.9, 0.7) },
      { name: 'leftShoulder', size: 0.05, color: new Color3(1, 0.3, 0.3) },
      { name: 'leftElbow', size: 0.04, color: new Color3(0.4, 1, 0.4) },
      { name: 'leftHand', size: 0.05, color: new Color3(0.3, 0.5, 1) },
      { name: 'rightShoulder', size: 0.05, color: new Color3(1, 0.3, 0.3) },
      { name: 'rightElbow', size: 0.04, color: new Color3(0.4, 1, 0.4) },
      { name: 'rightHand', size: 0.05, color: new Color3(0.3, 0.5, 1) },
      { name: 'leftHip', size: 0.05, color: new Color3(1, 0.3, 0.3) },
      { name: 'leftKnee', size: 0.04, color: new Color3(0.4, 1, 0.4) },
      { name: 'leftFoot', size: 0.05, color: new Color3(0.3, 0.5, 1) },
      { name: 'rightHip', size: 0.05, color: new Color3(1, 0.3, 0.3) },
      { name: 'rightKnee', size: 0.04, color: new Color3(0.4, 1, 0.4) },
      { name: 'rightFoot', size: 0.05, color: new Color3(0.3, 0.5, 1) },
    ];
    for (const j of jointDefs) {
      const m = MeshBuilder.CreateSphere(j.name, { diameter: j.size }, scene);
      const mat = new StandardMaterial(j.name + '_mat', scene);
      mat.emissiveColor = j.color;
      m.material = mat;
      joints.set(j.name, m);
    }

    // ボーン（シリンダー）を作成（接続数分）
    const bones: Mesh[] = [];
    for (let i = 0; i < 17; i++) {
      const b = MeshBuilder.CreateCylinder('bone' + i, { height: 1, diameter: 0.03 }, scene);
      const bm = new StandardMaterial('bonemat' + i, scene);
      bm.diffuseColor = new Color3(0.7, 0.5, 0.4);
      b.material = bm;
      bones.push(b);
    }

    // IK目標マーカー（手・足の目標位置を表示）
    const ikMarkers = new Map<string, Mesh>();
    for (const name of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot']) {
      const m = MeshBuilder.CreateSphere('ik_' + name, { diameter: 0.04 }, scene);
      const mat = new StandardMaterial('ikmat_' + name, scene);
      mat.emissiveColor = new Color3(1, 0, 1);
      mat.alpha = 0.5;
      m.material = mat;
      ikMarkers.set(name, m);
    }

    meshesRef.current = { scene, joints, bones, ikMarkers };

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      engine.dispose();
    };
  }, []);

  // 再生ループ
  useEffect(() => {
    if (!playing || mode !== 'preset' || preset !== 'Swing') return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        const np = p + dt / 1.2;  // 1.2秒で1周
        return np > 1 ? 0 : np;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode, preset]);

  // 現在のポーズを決める
  const currentPose: Pose = (() => {
    if (mode === 'edit') return editPose;
    switch (preset) {
      case 'T-Pose': return tPose;
      case 'Guard': return guardPose;
      case 'Crouch': return crouchPose;
      case 'Swing': return getSwingPose(progress);
    }
  })();

  // ポーズ変更時にメッシュ更新
  useEffect(() => {
    const { scene, joints, bones, ikMarkers } = meshesRef.current;
    if (!scene) return;

    const sk = poseToSkeleton(currentPose);

    // ジョイントを配置
    const jointMap: Record<string, Vector3> = sk;
    for (const [name, mesh] of joints) {
      mesh.position.copyFrom(jointMap[name]);
    }

    // ボーン接続
    const connections: [keyof Skeleton, keyof Skeleton][] = [
      ['hips', 'spine1'],
      ['spine1', 'spine2'],
      ['spine2', 'chest'],
      ['chest', 'neck'],
      ['neck', 'head'],
      ['chest', 'leftShoulder'],
      ['leftShoulder', 'leftElbow'],
      ['leftElbow', 'leftHand'],
      ['chest', 'rightShoulder'],
      ['rightShoulder', 'rightElbow'],
      ['rightElbow', 'rightHand'],
      ['hips', 'leftHip'],
      ['leftHip', 'leftKnee'],
      ['leftKnee', 'leftFoot'],
      ['hips', 'rightHip'],
      ['rightHip', 'rightKnee'],
      ['rightKnee', 'rightFoot'],
    ];
    connections.forEach(([a, b], i) => {
      alignCylinder(bones[i], sk[a], sk[b]);
    });

    // IK目標マーカー
    const hips = sk.hips;
    const showMarkers = mode === 'edit';
    for (const [name, m] of ikMarkers) m.setEnabled(showMarkers);
    if (showMarkers) {
      ikMarkers.get('leftHand')!.position.set(
        hips.x + currentPose.leftHand.x, hips.y + currentPose.leftHand.y, hips.z + currentPose.leftHand.z);
      ikMarkers.get('rightHand')!.position.set(
        hips.x + currentPose.rightHand.x, hips.y + currentPose.rightHand.y, hips.z + currentPose.rightHand.z);
      ikMarkers.get('leftFoot')!.position.set(
        hips.x + currentPose.leftFoot.x, hips.y + currentPose.leftFoot.y, hips.z + currentPose.leftFoot.z);
      ikMarkers.get('rightFoot')!.position.set(
        hips.x + currentPose.rightFoot.x, hips.y + currentPose.rightFoot.y, hips.z + currentPose.rightFoot.z);
    }
  }, [currentPose, mode]);

  const updateEdit = <K extends keyof Pose>(key: K, value: Pose[K]) => {
    setEditPose({ ...editPose, [key]: value });
  };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ flex: 1, outline: 'none' }} />
      <div style={{
        width: 380, padding: 16, background: '#1a1a22', color: '#eee',
        overflowY: 'auto', fontFamily: 'sans-serif', fontSize: 12,
      }}>
        <h2 style={{ marginTop: 0 }}>人形モーション学習</h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ marginRight: 12 }}>
            <input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} /> プリセット再生
          </label>
          <label>
            <input type="radio" checked={mode === 'edit'} onChange={() => setMode('edit')} /> 編集モード
          </label>
        </div>

        {mode === 'preset' && (
          <section>
            <h3>プリセット</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {(['T-Pose', 'Guard', 'Swing', 'Crouch'] as PresetName[]).map((p) => (
                <button key={p}
                  onClick={() => { setPreset(p); setProgress(0); }}
                  style={{
                    padding: '4px 10px',
                    background: preset === p ? '#4a9' : '#333',
                    color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer',
                  }}>{p}</button>
              ))}
            </div>
            {preset === 'Swing' && (
              <div>
                <button onClick={() => setPlaying(!playing)}
                  style={{ padding: '4px 12px', marginRight: 8 }}>
                  {playing ? '⏸ 停止' : '▶ 再生'}
                </button>
                <div style={{ marginTop: 8 }}>
                  <Slider label="進行度" value={progress} min={0} max={1} step={0.01}
                    onChange={(v) => { setPlaying(false); setProgress(v); }} />
                  <div style={{ fontSize: 11, color: '#aaa' }}>
                    {progress < 0.5 ? '振りかぶり (start → windup)' : '打撃 (windup → strike)'}
                  </div>
                </div>
              </div>
            )}
            <PoseDump pose={currentPose} />
          </section>
        )}

        {mode === 'edit' && (
          <section>
            <h3>編集（FK部分）</h3>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>体幹と頭はFK: 角度で指定</div>
            <Slider label="Root Y (腰の高さ)" value={editPose.rootY} min={-0.4} max={0.2} step={0.01}
              onChange={(v) => updateEdit('rootY', v)} />
            <SpineEdit label="Spine1 (腰椎)" value={editPose.spine1}
              onChange={(v) => updateEdit('spine1', v)}
              pitchRange={[-30, 30]} yawRange={[-30, 30]} rollRange={[-25, 25]} />
            <SpineEdit label="Spine2 (胸椎)" value={editPose.spine2}
              onChange={(v) => updateEdit('spine2', v)}
              pitchRange={[-25, 25]} yawRange={[-40, 40]} rollRange={[-25, 25]} />
            <SpineEdit label="Chest (胸椎上・捻り主役)" value={editPose.chest}
              onChange={(v) => updateEdit('chest', v)}
              pitchRange={[-20, 20]} yawRange={[-50, 50]} rollRange={[-30, 30]} />
            <Slider label="Head Pitch" value={editPose.head.pitch} min={-45} max={45} step={1}
              onChange={(v) => updateEdit('head', { ...editPose.head, pitch: v })} unit="°" />
            <Slider label="Head Yaw" value={editPose.head.yaw} min={-90} max={90} step={1}
              onChange={(v) => updateEdit('head', { ...editPose.head, yaw: v })} unit="°" />

            <h3 style={{ marginTop: 16 }}>編集（IK部分）</h3>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>手足はIK: 紫マーカーの目標位置で指定（腰からの相対）</div>
            <LimbEdit label="右手" value={editPose.rightHand}
              onChange={(v) => updateEdit('rightHand', v)} />
            <LimbEdit label="左手" value={editPose.leftHand}
              onChange={(v) => updateEdit('leftHand', v)} />
            <LimbEdit label="右足" value={editPose.rightFoot}
              onChange={(v) => updateEdit('rightFoot', v)} />
            <LimbEdit label="左足" value={editPose.leftFoot}
              onChange={(v) => updateEdit('leftFoot', v)} />

            <div style={{ marginTop: 12, display: 'flex', gap: 4 }}>
              <button onClick={() => setEditPose(tPose)} style={{ padding: '4px 8px' }}>T-Pose</button>
              <button onClick={() => setEditPose(guardPose)} style={{ padding: '4px 8px' }}>Guard</button>
              <button onClick={() => setEditPose(crouchPose)} style={{ padding: '4px 8px' }}>Crouch</button>
            </div>
          </section>
        )}

        <section style={{ marginTop: 16, padding: 10, background: '#252530', borderRadius: 4, fontSize: 11 }}>
          <h3 style={{ marginTop: 0, fontSize: 13 }}>修正方法ガイド</h3>
          <ul style={{ paddingLeft: 16, lineHeight: 1.5 }}>
            <li><b>手が変な位置</b> → <code>leftHand/rightHand</code> の x/y/z を修正（IK）</li>
            <li><b>足が床にめり込む</b> → <code>leftFoot/rightFoot</code> の y を調整（IK）</li>
            <li><b>体の傾きが足りない</b> → <code>spine.pitch/yaw/roll</code> を修正（FK）</li>
            <li><b>全体が高すぎ/低すぎ</b> → <code>rootY</code> を修正</li>
            <li><b>頭の向きだけ変えたい</b> → <code>head.pitch/yaw</code>（FK）</li>
            <li><b>モーションの振幅</b> → windup/strikeキーフレームの値を修正</li>
            <li><b>モーションの速さ</b> → 再生ループの <code>1.2秒</code> を変更</li>
            <li><b>ease曲線</b> → <code>getSwingPose</code> 内の <code>eased = t*t</code> 等を変更</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

// ========================================
// UI部品
// ========================================

function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>{props.label}</span>
        <span>{props.value.toFixed(props.step < 1 ? 2 : 0)}{props.unit ?? ''}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

function SpineEdit(props: {
  label: string;
  value: SpineRot;
  onChange: (v: SpineRot) => void;
  pitchRange: [number, number];
  yawRange: [number, number];
  rollRange: [number, number];
}) {
  return (
    <div style={{ marginBottom: 10, paddingLeft: 8, borderLeft: '2px solid #4a9' }}>
      <div style={{ fontSize: 11, fontWeight: 'bold' }}>{props.label}</div>
      <Slider label="Pitch (前後)" value={props.value.pitch}
        min={props.pitchRange[0]} max={props.pitchRange[1]} step={1}
        onChange={(v) => props.onChange({ ...props.value, pitch: v })} unit="°" />
      <Slider label="Yaw (捻り)" value={props.value.yaw}
        min={props.yawRange[0]} max={props.yawRange[1]} step={1}
        onChange={(v) => props.onChange({ ...props.value, yaw: v })} unit="°" />
      <Slider label="Roll (左右傾き)" value={props.value.roll}
        min={props.rollRange[0]} max={props.rollRange[1]} step={1}
        onChange={(v) => props.onChange({ ...props.value, roll: v })} unit="°" />
    </div>
  );
}

function LimbEdit(props: {
  label: string;
  value: { x: number; y: number; z: number };
  onChange: (v: { x: number; y: number; z: number }) => void;
}) {
  return (
    <div style={{ marginBottom: 8, paddingLeft: 8, borderLeft: '2px solid #444' }}>
      <div style={{ fontSize: 11, fontWeight: 'bold' }}>{props.label}</div>
      <Slider label="X" value={props.value.x} min={-0.8} max={0.8} step={0.01}
        onChange={(v) => props.onChange({ ...props.value, x: v })} />
      <Slider label="Y" value={props.value.y} min={-0.9} max={0.9} step={0.01}
        onChange={(v) => props.onChange({ ...props.value, y: v })} />
      <Slider label="Z" value={props.value.z} min={-0.6} max={0.6} step={0.01}
        onChange={(v) => props.onChange({ ...props.value, z: v })} />
    </div>
  );
}

function PoseDump({ pose }: { pose: Pose }) {
  return (
    <details style={{ marginTop: 12, fontSize: 10 }}>
      <summary style={{ cursor: 'pointer' }}>このポーズの数値を見る</summary>
      <pre style={{ background: '#252530', padding: 8, borderRadius: 3, overflow: 'auto' }}>
{JSON.stringify(pose, (_k, v) => typeof v === 'number' ? Number(v.toFixed(3)) : v, 2)}
      </pre>
    </details>
  );
}

// ========================================
// ヘルパー: シリンダーを2点間に配置
// ========================================

function alignCylinder(cyl: Mesh, from: Vector3, to: Vector3) {
  const diff = to.subtract(from);
  const len = diff.length();
  if (len < 1e-6) { cyl.scaling.set(0, 0, 0); return; }
  cyl.scaling.set(1, len, 1);
  cyl.position.copyFrom(from.add(to).scale(0.5));
  const dir = diff.normalize();
  const up = new Vector3(0, 1, 0);
  const dot = Vector3.Dot(up, dir);
  if (dot > 0.9999) {
    cyl.rotationQuaternion = Quaternion.Identity();
  } else if (dot < -0.9999) {
    cyl.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
  } else {
    const axis = Vector3.Cross(up, dir).normalize();
    const angle = Math.acos(dot);
    cyl.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
  }
}
