'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  color: string;
  content: ReactNode;
}

interface Props {
  tabs: Tab[];
  defaultTab?: string;
}

export function TabContainer({ tabs, defaultTab }: Props) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.id ?? '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 8, flexShrink: 0 }}>
        {tabs.map(tab => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: 12,
                fontWeight: active ? 'bold' : 'normal',
                background: active ? tab.color + '33' : '#222',
                color: active ? tab.color : '#888',
                border: 'none',
                borderBottom: active ? `2px solid ${tab.color}` : '2px solid transparent',
                cursor: 'pointer',
                borderRadius: '4px 4px 0 0',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tabs.find(t => t.id === activeTab)?.content}
      </div>
    </div>
  );
}
