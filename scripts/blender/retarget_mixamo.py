"""Retarget a Mixamo FBX animation onto qm_default.glb's skeleton and export GLB.

Method:
  1. Import qm_default.glb (target: skeleton + mesh)
  2. Import Snake Hip Hop Dance.fbx (source: Mixamo skeleton + animation)
  3. Strip 'mixamorig:' prefix from source bones
  4. Add Copy Rotation (world) constraint per target bone -> same-named source bone
  5. Copy Location constraint on Hips (with /100 scale via parent scale)
  6. Bake target armature animation across source frame range
  7. Delete source armature, rename action, export GLB

Usage:
  blender --background --python scripts/blender/retarget_mixamo.py
"""
import bpy
import os
import sys
import math
import mathutils

FBX_PATH = r"C:\Users\user\developsecond\game-assets\motion\Snake Hip Hop Dance.fbx"
GLB_PATH = r"C:\Users\user\developsecond\contactform\public\demo\qm_default.glb"
OUT_GLB = r"C:\Users\user\developsecond\battle-game\public\motion-test\snake_hiphop.glb"
ACTION_NAME = "SnakeHipHop"
SCALE_FBX_TO_GLB = 0.01  # cm -> m (Mixamo FBX is in cm)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.armatures, bpy.data.meshes, bpy.data.actions, bpy.data.objects):
        for it in list(col):
            try:
                col.remove(it)
            except Exception:
                pass


def find_armature(exclude=None):
    for ob in bpy.data.objects:
        if ob.type == "ARMATURE" and (exclude is None or ob is not exclude):
            return ob
    return None


def find_armatures_all():
    return [o for o in bpy.data.objects if o.type == "ARMATURE"]


def strip_prefix(arm_obj, prefix="mixamorig:"):
    for b in arm_obj.data.bones:
        if b.name.startswith(prefix):
            b.name = b.name[len(prefix):]


def get_action_for(arm_obj):
    """Get the (first) action driving this armature, regardless of Blender version."""
    if arm_obj.animation_data and arm_obj.animation_data.action:
        return arm_obj.animation_data.action
    # Fallback: pick any
    for a in bpy.data.actions:
        return a
    return None


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

    # 1. Import target GLB
    print(f"[1] Import target GLB: {GLB_PATH}")
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    target = find_armature()
    if not target:
        raise RuntimeError("No armature in target GLB")
    target.name = "TargetArmature"
    target_bones = set(b.name for b in target.data.bones)
    print(f"    target bones: {len(target_bones)}")

    # Remove existing actions from target so we start clean for the new bake
    if target.animation_data:
        target.animation_data.action = None

    # 2. Import source FBX
    before = set(o.name for o in bpy.data.objects)
    print(f"[2] Import source FBX: {FBX_PATH}")
    bpy.ops.import_scene.fbx(
        filepath=FBX_PATH,
        automatic_bone_orientation=True,  # Mixamo の元 local 軸を復元（肩/股の捩じれ防止）
        ignore_leaf_bones=True,  # Mixamo の HeadTop_End 等の leaf を除外
    )
    after = set(o.name for o in bpy.data.objects)
    new_objs = [bpy.data.objects[n] for n in (after - before)]
    source = next((o for o in new_objs if o.type == "ARMATURE"), None)
    if not source:
        raise RuntimeError("No armature in source FBX")
    source.name = "SourceArmature"

    # 3. Strip mixamorig: prefix on source bones
    print("[3] Strip mixamorig: prefix")
    strip_prefix(source)

    # Confirm action bound to source
    src_action = get_action_for(source)
    if not src_action:
        raise RuntimeError("Source FBX has no action")
    fcs = collect_fcurves(src_action)
    frame_min = math.floor(src_action.frame_range[0])
    frame_max = math.ceil(src_action.frame_range[1])
    print(f"    source action: {src_action.name}, frames {frame_min}-{frame_max}, fcurves={len(fcs)}")

    # 4. Add Copy Constraints on target bones (pose mode)
    print("[4] Add Copy constraints")
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    matched = 0
    skipped = []
    for pb in target.pose.bones:
        if pb.name not in (b.name for b in source.data.bones):
            skipped.append(pb.name)
            continue
        # Copy Rotation in world space
        cr = pb.constraints.new("COPY_ROTATION")
        cr.target = source
        cr.subtarget = pb.name
        cr.target_space = "WORLD"
        cr.owner_space = "WORLD"
        matched += 1
        # Copy Location for Hips only (with scale)
        if pb.name == "Hips":
            cl = pb.constraints.new("COPY_LOCATION")
            cl.target = source
            cl.subtarget = pb.name
            cl.target_space = "WORLD"
            cl.owner_space = "WORLD"
            # Approximate cm -> m: ARP-style use_offset trick is fragile; instead
            # we will scale source armature object to compensate
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"    matched={matched}, skipped (no match)={len(skipped)}: {skipped[:8]}")

    # 4b. Scale source armature so that world positions match target scale.
    #     FBX is in cm, target GLB in m. Scale 0.01.
    source.scale = (SCALE_FBX_TO_GLB, SCALE_FBX_TO_GLB, SCALE_FBX_TO_GLB)
    print(f"    source armature scaled to {SCALE_FBX_TO_GLB}")

    # 5. Bake animation on target armature
    print(f"[5] Bake frames {frame_min}-{frame_max}")
    bpy.context.scene.frame_start = frame_min
    bpy.context.scene.frame_end = frame_max
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    # Select all pose bones for bake
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(
        frame_start=frame_min,
        frame_end=frame_max,
        step=1,
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        use_current_action=False,
        bake_types={"POSE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    # Rename baked action
    if target.animation_data and target.animation_data.action:
        target.animation_data.action.name = ACTION_NAME
        print(f"    baked action -> {ACTION_NAME}")
    else:
        print("    WARNING: no action bound after bake")

    # 6. Delete source armature
    print("[6] Delete source armature")
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.ops.object.delete(use_global=False)

    # 7. Export GLB
    print(f"[7] Export GLB: {OUT_GLB}")
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    # Select target armature + its children mesh
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    for child in target.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_anim_single_armature=True,
        export_skins=True,
        export_yup=True,
    )
    print(">>> DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
