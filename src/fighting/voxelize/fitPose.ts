/**
 * バインド用ポーズフィット: ウェイト計算の前にスケルトン側を T ポーズへ整える。
 *
 * 自動ウェイトは「モデルとスケルトンが同じポーズで重なっている」ことが前提。
 * 外部モデルの多くは T ポーズだが Maskman の bind pose は構え気味なので、
 * **スケルトンの腕・脚チェーンを世界軸に整列**させてから束縛する。
 *
 * スキニングのバインドポーズは任意でよい (buildVoxelSkinMesh が「呼ばれた
 * 時点の姿勢」を invRest に焼くため)。FAP クリップは全ボーンの回転を毎フレーム
 * 絶対値で上書きするので、再生が始まればフィット用ポーズは残らない。
 */

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** 整列させるボーン連鎖。bones[i] を bones[i+1] へ向かう方向が target になるよう回す */
export interface PoseChain {
  bones: string[];
  /**
   * ワールド目標方向。"outward" は最初のリンクの現在 X 符号で ±X を自動選択
   * (左右どちらの腕でも外向きに伸ばす)。
   */
  target: [number, number, number] | "outward";
}

/** FAP (Maskman) / Mixamo 系の標準ボーン名での T ポーズ定義 */
export const TPOSE_CHAINS: PoseChain[] = [
  { bones: ["LeftArm", "LeftForeArm", "LeftHand"], target: "outward" },
  { bones: ["RightArm", "RightForeArm", "RightHand"], target: "outward" },
  { bones: ["LeftUpLeg", "LeftLeg", "LeftFoot"], target: [0, -1, 0] },
  { bones: ["RightUpLeg", "RightLeg", "RightFoot"], target: [0, -1, 0] },
];

/**
 * チェーンを順に整列させる。整列できたリンク数を返す。
 * ボーン名はそのまま (mixamorig: 等の接頭辞があるモデルは prefix で吸収) 。
 *
 * 実装ノート: GLB スケルトンは祖先に負スケール (鏡像, 行列式 -1) を含むことが
 * あり、absoluteRotationQuaternion (行列分解依存) を使う合成は壊れる。
 * そこで「現在方向」と「目標方向」を**親のワールド行列の逆でベクトル変換して
 * 親ローカル空間に落とし**、その空間内で FromUnitVectors の回転デルタを
 * ローカル回転に前置合成する。行列の逆変換は鏡像でも厳密。
 */
export function applyPoseFit(
  rig: { nodesByName: ReadonlyMap<string, TransformNode> },
  chains: readonly PoseChain[] = TPOSE_CHAINS,
  opts?: { prefix?: string },
): number {
  const prefix = opts?.prefix ?? "";
  let applied = 0;

  const tmpDelta = new Quaternion();
  const dirWorld = new Vector3();
  const dirLocal = new Vector3();
  const targetLocal = new Vector3();
  const invParent = new Matrix();

  for (const chain of chains) {
    // チェーン全ボーンが揃っている場合のみ
    const nodes = chain.bones.map((n) => rig.nodesByName.get(prefix + n));
    if (nodes.some((n) => !n)) continue;

    // "outward" は最初のリンクの現在向きから符号を決める
    let resolvedTarget: Vector3 | null = null;
    if (chain.target !== "outward") {
      resolvedTarget = new Vector3(...chain.target).normalize();
    }

    for (let i = 0; i < nodes.length - 1; i++) {
      const node = nodes[i]!;
      const child = nodes[i + 1]!;
      node.computeWorldMatrix(true);
      child.computeWorldMatrix(true);

      child
        .getAbsolutePosition()
        .subtractToRef(node.getAbsolutePosition(), dirWorld);
      if (dirWorld.lengthSquared() < 1e-10) continue;
      dirWorld.normalize();

      if (!resolvedTarget) {
        // 外向き: 上腕の現在 X 符号で ±X
        resolvedTarget = new Vector3(dirWorld.x >= 0 ? 1 : -1, 0, 0);
      }

      // 親ローカル空間へ落とす (鏡像スケール対応のため行列逆変換を使う)
      const parent = node.parent as TransformNode | null;
      if (parent) {
        parent.computeWorldMatrix(true);
        parent.getWorldMatrix().invertToRef(invParent);
      } else {
        Matrix.IdentityToRef(invParent);
      }
      Vector3.TransformNormalToRef(dirWorld, invParent, dirLocal);
      Vector3.TransformNormalToRef(resolvedTarget, invParent, targetLocal);
      if (dirLocal.lengthSquared() < 1e-10 || targetLocal.lengthSquared() < 1e-10) {
        continue;
      }
      dirLocal.normalize();
      targetLocal.normalize();

      // 親ローカル空間での回転デルタを、既存ローカル回転へ前置合成
      Quaternion.FromUnitVectorsToRef(dirLocal, targetLocal, tmpDelta);
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
      }
      tmpDelta.multiplyToRef(node.rotationQuaternion, node.rotationQuaternion);
      node.computeWorldMatrix(true);
      applied++;
    }
  }
  return applied;
}
