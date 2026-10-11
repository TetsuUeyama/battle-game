/**
 * feature2: 手続き的ポーズ調整 (ProceduralPoseConfig の消費)。
 *
 * - spineBend: 背骨の前傾/後傾を Spine / Spine1 に配分する。
 * - lookAtTarget: 頭 (Neck / Head) を対象ノードへ向ける (注視)。
 *
 * いずれもアニメ評価の後に適用する必要があるため、内部的には
 * PoseLayerController と同じ `onAfterAnimationsObservable` のタイミングで走る。
 *
 * 実装方針:
 *  - spineBend は「静的な追加ローカル回転」なので PoseLayer に畳んで
 *    PoseLayerController へ委譲する (compileSpineBend)。
 *  - lookAt は対象の現在位置に依存する「動的」処理なので、独立した
 *    LookAtController が毎フレーム頭ボーンの回転を補正する。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Quaternion, Vector3, Matrix } from "@babylonjs/core/Maths/math.vector";

import type {
  CharacterRig,
  PoseLayer,
  ProceduralPoseConfig,
} from "../fighting/types";
import type { PoseRigLike } from "./PoseLayerController";

// ----------------------------------------------------------- spineBend

const SPINE_BONES = ["Spine", "Spine1"] as const;

/**
 * spineBend (ラジアン) を Spine 系ボーンへ配分した PoseLayer を作る。
 * 既存の offsets があればマージできるよう base を受け取る。
 *
 * 前傾は X 軸まわりの回転として表現する (一般的な humanoid のローカル X = 横軸)。
 * Spine と Spine1 で半分ずつ曲げると自然なアーチになる。
 */
export function compileSpineBend(
  spineBend: number,
  base?: PoseLayer,
): PoseLayer {
  const offsets: Record<string, [number, number, number]> = {
    ...(base?.offsets ?? {}),
  };
  const per = spineBend / SPINE_BONES.length;
  for (const bone of SPINE_BONES) {
    const prev = offsets[bone] ?? [0, 0, 0];
    offsets[bone] = [prev[0] + per, prev[1], prev[2]];
  }
  return { offsets, weight: base?.weight };
}

// ------------------------------------------------------------- lookAt

export interface LookAtOptions {
  /** 注視で回す頭側ボーン (既定: Neck と Head に配分) */
  bones?: string[];
  /** 0..1。注視の効き具合 */
  weight?: number;
  /**
   * ボーンのローカル「正面」軸。多くの humanoid GLB では頭ローカルの
   * +Y がモデル前方ではなく上方を向くため、向きが合わない場合に変更する。
   * 既定は +Z 前方。
   */
  forwardAxis?: Vector3;
}

/**
 * 頭ボーンを対象ノードへ向ける手続き的注視コントローラ。
 * 対象の現在ワールド位置に毎フレーム追従するため、アニメ評価後
 * (`onAfterAnimationsObservable`) にボーン回転を補正する。
 *
 * 手動 look-at: 頭ボーンの「親ローカル空間」で対象方向を求め、forwardAxis を
 * その方向へ向ける最小回転を作り、weight で slerp 合成する。
 */
export class LookAtController {
  private readonly scene: Scene;
  private readonly nodesByName: ReadonlyMap<string, TransformNode>;
  private observer: Observer<Scene> | null = null;

  private target: TransformNode | null = null;
  private bones: TransformNode[] = [];
  private weight = 1;
  private readonly forwardAxis: Vector3;

  // 使い回し用の一時オブジェクト
  private readonly tmpDirWorld = new Vector3();
  private readonly tmpDirLocal = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpMat = new Matrix();
  private readonly identity = Quaternion.Identity();

  constructor(rig: CharacterRig | PoseRigLike, options: LookAtOptions = {}) {
    this.scene = rig.scene;
    this.nodesByName = rig.nodesByName;
    this.weight = clamp01(options.weight ?? 1);
    this.forwardAxis = (options.forwardAxis ?? new Vector3(0, 0, 1)).clone();
    this.forwardAxis.normalize();

    const boneNames = options.bones ?? ["Neck", "Head"];
    for (const n of boneNames) {
      const node = this.nodesByName.get(n);
      if (node) this.bones.push(node);
    }

    this.observer = this.scene.onAfterAnimationsObservable.add(() => {
      this.apply();
    });
  }

  /** 注視対象ノードを設定 (名前 or TransformNode)。null で注視解除 */
  setTarget(target: TransformNode | string | null): void {
    if (target === null) {
      this.target = null;
    } else if (typeof target === "string") {
      this.target = this.nodesByName.get(target) ?? null;
    } else {
      this.target = target;
    }
  }

