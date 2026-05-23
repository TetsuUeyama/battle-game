export * from "./StandardSkeleton";
export * from "./BoneMapping";

import mixamoPreset from "./presets/mixamo.json";
import unityHumanoidPreset from "./presets/unity-humanoid.json";
import type { BoneMappingPreset } from "./BoneMapping";

export const BUILTIN_PRESETS: readonly BoneMappingPreset[] = [
  mixamoPreset as BoneMappingPreset,
  unityHumanoidPreset as BoneMappingPreset,
];

export function getPreset(id: string): BoneMappingPreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}
