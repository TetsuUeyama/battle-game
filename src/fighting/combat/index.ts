/**
 * feature3: combat — 攻撃判定/当たり判定 + フレームデータ実行系の公開 API。
 *
 * CharacterRig (feature1 retarget が生成) を「戦わせる」側。
 * fighting/types.ts の契約のみに依存し、他 Creator の実装には依存しない。
 */

export {
  CombatController,
  type CombatStatus,
  type CombatPhase,
  type PlayMoveOptions,
  type ForceCancelOptions,
} from "./CombatController";

export {
  configureBlending,
  startWithBlending,
  type StartWithBlendingOptions,
} from "./blend";

export {
  resolvePush,
  rootDistanceXZ,
  type PushTarget,
  type ResolvePushOptions,
} from "./push";

export {
  SAMPLE_MOVES,
  SAMPLE_HURTBOXES,
  jab,
  straight,
  hook,
  uppercut,
  midKick,
  highKick,
} from "./sampleMoves";

// 契約型も combat 利用側が 1 箇所から import できるよう再 export
export type {
  CharacterRig,
  MoveDefinition,
  HitboxBinding,
  HurtboxBinding,
  HitEvent,
} from "../fighting/types";
