#!/usr/bin/env node
/**
 * Mixamo -> Babylon.js motion converter (orchestrator).
 *
 *   node scripts/convert-motions.mjs <config.json>
 *
 * 1. Runs Blender (scripts/blender/convert_motions.py) to retarget all clips
 *    onto the target rig and export ONE GLB (rest-difference-corrected bake).
 * 2. Generates runtime metadata next to the asset:
 *      <assetsDir>/<assetId>/bone-mapping.json   (from a rig preset, filtered
 *                                                  to bones present in the GLB)
 *      <assetsDir>/<assetId>/animator.json       (scaffold; NOT overwritten if
 *                                                  it already exists)
 *      <assetsDir>/assets-manifest.json          (entry upserted)
 *
 * Paths in the config: targetRig / clips[].fbx should be absolute. glbOut /
 * assetsDir are resolved from the repo root (the cwd of `npm run`).
 *
 * Env: BLENDER_PATH overrides the Blender executable.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLENDER =
  process.env.BLENDER_PATH ||
  "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe";

function die(msg) {
  console.error("convert-motions: " + msg);
  process.exit(1);
}

// ----------------------------------------------------------- GLB reader
/** Read names of nodes and animations from a .glb's JSON chunk. */
function readGlb(path) {
  const buf = readFileSync(path);
  let off = 12;
  const dec = new TextDecoder();
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4e4f534a) {
      const json = JSON.parse(dec.decode(buf.subarray(off, off + len)));
      return {
        nodes: (json.nodes || []).map((n) => n.name).filter(Boolean),
        animations: (json.animations || []).map((a) => a.name).filter(Boolean),
      };
    }
    off += len;
  }
  return { nodes: [], animations: [] };
}

// ----------------------------------------------------------- web path
/** "public/motion-test/x.glb" -> "/motion-test/x.glb" */
function webPath(repoRelGlb) {
  const norm = repoRelGlb.replace(/\\/g, "/");
  const i = norm.indexOf("public/");
  return i >= 0 ? norm.slice(i + "public".length) : "/" + norm;
}

// ----------------------------------------------------------- metadata
function genBoneMapping(assetId, presetId, glbNodes) {
  const presetPath = resolve(REPO, "src/runtime/avatar/presets", presetId + ".json");
  if (!existsSync(presetPath)) die(`rig preset not found: ${presetPath}`);
  const preset = JSON.parse(readFileSync(presetPath, "utf-8"));
  const present = new Set(glbNodes);
  const entries = [];
  for (const [standardName, src] of Object.entries(preset.bones)) {
    const sourceName = String(src).replace(/^mixamorig:/, "");
    if (present.has(sourceName)) entries.push({ standardName, sourceName });
  }
  return { id: `${assetId}-rig`, rigType: preset.rigType, entries };
}

function genAnimator(assetId, clips, defaultClip) {
  const names = clips.map((c) => c.name);
  const def = defaultClip && names.includes(defaultClip) ? defaultClip : names[0];
  return {
    name: `${assetId}Controller`,
    parameters: [],
    layers: [
      {
        name: "Base Layer",
        defaultWeight: 1,
        defaultState: def,
        states: clips.map((c) => ({
          name: c.name,
          clip: c.name,
          speed: 1,
          loop: c.loop !== false,
          transitions: [],
        })),
        anyStateTransitions: [],
      },
    ],
  };
}

function upsertManifest(manifestPath, entry) {
  let manifest = { generatedAt: "", assets: [] };
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!Array.isArray(manifest.assets)) manifest.assets = [];
  }
  manifest.generatedAt = new Date().toISOString();
  const i = manifest.assets.findIndex((a) => a.id === entry.id);
  if (i >= 0) manifest.assets[i] = entry;
  else manifest.assets.push(entry);
  return manifest;
}

