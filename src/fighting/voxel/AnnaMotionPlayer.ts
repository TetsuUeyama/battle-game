import type { Scene } from "@babylonjs/core/scene";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnnaSkeleton } from "./buildAnnaSkeleton";
import { ALL_SEGMENTS } from "./arpSegments";

export interface MotionKey {
  t: number;
  v: number[];
}
export interface MotionTrack {
  rotation?: MotionKey[];
  position?: MotionKey[];
  scale?: MotionKey[];
}
export interface MotionFile {
  name: string;
  duration: number;
  frameRate: number;
  settings?: { loop?: boolean } | null;
  tracks: Record<string, MotionTrack>;
  auxTracks?: Record<string, MotionTrack>;
}

/** fap-skeleton.json */
export interface FapNode {
  name: string;
  parent: number;
  rest: number[]; // [x,y,z,w]
  std: string | null;
}
export interface FapSkeleton {
  nodes: FapNode[];
}

/**
 * FAP 標準ボーン名 → anna セグメント名。
 * clean スケルトンはセグメントを標準名で命名しているので恒等写像。
 */
const STD_TO_ANNA: Record<string, string> = Object.fromEntries(
  ALL_SEGMENTS.map((s) => [s, s]),
);

interface AnnaTarget {
  std: string;
  fapIndex: number;
  node: TransformNode;
  depth: number;
}

/**
 * v2: ワールド空間 delta リターゲット。
 *  - FAP を FK して各ボーンの rest/anim ワールド回転を出す
 *  - deltaWorld = animWorld ⊗ restWorld^-1
 *  - anna(rest=identity)へ: desiredWorld = deltaWorld → ローカル = parentWorld^-1 ⊗ desiredWorld
 */
export class AnnaMotionPlayer {
  private readonly scene: Scene;
  private readonly skeleton: AnnaSkeleton;
  private obs: Observer<Scene> | null = null;

  private fap: FapSkeleton | null = null;
  private fapTopo: number[] = []; // 親が先に来る順
  private fapRestWorld: Quaternion[] = [];
  private targets: AnnaTarget[] = []; // anna depth 昇順

  private motion: MotionFile | null = null;
  /** fap node index → 回転キー（無ければ null=rest 固定） */
  private nodeKeys: ({ t: number; q: Quaternion }[] | null)[] = [];
  private elapsed = 0;
  private loop = true;

  constructor(scene: Scene, skeleton: AnnaSkeleton) {
    this.scene = scene;
    this.skeleton = skeleton;
  }

  setFapSkeleton(fap: FapSkeleton): void {
    this.fap = fap;
    const n = fap.nodes.length;

    // topo 順（親→子）
    const order: number[] = [];
    const done = new Uint8Array(n);
    const visit = (i: number) => {
      if (done[i]) return;
      const p = fap.nodes[i].parent;
      if (p >= 0) visit(p);
      done[i] = 1;
      order.push(i);
    };
    for (let i = 0; i < n; i++) visit(i);
    this.fapTopo = order;

    // rest ワールド回転
    const rw: Quaternion[] = new Array(n);
    for (const i of order) {
      const r = fap.nodes[i].rest;
      const local = new Quaternion(r[0], r[1], r[2], r[3]);
      const p = fap.nodes[i].parent;
      rw[i] = p >= 0 ? rw[p].multiply(local) : local.clone();
    }
    this.fapRestWorld = rw;

    // anna 適用ターゲット（std → fap index, anna node, depth）
    const stdToFap = new Map<string, number>();
    fap.nodes.forEach((nd, i) => {
      if (nd.std && !stdToFap.has(nd.std)) stdToFap.set(nd.std, i);
    });
    const targets: AnnaTarget[] = [];
    for (const [std, annaName] of Object.entries(STD_TO_ANNA)) {
      const fapIndex = stdToFap.get(std);
      const node = this.skeleton.nodesByName.get(annaName);
      if (fapIndex === undefined || !node) continue;
      targets.push({ std, fapIndex, node, depth: annaDepth(node) });
    }
    targets.sort((a, b) => a.depth - b.depth);
    this.targets = targets;
  }

  static mappedStandardBones(): string[] {
    return Object.keys(STD_TO_ANNA);
  }

