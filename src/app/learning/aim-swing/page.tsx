'use client';

/**
 * エイムスイング学習デモ
 *
 * 自キャラ（z=-1.0, yaw=0°: +Z向き）と
 * 相手キャラ（z=+1.0, yaw=180°: -Z向き）を対峙させ、
 * 相手の部位にランダムマーカーを置き、自キャラの右手先を当てに行く。
 *
 * 学べること:
 *   - プリセットモーション + 自動補正の組み合わせ
 *   - Spine yaw/pitch を腰→胸→胸上部の配分で補正する効果
 *   - 右手IK目標の引き寄せでターゲット到達を保証
 *   - 膝・踏み込みで上下/距離を吸収
 */
import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, MeshBuilder, StandardMaterial, Mesh,
  Quaternion,
} from '@babylonjs/core';

// ========================================
// 型とプリセット
// ========================================

type SpineRot = { pitch: number; yaw: number; roll: number };
type V3 = { x: number; y: number; z: number };

type Pose = {
  rootY: number;
  rootZ?: number;  // 前後方向の Root 位置（膝蹴りのステップイン用、default 0）
  spine1: SpineRot;
  spine2: SpineRot;
  chest: SpineRot;
  head: { pitch: number; yaw: number };
  leftHand: V3;
  rightHand: V3;
  leftFoot: V3;
  rightFoot: V3;
};

type RootTransform = { position: Vector3; yawDeg: number };

const DIM = {
  spine1Len: 0.17, spine2Len: 0.17, chestLen: 0.16,
  neckLen: 0.1, headLen: 0.15,
  shoulderHalfW: 0.12, hipHalfW: 0.08,
  upperArm: 0.28, foreArm: 0.26,
  upperLeg: 0.38, lowerLeg: 0.38,
};

const Z: SpineRot = { pitch: 0, yaw: 0, roll: 0 };

