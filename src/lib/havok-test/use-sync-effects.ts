/**
 * ステート → レンダーループ / Babylon.js への同期 useEffect 群。
 * ページ側の useEffect をまとめて1つのカスタムフックに。
 */
'use client';
import { useEffect } from 'react';
import { Vector3, Color3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import {
  scaleBones, rebuildBodyMeshes,
} from '@/lib/havok-character/character';
import {
  equipWeapon, unequipWeapon, startSwing, endSwing, releaseOffHand,
  fetchGameAssetWeapons, equipGameAssetWeapon,
} from '@/lib/havok-character/weapon';
import type { HavokCharacter, WeaponPhysics } from '@/lib/havok-character/types';
import type { HavokTestState, HavokTestActions } from './use-havok-state';
import type { SceneControls } from './scene-loop';
import type { BoneRefs } from './bone-controls';
import { applyTransform } from './bone-controls';

interface SyncEffectsParams {
  s: HavokTestState;
  a: HavokTestActions;
  boneRefs: BoneRefs;
  sceneRef: React.RefObject<Scene | null>;
  controlsRef: React.RefObject<SceneControls | null>;
  visBasePositionsRef: React.MutableRefObject<Map<string, import('@babylonjs/core').Vector3>>;
  bodyColorRef: React.RefObject<Color3>;
  storeBaseValues: (boneName: string) => void;
}

export function useSyncEffects({
  s, a, boneRefs, sceneRef, controlsRef, visBasePositionsRef, bodyColorRef, storeBaseValues,
}: SyncEffectsParams): void {

  // Bone transform
  useEffect(() => {
    applyTransform(s.selectedBone, s.rotX, s.rotY, s.rotZ, s.posX, s.posY, s.posZ, boneRefs);
  }, [s.selectedBone, s.rotX, s.rotY, s.rotZ, s.posX, s.posY, s.posZ]);

  // Hips height
  useEffect(() => { controlsRef.current?.setHipsOffset(s.hipsHeight); }, [s.hipsHeight]);

  // AI toggle
  useEffect(() => { controlsRef.current?.toggleAI(s.aiEnabled); }, [s.aiEnabled]);

  // Swing target
  useEffect(() => {
    controlsRef.current?.setSwingTarget(s.swingTargetX, s.swingTargetY, s.swingTargetZ);
  }, [s.swingTargetX, s.swingTargetY, s.swingTargetZ]);

  // Swing active
  useEffect(() => {
    const char = boneRefs.characterRef.current;
    if (char) { if (s.swingActive) startSwing(char); else endSwing(char); }
  }, [s.swingActive]);

  // Off-hand release
  useEffect(() => {
    const char = boneRefs.characterRef.current;
    if (char) releaseOffHand(char, s.offHandReleased);
  }, [s.offHandReleased]);

  // Weapon equip/unequip
  useEffect(() => {
    const char = boneRefs.characterRef.current;
    const scene = sceneRef.current;
    if (!char || !scene) return;
    if (s.weaponEquipped) {
      if (s.useAssetWeapon && s.selectedAssetWeapon) {
        const info = s.availableWeapons.find(w => `${w.category}/${w.pieceKey}` === s.selectedAssetWeapon);
        if (info) equipGameAssetWeapon(scene, char, info, s.stance).catch(console.error);
      } else {
        const weapon: WeaponPhysics = {
          weight: s.weaponWeight, length: s.weaponLength, gripType: s.gripType,
          attackPoint: new Vector3(0, -s.weaponLength, 0),
          gripOffset: Vector3.Zero(), offHandOffset: new Vector3(0, 0.2, 0),
          localTipDir: Vector3.Down(), localGripAxis: Vector3.Up(),
        };
        equipWeapon(scene, char, weapon, s.stance);
      }
    } else {
      unequipWeapon(char);
      char.ikChains.leftArm.weight = 0;
      char.ikChains.rightArm.weight = 0;
    }
  }, [s.weaponEquipped, s.weaponWeight, s.weaponLength, s.gripType, s.stance, s.useAssetWeapon, s.selectedAssetWeapon, s.availableWeapons]);

  // Height scaling
  useEffect(() => {
    const char = boneRefs.characterRef.current;
    const vis = boneRefs.boneVisRef.current;
    const scene = sceneRef.current;
    if (!char || !scene) return;
    scaleBones(char, s.heightScale);
    rebuildBodyMeshes(scene, char, bodyColorRef.current!, 'test');
    if (vis) {
      const visBase = visBasePositionsRef.current;
      for (const [name, bone] of vis) {
        const base = visBase.get(name);
        if (base) bone.position.set(base.x * s.heightScale, base.y * s.heightScale, base.z * s.heightScale);
      }
    }
    storeBaseValues(s.selectedBone);
  }, [s.heightScale, storeBaseValues, s.selectedBone]);

  // Fetch weapons
  useEffect(() => {
    fetchGameAssetWeapons().then(weapons => {
      a.setAvailableWeapons(weapons);
      if (weapons.length > 0) a.setSelectedAssetWeapon(`${weapons[0].category}/${weapons[0].pieceKey}`);
    });
  }, []);
}
