'use client';
import { useState, useCallback } from 'react';
import { Vector3 as V3, Quaternion } from '@babylonjs/core';
import type { HavokCharacter, SwingType } from '@/lib/havok-character/types';
import type { HavokTestState, HavokTestActions } from '../use-havok-state';
import { JOINT_CONFIG } from '@/lib/havok-character/character/body';
import type { AxisLimits3 } from '@/lib/havok-character/character/body/joints';
import { SWING_PRESETS } from '@/lib/havok-character/character/body';
import { playMotionTest, getBackflipStateRef } from '../motion-test';
import { startBackflip } from '@/lib/havok-character/actions/backflip';
import { sectionStyle, btnStyle, headingStyle, selectStyle, labelStyle, sliderStyle } from './styles';

interface Props {
  state: HavokTestState;
  actions: HavokTestActions;
  characterRef: React.RefObject<HavokCharacter | null>;
  onJump: () => void;
}

export function DebugPanel({ state: s, actions: a, characterRef, onJump }: Props) {
  return (
    <div>
      {/* Combat AI */}
      <div style={{ marginBottom: 12 }}>
        <div style={headingStyle('#0cf')}>Combat AI</div>
        <label style={{ fontSize: 14, display: 'block' }}>
          <input type="checkbox" checked={s.aiEnabled} onChange={e => a.setAiEnabled(e.target.checked)} />
          {' '}AI 自動追尾
        </label>
        {s.aiEnabled && (
          <div style={{ marginTop: 6, padding: 8, background: 'rgba(0,200,255,0.1)', borderRadius: 6, fontSize: 14 }}>
            State: <b style={{ color: s.aiState === 'attack' ? '#f44' : s.aiState === 'pursue' ? '#ff0' : '#0f0' }}>
              {s.aiState.toUpperCase()}
            </b>
          </div>
        )}
      </div>

      {/* Jump */}
      <button onClick={onJump} style={{ ...btnStyle('#060'), marginBottom: 12 }}>Jump</button>

      {/* Motion Test */}
      <div style={sectionStyle('#f80')}>
        <div style={headingStyle('#f80')}>Motion Test</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <select value={s.motionTestType} onChange={e => a.setMotionTestType(e.target.value as SwingType)}
            style={{ flex: 1, ...selectStyle }}>
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
            <option value="thrust">Thrust</option>
          </select>
        </div>
        <div style={labelStyle}><span>Power</span><span>{s.motionTestPower}%</span></div>
        <input type="range" min={10} max={100} step={5} value={s.motionTestPower}
          onChange={e => a.setMotionTestPower(Number(e.target.value))} style={sliderStyle} />
        <button
          onClick={() => {
            const c = characterRef.current;
            if (c?.weapon && playMotionTest(c, s.motionTestType, s.motionTestPower)) {
              a.setMotionTestPlaying(true);
            }
          }}
          style={{ ...btnStyle(s.motionTestPlaying ? '#c60' : '#f80'), marginTop: 8 }}>
          {s.motionTestPlaying ? 'Playing...' : `Play ${s.motionTestType}`}
        </button>
        <PresetTable type={s.motionTestType} />

        {/* Backflip */}
        <button
          onClick={() => {
            const c = characterRef.current;
            if (!c) return;
            startBackflip(c, getBackflipStateRef());
            a.setMotionTestPlaying(true);
          }}
          style={{ ...btnStyle('#a0f'), marginTop: 8 }}>
          Backflip
        </button>
      </div>

      {/* Joint ROM Test */}
      <JointROMTest characterRef={characterRef} selectedBone={s.selectedBone} onBoneSelect={(b) => a.setSelectedBone(b)} />

      {/* Joint Angles */}
      <div style={sectionStyle('#0af')}>
        <div style={headingStyle('#0af')}>Joint Angles</div>
        <JointTable angles={s.jointAngles} />
      </div>

      {/* Reset */}
      <button onClick={() => a.resetAll()} style={{ ...btnStyle('#555'), marginTop: 8 }}>Reset All</button>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function PresetTable({ type }: { type: SwingType }) {
  const p = SWING_PRESETS[type];
  if (!p) return null;
  return (
    <div style={{ marginTop: 8, padding: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Presets</div>
      <table style={{ width: '100%', fontSize: 11, color: '#bbb' }}>
        <thead><tr style={{ color: '#888' }}><th></th><th>Lean</th><th>Twist</th><th>HipsY</th><th>Fwd</th><th>Foot</th></tr></thead>
        <tbody>
          <tr><td style={{ color: '#f80' }}>W</td><td>{p.windup.torsoLean}</td><td>{p.windup.torsoTwist}</td><td>{p.windup.hipsOffset}</td><td>{p.windup.hipsForward}</td><td>{p.windup.footStepR}</td></tr>
          <tr><td style={{ color: '#f44' }}>S</td><td>{p.strike.torsoLean}</td><td>{p.strike.torsoTwist}</td><td>{p.strike.hipsOffset}</td><td>{p.strike.hipsForward}</td><td>{p.strike.footStepR}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

const JOINTS = [
  { label: 'L Shoulder', key: 'leftArm', limb: 'arm' as const, joint: 'root' as const },
  { label: 'L Elbow', key: 'leftArm', limb: 'arm' as const, joint: 'mid' as const },
  { label: 'R Shoulder', key: 'rightArm', limb: 'arm' as const, joint: 'root' as const },
  { label: 'R Elbow', key: 'rightArm', limb: 'arm' as const, joint: 'mid' as const },
  { label: 'L Hip', key: 'leftLeg', limb: 'leg' as const, joint: 'root' as const },
  { label: 'L Knee', key: 'leftLeg', limb: 'leg' as const, joint: 'mid' as const },
  { label: 'R Hip', key: 'rightLeg', limb: 'leg' as const, joint: 'root' as const },
  { label: 'R Knee', key: 'rightLeg', limb: 'leg' as const, joint: 'mid' as const },
];

function JointTable({ angles }: { angles: Record<string, number> }) {
  return (
    <table style={{ width: '100%', fontSize: 12, color: '#ccc' }}>
      <thead>
        <tr style={{ color: '#888' }}>
          <th style={{ textAlign: 'left', padding: '4px 0' }}>Joint</th>
          <th style={{ width: 50 }}>Angle</th>
          <th style={{ width: 40 }}>Limit</th>
          <th>Bar</th>
        </tr>
      </thead>
      <tbody>
        {JOINTS.map(({ label, key, limb, joint }) => {
          const angle = angles[key] ?? 0;
          const limits = JOINT_CONFIG[limb][joint];
          const ratio = Math.min(100, (angle / limits.maxBendDeg) * 100);
          const atLimit = angle >= limits.maxBendDeg - 2 || angle <= limits.minBendDeg + 2;
          return (
            <tr key={label}>
              <td style={{ padding: '3px 0', fontSize: 11 }}>{label}</td>
              <td style={{ textAlign: 'center', fontWeight: 'bold', color: atLimit ? '#f44' : '#0f0' }}>{angle}°</td>
              <td style={{ textAlign: 'center', color: '#666', fontSize: 10 }}>{limits.maxBendDeg}°</td>
              <td style={{ padding: '3px 4px' }}>
                <div style={{ width: '100%', height: 6, background: '#333', borderRadius: 3, position: 'relative' }}>
                  <div style={{
                    position: 'absolute', left: 0, top: 0, height: 6, borderRadius: 3,
                    width: `${ratio}%`,
                    background: atLimit ? '#f44' : '#0af',
                    transition: 'width 0.1s',
                  }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Joint ROM Test ─────────────────────────────────────

/** ボーン名 → JOINT_CONFIG の3軸制限へのマッピング */
function getLimitsForBone(boneName: string): { label: string; limits: AxisLimits3 } | null {
  if (boneName.includes('RightArm') && !boneName.includes('Fore')) return { label: 'UpperArm (R)', limits: JOINT_CONFIG.arm.upperArm };
  if (boneName.includes('LeftArm') && !boneName.includes('Fore')) return { label: 'UpperArm (L)', limits: JOINT_CONFIG.arm.upperArm };
  if (boneName.includes('RightForeArm')) return { label: 'ForeArm (R)', limits: JOINT_CONFIG.arm.foreArm };
  if (boneName.includes('LeftForeArm')) return { label: 'ForeArm (L)', limits: JOINT_CONFIG.arm.foreArm };
  if (boneName === 'mixamorig:RightHand') return { label: 'Hand (R)', limits: JOINT_CONFIG.arm.hand };
  if (boneName === 'mixamorig:LeftHand') return { label: 'Hand (L)', limits: JOINT_CONFIG.arm.hand };
  if (boneName.includes('RightShoulder')) return { label: 'Shoulder (R)', limits: { x: JOINT_CONFIG.shoulder.x, y: JOINT_CONFIG.shoulder.y, z: JOINT_CONFIG.shoulder.z } };
  if (boneName.includes('LeftShoulder')) return { label: 'Shoulder (L)', limits: { x: JOINT_CONFIG.shoulder.x, y: JOINT_CONFIG.shoulder.y, z: JOINT_CONFIG.shoulder.z } };
  if (boneName === 'mixamorig:Spine') return { label: 'Spine', limits: JOINT_CONFIG.spine };
  if (boneName === 'mixamorig:Spine1') return { label: 'Spine1', limits: JOINT_CONFIG.spine1 };
  if (boneName === 'mixamorig:Spine2') return { label: 'Spine2', limits: JOINT_CONFIG.spine2 };
  return null;
}

const ROM_BONES = [
  'mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand', 'mixamorig:RightShoulder',
  'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand', 'mixamorig:LeftShoulder',
  'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2',
];

function JointROMTest({ characterRef, selectedBone, onBoneSelect }: {
  characterRef: React.RefObject<HavokCharacter | null>;
  selectedBone: string;
  onBoneSelect: (b: string) => void;
}) {
  const [romBone, setRomBone] = useState('mixamorig:RightArm');
  const [romX, setRomX] = useState(0);
  const [romY, setRomY] = useState(0);
  const [romZ, setRomZ] = useState(0);

  const info = getLimitsForBone(romBone);

  const applyRotation = useCallback((x: number, y: number, z: number) => {
    const character = characterRef.current;
    if (!character) return;
    const bone = character.allBones.get(romBone);
    if (!bone) return;

    // ベース回転を取得 (ikBaseRotations にボーン名で格納されている)
    const baseEntry = character.ikBaseRotations.get(romBone);
    const baseQ = baseEntry?.root;
    if (!baseQ) return;

    // euler (deg) → quaternion × base
    const degToRad = (d: number) => d * Math.PI / 180;
    const qx = Quaternion.RotationAxis(new V3(1, 0, 0), degToRad(x));
    const qy = Quaternion.RotationAxis(new V3(0, 1, 0), degToRad(y));
    const qz = Quaternion.RotationAxis(new V3(0, 0, 1), degToRad(z));
    const delta = qz.multiply(qy.multiply(qx));
    bone.rotationQuaternion = delta.multiply(baseQ);
  }, [characterRef, romBone]);

  const handleAxisChange = useCallback((axis: 'x' | 'y' | 'z', value: number) => {
    const nx = axis === 'x' ? value : romX;
    const ny = axis === 'y' ? value : romY;
    const nz = axis === 'z' ? value : romZ;
    if (axis === 'x') setRomX(value);
    if (axis === 'y') setRomY(value);
    if (axis === 'z') setRomZ(value);
    applyRotation(nx, ny, nz);
  }, [romX, romY, romZ, applyRotation]);

  const snapTo = useCallback((axis: 'x' | 'y' | 'z', minOrMax: 'min' | 'max') => {
    if (!info) return;
    const val = info.limits[axis][minOrMax];
    handleAxisChange(axis, val);
  }, [info, handleAxisChange]);

  const resetROM = useCallback(() => {
    setRomX(0); setRomY(0); setRomZ(0);
    applyRotation(0, 0, 0);
  }, [applyRotation]);

  return (
    <div style={sectionStyle('#f0a')}>
      <div style={headingStyle('#f0a')}>Joint ROM Test</div>

      {/* ボーン選択 */}
      <select value={romBone} onChange={e => { setRomBone(e.target.value); setRomX(0); setRomY(0); setRomZ(0); }}
        style={{ width: '100%', marginBottom: 8, ...selectStyle }}>
        {ROM_BONES.map(b => (
          <option key={b} value={b}>{b.replace('mixamorig:', '')}</option>
        ))}
      </select>

      {info ? (
        <>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>{info.label}</div>
          {(['x', 'y', 'z'] as const).map(axis => {
            const lim = info.limits[axis];
            const val = axis === 'x' ? romX : axis === 'y' ? romY : romZ;
            return (
              <div key={axis} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: axis === 'x' ? '#f66' : axis === 'y' ? '#6f6' : '#66f', fontWeight: 'bold' }}>
                    {axis.toUpperCase()}
                  </span>
                  <span style={{ color: '#fff', fontFamily: 'monospace' }}>{val.toFixed(0)}°</span>
                  <span style={{ color: '#888', fontSize: 10 }}>[{lim.min}° ~ {lim.max}°]</span>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button onClick={() => snapTo(axis, 'min')}
                    style={{ padding: '2px 6px', background: '#444', color: '#fff', border: 'none', borderRadius: 3, fontSize: 10, cursor: 'pointer' }}>
                    Min
                  </button>
                  <input type="range" min={lim.min} max={lim.max} step={1} value={val}
                    onChange={e => handleAxisChange(axis, Number(e.target.value))}
                    style={{ flex: 1, height: 6 }} />
                  <button onClick={() => snapTo(axis, 'max')}
                    style={{ padding: '2px 6px', background: '#444', color: '#fff', border: 'none', borderRadius: 3, fontSize: 10, cursor: 'pointer' }}>
                    Max
                  </button>
                </div>
              </div>
            );
          })}
          <button onClick={resetROM} style={{ ...btnStyle('#555'), marginTop: 4, padding: 6, fontSize: 12 }}>
            Reset to 0
          </button>
        </>
      ) : (
        <div style={{ color: '#888', fontSize: 12 }}>
          このボーンには3軸制限が設定されていません
        </div>
      )}
    </div>
  );
}
