/**
 * ボクセル + 自動ウェイト + 任意スケルトン (回転付き rest 対応) の
 * CPU リニアブレンドスキニング描画。
 *
 * voxel/buildWeightedVoxel.ts (anna 用, identity-rest 前提) の一般化版:
 * rest が回転を持つ GLB スケルトン (Maskman) でも動くよう、毎フレーム
 *   skinMat[k] = invRest[k] × boneWorld[k]
 * を計算し、rest ワールド座標のボクセル中心をこれで変換する。
 * キューブの向きは支配ボーンの skinMat から取った回転を使う。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import type { VoxelizedModel, VoxelSkinWeights } from "./types";
import type { BoneSegment } from "./autoSkin";

export interface SkinnedVoxelMesh {
  mesh: Mesh;
  /** 描画ボクセル数 */
  rendered: number;
  dispose: () => void;
}

/**
 * 呼ぶ時点のスケルトン姿勢を rest として焼き付ける
 * (= クリップ再生前・ウェイト計算と同じ姿勢で呼ぶこと)。
 */
export function buildVoxelSkinMesh(
  scene: Scene,
  model: VoxelizedModel,
  skin: VoxelSkinWeights,
  segments: readonly BoneSegment[],
): SkinnedVoxelMesh {
  const { count, voxelSize: vs, origin } = model;
  const MAX_INF = skin.maxInfluences;

  // rest ワールド行列の逆行列を焼き付け
  const nSeg = segments.length;
  const invRest: Matrix[] = new Array(nSeg);
  for (let s = 0; s < nSeg; s++) {
    const node = segments[s].node;
    node.computeWorldMatrix(true);
    invRest[s] = node.getWorldMatrix().clone().invert();
  }

  // ボクセル中心 (rest ワールド) と色
  const centers = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    centers[i * 3] = origin[0] + (model.xs[i] + 0.5) * vs;
    centers[i * 3 + 1] = origin[1] + (model.ys[i] + 0.5) * vs;
    centers[i * 3 + 2] = origin[2] + (model.zs[i] + 0.5) * vs;
    colors[i * 4] = model.colors[i * 3];
    colors[i * 4 + 1] = model.colors[i * 3 + 1];
    colors[i * 4 + 2] = model.colors[i * 3 + 2];
    colors[i * 4 + 3] = 1;
  }

  // 支配ボーン (最大ウェイト) — キューブの向きに使う
  const dom = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    const base = i * MAX_INF;
    let bestW = -1;
    for (let k = 0; k < MAX_INF; k++) {
      const u = skin.boneIndices[base + k];
      if (u < 0) continue;
      const w = skin.weights[base + k];
      if (w > bestW) {
        bestW = w;
        dom[i] = u;
      }
    }
  }

  const matrices = new Float32Array(count * 16);

  const box = MeshBuilder.CreateBox("voxelSkin", { size: vs }, scene);
  const mat = new StandardMaterial("voxelSkinMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  box.material = mat;
  box.thinInstanceSetBuffer("color", colors, 4, true);
  box.thinInstanceSetBuffer("matrix", matrices, 16, false);

  // フレームごとの作業バッファ
  const skinMats: Matrix[] = new Array(nSeg);
  const skinQuats: Quaternion[] = new Array(nSeg);
  for (let s = 0; s < nSeg; s++) {
    skinMats[s] = Matrix.Identity();
    skinQuats[s] = Quaternion.Identity();
  }
  const tmpScale = new Vector3();
  const tmpTrans = new Vector3();
  const tmp = new Vector3();
  const pos = new Vector3();
  const scaleOne = new Vector3(1, 1, 1);
  const tmpMat = new Matrix();

  const update = (): void => {
    for (let s = 0; s < nSeg; s++) {
      const node = segments[s].node;
      node.computeWorldMatrix(true);
      // skinMat = invRest × boneWorld (rest ワールド点 → 現姿勢ワールド点)
      invRest[s].multiplyToRef(node.getWorldMatrix(), skinMats[s]);
      skinMats[s].decompose(tmpScale, skinQuats[s], tmpTrans);
    }
    for (let i = 0; i < count; i++) {
      pos.set(0, 0, 0);
      const base = i * MAX_INF;
      const ci = i * 3;
      for (let k = 0; k < MAX_INF; k++) {
        const u = skin.boneIndices[base + k];
        if (u < 0) continue;
        const w = skin.weights[base + k];
        Vector3.TransformCoordinatesFromFloatsToRef(
          centers[ci], centers[ci + 1], centers[ci + 2],
          skinMats[u],
          tmp,
        );
        pos.x += tmp.x * w;
        pos.y += tmp.y * w;
        pos.z += tmp.z * w;
      }
      const d = dom[i];
      Matrix.ComposeToRef(scaleOne, d >= 0 ? skinQuats[d] : Quaternion.Identity(), pos, tmpMat);
      tmpMat.copyToArray(matrices, i * 16);
    }
    box.thinInstanceBufferUpdated("matrix");
  };

  const obs: Observer<Scene> = scene.onBeforeRenderObservable.add(update);
  update();

  return {
    mesh: box,
    rendered: count,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(obs);
      box.dispose();
    },
  };
}
