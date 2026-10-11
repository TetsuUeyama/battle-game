/**
 * /fight の技テーブル。
 *
 * fightingGamesystem の sampleMoves はフレーム値が固定の調整値だが、FAP クリップの
 * 実フレーム長は GLB を読むまで分からない (clip-settings は Unity フレーム基準で
 * Babylon AnimationGroup のフレームレートと一致する保証がない)。
 * ここではロード済み AnimationGroup の実長 (group.to) に対する比率で
 * startup / active / recovery / cooldown を生成する。
 * 比率はそれっぽい調整値であり、実測のインパクトフレームではない (MISSING.md 参照)。
 */

import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { MoveDefinition, HurtboxBinding } from '@/fighting/fighting/types';
import type { EmotionPersonalityId } from '@/fighting/emotion';

/** 技の素となる宣言。フレームはクリップ長比で指定する */
interface MoveSpec {
  id: string;
  label: string;
  clip: string;
  /** hitbox を付けるボーン。防御アクション (攻撃判定なし) では省略 */
  bone?: string;
  radius?: number;
  /** hitbox のボーンローカルオフセット (既定 0)。判定位置の微調整用 */
  offset?: [number, number, number];
  damage: number;
  /** クリップ長に対する比率 [発生, active終了]。recovery は activeEnd→recoveryEnd */
  startupPct: number;
  activeEndPct: number;
  recoveryEndPct: number;
  /** クールタイム (クリップ長比) */
  cooldownPct: number;
  cancelInto?: string[];
  /** 再生速度 (見た目ごと高速化。判定は masterFrame 追跡で追従)。既定 1 */
  animSpeed?: number;
  /** 無敵区間 (クリップ長比 [from, to])。区間中は被弾を完全回避 */
  invulnPct?: [number, number];
  /** スーパーアーマー区間 (クリップ長比)。ダメージは受けるが仰け反らない */
  armorPct?: [number, number];
}

/** ゲーム層で使う技定義 = ランタイム契約 MoveDefinition + 特殊属性 */
export interface GameMove extends MoveDefinition {
  animSpeed: number;
  /** 無敵区間 (フレーム)。combat.getStatus().frame と比較する */
  invuln?: [number, number];
  /** スーパーアーマー区間 (フレーム) */
  armor?: [number, number];
}

/**
 * ファイトスタイル。キャラごとに技セットを変える。
 * 技 id (jab/straight/...) は全スタイル共通の「6 スロット」で、CpuBrain の
 * 距離帯テーブル・コンボルートはスタイルを意識せずそのまま動く。
 */
export type FightStyle = 'boxer' | 'kicker' | 'power' | 'speed';

/** リーグ戦などで列挙する全スタイル */
export const FIGHT_STYLES: FightStyle[] = ['boxer', 'kicker', 'power', 'speed'];

export const STYLE_LABELS: Record<FightStyle, string> = {
  boxer: 'ボクサー',
  kicker: 'キックボクサー',
  power: 'パワー',
  speed: 'スピード',
};

/**
 * スタイル → emotion 性格プリセット (feature5)。
 * boxer=中庸でクリーンヒットから Zone を狙う / kicker=冷静沈着で乱れない /
 * power=熱血で被弾するほど興奮 / speed=ビビりで大ダメージに弱いが立ち直り最速。
 */
export const STYLE_PERSONALITY: Record<FightStyle, EmotionPersonalityId> = {
  boxer: 'steady',
  kicker: 'coolheaded',
  power: 'hotblood',
  speed: 'timid',
};

/**
 * 体格。wrapper の scaling に適用する。
 * width は水平 (X/Z) 等倍なので Y 回転 (相手への正対) で歪まない。
 * 大柄 = リーチが伸びるが被弾判定もデカい / 小柄 = その逆、という
 * 格闘ゲームらしいトレードオフが自動で生まれる。
 */
export interface BodyType {
  /** 水平スケール (X/Z)。リーチと被弾判定の横幅に効く */
  width: number;
  /** 垂直スケール (Y)。身長 */
  height: number;
  label: string;
}

