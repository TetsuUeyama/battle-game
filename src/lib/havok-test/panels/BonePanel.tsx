'use client';
import type { HavokTestState, HavokTestActions } from '../use-havok-state';
import { SELECTABLE_BONES } from '../constants';
import { labelStyle, sliderStyle, sectionStyle, selectStyle, headingStyle } from './styles';

interface Props {
  state: HavokTestState;
  actions: HavokTestActions;
  onBoneSelect: (bone: string) => void;
}

function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={labelStyle}><span>{label}</span><span>{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} style={sliderStyle} />
    </div>
  );
}

export function BonePanel({ state: s, actions: a, onBoneSelect }: Props) {
  return (
    <div>
      {/* Bone selector */}
      <div style={{ marginBottom: 12 }}>
        <div style={headingStyle('#8f8')}>Bone</div>
        <select value={s.selectedBone} onChange={e => onBoneSelect(e.target.value)}
          style={{ width: '100%', ...selectStyle }}>
          {SELECTABLE_BONES.map(b => (
            <option key={b} value={b}>{b.replace('mixamorig:', '')}</option>
          ))}
        </select>
      </div>

      {/* Rotation */}
      <div style={sectionStyle('#666')}>
        <div style={headingStyle('#ccc')}>Rotation</div>
        <Slider label="X" value={s.rotX} min={-180} max={180} step={1} fmt={v => `${v.toFixed(0)}°`} onChange={a.setRotX} />
        <Slider label="Y" value={s.rotY} min={-180} max={180} step={1} fmt={v => `${v.toFixed(0)}°`} onChange={a.setRotY} />
        <Slider label="Z" value={s.rotZ} min={-180} max={180} step={1} fmt={v => `${v.toFixed(0)}°`} onChange={a.setRotZ} />
      </div>

      {/* Position */}
      <div style={sectionStyle('#666')}>
        <div style={headingStyle('#ccc')}>Position (m)</div>
        <Slider label="X" value={s.posX} min={-0.5} max={0.5} step={0.005} fmt={v => v.toFixed(3)} onChange={a.setPosX} />
        <Slider label="Y" value={s.posY} min={-0.5} max={0.5} step={0.005} fmt={v => v.toFixed(3)} onChange={a.setPosY} />
        <Slider label="Z" value={s.posZ} min={-0.5} max={0.5} step={0.005} fmt={v => v.toFixed(3)} onChange={a.setPosZ} />
      </div>

      {/* Hips / Height */}
      <div style={sectionStyle('#666')}>
        <div style={headingStyle('#ccc')}>Body</div>
        <Slider label="Hips Height" value={s.hipsHeight} min={-0.5} max={0.3} step={0.005} fmt={v => `${v.toFixed(3)}m`} onChange={a.setHipsHeight} />
        <Slider label="Height Scale" value={s.heightScale} min={0.5} max={2.0} step={0.01}
          fmt={v => `${v.toFixed(2)}x ≈ ${(1.78 * v).toFixed(2)}m`} onChange={a.setHeightScale} />
      </div>
    </div>
  );
}
