/**
 * 3D 格闘ゲーム共通の型契約。
 *
 * プロデューサーが定義する「3システム共通の語彙」。
 *  - retarget (feature1): CharacterRig を「作る」側
 *  - pose     (feature2): CharacterRig を「装飾する」側
 *  - combat   (feature3): CharacterRig を「戦わせる」側
 *
 * 3システムはこのファイルのインターフェースにのみ依存し、互いの実装には依存しない。
 * これにより 3 人が並行実装してもコンパイル時に噛み合う。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { StandardBoneName } from "../avatar/StandardSkeleton";

// ----------------------------------------------------------------- Character

/**
 * ロード済み・リターゲット済みの戦闘キャラ。3システム共通の操作対象。
 * retarget システムが生成し、pose / combat システムが消費する。
 */
export interface CharacterRig {
  scene: Scene;
  /** キャラのルート TransformNode。Root Motion / 位置移動はここに適用する */
  root: TransformNode;
  /** スキン用スケルトン (無い GLB もあるため null 許容) */
  skeleton: Skeleton | null;
  /** 表示メッシュ群 (LOD 含む) */
  meshes: AbstractMesh[];
  /**
   * ボーン名 → 対応 TransformNode。hitbox の親付けや pose オフセットの
   * 適用点として使う。標準名ではなく「このリグ上の実ボーン名」をキーにする。
   */
  nodesByName: ReadonlyMap<string, TransformNode>;
  /** クリップ名 → このリグに適用済みの再生可能 AnimationGroup */
  clips: ReadonlyMap<string, AnimationGroup>;
}

// --------------------------------------------------- feature1: retarget/bind

/**
 * FAP モーションを「別モデル / 指定ボーン」に適用するための設定。
 * 同一リグなら不要 (名前一致でそのまま貼り替え)。
 */
export interface BindingProfile {
  /**
   * ターゲットモデルのボーン名 → ソース(FAP)ボーン名。
   * 省略時は名前一致 (＋必要なら StandardSkeleton 経由のブリッジ) を試みる。
   */
  boneNameMap?: Record<string, string>;
  /**
   * リグ差 (バインドポーズ/ボーン向きの違い) を吸収する回転補正。
   * ターゲットボーン名 → ローカル回転オフセット (オイラー角ラジアン)。
   */
  rotationFix?: Partial<Record<string, [number, number, number]>>;
  /** ソース名を標準名へ変換する辞書 (FAP 側 bone-mapping.json 由来) */
  sourceToStandard?: Partial<Record<string, StandardBoneName>>;
  /** ターゲット名を標準名へ変換する辞書 (ユーザモデル側) */
  targetToStandard?: Partial<Record<string, StandardBoneName>>;
}

// ----------------------------------------------------- feature2: pose layer

/**
 * キャラ個性のポーズレイヤー。ベースアニメ評価の「後」に毎フレーム適用する
 * 追加ローカル回転。腰の曲げ・肩の角度などの「らしさ」を足す。
 */
export interface PoseLayer {
  /** ボーン名 → 追加ローカル回転 (オイラー角ラジアン [x,y,z]) */
  offsets: Record<string, [number, number, number]>;
  /** 0..1。全体の効き具合 */
  weight?: number;
}

/** 注視・簡易IK などの手続き的調整の設定 */
export interface ProceduralPoseConfig {
  /** 頭を向ける対象ノード名 (BoneLookController 相当) */
  lookAtTarget?: string;
  /** 背骨を曲げる量 (ラジアン)。Spine 系ボーンへ配分 */
  spineBend?: number;
}

// ------------------------------------------------------- feature3: combat

/** 攻撃のフレームデータ (60fps 基準のフレーム番号) */
export interface MoveDefinition {
  id: string;
  /** 表示名 */
  label?: string;
  /** CharacterRig.clips のキー */
  clip: string;
  /** 発生 (このフレームまでは攻撃判定が出ない) */
  startup: number;
  /** 攻撃判定 ON 区間 [from, to] (フレーム) */
  active: [number, number];
  /** 硬直 (active 後、次の行動が取れないフレーム数) */
  recovery: number;
  /** クールタイム (このムーブを再度出せるまでのフレーム数) */
  cooldown: number;
  /** キャンセル可能な move id 群 (コンボルート) */
  cancelInto?: string[];
  /** この技の攻撃判定 */
  hitboxes: HitboxBinding[];
  /** ダメージ量 */
  damage?: number;
}

/** ボーン追従の攻撃判定 (球) */
export interface HitboxBinding {
  /** 追従するボーン名 (CharacterRig.nodesByName のキー) */
  bone: string;
  radius: number;
  /** ボーンローカルのオフセット */
  offset?: [number, number, number];
}

/** 被弾判定 (体側に常時付くカプセル/球) */
export interface HurtboxBinding {
  bone: string;
  radius: number;
  offset?: [number, number, number];
}

/** ヒット発生時に通知されるイベント */
export interface HitEvent {
  move: MoveDefinition;
  attacker: CharacterRig;
  defender: CharacterRig;
  /** ヒットした active フレーム */
  frame: number;
  /**
   * ヒットした防御側 hurtbox のボーン名 (Head/Spine1/Hips...)。
   * 高さ別やられ (High/Mid/Low) の選択に使う。
   */
  hurtboxBone: string;
  /** 攻撃側 hitbox のボーン名 (どの部位で当てたか) */
  hitboxBone: string;
  /**
   * ヒット位置 (ワールド座標 [x,y,z])。attacker/defender の root との
   * 相対位置から方向 (Left/Right/Front/Back) を引ける。
   */
  hitPosition: [number, number, number];
}
