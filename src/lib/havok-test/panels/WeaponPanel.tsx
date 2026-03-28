'use client';
import type { HavokTestState, HavokTestActions } from '../use-havok-state';
import type { StanceType, SwingType } from '@/lib/havok-character/types';
import { labelStyle, sliderStyle, sectionStyle, selectStyle, btnStyle, headingStyle } from './styles';

interface Props {
  state: HavokTestState;
  actions: HavokTestActions;
  onAttack: (type: SwingType, power: number) => void;
}

export function WeaponPanel({ state: s, actions: a, onAttack }: Props) {
  return (
    <div>
      <div style={headingStyle('#f80')}>Weapon</div>

      {/* Source toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 13 }}>
          <input type="radio" name="weaponSrc" checked={!s.useAssetWeapon} onChange={() => a.setUseAssetWeapon(false)} />
          {' '}テスト用
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="radio" name="weaponSrc" checked={s.useAssetWeapon} onChange={() => a.setUseAssetWeapon(true)} />
          {' '}Game Assets
        </label>
      </div>

      {/* Asset selector */}
      {s.useAssetWeapon && s.availableWeapons.length > 0 && (
        <select value={s.selectedAssetWeapon} onChange={e => a.setSelectedAssetWeapon(e.target.value)}
          style={{ width: '100%', ...selectStyle, marginBottom: 8 }}>
          {s.availableWeapons.map(w => (
            <option key={`${w.category}/${w.pieceKey}`} value={`${w.category}/${w.pieceKey}`}>
              {w.pieceKey.replace(/_/g, ' ')} ({w.category})
            </option>
          ))}
        </select>
      )}

      {/* Equip */}
      <label style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
        <input type="checkbox" checked={s.weaponEquipped} onChange={e => a.setWeaponEquipped(e.target.checked)} />
        {' '}武器装備
      </label>

      {s.weaponEquipped && (<>
        {/* Stance */}
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 13, marginRight: 8 }}>Stance:</span>
          <select value={s.stance} onChange={e => a.setStance(e.target.value as StanceType)} style={selectStyle}>
            <option value="front">正面</option>
            <option value="side">右側面</option>
            <option value="overhead">頭上</option>
          </select>
        </div>

        {/* Manual controls */}
        {!s.useAssetWeapon && (
          <div style={sectionStyle('#555')}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 13, marginRight: 8 }}>Grip:</span>
              <select value={s.gripType} onChange={e => a.setGripType(e.target.value as 'one-handed' | 'two-handed')} style={selectStyle}>
                <option value="one-handed">片手</option>
                <option value="two-handed">両手</option>
              </select>
            </div>
            <div style={labelStyle}><span>Weight</span><span>{s.weaponWeight.toFixed(1)}kg</span></div>
            <input type="range" min={0.5} max={10} step={0.1} value={s.weaponWeight}
              onChange={e => a.setWeaponWeight(Number(e.target.value))} style={sliderStyle} />
            <div style={labelStyle}><span>Length</span><span>{s.weaponLength.toFixed(2)}m</span></div>
            <input type="range" min={0.3} max={2.5} step={0.05} value={s.weaponLength}
              onChange={e => a.setWeaponLength(Number(e.target.value))} style={sliderStyle} />
          </div>
        )}

        {/* Off-hand */}
        {s.gripType === 'two-handed' && (
          <label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            <input type="checkbox" checked={s.offHandReleased} onChange={e => a.setOffHandReleased(e.target.checked)} />
            {' '}片手持ち切替
          </label>
        )}

        {/* Attack */}
        <div style={sectionStyle('#f44')}>
          <div style={headingStyle('#f44')}>Attack</div>
          <select value={s.swingTypeSelect} onChange={e => a.setSwingTypeSelect(e.target.value as SwingType)}
            style={{ width: '100%', ...selectStyle, marginBottom: 6 }}>
            <option value="vertical">縦振り</option>
            <option value="horizontal">横振り</option>
            <option value="thrust">突き</option>
          </select>
          <div style={labelStyle}><span>Power</span><span>{s.attackPower}%</span></div>
          <input type="range" min={10} max={100} step={5} value={s.attackPower}
            onChange={e => a.setAttackPower(Number(e.target.value))} style={sliderStyle} />
          <button onClick={() => onAttack(s.swingTypeSelect, s.attackPower)}
            style={{ ...btnStyle('#c22'), marginTop: 8 }}>
            Attack!
          </button>
        </div>

        {/* Swing hold */}
        <button onMouseDown={() => a.setSwingActive(true)} onMouseUp={() => a.setSwingActive(false)} onMouseLeave={() => a.setSwingActive(false)}
          style={{ ...btnStyle(s.swingActive ? '#f44' : '#555'), marginBottom: 8 }}>
          {s.swingActive ? 'Swinging...' : 'Swing (hold)'}
        </button>

        {/* HUD */}
        <div style={{ padding: 8, background: 'rgba(255,128,0,0.12)', borderRadius: 6, fontSize: 13 }}>
          <div>Tip Speed: <b>{s.tipSpeed.toFixed(2)}</b> m/s</div>
          <div>Power: <b>{s.swingPower.toFixed(2)}</b></div>
        </div>
      </>)}
    </div>
  );
}
