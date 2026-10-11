/**
 * マイキャラクター (Phase 7-4) のデータ模型とシリアライズ。
 *
 * 自分が作るキャラ (最大3体) は「自作ボクセルスキン + 技スタイル + ステータス + 体格」。
 * 保存は差し替え前提のストレージ層 (characterStore → /api/characters) を通すため、
 * ここでは保存に乗せる JSON 表現 (SerializedCharacter) と相互変換のみを定義する。
 *
 * 三角形メッシュ (数MB) は TypedArray なので base64 にして JSON へ載せる。
 * base64 変換はブラウザ側でのみ行う (API ルートは受け取った JSON をそのまま保管する)。
 */

import type { TriangleMesh, JointMarkers } from '@/fighting';
import type { FightStyle, MoveOverride } from './moves';
import type { CharStats } from './stats';

/** 自作スキンの構築パラメータ (createVoxelFighter / skinStore.SkinConfig と整合) */
export interface CharacterSkin {
  triangles: TriangleMesh;
  markers?: JointMarkers;
  fitPose: 'none' | 'tpose';
  yawDeg: number;
  scale: number;
  offsetY: number;
  resolution: number;
  fileName: string;
}

/** ランタイムで扱うキャラ1体 (メッシュ実体つき) */
export interface CharacterRecord {
  id: string;
  name: string;
  /** 技セット (動き)。見た目はスキン */
  style: FightStyle;
  /** ステータス上書き (null = スタイル既定 STYLE_STATS) */
  stats: CharStats | null;
  /** 体格上書き (null = スタイル既定 STYLE_BODY) */
  body: { width: number; height: number } | null;
  /**
   * 技ごとのモーション上書き (発生/判定/硬直/CT/ダメージ)。
   * 「既定と異なる技だけ」入る自己完結した辞書。null/空 = スタイル既定。
   */
  moves: Record<string, MoveOverride> | null;
  skin: CharacterSkin;
  updatedAt: number;
}

/** 一覧表示用の軽量メタ (mesh を含まない) */
export interface CharacterMeta {
  id: string;
  name: string;
  style: FightStyle;
  stats: CharStats | null;
  body: { width: number; height: number } | null;
  moves: Record<string, MoveOverride> | null;
  skin: {
    markers: JointMarkers | null;
    fitPose: 'none' | 'tpose';
    yawDeg: number;
    scale: number;
    offsetY: number;
    resolution: number;
    fileName: string;
  };
  updatedAt: number;
}

/** メッシュの base64 表現 */
export interface SerializedMesh {
  positions: string;
  indices: string;
  triangleColors: string | null;
}

/** 保存に乗せる完全表現 (メタ + メッシュ) */
export interface SerializedCharacter extends CharacterMeta {
  mesh: SerializedMesh;
}

export const MAX_CHARACTERS = 3;

// ----------------------------------------------------------------- base64 (browser)

function u8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000; // 引数長制限を避けてチャンク連結
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeF32(a: Float32Array): string {
  return u8ToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}
function decodeF32(s: string): Float32Array {
  const b = base64ToU8(s);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
function encodeU32(a: Uint32Array): string {
  return u8ToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
}
function decodeU32(s: string): Uint32Array {
  const b = base64ToU8(s);
  return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

// ----------------------------------------------------------------- 変換

/** CharacterRecord → 保存表現 (ブラウザ側) */
export function serializeCharacter(rec: CharacterRecord): SerializedCharacter {
  const t = rec.skin.triangles;
  return {
    id: rec.id,
    name: rec.name,
    style: rec.style,
    stats: rec.stats,
    body: rec.body,
    moves: rec.moves,
    skin: {
      markers: rec.skin.markers ?? null,
      fitPose: rec.skin.fitPose,
      yawDeg: rec.skin.yawDeg,
      scale: rec.skin.scale,
      offsetY: rec.skin.offsetY,
      resolution: rec.skin.resolution,
      fileName: rec.skin.fileName,
    },
    updatedAt: rec.updatedAt,
    mesh: {
      positions: encodeF32(t.positions),
      indices: encodeU32(t.indices),
      triangleColors: t.triangleColors ? encodeF32(t.triangleColors) : null,
    },
  };
}

/** 保存表現 → CharacterRecord (ブラウザ側) */
export function deserializeCharacter(s: SerializedCharacter): CharacterRecord {
  const triangles: TriangleMesh = {
    positions: decodeF32(s.mesh.positions),
    indices: decodeU32(s.mesh.indices),
    triangleColors: s.mesh.triangleColors ? decodeF32(s.mesh.triangleColors) : undefined,
  };
  return {
    id: s.id,
    name: s.name,
    style: s.style,
    stats: s.stats,
    body: s.body,
    moves: s.moves ?? null,
    skin: {
      triangles,
      markers: s.skin.markers ?? undefined,
      fitPose: s.skin.fitPose,
      yawDeg: s.skin.yawDeg,
      scale: s.skin.scale,
      offsetY: s.skin.offsetY,
      resolution: s.skin.resolution,
      fileName: s.skin.fileName,
    },
    updatedAt: s.updatedAt,
  };
}
