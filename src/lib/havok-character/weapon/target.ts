/**
 * 練習用標的の作成。簡易ポスト型 (棒 + 頭部球)。
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial, TransformNode, Mesh,
} from '@babylonjs/core';

export function createTarget(
  scene: Scene, position: Vector3, prefix: string,
): { root: TransformNode; meshes: Mesh[] } {
  const root = new TransformNode(`${prefix}_target`, scene);
  root.position.copyFrom(position);

  const mat = new StandardMaterial(`${prefix}_targetMat`, scene);
  mat.diffuseColor = new Color3(0.7, 0.2, 0.2);

  const body = MeshBuilder.CreateCylinder(`${prefix}_tBody`, {
    height: 1.2, diameter: 0.25,
  }, scene);
  body.material = mat;
  body.parent = root;
  body.position.y = 0.6;

  const head = MeshBuilder.CreateSphere(`${prefix}_tHead`, { diameter: 0.25 }, scene);
  head.material = mat;
  head.parent = root;
  head.position.y = 1.35;

  const base = MeshBuilder.CreateCylinder(`${prefix}_tBase`, {
    height: 0.05, diameter: 0.4,
  }, scene);
  const baseMat = new StandardMaterial(`${prefix}_tBaseMat`, scene);
  baseMat.diffuseColor = new Color3(0.4, 0.4, 0.4);
  base.material = baseMat;
  base.parent = root;
  base.position.y = 0.025;

  return { root, meshes: [body, head, base] };
}