// 自キャラの構え（Guard相当）
const attackerIdle: Pose = {
  rootY: -0.05,
  spine1: { pitch: 3, yaw: 0, roll: 0 },
  spine2: { pitch: 3, yaw: 0, roll: 0 },
  chest:  { pitch: 2, yaw: 0, roll: 0 },
  head: { pitch: 5, yaw: 0 },
  leftHand: { x: -0.15, y: 0.2, z: 0.35 },
  rightHand: { x: 0.18, y: 0.15, z: 0.3 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};

// 相手の立ちポーズ（軽い構え）
const opponentIdle: Pose = {
  rootY: -0.05,
  spine1: { ...Z }, spine2: { ...Z }, chest: { ...Z },
  head: { pitch: 0, yaw: 0 },
  leftHand: { x: -0.25, y: 0.1, z: 0.15 },
  rightHand: { x: 0.25, y: 0.1, z: 0.15 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.05 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.05 },
};

// ========================================
// 攻撃プリセット（5種）
// ========================================
// 各攻撃は 3キーフレーム（start/windup/strike）で定義。
// endEffector: ヒット判定に使うスケルトンジョイント名
// correctionTargetKey: 補正で引き寄せる Pose のIK目標フィールド
// sign: 左右の向き（右手/右足攻撃=+1、左手攻撃=-1）— spine yaw配分に影響

type AttackKind = 'swing' | 'jab' | 'straight' | 'hook' | 'uppercut' | 'midKick' | 'frontKick' | 'kneeStrike';

type AttackDef = {
  label: string;
  start: Pose;
  windup: Pose;
  strike: Pose;
  endEffector: keyof Skeleton;
  correctionTargetKey: 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
  sign: 1 | -1;
  // spine yaw/pitch 補正係数（spine1, spine2, chest）
  yawWeights: [number, number, number];
  pitchWeights: [number, number, number];
  // 軸足（ロックして補正対象から外す）。未指定なら両足可動
  pivotFoot?: 'leftFoot' | 'rightFoot';
  // 膝蹴り等、末端が膝でIK目標は足位置の場合の補正種別
  kneeMode?: boolean;
};

// --- 右縦振り（Swing） ---
const swingStart: Pose = { ...attackerIdle };
const swingWindup: Pose = {
  rootY: -0.02,
  spine1: { pitch: -3, yaw: 0,  roll: 0 },
  spine2: { pitch: -3, yaw: 20, roll: 0 },
  chest:  { pitch: -4, yaw: 40, roll: 0 },
  head: { pitch: -5, yaw: -10 },
  leftHand: { x: -0.1, y: 0.3, z: 0.2 },
  rightHand: { x: 0.2, y: 0.3, z: -0.15 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};
const swingStrike: Pose = {
  rootY: -0.08,
  spine1: { pitch: 8,  yaw: -8,  roll: 0 },
  spine2: { pitch: 7,  yaw: -12, roll: 0 },
  chest:  { pitch: 5,  yaw: -20, roll: 0 },
  head: { pitch: 15, yaw: 5 },
  leftHand: { x: -0.18, y: 0.5, z: 0.2 },
  rightHand: { x: 0.15, y: 0.3, z: 0.7 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.05 },
  rightFoot: { x: 0.2, y: -0.8, z: 0.1 },
};

// --- 左ジャブ（直線・高速） ---
const jabWindup: Pose = {
  rootY: -0.05,
  spine1: { pitch: 3, yaw: 0,   roll: 0 },
  spine2: { pitch: 3, yaw: -8,  roll: 0 },
  chest:  { pitch: 2, yaw: -18, roll: 0 },   // 左肩を引く
  head: { pitch: 3, yaw: 5 },
  leftHand: { x: -0.28, y: 0.2, z: 0.05 },   // 左手を引く
  rightHand: { x: 0.15, y: 0.2, z: 0.3 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};
const jabStrike: Pose = {
  rootY: -0.05,
  spine1: { pitch: 4, yaw: 0,  roll: 0 },
  spine2: { pitch: 3, yaw: 5,  roll: 0 },
  chest:  { pitch: 2, yaw: 18, roll: 0 },    // 左肩を押し出す
  head: { pitch: 5, yaw: -3 },
  leftHand: { x: -0.05, y: 0.2, z: 0.75 },   // 左手を前方へ突き
  rightHand: { x: 0.2, y: 0.2, z: 0.15 },
  leftFoot: { x: -0.15, y: -0.8, z: 0.2 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};

// --- 右ストレート（重いパンチ） ---
const straightWindup: Pose = {
  rootY: -0.04,
  spine1: { pitch: 2, yaw: 5,  roll: 0 },
  spine2: { pitch: 2, yaw: 15, roll: 0 },
  chest:  { pitch: 0, yaw: 30, roll: 0 },    // 右肩を引く
  head: { pitch: 0, yaw: -5 },
  leftHand: { x: -0.1, y: 0.2, z: 0.35 },
  rightHand: { x: 0.3, y: 0.2, z: 0.05 },    // 右手を脇腹へ
  leftFoot: { x: -0.15, y: -0.8, z: 0.2 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.15 },
};
const straightStrike: Pose = {
  rootY: -0.06,
  spine1: { pitch: 6, yaw: -5,  roll: 0 },
  spine2: { pitch: 5, yaw: -15, roll: 0 },
  chest:  { pitch: 3, yaw: -30, roll: 0 },   // 右肩を強く押し出す
  head: { pitch: 5, yaw: 3 },
  leftHand: { x: -0.2, y: 0.2, z: 0.1 },
  rightHand: { x: 0.05, y: 0.25, z: 0.85 },  // 右手を前方へ
  leftFoot: { x: -0.15, y: -0.8, z: 0.1 },
  rightFoot: { x: 0.2, y: -0.8, z: 0.05 },
};

// --- 右ミドルキック（横回し蹴り） ---
// 軸足=left、Spine rollで軸足側に傾き、腰の捻り戻しで右足を振る
const midKickWindup: Pose = {
  rootY: -0.02,
  spine1: { pitch: 2,  yaw: 0,   roll: -5 },   // 左に軽く傾く
  spine2: { pitch: 0,  yaw: -10, roll: -5 },
  chest:  { pitch: -2, yaw: -25, roll: -5 },   // 右肩を引く
  head: { pitch: 0, yaw: -10 },
  leftHand: { x: -0.2, y: 0.25, z: 0.15 },
  rightHand: { x: 0.25, y: 0.3, z: -0.1 },
  leftFoot: { x: -0.12, y: -0.82, z: 0 },      // 軸足（固定）
  rightFoot: { x: 0.45, y: -0.4, z: -0.15 },   // 右足を横後方に引き上げ
};
const midKickStrike: Pose = {
  rootY: -0.02,
  spine1: { pitch: 2,  yaw: 0,   roll: -12 },  // 軸足側にさらに傾く
  spine2: { pitch: 0,  yaw: 10,  roll: -10 },
  chest:  { pitch: -3, yaw: 20,  roll: -5 },   // 捻り戻しで右足を振る
  head: { pitch: -3, yaw: 5 },
  leftHand: { x: -0.15, y: 0.3, z: 0.2 },
  rightHand: { x: 0.2, y: 0.2, z: 0.2 },
  leftFoot: { x: -0.12, y: -0.82, z: 0 },      // 軸足（固定）
  rightFoot: { x: 0.15, y: 0.25, z: 0.55 },    // 右足を前方高めに蹴り上げ
};

// --- 右前蹴り（旧「膝蹴り」: モーション的には前蹴り） ---
const frontKickWindup: Pose = {
  rootY: -0.05,
  spine1: { pitch: 8,  yaw: 0, roll: 0 },
  spine2: { pitch: 5,  yaw: 0, roll: 0 },
  chest:  { pitch: 3,  yaw: 0, roll: 0 },
  head: { pitch: 5, yaw: 0 },
  leftHand: { x: -0.2, y: 0.3, z: 0.3 },
  rightHand: { x: 0.2, y: 0.3, z: 0.3 },
  leftFoot: { x: -0.12, y: -0.82, z: -0.05 },
  rightFoot: { x: 0.15, y: -0.55, z: -0.1 },   // 右足を引き上げ
};
const frontKickStrike: Pose = {
  rootY: 0.03,
  spine1: { pitch: 10, yaw: 0, roll: 0 },
  spine2: { pitch: 5,  yaw: 0, roll: 0 },
  chest:  { pitch: 3,  yaw: 0, roll: 0 },
  head: { pitch: 10, yaw: 0 },
  leftHand: { x: -0.25, y: 0.35, z: 0.25 },
  rightHand: { x: 0.25, y: 0.35, z: 0.25 },
  leftFoot: { x: -0.12, y: -0.85, z: -0.05 },
  rightFoot: { x: 0.15, y: -0.3, z: 0.0 },     // 右足を前方に突き出し
};

// --- 右膝蹴り（本物: 膝関節で当てる） ---
// 脚を深く折り畳んだまま、腰ごと前進して膝をターゲットに突き当てる
const kneeStrikeWindup: Pose = {
  rootY: -0.05,
  spine1: { pitch: 12, yaw: 0, roll: 0 },      // 深い前傾（相手を掴む姿勢）
  spine2: { pitch: 5,  yaw: 0, roll: 0 },
  chest:  { pitch: 3,  yaw: 0, roll: 0 },
  head: { pitch: 5, yaw: 0 },
  leftHand: { x: -0.3, y: 0.35, z: 0.3 },      // 両手を前方広めに（掴み）
  rightHand: { x: 0.3, y: 0.35, z: 0.3 },
  leftFoot: { x: -0.12, y: -0.85, z: -0.05 },  // 軸足は接地
  rightFoot: { x: 0.1, y: -0.4, z: -0.2 },     // 右足を尻寄りに畳む（膝は前）
};
const kneeStrikeStrike: Pose = {
  rootY: 0.08,                                 // 腰を上げる（跳ねて突き上げ）
  spine1: { pitch: 15, yaw: 0, roll: 0 },      // さらに前傾（パワー伝達）
  spine2: { pitch: 5,  yaw: 0, roll: 0 },
  chest:  { pitch: 3,  yaw: 0, roll: 0 },
  head: { pitch: 10, yaw: 0 },
  leftHand: { x: -0.3, y: 0.2, z: 0.15 },      // 両手は引き寄せ（掴み下げる動き）
  rightHand: { x: 0.3, y: 0.2, z: 0.15 },
  leftFoot: { x: -0.12, y: -0.88, z: -0.1 },   // 軸足伸ばして跳ねる
  rightFoot: { x: 0.1, y: -0.2, z: -0.25 },    // 右足は尻寄りタイトに畳む（膝を前へ押し出す）
};

// --- 右アッパー（下から上への突き上げ） ---
const uppercutWindup: Pose = {
  rootY: -0.15,                                // 膝を曲げて沈み込む
  spine1: { pitch: 10, yaw: 3,  roll: 0 },
  spine2: { pitch: 5,  yaw: 10, roll: 0 },
  chest:  { pitch: 4,  yaw: 20, roll: 0 },     // 右肩を軽く引く
  head: { pitch: 10, yaw: 0 },
  leftHand: { x: -0.2, y: 0.2, z: 0.25 },      // ガード
  rightHand: { x: 0.25, y: -0.1, z: 0.05 },    // 右手を腰のあたりに沈める
  leftFoot: { x: -0.15, y: -0.7, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.7, z: -0.1 },
};
const uppercutStrike: Pose = {
  rootY: -0.02,                                // 沈みから伸び上がる（膝を伸ばす）
  spine1: { pitch: -3, yaw: -3,  roll: 0 },    // 腰を反らしながら押し上げ
  spine2: { pitch: -2, yaw: -8,  roll: 0 },
  chest:  { pitch: -1, yaw: -15, roll: 0 },    // 右肩を前上へ
  head: { pitch: -5, yaw: 0 },
  leftHand: { x: -0.2, y: 0.25, z: 0.2 },
  rightHand: { x: 0.1, y: 0.55, z: 0.55 },     // 右手を下→上の弧で前方高へ
  leftFoot: { x: -0.15, y: -0.82, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.82, z: -0.1 },
};

// --- 右フック（横方向の弧を描く） ---
const hookWindup: Pose = {
  rootY: -0.05,
  spine1: { pitch: 3,  yaw: 5,  roll: -3 },
  spine2: { pitch: 3,  yaw: 20, roll: -3 },
  chest:  { pitch: 2,  yaw: 40, roll: -3 },    // 右肩を強く引く（ためを作る）
  head: { pitch: 3, yaw: -10 },
  leftHand: { x: -0.15, y: 0.25, z: 0.3 },     // ガード
  rightHand: { x: 0.55, y: 0.3, z: -0.05 },    // 右手を外側後方に引く
  leftFoot: { x: -0.15, y: -0.8, z: 0.15 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.1 },
};
const hookStrike: Pose = {
  rootY: -0.05,
  spine1: { pitch: 4,  yaw: -8,  roll: 2 },
  spine2: { pitch: 3,  yaw: -20, roll: 2 },
  chest:  { pitch: 2,  yaw: -40, roll: 3 },    // 右肩を体の中心を超えて振り抜く
  head: { pitch: 5, yaw: 8 },
  leftHand: { x: -0.2, y: 0.25, z: 0.2 },
  rightHand: { x: -0.05, y: 0.35, z: 0.55 },   // 右手を横→正面の弧で振る
  leftFoot: { x: -0.15, y: -0.8, z: 0.1 },
  rightFoot: { x: 0.15, y: -0.8, z: -0.05 },
};

const ATTACKS: Record<AttackKind, AttackDef> = {
  swing: {
    label: '右縦振り', start: swingStart, windup: swingWindup, strike: swingStrike,
    endEffector: 'rightHand', correctionTargetKey: 'rightHand',
    sign: 1, yawWeights: [0.2, 0.3, 0.5], pitchWeights: [0.15, 0, 0.2],
  },
  jab: {
    label: '左ジャブ', start: attackerIdle, windup: jabWindup, strike: jabStrike,
    endEffector: 'leftHand', correctionTargetKey: 'leftHand',
    sign: -1, yawWeights: [0.15, 0.25, 0.5], pitchWeights: [0.1, 0, 0.15],
  },
  straight: {
    label: '右ストレート', start: attackerIdle, windup: straightWindup, strike: straightStrike,
    endEffector: 'rightHand', correctionTargetKey: 'rightHand',
    sign: 1, yawWeights: [0.2, 0.3, 0.5], pitchWeights: [0.15, 0, 0.2],
  },
  hook: {
    label: '右フック', start: attackerIdle, windup: hookWindup, strike: hookStrike,
    endEffector: 'rightHand', correctionTargetKey: 'rightHand',
    sign: 1, yawWeights: [0.15, 0.3, 0.55], pitchWeights: [0.15, 0, 0.15],
  },
  uppercut: {
    label: '右アッパー', start: attackerIdle, windup: uppercutWindup, strike: uppercutStrike,
    endEffector: 'rightHand', correctionTargetKey: 'rightHand',
    sign: 1, yawWeights: [0.15, 0.25, 0.45], pitchWeights: [0.1, 0, 0.15],
  },
  midKick: {
    label: '右ミドルキック', start: attackerIdle, windup: midKickWindup, strike: midKickStrike,
    endEffector: 'rightFoot', correctionTargetKey: 'rightFoot',
    sign: 1, yawWeights: [0.1, 0.2, 0.4], pitchWeights: [0.2, 0, 0.1],
    pivotFoot: 'leftFoot',
  },
  frontKick: {
    label: '右前蹴り', start: attackerIdle, windup: frontKickWindup, strike: frontKickStrike,
    endEffector: 'rightFoot', correctionTargetKey: 'rightFoot',
    sign: 1, yawWeights: [0.1, 0.2, 0.35], pitchWeights: [0.25, 0, 0.15],
    pivotFoot: 'leftFoot',
  },
  kneeStrike: {
    label: '右膝蹴り(本物)', start: attackerIdle, windup: kneeStrikeWindup, strike: kneeStrikeStrike,
    endEffector: 'rightKnee', correctionTargetKey: 'rightFoot',
    sign: 1, yawWeights: [0.1, 0.15, 0.3], pitchWeights: [0.2, 0, 0.1],
    pivotFoot: 'leftFoot', kneeMode: true,
  },
};

// ========================================
// 数学ヘルパー
// ========================================

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function lerpV3(a: V3, b: V3, t: number): V3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}
function lerpRot(a: SpineRot, b: SpineRot, t: number): SpineRot {
  return { pitch: lerp(a.pitch, b.pitch, t), yaw: lerp(a.yaw, b.yaw, t), roll: lerp(a.roll, b.roll, t) };
}
function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    rootY: lerp(a.rootY, b.rootY, t),
    rootZ: lerp(a.rootZ ?? 0, b.rootZ ?? 0, t),
    spine1: lerpRot(a.spine1, b.spine1, t),
    spine2: lerpRot(a.spine2, b.spine2, t),
    chest: lerpRot(a.chest, b.chest, t),
    head: { pitch: lerp(a.head.pitch, b.head.pitch, t), yaw: lerp(a.head.yaw, b.head.yaw, t) },
    leftHand: lerpV3(a.leftHand, b.leftHand, t),
    rightHand: lerpV3(a.rightHand, b.rightHand, t),
    leftFoot: lerpV3(a.leftFoot, b.leftFoot, t),
    rightFoot: lerpV3(a.rightFoot, b.rightFoot, t),
  };
}

function rotFrom(r: SpineRot): Quaternion {
  const d = Math.PI / 180;
  return Quaternion.RotationYawPitchRoll(r.yaw * d, r.pitch * d, r.roll * d);
}

function applyQuat(q: Quaternion, v: Vector3): Vector3 {
  const r = new Vector3();
  v.rotateByQuaternionToRef(q, r);
  return r;
}

// ========================================
// 2ボーンIK
// ========================================

function solveIK(root: Vector3, target: Vector3, pole: Vector3, L1: number, L2: number) {
  const toTarget = target.subtract(root);
  const d = toTarget.length();
  const maxReach = L1 + L2;
  if (d >= maxReach) {
    const dir = toTarget.normalize();
    return { mid: root.add(dir.scale(L1)), end: root.add(dir.scale(maxReach)) };
  }
  const cosAlpha = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
  const dir = toTarget.normalize();
  const poleVec = pole.subtract(root);
  const poleOnLine = dir.scale(Vector3.Dot(poleVec, dir));
  let bendDir = poleVec.subtract(poleOnLine);
  if (bendDir.lengthSquared() < 1e-6) bendDir = new Vector3(0, -1, 0);
  bendDir = bendDir.normalize();
  const mid = root.add(dir.scale(L1 * Math.cos(alpha)).add(bendDir.scale(L1 * Math.sin(alpha))));
  return { mid, end: target.clone() };
}

// ========================================
// ポーズ → スケルトン（ワールド座標）
// ========================================

type Skeleton = {
  hips: Vector3; spine1: Vector3; spine2: Vector3; chest: Vector3;
  neck: Vector3; head: Vector3;
  leftShoulder: Vector3; leftElbow: Vector3; leftHand: Vector3;
  rightShoulder: Vector3; rightElbow: Vector3; rightHand: Vector3;
  leftHip: Vector3; leftKnee: Vector3; leftFoot: Vector3;
  rightHip: Vector3; rightKnee: Vector3; rightFoot: Vector3;
};

function poseToSkeleton(pose: Pose, rootT: RootTransform): Skeleton {
  const hips0 = new Vector3(0, pose.rootY, pose.rootZ ?? 0);

  // 階層累積回転
  const rot1 = rotFrom(pose.spine1);
  const rot2 = rot1.multiply(rotFrom(pose.spine2));
  const rotC = rot2.multiply(rotFrom(pose.chest));

  const spine1 = hips0.add(applyQuat(rot1, new Vector3(0, DIM.spine1Len, 0)));
  const spine2 = spine1.add(applyQuat(rot2, new Vector3(0, DIM.spine2Len, 0)));
  const chest = spine2.add(applyQuat(rotC, new Vector3(0, DIM.chestLen, 0)));
  const neck = chest.add(applyQuat(rotC, new Vector3(0, DIM.neckLen, 0)));

  const headLocal = Quaternion.RotationYawPitchRoll(
    pose.head.yaw * Math.PI / 180, pose.head.pitch * Math.PI / 180, 0);
  const headRot = rotC.multiply(headLocal);
  const head = neck.add(applyQuat(headRot, new Vector3(0, DIM.headLen, 0)));

  const leftShoulder = chest.add(applyQuat(rotC, new Vector3(-DIM.shoulderHalfW, 0, 0)));
  const rightShoulder = chest.add(applyQuat(rotC, new Vector3(DIM.shoulderHalfW, 0, 0)));
  const leftHip = hips0.add(new Vector3(-DIM.hipHalfW, 0, 0));
  const rightHip = hips0.add(new Vector3(DIM.hipHalfW, 0, 0));

  const lhTarget = hips0.add(new Vector3(pose.leftHand.x, pose.leftHand.y, pose.leftHand.z));
  const rhTarget = hips0.add(new Vector3(pose.rightHand.x, pose.rightHand.y, pose.rightHand.z));
  const lfTarget = hips0.add(new Vector3(pose.leftFoot.x, pose.leftFoot.y, pose.leftFoot.z));
  const rfTarget = hips0.add(new Vector3(pose.rightFoot.x, pose.rightFoot.y, pose.rightFoot.z));

  const armPoleL = leftShoulder.add(new Vector3(-0.2, -0.3, -0.5));
  const armPoleR = rightShoulder.add(new Vector3(0.2, -0.3, -0.5));
  const legPoleL = leftHip.add(new Vector3(-0.1, -0.2, 0.5));
  const legPoleR = rightHip.add(new Vector3(0.1, -0.2, 0.5));

  const la = solveIK(leftShoulder, lhTarget, armPoleL, DIM.upperArm, DIM.foreArm);
  const ra = solveIK(rightShoulder, rhTarget, armPoleR, DIM.upperArm, DIM.foreArm);
  const ll = solveIK(leftHip, lfTarget, legPoleL, DIM.upperLeg, DIM.lowerLeg);
  const rl = solveIK(rightHip, rfTarget, legPoleR, DIM.upperLeg, DIM.lowerLeg);

  const localSk = {
    hips: hips0, spine1, spine2, chest, neck, head,
    leftShoulder, leftElbow: la.mid, leftHand: la.end,
    rightShoulder, rightElbow: ra.mid, rightHand: ra.end,
    leftHip, leftKnee: ll.mid, leftFoot: ll.end,
    rightHip, rightKnee: rl.mid, rightFoot: rl.end,
  };

  // rootTransform（位置 + yaw）を各ジョイントに適用
  const yawQ = Quaternion.RotationAxis(new Vector3(0, 1, 0), rootT.yawDeg * Math.PI / 180);
  const out = {} as Skeleton;
  for (const k of Object.keys(localSk) as (keyof Skeleton)[]) {
    out[k] = applyQuat(yawQ, localSk[k]).add(rootT.position);
  }
  return out;
}

// ========================================
// Swingモーション + 自動補正
// ========================================

function getBasePose(attack: AttackDef, progress: number): Pose {
  if (progress < 0.5) {
    const t = progress / 0.5;
    return lerpPose(attack.start, attack.windup, t * t);
  } else {
    const t = (progress - 0.5) / 0.5;
    return lerpPose(attack.windup, attack.strike, 1 - (1 - t) * (1 - t));
  }
}

/**
 * 攻撃種別 × ターゲットから補正済みポーズを生成
 */
function aimedAttackPose(
  attack: AttackDef,
  progress: number,
  targetWorld: Vector3,
  attackerRoot: RootTransform,
  strength: number,
): Pose {
  const base = getBasePose(attack, progress);

  // yaw=0前提（attackerRootがyaw=0の時のみ正確）
  const attackerHipsWorld = new Vector3(
    attackerRoot.position.x,
    attackerRoot.position.y + base.rootY,
    attackerRoot.position.z + (base.rootZ ?? 0),
  );
  const rel = targetWorld.subtract(attackerHipsWorld);
  const horizDist = Math.sqrt(rel.x * rel.x + rel.z * rel.z);
  const horizontalAngle = Math.atan2(rel.x, rel.z) * 180 / Math.PI;
  const verticalAngleDeg = Math.atan2(rel.y - 0.4, Math.max(horizDist, 0.05)) * 180 / Math.PI;

  const strikeWeight = Math.max(0, (progress - 0.3) / 0.7);
  const w = strikeWeight * strength;

  // === Spine yaw補正（攻撃種別ごとの配分） ===
  const [yw1, yw2, ywC] = attack.yawWeights;
  base.spine1.yaw += horizontalAngle * yw1 * w;
  base.spine2.yaw += horizontalAngle * yw2 * w;
  base.chest.yaw  += horizontalAngle * ywC * w;

  // === Spine pitch補正 ===
  const [pw1, , pwC] = attack.pitchWeights;
  base.spine1.pitch += -verticalAngleDeg * pw1 * w;
  base.chest.pitch  += -verticalAngleDeg * pwC * w;

  // === IK目標引き寄せ ===
  if (attack.kneeMode) {
    // 膝蹴り: 膝関節でターゲットに当てる
    // 戦略: 「腰ごと前進(rootZ)」してhipをターゲット近くに持っていき、
    //       右足は尻寄りにタイトに畳んだままにする（膝が前に突き出た形）
    //
    // 膝の到達には |hip - target| ≈ upperLeg (0.38m) が必要。
    // それ以上遠いと膝が届かないので、腰を前進させる。
    const desiredHipDistFromTarget = DIM.upperLeg - 0.05;  // ~0.33m
    const stepInNeeded = Math.max(0, horizDist - desiredHipDistFromTarget);
    const stepInCap = Math.min(stepInNeeded, 1.8);  // 過剰移動を防ぐ
    base.rootZ = (base.rootZ ?? 0) + stepInCap * w;
    // 左足(軸足)のz位置は世界位置を維持するため逆補正（地面に残す）
    base.leftFoot.z -= stepInCap * w;

    // 腰の高さをターゲット高-0.1 に寄せる（膝は腰より少し下に来る）
    const desiredRootY = rel.y - 0.1;
    base.rootY = base.rootY + (desiredRootY - base.rootY) * w * 0.6;

    // rightFootはタイトに畳んだ位置を維持（preset + 少し左右yaw調整のみ）
    const foldedFoot: V3 = {
      x: DIM.hipHalfW * attack.sign - 0.02,
      y: -0.2,
      z: -0.25,
    };
    base[attack.correctionTargetKey] = lerpV3(base[attack.correctionTargetKey], foldedFoot, w * 0.7);
  } else {
    // 通常: 末端IK目標を target方向に reach分伸ばす
    const reach = Math.min(horizDist, attack.endEffector.includes('Foot') ? 0.75 : 0.95);
    const targetHip: V3 = {
      x: Math.sin(horizontalAngle * Math.PI / 180) * reach,
      y: rel.y - (attack.endEffector.includes('Foot') ? -0.05 : 0.1),
      z: Math.cos(horizontalAngle * Math.PI / 180) * reach,
    };
    base[attack.correctionTargetKey] = lerpV3(base[attack.correctionTargetKey], targetHip, w);
  }

  // === 踏み込み（軸足以外を前に）: 距離が遠いとき ===
  if (horizDist > 0.7 && !attack.endEffector.includes('Foot') && !attack.kneeMode) {
    const stepIn = Math.min(0.25, (horizDist - 0.7) * 0.6);
    // 打撃側と同じ足で踏み込み（右攻撃なら右足、左攻撃なら左足）
    const stepFoot: 'leftFoot' | 'rightFoot' = attack.sign === 1 ? 'rightFoot' : 'leftFoot';
    if (attack.pivotFoot !== stepFoot) {
      base[stepFoot].z += stepIn * w;
    }
  }

  // === 膝補正（しゃがみ）: 目標が低い時、軸足指定なしなら両足、軸足ありなら軸足で ===
  if (rel.y < 0 && !attack.endEffector.includes('Foot') && !attack.kneeMode) {
    const crouch = Math.min(0.2, -rel.y * 0.4);
    base.rootY -= crouch * w;
    base.leftFoot.y += crouch * w;
    base.rightFoot.y += crouch * w;
  }
  if (rel.y > 0.5 && !attack.endEffector.includes('Foot')) {
    const stretch = Math.min(0.1, (rel.y - 0.5) * 0.3);
    base.rootY += stretch * w;
  }

  return base;
}

// ========================================
// React コンポーネント
// ========================================

const JOINT_NAMES: (keyof Skeleton)[] = [
  'head', 'chest', 'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow', 'leftHand', 'rightHand',
  'hips', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftFoot', 'rightFoot',
];

export default function AimSwingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [aimStrength, setAimStrength] = useState(0.8);
  const [attackKind, setAttackKind] = useState<AttackKind>('swing');
  const [targetName, setTargetName] = useState<keyof Skeleton>('chest');
  const [opponentX, setOpponentX] = useState(0);
  const [opponentZ, setOpponentZ] = useState(1.0);
  // ループ毎ランダム切替モード
  const [targetRandomEachLoop, setTargetRandomEachLoop] = useState(false);
  const [attackRandomEachLoop, setAttackRandomEachLoop] = useState(false);
  const [hitDistance, setHitDistance] = useState<number | null>(null);

  const meshesRef = useRef<{
    scene: Scene | null;
    attacker: PuppetMeshes | null;
    opponent: PuppetMeshes | null;
    targetMarker: Mesh | null;
    trail: Mesh[];
  }>({ scene: null, attacker: null, opponent: null, targetMarker: null, trail: [] });

  // シーン初期化
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color3(0.08, 0.08, 0.12).toColor4();

    // +X側から見下ろすカメラ（自キャラが画面左、相手が画面右）
    const camera = new ArcRotateCamera('cam', 0, Math.PI / 2.3, 4, new Vector3(0, 0.2, 0), scene);
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 60;

    new HemisphericLight('light', new Vector3(0, 1, 0), scene);

    const ground = MeshBuilder.CreateGround('g', { width: 4, height: 4, subdivisions: 20 }, scene);
    const gm = new StandardMaterial('gm', scene);
    gm.wireframe = true;
    gm.emissiveColor = new Color3(0.2, 0.2, 0.3);
    ground.material = gm;
    ground.position.y = -0.88;

    const attacker = createPuppetMeshes(scene, 'atk', new Color3(0.3, 0.5, 1));
    const opponent = createPuppetMeshes(scene, 'opp', new Color3(1, 0.4, 0.4));

    const targetMarker = MeshBuilder.CreateSphere('target', { diameter: 0.08 }, scene);
    const tm = new StandardMaterial('tm', scene);
    tm.emissiveColor = new Color3(1, 1, 0.2);
    targetMarker.material = tm;

    // 右手先の軌跡用小球
    const trail: Mesh[] = [];
    for (let i = 0; i < 20; i++) {
      const s = MeshBuilder.CreateSphere('tr' + i, { diameter: 0.02 }, scene);
      const sm = new StandardMaterial('trm' + i, scene);
      sm.emissiveColor = new Color3(0.3, 1, 0.5);
      sm.alpha = (i + 1) / 20 * 0.7;
      s.material = sm;
      s.setEnabled(false);
      trail.push(s);
    }

    meshesRef.current = { scene, attacker, opponent, targetMarker, trail };

    // 毎フレーム軌跡位置を記録するため、レンダーループ外で別の仕組みにする
    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      engine.dispose();
    };
  }, []);

  // 再生ループ（連続再生、progress 0→1→0→1...）
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        let np = p + dt / 1.2;  // 1.2秒で1周
        if (np >= 1) np = np - 1;  // ラップして次サイクルへ
        return np;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // 軌跡用: progress < 0.01 のときクリア
  const trailBuffer = useRef<Vector3[]>([]);
  useEffect(() => {
    if (progress < 0.02) trailBuffer.current = [];
  }, [progress]);

  // ループ境界検出: 前フレームが打撃終端付近で今フレームがスタート付近 → 1周した
  const prevProgressRef = useRef(0);
  useEffect(() => {
    if (prevProgressRef.current > 0.7 && progress < 0.3) {
      // 新サイクル開始 → ランダムモードなら変更
      if (targetRandomEachLoop) {
        const idx = Math.floor(Math.random() * JOINT_NAMES.length);
        setTargetName(JOINT_NAMES[idx]);
      }
      if (attackRandomEachLoop) {
        const keys = Object.keys(ATTACKS) as AttackKind[];
        const idx = Math.floor(Math.random() * keys.length);
        setAttackKind(keys[idx]);
      }
    }
    prevProgressRef.current = progress;
  }, [progress, targetRandomEachLoop, attackRandomEachLoop]);

  // 描画更新
  useEffect(() => {
    const m = meshesRef.current;
    if (!m.scene || !m.attacker || !m.opponent || !m.targetMarker) return;

    // 配置: 自キャラは z=-1 yaw=0（+Z向き）、相手は z=opponentZ yaw=180（-Z向き）
    const attackerRoot: RootTransform = {
      position: new Vector3(0, 0, -1.0),
      yawDeg: 0,
    };
    const opponentRoot: RootTransform = {
      position: new Vector3(opponentX, 0, opponentZ),
      yawDeg: 180,
    };

    // 相手のスケルトン（静止ポーズ）
    const oppSk = poseToSkeleton(opponentIdle, opponentRoot);
    updatePuppetFromSkeleton(m.opponent, oppSk);

    // ターゲット位置（相手の該当ジョイント位置）
    const targetWorld = oppSk[targetName];
    m.targetMarker.position.copyFrom(targetWorld);

    // 自キャラのポーズ（攻撃種別 + 補正適用）
    const attack = ATTACKS[attackKind];
    const attackerPose = aimedAttackPose(attack, progress, targetWorld, attackerRoot, aimStrength);
    const atkSk = poseToSkeleton(attackerPose, attackerRoot);
    updatePuppetFromSkeleton(m.attacker, atkSk);

    // 末端（右手/左手/右足/右膝）の軌跡
    const endEffectorPos = atkSk[attack.endEffector];
    if (progress > 0.01 && progress < 0.99) {
      trailBuffer.current.push(endEffectorPos.clone());
      if (trailBuffer.current.length > 20) trailBuffer.current.shift();
    }
    for (let i = 0; i < m.trail.length; i++) {
      const pos = trailBuffer.current[i];
      if (pos) {
        m.trail[i].setEnabled(true);
        m.trail[i].position.copyFrom(pos);
      } else {
        m.trail[i].setEnabled(false);
      }
    }

    // ヒット判定（打撃ピーク付近で距離を更新）
    if (progress >= 0.9) {
      const dist = Vector3.Distance(endEffectorPos, targetWorld);
      setHitDistance(dist);
    }
  }, [progress, aimStrength, attackKind, targetName, opponentX, opponentZ]);

  const newTarget = () => {
    const idx = Math.floor(Math.random() * JOINT_NAMES.length);
    setTargetName(JOINT_NAMES[idx]);
    // 再生中でも progress はリセットしない（シームレスに補正先が変わる）
  };

  const toggleAttack = () => {
    if (playing) {
      setPlaying(false);
    } else {
      setProgress(0);
      setHitDistance(null);
      setPlaying(true);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ flex: 1, outline: 'none' }} />
      <div style={{
        width: 360, padding: 16, background: '#1a1a22', color: '#eee',
        overflowY: 'auto', fontFamily: 'sans-serif', fontSize: 13,
      }}>
        <h2 style={{ marginTop: 0 }}>エイムスイング学習</h2>

        <section>
          <h3>攻撃種別</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {(Object.keys(ATTACKS) as AttackKind[]).map((k) => (
              <button key={k}
                onClick={() => { setAttackKind(k); /* ループ中はリセットしない */ }}
                style={{
                  ...btnStyle,
                  background: attackKind === k ? '#4a9' : '#333',
                  fontSize: 11,
                }}>{ATTACKS[k].label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#aaa' }}>
            末端: <b>{ATTACKS[attackKind].endEffector}</b>
            {ATTACKS[attackKind].pivotFoot && <> / 軸足: <b>{ATTACKS[attackKind].pivotFoot}</b></>}
          </div>
          <label style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
            <input type="checkbox" checked={attackRandomEachLoop}
              onChange={(e) => setAttackRandomEachLoop(e.target.checked)} />
            {' '}🔀 ループ毎に攻撃種別をランダム切替
          </label>
        </section>

        <section style={{ marginTop: 12 }}>
          <h3>ターゲット</h3>
          <div style={{ marginBottom: 8 }}>
            現在: <b style={{ color: '#ff0' }}>{targetName}</b>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={newTarget} style={btnStyle}>🎲 ランダム</button>
            <select value={targetName} onChange={(e) => {
              setTargetName(e.target.value as keyof Skeleton);
              /* ループ中はリセットしない */
            }} style={{ padding: '4px 6px', background: '#333', color: '#fff', border: '1px solid #555' }}>
              {JOINT_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <label style={{ display: 'block', fontSize: 11 }}>
            <input type="checkbox" checked={targetRandomEachLoop}
              onChange={(e) => setTargetRandomEachLoop(e.target.checked)} />
            {' '}🔀 ループ毎にターゲット位置をランダム切替
          </label>
        </section>

        <section style={{ marginTop: 12 }}>
          <h3>攻撃</h3>
          <button onClick={toggleAttack}
            style={{
              ...btnStyle, fontSize: 14, padding: '6px 14px',
              background: playing ? '#c53' : '#4a9',
            }}>
            {playing ? '⏸ 停止' : '⚔ 攻撃ループ開始'}
          </button>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
            ループ中にターゲット・攻撃種別・相手位置を変えるとリアルタイムで追従
          </div>
          <div style={{ marginTop: 8 }}>
            <Slider label="進行度" value={progress} min={0} max={1} step={0.01}
              onChange={(v) => { setPlaying(false); setProgress(v); }} />
            <div style={{ fontSize: 11, color: '#aaa' }}>
              {progress < 0.3 ? 'スタート' : progress < 0.6 ? '振りかぶり' : progress < 0.95 ? '打撃' : 'ピーク'}
            </div>
          </div>
        </section>

        <section style={{ marginTop: 12 }}>
          <h3>補正強度</h3>
          <Slider label="Aim Strength" value={aimStrength} min={0} max={1} step={0.01}
            onChange={setAimStrength} />
          <div style={{ fontSize: 11, color: '#aaa' }}>
            0: 補正なし（固定モーション） / 1: 完全追従
          </div>
        </section>

        <section style={{ marginTop: 12 }}>
          <h3>相手の位置</h3>
          <Slider label="X (横)" value={opponentX} min={-1.2} max={1.2} step={0.05} onChange={setOpponentX} />
          <Slider label="Z (前後)" value={opponentZ} min={0.4} max={2.0} step={0.05} onChange={setOpponentZ} />
        </section>

        <section style={{ marginTop: 12, padding: 10, background: '#252530', borderRadius: 4 }}>
          <h3 style={{ marginTop: 0 }}>判定</h3>
          {hitDistance === null ? (
            <div style={{ color: '#888' }}>攻撃を実行してください</div>
          ) : (
            <>
              <div>右手先 ↔ ターゲット距離: <b>{hitDistance.toFixed(3)}</b> m</div>
              <div style={{
                marginTop: 6, padding: '6px 10px', borderRadius: 3,
                background: hitDistance < 0.12 ? '#2a6' : hitDistance < 0.25 ? '#a82' : '#822',
                color: '#fff', fontWeight: 'bold', fontSize: 15,
              }}>
                {hitDistance < 0.12 ? '✓ HIT!' : hitDistance < 0.25 ? '△ 惜しい' : '✗ MISS'}
              </div>
            </>
          )}
        </section>

        <section style={{ marginTop: 12, fontSize: 11, color: '#aaa' }}>
          <h3 style={{ fontSize: 13, color: '#ddd' }}>観察ポイント</h3>
          <ul style={{ paddingLeft: 16, lineHeight: 1.5 }}>
            <li>補正=0 で攻撃 → ターゲット関係なく同じ動き</li>
            <li><b>左ジャブ</b>: 左手で突く、Spine yaw配分は右攻撃と逆</li>
            <li><b>右ストレート</b>: 直線的で速い、胸で押し出す</li>
            <li><b>右ミドルキック</b>: 軸足=左固定、Spine rollで傾く</li>
            <li><b>右膝蹴り</b>: 末端=rightKnee、足IK目標で膝位置を制御</li>
            <li>攻撃種別を切り替えてSpineとIKの配分差を見る</li>
            <li>緑軌跡 = 末端（攻撃部位）の通った経路</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px', background: '#333', color: '#fff',
  border: 'none', borderRadius: 3, cursor: 'pointer',
};

function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>{props.label}</span>
        <span>{props.value.toFixed(2)}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step}
        value={props.value} onChange={(e) => props.onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

// ========================================
// パペットメッシュの作成と更新
// ========================================

type PuppetMeshes = {
  joints: Map<string, Mesh>;
  bones: Mesh[];
};

function createPuppetMeshes(scene: Scene, prefix: string, color: Color3): PuppetMeshes {
  const joints = new Map<string, Mesh>();
  const jointDefs: { name: string; size: number }[] = [
    { name: 'hips', size: 0.08 }, { name: 'spine1', size: 0.05 }, { name: 'spine2', size: 0.05 },
    { name: 'chest', size: 0.06 }, { name: 'neck', size: 0.04 }, { name: 'head', size: 0.12 },
    { name: 'leftShoulder', size: 0.05 }, { name: 'leftElbow', size: 0.04 }, { name: 'leftHand', size: 0.05 },
    { name: 'rightShoulder', size: 0.05 }, { name: 'rightElbow', size: 0.04 }, { name: 'rightHand', size: 0.05 },
    { name: 'leftHip', size: 0.05 }, { name: 'leftKnee', size: 0.04 }, { name: 'leftFoot', size: 0.05 },
    { name: 'rightHip', size: 0.05 }, { name: 'rightKnee', size: 0.04 }, { name: 'rightFoot', size: 0.05 },
  ];
  for (const j of jointDefs) {
    const m = MeshBuilder.CreateSphere(`${prefix}_${j.name}`, { diameter: j.size }, scene);
    const mat = new StandardMaterial(`${prefix}_${j.name}_mat`, scene);
    mat.emissiveColor = color;
    m.material = mat;
    joints.set(j.name, m);
  }
  const bones: Mesh[] = [];
  for (let i = 0; i < 17; i++) {
    const b = MeshBuilder.CreateCylinder(`${prefix}_bone${i}`, { height: 1, diameter: 0.03 }, scene);
    const bm = new StandardMaterial(`${prefix}_bonemat${i}`, scene);
    bm.diffuseColor = color.scale(0.6);
    b.material = bm;
    bones.push(b);
  }
  return { joints, bones };
}

const BONE_CONNECTIONS: [keyof Skeleton, keyof Skeleton][] = [
  ['hips', 'spine1'], ['spine1', 'spine2'], ['spine2', 'chest'],
  ['chest', 'neck'], ['neck', 'head'],
  ['chest', 'leftShoulder'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftHand'],
  ['chest', 'rightShoulder'], ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightHand'],
  ['hips', 'leftHip'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftFoot'],
  ['hips', 'rightHip'], ['rightHip', 'rightKnee'], ['rightKnee', 'rightFoot'],
];

function updatePuppetFromSkeleton(p: PuppetMeshes, sk: Skeleton) {
  for (const [name, mesh] of p.joints) {
    mesh.position.copyFrom((sk as unknown as Record<string, Vector3>)[name]);
  }
  BONE_CONNECTIONS.forEach(([a, b], i) => {
    alignCylinder(p.bones[i], sk[a], sk[b]);
  });
}

function alignCylinder(cyl: Mesh, from: Vector3, to: Vector3) {
  const diff = to.subtract(from);
  const len = diff.length();
  if (len < 1e-6) { cyl.scaling.set(0, 0, 0); return; }
  cyl.scaling.set(1, len, 1);
  cyl.position.copyFrom(from.add(to).scale(0.5));
  const dir = diff.normalize();
  const up = new Vector3(0, 1, 0);
  const dot = Vector3.Dot(up, dir);
  if (dot > 0.9999) cyl.rotationQuaternion = Quaternion.Identity();
  else if (dot < -0.9999) cyl.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
  else {
    const axis = Vector3.Cross(up, dir).normalize();
    cyl.rotationQuaternion = Quaternion.RotationAxis(axis, Math.acos(dot));
  }
}
