/** 共通スタイル定数 */
import type { CSSProperties } from 'react';

export const labelStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 6, color: '#ddd',
};

export const sliderStyle: CSSProperties = {
  width: '100%', marginTop: 4, height: 6,
};

export const selectStyle: CSSProperties = {
  background: '#333', color: '#fff', border: '1px solid #555', padding: '6px 8px', fontSize: 13, borderRadius: 4,
};

export const sectionStyle = (color: string): CSSProperties => ({
  marginBottom: 12, borderTop: `2px solid ${color}`, paddingTop: 10,
});

export const btnStyle = (bg: string): CSSProperties => ({
  width: '100%', padding: 10, background: bg, color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 14,
});

export const headingStyle = (color: string): CSSProperties => ({
  color, fontSize: 15, fontWeight: 'bold', marginBottom: 8,
});
