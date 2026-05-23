"""Diagnostic: check source FBX vs target GLB armature world orientations
to confirm the 180° front/back flip hypothesis.

Reports for both armatures:
  - armature object world matrix (rotation only)
  - Hips bone world matrix at rest (rotation only)
  - which world direction the Hips bone's local +Y points to (= "up the spine")
  - which world direction Hips local +Z points to (= "facing direction" for Mixamo)
"""
import bpy
import json
import os
import mathutils

FBX_PATH = r"C:\Users\user\developsecond\game-assets\motion\Snake Hip Hop Dance.fbx"
GLB_PATH = r"C:\Users\user\developsecond\contactform\public\demo\qm_default.glb"
OUT = r"C:\Users\user\developsecond\battle-game\tmp\diag_rest_pose.json"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.armatures, bpy.data.meshes, bpy.data.actions, bpy.data.objects):
        for it in list(col):
            try: col.remove(it)
            except Exception: pass


def find_armature():
    return next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)


def transform_axis(world_matrix, local_axis):
    """Return the world direction of a local axis vector."""
    rot = world_matrix.to_3x3()
    return (rot @ mathutils.Vector(local_axis)).normalized()


def inspect(label, arm_obj, hips_name):
    info = {"label": label}
    info["armature_object_world_euler_deg"] = [round(math.degrees(v), 2)
                                               for v in arm_obj.matrix_world.to_euler()]
    info["armature_object_scale"] = [round(v, 4) for v in arm_obj.matrix_world.to_scale()]
    # Bones
    arm = arm_obj.data
    hips = arm.bones.get(hips_name)
    if not hips:
        info["error"] = f"bone {hips_name} not in armature"
        return info
    # rest pose: bone.matrix_local is in armature space, multiply by armature world matrix
    hips_world_rest = arm_obj.matrix_world @ hips.matrix_local
    info["hips_world_matrix_rest"] = [
        [round(v, 4) for v in row] for row in hips_world_rest
    ]
    info["hips_world_euler_deg"] = [round(math.degrees(v), 2)
                                    for v in hips_world_rest.to_euler()]
    # Where does Hips local +Y point in world? (this is "up the spine" for Blender bones)
    info["hips_local_Y_in_world"] = [round(v, 4) for v in transform_axis(hips_world_rest, (0, 1, 0))]
    info["hips_local_X_in_world"] = [round(v, 4) for v in transform_axis(hips_world_rest, (1, 0, 0))]
    info["hips_local_Z_in_world"] = [round(v, 4) for v in transform_axis(hips_world_rest, (0, 0, 1))]
    return info


import math


def main():
    out = {}

    clear_scene()
    bpy.ops.import_scene.fbx(filepath=FBX_PATH)
    arm = find_armature()
    # Strip mixamorig: for fair comparison
    for b in arm.data.bones:
        if b.name.startswith("mixamorig:"):
            b.name = b.name[len("mixamorig:"):]
    out["fbx_source"] = inspect("fbx_source (Mixamo)", arm, "Hips")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    arm = find_armature()
    out["glb_target"] = inspect("glb_target (qm_default)", arm, "Hips")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f">>> Saved: {OUT}")


if __name__ == "__main__":
    main()
