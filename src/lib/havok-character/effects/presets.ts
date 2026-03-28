/**
 * 戦闘エフェクト用パーティクルプリセット定義。
 * 汎用パーティクルエンジン (particle-fx.ts) に渡すプリセットをここで定義する。
 */
import { Color3 } from '@babylonjs/core';
import type { FluidPreset } from '@/lib/particle-fx';

/** 血しぶきプリセット (ヒット時) */
export const PRESET_COMBAT_BLOOD: FluidPreset = {
  name: 'CombatBlood',
  color: new Color3(0.6, 0.02, 0.02),
  specular: new Color3(0.4, 0.1, 0.1),
  residueColor: new Color3(0.3, 0.01, 0.01),
  alpha: 0.9,
  residueAlpha: 0.7,
  particleSize: 0.02,
  gravityMul: 1.0,
  airResistance: 0.3,
  dripSpeed: 0.02,
  dripDelay: [1, 3],
  splashOnGround: true,
  splashOnMesh: true,
  splashMul: 2,
  speedMul: 1.0,
  verticalDamping: 0.3,
};

/** 火花プリセット (武器クラッシュ時) */
export const PRESET_COMBAT_SPARK: FluidPreset = {
  name: 'CombatSpark',
  color: new Color3(1.0, 0.8, 0.2),
  specular: new Color3(1.0, 1.0, 0.8),
  residueColor: new Color3(0.3, 0.2, 0.05),
  alpha: 1.0,
  residueAlpha: 0,
  particleSize: 0.012,
  gravityMul: 0.5,
  airResistance: 0.8,
  dripSpeed: 0,
  dripDelay: [10, 10],
  splashOnGround: false,
  splashOnMesh: false,
  splashMul: 0,
  speedMul: 1.5,
  verticalDamping: 0,
};
