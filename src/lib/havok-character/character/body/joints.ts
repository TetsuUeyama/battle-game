/**
 * 関節可動域制限。IKソルバーが関節角度をクランプする際に参照する。
 */

export interface JointLimitDef {
  /** 最小曲げ角 (deg, 0=完全伸展) */
  minBendDeg: number;
  /** 最大曲げ角 (deg) */
  maxBendDeg: number;
}

/** 1軸の角度制限 */
export interface AxisLimitDeg {
  min: number;
  max: number;
}

/** XYZ 3軸の角度制限 */
export interface AxisLimits3 {
  x: AxisLimitDeg;
  y: AxisLimitDeg;
  z: AxisLimitDeg;
}

/**
 * 人体の関節可動域に基づく制限値。
 *
 * 参考: 日本整形外科学会・日本リハビリテーション医学会の関節可動域表示
 * https://www.joa.or.jp/jp/member/committee/range_of_motion.html
 */
export const JOINT_CONFIG = {
  arm: {
    /** IKソルバー用の単軸制限 (肘の曲げ角) */
    root: { minBendDeg: 0, maxBendDeg: 160 } as JointLimitDef,  // 肩
    mid:  { minBendDeg: 5, maxBendDeg: 125 } as JointLimitDef,   // 肘: 5°伸展〜125°屈曲
    /** 上腕 (肩関節) のXYZ制限 */
    upperArm: {
      x: { min: -50,  max: 60 },   // 伸展50° / 屈曲60° (腕を後ろ/前)
      y: { min: -40,  max: 40 },   // 内旋40° / 外旋40°
      z: { min: -45,  max: 170 },  // 内転(体側より内)-45° / 外転+屈曲170°
    } as AxisLimits3,
    /** 前腕 (肘関節) のXYZ制限 */
    foreArm: {
      x: { min: -125,  max: 0 },    // 屈曲-125° / 伸展0°
      y: { min: 0,  max: 0 },     // [一時的に固定] 回内80° / 回外80°
      z: { min: 0,   max: 0 },    // [一時的に固定] 肘は横方向ほぼ動かない
    } as AxisLimits3,
    /** 手首のXYZ制限 */
    hand: {
      x: { min: -55, max: 55 },    // 掌屈55° / 背屈55°
      y: { min: -30, max: 30 },    // 回旋 ±30°
      z: { min: -30, max: 30 },    // 橈屈/尺屈 ±30°
    } as AxisLimits3,
  },
  leg: {
    root: { minBendDeg: 0, maxBendDeg: 120 } as JointLimitDef,  // 股関節
    mid:  { minBendDeg: 5, maxBendDeg: 130 } as JointLimitDef,  // 膝: 0°伸展〜130°屈曲
  },
  shoulder: {
    x: { min: -20, max: 20 } as AxisLimitDeg,   // 鎖骨の挙上/下制
    y: { min: -15, max: 15 } as AxisLimitDeg,   // 鎖骨のねじり (小さい)
    z: { min: 0,   max: 30 } as AxisLimitDeg,   // 鎖骨の前方突出
  },
  spine: {
    x: { min: -15, max: 25 },   // 後屈15° / 前屈25°
    y: { min: -35, max: 35 },   // 体幹回旋 左右35°
    z: { min: -15, max: 15 },   // 側屈 左右15°
  } as AxisLimits3,
  spine1: {
    x: { min: -15, max: 20 },
    y: { min: -35, max: 35 },
    z: { min: -15, max: 15 },
  } as AxisLimits3,
  spine2: {
    x: { min: -10, max: 15 },
    y: { min: -30, max: 30 },
    z: { min: -10, max: 10 },
  } as AxisLimits3,
} as const;
