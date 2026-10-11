/**
 * マイキャラクター (Phase 7-4) のクライアント側リポジトリ。
 *
 * 画面はこの抽象越しにのみ読み書きする。実体は今は `/api/characters`
 * (プロジェクト内ファイル保存)。将来 DB ができたら API ルートの中身だけ
 * 差し替えれば、ここと画面は無改修で済む。
 */

import {
  serializeCharacter, deserializeCharacter,
  type CharacterRecord, type CharacterMeta, type SerializedCharacter,
} from './characterModel';

export { MAX_CHARACTERS } from './characterModel';

const BASE = '/api/characters';

/** 一覧 (軽量メタのみ)。失敗時は空配列 */
export async function listCharacters(): Promise<CharacterMeta[]> {
  try {
    const r = await fetch(BASE, { cache: 'no-store' });
    if (!r.ok) return [];
    const d = (await r.json()) as { characters?: CharacterMeta[] };
    return d.characters ?? [];
  } catch {
    return [];
  }
}

/** 1体を完全取得 (メッシュ込み)。無ければ null */
export async function getCharacter(id: string): Promise<CharacterRecord | null> {
  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const s = (await r.json()) as SerializedCharacter;
    return deserializeCharacter(s);
  } catch {
    return null;
  }
}

/** 保存 (新規/上書き)。失敗時は例外 */
export async function saveCharacter(rec: CharacterRecord): Promise<void> {
  const body = JSON.stringify(serializeCharacter(rec));
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`保存に失敗しました${msg ? `: ${msg}` : ''}`);
  }
}

/** 削除 */
export async function deleteCharacter(id: string): Promise<void> {
  await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 新規キャラ用の id を生成 */
export function newCharacterId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
