import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { SkeletonJson } from "./buildAnnaSkeleton";
import type { AnnaSkeleton } from "./buildAnnaSkeleton";
import { SEGMENT_PARENT, SEGMENT_REP } from "./arpSegments";

/** Blender(Z-up) → Babylon(Y-up): (x, z, y) ※既存の voxel/skeleton と同じ変換 */
function toBabylon(v: [number, number, number]): Vector3 {
  return new Vector3(v[0], v[2], v[1]);
}

/**
 * ARP の壊れた階層は使わず、標準(Humanoid)セグメントを ARP ボーンの head 位置から
 * clean な親子で組み直す。これで親の回転が子を移動させ、関節が繋がる。
 * 返り値は AnnaSkeleton 互換（nodesByName は「標準セグメント名」キー）。
 */
export function buildCleanSkeleton(
  scene: Scene,
  json: SkeletonJson,
): AnnaSkeleton {
  const boneHead = new Map<string, [number, number, number]>();
  for (const b of json.bones) boneHead.set(b.name, b.head_rest);

  // セグメント world rest 位置（rep ボーンの head）
  const restWorld = new Map<string, Vector3>();
  for (const [seg, rep] of Object.entries(SEGMENT_REP)) {
    const head = boneHead.get(rep);
    if (head) restWorld.set(seg, toBabylon(head));
  }

  const nodesByName = new Map<string, TransformNode>();
  const root = new TransformNode("annaCleanRoot", scene);

  // 親が先に来るよう深さ順に作る
  const depth = (seg: string): number => {
    let d = 0;
    let p = SEGMENT_PARENT[seg];
    while (p) {
      d++;
      p = SEGMENT_PARENT[p];
    }
    return d;
  };
  const segs = [...restWorld.keys()].sort((a, b) => depth(a) - depth(b));

  for (const seg of segs) {
    const node = new TransformNode(seg, scene);
    nodesByName.set(seg, node);
    const world = restWorld.get(seg)!;
    // 実在する最近接の親セグメントを探す
    let parentSeg = SEGMENT_PARENT[seg];
    while (parentSeg && !restWorld.has(parentSeg)) parentSeg = SEGMENT_PARENT[parentSeg];
    if (parentSeg && nodesByName.has(parentSeg)) {
      node.parent = nodesByName.get(parentSeg)!;
      node.position = world.subtract(restWorld.get(parentSeg)!);
    } else {
      node.parent = root;
      node.position = world.clone();
    }
  }

  return { nodesByName, restWorld, root };
}
