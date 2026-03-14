// Shared VOX parser and types
export interface VoxModel {
  sizeX: number; sizeY: number; sizeZ: number;
  voxels: { x: number; y: number; z: number; colorIndex: number }[];
  palette: { r: number; g: number; b: number }[];
}

export interface VoxelEntry {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

export function parseVox(buf: ArrayBuffer): VoxModel {
  const view = new DataView(buf);
  let offset = 0;
  const readU32 = () => { const v = view.getUint32(offset, true); offset += 4; return v; };
  const readU8 = () => { const v = view.getUint8(offset); offset += 1; return v; };
  const readStr = (n: number) => {
    let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(offset + i));
    offset += n; return s;
  };
  if (readStr(4) !== 'VOX ') throw new Error('Not a VOX file');
  readU32();
  let sizeX = 0, sizeY = 0, sizeZ = 0;
  const voxels: VoxModel['voxels'] = [];
  let palette: VoxModel['palette'] | null = null;
  const readChunks = (end: number) => {
    while (offset < end) {
      const id = readStr(4); const cs = readU32(); const ccs = readU32(); const ce = offset + cs;
      if (id === 'SIZE') { sizeX = readU32(); sizeY = readU32(); sizeZ = readU32(); }
      else if (id === 'XYZI') { const n = readU32(); for (let i = 0; i < n; i++) voxels.push({ x: readU8(), y: readU8(), z: readU8(), colorIndex: readU8() }); }
      else if (id === 'RGBA') { palette = []; for (let i = 0; i < 256; i++) { const r = readU8(), g = readU8(), b = readU8(); readU8(); palette.push({ r: r / 255, g: g / 255, b: b / 255 }); } }
      offset = ce; if (ccs > 0) readChunks(offset + ccs);
    }
  };
  if (readStr(4) !== 'MAIN') throw new Error('Expected MAIN');
  const mc = readU32(); const mcc = readU32(); offset += mc;
  readChunks(offset + mcc);
  if (!palette) { palette = []; for (let i = 0; i < 256; i++) palette.push({ r: 0.8, g: 0.8, b: 0.8 }); }
  return { sizeX, sizeY, sizeZ, voxels, palette };
}

export async function loadVoxFile(url: string): Promise<{ model: VoxModel; voxels: VoxelEntry[] }> {
  const resp = await fetch(url + `?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed: ${url} (${resp.status})`);
  const model = parseVox(await resp.arrayBuffer());
  const voxels: VoxelEntry[] = model.voxels.map(v => {
    const col = model.palette[v.colorIndex - 1] ?? { r: 0.8, g: 0.8, b: 0.8 };
    return { x: v.x, y: v.y, z: v.z, r: col.r, g: col.g, b: col.b };
  });
  return { model, voxels };
}

// Mesh building constants
export const SCALE = 0.01;
export const FACE_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const FACE_VERTS = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]],
];
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
