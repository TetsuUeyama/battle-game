"""Retarget a Mixamo FBX animation onto qm_default.glb's skeleton and export GLB.

Method (rest-difference-corrected world rotation bake):
  1. Import qm_default.glb (target: skeleton + mesh)
  2. Import Snake Hip Hop Dance.fbx (source: Mixamo skeleton + animation)
  3. Strip 'mixamorig:' prefix from source bones
  4. Per matched bone compute correction C = restS_world^-1 @ restT_world
     (restS/restT = source/target rest world ROTATION). This cancels the
     bind-pose roll difference between the Mixamo source rig and the qm rig.
  5. For every frame, set target bone world rotation = sourceWorldRot @ C,
     copy Hips world location (scaled), keyframe. (No constraints/bake op.)
  6. Export GLB.

Why C is needed: qm's arm/leg bones are rolled 180deg about their length vs
raw Mixamo. A plain "Copy Rotation WORLD" (targetWorld = sourceWorld) ignores
this, twisting hands/feet 180deg (palms/toes point backward). Hips/Spine rests
match so they were unaffected. See tmp/retarget_diag.json for the measurement.

Usage:
  blender --background --python scripts/blender/retarget_mixamo.py
"""
import bpy
import os
import sys
import math
from mathutils import Matrix, Vector

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


def strip_prefix(arm_obj, prefix="mixamorig:"):
    for b in arm_obj.data.bones:
        if b.name.startswith(prefix):
            b.name = b.name[len(prefix):]


def get_action_for(arm_obj):
    if arm_obj.animation_data and arm_obj.animation_data.action:
        return arm_obj.animation_data.action
    for a in bpy.data.actions:
        return a
    return None


def rot3(m):
    """Pure (scale-removed) 3x3 rotation from a 4x4 matrix."""
    r = m.to_3x3()
    for i in range(3):
        c = r.col[i]
        n = c.length or 1.0
        r[0][i], r[1][i], r[2][i] = c[0] / n, c[1] / n, c[2] / n
    return r


def ordered_bones(arm_obj, names):
    """Return matched bone names sorted parent-first (so children read posed parents)."""
    depth = {}
    for n in names:
        b = arm_obj.data.bones.get(n)
        d = 0
        while b and b.parent:
            d += 1
            b = b.parent
        depth[n] = d
    return sorted(names, key=lambda n: depth[n])


def main():
    clear_scene()

    print(f"[1] Import target GLB: {GLB_PATH}")
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    target = find_armature()
    if not target:
        raise RuntimeError("No armature in target GLB")
    target.name = "TargetArmature"
    if target.animation_data:
        target.animation_data.action = None

    print(f"[2] Import source FBX: {FBX_PATH}")
    before = set(o.name for o in bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=FBX_PATH,
        automatic_bone_orientation=True,
        ignore_leaf_bones=True,
    )
    after = set(o.name for o in bpy.data.objects)
    source = next((bpy.data.objects[n] for n in (after - before)
                   if bpy.data.objects[n].type == "ARMATURE"), None)
    if not source:
        raise RuntimeError("No armature in source FBX")
    source.name = "SourceArmature"

    print("[3] Strip mixamorig: prefix")
    strip_prefix(source)
    source.scale = (SCALE_FBX_TO_GLB, SCALE_FBX_TO_GLB, SCALE_FBX_TO_GLB)

    src_action = get_action_for(source)
    if not src_action:
        raise RuntimeError("Source FBX has no action")
    frame_min = math.floor(src_action.frame_range[0])
    frame_max = math.ceil(src_action.frame_range[1])
    print(f"    source action: {src_action.name}, frames {frame_min}-{frame_max}")

    # Matched bones (same name in both rigs)
    src_names = set(b.name for b in source.data.bones)
    matched = [b.name for b in target.data.bones if b.name in src_names]
    skipped = [b.name for b in target.data.bones if b.name not in src_names]
    print(f"[4] matched={len(matched)} skipped={skipped}")

    bpy.context.view_layer.update()
    tw = target.matrix_world
    sw = source.matrix_world
    twr = rot3(tw)
    swr = rot3(sw)
    twr_inv = twr.inverted()

    # Correction C_b = restS_world_rot^-1 @ restT_world_rot  (world rotation)
    C = {}
    for name in matched:
        tb = target.data.bones[name]
        sb = source.data.bones[name]
        restT = twr @ rot3(tb.matrix_local.to_4x4())
        restS = swr @ rot3(sb.matrix_local.to_4x4())
        C[name] = restS.inverted() @ restT

    order = ordered_bones(target, matched)
    hips = "Hips"

    # Ensure quaternion rotation mode and clear any pose
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    for pb in target.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix()

    scene = bpy.context.scene
    scene.frame_start = frame_min
    scene.frame_end = frame_max

    print(f"[5] Bake (corrected world rotation) frames {frame_min}-{frame_max}")
    for f in range(frame_min, frame_max + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()

        # read source world rotations at this frame
        src_rot = {}
        for name in matched:
            pbS = source.pose.bones[name]
            src_rot[name] = rot3(sw @ pbS.matrix)
        hips_loc_world = (sw @ source.pose.bones[hips].matrix).to_translation()

        for name in order:
            pbT = target.pose.bones[name]
            desired_world = src_rot[name] @ C[name]
            arm_rot = twr_inv @ desired_world  # into target armature space
            loc = pbT.matrix.to_translation()
            pbT.matrix = Matrix.Translation(loc) @ arm_rot.to_4x4()
            bpy.context.view_layer.update()

        # Hips world location (scaled source already 0.01)
        pbH = target.pose.bones[hips]
        loc_arm = tw.inverted() @ hips_loc_world
        pbH.matrix = Matrix.Translation(loc_arm) @ rot3(pbH.matrix).to_4x4()
        bpy.context.view_layer.update()

        # keyframe
        for name in matched:
            pbT = target.pose.bones[name]
            pbT.keyframe_insert("rotation_quaternion", frame=f)
        pbH.keyframe_insert("location", frame=f)

    bpy.ops.object.mode_set(mode="OBJECT")

    if target.animation_data and target.animation_data.action:
        target.animation_data.action.name = ACTION_NAME
        print(f"    baked action -> {ACTION_NAME}")
    else:
        print("    WARNING: no action after bake")

    print("[6] Delete source armature")
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.ops.object.delete(use_global=False)

    print(f"[7] Export GLB: {OUT_GLB}")
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
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
