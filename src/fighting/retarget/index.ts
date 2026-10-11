/**
 * feature1: retarget / bind の公開 API。
 * プロデューサーが最終配線時に runtime/index.ts から再 export する。
 */

export {
  loadFightingCharacter,
  preloadAnimations,
  PreloadedAnimations,
  type PreloadAnimationsOptions,
  type LoadFightingCharacterOptions,
  type FightingCharacter,
} from "./loadFightingCharacter";

export {
  retarget,
  buildNameResolver,
  buildBindingProfile,
  type RetargetResult,
  type RetargetOptions,
} from "./retarget";
