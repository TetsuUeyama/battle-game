/**
 * ボーン可視化。bone-data.json を読み込み、関節球とボーン間ラインを描画する。
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial, TransformNode, Quaternion,
} from '@babylonjs/core';

export interface BoneEntry {
  name: string;
  parent: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number];
  preRotation: [number, number, number];
  worldPosition: [number, number, number];
}

export interface BoneDataFile {
  globalSettings: { unitScaleFactor: number };
  bones: BoneEntry[];
}

function degToRad(d: number): number { return d * Math.PI / 180; }

function eulerXYZToQuat(xDeg: number, yDeg: number, zDeg: number): Quaternion {
  const qx = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(xDeg));
  const qy = Quaternion.RotationAxis(new Vector3(0, 1, 0), degToRad(yDeg));
  const qz = Quaternion.RotationAxis(new Vector3(0, 0, 1), degToRad(zDeg));
  return qz.multiply(qy.multiply(qx));
}

/**
 * ボーンの可視化ヒエラルキーを構築。関節球 + ボーン間ラインを描画。
 */
export function buildBoneHierarchy(
  scene: Scene, data: BoneDataFile, root: TransformNode,
): Map<string, TransformNode> {
  const bones = new Map<string, TransformNode>();
  const scale = data.globalSettings.unitScaleFactor / 100;

  const jointMat = new StandardMaterial('boneVis_jMat', scene);
  jointMat.diffuseColor = new Color3(0.2, 0.8, 0.3);
  const lineMat = new Color3(1, 1, 0);

  for (const entry of data.bones) {
    const node = new TransformNode(`boneVis_${entry.name}`, scene);
    if (entry.parent && bones.has(entry.parent)) {
      node.parent = bones.get(entry.parent)!;
    } else {
      node.parent = root;
    }
    node.position.set(
      entry.localPosition[0] * scale,
      entry.localPosition[1] * scale,
      entry.localPosition[2] * scale,
    );
    const pre = eulerXYZToQuat(entry.preRotation[0], entry.preRotation[1], entry.preRotation[2]);
    const lcl = eulerXYZToQuat(entry.localRotation[0], entry.localRotation[1], entry.localRotation[2]);
    node.rotationQuaternion = pre.multiply(lcl);

    const sphere = MeshBuilder.CreateSphere(`boneVis_s_${entry.name}`, { diameter: 0.025 }, scene);
    sphere.material = jointMat;
    sphere.parent = node;

    bones.set(entry.name, node);
  }

  // Lines
  const lineParent = new TransformNode('boneVis_lines', scene);
  lineParent.parent = root;
  let linesBuilt = false;

  scene.onBeforeRenderObservable.add(() => {
    if (linesBuilt) return;
    linesBuilt = true;
    for (const entry of data.bones) {
      if (!entry.parent) continue;
      const child = bones.get(entry.name);
      const parent = bones.get(entry.parent);
      if (!child || !parent) continue;
      child.computeWorldMatrix(true);
      parent.computeWorldMatrix(true);
      const cp = child.getAbsolutePosition();
      const pp = parent.getAbsolutePosition();
      const line = MeshBuilder.CreateLines(`boneVis_l_${entry.name}`, {
        points: [cp, pp], updatable: false,
      }, scene);
      (line as unknown as { color: Color3 }).color = lineMat;
    }
  });

  return bones;
}
