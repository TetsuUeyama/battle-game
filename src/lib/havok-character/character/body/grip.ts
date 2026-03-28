/**
 * グリップ設定。手のひらオフセット・グリップポイント座標を定義。
 */
import { Vector3 } from '@babylonjs/core';

export const GRIP_CONFIG = {
  /** 手のひら中心オフセット (m): IK end bone(手首) → 手のひら中心 */
  palmOffset: 0.064,
  /** 手のひらグリップポイント (hand bone local space) */
  palmGripPoints: {
    right_upper: new Vector3(0.028, 0.100, 0.025),  // tip側 (人差し指根元)
    right_lower: new Vector3(-0.022, 0.098, 0.025),  // pommel側 (薬指根元)
    left_upper: new Vector3(-0.028, 0.100, 0.025),
    left_lower: new Vector3(0.022, 0.098, 0.025),
  },
};
