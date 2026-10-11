/**
 * 関節マーカーによる手動フィット。
 *
 * ユーザーが画面上で指定した主要関節のワールド座標へ、スケルトンの対応ボーンを
 * 移動させる (Mixamo auto-rigger と同じ発想)。バインドポーズは任意でよい
 * (buildVoxelSkinMesh が呼ばれた時点の姿勢を invRest に焼く) ため、
 * **ワールド位置を合わせるだけで十分** — ボーンの向きはスキニングの正しさに
 * 影響しない。
 *
 * ★ただし再生時の注意 (2点。createVoxelFighter は両方自動で行う):
 * 1. FAP クリップは各ボーンの position カーブ (= Maskman の骨長) を持つため、
 *    そのまま再生するとプロポーションが Maskman 比率へ戻る。マーカーで骨長を
 *    変えた場合は retarget の keepPositionFor (Root/Hips のみ残す) を併用する。
 * 2. マーカーはローカルオフセットの**方向**も取込モデルのポーズへ書き換えるが、
 *    クリップの回転カーブは Maskman の rest 骨方向を前提とする。マーカー姿勢の
 *    まま再生すると全モーションが (取込ポーズ − rest) 分だけ恒常的にずれる。
 *    バインド (invRest 焼き込み) 後に restorePlaybackPose で「回転 = 元 rest /
 *    位置 = 元の方向 × マーカー後の長さ」へ正規化してから再生すること。
 */

import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** マーカーで指定できる主要関節 (FAP/Maskman ボーン名) */
export const MARKER_BONES = [
  "Hips",
  "Spine",
  "Spine2",
  "Neck",
  "Head",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
] as const;

/** ボーン名 → ワールド座標 [x,y,z] */
export type JointMarkers = Record<string, [number, number, number]>;

/**
 * マーカー位置へボーンを移動する。浅い階層から順に setAbsolutePosition する
 * (親を動かすと子も動くため、深さ順で処理して上書きの整合を取る)。
 * 適用できたボーン数を返す。
 */
export function applyJointMarkers(
  rig: { nodesByName: ReadonlyMap<string, TransformNode> },
  markers: JointMarkers,
): number {
  const entries: { node: TransformNode; pos: Vector3; depth: number }[] = [];
  for (const [name, p] of Object.entries(markers)) {
    const node = rig.nodesByName.get(name);
    if (!node || !p) continue;
    entries.push({
      node,
      pos: new Vector3(p[0], p[1], p[2]),
      depth: nodeDepth(node),
    });
  }
  entries.sort((a, b) => a.depth - b.depth);

  for (const e of entries) {
    e.node.setAbsolutePosition(e.pos);
    e.node.computeWorldMatrix(true);
  }
  return entries.length;
}

/** 現在のスケルトンから MARKER_BONES のワールド座標を読む (マーカー初期値用) */
export function readJointMarkers(rig: {
  nodesByName: ReadonlyMap<string, TransformNode>;
}): JointMarkers {
  const out: JointMarkers = {};
  for (const name of MARKER_BONES) {
    const node = rig.nodesByName.get(name);
    if (!node) continue;
    node.computeWorldMatrix(true);
    const p = node.getAbsolutePosition();
    out[name] = [p.x, p.y, p.z];
  }
  return out;
}

function nodeDepth(node: TransformNode): number {
  let d = 0;
  let p = node.parent;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

// ------------------------------------------------------------ rest ポーズ管理

/** ボーン 1 本のローカル変換の控え */
export interface RestTransform {
  pos: Vector3;
  rot: Quaternion | null;
  eul: Vector3;
  scl: Vector3;
}

/** 全ボーンのローカル変換スナップショット */
export type RestSnapshot = Map<TransformNode, RestTransform>;

/** position トラックが生き残るボーン (keepPositionFor と対) + glTF ルート */
const KEEP_POSITION_BONES = /^(Root|Hips|__root__)$/;

/** 全ボーンの現在のローカル変換を控える */
export function snapshotRestPose(rig: {
  nodesByName: ReadonlyMap<string, TransformNode>;
}): RestSnapshot {
  const snap: RestSnapshot = new Map();
  for (const node of rig.nodesByName.values()) {
    snap.set(node, {
      pos: node.position.clone(),
      rot: node.rotationQuaternion ? node.rotationQuaternion.clone() : null,
      eul: node.rotation.clone(),
      scl: node.scaling.clone(),
    });
  }
  return snap;
}

/** 控えたローカル変換をそのまま書き戻す (resetPose 用) */
export function applyRestPose(snap: RestSnapshot): void {
  for (const [node, t] of snap) {
    restoreRotationScale(node, t);
    node.position.copyFrom(t.pos);
  }
}

/**
 * 再生ポーズ正規化: バインド用ポーズ (fitPose / markers) から、クリップ再生の
 * 前提となる姿勢へ戻す。
 *  - 回転・スケール: 控えた元 rest へ (クリップの回転カーブは元 rest の
 *    骨方向を前提とするため。再生中は毎フレーム上書きされる)
 *  - 位置: **元の方向 × 現在の長さ** — マーカーで得た骨長 (プロポーション)
 *    だけを引き継ぎ、取込モデルのポーズ (方向) は捨てる
 *  - Root/Hips/__root__: position トラックが生きているため元値へ戻す
 *
 * snap には正規化の基準となる「元 rest」(fitPose/markers 適用前) を渡すこと。
 */
export function restorePlaybackPose(snap: RestSnapshot): void {
  for (const [node, t] of snap) {
    restoreRotationScale(node, t);
    const curLen = node.position.length();
    const origLen = t.pos.length();
    if (
      !KEEP_POSITION_BONES.test(node.name) &&
      origLen > 1e-6 &&
      curLen > 1e-6
    ) {
      node.position.copyFrom(t.pos).scaleInPlace(curLen / origLen);
    } else {
      node.position.copyFrom(t.pos);
    }
  }
}

function restoreRotationScale(node: TransformNode, t: RestTransform): void {
  if (t.rot) {
    if (!node.rotationQuaternion) node.rotationQuaternion = t.rot.clone();
    else node.rotationQuaternion.copyFrom(t.rot);
  } else {
    node.rotationQuaternion = null;
    node.rotation.copyFrom(t.eul);
  }
  node.scaling.copyFrom(t.scl);
}
