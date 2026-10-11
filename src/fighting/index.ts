export * from "./avatar";
export * from "./animator";
export * from "./loader";

// feature5: emotion (excited/calm 2軸リソース)
export * from "./emotion";

// voxelize: 任意メッシュ → ボクセル → FAP スケルトン自動バインド
export * from "./voxelize";

// 3D 格闘ゲーム システム (共通契約 + 3 feature)
export * from "./fighting/types";
export {
  loadFightingCharacter,
  preloadAnimations,
  PreloadedAnimations,
  type PreloadAnimationsOptions,
  type LoadFightingCharacterOptions,
  type FightingCharacter,
  retarget,
  buildNameResolver,
  buildBindingProfile,
  type RetargetOptions,
  // loader 側の RetargetResult と名前衝突するため別名で公開
  type RetargetResult as BindRetargetResult,
} from "./retarget";
export {
  PoseLayerController,
  LookAtController,
  compileSpineBend,
  applyProceduralPose,
  type PoseRigLike,
  type LookAtOptions,
  type ProceduralPoseResult,
} from "./pose";
export {
  CombatController,
  type CombatStatus,
  type CombatPhase,
  type PlayMoveOptions,
  type ForceCancelOptions,
  configureBlending,
  startWithBlending,
  type StartWithBlendingOptions,
  resolvePush,
  rootDistanceXZ,
  type PushTarget,
  type ResolvePushOptions,
  SAMPLE_MOVES,
  SAMPLE_HURTBOXES,
  jab,
  straight,
  hook,
  uppercut,
  midKick,
  highKick,
} from "./combat";
