import {
  REQUIRED_BONES,
  STANDARD_BONE_SET,
  type StandardBoneName,
} from "./StandardSkeleton";

/**
 * 任意リグのボーン名を標準ボーン名へ変換する辞書。
 * Unity Editor 拡張側で humanDescription.human からも生成できるし、
 * 既知リグ (Mixamo 等) はプリセット JSON を読み込んで充当する。
 */
export interface BoneMapping {
  /** 一意な ID (manifest との突合用) */
  id: string;
  /** 元のリグの種別ラベル ("mixamo", "unity-humanoid", "custom" 等) */
  rigType: string;
  /** Standard → Source name */
  bones: Partial<Record<StandardBoneName, string>>;
}

export type BoneMappingPreset = BoneMapping;

export interface BoneMappingValidationIssue {
  bone: StandardBoneName | string;
  reason: "missing" | "unknown-standard-bone";
}

export function validateBoneMapping(mapping: BoneMapping): {
  ok: boolean;
  issues: BoneMappingValidationIssue[];
} {
  const issues: BoneMappingValidationIssue[] = [];

  for (const required of REQUIRED_BONES) {
    if (!mapping.bones[required]) {
      issues.push({ bone: required, reason: "missing" });
    }
  }

  for (const key of Object.keys(mapping.bones)) {
    if (!STANDARD_BONE_SET.has(key as StandardBoneName)) {
      issues.push({ bone: key, reason: "unknown-standard-bone" });
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Source name → Standard name の逆引きを作る。
 * GLB ロード後にスケルトンの実ボーン名を標準名へ変換する用途で使う。
 */
export function buildReverseLookup(
  mapping: BoneMapping,
): ReadonlyMap<string, StandardBoneName> {
  const reverse = new Map<string, StandardBoneName>();
  for (const [standard, source] of Object.entries(mapping.bones)) {
    if (source) {
      reverse.set(source, standard as StandardBoneName);
    }
  }
  return reverse;
}

/**
 * 二つのマッピングを合成する。base のキーを override で上書き。
 * カスタムリグでプリセットを部分的に上書きしたい時に使う。
 */
export function mergeMapping(
  base: BoneMapping,
  override: Partial<BoneMapping["bones"]>,
): BoneMapping {
  return {
    ...base,
    bones: { ...base.bones, ...override },
  };
}

/**
 * Unity Editor 拡張が吐く BoneMappingJson (entries 配列形式) を
 * BoneMapping (オブジェクト形式) に変換する。
 *
 * Unity の JsonUtility は Dictionary&lt;string,string&gt; を直接シリアライズ
 * できないので向こう側は配列形式になっている。
 */
export function fromJsonEntries(json: {
  id: string;
  rigType: string;
  entries: { standardName: string; sourceName: string }[];
}): BoneMapping {
  const bones: Partial<Record<StandardBoneName, string>> = {};
  for (const e of json.entries) {
    if (STANDARD_BONE_SET.has(e.standardName as StandardBoneName)) {
      bones[e.standardName as StandardBoneName] = e.sourceName;
    }
  }
  return { id: json.id, rigType: json.rigType, bones };
}