  /** 注視の効き具合 (0..1)。0 で実質 OFF */
  setWeight(w: number): void {
    this.weight = clamp01(w);
  }

  private apply(): void {
    const target = this.target;
    if (!target || this.weight <= 0 || this.bones.length === 0) return;

    const targetPos = target.getAbsolutePosition();
    // 複数ボーンへ分配 (Neck → Head の順で少しずつ向ける)
    const per = 1 / this.bones.length;

    for (const bone of this.bones) {
      bone.computeWorldMatrix(true);
      const headPos = bone.getAbsolutePosition();

      // ワールド空間での対象方向
      targetPos.subtractToRef(headPos, this.tmpDirWorld);
      if (this.tmpDirWorld.lengthSquared() < 1e-8) continue;
      this.tmpDirWorld.normalize();

      // 親ワールド行列の逆で「親ローカル空間」へ方向を変換
      const parent = bone.parent as TransformNode | null;
      if (parent) {
        parent.computeWorldMatrix(true);
        parent.getWorldMatrix().invertToRef(this.tmpMat);
        Vector3.TransformNormalToRef(
          this.tmpDirWorld,
          this.tmpMat,
          this.tmpDirLocal,
        );
      } else {
        this.tmpDirLocal.copyFrom(this.tmpDirWorld);
      }
      this.tmpDirLocal.normalize();

      // forwardAxis を dirLocal へ向ける最小回転
      rotationFromTo(this.forwardAxis, this.tmpDirLocal, this.tmpQuat);

      // weight × per ぶんだけ identity から slerp して合成
      const w = this.weight * per;
      ensureQuaternion(bone);
      const base = bone.rotationQuaternion!;
      if (w >= 1) {
        base.multiplyToRef(this.tmpQuat, base);
      } else {
        Quaternion.SlerpToRef(this.identity, this.tmpQuat, w, this.tmpQuat);
        base.multiplyToRef(this.tmpQuat, base);
      }
    }
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onAfterAnimationsObservable.remove(this.observer);
      this.observer = null;
    }
    this.bones = [];
    this.target = null;
  }
}

/** node.rotationQuaternion が無ければ euler から作る */
function ensureQuaternion(node: TransformNode): void {
  if (!node.rotationQuaternion) {
    node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
  }
}

/**
 * 単位ベクトル from を to へ向ける最小回転クォータニオンを result に書く。
 */
function rotationFromTo(from: Vector3, to: Vector3, result: Quaternion): void {
  const dot = Vector3.Dot(from, to);
  if (dot >= 1 - 1e-6) {
    // 既に同方向
    result.copyFromFloats(0, 0, 0, 1);
    return;
  }
  if (dot <= -1 + 1e-6) {
    // 真逆 → from に直交する任意軸で 180°
    const axis = Math.abs(from.x) < 0.9
      ? Vector3.Cross(from, Vector3Right)
      : Vector3.Cross(from, Vector3Up);
    axis.normalize();
    Quaternion.RotationAxisToRef(axis, Math.PI, result);
    return;
  }
  const axis = Vector3.Cross(from, to);
  axis.normalize();
  const angle = Math.acos(clampNeg1To1(dot));
  Quaternion.RotationAxisToRef(axis, angle, result);
}

const Vector3Right = new Vector3(1, 0, 0);
const Vector3Up = new Vector3(0, 1, 0);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampNeg1To1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * ProceduralPoseConfig を消費して、spineBend と lookAt をまとめて
 * 適用するための高レベル結果。page 側からはこれだけ使えばよい。
 */
export interface ProceduralPoseResult {
  /** spineBend を畳んだ PoseLayer (PoseLayerController.setLayer に渡す) */
  spineLayer: PoseLayer;
  /** lookAtTarget があれば生成された注視コントローラ (無ければ null) */
  lookAt: LookAtController | null;
}

/**
 * ProceduralPoseConfig 全体を一括適用するヘルパ。
 * spineBend は PoseLayer として返し (呼び出し側で PoseLayerController に渡す)、
 * lookAtTarget があれば LookAtController を生成して返す。
 */
export function applyProceduralPose(
  rig: CharacterRig | PoseRigLike,
  config: ProceduralPoseConfig,
  base?: PoseLayer,
  lookAtOptions?: LookAtOptions,
): ProceduralPoseResult {
  const spineLayer =
    config.spineBend !== undefined && config.spineBend !== 0
      ? compileSpineBend(config.spineBend, base)
      : (base ?? { offsets: {} });

  let lookAt: LookAtController | null = null;
  if (config.lookAtTarget) {
    lookAt = new LookAtController(rig, lookAtOptions);
    lookAt.setTarget(config.lookAtTarget);
  }

  return { spineLayer, lookAt };
}
