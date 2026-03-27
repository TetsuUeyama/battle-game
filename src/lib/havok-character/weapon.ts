/**
 * Havok Character System — Weapon equip/unequip, stance, mesh building, inertia, power.
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial,
  Mesh, TransformNode, Quaternion, VertexData,
} from '@babylonjs/core';
import { parseVox, SCALE as VOX_SCALE } from '../vox-parser';
import type {
  HavokCharacter, WeaponPhysics, StanceType, GameAssetWeaponInfo,
} from './types';
import { createWeaponSwingState, PALM_GRIP_POINTS } from './types';
import {
  getWorldPos, getCharacterDirections, getStanceTargets, getOffHandRestPosition,
  rotationBetweenVectors, rotateVectorByQuat,
} from './helpers';

/**
 * 武器を装備する。
 * weaponMesh が指定されればそれを使用、なければデバッグ用ボックスを生成。
 */
export function equipWeapon(
  scene: Scene, character: HavokCharacter, weapon: WeaponPhysics,
  stance: StanceType = 'front',
  weaponMesh?: Mesh,
): void {
  // 既存の武器メッシュを破棄
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }

  character.weapon = weapon;

  if (weaponMesh) {
    weaponMesh.parent = character.weaponAttachR;
    character.weaponMesh = weaponMesh;
  } else {
    character.weaponAttachR.position.set(0, 0.064, 0.035);
    const mesh = MeshBuilder.CreateBox(
      `${character.root.name}_weapon`,
      { width: 0.03, height: weapon.length, depth: 0.03 },
      scene,
    );
    const mat = new StandardMaterial(`${character.root.name}_weaponMat`, scene);
    mat.diffuseColor = new Color3(0.8, 0.8, 0.2);
    mat.specularColor = new Color3(0.3, 0.3, 0.1);
    mesh.material = mat;
    mesh.parent = character.weaponAttachR;
    mesh.position.set(0, -weapon.length / 2, 0);
    character.weaponMesh = mesh;
  }

  applyStance(character, stance);
}

/**
 * 構えを適用する: IKターゲットと武器の向きを設定
 */
function applyStance(character: HavokCharacter, stance: StanceType): void {
  const weapon = character.weapon;
  if (!weapon) return;

  const swing = character.weaponSwing;
  swing.stance = stance;

  const { rightTarget, leftTarget, weaponDir } = getStanceTargets(character, stance, weapon);
  swing.baseHandPos = rightTarget.clone();
  swing.smoothedTarget = rightTarget.clone();

  // 画面右手 = Mixamo leftArm チェーン (weapon hand)
  character.ikChains.leftArm.target.copyFrom(rightTarget);
  character.ikChains.leftArm.weight = 1;

  // 画面左手 = Mixamo rightArm チェーン (off-hand)
  if (weapon.gripType === 'two-handed' && leftTarget) {
    character.ikChains.rightArm.target.copyFrom(leftTarget);
    character.ikChains.rightArm.weight = 1;
  } else {
    const offHandPos = getOffHandRestPosition(character);
    if (offHandPos) {
      character.ikChains.rightArm.target.copyFrom(offHandPos);
      character.ikChains.rightArm.weight = 1;
    }
  }

  // 武器の向きを設定 (directPlacement の場合はメッシュに直接配置済みなのでスキップ)
  if (!weapon.directPlacement) {
    setWeaponDirection(character, weaponDir);
  }

  const tipWorld = getWeaponTipWorld(character);
  swing.prevTipPos.copyFrom(tipWorld);
  swing.tipSpeed = 0;
  swing.power = 0;
  swing.swinging = false;
}

/**
 * 武器の向きを設定する (2軸アラインメント)。
 */
