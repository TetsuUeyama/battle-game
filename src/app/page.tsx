'use client';

/**
 * メインページ (ルート /)。
 * 左タブ式トップ (キャラクターエディット / 対戦モード / 設定) を表示する。
 * 実体は src/app/fight/page.tsx の FightApp。
 * 他のデモ (/motion-test, /water-gun 等) は各 URL で直接アクセスできる。
 */

import FightApp from './fight/page';

export default function Home() {
  return <FightApp />;
}
