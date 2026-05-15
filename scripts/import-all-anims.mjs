/**
 * Kevin Iglesias Human Basic Motions 全アニメを一括コピー & JSON 化 + ANIMATIONS リスト生成
 *
 * Usage:
 *   node scripts/import-all-anims.mjs
 *
 * - 元 FBX: C:\Users\user\My project\Assets\Kevin Iglesias\Human Animations\Animations
 * - 中間   : public/uub/animations/ (flat)
 * - 出力   : public/uub-data/motions/ (flat JSON)
 *           : public/uub-data/animations-manifest.json (ANIMATIONS 用メタ)
 */
import { readdirSync, statSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename, relative, dirname, sep } from 'path';
import { spawnSync } from 'child_process';

const ASSET_ROOT = 'C:\\Users\\user\\My project\\Assets\\Kevin Iglesias\\Human Animations\\Animations';
const ANIM_DST = 'public/uub/animations';
const JSON_DST = 'public/uub-data/motions';
const MANIFEST_PATH = 'public/uub-data/animations-manifest.json';

mkdirSync(ANIM_DST, { recursive: true });
mkdirSync(JSON_DST, { recursive: true });

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.toLowerCase().endsWith('.fbx')) out.push(full);
  }
  return out;
}

const allFbx = walk(ASSET_ROOT);
console.log(`Found ${allFbx.length} FBX files in Asset folder`);

// Generate label and folderPath from full path
function parseEntry(fullPath) {
  const fileName = basename(fullPath, '.fbx');  // 例: "HumanM@Walk01_Forward [RM]"
  const rel = relative(ASSET_ROOT, fullPath);  // 例: "Male\Movement\Walk\RootMotion\HumanM@Walk01_Forward [RM].fbx"
  const parts = rel.split(/[\\/]/);
  parts.pop(); // remove filename, leaving [Male, Movement, Walk, RootMotion]

  // Character prefix: from filename (HumanM@... or HumanF@... or Human@... for shared)
  let character = 'HumanM';  // default
  if (fileName.startsWith('HumanF@')) character = 'HumanF';
  else if (fileName.startsWith('HumanM@')) character = 'HumanM';
  else if (fileName.startsWith('Human@')) character = 'BOTH';  // shared (Masked Poses)

  // folderPath: drop the first segment (Male/Female) and join the rest
  // For Masked Poses: keep as-is
  let folderParts = parts;
  if (folderParts[0] === 'Male' || folderParts[0] === 'Female') {
    folderParts = folderParts.slice(1);
  }
  const folderPath = folderParts.join('/');

  // Label: human-friendly from filename
  const labelBase = fileName
    .replace(/^Human[MF]@/, '')
    .replace(/^Human@/, '');
  const label = labelBase;

  const hasRootMotion = labelBase.includes('[RM]');

  return {
    fileName,                         // 元の filename (no extension)
    src: fullPath,
    dstFbx: join(ANIM_DST, fileName + '.fbx'),
    dstJson: join(JSON_DST, fileName + '.json'),
    character,                        // 'HumanM' | 'HumanF' | 'BOTH'
    folderPath,                       // 'Idles', 'Movement/Walk', 'Masked Poses', etc.
    label,                            // 'Walk01_Forward [RM]' etc.
    hasRootMotion,
  };
}

const entries = allFbx.map(parseEntry);

// Copy FBX (skip if already exists with same size)
let copied = 0, skipped = 0;
for (const e of entries) {
  if (existsSync(e.dstFbx) && statSync(e.dstFbx).size === statSync(e.src).size) {
    skipped++;
    continue;
  }
  copyFileSync(e.src, e.dstFbx);
  copied++;
}
console.log(`Copied: ${copied} new, ${skipped} already exist`);

// Extract motion JSON for each (skip if json exists)
let extracted = 0, skippedJson = 0;
for (const e of entries) {
  if (existsSync(e.dstJson)) { skippedJson++; continue; }
  const res = spawnSync('node', ['scripts/extract-uub.mjs', 'motion', e.dstFbx, e.dstJson], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`Failed to extract: ${e.dstFbx}`);
  } else {
    extracted++;
  }
}
console.log(`Extracted: ${extracted} new, ${skippedJson} already exist`);

// Generate manifest (relative paths only)
const manifest = entries.map(e => ({
  file: basename(e.dstJson),
  label: e.label,
  folderPath: e.folderPath,
  character: e.character,
  hasRootMotion: e.hasRootMotion || undefined,
}));
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest: ${MANIFEST_PATH} (${manifest.length} entries)`);