  play(motion: MotionFile): void {
    if (!this.fap) {
      throw new Error("setFapSkeleton() を先に呼んでください");
    }
    this.stop();
    this.motion = motion;
    this.elapsed = 0;
    this.loop = motion.settings?.loop ?? true;

    // 各 fap node の回転キーを束ねる（tracks[std] か auxTracks[name]）
    this.nodeKeys = this.fap.nodes.map((nd) => {
      const tr =
        (nd.std && motion.tracks[nd.std]?.rotation) ||
        motion.auxTracks?.[nd.name]?.rotation;
      if (!tr || tr.length === 0) return null;
      return tr.map((k) => ({
        t: k.t,
        q: new Quaternion(k.v[0], k.v[1], k.v[2], k.v[3]),
      }));
    });

    this.obs = this.scene.onBeforeRenderObservable.add(() => this.tick());
  }

  stop(): void {
    if (this.obs) {
      this.scene.onBeforeRenderObservable.remove(this.obs);
      this.obs = null;
    }
  }

  resetPose(): void {
    this.stop();
    for (const t of this.targets) t.node.rotationQuaternion = Quaternion.Identity();
  }

  private tick(): void {
    if (!this.motion || !this.fap) return;
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    this.elapsed += dt;
    const dur = this.motion.duration || 1;
    let t = this.elapsed;
    if (this.loop) t = t % dur;
    else if (t > dur) t = dur;

    const nodes = this.fap.nodes;
    const n = nodes.length;

    // 1) 各 node の局所回転（anim か rest）
    const local: Quaternion[] = new Array(n);
    const tmp = new Quaternion();
    for (let i = 0; i < n; i++) {
      const keys = this.nodeKeys[i];
      if (keys) {
        sampleQuat(keys, t, tmp);
        local[i] = tmp.clone();
      } else {
        const r = nodes[i].rest;
        local[i] = new Quaternion(r[0], r[1], r[2], r[3]);
      }
    }

    // 2) FK で anim ワールド回転
    const animWorld: Quaternion[] = new Array(n);
    for (const i of this.fapTopo) {
      const p = nodes[i].parent;
      animWorld[i] = p >= 0 ? animWorld[p].multiply(local[i]) : local[i].clone();
    }

    // 3) deltaWorld = animWorld ⊗ restWorld^-1 → anna desiredWorld（rest=identity）
    // anna は Blender→Babylon 変換 (x,z,y) が深さ軸の鏡像になっているため、
    // glTF 系で求めた delta を深さ(Babylon Z)軸で鏡像補正して anna 系へ移す。
    // 鏡像(Z軸): (x,y,z,w) → (-x,-y,z,w)
    const desired = new Map<string, Quaternion>();
    for (const tg of this.targets) {
      const i = tg.fapIndex;
      const d = animWorld[i].multiply(Quaternion.Inverse(this.fapRestWorld[i]));
      desired.set(tg.std, new Quaternion(-d.x, -d.y, d.z, d.w));
    }

    // 4) anna へ（depth 昇順）：local = parentWorld^-1 ⊗ desiredWorld
    for (const tg of this.targets) {
      const want = desired.get(tg.std)!;
      const parent = tg.node.parent as TransformNode | null;
      let parentWorld = Quaternion.Identity();
      if (parent) {
        parent.computeWorldMatrix(true);
        parentWorld = parent.absoluteRotationQuaternion;
      }
      const localRot = Quaternion.Inverse(parentWorld).multiply(want);
      tg.node.rotationQuaternion = localRot;
      tg.node.computeWorldMatrix(true);
    }
  }
}

function annaDepth(node: TransformNode): number {
  let d = 0;
  let p = node.parent as TransformNode | null;
  while (p) {
    d++;
    p = p.parent as TransformNode | null;
  }
  return d;
}

function sampleQuat(
  keys: { t: number; q: Quaternion }[],
  t: number,
  out: Quaternion,
): void {
  if (keys.length === 1 || t <= keys[0].t) {
    out.copyFrom(keys[0].q);
    return;
  }
  const last = keys[keys.length - 1];
  if (t >= last.t) {
    out.copyFrom(last.q);
    return;
  }
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 0;
  Quaternion.SlerpToRef(a.q, b.q, f, out);
}
