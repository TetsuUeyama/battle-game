"""Convert Mixamo FBX -> GLB without retargeting.

Used to isolate whether the 180° flip is caused by:
  (a) the retarget logic, or
  (b) the Blender FBX-import / glTF-export pipeline itself.

If the direct-converted GLB plays the dance correctly in Babylon, then (a).
If it also flips, then (b).
"""
import bpy
import os

FBX_PATH = r"C:\Users\user\developsecond\game-assets\motion\Snake Hip Hop Dance.fbx"
OUT_GLB = r"C:\Users\user\developsecond\battle-game\public\motion-test\snake_direct.glb"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.armatures, bpy.data.meshes, bpy.data.actions, bpy.data.objects):
        for it in list(col):
            try: col.remove(it)
            except Exception: pass


def main():
    clear_scene()
    bpy.ops.import_scene.fbx(
        filepath=FBX_PATH,
        automatic_bone_orientation=True,
        ignore_leaf_bones=True,
    )

    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if not arm:
        raise RuntimeError("No armature in FBX")

    # Strip prefix (cosmetic, doesn't change result)
    for b in arm.data.bones:
        if b.name.startswith("mixamorig:"):
            b.name = b.name[len("mixamorig:"):]

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_yup=True,
    )
    print(">>> Direct conversion done:", OUT_GLB)


if __name__ == "__main__":
    main()
