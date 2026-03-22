import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ASSETS_BASE = process.env.GAME_ASSETS_DIR || 'C:\\Users\\user\\developsecond\\game-assets';

interface EquipmentPiece {
  key: string;
  equipment_type: string;
  grip_config: {
    default_grip: string;
    dominant_hand: string;
    primary_grip: { position: { x: number; y: number; z: number } } | null;
  };
  direction?: {
    tip_position: { x: number; y: number; z: number };
    pommel_position: { x: number; y: number; z: number };
  };
}

interface EquipmentMeta {
  version: number;
  model_dir: string;
  pieces: Record<string, EquipmentPiece>;
}

export interface ConfiguredWeaponInfo {
  category: string;
  pieceKey: string;
  gripPosition: { x: number; y: number; z: number };
  tipPosition: { x: number; y: number; z: number };
  pommelPosition: { x: number; y: number; z: number };
}

/**
 * GET /api/configured-weapons
 * Scans wapons/ directory for all weapons with grip position + direction configured.
 */
export async function GET() {
  const waponsDir = path.join(ASSETS_BASE, 'wapons');
  if (!fs.existsSync(waponsDir)) {
    return NextResponse.json({ weapons: [] });
  }

  const categories = fs.readdirSync(waponsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const weapons: ConfiguredWeaponInfo[] = [];

  for (const category of categories) {
    const metaPath = path.join(waponsDir, category, 'equipment_meta.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const raw = fs.readFileSync(metaPath, 'utf-8');
      const meta: EquipmentMeta = JSON.parse(raw);

      for (const [key, piece] of Object.entries(meta.pieces)) {
        const grip = piece.grip_config?.primary_grip?.position;
        const dir = piece.direction;
        if (!grip || !dir) continue;

        // also verify the .vox file exists
        const voxPath = path.join(waponsDir, category, key, `${key}.vox`);
        if (!fs.existsSync(voxPath)) continue;

        weapons.push({
          category,
          pieceKey: key,
          gripPosition: grip,
          tipPosition: dir.tip_position,
          pommelPosition: dir.pommel_position,
        });
      }
    } catch {
      // skip broken meta files
    }
  }

  return NextResponse.json({ weapons }, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
