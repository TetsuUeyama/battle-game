// Model registry: lists available voxel models for battle-game
export type CharacterGender = 'male' | 'female';

const ASSETS_API = '/api/game-assets/vox-model';

export interface ModelEntry {
  id: string;           // unique identifier
  label: string;        // display name
  dir: string;          // directory under vox-model
  bodyFile: string;     // body .vox file path via API
  partsManifest: string; // parts.json path via API
  bodyKey: string;      // key in parts.json that identifies the body
  gender: CharacterGender; // character gender (affects motion selection)
}

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    id: 'vagrant',
    label: 'Vagrant',
    dir: 'box5',
    bodyFile: `${ASSETS_API}/box5/vagrant_rig_vagrant_body.vox`,
    partsManifest: `${ASSETS_API}/box5/vagrant_rig_parts.json`,
    bodyKey: 'vagrant_body',
    gender: 'male',
  },
  {
    id: 'cyberpunk_elf',
    label: 'Cyberpunk Elf',
    dir: 'box2',
    bodyFile: `${ASSETS_API}/box2/cyberpunk_elf_body_base.vox`,
    partsManifest: `${ASSETS_API}/box2/cyberpunk_elf_parts.json`,
    bodyKey: 'body',
    gender: 'female',
  },
  {
    id: 'queen_marika',
    label: 'Queen Marika',
    dir: 'box4-qm',
    bodyFile: `${ASSETS_API}/box4/queenmarika_rigged_mustardui_body.vox`,
    partsManifest: `${ASSETS_API}/box4/queenmarika_rigged_mustardui_parts.json`,
    bodyKey: 'body',
    gender: 'female',
  },
  {
    id: 'dark_elf',
    label: 'Dark Elf',
    dir: 'box4-de',
    bodyFile: `${ASSETS_API}/box4/darkelfblader_arp_body.vox`,
    partsManifest: `${ASSETS_API}/box4/darkelfblader_arp_parts.json`,
    bodyKey: 'body',
    gender: 'female',
  },
];

export function getModelById(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

export const DEFAULT_MODEL_ID = 'vagrant';
