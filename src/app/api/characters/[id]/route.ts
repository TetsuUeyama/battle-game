/**
 * マイキャラクター保存 API (Phase 7-4) — 個別。
 *
 *   GET    /api/characters/:id  … 1体を完全取得 (meta + mesh を結合した SerializedCharacter)
 *   DELETE /api/characters/:id  … 削除 (meta + mesh)
 *
 * 保存先は今はプロジェクト内 `data/characters/`。将来 DB へ移す際はこのルート実装のみ差し替える。
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'data', 'characters');
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const meta = await readJson(path.join(DIR, `${id}.json`));
  if (!meta || typeof meta !== 'object') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const mesh = await readJson(path.join(DIR, `${id}.mesh.json`));
  return NextResponse.json({ ...(meta as object), mesh });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!SAFE_ID.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  await fs.rm(path.join(DIR, `${id}.json`), { force: true });
  await fs.rm(path.join(DIR, `${id}.mesh.json`), { force: true });
  return NextResponse.json({ ok: true });
}
