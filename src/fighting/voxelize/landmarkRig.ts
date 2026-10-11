/**
 * Mixamo 式マーカー関節合わせ — 少数ランドマークから全 FAP 関節位置を推定する。
 *
 * Mixamo Auto-Rigger は「正面ビューで少数のランドマーク (あご/手首/肘/膝/股下) を
 * 置くと全身骨を推定」する。本モジュールは同じ発想で、ユーザーが置いた 10 点の
 * ワールド座標から、applyJointMarkers に渡す全 MARKER_BONES の位置を作る。
 *
 * 角度は扱わない: autoSkin はボーン線分への近接距離だけでウェイトを決め、
 * applyJointMarkers は位置だけ合わせれば十分 (向きはスキニングの正しさに不関与)。
 * 角度逆算は rest roll 差リターゲット問題を再導入するため行わない。
 *
 * 推定方法: 確定したランドマーク (= FAP 関節へ対応) を端点に、間の未確定関節を
 * 「FAP 既定姿勢の弧長比率」を保って比例補間で配置する。Spine → 腕 → 脚 の順に
 * 解くことで、腕脚チェーンが Spine2 (= spine チェーンで確定) を起点に使える。
 */

import type { JointMarkers } from "./fitMarkers";

/** Mixamo 式 10 ランドマークの定義 (id / 表示名 / 対応 FAP ボーン / 左右) */
export interface Landmark {
  id: string;
  label: string;
  /** このランドマークが確定させる FAP ボーン名 */
  bone: string;
  side: "left" | "right" | "center";
}

/** 10 点 (Mixamo 純正 8 点 + 足首 2)。side は左右対称ミラーに使う */
export const LANDMARKS: readonly Landmark[] = [
  { id: "chin", label: "あご", bone: "Head", side: "center" },
  { id: "groin", label: "股下", bone: "Hips", side: "center" },
  { id: "lElbow", label: "左肘", bone: "LeftForeArm", side: "left" },
  { id: "rElbow", label: "右肘", bone: "RightForeArm", side: "right" },
  { id: "lWrist", label: "左手首", bone: "LeftHand", side: "left" },
  { id: "rWrist", label: "右手首", bone: "RightHand", side: "right" },
  { id: "lKnee", label: "左膝", bone: "LeftLeg", side: "left" },
  { id: "rKnee", label: "右膝", bone: "RightLeg", side: "right" },
  { id: "lAnkle", label: "左足首", bone: "LeftFoot", side: "left" },
  { id: "rAnkle", label: "右足首", bone: "RightFoot", side: "right" },
] as const;

/** 左右ミラーのペア (id → 反対側 id)。center は対称対象外 */
export const MIRROR_PAIRS: Record<string, string> = {
  lElbow: "rElbow", rElbow: "lElbow",
  lWrist: "rWrist", rWrist: "lWrist",
  lKnee: "rKnee", rKnee: "lKnee",
  lAnkle: "rAnkle", rAnkle: "lAnkle",
};

/** ランドマーク id → ワールド座標 [x,y,z] */
export type LandmarkPositions = Record<string, [number, number, number]>;

/**
 * 推定に使う FAP チェーン (parent→child)。spine を先頭に置くことで、
 * 続く腕チェーンが起点 Spine2 を「確定済み」として使える。
 */
const CHAINS: readonly string[][] = [
  ["Hips", "Spine", "Spine2", "Neck", "Head"],
  ["Spine2", "LeftArm", "LeftForeArm", "LeftHand"],
  ["Spine2", "RightArm", "RightForeArm", "RightHand"],
  ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot"],
  ["Hips", "RightUpLeg", "RightLeg", "RightFoot"],
];

type Vec3 = [number, number, number];

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** fapDefault からランドマークの初期ワールド座標 (10 点) を取り出す */
export function landmarkDefaults(fapDefault: JointMarkers): LandmarkPositions {
  const out: LandmarkPositions = {};
  for (const lm of LANDMARKS) {
    const p = fapDefault[lm.bone];
    if (p) out[lm.id] = [p[0], p[1], p[2]];
  }
  return out;
}

/** 左右対称ミラー面の x (股下ランドマーク優先、無ければ Hips 既定) */
export function mirrorPlaneX(
  landmarks: LandmarkPositions,
  fapDefault: JointMarkers,
): number {
  const groin = landmarks["groin"];
  if (groin) return groin[0];
  const hips = fapDefault["Hips"];
  return hips ? hips[0] : 0;
}

