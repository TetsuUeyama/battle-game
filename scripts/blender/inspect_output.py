"""Verify exported GLB has the expected action and bones."""
import bpy
import json
import os

OUT_GLB = r"C:\Users\user\developsecond\battle-game\public\motion-test\snake_hiphop.glb"
OUT_JSON = r"C:\Users\user\developsecond\battle-game\tmp\inspect_output.json"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.armatures, bpy.data.meshes, bpy.data.actions, bpy.data.objects):
        for it in list(col):
            try:
                col.remove(it)
            except Exception:
                pass


def collect_fcurves(action):
    fcs = []
    if hasattr(action, "fcurves") and len(getattr(action, "fcurves", [])) > 0:
        fcs.extend(list(action.fcurves))
        return fcs
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for cb in getattr(strip, "channelbags", []):
                fcs.extend(list(getattr(cb, "fcurves", [])))
    return fcs


def main():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=OUT_GLB)

    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    info = {
        "armature_name": arm.name if arm else None,
        "bone_count": len(arm.data.bones) if arm else 0,
        "bones": [b.name for b in arm.data.bones] if arm else [],
        "actions": [],
    }
    for a in bpy.data.actions:
        fcs = collect_fcurves(a)
        bones = set()
        for fc in fcs:
            if ".bones[" in fc.data_path:
                try:
                    bones.add(fc.data_path.split('"')[1])
                except Exception:
                    pass
        info["actions"].append({
            "name": a.name,
            "frame_range": [round(a.frame_range[0], 2), round(a.frame_range[1], 2)],
            "fcurve_count": len(fcs),
            "bones_animated_count": len(bones),
            "bones_animated": sorted(list(bones)),
        })
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
    print(f">>> Saved: {OUT_JSON}")


if __name__ == "__main__":
    main()
