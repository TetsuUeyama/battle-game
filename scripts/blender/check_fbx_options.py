"""List available FBX import options in this Blender version."""
import bpy

op = bpy.ops.import_scene.fbx
rna = op.get_rna_type()
print("=== FBX import options ===")
for prop in rna.properties:
    if prop.identifier in ("rna_type",):
        continue
    print(f"  {prop.identifier}: default={getattr(prop, 'default', '?')}")
