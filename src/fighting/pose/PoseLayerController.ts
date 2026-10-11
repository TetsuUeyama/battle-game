/**
 * feature2: ポーズレイヤー適用コントローラ。
 *
 * ベースアニメ (AnimationGroup) はボーンの TransformNode を毎フレーム上書きする。
 * したがって「キャラ個性のオフセット」はアニメ評価の *後* に合成しないと打ち消される。
 * Babylon では `scene.onAfterAnimationsObservable` がアニメ評価後・描画前に走るので、
 * そこで各ボーンの `rotationQuaternion` に追加ローカル回転を合成する。
 *
 * 合成式: final = animBase ⊗ slerp(identity, offset, weight)
 *  - animBase はそのフレームでアニメが書いた回転 (= 現在の rotationQuaternion)
 *  - offset は PoseLayer.offsets で指定された追加ローカル回転 (オイラー角)
 *  - weight で効きを slerp 補間する (0 で素のアニメ、1 でフルにオフセット)
 */

import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

import type { CharacterRig, PoseLayer } from "../fighting/types";

/** PoseLayerController が必要とする最小限のリグ情報 */
export interface PoseRigLike {
  scene: Scene;
  /** ボーン名 → TransformNode */
  nodesByName: ReadonlyMap<string, TransformNode>;
}

/** ボーン 1 本ぶんの事前計算済みオフセット */
interface CompiledOffset {
  node: TransformNode;
  /** オイラー角から作った追加回転クォータニオン (ローカル) */
  offset: Quaternion;
  /**
   * 前回 apply 後の出力値。現在値がこれと一致する場合「アニメがこのフレームは
   * ボーンを書いていない」と判定し、lastBase から再合成する (累積回転バグ防止)。
   */
  lastOut: Quaternion | null;
  /** 前回 apply 時の合成前 (オフセット適用前) の値 */
  lastBase: Quaternion | null;
}

/**
 * PoseLayer を `onAfterAnimationsObservable` で毎フレーム適用するコントローラ。
 * 複数ボーン同時オフセット可。アニメの有無に関わらず動く
 * (アニメが無いボーンは rotationQuaternion が無いことがあるので補完する)。
 */
export class PoseLayerController {
  private readonly scene: Scene;
  private readonly nodesByName: ReadonlyMap<string, TransformNode>;
  private observer: Observer<Scene> | null = null;

  private weight = 1;
  private compiled: CompiledOffset[] = [];

  /** 一時クォータニオン (毎フレーム GC を避けるため使い回す) */
  private readonly tmpBlended = new Quaternion();
  private readonly tmpOut = new Quaternion();
  private readonly identity = Quaternion.Identity();

  constructor(rig: CharacterRig | PoseRigLike) {
    this.scene = rig.scene;
    this.nodesByName = rig.nodesByName;

    this.observer = this.scene.onAfterAnimationsObservable.add(() => {
      this.apply();
    });
  }

  /**
   * 適用するポーズレイヤーを差し替える。
   * offsets に存在しないボーン名は無視 (= そのボーンは素のアニメのまま)。
   */
  setLayer(layer: PoseLayer): void {
    const compiled: CompiledOffset[] = [];
    for (const [boneName, euler] of Object.entries(layer.offsets)) {
      const node = this.nodesByName.get(boneName);
      if (!node) continue;
      const [x, y, z] = euler;
      // 追加分が無いボーンはスキップ (無駄な合成を避ける)
      if (x === 0 && y === 0 && z === 0) continue;
      compiled.push({
        node,
        offset: Quaternion.FromEulerAngles(x, y, z),
        lastOut: null,
        lastBase: null,
      });
    }
    this.compiled = compiled;
    if (layer.weight !== undefined) this.weight = clamp01(layer.weight);
  }

  /** 全体の効き具合 (0..1) を設定 */
  setWeight(w: number): void {
    this.weight = clamp01(w);
  }

  /** 現在の weight */
  getWeight(): number {
    return this.weight;
  }

  /** アニメ評価後に呼ばれる本体 */
  private apply(): void {
    if (this.weight <= 0 || this.compiled.length === 0) return;

    for (const c of this.compiled) {
      const { node, offset } = c;
      // アニメが quaternion を書いていない場合は euler から補完しておく
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
      }
      const q = node.rotationQuaternion;

      // 累積防止: 現在値が「前回 apply 後の出力」と同じなら、このフレームは
      // アニメがボーンを書いていない (ワンショットクリップ終了後など)。
      // その場合は前回の合成前の値 (lastBase) を基準に合成し直す。
      // そうしないとオフセットが毎フレーム積み重なってボーンが回転し続ける。
      const animWrote = !(c.lastOut && q.equalsWithEpsilon(c.lastOut, 1e-7));
      const base = animWrote ? q : c.lastBase!;

      // 合成前の基準値を記録 (q を上書きする前に取る)
      if (!c.lastBase) c.lastBase = base.clone();
      else if (animWrote) c.lastBase.copyFrom(base);

      // weight に応じて offset を identity から slerp
      let applied: Quaternion;
      if (this.weight >= 1) {
        applied = offset;
      } else {
        Quaternion.SlerpToRef(this.identity, offset, this.weight, this.tmpBlended);
        applied = this.tmpBlended;
      }

      // final = base ⊗ applied (追加分はローカル回転なので右から掛ける)
      base.multiplyToRef(applied, this.tmpOut);
      q.copyFrom(this.tmpOut);

      // 次フレームの「アニメが書いたか」判定用に出力値を記録
      if (!c.lastOut) c.lastOut = q.clone();
      else c.lastOut.copyFrom(q);
    }
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onAfterAnimationsObservable.remove(this.observer);
      this.observer = null;
    }
    this.compiled = [];
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