/** スタイルごとの既定体格 (キャラクターエディットの初期値) */
export const STYLE_BODY: Record<FightStyle, BodyType> = {
  boxer: { width: 1.0, height: 1.0, label: '標準' },
  kicker: { width: 1.05, height: 1.15, label: '高身長' },
  speed: { width: 0.9, height: 0.86, label: '低身長' },
  power: { width: 1.28, height: 1.0, label: '太め (標準身長)' },
};

/**
 * キャラクターエディットで上書きした体格 (なければ STYLE_BODY を使う)。
 * Fighter は getBody() 経由で参照するので、エディット → 対戦に即反映される。
 */
const bodyOverrides: Partial<Record<FightStyle, BodyType>> = {};

/** 現在有効な体格 (オーバーライド優先) */
export function getBody(style: FightStyle): BodyType {
  return bodyOverrides[style] ?? STYLE_BODY[style];
}

/** 体格を上書きする。null で既定へ戻す */
export function setBodyOverride(style: FightStyle, body: BodyType | null): void {
  if (body) bodyOverrides[style] = body;
  else delete bodyOverrides[style];
}

/** 体格から判定半径に掛けるスケール (水平寄りの平均) */
export function radiusScaleOf(body: BodyType): number {
  return (body.width * 2 + body.height) / 3;
}

/**
 * 技ごとのモーション上書き (モーションカスタマイズ)。
 * クリップ長比のフレームパラメータとダメージを技単位で差し替える。
 * 未指定のフィールドは spec の既定値を使う。
 */
export interface MoveOverride {
  startupPct?: number;
  activeEndPct?: number;
  recoveryEndPct?: number;
  cooldownPct?: number;
  damage?: number;
  /** 再生速度 (見た目ごと高速/低速化)。判定は masterFrame 追跡で追従。既定 1 */
  animSpeed?: number;
  /** 攻撃判定を付けるボーン (判定位置)。未指定で spec の bone */
  hitBone?: string;
  /** 攻撃判定の半径 (体格スケール適用前。攻撃範囲)。未指定で spec の radius */
  hitRadius?: number;
  /** 攻撃判定のボーンローカルオフセット (判定位置の微調整) */
  hitOffset?: [number, number, number];
}

/** 攻撃判定に選べるボーン (実機リグに存在する確認済みのボーン名) */
export const HITBOX_BONES: { bone: string; label: string }[] = [
  { bone: 'LeftHand', label: '左手' },
  { bone: 'RightHand', label: '右手' },
  { bone: 'LeftForeArm', label: '左前腕 (肘)' },
  { bone: 'RightForeArm', label: '右前腕 (肘)' },
  { bone: 'RightFoot', label: '右足' },
  { bone: 'RightLeg', label: '右すね/膝' },
  { bone: 'LeftUpLeg', label: '左もも' },
  { bone: 'RightUpLeg', label: '右もも' },
  { bone: 'Head', label: '頭' },
  { bone: 'Hips', label: '腰' },
];

/**
 * キャラクターエディットで上書きした技パラメータ (なければ STYLE_SPECS を使う)。
 * buildMoves が getMoveOverride() 経由で参照するので、エディット → 対戦に即反映される。
 */
const moveOverrides: Partial<Record<FightStyle, Record<string, MoveOverride>>> = {};

/** 現在有効な技オーバーライド (なければ undefined) */
export function getMoveOverride(style: FightStyle, moveId: string): MoveOverride | undefined {
  return moveOverrides[style]?.[moveId];
}

/** スタイルの技オーバーライドを丸ごと差し替える。null で既定へ戻す */
export function setMoveOverrides(
  style: FightStyle,
  overrides: Record<string, MoveOverride> | null,
): void {
  if (overrides) moveOverrides[style] = overrides;
  else delete moveOverrides[style];
}

/**
 * 技の既定パラメータ (MotionEdit の初期値表示用)。
 * STYLE_SPECS / DEFENSE_SPECS から該当 spec を探して返す。
 */
export function defaultMoveParams(
  style: FightStyle,
  moveId: string,
): {
  startupPct: number; activeEndPct: number; recoveryEndPct: number; cooldownPct: number;
  damage: number; animSpeed: number; hitBone: string; hitRadius: number;
  hitOffset: [number, number, number];
} | undefined {
  const spec = [...STYLE_SPECS[style], ...DEFENSE_SPECS].find((s) => s.id === moveId);
  if (!spec) return undefined;
  return {
    startupPct: spec.startupPct,
    activeEndPct: spec.activeEndPct,
    recoveryEndPct: spec.recoveryEndPct,
    cooldownPct: spec.cooldownPct,
    damage: spec.damage,
    animSpeed: spec.animSpeed ?? 1,
    hitBone: spec.bone ?? '',
    hitRadius: spec.radius ?? 0.15,
    hitOffset: spec.offset ?? [0, 0, 0],
  };
}

