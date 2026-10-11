/**
 * 技クリップの実フレーム長を取得する (MotionEdit のタイムライン表示用)。
 *
 * moves.ts の buildMoves は「クリップ実長 × 比率(pct)」でフレームを決めるため、
 * 「発生8F・持続4F」のような実フレーム数を出すにはクリップの実長が要る。
 * これは GLB をロードするまで分からない (FightGame は対戦開始時にロードする)。
 *
 * エディタは対戦シーンとは独立しているので、ここで NullEngine 上にアニメ GLB を
 * 1 回だけロードしてクリップ名→フレーム長/fps を取り出し、モジュールレベルで
 * キャッシュする (セッション中は再ロードしない)。3D 描画はしないので軽量。
 *
 * フレームはクリップ固有 fps の「ネイティブフレーム」。表示は格ゲー慣習に合わせて
 * 60fps 換算 (`toFrames60`) する。実時間 = ネイティブ/fps 秒なので 60fps 換算は
 * 実時間に忠実 (clip が 30fps なら 60fps-F は 2 倍になる)。
 */

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

import { ANIM_GLB_PATHS } from './moves';

/** 1 クリップ分の長さ情報 */
export interface ClipFrameInfo {
  /** クリップ固有 fps でのフレーム長 (to - from) */
  frames: number;
  /** クリップの framePerSecond (既定 60) */
  fps: number;
}

const ASSET_BASE = '/api/game-assets/fightingGamesystem/assets/';

let cache: Promise<Map<string, ClipFrameInfo>> | null = null;

/**
 * アニメ GLB 群をロードしてクリップ名→フレーム情報の Map を返す (キャッシュ付き)。
 * 失敗したクリップは Map に載らない (呼び出し側でフォールバック)。
 */
export function getClipFrameInfo(): Promise<Map<string, ClipFrameInfo>> {
  if (cache) return cache;
  cache = loadClipFrameInfo().catch((e) => {
    cache = null; // 失敗時は次回再試行できるようにする
    throw e;
  });
  return cache;
}

async function loadClipFrameInfo(): Promise<Map<string, ClipFrameInfo>> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const out = new Map<string, ClipFrameInfo>();
  try {
    for (const path of ANIM_GLB_PATHS) {
      const result = await ImportMeshAsync(ASSET_BASE + path, scene);
      for (const g of result.animationGroups) {
        const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
        out.set(g.name, { frames: g.to - g.from, fps });
        g.dispose();
      }
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
  return out;
}

/** ネイティブフレーム長 → 60fps 換算フレーム (格ゲー風 "F" 表示用) */
export function toFrames60(nativeFrames: number, fps: number): number {
  return Math.round((nativeFrames / fps) * 60);
}
