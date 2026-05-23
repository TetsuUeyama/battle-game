import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { LayerRuntime } from "./LayerRuntime";
import { ParameterStore } from "./ParameterStore";
import type { AnimatorJson } from "./types";

export interface AnimatorOptions {
  /**
   * Scene の onBeforeRenderObservable に自動でフックして毎フレーム update する。
   * 自前で update() したい場合は false にする。
   */
  autoTick?: boolean;
}

/**
 * AnimatorController を Babylon.js 上で再生するためのトップレベル API。
 *
 * 使い方:
 *   const animator = new Animator(scene, animatorJson, animationGroups);
 *   animator.setBool("isMoving", true);
 *   animator.setTrigger("attack");
 *
 * AnimationGroup は GLB を `SceneLoader.ImportMeshAsync` した結果から渡す想定で、
 * `clipName` と AnimationGroup.name が一致している必要がある。
 */
export class Animator {
  readonly parameters: ParameterStore;
  readonly layers: readonly LayerRuntime[];

  private readonly scene: Scene;
  private readonly groupsByName: ReadonlyMap<string, AnimationGroup>;
  private renderObserver: Observer<Scene> | null = null;
  private disposed = false;

  constructor(
    scene: Scene,
    json: AnimatorJson,
    animationGroups: readonly AnimationGroup[],
    options: AnimatorOptions = {},
  ) {
    this.scene = scene;
    this.parameters = new ParameterStore(json.parameters);

    // ローダー側で空の AnimationGroup が混じることがあるので name で索引化
    const map = new Map<string, AnimationGroup>();
    for (const g of animationGroups) {
      map.set(g.name, g);
      // Animator が手動で start するので最初は止めておく
      g.stop();
      g.setWeightForAllAnimatables(0);
    }
    this.groupsByName = map;

    this.layers = json.layers.map(
      (layer) =>
        new LayerRuntime(layer, (clipName) => map.get(clipName) ?? null),
    );

    if (options.autoTick !== false) {
      this.renderObserver = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        this.update(dt);
      });
    }
  }

  // ----------------------------------------------------- Parameters

  setBool(name: string, value: boolean): void {
    this.parameters.setBool(name, value);
  }
  setFloat(name: string, value: number): void {
    this.parameters.setFloat(name, value);
  }
  setInt(name: string, value: number): void {
    this.parameters.setInt(name, value);
  }
  setTrigger(name: string): void {
    this.parameters.setTrigger(name);
  }
  resetTrigger(name: string): void {
    this.parameters.resetTrigger(name);
  }

  // ----------------------------------------------------------- Tick

  update(dt: number): void {
    if (this.disposed) return;
    for (const layer of this.layers) {
      layer.update(dt, this.parameters);
    }
  }

  // ---------------------------------------------------- Inspection

  getCurrentState(layerIndex = 0): string | undefined {
    return this.layers[layerIndex]?.currentStateName;
  }

  getAvailableClips(): readonly string[] {
    return Array.from(this.groupsByName.keys());
  }

  // ------------------------------------------------------- Cleanup

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    for (const layer of this.layers) layer.dispose();
  }
}
