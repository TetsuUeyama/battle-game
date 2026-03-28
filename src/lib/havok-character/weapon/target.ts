/**
 * 練習用標的。メッシュ作成 + ランダム移動。
 */
import {
  Scene, Vector3, Color3, MeshBuilder, StandardMaterial, TransformNode, Mesh,
} from '@babylonjs/core';
import type { TargetMover } from '../types';

// ─── 標的メッシュ作成 ───────────────────────────────────

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

// ─── 標的ランダム移動 ───────────────────────────────────

export function createTargetMover(node: TransformNode, center: Vector3, range: number): TargetMover {
  return {
    node,
    waypoint: node.position.clone(),
    speed: 0.8,
    changeTimer: 0,
    changeInterval: 2.0,
    boundsMin: center.add(new Vector3(-range, 0, -range)),
    boundsMax: center.add(new Vector3(range, 0, range)),
  };
}

export function updateTargetMover(mover: TargetMover, dt: number): void {
  mover.changeTimer += dt;
  if (mover.changeTimer >= mover.changeInterval) {
    mover.changeTimer = 0;
    mover.waypoint = new Vector3(
      mover.boundsMin.x + Math.random() * (mover.boundsMax.x - mover.boundsMin.x),
      0,
      mover.boundsMin.z + Math.random() * (mover.boundsMax.z - mover.boundsMin.z),
    );
  }

  const pos = mover.node.position;
  const toWp = mover.waypoint.subtract(pos);
  toWp.y = 0;
  const dist = toWp.length();
  if (dist > 0.05) {
    const dir = toWp.normalize();
    const step = Math.min(dist, mover.speed * dt);
    pos.addInPlace(dir.scale(step));
  }
}
