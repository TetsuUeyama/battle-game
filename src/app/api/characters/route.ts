/**
 * マイキャラクター保存 API (Phase 7-4) — コレクション。
 *
 *   GET  /api/characters       … 一覧 (軽量メタのみ。mesh は含まない)
 *   POST /api/characters       … 保存 (body = SerializedCharacter)。meta と mesh を別ファイルへ
 *
 * 保存先は今はプロジェクト内 `data/characters/`。将来 DB へ移す際はこのルート実装のみ
 * 差し替える (client の characterStore は無改修)。
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'data', 'characters');
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

async function ensureDir(): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
}

export async function GET(): Promise<NextResponse> {
  await ensureDir();
  const files = await fs.readdir(DIR);
  const characters: unknown[] = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.mesh.json')) continue;
    try {
      characters.push(JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8')));
    } catch {
      // 壊れたファイルは無視
    }
  }
  return NextResponse.json({ characters });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  await ensureDir();
  let body: { id?: string; mesh?: unknown; [k: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const id = body.id;
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  // mesh とメタを分離して保存 (一覧はメタだけ読むので軽い)
  const { mesh, ...meta } = body;
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(meta));
  await fs.writeFile(path.join(DIR, `${id}.mesh.json`), JSON.stringify(mesh ?? null));
  return NextResponse.json({ ok: true });
}
