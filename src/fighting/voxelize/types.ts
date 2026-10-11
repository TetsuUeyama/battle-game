/**
 * voxelize — 任意メッシュをボクセル化して FAP スケルトンへ自動バインドする
 * パイプラインの型契約。
 *
 * 入力は「三角形スープ」(TriangleMesh) に正規化する。FBX/OBJ など形式固有の
 * パースはこのモジュールの外 (アプリ層 or extras) で行い、ここは Babylon のみに
 * 依存する。骨は使わず形状だけもらう — モーションは最初から FAP スケルトンで
 * ネイティブ再生するので、anna で確定した rest 幾何不一致の問題が発生しない。
 */

/** 形式非依存の三角形スープ */
export interface TriangleMesh {
  /** xyz 連続。長さ = 頂点数 × 3 */
  positions: Float32Array;
  /** 3 要素で 1 三角形 */
  indices: Uint32Array;
  /** 三角形ごとの RGB (0..1)。長さ = 三角形数 × 3。省略時はグレー */
  triangleColors?: Float32Array;
}

/** voxelizeTriangleMesh の出力。グリッドセル座標 + ワールド配置情報 */
export interface VoxelizedModel {
  count: number;
  xs: Uint16Array;
  ys: Uint16Array;
  zs: Uint16Array;
  /** ボクセルごとの RGB (0..1)。長さ = count × 3 */
  colors: Float32Array;
  /** グリッド原点 (セル (0,0,0) の最小コーナーのワールド座標) */
  origin: [number, number, number];
  voxelSize: number;
  /** グリッド寸法 (セル数) */
  size: [number, number, number];
}

/** ボクセル 1 個あたりのスキン影響 (最大 maxInfluences 本) */
export interface VoxelSkinWeights {
  /** ボクセル数 */
  count: number;
  /** 影響ボーン数/ボクセル */
  maxInfluences: number;
  /** segment 配列への index。-1 = 影響なし。長さ = count × maxInfluences */
  boneIndices: Int32Array;
  /** 正規化済みウェイト。長さ = count × maxInfluences */
  weights: Float32Array;
}
