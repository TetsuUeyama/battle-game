/**
 * AI — 戦闘AIシステム。
 *
 * ai/
 *   dispatcher.ts       ステートマシン・ディスパッチャ (updateCombatAIvsCharacter)
 *   update-target-ai.ts 標的追尾モードAI (updateCombatAI)
 *   create.ts           ファクトリ (createCombatAI, createCombatAIvsCharacter)
 *   context.ts          StateContext型定義
 *   shared.ts           共通処理 (turnToward, updateStance, resetSpine)
 *   swing-builder.ts    SwingMotion構築
 *   clash.ts            武器クラッシュ判定・反動
 *   target-mover.ts     標的ランダム移動
 *   pick-attack.ts      攻撃タイプ選択
 *   combo-decision.ts   コンボ判断
 *   distance-eval.ts    距離評価
 *   target-select.ts    ターゲットボーン選択
 */

export { updateCombatAIvsCharacter } from './dispatcher';
export { updateCombatAI } from './update-target-ai';
export { createCombatAI, createCombatAIvsCharacter } from './create';
export { createTargetMover, updateTargetMover } from './target-mover';
export { checkWeaponClash, updateClashReaction } from '../effects/clash';