/**
 * 技のクリップ名と特殊区間 (無敵/アーマー) を返す (MotionEdit のタイムライン表示用)。
 * クリップ名はそのクリップの実フレーム長を引くのに使い、無敵/アーマーは
 * 読み取り専用のオーバーレイとしてバーに重ねて表示する。
 */
export function moveDisplayInfo(
  style: FightStyle,
  moveId: string,
): { clip: string; invulnPct?: [number, number]; armorPct?: [number, number] } | undefined {
  const spec = [...STYLE_SPECS[style], ...DEFENSE_SPECS].find((s) => s.id === moveId);
  if (!spec) return undefined;
  return { clip: spec.clip, invulnPct: spec.invulnPct, armorPct: spec.armorPct };
}

/** 1P: ボクサースタイル。パンチ主体で発生が速く、蹴りは前蹴り系のみ */
const BOXER_SPECS: MoveSpec[] = [
  {
    id: 'jab', label: 'ジャブ (J)', clip: 'KB_p_Jab_L_1', bone: 'LeftHand',
    radius: 0.16, damage: 5,
    startupPct: 0.16, activeEndPct: 0.42, recoveryEndPct: 0.62, cooldownPct: 0.7,
    cancelInto: ['straight', 'hook'],
    animSpeed: 1.1, // ボクサーはジャブの回転が速い
  },
  {
    id: 'straight', label: 'ワンツー (K)', clip: 'KB_p_OneTwo', bone: 'RightHand',
    radius: 0.17, damage: 8,
    startupPct: 0.18, activeEndPct: 0.5, recoveryEndPct: 0.72, cooldownPct: 0.85,
    cancelInto: ['hook', 'midKick'],
  },
  {
    id: 'hook', label: 'フック (L)', clip: 'KB_p_Hook_R', bone: 'RightHand',
    radius: 0.18, damage: 11,
    startupPct: 0.2, activeEndPct: 0.52, recoveryEndPct: 0.76, cooldownPct: 0.95,
    cancelInto: ['uppercut'],
  },
  {
    id: 'uppercut', label: 'アッパー (U)', clip: 'KB_p_Uppercut_R', bone: 'RightHand',
    radius: 0.19, damage: 15,
    startupPct: 0.22, activeEndPct: 0.55, recoveryEndPct: 0.85, cooldownPct: 1.1,
    invulnPct: [0.04, 0.35], // 昇龍型: 出始め無敵の切り返し技
  },
  {
    id: 'midKick', label: '前蹴り (I)', clip: 'KB_p_MidKickFront_R', bone: 'RightFoot',
    radius: 0.2, damage: 12,
    startupPct: 0.2, activeEndPct: 0.5, recoveryEndPct: 0.78, cooldownPct: 1.0,
  },
  {
    id: 'highKick', label: '上段前蹴り (O)', clip: 'KB_p_HighKickStraight_R', bone: 'RightFoot',
    radius: 0.2, damage: 16,
    startupPct: 0.23, activeEndPct: 0.54, recoveryEndPct: 0.88, cooldownPct: 1.15,
  },
];

