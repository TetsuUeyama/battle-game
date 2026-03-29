/**
 * Game-Assets武器ローダー。
 * .voxモデルの読み込み・メッシュ構築・グリップアラインメント・WeaponPhysics生成。
 */
import {
  Scene, Vector3, Color3, StandardMaterial,
  Mesh, Quaternion, VertexData,
} from '@babylonjs/core';
import { parseVox, SCALE as VOX_SCALE } from '../../vox-parser';
import type { HavokCharacter, WeaponPhysics, StanceType, GameAssetWeaponInfo } from '../types';
import { PALM_GRIP_POINTS } from '../types';
import { rotationBetweenVectors, rotateVectorByQuat } from '@/lib/math-utils';
import { applyStance } from './equip';

/**
 * /api/configured-weapons から設定済み武器一覧を取得
 */
export async function fetchGameAssetWeapons(): Promise<GameAssetWeaponInfo[]> {
  try {
    const resp = await fetch('/api/configured-weapons');
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.weapons ?? [];
  } catch {
    return [];
  }
}

/**
 * Game-assetsから武器の.voxモデルを読み込み、
 * 2つのグリップポイントを手のひらの2点に合わせて装備する。
 */
export async function equipGameAssetWeapon(
  scene: Scene,
  character: HavokCharacter,
  info: GameAssetWeaponInfo,
  stance: StanceType = 'front',
): Promise<void> {
  const voxUrl = `/api/game-assets/wapons/${info.category}/${info.pieceKey}/${info.pieceKey}.vox`;

  const resp = await fetch(voxUrl);
  if (!resp.ok) throw new Error(`Failed to load ${voxUrl}: ${resp.status}`);
  const model = parseVox(await resp.arrayBuffer());

  const v2m = (p: { x: number; y: number; z: number }) =>
    new Vector3(p.x * VOX_SCALE, p.y * VOX_SCALE, p.z * VOX_SCALE);

  const primaryGrip = v2m(info.gripPosition);
  const tip = v2m(info.tipPosition);
  const pommel = v2m(info.pommelPosition);

  const secondaryGrip = info.secondaryGripPosition
    ? v2m(info.secondaryGripPosition)
    : Vector3.Lerp(primaryGrip, pommel, 0.15);

  const primaryToTip = Vector3.Distance(primaryGrip, tip);
  const secondaryToTip = Vector3.Distance(secondaryGrip, tip);
  const gripTipSide = primaryToTip < secondaryToTip ? primaryGrip : secondaryGrip;
  const gripPommelSide = primaryToTip < secondaryToTip ? secondaryGrip : primaryGrip;

  const length = Vector3.Distance(primaryGrip, tip);
  const pommelDist = Vector3.Distance(primaryGrip, pommel);

  const palmUpper = PALM_GRIP_POINTS.right_upper;
  const palmLower = PALM_GRIP_POINTS.right_lower;
  const palmMid = Vector3.Lerp(palmUpper, palmLower, 0.5);

  const gripToTip = tip.subtract(primaryGrip).normalize();
  const mesh = buildVoxWeaponMesh(scene, model, primaryGrip, gripToTip, character.root.name);

  const weaponPtTip = gripTipSide.subtract(primaryGrip);
  const weaponPtPommel = gripPommelSide.subtract(primaryGrip);
  const weaponGripDir = weaponPtTip.subtract(weaponPtPommel).normalize();
  const palmGripDir = palmUpper.subtract(palmLower).normalize();

  // Step 1: グリップ軸アラインメント
  const rot1 = rotationBetweenVectors(weaponGripDir, palmGripDir);

  // Step 2: ツイスト回転
  const handleAxis = tip.subtract(pommel).normalize();
  const gripOnAxis = pommel.add(handleAxis.scale(Vector3.Dot(primaryGrip.subtract(pommel), handleAxis)));
  const gripOffset = primaryGrip.subtract(gripOnAxis).normalize();
  const rotatedOffset = rotateVectorByQuat(gripOffset, rot1);
  const palmInward = new Vector3(0, 0, 1);
  const projRotated = rotatedOffset.subtract(palmGripDir.scale(Vector3.Dot(rotatedOffset, palmGripDir))).normalize();
  const projPalm = palmInward.subtract(palmGripDir.scale(Vector3.Dot(palmInward, palmGripDir))).normalize();

  let rot2 = Quaternion.Identity();
  if (projRotated.length() > 0.001 && projPalm.length() > 0.001) {
    rot2 = rotationBetweenVectors(projRotated, projPalm);
  }

  const finalRot = rot2.multiply(rot1);

  // 平行移動
  const weaponMid = Vector3.Lerp(weaponPtTip, weaponPtPommel, 0.5);
  const rotatedWeaponMid = rotateVectorByQuat(weaponMid, finalRot);
  const translation = palmMid.subtract(rotatedWeaponMid);

  character.weaponAttachR.position.set(0, 0, 0);
  character.weaponAttachR.rotationQuaternion = Quaternion.Identity();
  mesh.rotationQuaternion = finalRot;
  mesh.position.copyFrom(translation);

  // 先端位置をメッシュローカル空間で計算
  const tipRelGrip = tip.subtract(primaryGrip);
  const tipInMeshLocal = rotateVectorByQuat(tipRelGrip, finalRot).add(translation);

  // WeaponPhysics
  const weapon: WeaponPhysics = {
    weight: info.weight / 1000,
    length,
    gripType: info.defaultGrip === 'two_hand' ? 'two-handed' : 'one-handed',
    attackPoint: tipInMeshLocal,
    gripOffset: Vector3.Zero(),
    offHandOffset: new Vector3(0, pommelDist * 0.3, 0),
    localTipDir: gripToTip,
    localGripAxis: weaponGripDir,
    directPlacement: true,
    category: info.category,
  };

  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }
  character.weapon = weapon;
  mesh.parent = character.weaponAttachR;
  character.weaponMesh = mesh;

  applyStance(character, stance);
}

