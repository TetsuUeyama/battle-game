/**
 * Extract Unity Avatar Mask (.mask YAML) → { boneName: weight } JSON
 *
 * Usage:
 *   node scripts/extract-mask.mjs <mask-path> <out-json>
 *
 * Example:
 *   node scripts/extract-mask.mjs \
 *     "C:/Users/user/My project/Assets/Kevin Iglesias/Human Animations/Models/Avatar Masks/Human Body Upper Mask.mask" \
 *     public/uub-data/masks/upper.json
 *
 * .mask は Unity YAML 形式。m_Elements 配列の各エントリが「ボーンパス + weight」。
 * パスは "Rig/B-root/B-hips/..." のような階層形式なので、最後のセグメントをボーン名として使う。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, basename } from 'path';

const [, , maskPath, outPath] = process.argv;
if (!maskPath || !outPath) {
  console.error('Usage: node extract-mask.mjs <mask-path> <out-json>');
  process.exit(1);
}

const text = readFileSync(maskPath, 'utf-8');
const lines = text.split(/\r?\n/);

// 簡易パーサ: "- m_Path: ..." と "  m_Weight: ..." をペアで拾う
const weights = {};
let currentPath = null;
for (const line of lines) {
  const pathMatch = line.match(/^\s*-?\s*m_Path:\s*(.*)\s*$/);
  if (pathMatch) {
    currentPath = pathMatch[1].trim();
    continue;
  }
  const weightMatch = line.match(/^\s*m_Weight:\s*([\d.]+)\s*$/);
  if (weightMatch && currentPath !== null) {
    const weight = parseFloat(weightMatch[1]);
    // パスの最後のセグメントがボーン名 (Rig/B-root → "B-root")
    const segments = currentPath.split('/');
    const boneName = segments[segments.length - 1];
    // 空のパス (ルートエントリ) や mesh はスキップ
    if (boneName && boneName !== 'Rig' && !boneName.endsWith('Mesh')) {
      weights[boneName] = weight;
    }
    currentPath = null;
  }
}

const maskName = basename(maskPath, '.mask');
const out = {
  source: maskPath,
  maskName,
  weights,
  enabledBones: Object.keys(weights).filter(k => weights[k] > 0).sort(),
  disabledBones: Object.keys(weights).filter(k => weights[k] === 0).sort(),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`mask: ${Object.keys(weights).length} bones (${out.enabledBones.length} enabled, ${out.disabledBones.length} disabled) → ${outPath}`);
