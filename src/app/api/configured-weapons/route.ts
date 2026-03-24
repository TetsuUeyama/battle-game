import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ASSETS_BASE = process.env.GAME_ASSETS_DIR || 'C:\\Users\\user\\developsecond\\game-assets';

interface GripEntry {
  position: { x: number; y: number; z: number };
  is_primary: boolean;
}

interface EquipmentPiece {
  key: string;
  equipment_type: string;
  grip_config: {
    default_grip: string;
    switchable: boolean;
    dominant_hand: string;
    primary_grip: GripEntry | null;
    secondary_grip?: GripEntry | null;
  };
  direction?: {
    tip_position: { x: number; y: number; z: number };
    pommel_position: { x: number; y: number; z: number };
  };
  weight?: number;
  attack_voxels?: Record<string, string>;
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
  secondaryGripPosition: { x: number; y: number; z: number } | null;
  tipPosition: { x: number; y: number; z: number };
  pommelPosition: { x: number; y: number; z: number };
  weight: number;
  defaultGrip: string;
  switchable: boolean;
  attackVoxels: Record<string, string>;
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
          secondaryGripPosition: piece.grip_config.secondary_grip?.position ?? null,
          tipPosition: dir.tip_position,
          pommelPosition: dir.pommel_position,
          weight: piece.weight ?? 1000,
          defaultGrip: piece.grip_config.default_grip ?? 'one_hand',
          switchable: piece.grip_config.switchable ?? false,
          attackVoxels: piece.attack_voxels ?? {},
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