function setWeaponDirection(character: HavokCharacter, weaponDir: Vector3): void {
  const attach = character.weaponAttachR;
  const parent = attach.parent as TransformNode;
  const weapon = character.weapon;
  if (!parent || !weapon) return;

  parent.computeWorldMatrix(true);
  const parentWorldRot = Quaternion.FromRotationMatrix(
    parent.getWorldMatrix().getRotationMatrix(),
  );
  const parentInv = parentWorldRot.clone();
  parentInv.invertInPlace();

  // ─── Step 1: tip方向を合わせる ───
  const rot1 = rotationBetweenVectors(weapon.localTipDir, weaponDir);

  // ─── Step 2: グリップ軸のロールを合わせる ───
  const rotatedGripAxis = weapon.localGripAxis.clone();
  const rot1Conj = rot1.clone(); rot1Conj.invertInPlace();
  const tempQ = rot1.multiply(new Quaternion(rotatedGripAxis.x, rotatedGripAxis.y, rotatedGripAxis.z, 0)).multiply(rot1Conj);
  const rotatedGrip = new Vector3(tempQ.x, tempQ.y, tempQ.z).normalize();

  const palmUpper = PALM_GRIP_POINTS.left_upper;
  const palmLower = PALM_GRIP_POINTS.left_lower;
  const palmAxisLocal = palmUpper.subtract(palmLower).normalize();
  const palmAxisQ = parentWorldRot.multiply(
    new Quaternion(palmAxisLocal.x, palmAxisLocal.y, palmAxisLocal.z, 0),
  ).multiply(parentInv);
  const palmAxisWorld = new Vector3(palmAxisQ.x, palmAxisQ.y, palmAxisQ.z).normalize();

  const projRotated = rotatedGrip.subtract(weaponDir.scale(Vector3.Dot(rotatedGrip, weaponDir))).normalize();
  const projPalm = palmAxisWorld.subtract(weaponDir.scale(Vector3.Dot(palmAxisWorld, weaponDir))).normalize();

  let rot2 = Quaternion.Identity();
  if (projRotated.length() > 0.001 && projPalm.length() > 0.001) {
    rot2 = rotationBetweenVectors(projRotated, projPalm);
  }

  const worldRot = rot2.multiply(rot1);
  attach.rotationQuaternion = parentInv.multiply(worldRot);
}

/**
 * 構えを変更する (装備中に呼び出し)
 */
export function setStance(character: HavokCharacter, stance: StanceType): void {
  if (!character.weapon) return;
  applyStance(character, stance);
}

/**
 * 武器を外す
 */
export function unequipWeapon(character: HavokCharacter): void {
  if (character.weaponMesh) {
    character.weaponMesh.dispose();
    character.weaponMesh = null;
  }
  character.weapon = null;
  character.weaponSwing = createWeaponSwingState();
}

// ─── Game-Assets Weapon Loader ────────────────────────────

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

  // ボクセル座標 → メートル
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

  const palmUpper = PALM_GRIP_POINTS.left_upper;
  const palmLower = PALM_GRIP_POINTS.left_lower;
  const palmMid = Vector3.Lerp(palmUpper, palmLower, 0.5);

  const weaponGripAxis = gripTipSide.subtract(gripPommelSide).normalize();
  const palmGripAxis = palmUpper.subtract(palmLower).normalize();

  const gripToTip = tip.subtract(primaryGrip).normalize();
  const mesh = buildVoxWeaponMesh(scene, model, primaryGrip, gripToTip, character.root.name);

  const weaponPtTip = gripTipSide.subtract(primaryGrip);
  const weaponPtPommel = gripPommelSide.subtract(primaryGrip);

  const weaponGripDir = weaponPtTip.subtract(weaponPtPommel).normalize();
  const palmGripDir = palmUpper.subtract(palmLower).normalize();

  // ─── Step 1: グリップ軸アラインメント ───
  const rot1 = rotationBetweenVectors(weaponGripDir, palmGripDir);

  // ─── Step 2: ツイスト回転 ───
  const handleAxis = tip.subtract(pommel).normalize();
  const gripOnAxis = pommel.add(handleAxis.scale(Vector3.Dot(primaryGrip.subtract(pommel), handleAxis)));
  const gripOffset = primaryGrip.subtract(gripOnAxis).normalize();

  const rotatedOffset = rotateVectorByQuat(gripOffset, rot1);

  const palmInward = new Vector3(0, 0, -1);

  const projRotated = rotatedOffset.subtract(palmGripDir.scale(Vector3.Dot(rotatedOffset, palmGripDir))).normalize();
  const projPalm = palmInward.subtract(palmGripDir.scale(Vector3.Dot(palmInward, palmGripDir))).normalize();

  let rot2 = Quaternion.Identity();
  if (projRotated.length() > 0.001 && projPalm.length() > 0.001) {
    rot2 = rotationBetweenVectors(projRotated, projPalm);
  }

  const finalRot = rot2.multiply(rot1);

  // ─── 平行移動 ───
  const weaponMid = Vector3.Lerp(weaponPtTip, weaponPtPommel, 0.5);
  const rotatedWeaponMid = rotateVectorByQuat(weaponMid, finalRot);
  const translation = palmMid.subtract(rotatedWeaponMid);

  character.weaponAttachR.position.set(0, 0, 0);
  character.weaponAttachR.rotationQuaternion = Quaternion.Identity();
  mesh.rotationQuaternion = finalRot;
  mesh.position.copyFrom(translation);

  // ─── 先端位置をメッシュローカル空間で正しく計算 ───
  // tip (ボクセルメートル) → grip原点相対 → finalRotで回転 → translationで移動
  const tipRelGrip = tip.subtract(primaryGrip);
  const tipInMeshLocal = rotateVectorByQuat(tipRelGrip, finalRot).add(translation);

  // ─── WeaponPhysics ───
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

