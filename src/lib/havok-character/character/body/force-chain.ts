/**
 * 力の伝達チェーン定義。
 *
 * ■ 基本原理
 *   力は地面(反力)から末端(武器先端)に向かって伝播する。
 *   地面を蹴る → 足 → 膝 → 腰 → 胴体 → 肩 → 肘 → 手首 → 武器先端
 *
 * ■ 関節の力生成
 *   各関節は「曲がっている関節を伸ばす」ことで力を生成する。
 *   - 曲がっている関節 (minBendForForce° 以上): 伸展力を生成し、上流の力に加算
 *   - まっすぐな関節 (minBendForForce° 未満): 自身で力を加えられず、上流の力を通過させるのみ
 *
 * ■ 例: 踏み込んで縦振り
 *   地面反力 (1.0)
 *     → 足首 (5°曲がり → 力加算 +0.1)  = 1.0 × passthrough + 0.1 = 1.05
 *     → 膝 (30°曲がり → 力加算 +0.35)  = 1.05 × 0.90 + 0.35 = 1.30
 *     → 腰 (15°曲がり → 力加算 +0.5)   = 1.30 × 0.95 + 0.50 = 1.74
 *     → 胴体 (10°曲がり → 力加算 +0.3) = 1.74 × 0.90 + 0.30 = 1.87
 *     → 肩 (20°曲がり → 力加算 +0.4)   = 1.87 × 0.85 + 0.40 = 1.99
 *     → 肘 (90°曲がり → 力加算 +0.35)  = 1.99 × 0.85 + 0.35 = 2.04
 *     → 手首 (まっすぐ → 通過のみ)      = 2.04 × 0.95 = 1.94
 *   → 武器先端に 1.94 の力が到達
 *
 * ■ 例: 手打ち (膝・腰がまっすぐ)
 *   地面反力 (1.0)
 *     → 足首 (まっすぐ → 通過)  = 1.0 × 0.95 = 0.95
 *     → 膝 (まっすぐ → 通過)    = 0.95 × 0.90 = 0.86
 *     → 腰 (まっすぐ → 通過)    = 0.86 × 0.95 = 0.81
 *     → 胴体 (まっすぐ → 通過)  = 0.81 × 0.90 = 0.73
 *     → 肩 (15°曲がり → +0.3)  = 0.73 × 0.85 + 0.30 = 0.92
 *     → 肘 (60°曲がり → +0.25) = 0.92 × 0.85 + 0.25 = 1.03
 *     → 手首 (まっすぐ → 通過)  = 1.03 × 0.95 = 0.98
 *   → 武器先端に 0.98 の力 (全身使用時の約半分)
 */

/** 関節ごとの力伝達パラメータ */
export interface JointForceParams {
  /** この関節が力を生成するために必要な最小曲げ角 (度) */
  minBendForForce: number;
  /** 最大曲げ角時の力生成量 (加算値) */
  maxForceGain: number;
  /** まっすぐ時 or 力通過時の減衰率 (0-1, 1=減衰なし) */
  passthrough: number;
  /** この関節の質量比 (重い関節ほど慣性が大きい) */
  massRatio: number;
}

/** 力の伝達チェーン定義 */
export interface ForceChain {
  /** チェーン名 */
  name: string;
  /** 関節リスト (地面側→末端の順: 足→膝→腰→胴体→肩→肘→手首) */
  joints: {
    boneName: string;
    params: JointForceParams;
  }[];
}

/** 力の伝達結果 */
export interface ForceOutput {
  /** 各関節での累積力 */
  jointForces: Map<string, number>;
  /** 末端 (武器先端) に到達する力 */
  terminalForce: number;
  /** 力を生成した関節数 */
  activeJoints: number;
  /** 地面からの初期反力 */
  groundReaction: number;
}

// ─── パラメータ定義 ──────────────────────────────────────

export const FORCE_CHAIN_PARAMS = {
  /** 力を生成するために必要な最小曲げ角 (度) — これ未満はまっすぐ扱い */
  defaultMinBend: 8,
  /** 力を最大生成する曲げ角 (度) — これ以上は最大力 */
  fullBendAngle: 90,
  /** 地面からの初期反力 (足が接地している場合) */
  groundReactionForce: 1.0,
  /** 空中時の初期反力 (接地していない場合) */
  airReactionForce: 0.2,
} as const;

/** 各関節の力パラメータ */
const JOINT_PARAMS: Record<string, JointForceParams> = {
  // ─── 足 (地面に近い側 = 力の源) ───
  ankle:    { minBendForForce: 5,  maxForceGain: 0.10, passthrough: 0.95, massRatio: 0.03 },
  knee:     { minBendForForce: 8,  maxForceGain: 0.35, passthrough: 0.90, massRatio: 0.08 },

  // ─── 体幹 (力の中継・増幅) ───
  hip:      { minBendForForce: 3,  maxForceGain: 0.50, passthrough: 0.95, massRatio: 0.25 },
  spine:    { minBendForForce: 5,  maxForceGain: 0.30, passthrough: 0.90, massRatio: 0.20 },

  // ─── 腕 (力の末端への伝達) ───
  shoulder: { minBendForForce: 10, maxForceGain: 0.40, passthrough: 0.85, massRatio: 0.06 },
  elbow:    { minBendForForce: 8,  maxForceGain: 0.35, passthrough: 0.85, massRatio: 0.04 },
  wrist:    { minBendForForce: 5,  maxForceGain: 0.10, passthrough: 0.95, massRatio: 0.02 },
};

// ─── チェーン定義 (地面側 → 末端の順) ────────────────────

/** 右足→腰→胴体→右腕 (右手武器の攻撃チェーン) */
export const CHAIN_RIGHT_ATTACK: ForceChain = {
  name: 'rightAttack',
  joints: [
    // 地面から腰へ (右足ベース)
    { boneName: 'mixamorig:RightFoot',    params: JOINT_PARAMS.ankle },
    { boneName: 'mixamorig:RightLeg',     params: JOINT_PARAMS.knee },
    // 腰・胴体
    { boneName: 'mixamorig:Hips',         params: JOINT_PARAMS.hip },
    { boneName: 'mixamorig:Spine1',       params: JOINT_PARAMS.spine },
    // 腕 (末端へ)
    { boneName: 'mixamorig:RightArm',     params: JOINT_PARAMS.shoulder },
    { boneName: 'mixamorig:RightForeArm', params: JOINT_PARAMS.elbow },
    { boneName: 'mixamorig:RightHand',    params: JOINT_PARAMS.wrist },
  ],
};

/** 左足→腰→胴体→左腕 */
export const CHAIN_LEFT_ATTACK: ForceChain = {
  name: 'leftAttack',
  joints: [
    { boneName: 'mixamorig:LeftFoot',    params: JOINT_PARAMS.ankle },
    { boneName: 'mixamorig:LeftLeg',     params: JOINT_PARAMS.knee },
    { boneName: 'mixamorig:Hips',        params: JOINT_PARAMS.hip },
    { boneName: 'mixamorig:Spine1',      params: JOINT_PARAMS.spine },
    { boneName: 'mixamorig:LeftArm',     params: JOINT_PARAMS.shoulder },
    { boneName: 'mixamorig:LeftForeArm', params: JOINT_PARAMS.elbow },
    { boneName: 'mixamorig:LeftHand',    params: JOINT_PARAMS.wrist },
  ],
};

/** 全チェーン */
export const FORCE_CHAINS = [CHAIN_RIGHT_ATTACK, CHAIN_LEFT_ATTACK];
