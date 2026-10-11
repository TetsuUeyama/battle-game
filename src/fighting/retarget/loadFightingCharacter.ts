/**
 * feature1 (retarget/bind) の中心 API。
 *
 * モデル GLB を 1 つロードし、複数のアニメ GLB からクリップを取り出して
 * BindingProfile に従ってモデル側ノードへ貼り替え、共通契約 `CharacterRig`
 * を生成して返す。pose(feature2) / combat(feature3) はこの CharacterRig を
 * 消費する。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
// 関数版 ImportMeshAsync (v7.34+/v8)。SceneLoader.ImportMeshAsync は v8 で
// deprecated のためこちらを使う。
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";

import "@babylonjs/loaders/glTF";

import type { CharacterRig, BindingProfile } from "../fighting/types";
import {
  retarget,
  type RetargetResult,
  type RetargetOptions,
} from "./retarget";

export interface LoadFightingCharacterOptions {
  /** baseUrl からの相対パス。モデル(可視メッシュ+スケルトン)の GLB */
  modelGlbPath: string;
  /**
   * baseUrl からの相対パス。アニメだけが入った GLB 群。
   * preloadedAnimations を使う場合は省略可 (両方指定なら両方バインドされる)。
   */
  animGlbPaths?: string[];
  /**
   * preloadAnimations() で先読みしたアニメ群。複数キャラで共有でき、
   * 2 体目以降の GLB 再ダウンロード+再パースを省ける。
   */
  preloadedAnimations?: PreloadedAnimations;
  /** リターゲット設定。省略時は同一リグ(名前一致)経路 */
  binding?: BindingProfile;
  /** リターゲット時のトラック制御 (keepPositionFor 等) */
  retargetOptions?: RetargetOptions;
  /** アセットのベース URL。既定 "/assets/" */
  baseUrl?: string;
  /**
   * ロード進捗 (GLB ファイル単位)。loaded はロード完了済みファイル数、
   * total は対象ファイル総数 (モデル 1 + アニメ GLB 数)、path は直近に
   * 完了したファイル。進捗バー表示用。
   */
  onProgress?: (loaded: number, total: number, path: string) => void;
}

/** loadFightingCharacter の戻り。CharacterRig + リターゲット統計 */
export interface FightingCharacter {
  rig: CharacterRig;
  /** 取り込んだ各アニメ GLB のリターゲット統計 (UI 表示用) */
  retargetStats: RetargetResult[];
}

/**
 * モデル + アニメ GLB 群をロードしてリターゲット済み CharacterRig を作る。
 *
 * 処理:
 *  1. モデル GLB をロード (mesh + skeleton + transformNodes)。LOD1+ は非表示。
 *  2. 各アニメ GLB をロードし AnimationGroup を取り出す。
 *  3. binding に従ってモデル側ノードへクリップを貼り替える。
 *  4. アニメ GLB 側の rig/mesh/元グループは dispose。
 *  5. CharacterRig(root, skeleton, meshes, nodesByName, clips) を返す。
 */
export async function loadFightingCharacter(
  scene: Scene,
  opts: LoadFightingCharacterOptions,
): Promise<FightingCharacter> {
  const baseUrl = normalizeBase(opts.baseUrl ?? "/assets/");
  const animGlbPaths = opts.animGlbPaths ?? [];
  const totalFiles = 1 + animGlbPaths.length;
  let loadedFiles = 0;
  const reportProgress = (path: string): void => {
    loadedFiles++;
    opts.onProgress?.(loadedFiles, totalFiles, path);
  };

  // 1) モデル GLB
  const model = await importGlb(scene, baseUrl + opts.modelGlbPath);
  hideNonLod0(model.meshes);
  reportProgress(opts.modelGlbPath);

  // 貼り替え先 = モデル側の全ノード (transformNode + mesh)。
  // GLB の skin joint は transformNode として現れるためこれで網羅できる。
  const targetNodes: Node[] = [...model.transformNodes, ...model.meshes];

  // nodesByName: ボーン名 → TransformNode (mesh は除外、joint/ボーン階層のみ)
  const nodesByName = new Map<string, TransformNode>();
  for (const tn of model.transformNodes) {
    if (!nodesByName.has(tn.name)) nodesByName.set(tn.name, tn);
  }

  // 2)+3) アニメ GLB をロード → リターゲット
  const clips = new Map<string, AnimationGroup>();
  const retargetStats: RetargetResult[] = [];

  for (const animPath of animGlbPaths) {
    const anim = await importGlb(scene, baseUrl + animPath);

    const result = retarget(
      scene,
      anim.animationGroups,
      targetNodes,
      opts.binding,
      opts.retargetOptions,
    );
    retargetStats.push(result);

    for (const g of result.groups) {
      g.stop();
      // 同名クリップが複数 GLB に出る場合は後勝ち。基本は一意。
      clips.set(g.name, g);
    }

    // 4) アニメ GLB の元データを破棄 (rig / mesh / 元グループ)
    for (const g of anim.animationGroups) g.dispose();
    for (const n of anim.transformNodes) n.dispose();
    for (const s of anim.skeletons) s.dispose();
    for (const m of anim.meshes) m.dispose();

    reportProgress(animPath);
  }

  // 2') 先読み済みアニメがあればそれもバインド (ネットワーク/パース無し)
  if (opts.preloadedAnimations) {
    const bound = opts.preloadedAnimations.bindTo(
      targetNodes,
      opts.binding,
      opts.retargetOptions,
    );
    retargetStats.push(...bound.stats);
    for (const [name, g] of bound.clips) clips.set(name, g);
  }

  // root: __root__ があればそれ、無ければ親を持たない最初の TransformNode
  const root = findRoot(model.transformNodes, model.meshes, scene);

  const rig: CharacterRig = {
    scene,
    root,
    skeleton: model.skeletons[0] ?? null,
    meshes: model.meshes,
    nodesByName,
    clips,
  };

  return { rig, retargetStats };
}

