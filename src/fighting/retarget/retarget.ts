/**
 * リターゲットの一般化。
 *
 * 既存の `loader/retargetAnimations.ts` は「同一リグ・同名ボーン」前提で、
 * 別 GLB の AnimationGroup を名前一致でターゲットノードへ貼り替えるだけだった。
 * ここではそれを次の 3 段階に拡張する:
 *
 *  1. 同一リグ        … 名前一致でそのまま (既存 retargetAnimationGroups 相当)。
 *  2. 名前が違う場合   … BindingProfile.boneNameMap(target→source) で解決。
 *                       さらに sourceToStandard + targetToStandard があれば
 *                       「FAPソース名 → 標準名 → ターゲット名」のブリッジで自動対応。
 *  3. リグ差(向き/ポーズ) … BindingProfile.rotationFix(target bone→ローカル回転
 *                       オフセット) をベストエフォートで適用。
 *
 * 限界:
 *  - rotationFix は対象ノードの rotationQuaternion カーブの各キーに対し
 *    `key * offset` を後乗せするだけの簡易補正。Unity Humanoid の muscle 空間
 *    変換(各ボーンの軸/可動域を正規化してから再展開する)までは行わない。
 *    バインドポーズが大きく異なるリグでは破綻し得る。
 *  - 位置カーブ(position)はスケール差を補正しない。骨長が違うモデルでは
 *    手足が伸び縮みし得る(通常は Hips の position のみ意味を持つ)。
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Animation } from "@babylonjs/core/Animations/animation";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

import type { BindingProfile } from "../fighting/types";
import type { StandardBoneName } from "../avatar/StandardSkeleton";
import type { BoneMappingJson } from "../animator/types";

export interface RetargetResult {
  /** ターゲット側ノードへ貼り替え済みの新しい AnimationGroup 群 */
  groups: AnimationGroup[];
  /** 名前一致して貼り替えられた TargetedAnimation の数 */
  matched: number;
  /** 一致するノードが無く捨てた TargetedAnimation の数 */
  skipped: number;
  /** rotationFix を適用したノード数 (延べではなくユニーク) */
  rotationFixApplied: number;
}

export interface RetargetOptions {
  /**
   * position トラックを残すターゲットボーン名のパターン。
   * 指定すると、一致しないボーンの position カーブを捨てる (回転のみ適用)。
   * ソースとプロポーション (骨長) が違うターゲットへ適用する際に
   * /^(Root|Hips)$/ 等を渡すと、骨長がターゲット側のまま保たれる。
   * 省略時は全トラックを保持 (従来挙動)。
   */
  keepPositionFor?: RegExp;
}

/**
 * ターゲット名 → ソース名 の解決器を BindingProfile から組み立てる。
 *
 * 解決順:
 *  1. boneNameMap[target] が明示されていればそれを採用。
 *  2. sourceToStandard + targetToStandard が揃っていれば
 *     target → standard → source のブリッジで解決。
 *  3. どちらも無ければ恒等 (同名) とみなす。
 */
export function buildNameResolver(
  binding?: BindingProfile,
): (targetName: string) => string {
  const boneNameMap = binding?.boneNameMap;
  const targetToStandard = binding?.targetToStandard;
  const sourceToStandard = binding?.sourceToStandard;

  // standard → source の逆引きを事前構築 (ブリッジ用)
  let standardToSource: Map<StandardBoneName, string> | null = null;
  if (sourceToStandard) {
    standardToSource = new Map();
    for (const [src, std] of Object.entries(sourceToStandard)) {
      if (std && !standardToSource.has(std)) {
        standardToSource.set(std, src);
      }
    }
  }

  return (targetName: string): string => {
    // 1) 明示マップ最優先
    const explicit = boneNameMap?.[targetName];
    if (explicit) return explicit;

    // 2) standard ブリッジ
    if (targetToStandard && standardToSource) {
      const std = targetToStandard[targetName];
      if (std) {
        const src = standardToSource.get(std);
        if (src) return src;
      }
    }

    // 3) 恒等
    return targetName;
  };
}

/**
 * 別 GLB で焼かれた AnimationGroup を、BindingProfile に従って
 * ターゲット側ノード (targetNodes) へ貼り替える。
 *
 * binding を省略すると「ソース名 = ターゲット名」の同一リグ経路になり、
 * 既存 retargetAnimationGroups と同じ挙動になる。
 *
 * 元の AnimationGroup・元スケルトンは呼び出し側で dispose してよい
 * (返した group は Animation.clone() 済みで targetNodes を参照するため独立)。
 */
