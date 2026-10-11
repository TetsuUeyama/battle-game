import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

export interface RetargetResult {
  /** ターゲット側ノードへ貼り替え済みの新しい AnimationGroup 群 */
  groups: AnimationGroup[];
  /** 名前一致して貼り替えられた TargetedAnimation の数 */
  matched: number;
  /** 一致するノードが無く捨てた TargetedAnimation の数 */
  skipped: number;
}

/**
 * 別 GLB で焼かれた AnimationGroup を、名前一致で別キャラ (targetNodes) の
 * ノードへ貼り替える。
 *
 * Fighting Animset Pro のように「アニメ FBX」と「キャラモデル」が別ファイルでも、
 * ボーン名が一致していれば (Kubold リグは全ファイル共通) これでキャラ側へ適用できる。
 * Unity の Humanoid リターゲットのような muscle 空間変換ではなく、単純な
 * 「同名ボーンへ同じローカル TRS カーブを流す」方式。元リグとターゲットリグの
 * バインドポーズ/ボーン階層が同一であることが前提 (FAP は満たす)。
 *
 * 元の AnimationGroup・元スケルトンは呼び出し側で dispose してよい
 * (返した group は Animation.clone() 済みで targetNodes を参照するため独立)。
 */
export function retargetAnimationGroups(
  scene: Scene,
  srcGroups: readonly AnimationGroup[],
  targetNodes: readonly Node[],
): RetargetResult {
  const byName = new Map<string, Node>();
  for (const n of targetNodes) {
    // 同名が複数あれば最初のものを採用 (skin の joint は一意な想定)
    if (!byName.has(n.name)) byName.set(n.name, n);
  }

  const groups: AnimationGroup[] = [];
  let matched = 0;
  let skipped = 0;

  for (const src of srcGroups) {
    const out = new AnimationGroup(src.name, scene);
    for (const ta of src.targetedAnimations) {
      const targetName = (ta.target as { name?: string } | null)?.name;
      const dest = targetName ? byName.get(targetName) : undefined;
      if (!dest) {
        skipped++;
        continue;
      }
      out.addTargetedAnimation(ta.animation.clone(), dest);
      matched++;
    }
    // フレーム範囲を元グループに合わせる
    out.normalize(src.from, src.to);
    groups.push(out);
  }

  return { groups, matched, skipped };
}
