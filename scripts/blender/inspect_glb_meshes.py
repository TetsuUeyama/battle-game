"""Inspect mesh + armature + bbox of snake_direct.glb and snake_fbx2gltf.glb."""
import bpy
import os
import json
import mathutils

GLBS = [
    r"C:\Users\user\developsecond\battle-game\public\motion-test\snake_direct.glb",
    r"C:\Users\user\developsecond\battle-game\public\motion-test\snake_fbx2gltf.glb",
    r"C:\Users\user\developsecond\battle-game\public\motion-test\snake_hiphop.glb",
]
OUT = r"C:\Users\user\developsecond\battle-game\tmp\inspect_glb_meshes.json"


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in (bpy.data.armatures, bpy.data.meshes, bpy.data.actions, bpy.data.objects):
        for it in list(col):
            try: col.remove(it)
            except Exception: pass


def inspect(path):
    clear()
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:
        return {"file": os.path.basename(path), "error": str(e)}
    info = {"file": os.path.basename(path), "objects": []}
    overall_min = [float("inf")] * 3
    overall_max = [float("-inf")] * 3
    arm_count = 0
    mesh_count = 0
    for ob in bpy.data.objects:
        ent = {
            "name": ob.name,
            "type": ob.type,
            "location": [round(v, 3) for v in ob.location],
            "scale": [round(v, 3) for v in ob.scale],
        }
        if ob.type == "ARMATURE":
            arm_count += 1
            ent["bone_count"] = len(ob.data.bones)
        if ob.type == "MESH":
            mesh_count += 1
            mesh = ob.data
            ent["vertex_count"] = len(mesh.vertices)
            # World bbox
            if len(ob.bound_box) == 8:
                worlds = [ob.matrix_world @ mathutils.Vector(c) for c in ob.bound_box]
                xs = [v.x for v in worlds]
                ys = [v.y for v in worlds]
                zs = [v.z for v in worlds]
                bb_min = [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)]
                bb_max = [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]
                ent["world_bbox_min"] = bb_min
                ent["world_bbox_max"] = bb_max
                for i in range(3):
                    overall_min[i] = min(overall_min[i], bb_min[i])
                    overall_max[i] = max(overall_max[i], bb_max[i])
        info["objects"].append(ent)
    info["armature_count"] = arm_count
    info["mesh_count"] = mesh_count
    info["overall_world_bbox_min"] = [round(v, 3) for v in overall_min] if overall_min[0] != float("inf") else None
    info["overall_world_bbox_max"] = [round(v, 3) for v in overall_max] if overall_max[0] != float("-inf") else None
    info["action_count"] = len(bpy.data.actions)
    info["actions"] = [a.name for a in bpy.data.actions][:10]
    return info


def main():
    out = [inspect(p) for p in GLBS]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f">>> Saved: {OUT}")


if __name__ == "__main__":
    main()
