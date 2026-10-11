import type { MoveDefinition, HurtboxBinding } from "../fighting/types";

/**
 * Maskman (kb_punches / kb_kicks クリップ) を使ったサンプル技集。
 *
 * フレーム値はクリップ先頭からの 60fps 基準フレーム番号 (MoveDefinition の規約どおり)。
 * FAP のパンチ/キックは概ね 30〜60 フレームのモーションなので、
 *   startup: 拳/足が出始めるまで
 *   active : インパクトの瞬間を含む短い区間
 *   recovery: 構えに戻るまで (この間は cancelInto 以外不可)
 *   cooldown: 同じ技を連打できないようにする間隔
 * を「それっぽい」値で設定している (実測の山フレームではなく調整値)。
 *
 * hitbox は実ボーン名 RightHand / LeftHand / RightFoot に付ける。
 */

const HAND_R = "RightHand";
const HAND_L = "LeftHand";
const FOOT_R = "RightFoot";

/** ジャブ (左): 速いが弱い。ストレートへキャンセル可 */
export const jab: MoveDefinition = {
  id: "jab",
  label: "Jab (L)",
  clip: "KB_p_Jab_L_1",
  startup: 4,
  active: [4, 9],
  recovery: 10,
  cooldown: 18,
  damage: 5,
  cancelInto: ["straight", "hook", "uppercut"],
  hitboxes: [{ bone: HAND_L, radius: 0.16 }],
};

/** ストレート / ワンツー (右): ジャブから繋がる中段。フックへキャンセル可 */
export const straight: MoveDefinition = {
  id: "straight",
  label: "Straight (OneTwo)",
  clip: "KB_p_OneTwo",
  startup: 8,
  active: [8, 14],
  recovery: 14,
  cooldown: 26,
  damage: 9,
  cancelInto: ["hook"],
  hitboxes: [{ bone: HAND_R, radius: 0.17 }],
};

/** フック (右): 横振りの強打 */
export const hook: MoveDefinition = {
  id: "hook",
  label: "Hook (R)",
  clip: "KB_p_Hook_R",
  startup: 10,
  active: [10, 16],
  recovery: 18,
  cooldown: 34,
  damage: 12,
  cancelInto: ["uppercut"],
  hitboxes: [{ bone: HAND_R, radius: 0.18 }],
};

/** アッパー (右): 発生遅めの大技。コンボの締め */
export const uppercut: MoveDefinition = {
  id: "uppercut",
  label: "Uppercut (R)",
  clip: "KB_p_Uppercut_R",
  startup: 12,
  active: [12, 19],
  recovery: 24,
  cooldown: 48,
  damage: 16,
  hitboxes: [{ bone: HAND_R, radius: 0.19 }],
};

/** ミドルキック (右): リーチの長い中段蹴り */
export const midKick: MoveDefinition = {
  id: "midKick",
  label: "Mid Kick (R)",
  clip: "KB_m_MidKick_R",
  startup: 11,
  active: [11, 18],
  recovery: 22,
  cooldown: 40,
  damage: 14,
  hitboxes: [{ bone: FOOT_R, radius: 0.2 }],
};

/** ハイキック (右): 発生遅く硬直大の上段蹴り */
export const highKick: MoveDefinition = {
  id: "highKick",
  label: "High Kick (R)",
  clip: "KB_m_HighKick_R",
  startup: 14,
  active: [14, 21],
  recovery: 28,
  cooldown: 52,
  damage: 18,
  hitboxes: [{ bone: FOOT_R, radius: 0.2 }],
};

/**
 * デモ用コンボルート: Jab → Straight → Hook → Uppercut。
 * 各技の recovery 中に次の技 (cancelInto) を入力するとキャンセルで繋がる。
 */
export const SAMPLE_MOVES: readonly MoveDefinition[] = [
  jab,
  straight,
  hook,
  uppercut,
  midKick,
  highKick,
];

/**
 * 標的キャラの被弾判定。体側ボーンへ常時付与する想定。
 * 頭・胴・腕・脚を球で覆う簡易ヒットボックス。
 */
export const SAMPLE_HURTBOXES: readonly HurtboxBinding[] = [
  { bone: "Head", radius: 0.16 },
  { bone: "Neck", radius: 0.12 },
  { bone: "Spine1", radius: 0.22 },
  { bone: "Hips", radius: 0.2 },
  { bone: "RightForeArm", radius: 0.12 },
  { bone: "LeftForeArm", radius: 0.12 },
  { bone: "RightUpLeg", radius: 0.15 },
  { bone: "LeftUpLeg", radius: 0.15 },
];
