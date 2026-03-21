'use client';

import Link from 'next/link';

const pages = [
  { href: '/battle', title: '3v3 Battle', desc: '3v3チーム戦（Tank/Ranged/Healer/Assassin）' },
  { href: '/weapon-combat', title: 'Weapon Combat', desc: '武器戦闘（剣・斧・槍+盾・双槌 / 防具破壊・血しぶき）' },
  { href: '/judo', title: 'Judo', desc: '柔道 CPU対戦（組み手・投げ・寝技・締め）' },
  { href: '/water-gun', title: 'Water Gun', desc: '水鉄砲パーティクルFXプロトタイプ（水・血・毒）' },
  { href: '/field', title: 'Field Viewer', desc: 'ボクセル地形ビューワー' },
];

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh', background: '#1a1a2e', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '60px 20px',
    }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Battle Game</h1>
      <p style={{ color: '#888', marginBottom: 40 }}>Select a module</p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20, width: '100%', maxWidth: 700,
      }}>
        {pages.map(p => (
          <Link key={p.href} href={p.href} style={{ textDecoration: 'none' }}>
            <div style={{
              background: '#252540', borderRadius: 12, padding: '24px 20px',
              border: '1px solid #333', cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#ff5566'; e.currentTarget.style.background = '#2a2a50'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#252540'; }}
            >
              <div style={{ fontSize: 18, fontWeight: 'bold', color: '#ff7788', marginBottom: 8 }}>{p.title}</div>
              <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>{p.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