// ─── Weapon Tip / Inertia / Power ────────────────────────

/**
 * 武器先端のワールド位置を取得
 */
export function getWeaponTipWorld(character: HavokCharacter): Vector3 {
  if (!character.weapon) return getWorldPos(character.weaponAttachR);

  character.weaponAttachR.computeWorldMatrix(true);
  const tipLocal = character.weapon.attackPoint;
  return Vector3.TransformCoordinates(tipLocal, character.weaponAttachR.getWorldMatrix());
}

/**
 * 慣性シミュレーション
 */
export function updateWeaponInertia(
  character: HavokCharacter,
  desiredTarget: Vector3,
  dt: number,
): void {
  const weapon = character.weapon;
  if (!weapon) {
    character.ikChains.leftArm.target.copyFrom(desiredTarget);
    return;
  }

  const swing = character.weaponSwing;
  const inertiaFactor = 1.0 / (1.0 + weapon.weight * 2.0);
  const lerpSpeed = inertiaFactor * 10.0;
  const t = Math.min(1.0, lerpSpeed * dt);

  Vector3.LerpToRef(swing.smoothedTarget, desiredTarget, t, swing.smoothedTarget);
  character.ikChains.leftArm.target.copyFrom(swing.smoothedTarget);
}

/**
 * 攻撃威力の算出
 */
export function updateWeaponPower(character: HavokCharacter, dt: number): number {
  const weapon = character.weapon;
  if (!weapon) return 0;

  const swing = character.weaponSwing;
  const tipWorld = getWeaponTipWorld(character);

  const dist = Vector3.Distance(tipWorld, swing.prevTipPos);
  swing.tipSpeed = dt > 0 ? dist / dt : 0;

  if (swing.swinging) {
    swing.power += dist * weapon.weight;
  }

  swing.prevTipPos.copyFrom(tipWorld);
  return swing.power;
}

/**
 * スイング開始
 */
export function startSwing(character: HavokCharacter): void {
  const swing = character.weaponSwing;
  swing.swinging = true;
  swing.power = 0;
}

/**
 * スイング終了 → 累積威力を返す
 */
export function endSwing(character: HavokCharacter): number {
  const swing = character.weaponSwing;
  const finalPower = swing.power;
  swing.swinging = false;
  swing.power = 0;
  return finalPower;
}

/**
 * 両手持ち武器で画面左手(off-hand)を切替。
 */
export function releaseOffHand(character: HavokCharacter, release: boolean): void {
  const weapon = character.weapon;
  if (!weapon || weapon.gripType !== 'two-handed') return;

  if (release) {
    character.ikChains.rightArm.weight = 0;
  } else {
    character.ikChains.rightArm.weight = 1;
    const tipWorld = getWeaponTipWorld(character);
    const handWorld = getWorldPos(character.weaponAttachR);
    Vector3.LerpToRef(handWorld, tipWorld, 0.3, character.ikChains.rightArm.target);
  }
}
