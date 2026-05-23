import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type {
  AnimatorLayer,
  AnimatorState,
  AnimatorTransition,
} from "./types";
import type { ParameterStore } from "./ParameterStore";

interface ActiveAnimation {
  state: AnimatorState;
  group: AnimationGroup | null;
  /** 経過秒。loop=true なら durationSeconds でラップする */
  elapsed: number;
  durationSeconds: number;
  /** クロスフェード中の重み (1 = フル) */
  weight: number;
}

interface FadeContext {
  fromState: ActiveAnimation;
  duration: number;
  elapsed: number;
}

/**
 * 1 レイヤー分のステートマシン実行系。
 *
 * - hasExitTime は「現在の State の正規化時間 (0..1) が exitTime 以上になったら遷移可能」と解釈
 *   (Unity 上の non-loop でも 1 を超えうるが、ここでは min(elapsed/duration, 1) でクランプ)
 * - 遷移の duration 秒で線形クロスフェードする
 *
 * BlendTree 等の高度な機能は MVP では非対応。
 */
export class LayerRuntime {
  readonly layer: AnimatorLayer;
  private readonly statesByName: Map<string, AnimatorState>;
  private readonly clipResolver: (clipName: string) => AnimationGroup | null;

  private current: ActiveAnimation;
  private fade: FadeContext | null = null;

  constructor(
    layer: AnimatorLayer,
    clipResolver: (clipName: string) => AnimationGroup | null,
  ) {
    this.layer = layer;
    this.clipResolver = clipResolver;
    this.statesByName = new Map(layer.states.map((s) => [s.name, s]));

    const initial = layer.defaultState
      ? this.statesByName.get(layer.defaultState)
      : layer.states[0];
    if (!initial) {
      throw new Error(`Layer '${layer.name}' has no states`);
    }
    this.current = this.activate(initial, 1);
  }

  get currentStateName(): string {
    return this.current.state.name;
  }

  /**
   * 現在の State の正規化時間 (0..1, loop なら fract、非 loop なら clamp)。
   */
  get normalizedTime(): number {
    if (this.current.durationSeconds <= 0) return 0;
    const t = this.current.elapsed / this.current.durationSeconds;
    return this.current.state.loop ? t - Math.floor(t) : Math.min(t, 1);
  }

  /**
   * @param dt 経過秒
   * @param parameters パラメータストア (条件評価と Trigger 消費に使う)
   * @returns 状態が変化したら新しい State 名、なければ null
   */
  update(dt: number, parameters: ParameterStore): string | null {
    // 1) 現在 State の時間を進める
    this.current.elapsed += dt * this.current.state.speed;

    // 2) クロスフェード進行
    if (this.fade) {
      this.fade.elapsed += dt;
      this.fade.fromState.elapsed += dt * this.fade.fromState.state.speed;
      const t = Math.min(this.fade.elapsed / this.fade.duration, 1);

      this.current.weight = t;
      this.fade.fromState.weight = 1 - t;
      this.applyWeights();

      if (t >= 1) {
        // フェード完了 — 旧 State を停止
        if (this.fade.fromState.group) {
          this.fade.fromState.group.stop();
        }
        this.fade = null;
        this.current.weight = 1;
        this.applyWeights();
      }
    }

    // 3) 遷移評価
    const transitioned = this.evaluateTransitions(parameters);
    return transitioned ? this.current.state.name : null;
  }

  /**
   * フェードと再生を停止する (シーン破棄時など)。
   */
  dispose(): void {
    if (this.fade?.fromState.group) this.fade.fromState.group.stop();
    if (this.current.group) this.current.group.stop();
  }

  // -------------------------------------------------------- Internal

  private evaluateTransitions(parameters: ParameterStore): boolean {
    // AnyState → 任意の State (現在 State 自身も対象、ただし silly な無限ループは
    // duration > 0 のフェードで自然に防がれる想定)
    for (const t of this.layer.anyStateTransitions) {
      if (this.tryTransition(t, parameters)) return true;
    }
    // current state の transitions
    for (const t of this.current.state.transitions) {
      if (this.tryTransition(t, parameters)) return true;
    }
    return false;
  }

  private tryTransition(
    transition: AnimatorTransition,
    parameters: ParameterStore,
  ): boolean {
    if (!transition.destination) return false;
    const dest = this.statesByName.get(transition.destination);
    if (!dest) return false;

    // hasExitTime: 現在 State がそのフレーム時点に達するまで待つ
    if (transition.hasExitTime) {
      if (this.normalizedTime < transition.exitTime) return false;
    }

    if (!parameters.evaluateConditions(transition.conditions)) {
      return false;
    }

    // 遷移成立
    parameters.consumeTriggers(transition.conditions);
    this.startTransition(dest, transition.duration);
    return true;
  }

  private startTransition(dest: AnimatorState, duration: number): void {
    // すでにフェード中なら旧 fade はキャンセル (旧 from を停止)
    if (this.fade?.fromState.group) this.fade.fromState.group.stop();

    const previous = this.current;

    const next = this.activate(dest, duration > 0 ? 0 : 1);
    this.current = next;

    if (duration > 0) {
      this.fade = {
        fromState: previous,
        duration,
        elapsed: 0,
      };
    } else {
      // 即時切替
      if (previous.group) previous.group.stop();
    }

    this.applyWeights();
  }

  private activate(state: AnimatorState, initialWeight: number): ActiveAnimation {
    const group = state.clip ? this.clipResolver(state.clip) : null;
    let durationSeconds = 0;

    if (group) {
      const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
      const frames = group.to - group.from;
      durationSeconds = frames > 0 ? frames / fps : 0;

      group.start(state.loop, state.speed, group.from, group.to, false);
      group.setWeightForAllAnimatables(initialWeight);
    }

    return {
      state,
      group,
      elapsed: 0,
      durationSeconds,
      weight: initialWeight,
    };
  }

  private applyWeights(): void {
    if (this.current.group) {
      this.current.group.setWeightForAllAnimatables(this.current.weight);
    }
    if (this.fade?.fromState.group) {
      this.fade.fromState.group.setWeightForAllAnimatables(
        this.fade.fromState.weight,
      );
    }
  }
}