interface GlbResult {
  meshes: AbstractMesh[];
  transformNodes: TransformNode[];
  skeletons: Skeleton[];
  animationGroups: AnimationGroup[];
}

async function importGlb(scene: Scene, url: string): Promise<GlbResult> {
  const res = await ImportMeshAsync(url, scene);
  return {
    meshes: res.meshes,
    transformNodes: res.transformNodes,
    skeletons: res.skeletons,
    animationGroups: res.animationGroups,
  };
}

// ------------------------------------------------------------- preload/share

/**
 * preloadAnimations() の戻り。アニメ GLB のソースデータ (非表示リグ +
 * AnimationGroup) を保持し、bindTo() で任意のターゲットへ何度でも
 * リターゲットできる。retarget() は Animation.clone() ベースなので、
 * バインド後もソースは独立して生き続ける。
 *
 * 全キャラのバインドが終わって以後使わないなら dispose() でソースを破棄する
 * (バインド済みクリップは clone 済みのため影響しない)。
 */
export class PreloadedAnimations {
  private readonly scene: Scene;
  private sources: GlbResult[] = [];
  /** ロード元パス (デバッグ/進捗表示用) */
  readonly paths: readonly string[];

  constructor(scene: Scene, sources: GlbResult[], paths: string[]) {
    this.scene = scene;
    this.sources = sources;
    this.paths = paths;
  }

  /**
   * 保持しているソースクリップをターゲットノード群へリターゲットする。
   * ネットワーク・GLB パースは発生しない。
   */
  bindTo(
    targetNodes: readonly Node[],
    binding?: BindingProfile,
    retargetOptions?: RetargetOptions,
  ): { clips: Map<string, AnimationGroup>; stats: RetargetResult[] } {
    const clips = new Map<string, AnimationGroup>();
    const stats: RetargetResult[] = [];
    for (const src of this.sources) {
      const result = retarget(
        this.scene,
        src.animationGroups,
        targetNodes,
        binding,
        retargetOptions,
      );
      stats.push(result);
      for (const g of result.groups) {
        g.stop();
        clips.set(g.name, g);
      }
    }
    return { clips, stats };
  }

  /** ソース GLB のリグ・クリップを破棄する。以後 bindTo() は不可 */
  dispose(): void {
    for (const src of this.sources) {
      for (const g of src.animationGroups) g.dispose();
      for (const n of src.transformNodes) n.dispose();
      for (const s of src.skeletons) s.dispose();
      for (const m of src.meshes) m.dispose();
    }
    this.sources = [];
  }
}

export interface PreloadAnimationsOptions {
  /** アセットのベース URL。既定 "/assets/" */
  baseUrl?: string;
  /** GLB ファイル単位の進捗 (loadFightingCharacter と同形式) */
  onProgress?: (loaded: number, total: number, path: string) => void;
}

/**
 * アニメ GLB 群を 1 回だけロードし、複数キャラへ共有バインドできる
 * PreloadedAnimations を返す (A-7: 同型 2 体で GLB を二重ロードしない)。
 *
 * 使い方:
 * ```ts
 * const pre = await preloadAnimations(scene, animGlbPaths);
 * const p1 = await loadFightingCharacter(scene, { modelGlbPath, preloadedAnimations: pre });
 * const p2 = await loadFightingCharacter(scene, { modelGlbPath, preloadedAnimations: pre });
 * pre.dispose(); // もうバインドしないなら破棄
 * ```
 */
export async function preloadAnimations(
  scene: Scene,
  animGlbPaths: string[],
  opts?: PreloadAnimationsOptions,
): Promise<PreloadedAnimations> {
  const baseUrl = normalizeBase(opts?.baseUrl ?? "/assets/");
  const sources: GlbResult[] = [];
  let loaded = 0;
  for (const path of animGlbPaths) {
    const src = await importGlb(scene, baseUrl + path);
    // ソースリグは表示しない (アニメ GLB は通常メッシュ無しだが念のため)
    for (const m of src.meshes) m.setEnabled(false);
    for (const g of src.animationGroups) g.stop();
    sources.push(src);
    loaded++;
    opts?.onProgress?.(loaded, animGlbPaths.length, path);
  }
  return new PreloadedAnimations(scene, sources, animGlbPaths);
}

/** LOD1 以降のメッシュを非表示にする (LOD0 のみ可視) */
function hideNonLod0(meshes: readonly AbstractMesh[]): void {
  for (const m of meshes) {
    if (/_LOD[1-9]/i.test(m.name)) m.setEnabled(false);
  }
}

/** baseUrl 末尾に / を保証 */
function normalizeBase(base: string): string {
  return base.endsWith("/") ? base : base + "/";
}

/**
 * キャラのルート TransformNode を決める。
 * glTF ローダは "__root__" を作るのでそれを優先。無ければ親無しの
 * TransformNode、それも無ければ新規に空の root を作って包む。
 */
function findRoot(
  transformNodes: readonly TransformNode[],
  meshes: readonly AbstractMesh[],
  scene: Scene,
): TransformNode {
  const gltfRoot = [...transformNodes, ...meshes].find(
    (n) => n.name === "__root__",
  );
  if (gltfRoot instanceof TransformNode) return gltfRoot;

  const parentless = transformNodes.find((n) => !n.parent);
  if (parentless) return parentless;

  // フォールバック: 包む空ノード (通常ここには来ない)
  return new TransformNode("characterRoot", scene);
}
