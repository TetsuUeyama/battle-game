'use client';
import type { HavokCharacter, SwingType } from '@/lib/havok-character/types';
import type { HavokTestState, HavokTestActions } from '../use-havok-state';
import { JOINT_CONFIG } from '@/lib/havok-character/character/body';
import { SWING_PRESETS } from '@/lib/havok-character/character/body';
import { playMotionTest } from '../motion-test';
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
      </div>

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