/** ある id を反対側へミラーした座標を返す (対称ペアでないなら null) */
export function mirrorLandmark(
  id: string,
  pos: Vec3,
  planeX: number,
): { id: string; pos: Vec3 } | null {
  const other = MIRROR_PAIRS[id];
  if (!other) return null;
  return { id: other, pos: [2 * planeX - pos[0], pos[1], pos[2]] };
}

/**
 * 10 ランドマークのワールド座標から全 MARKER_BONES の位置を推定する。
 *
 * @param landmarks 置かれたランドマーク (一部のみでも可。未配置は FAP 既定のまま)
 * @param fapDefault FAP rest 姿勢の全 MARKER_BONES 座標 (readJointMarkers の出力)
 */
export function inferMarkersFromLandmarks(
  landmarks: LandmarkPositions,
  fapDefault: JointMarkers,
): JointMarkers {
  // 1) FAP 既定を土台にして、確定したランドマーク (対応ボーン) を上書き
  const result: JointMarkers = {};
  for (const [bone, p] of Object.entries(fapDefault)) {
    result[bone] = [p[0], p[1], p[2]];
  }
  const anchored = new Set<string>();
  for (const lm of LANDMARKS) {
    const p = landmarks[lm.id];
    if (p) {
      result[lm.bone] = [p[0], p[1], p[2]];
      anchored.add(lm.bone);
    }
  }

  // 2) チェーンごとに、確定端点の間の未確定関節を FAP 弧長比率で比例補間。
  //    spine を先に解くので、腕チェーンは起点 Spine2 を確定済みとして扱える。
  const resolved = new Set<string>(anchored);
  for (const chain of CHAINS) {
    // この chain で位置が確定しているノードの index
    const known: number[] = [];
    for (let i = 0; i < chain.length; i++) {
      if (resolved.has(chain[i]) || (i === 0 && result[chain[0]])) {
        // 起点 (Hips/Spine2) は前段で確定 or FAP 既定として常に有効扱い
        known.push(i);
      } else if (anchored.has(chain[i])) {
        known.push(i);
      }
    }
    // 起点は必ず known に含める (前段チェーンで確定 or FAP 既定)
    if (known[0] !== 0) known.unshift(0);

    // FAP 既定姿勢での累積弧長 s[i]
    const s = new Array<number>(chain.length).fill(0);
    for (let i = 1; i < chain.length; i++) {
      const a = fapDefault[chain[i - 1]];
      const b = fapDefault[chain[i]];
      s[i] = s[i - 1] + (a && b ? dist(a as Vec3, b as Vec3) : 0);
    }

    // 連続する known 端点の間を比例補間
    for (let g = 0; g + 1 < known.length; g++) {
      const i = known[g];
      const j = known[g + 1];
      if (j - i <= 1) continue; // 間に未確定なし
      const pi = result[chain[i]] as Vec3;
      const pj = result[chain[j]] as Vec3;
      const span = s[j] - s[i];
      for (let k = i + 1; k < j; k++) {
        const t = span > 1e-6 ? (s[k] - s[i]) / span : (k - i) / (j - i);
        result[chain[k]] = lerp(pi, pj, t);
        resolved.add(chain[k]);
      }
    }
    // 最後の known より先 (末端側) に未確定があれば、FAP 既定の相対オフセットを
    // 末端 known からの平行移動で付与 (端点が置かれていない場合の保険)
    const last = known[known.length - 1];
    if (last < chain.length - 1) {
      const base = result[chain[last]] as Vec3;
      const fapBase = fapDefault[chain[last]] as Vec3;
      for (let k = last + 1; k < chain.length; k++) {
        if (anchored.has(chain[k])) { resolved.add(chain[k]); continue; }
        const fk = fapDefault[chain[k]] as Vec3;
        if (base && fapBase && fk) {
          result[chain[k]] = [
            base[0] + (fk[0] - fapBase[0]),
            base[1] + (fk[1] - fapBase[1]),
            base[2] + (fk[2] - fapBase[2]),
          ];
          resolved.add(chain[k]);
        }
      }
    }
    // この chain で確定した関節を resolved に積む (後続 chain の起点用)
    for (const idx of known) resolved.add(chain[idx]);
  }

  return result;
}
