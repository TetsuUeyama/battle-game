import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** skeleton.json の 1 ボーン */
export interface SkeletonBone {
  name: string;
  parent: string | null;
  use_deform?: boolean;
  head_rest: [number, number, number];
  tail_rest?: [number, number, number];
}
export interface SkeletonJson {
  armature?: string;
  bone_count?: number;
  bones: SkeletonBone[];
}

export interface AnnaSkeleton {
  /** ボーン名 → TransformNode（rest ポーズで配置済み・identity 回転） */
  nodesByName: Map<string, TransformNode>;
  /** ボーン名 → Babylon ワールド rest 位置（head） */
  restWorld: Map<string, Vector3>;
  root: TransformNode;
}

/** Blender(Z-up, meter) → Babylon(Y-up): (x, z, y) */
function toBabylon(v: [number, number, number]): Vector3 {
  return new Vector3(v[0], v[2], v[1]);
}

/**
 * skeleton.json(ARP, 303 bones) から TransformNode 階層を構築する。
 * 各ノードは rest 位置・identity 回転。後でローカル回転を与えると子ごと動く。
 */
export function buildAnnaSkeleton(
  scene: Scene,
  json: SkeletonJson,
): AnnaSkeleton {
  const byName = new Map<string, SkeletonBone>();
  for (const b of json.bones) byName.set(b.name, b);

  const restWorld = new Map<string, Vector3>();
  for (const b of json.bones) restWorld.set(b.name, toBabylon(b.head_rest));

  const nodesByName = new Map<string, TransformNode>();
  const skeletonRoot = new TransformNode("annaSkeletonRoot", scene);

  // 1) 全ボーンのノードを作る
  for (const b of json.bones) {
    nodesByName.set(b.name, new TransformNode(b.name, scene));
  }

  // 2) 親子付け＋ローカル位置（親が無ければ skeletonRoot 直下）
  for (const b of json.bones) {
    const node = nodesByName.get(b.name)!;
    const world = restWorld.get(b.name)!;
    const parentBone = b.parent && byName.has(b.parent) ? b.parent : null;
    if (parentBone) {
      const parentNode = nodesByName.get(parentBone)!;
      const parentWorld = restWorld.get(parentBone)!;
      node.parent = parentNode;
      node.position = world.subtract(parentWorld); // ローカル = 子world - 親world
    } else {
      node.parent = skeletonRoot;
      node.position = world.clone();
    }
  }

  return { nodesByName, restWorld, root: skeletonRoot };
}