/** 2P/CPU: キックボクサースタイル。蹴り・肘・膝主体でリーチと単発火力に勝る */
const KICKER_SPECS: MoveSpec[] = [
  {
    id: 'jab', label: 'ジャブ (J)', clip: 'KB_m_Jab_L', bone: 'LeftHand',
    radius: 0.16, damage: 5,
    startupPct: 0.16, activeEndPct: 0.42, recoveryEndPct: 0.62, cooldownPct: 0.7,
    cancelInto: ['straight', 'hook'],
  },
  {
    id: 'straight', label: 'ワンツー (K)', clip: 'KB_m_OneTwo', bone: 'RightHand',
    radius: 0.17, damage: 8,
    startupPct: 0.18, activeEndPct: 0.5, recoveryEndPct: 0.72, cooldownPct: 0.85,
    cancelInto: ['hook', 'midKick'],
  },
  {
    id: 'hook', label: '回し肘 (L)', clip: 'KB_m_ElbowRound_R', bone: 'RightForeArm',
    radius: 0.18, damage: 11,
    startupPct: 0.19, activeEndPct: 0.5, recoveryEndPct: 0.76, cooldownPct: 0.95,
    cancelInto: ['uppercut'],
  },
  {
    id: 'uppercut', label: '右膝 (U)', clip: 'KB_m_KneeRight', bone: 'RightLeg',
    radius: 0.19, damage: 14,
    startupPct: 0.2, activeEndPct: 0.5, recoveryEndPct: 0.8, cooldownPct: 1.05,
  },
  {
    id: 'midKick', label: 'ミドル回し蹴り (I)', clip: 'KB_m_MidKickRoud_R_1', bone: 'RightFoot',
    radius: 0.21, damage: 13,
    startupPct: 0.2, activeEndPct: 0.5, recoveryEndPct: 0.8, cooldownPct: 1.0,
  },
  {
    id: 'highKick', label: '上段回し蹴り (O)', clip: 'KB_m_HighKickRound_R_1', bone: 'RightFoot',
    radius: 0.21, damage: 18,
    startupPct: 0.25, activeEndPct: 0.56, recoveryEndPct: 0.9, cooldownPct: 1.25,
    animSpeed: 1.1, // キックボクサーは大技の振りが鋭い
  },
];

/** パワー型。発生・クールタイムが重い代わりに単発火力が最大 */
const POWER_SPECS: MoveSpec[] = [
  {
    id: 'jab', label: '肘打ち (J)', clip: 'KB_p_Elbow_R', bone: 'RightForeArm',
    radius: 0.17, damage: 6,
    startupPct: 0.18, activeEndPct: 0.46, recoveryEndPct: 0.68, cooldownPct: 0.8,
    cancelInto: ['straight', 'hook'],
  },
  {
    id: 'straight', label: 'バックスイング (K)', clip: 'KB_m_Backswing_R', bone: 'RightHand',
    radius: 0.18, damage: 10,
    startupPct: 0.22, activeEndPct: 0.52, recoveryEndPct: 0.78, cooldownPct: 1.0,
    cancelInto: ['hook'],
  },
  {
    id: 'hook', label: '裏拳回し (L)', clip: 'KB_m_BackfistRound_R', bone: 'RightHand',
    radius: 0.19, damage: 13,
    startupPct: 0.24, activeEndPct: 0.55, recoveryEndPct: 0.82, cooldownPct: 1.1,
    cancelInto: ['uppercut'],
  },
  {
    id: 'uppercut', label: '剛アッパー (U)', clip: 'KB_m_Uppercut_R', bone: 'RightHand',
    radius: 0.2, damage: 17,
    startupPct: 0.26, activeEndPct: 0.58, recoveryEndPct: 0.9, cooldownPct: 1.3,
    armorPct: [0.06, 0.55], // パワー型: 振りかぶり中はスーパーアーマー
  },
  {
    id: 'midKick', label: '剛ミドル (I)', clip: 'KB_m_MidKickStraight_R', bone: 'RightFoot',
    radius: 0.21, damage: 15,
    startupPct: 0.24, activeEndPct: 0.54, recoveryEndPct: 0.85, cooldownPct: 1.2,
  },
  {
    id: 'highKick', label: 'かかと落とし (O)', clip: 'KB_AxeKick', bone: 'RightFoot',
    radius: 0.21, damage: 20,
    startupPct: 0.3, activeEndPct: 0.6, recoveryEndPct: 0.95, cooldownPct: 1.5,
    armorPct: [0.08, 0.6], // パワー型の象徴: 潰されない大技
  },
];

