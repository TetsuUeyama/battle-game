/**
 * インポートしたボクセルスキンのランタイムストア (Phase 7-3)。
 *
 * スキンは三角形メッシュ + 位置合わせパラメータ。Fighter.load がここを見て、
 * スキンがあれば createVoxelFighter で「FAPモーションで動くボクセルキャラ」を生成する。
 *
 * バイナリ (数MB) なので localStorage には保存せず、セッション内のメモリ保持。
 * (永続化は IndexedDB が必要。将来対応。)
 */

import type { FightStyle } from './moves';
import type { TriangleMesh, JointMarkers } from '@/fighting';

export interface SkinConfig {
  /** ボクセル化する三角形メッシュ (GLB/FBX から抽出) */
  triangles: TriangleMesh;
  /** バインド用ポーズフィット (Tポーズモデルは 'tpose') */
  fitPose: 'none' | 'tpose';
  /**
   * Mixamo 式マーカーで合わせた関節ワールド座標 (全 MARKER_BONES)。
   * 指定時は createVoxelFighter が applyJointMarkers + keepPositionFor を行う。
   */
  markers?: JointMarkers;
  /** メッシュのヨー回転 (度) */
  yawDeg: number;
  /** 身長フィットへの追加倍率 */
  scale: number;
  /** 接地後の上下オフセット (m)。省略時 0 */
  offsetY?: number;
  /** ボクセル解像度 (最長軸セル数) */
  resolution: number;
  /** 取り込み元ファイル名 (表示用) */
  fileName: string;
}

const skins = new Map<FightStyle, SkinConfig>();

export function setSkin(style: FightStyle, cfg: SkinConfig): void {
  skins.set(style, cfg);
}

export function getSkin(style: FightStyle): SkinConfig | undefined {
  return skins.get(style);
}

export function clearSkin(style: FightStyle): void {
  skins.delete(style);
}

export function hasSkin(style: FightStyle): boolean {
  return skins.has(style);
}
