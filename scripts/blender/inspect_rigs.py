"""Inspect Mixamo FBX and QM GLB bone hierarchies.

Usage:
  blender --background --python scripts/blender/inspect_rigs.py

Outputs:
  tmp/inspect_rigs.json  — bone names, parents, head/tail positions, animations
"""
import bpy
import json
import os
import sys
import math

PROJECT_ROOT = r"C:\Users\user\developsecond\battle-game"
FBX_PATH = r"C:\Users\user\developsecond\game-assets\motion\Snake Hip Hop Dance.fbx"
GLB_PATH = r"C:\Users\user\developsecond\contactform\public\demo\qm_default.glb"
OUT_PATH = os.path.join(PROJECT_ROOT, "tmp", "inspect_rigs.json")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for arm in list(bpy.data.armatures):
        bpy.data.armatures.remove(arm)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)


def find_armature():
    for ob in bpy.data.objects:
        if ob.type == "ARMATURE":
            return ob
    return None


def dump_armature(arm_obj, label):
    arm = arm_obj.data
    bones = []
    for b in arm.bones:
        bones.append(
            {
                "name": b.name,
                "parent": b.parent.name if b.parent else None,
                "head": [round(v, 4) for v in b.head_local],
                "tail": [round(v, 4) for v in b.tail_local],
                "length": round(b.length, 4),
            }
        )
    # Animations — Blender 5.0 uses action.layers[].strips[].channelbags[].fcurves
    def collect_fcurves(action):
        fcs = []
        # Legacy
        if hasattr(action, "fcurves") and len(getattr(action, "fcurves", [])) > 0:
            fcs.extend(list(action.fcurves))
            return fcs
        # 5.0 layered
        for layer in getattr(action, "layers", []):
            for strip in getattr(layer, "strips", []):
                for cb in getattr(strip, "channelbags", []):
                    fcs.extend(list(getattr(cb, "fcurves", [])))
        return fcs

    actions = []
    for action in bpy.data.actions:
        fcs = collect_fcurves(action)
        bone_targets = set()
        for fc in fcs:
            dp = fc.data_path
            if ".bones[" in dp:
                try:
                    bone_name = dp.split('"')[1]
                    bone_targets.add(bone_name)
                except Exception:
                    pass
        try:
            fr = [round(action.frame_range[0], 2), round(action.frame_range[1], 2)]
        except Exception:
            fr = None
        actions.append(
            {
                "name": action.name,
                "frame_range": fr,
                "fcurve_count": len(fcs),
                "bones_animated_count": len(bone_targets),
                "bones_animated_sample": sorted(list(bone_targets))[:10],
            }
        )
    return {
        "label": label,
        "armature_name": arm_obj.name,
        "bone_count": len(bones),
        "bones": bones,
        "actions": actions,
    }


def inspect_fbx():
    clear_scene()
    print(f"\n=== Importing FBX: {FBX_PATH} ===")
    bpy.ops.import_scene.fbx(filepath=FBX_PATH)
    arm = find_armature()
    if not arm:
        return {"error": "no armature in FBX"}
    return dump_armature(arm, "mixamo_fbx")


def inspect_glb():
    clear_scene()
    print(f"\n=== Importing GLB: {GLB_PATH} ===")
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    arm = find_armature()
    if not arm:
        return {"error": "no armature in GLB"}
    return dump_armature(arm, "qm_glb")


def main():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    result = {"fbx": inspect_fbx(), "glb": inspect_glb()}
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\n>>> Saved: {OUT_PATH}")


if __name__ == "__main__":
    main()
