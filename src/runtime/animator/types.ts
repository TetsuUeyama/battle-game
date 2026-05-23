/**
 * Unity Editor 拡張 (`tools/unity-import/editor/Dto.cs`) の出力 JSON と
 * 1:1 で対応する型。フィールド名・case を勝手に変えないこと。
 */

export type AnimatorParameterType = "Bool" | "Float" | "Int" | "Trigger";

export interface AnimatorParameter {
  name: string;
  type: AnimatorParameterType;
  defaultFloat: number;
  defaultInt: number;
  defaultBool: boolean;
}

export type AnimatorConditionMode =
  | "If"
  | "IfNot"
  | "Greater"
  | "Less"
  | "Equals"
  | "NotEqual";

export interface AnimatorCondition {
  parameter: string;
  mode: AnimatorConditionMode;
  threshold: number;
}

export interface AnimatorTransition {
  destination: string;
  hasExitTime: boolean;
  exitTime: number;
  duration: number;
  conditions: AnimatorCondition[];
}

export interface AnimatorState {
  name: string;
  clip: string | null;
  speed: number;
  loop: boolean;
  transitions: AnimatorTransition[];
}

export interface AnimatorLayer {
  name: string;
  defaultWeight: number;
  defaultState: string | null;
  states: AnimatorState[];
  anyStateTransitions: AnimatorTransition[];
}

export interface AnimatorJson {
  name: string;
  parameters: AnimatorParameter[];
  layers: AnimatorLayer[];
}

// ------------------------------------------------------------- Manifest

export interface BoneMappingEntry {
  standardName: string;
  sourceName: string;
}

export interface BoneMappingJson {
  id: string;
  rigType: string;
  entries: BoneMappingEntry[];
}

export interface AssetManifestEntry {
  id: string;
  sourcePath: string;
  glbPath?: string;
  animatorPath?: string;
  boneMappingPath?: string;
  animationClips: string[];
}

export interface AssetManifestJson {
  generatedAt: string;
  assets: AssetManifestEntry[];
}
