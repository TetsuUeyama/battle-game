/**
 * Combat AI — 標的のランダム移動 (TargetMover)。
 */
import { Vector3, TransformNode } from '@babylonjs/core';
import type { TargetMover } from '../types';

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
