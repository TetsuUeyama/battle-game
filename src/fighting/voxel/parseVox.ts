/**
 * MagicaVoxel (.vox) パーサ（標準フォーマット）。
 * VOX 150 形式。MAIN > SIZE / XYZI / RGBA の主要チャンクのみ対応。
 */

export interface VoxModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  count: number;
  /** 各ボクセルの整数座標と色インデックス (count 要素) */
  xs: Uint8Array;
  ys: Uint8Array;
  zs: Uint8Array;
  cs: Uint8Array;
  /** 256 色 RGBA (256*4) */
  palette: Uint8Array;
}

export function parseVox(buffer: ArrayBuffer): VoxModel {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== "VOX ") throw new Error(`not a .vox file (magic=${magic})`);

  let sizeX = 0;
  let sizeY = 0;
  let sizeZ = 0;
  let xs = new Uint8Array(0);
  let ys = new Uint8Array(0);
  let zs = new Uint8Array(0);
  let cs = new Uint8Array(0);
  let palette: Uint8Array | null = null;

  // 8 byte header (magic + version) の後ろからチャンクを走査
  let off = 8;
  while (off + 12 <= buffer.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(off),
      view.getUint8(off + 1),
      view.getUint8(off + 2),
      view.getUint8(off + 3),
    );
    const contentSize = view.getInt32(off + 4, true);
    // const childrenSize = view.getInt32(off + 8, true);
    const content = off + 12;

    if (id === "MAIN") {
      // 子チャンクは直後に続くので content(=0) をスキップして潜る
      off = content;
      continue;
    } else if (id === "SIZE") {
      sizeX = view.getInt32(content, true);
      sizeY = view.getInt32(content + 4, true);
      sizeZ = view.getInt32(content + 8, true);
    } else if (id === "XYZI") {
      const n = view.getInt32(content, true);
      xs = new Uint8Array(n);
      ys = new Uint8Array(n);
      zs = new Uint8Array(n);
      cs = new Uint8Array(n);
      let p = content + 4;
      for (let i = 0; i < n; i++) {
        xs[i] = view.getUint8(p);
        ys[i] = view.getUint8(p + 1);
        zs[i] = view.getUint8(p + 2);
        cs[i] = view.getUint8(p + 3);
        p += 4;
      }
    } else if (id === "RGBA") {
      palette = new Uint8Array(256 * 4);
      for (let i = 0; i < 256 * 4; i++) palette[i] = view.getUint8(content + i);
    }

    off = content + contentSize;
  }

  return {
    sizeX,
    sizeY,
    sizeZ,
    count: xs.length,
    xs,
    ys,
    zs,
    cs,
    palette: palette ?? defaultPalette(),
  };
}

/** RGBA チャンクが無い場合のフォールバック（灰色系） */
function defaultPalette(): Uint8Array {
  const p = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    p[i * 4] = 200;
    p[i * 4 + 1] = 200;
    p[i * 4 + 2] = 200;
    p[i * 4 + 3] = 255;
  }
  return p;
}
