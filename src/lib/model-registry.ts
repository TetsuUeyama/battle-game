// Model registry: lists available voxel models for bone-config and fbx-viewer
export type CharacterGender = 'male' | 'female';

export interface ModelEntry {
  id: string;           // unique identifier
  label: string;        // display name
  dir: string;          // directory under /public (e.g., "box5")
  bodyFile: string;     // body .vox file path (absolute from public)
  partsManifest: string; // parts.json path (absolute from public)
  bodyKey: string;      // key in parts.json that identifies the body
  gender: CharacterGender; // character gender (affects motion selection)
}

export const MODEL_REGISTRY: ModelEntry[] = [
  {
    id: 'vagrant',
    label: 'Vagrant',
    dir: 'box5',
    bodyFile: '/box5/vagrant_rig_vagrant_body.vox',
    partsManifest: '/box5/vagrant_rig_parts.json',
    bodyKey: 'vagrant_body',
    gender: 'male',
  },
  {
    id: 'cyberpunk_elf',
    label: 'Cyberpunk Elf',
    dir: 'box2',
    bodyFile: '/box2/cyberpunk_elf_body_base.vox',
    partsManifest: '/box2/cyberpunk_elf_parts.json',
    bodyKey: 'body',
    gender: 'female',
  },
  {
    id: 'queen_marika',
    label: 'Queen Marika',
    dir: 'box4-qm',
    bodyFile: '/box4/queenmarika_rigged_mustardui_body.vox',
    partsManifest: '/box4/queenmarika_rigged_mustardui_parts.json',
    bodyKey: 'body',  // no body key in parts — all parts are equipment
    gender: 'female',
  },
  {
    id: 'dark_elf',
    label: 'Dark Elf',
    dir: 'box4-de',
    bodyFile: '/box4/darkelfblader_arp_body.vox',
    partsManifest: '/box4/darkelfblader_arp_parts.json',
    bodyKey: 'body',
    gender: 'female',
  },
];

export function getModelById(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

export const DEFAULT_MODEL_ID = 'vagrant';