/** スピード型。火力は低いが発生・回転が速く、キャンセルルートが広い */
const SPEED_SPECS: MoveSpec[] = [
  {
    id: 'jab', label: '速ジャブ (J)', clip: 'KB_p_MidJab_L', bone: 'LeftHand',
    radius: 0.15, damage: 4,
    startupPct: 0.13, activeEndPct: 0.38, recoveryEndPct: 0.55, cooldownPct: 0.55,
    cancelInto: ['straight', 'hook', 'midKick'],
    animSpeed: 1.2, // スピード型は全体的に振りが速い
  },
  {
    id: 'straight', label: 'ダブルジャブ (K)', clip: 'KB_p_DoubleJab', bone: 'LeftHand',
    radius: 0.16, damage: 6,
    startupPct: 0.15, activeEndPct: 0.45, recoveryEndPct: 0.65, cooldownPct: 0.7,
    cancelInto: ['hook', 'uppercut', 'midKick'],
    animSpeed: 1.15,
  },
  {
    id: 'hook', label: '中段フック (L)', clip: 'KB_p_MidHook_R', bone: 'RightHand',
    radius: 0.17, damage: 8,
    startupPct: 0.17, activeEndPct: 0.47, recoveryEndPct: 0.68, cooldownPct: 0.8,
    cancelInto: ['uppercut'],
  },
  {
    id: 'uppercut', label: '中段アッパー (U)', clip: 'KB_p_MidUppercut_R', bone: 'RightHand',
    radius: 0.17, damage: 10,
    startupPct: 0.18, activeEndPct: 0.48, recoveryEndPct: 0.72, cooldownPct: 0.85,
    cancelInto: ['midKick'],
  },
  {
    id: 'midKick', label: 'ローキック (I)', clip: 'KB_p_LowKick_R_1', bone: 'RightFoot',
    radius: 0.18, damage: 9,
    startupPct: 0.17, activeEndPct: 0.46, recoveryEndPct: 0.7, cooldownPct: 0.8,
  },
  {
    id: 'highKick', label: 'ラビットキック (O)', clip: 'KB_m_MidRabbitKick_R', bone: 'RightFoot',
    radius: 0.19, damage: 12,
    startupPct: 0.2, activeEndPct: 0.5, recoveryEndPct: 0.78, cooldownPct: 0.95,
    animSpeed: 1.1,
    invulnPct: [0.05, 0.3], // 跳びながら蹴る: 出始めは打撃をすかす
  },
];

/**
 * 防御アクション (全スタイル共通)。攻撃判定なしの GameMove として実装する。
 *
 * 3 すくみの設計:
 * - ガード (Space 長押し): 安全。被ダメ 20% のチップのみ、仰け反らない。Fighter の state で実装。
 * - スウェー (Q): 中盤に無敵。成功すれば無傷 + recovery を攻撃でキャンセルできる
 *   (守→攻の最速ルート)。ただし無敵の前後を殴られると素のフルヒット (ガードと違い軽減なし)。
 * - カウンター (E): 無敵窓がシビアで、空振り時の隙が最大。成功すると自動で
 *   反撃 (スタイルの uppercut × 1.3 倍ダメージ) に移行し、形勢を一気に攻勢へ返す。
 */
const DEFENSE_SPECS: MoveSpec[] = [
  {
    id: 'sway', label: 'スウェー (Q)', clip: 'KB_Dodge_L', damage: 0,
    startupPct: 0.12, activeEndPct: 0.5, recoveryEndPct: 0.62, cooldownPct: 1.0,
    invulnPct: [0.12, 0.5],
    animSpeed: 1.2,
    // recovery を攻撃でキャンセル可能 = 「次の行動に移りやすい」
    cancelInto: ['jab', 'straight', 'hook', 'uppercut', 'midKick', 'highKick'],
  },
  {
    id: 'counter', label: 'カウンター (E)', clip: 'KB_p_Duck', damage: 0,
    startupPct: 0.1, activeEndPct: 0.42, recoveryEndPct: 0.95, cooldownPct: 1.4,
    invulnPct: [0.1, 0.42], // 窓はスウェーよりシビア
    animSpeed: 1.1,
    // 空振り時はキャンセル不可 = 大きな隙 (ハイリスク)
  },
];

/**
 * スタイルの技サマリ (キャラクターエディット表示用)。
 * クリップ非依存の設計値 (id/ラベル/ダメージ/属性) だけ返す。
 */
export function styleMoveSummary(
  style: FightStyle,
): { id: string; label: string; damage: number; trait?: string }[] {
  return STYLE_SPECS[style].map((s) => ({
    id: s.id,
    label: s.label,
    damage: s.damage,
    trait: s.invulnPct ? '無敵' : s.armorPct ? 'アーマー' : undefined,
  }));
}