// ----------------------------------------------------------------- main
const cfgArg = process.argv[2];
if (!cfgArg) die("usage: node scripts/convert-motions.mjs <config.json>");
const cfgPath = resolve(process.cwd(), cfgArg);
if (!existsSync(cfgPath)) die(`config not found: ${cfgPath}`);
const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));

for (const k of ["assetId", "targetRig", "glbOut", "clips"]) {
  if (!cfg[k]) die(`config missing required field: ${k}`);
}
const assetId = cfg.assetId;
const glbOutAbs = resolve(REPO, cfg.glbOut);
const assetsDir = resolve(REPO, cfg.assetsDir || "public/assets");
const presetId = cfg.rigPreset || "mixamo";

// 1) Blender retarget+export. Pass an absolute-path config to Blender.
const blenderCfg = {
  targetRig: resolve(process.cwd(), cfg.targetRig),
  scaleFbxToGlb: cfg.scaleFbxToGlb ?? 0.01,
  glbOut: glbOutAbs,
  clips: cfg.clips.map((c) => ({
    name: c.name,
    fbx: resolve(process.cwd(), c.fbx),
    loop: c.loop !== false,
  })),
};
const tmpCfg = resolve(REPO, "tmp");
mkdirSync(tmpCfg, { recursive: true });
const blenderCfgPath = resolve(tmpCfg, `convert-${assetId}.blender.json`);
writeFileSync(blenderCfgPath, JSON.stringify(blenderCfg, null, 2));

console.log(`[1/2] Blender retarget (${cfg.clips.length} clip(s)) -> ${cfg.glbOut}`);
execFileSync(
  BLENDER,
  ["--background", "--python", resolve(REPO, "scripts/blender/convert_motions.py"),
    "--", blenderCfgPath],
  { stdio: "inherit" },
);
if (!existsSync(glbOutAbs)) die("Blender did not produce the GLB: " + glbOutAbs);

// 2) metadata
console.log("[2/2] generate metadata");
const glb = readGlb(glbOutAbs);
const assetDir = resolve(assetsDir, assetId);
mkdirSync(assetDir, { recursive: true });

// bone-mapping (always regenerated; deterministic)
const boneMapping = genBoneMapping(assetId, presetId, glb.nodes);
writeFileSync(resolve(assetDir, "bone-mapping.json"), JSON.stringify(boneMapping, null, 2) + "\n");
console.log(`    bone-mapping.json (${boneMapping.entries.length} bones)`);

// animator scaffold (do NOT clobber a hand-tuned one)
const animator = genAnimator(assetId, cfg.clips, cfg.defaultClip);
const animatorPath = resolve(assetDir, "animator.json");
if (existsSync(animatorPath)) {
  writeFileSync(resolve(assetDir, "animator.scaffold.json"), JSON.stringify(animator, null, 2) + "\n");
  console.log("    animator.json exists -> wrote animator.scaffold.json instead (kept yours)");
} else {
  writeFileSync(animatorPath, JSON.stringify(animator, null, 2) + "\n");
  console.log(`    animator.json (default state "${animator.layers[0].defaultState}")`);
}

// manifest upsert
const manifestPath = resolve(assetsDir, "assets-manifest.json");
const entry = {
  id: assetId,
  sourcePath: cfg.sourceLabel || "Mixamo",
  glbPath: webPath(relative(REPO, glbOutAbs)),
  animatorPath: `${assetId}/animator.json`,
  boneMappingPath: `${assetId}/bone-mapping.json`,
  animationClips: cfg.clips.map((c) => c.name),
};
const manifest = upsertManifest(manifestPath, entry);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`    assets-manifest.json (id="${assetId}", glbPath="${entry.glbPath}")`);

// sanity: GLB clip names vs config
const missing = cfg.clips.map((c) => c.name).filter((n) => !glb.animations.includes(n));
if (missing.length) console.warn("    WARN: clips not found in exported GLB:", missing.join(", "));
console.log("done.");
