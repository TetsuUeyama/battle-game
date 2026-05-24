"""Mixamo -> Babylon.js motion converter (Blender side).

Config-driven: retargets one or more Mixamo FBX clips onto a single target rig
(GLB) and exports ONE GLB containing the target mesh + all clips as separate
glTF animations.

Core retarget = rest-difference-corrected world rotation bake:
  For each matched bone, correction  C = restS_world^-1 @ restT_world  cancels
  the bind-pose roll difference between the Mixamo source rig and the target
  rig. Per frame we set  targetWorldRot = sourceWorldRot @ C . Hips/Spine rests
  usually match (C ~= identity); arm/leg rests differ (often a 180deg roll on
  Mixamo->qm), and without C the hands/feet twist front-to-back. See
  scripts/MOTION_CONVERT.md.

Run (normally via scripts/convert-motions.mjs):
  blender --background --python scripts/blender/convert_motions.py -- <config.json>

Config JSON shape:
  {
    "targetRig": "<abs path to target .glb (mesh+skeleton)>",
    "scaleFbxToGlb": 0.01,            # cm -> m (Mixamo FBX is cm)
    "glbOut": "<abs path to output .glb>",
    "clips": [
      { "name": "Idle", "fbx": "<abs path>", "loop": true },
      ...
    ]
  }
"""
import bpy
import os
import sys
import json
import math
from mathutils import Matrix


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
    depth = {}
    for n in names:
        b = arm_obj.data.bones.get(n)
        d = 0
        while b and b.parent:
            d += 1
            b = b.parent
        depth[n] = d
    return sorted(names, key=lambda n: depth[n])


def import_target(path):
    bpy.ops.import_scene.gltf(filepath=path)
    target = find_armature()
    if not target:
        raise RuntimeError("No armature in target GLB: " + path)
    target.name = "TargetArmature"
    # start clean: drop any actions that shipped with the target rig
    if target.animation_data:
        target.animation_data.action = None
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    return target


def import_source(fbx_path, scale):
    before = set(o.name for o in bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=fbx_path,
        automatic_bone_orientation=True,
        ignore_leaf_bones=True,
    )
    after = set(o.name for o in bpy.data.objects)
    source = next((bpy.data.objects[n] for n in (after - before)
                   if bpy.data.objects[n].type == "ARMATURE"), None)
    if not source:
        raise RuntimeError("No armature in source FBX: " + fbx_path)
    source.name = "SourceArmature"
    strip_prefix(source)
    source.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    return source


def compute_correction(target, source, matched):
    twr = rot3(target.matrix_world)
    swr = rot3(source.matrix_world)
    C = {}
    for name in matched:
        restT = twr @ rot3(target.data.bones[name].matrix_local.to_4x4())
        restS = swr @ rot3(source.data.bones[name].matrix_local.to_4x4())
        C[name] = restS.inverted() @ restT
    return C


def bake_clip(target, source, matched, order, name, loop):
    """Bake one corrected clip onto the target as a new action named `name`."""
    src_action = get_action_for(source)
    if not src_action:
        raise RuntimeError("Source FBX has no action for clip " + name)
    f0 = math.floor(src_action.frame_range[0])
    f1 = math.ceil(src_action.frame_range[1])

    C = compute_correction(target, source, matched)

    tw = target.matrix_world
    sw = source.matrix_world
    twr_inv = rot3(tw).inverted()

    # fresh action on the target
    target.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    target.animation_data.action = act

    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    for pb in target.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix()

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = f0, f1

    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()

        src_rot = {n: rot3(sw @ source.pose.bones[n].matrix) for n in matched}
        hips_loc_world = (sw @ source.pose.bones["Hips"].matrix).to_translation()

        for n in order:
            pbT = target.pose.bones[n]
            desired_world = src_rot[n] @ C[n]
            arm_rot = twr_inv @ desired_world
            loc = pbT.matrix.to_translation()
            pbT.matrix = Matrix.Translation(loc) @ arm_rot.to_4x4()
            bpy.context.view_layer.update()

        pbH = target.pose.bones["Hips"]
        loc_arm = tw.inverted() @ hips_loc_world
        pbH.matrix = Matrix.Translation(loc_arm) @ rot3(pbH.matrix).to_4x4()
        bpy.context.view_layer.update()

        for n in matched:
            target.pose.bones[n].keyframe_insert("rotation_quaternion", frame=f)
        pbH.keyframe_insert("location", frame=f)

    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"    baked '{name}' frames {f0}-{f1} loop={loop}")
    return act


def main():
    argv = sys.argv
    cfg_path = argv[argv.index("--") + 1] if "--" in argv else argv[-1]
    with open(cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    target_rig = cfg["targetRig"]
    scale = cfg.get("scaleFbxToGlb", 0.01)
    glb_out = cfg["glbOut"]
    clips = cfg["clips"]

    clear_scene()
    print(f"[target] {target_rig}")
    target = import_target(target_rig)
    target_bone_names = set(b.name for b in target.data.bones)

    for clip in clips:
        name = clip["name"]
        fbx = clip["fbx"]
        print(f"[clip] {name}  <-  {fbx}")
        source = import_source(fbx, scale)
        matched = [b.name for b in target.data.bones
                   if b.name in set(s.name for s in source.data.bones)]
        order = ordered_bones(target, matched)
        bake_clip(target, source, matched, order, name, bool(clip.get("loop", True)))
        # remove source armature + its action so the next clip starts clean
        src_action = get_action_for(source)
        bpy.ops.object.select_all(action="DESELECT")
        source.select_set(True)
        bpy.ops.object.delete(use_global=False)
        if src_action and src_action.name in bpy.data.actions:
            try:
                bpy.data.actions.remove(src_action)
            except Exception:
                pass

    # export: every retained action -> its own glTF animation
    os.makedirs(os.path.dirname(glb_out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    for child in target.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = target
    print(f"[export] {glb_out}  ({len(bpy.data.actions)} clips)")
    bpy.ops.export_scene.gltf(
        filepath=glb_out,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_anim_single_armature=True,
        export_skins=True,
        export_yup=True,
    )
    print(">>> DONE", json.dumps({"glb": glb_out, "clips": [c["name"] for c in clips]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