/** カウンター成功時に自動発動する反撃 (スタイルの uppercut を流用) */
export const COUNTER_FOLLOWUP_ID = 'uppercut';
/** カウンター反撃のダメージ倍率 */
export const COUNTER_DAMAGE_MUL = 1.3;

const STYLE_SPECS: Record<FightStyle, MoveSpec[]> = {
  boxer: BOXER_SPECS,
  kicker: KICKER_SPECS,
  power: POWER_SPECS,
  speed: SPEED_SPECS,
};

/**
 * ロード済みクリップ長から、指定スタイルの GameMove 群を生成する。
 * radiusScale は体格による hitbox 半径の補正 (大柄ほど拳も大きい)。
 */
export function buildMoves(
  clips: ReadonlyMap<string, AnimationGroup>,
  style: FightStyle,
  radiusScale = 1,
  overrides?: Record<string, MoveOverride>,
): Map<string, GameMove> {
  const out = new Map<string, GameMove>();
  for (const spec of [...STYLE_SPECS[style], ...DEFENSE_SPECS]) {
    const group = clips.get(spec.clip);
    if (!group) continue; // クリップ未ロード (GLB を読んでいない) → 技を登録しない
    const len = group.to - group.from;
    // モーションカスタマイズ: 上書きがあればフレーム/ダメージを差し替える。
    // overrides 指定時 (= マイキャラの自己完結した上書き) はそれを使い、
    // 未指定なら従来のスタイル別グローバル上書き (getMoveOverride) を見る。
    const ov = overrides ? overrides[spec.id] : getMoveOverride(style, spec.id);
    const startupPct = ov?.startupPct ?? spec.startupPct;
    const activeEndPct = ov?.activeEndPct ?? spec.activeEndPct;
    const recoveryEndPct = ov?.recoveryEndPct ?? spec.recoveryEndPct;
    const cooldownPct = ov?.cooldownPct ?? spec.cooldownPct;
    const damage = ov?.damage ?? spec.damage;
    const animSpeed = ov?.animSpeed ?? spec.animSpeed ?? 1;
    // 攻撃判定 (付着ボーン / 範囲 / 位置オフセット) の上書き
    const hitBone = ov?.hitBone ?? spec.bone;
    const hitRadius = ov?.hitRadius ?? spec.radius ?? 0.15;
    const hitOffset = ov?.hitOffset ?? spec.offset;
    const startup = Math.round(len * startupPct);
    const activeEnd = Math.round(len * activeEndPct);
    const recoveryEnd = Math.round(len * recoveryEndPct);
    const window = (pct?: [number, number]): [number, number] | undefined =>
      pct ? [Math.round(len * pct[0]), Math.round(len * pct[1])] : undefined;
    out.set(spec.id, {
      id: spec.id,
      label: spec.label,
      clip: spec.clip,
      startup,
      active: [startup, activeEnd],
      recovery: Math.max(1, recoveryEnd - activeEnd),
      cooldown: Math.round(len * cooldownPct),
      damage,
      cancelInto: spec.cancelInto,
      // 防御アクション (bone なし) は攻撃判定を持たない
      hitboxes: hitBone
        ? [{ bone: hitBone, radius: hitRadius * radiusScale, offset: hitOffset }]
        : [],
      animSpeed,
      invuln: window(spec.invulnPct),
      armor: window(spec.armorPct),
    });
  }
  return out;
}

/** 強度ごとのヒットストップ秒数 (攻防両者の現行クリップを一瞬止める) */
export const HITSTOP: Record<HitStrength, number> = {
  weak: 0.06,
  med: 0.09,
  high: 0.13,
};

/** ガードで受けたときの軽いヒットストップ */
export const GUARD_HITSTOP = 0.04;

/** ダメージ → ヒットリアクションの強度 */
export type HitStrength = 'weak' | 'med' | 'high';

export function hitStrength(damage: number): HitStrength {
  if (damage <= 8) return 'weak';
  if (damage <= 13) return 'med';
  return 'high';
}

/** 強度ごとの硬直秒数とノックバック量 (クリップは部位・方向から別途選択) */
export const HIT_REACTIONS: Record<HitStrength, { stun: number; knockback: number }> = {
  weak: { stun: 0.4, knockback: 0.14 },
  med: { stun: 0.6, knockback: 0.24 },
  high: { stun: 0.75, knockback: 0.34 },
};

