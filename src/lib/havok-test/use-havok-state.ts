/**
 * havok-test ページ用のステート管理カスタムフック。
 * 30以上の useState を1箇所にまとめる。
 */
import { useState } from 'react';
import type { StanceType, SwingType, GameAssetWeaponInfo } from '@/lib/havok-character/types';
import { SELECTABLE_BONES } from './constants';

export interface HavokTestState {
  status: string;
  selectedBone: string;
  rotX: number; rotY: number; rotZ: number;
  posX: number; posY: number; posZ: number;
  heightScale: number;
  hipsHeight: number;
  weaponEquipped: boolean;
  weaponWeight: number;
  weaponLength: number;
  gripType: 'one-handed' | 'two-handed';
  stance: StanceType;
  availableWeapons: GameAssetWeaponInfo[];
  selectedAssetWeapon: string;
  useAssetWeapon: boolean;
  offHandReleased: boolean;
  swingActive: boolean;
  tipSpeed: number;
  swingPower: number;
  swingTargetX: number; swingTargetY: number; swingTargetZ: number;
  swingTypeSelect: SwingType;
  attackPower: number;
  aiEnabled: boolean;
  aiState: string;
  motionTestType: SwingType;
  motionTestPower: number;
  motionTestPlaying: boolean;
  jointAngles: Record<string, number>;
}

export interface HavokTestActions {
  setStatus: (v: string) => void;
  setSelectedBone: (v: string) => void;
  setRotX: (v: number) => void; setRotY: (v: number) => void; setRotZ: (v: number) => void;
  setPosX: (v: number) => void; setPosY: (v: number) => void; setPosZ: (v: number) => void;
  setHeightScale: (v: number) => void;
  setHipsHeight: (v: number) => void;
  setWeaponEquipped: (v: boolean) => void;
  setWeaponWeight: (v: number) => void;
  setWeaponLength: (v: number) => void;
  setGripType: (v: 'one-handed' | 'two-handed') => void;
  setStance: (v: StanceType) => void;
  setAvailableWeapons: (v: GameAssetWeaponInfo[]) => void;
  setSelectedAssetWeapon: (v: string) => void;
  setUseAssetWeapon: (v: boolean) => void;
  setOffHandReleased: (v: boolean) => void;
  setSwingActive: (v: boolean) => void;
  setTipSpeed: (v: number) => void;
  setSwingPower: (v: number) => void;
  setSwingTargetX: (v: number) => void; setSwingTargetY: (v: number) => void; setSwingTargetZ: (v: number) => void;
  setSwingTypeSelect: (v: SwingType) => void;
  setAttackPower: (v: number) => void;
  setAiEnabled: (v: boolean) => void;
  setAiState: (v: string) => void;
  setMotionTestType: (v: SwingType) => void;
  setMotionTestPower: (v: number) => void;
  setMotionTestPlaying: (v: boolean) => void;
  setJointAngles: (v: Record<string, number>) => void;
  resetAll: () => void;
}

export function useHavokTestState(): [HavokTestState, HavokTestActions] {
  const [status, setStatus] = useState('Initializing...');
  const [selectedBone, setSelectedBone] = useState(SELECTABLE_BONES[0]);
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [rotZ, setRotZ] = useState(0);
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);
  const [heightScale, setHeightScale] = useState(1.0);
  const [hipsHeight, setHipsHeight] = useState(0);
  const [weaponEquipped, setWeaponEquipped] = useState(false);
  const [weaponWeight, setWeaponWeight] = useState(3.0);
  const [weaponLength, setWeaponLength] = useState(1.0);
  const [gripType, setGripType] = useState<'one-handed' | 'two-handed'>('two-handed');
  const [stance, setStance] = useState<StanceType>('front');
  const [availableWeapons, setAvailableWeapons] = useState<GameAssetWeaponInfo[]>([]);
  const [selectedAssetWeapon, setSelectedAssetWeapon] = useState('');
  const [useAssetWeapon, setUseAssetWeapon] = useState(false);
  const [offHandReleased, setOffHandReleased] = useState(false);
  const [swingActive, setSwingActive] = useState(false);
  const [tipSpeed, setTipSpeed] = useState(0);
  const [swingPower, setSwingPower] = useState(0);
  const [swingTargetX, setSwingTargetX] = useState(0);
  const [swingTargetY, setSwingTargetY] = useState(0);
  const [swingTargetZ, setSwingTargetZ] = useState(0);
  const [swingTypeSelect, setSwingTypeSelect] = useState<SwingType>('vertical');
  const [attackPower, setAttackPower] = useState(100);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiState, setAiState] = useState('idle');
  const [motionTestType, setMotionTestType] = useState<SwingType>('vertical');
  const [motionTestPower, setMotionTestPower] = useState(80);
  const [motionTestPlaying, setMotionTestPlaying] = useState(false);
  const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
  const state: HavokTestState = {
    status, selectedBone,
    rotX, rotY, rotZ, posX, posY, posZ,
    heightScale, hipsHeight,
    weaponEquipped, weaponWeight, weaponLength, gripType, stance,
    availableWeapons, selectedAssetWeapon, useAssetWeapon,
    offHandReleased, swingActive, tipSpeed, swingPower,
    swingTargetX, swingTargetY, swingTargetZ,
    swingTypeSelect, attackPower,
    aiEnabled, aiState,
    motionTestType, motionTestPower, motionTestPlaying,
    jointAngles,
  };

  const actions: HavokTestActions = {
    setStatus, setSelectedBone,
    setRotX, setRotY, setRotZ, setPosX, setPosY, setPosZ,
    setHeightScale, setHipsHeight,
    setWeaponEquipped, setWeaponWeight, setWeaponLength, setGripType, setStance,
    setAvailableWeapons, setSelectedAssetWeapon, setUseAssetWeapon,
    setOffHandReleased, setSwingActive, setTipSpeed, setSwingPower,
    setSwingTargetX, setSwingTargetY, setSwingTargetZ,
    setSwingTypeSelect, setAttackPower,
    setAiEnabled, setAiState,
    setMotionTestType, setMotionTestPower, setMotionTestPlaying,
    setJointAngles,
    resetAll: () => {
      setRotX(0); setRotY(0); setRotZ(0);
      setPosX(0); setPosY(0); setPosZ(0);
      setHeightScale(1.0); setHipsHeight(0);
      setWeaponEquipped(false); setStance('front');
      setOffHandReleased(false); setSwingActive(false);
      setSwingTargetX(0); setSwingTargetY(0); setSwingTargetZ(0);
      setMotionTestPlaying(false);
    },
  };

  return [state, actions];
}