/**
 * ボクセルデータから武器メッシュを構築。
 */
function buildVoxWeaponMesh(
  scene: Scene,
  model: ReturnType<typeof parseVox>,
  grip: Vector3,
  localDir: Vector3,
  prefix: string,
): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const occupied = new Set<string>();
  for (const v of model.voxels) {
    occupied.add(`${v.x},${v.y},${v.z}`);
  }

  const faceDirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const faceVerts = [
    [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
    [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], [[1,0,0],[1,1,0],[0,1,0],[0,0,0]],
  ];

  for (const v of model.voxels) {
    const col = model.palette[v.colorIndex - 1] ?? { r: 0.8, g: 0.8, b: 0.8 };
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = faceDirs[f];
      if (occupied.has(`${v.x+dx},${v.y+dy},${v.z+dz}`)) continue;

      const baseIdx = positions.length / 3;
      for (const [vx, vy, vz] of faceVerts[f]) {
        positions.push(
          (v.x + vx) * VOX_SCALE - grip.x,
          (v.y + vy) * VOX_SCALE - grip.y,
          (v.z + vz) * VOX_SCALE - grip.z,
        );
        normals.push(dx, dy, dz);
        colors.push(col.r, col.g, col.b, 1);
      }
      indices.push(baseIdx, baseIdx+1, baseIdx+2, baseIdx, baseIdx+2, baseIdx+3);
    }
  }

  const weaponMesh = new Mesh(`${prefix}_voxWeapon`, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.colors = colors;
  vertexData.indices = indices;
  vertexData.applyToMesh(weaponMesh);

  const mat = new StandardMaterial(`${prefix}_voxWeaponMat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  weaponMesh.material = mat;
  weaponMesh.hasVertexAlpha = false;

  return weaponMesh;
}