/** hurtbox ボーン名 → やられの高さ (FAP クリップ名の High/Mid/Low) */
function hitHeight(hurtboxBone: string): 'High' | 'Mid' | 'Low' {
  if (hurtboxBone === 'Head' || hurtboxBone === 'Neck') return 'High';
  if (hurtboxBone === 'Hips' || hurtboxBone.endsWith('UpLeg')) return 'Low';
  return 'Mid';
}

/**
 * HitEvent の部位情報 (hurtboxBone) と防御側ローカルの横ずれ量から、
 * FAP の方向別やられクリップ候補を優先順で返す。
 * 存在しない組み合わせ (LowFront 等) があるため、呼び出し側は
 * rig.clips にある最初の候補を使う。
 *
 * @param lateral 防御側の右方向を + とした横ずれ量 (m)
 */
export function reactionCandidates(
  strength: HitStrength,
  hurtboxBone: string,
  lateral: number,
): string[] {
  const height = hitHeight(hurtboxBone);
  const dir = Math.abs(lateral) < 0.12 ? 'Front' : lateral > 0 ? 'Right' : 'Left';
  const side = lateral >= 0 ? 'Right' : 'Left'; // Low 系は Front が無いので左右へ寄せる

  if (strength === 'weak') {
    if (height === 'Low') {
      return [`KB_Hit_p_Low${side}_Weak`, 'KB_Hit_p_MidFront_Weak'];
    }
    return [
      `KB_Hit_p_${height}${dir}_Weak`,
      `KB_Hit_p_Mid${dir}_Weak`,
      'KB_Hit_p_MidFront_Weak',
    ];
  }

  const medCandidates = height === 'Low'
    ? [`KB_Hit_m_Low${side}_Med`, 'KB_Hit_m_MidFront_Med']
    : [
      `KB_Hit_m_${height}${dir}_Med`,
      `KB_Hit_m_Mid${dir}_Med`,
      'KB_Hit_m_MidFront_Med',
    ];

  if (strength === 'med') return medCandidates;

  // high: よろけ (Stagger) があればそれを優先 (Mid Front/Left/Right, HighFront のみ存在)
  const staggerHeight = height === 'Low' ? 'Mid' : height;
  return [
    `KB_Hit_m_${staggerHeight}${dir}_Stagger`,
    `KB_Hit_m_Mid${dir}_Stagger`,
    'KB_Hit_m_MidFront_Stagger',
    ...medCandidates,
  ];
}

/** 最後の一撃の強度 → KO クリップ */
export const KO_CLIPS: Record<HitStrength, string> = {
  weak: 'KB_MidKO',
  med: 'KB_MidKO',
  high: 'KB_HighKO_R',
};

/** 被弾判定。Maskman の実ボーン名 (sampleMoves の SAMPLE_HURTBOXES と同等) */
export const HURTBOXES: readonly HurtboxBinding[] = [
  { bone: 'Head', radius: 0.16 },
  { bone: 'Neck', radius: 0.12 },
  { bone: 'Spine1', radius: 0.22 },
  { bone: 'Hips', radius: 0.2 },
  { bone: 'RightForeArm', radius: 0.12 },
  { bone: 'LeftForeArm', radius: 0.12 },
  { bone: 'RightUpLeg', radius: 0.15 },
  { bone: 'LeftUpLeg', radius: 0.15 },
];

/** ロードするアニメ GLB (assets-manifest の glbPath) */
export const ANIM_GLB_PATHS = [
  'kb_movement/kb_movement.glb',
  'kb_punches/kb_punches.glb',
  'kb_kicks/kb_kicks.glb',
  'kb_hits/kb_hits.glb',
  'kb_kos/kb_kos.glb',
  'kb_blocks/kb_blocks.glb',
];

export const MODEL_GLB_PATH = 'maskman_loded2/maskman_loded2.glb';

/** ロコモーション関連クリップ名 */
export const CLIP = {
  idle: 'KB_Idle_1',
  walkFwd: 'KB_WalkFwd1',
  walkBwd: 'KB_WalkBwd',
  sideL: 'KB_Sidestep_L',
  sideR: 'KB_Sidestep_R',
  blockLoop: 'KB_Block_Loop',
} as const;
