/**
 * アニメ遷移のクロスフェード補助。
 *
 * Babylon の per-animation blending (enableBlending) は「再生開始時の現在値 →
 * アニメ値」を自動補間するため、直前にどのクリップが流れていたかを知らずに
 * ポーズのポップを消せる。LayerRuntime のステートマシン統合より軽量な、
 * 素の AnimationGroup 再生向けの薄いヘルパ。
 */

import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

/**
 * group 内の全カーブにブレンドイン設定を上書きする。
 * fadeSec <= 0 で無効化 (即時切替)。group.start() の前に呼ぶこと。
 *
 * blendingSpeed は「1 評価フレームあたりのブレンド進行量 (0..1)」なので、
 * クリップの framePerSecond から fadeSec 秒ぶんを逆算する。
 */
export function configureBlending(group: AnimationGroup, fadeSec: number): void {
  const enable = fadeSec > 0;
  for (const ta of group.targetedAnimations) {
    const anim = ta.animation;
    anim.enableBlending = enable;
    if (enable) {
      const fps = anim.framePerSecond || 60;
      anim.blendingSpeed = 1 / Math.max(1, fadeSec * fps);
    }
  }
}

export interface StartWithBlendingOptions {
  /** ブレンドイン秒数。0/省略で即時切替 */
  fadeSec?: number;
  loop?: boolean;
  speedRatio?: number;
  /** 再生開始フレーム (省略時 group.from) */
  from?: number;
  /** 再生終了フレーム (省略時 group.to) */
  to?: number;
}

/**
 * AnimationGroup をクロスフェード付きで再生する。
 * idle ↔ ロコモーション ↔ リアクションなど、CombatController.playMove を
 * 経由しない素のクリップ切替に使う。
 */
export function startWithBlending(
  group: AnimationGroup,
  opts?: StartWithBlendingOptions,
): AnimationGroup {
  group.stop();
  configureBlending(group, opts?.fadeSec ?? 0);
  group.start(
    opts?.loop ?? false,
    opts?.speedRatio ?? 1,
    opts?.from ?? group.from,
    opts?.to ?? group.to,
    false,
  );
  group.setWeightForAllAnimatables(1);
  return group;
}
