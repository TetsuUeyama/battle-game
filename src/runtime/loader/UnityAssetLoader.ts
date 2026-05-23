import type { Scene } from "@babylonjs/core/scene";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";

import "@babylonjs/loaders/glTF";

import type {
  AnimatorJson,
  AssetManifestEntry,
  AssetManifestJson,
  BoneMappingJson,
} from "../animator/types";
import { Animator, type AnimatorOptions } from "../animator/Animator";
import { fromJsonEntries, type BoneMapping } from "../avatar/BoneMapping";

export interface LoadedUnityAsset {
  entry: AssetManifestEntry;
  meshes: AbstractMesh[];
  skeletons: Skeleton[];
  animationGroups: AnimationGroup[];
  /** Animator JSON があれば構築済みの Animator を返す */
  animator?: Animator;
  /** UI などで定義側を参照したいとき用に raw JSON も同梱 */
  animatorJson?: AnimatorJson;
  /** Unity 側が出した raw JSON (entries 配列形式) */
  boneMappingJson?: BoneMappingJson;
  /** 上記をオブジェクト形式に変換した、Runtime で使いやすい形 */
  boneMapping?: BoneMapping;
}

export interface UnityAssetLoaderOptions {
  /** assets フォルダ (manifest が置いてある場所) のベース URL。既定 `/assets/` */
  baseUrl?: string;
  animator?: AnimatorOptions;
}

/**
 * Unity Editor 拡張が出力した `assets-manifest.json` を起点に、
 * GLB / Animator JSON / BoneMapping JSON をまとめて読み込む。
 *
 * 想定ディレクトリ:
 *   public/assets/
 *     assets-manifest.json
 *     <asset-id>/
 *       <asset-id>.glb
 *       animator.json        (任意)
 *       bone-mapping.json    (任意)
 */
export class UnityAssetLoader {
  private readonly baseUrl: string;
  private readonly animatorOptions?: AnimatorOptions;
  private manifestCache: AssetManifestJson | null = null;

  constructor(options: UnityAssetLoaderOptions = {}) {
    const base = options.baseUrl ?? "/assets/";
    this.baseUrl = base.endsWith("/") ? base : base + "/";
    this.animatorOptions = options.animator;
  }

  async loadManifest(): Promise<AssetManifestJson> {
    if (this.manifestCache) return this.manifestCache;
    const res = await fetch(this.baseUrl + "assets-manifest.json");
    if (!res.ok) {
      throw new Error(
        `Failed to load assets-manifest.json from ${this.baseUrl}: ${res.status}`,
      );
    }
    this.manifestCache = (await res.json()) as AssetManifestJson;
    return this.manifestCache;
  }

  async load(scene: Scene, assetId: string): Promise<LoadedUnityAsset> {
    const manifest = await this.loadManifest();
    const entry = manifest.assets.find((a) => a.id === assetId);
    if (!entry) {
      throw new Error(`Asset '${assetId}' not found in manifest`);
    }
    return this.loadEntry(scene, entry);
  }

  async loadEntry(
    scene: Scene,
    entry: AssetManifestEntry,
  ): Promise<LoadedUnityAsset> {
    if (!entry.glbPath) {
      throw new Error(
        `Asset '${entry.id}' has no glbPath — only AnimatorController exports cannot be loaded as a scene`,
      );
    }

    const glbUrl = this.baseUrl + entry.glbPath;
    const idx = glbUrl.lastIndexOf("/");
    const rootUrl = glbUrl.substring(0, idx + 1);
    const fileName = glbUrl.substring(idx + 1);

    const result = await SceneLoader.ImportMeshAsync(
      "",
      rootUrl,
      fileName,
      scene,
    );

    const [animatorJson, boneMapping] = await Promise.all([
      entry.animatorPath ? this.fetchJson<AnimatorJson>(entry.animatorPath) : null,
      entry.boneMappingPath
        ? this.fetchJson<BoneMappingJson>(entry.boneMappingPath)
        : null,
    ]);

    let animator: Animator | undefined;
    if (animatorJson) {
      animator = new Animator(
        scene,
        animatorJson,
        result.animationGroups,
        this.animatorOptions,
      );
    }

    return {
      entry,
      meshes: result.meshes,
      skeletons: result.skeletons,
      animationGroups: result.animationGroups,
      animator,
      animatorJson: animatorJson ?? undefined,
      boneMappingJson: boneMapping ?? undefined,
      boneMapping: boneMapping ? fromJsonEntries(boneMapping) : undefined,
    };
  }

  private async fetchJson<T>(relativePath: string): Promise<T> {
    const res = await fetch(this.baseUrl + relativePath);
    if (!res.ok) {
      throw new Error(`Failed to load ${relativePath}: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