export function retarget(
  scene: Scene,
  srcGroups: readonly AnimationGroup[],
  targetNodes: readonly Node[],
  binding?: BindingProfile,
  opts?: RetargetOptions,
): RetargetResult {
  // ターゲットノードを名前で引けるように
  const byName = new Map<string, Node>();
  for (const n of targetNodes) {
    if (!byName.has(n.name)) byName.set(n.name, n);
  }

  // ソース名 → ターゲットノード の対応を作る。
  // resolver は target→source なので逆向きに展開して source→targetNode を得る。
  const resolveSource = buildNameResolver(binding);
  const sourceToTargetNode = new Map<string, Node>();
  for (const [targetName, node] of byName) {
    const sourceName = resolveSource(targetName);
    // 同一ソースが複数ターゲットへ向く場合は最初を採用
    if (!sourceToTargetNode.has(sourceName)) {
      sourceToTargetNode.set(sourceName, node);
    }
  }

  const groups: AnimationGroup[] = [];
  let matched = 0;
  let skipped = 0;
  const fixedNodeNames = new Set<string>();

  const rotationFix = binding?.rotationFix;

  for (const src of srcGroups) {
    const out = new AnimationGroup(src.name, scene);
    for (const ta of src.targetedAnimations) {
      const srcTargetName = (ta.target as { name?: string } | null)?.name;
      const dest = srcTargetName
        ? sourceToTargetNode.get(srcTargetName)
        : undefined;
      if (!dest) {
        skipped++;
        continue;
      }

      // プロポーション保持: 指定パターン以外の position カーブは捨てる
      if (
        opts?.keepPositionFor &&
        ta.animation.targetProperty === "position" &&
        !opts.keepPositionFor.test(dest.name)
      ) {
        skipped++;
        continue;
      }

      let anim = ta.animation.clone();

      // リグ差の回転補正 (ベストエフォート)。
      // 対象ターゲットボーンに rotationFix があり、かつこのカーブが
      // rotationQuaternion を動かしているなら、各キーへオフセットを後乗せする。
      const fix = rotationFix?.[dest.name];
      if (
        fix &&
        anim.targetProperty === "rotationQuaternion" &&
        anim.dataType === Animation.ANIMATIONTYPE_QUATERNION
      ) {
        applyRotationOffset(anim, fix);
        fixedNodeNames.add(dest.name);
      }

      out.addTargetedAnimation(anim, dest);
      matched++;
    }
    out.normalize(src.from, src.to);
    groups.push(out);
  }

  return {
    groups,
    matched,
    skipped,
    rotationFixApplied: fixedNodeNames.size,
  };
}

/**
 * Quaternion 回転カーブの各キー値に、ローカル回転オフセットを後乗せする。
 *   key' = key * offsetQuat
 * 限界: キー間の補間は元のまま。微小オフセットなら問題ないが、大きな補正だと
 * 補間経路が理想とずれる。muscle 空間変換ではない簡易版。
 */
function applyRotationOffset(
  anim: Animation,
  euler: readonly [number, number, number],
): void {
  const offset = Quaternion.RotationYawPitchRoll(euler[1], euler[0], euler[2]);
  const keys = anim.getKeys();
  for (const k of keys) {
    const v = k.value as Quaternion;
    if (v && typeof v.multiply === "function") {
      k.value = v.multiply(offset);
    }
  }
  anim.setKeys(keys);
}

/**
 * 2 つの bone-mapping.json (Unity Editor 拡張出力の entries 配列形式) から
 * BindingProfile の sourceToStandard / targetToStandard を組み立てるヘルパ。
 *
 * source 側 = FAP アニメ GLB の bone-mapping、target 側 = ユーザモデルの
 * bone-mapping。両方を標準名へ正規化することで、名前が違うリグ同士でも
 * 「standard 経由」で対応が付く。
 *
 * 追加の boneNameMap / rotationFix は引数 extra でマージできる。
 */
export function buildBindingProfile(
  sourceMapping: BoneMappingJson,
  targetMapping: BoneMappingJson,
  extra?: Pick<BindingProfile, "boneNameMap" | "rotationFix">,
): BindingProfile {
  return {
    sourceToStandard: toSourceToStandard(sourceMapping),
    targetToStandard: toSourceToStandard(targetMapping),
    boneNameMap: extra?.boneNameMap,
    rotationFix: extra?.rotationFix,
  };
}

/** entries(standardName,sourceName) を sourceName → standardName の辞書へ */
function toSourceToStandard(
  mapping: BoneMappingJson,
): Partial<Record<string, StandardBoneName>> {
  const out: Partial<Record<string, StandardBoneName>> = {};
  for (const e of mapping.entries) {
    out[e.sourceName] = e.standardName as StandardBoneName;
  }
  return out;
}
