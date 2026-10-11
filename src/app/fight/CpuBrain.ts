/**
 * /fight の CPU 思考 v2。
 *
 * v1 は「タイマーで間引いたランダム行動」だけで単調だったため、
 * 格闘ゲーム AI の基本要素を入れて発展させた:
 *
 *  - 反応 (reaction): プレイヤーの技の startup を見てから、難易度別の
 *    反応速度 + ばらつきでガード/回避を選ぶ (見てから守る)。
 *  - 差し返し (punish): プレイヤーの recovery (硬直) を検知して確定反撃。
 *    ガードで受けた直後のガードパニッシュも行う。
 *  - コンボ: 自分の攻撃がヒット/ガードされた通知 (onHitLanded) を受け、
 *    cancelInto ルートから次の技を選んで recovery キャンセルで繋ぐ。
 *  - 間合い管理 (footsies): 距離帯ごとに技テーブルを変え、得意間合い
 *    (1.1〜1.75m) を維持するよう前後ステップ+サイドステップで動く。
 *  - 適応: プレイヤーの攻撃頻度 (EMA) が高いほどガード寄りに、
 *    直近の被弾が多いほど一時的に守備的になる (連打への対策)。
 *  - ミス注入: 難易度別の mistakeRate で「反応しない/様子見する」を混ぜ、
 *    人間らしい揺らぎを作る (easy ほど多い)。
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { MoveDefinition } from '@/fighting/fighting/types';
import type { Fighter, FighterIntent } from './Fighter';

export type CpuDifficulty = 'easy' | 'normal' | 'hard';

interface CpuProfile {
  /** プレイヤーの技を見てから反応するまでの基本秒数 */
  reaction: number;
  /** 反応速度のばらつき (+0〜この値) */
  reactionVar: number;
  /** 反応時にガードを選ぶ確率 */
  guardProb: number;
  /** 反応時に後退/横回避を選ぶ確率 (guard と排他) */
  evadeProb: number;
  /** 相手の硬直 (recovery) への確定反撃の実行確率 */
  punishProb: number;
  /** 回避反応のうちカウンター構え (ハイリスク) を選ぶ割合 */
  counterRatio: number;
  /** ヒット/ガード時に cancelInto コンボを继続する確率 */
  comboProb: number;
  /** 攻め (攻撃を仕掛ける) の基本間隔秒 */
  attackInterval: number;
  /** 攻め間隔のばらつき (+0〜この値) */
  intervalVar: number;
  /** 「反応しない/様子見」のミス率 */
  mistakeRate: number;
}

const PROFILES: Record<CpuDifficulty, CpuProfile> = {
  easy: {
    reaction: 0.42, reactionVar: 0.22,
    guardProb: 0.3, evadeProb: 0.15,
    punishProb: 0.2, counterRatio: 0.1, comboProb: 0.25,
    attackInterval: 1.5, intervalVar: 0.8,
    mistakeRate: 0.25,
  },
  normal: {
    reaction: 0.26, reactionVar: 0.12,
    guardProb: 0.5, evadeProb: 0.2,
    punishProb: 0.5, counterRatio: 0.3, comboProb: 0.6,
    attackInterval: 0.95, intervalVar: 0.5,
    mistakeRate: 0.1,
  },
  hard: {
    reaction: 0.15, reactionVar: 0.08,
    guardProb: 0.62, evadeProb: 0.26,
    punishProb: 0.85, counterRatio: 0.5, comboProb: 0.9,
    attackInterval: 0.55, intervalVar: 0.35,
    mistakeRate: 0.03,
  },
};

/** 距離帯ごとの技候補 [id, 重み]。間合いに合った技だけ振る */
function attackPool(distance: number): [string, number][] {
  if (distance < 1.0) {
    return [['jab', 3], ['straight', 2], ['hook', 2], ['uppercut', 1.5]];
  }
  if (distance < 1.45) {
    return [['jab', 3], ['straight', 3], ['hook', 2], ['midKick', 1]];
  }
  if (distance < 1.85) {
    return [['midKick', 3], ['highKick', 2], ['straight', 1.5]];
  }
  return [];
}

const IDLE_INTENT: FighterIntent = { forward: 0, side: 0, guard: false, attack: null };

type MoveMode = 'hold' | 'approach' | 'retreat' | 'strafe';

export class CpuBrain {
  private difficulty: CpuDifficulty = 'normal';
  private profile: CpuProfile = PROFILES.normal;

  // 移動 (modeTimer の間だけ同じ移動を続ける)
  private moveMode: MoveMode = 'hold';
  private modeTimer = 0;
  private strafeSign = 1;

  // 反応 (プレイヤーの技の startup を見てから)
  private reactionTimer = -1;
  private reactionAction: 'guard' | 'sway' | 'counter' | 'step' | null = null;
  /** ガード保持の最低残り秒数 */
  private guardHold = 0;
  private guarding = false;
  /** ガード解除直後のガードパニッシュ猶予 */
  private guardPunishReady = false;

  // 攻め
  private attackTimer = 1.2;
  private lastAttacks: string[] = [];

  // コンボ
  private comboNext: string | null = null;

  // 適応
  /** プレイヤーの攻撃頻度 EMA (0..1) */
  private playerAggro = 0;
  /** 直近の被弾数 (時間減衰)。多いと一時的に守備的になる */
  private hitsTaken = 0;

  // ------------------------------------------------------------ 外部 API

  setDifficulty(d: CpuDifficulty): void {
    this.difficulty = d;
    this.profile = PROFILES[d];
  }

  getDifficulty(): CpuDifficulty {
    return this.difficulty;
  }

  /** 自分の攻撃がヒット/ガードされた通知 (FightGame.handleHit から) */
  onHitLanded(move: MoveDefinition, guarded: boolean, ownMoves: ReadonlyMap<string, MoveDefinition>): void {
    const routes = move.cancelInto?.filter((id) => ownMoves.has(id)) ?? [];
    if (routes.length === 0) {
      this.comboNext = null;
      return;
    }
    const prob = guarded ? this.profile.comboProb * 0.45 : this.profile.comboProb;
    this.comboNext = Math.random() < prob
      ? routes[Math.floor(Math.random() * routes.length)]
      : null;
  }

  /** 被弾通知 (適応用) */
  onGotHit(): void {
    this.hitsTaken = Math.min(this.hitsTaken + 1, 5);
  }

  /** ラウンド開始時のリセット */
  resetForRound(): void {
    this.moveMode = 'hold';
    this.modeTimer = 0;
    this.reactionTimer = -1;
    this.reactionAction = null;
    this.guardHold = 0;
    this.guarding = false;
    this.guardPunishReady = false;
    this.attackTimer = 0.8 + Math.random() * 0.8;
    this.comboNext = null;
    this.hitsTaken = 0;
  }

  // ------------------------------------------------------------ 毎フレーム

  think(dt: number, self: Fighter, player: Fighter): FighterIntent {
    const p = this.profile;
    // 体格でリーチが変わるため、間合いは両者の平均水平スケールで正規化して扱う
    const reach = (self.reachScale + player.reachScale) / 2;
    const distance = Vector3.Distance(self.node.position, player.node.position) / reach;

    // ---- 適応値の更新 (毎フレーム) ----
    // プレイヤーの攻撃頻度 EMA: 攻撃中なら 1 へ、そうでなければ 0 へ寄せる
    const aggroTarget = player.state === 'attack' ? 1 : 0;
    this.playerAggro += (aggroTarget - this.playerAggro) * Math.min(1, dt * 1.2);
    this.hitsTaken = Math.max(0, this.hitsTaken - dt * 0.45);

    if (self.state === 'ko' || self.state === 'hitstun') {
      this.comboNext = null;
      this.guarding = false;
      return IDLE_INTENT;
    }

    // ---- 攻撃中: コンボ継続だけ面倒を見る ----
    if (self.state === 'attack') {
      const status = self.combat.getStatus();
      if (this.comboNext) {
        if (status.moveId === this.comboNext) {
          // キャンセルが通った
          this.comboNext = null;
        } else {
          // recovery に入った瞬間に通るまで毎フレーム入力し続ける
          return { forward: 0, side: 0, guard: false, attack: this.comboNext };
        }
      }
      return IDLE_INTENT;
    }
    this.comboNext = null;

    // ---- 反応: プレイヤーの技の startup/active を見てから守る ----
    const pStatus = player.combat.getStatus();
    const threatened = player.state === 'attack'
      && (pStatus.phase === 'startup' || pStatus.phase === 'active')
      && distance < 2.1;

    if (threatened) {
      if (this.reactionTimer < 0 && !this.guarding) {
        // 脅威を初認知 → 反応をスケジュール。aggro が高いほどガード寄りに補正
        const guardProb = Math.min(0.9, p.guardProb + this.playerAggro * 0.25 + this.hitsTaken * 0.06);
        const r = Math.random();
        if (r < p.mistakeRate) {
          // ミス: 反応しない (棒立ちで食らう)
          this.reactionTimer = Number.POSITIVE_INFINITY;
          this.reactionAction = null;
        } else if (r < p.mistakeRate + guardProb) {
          this.reactionAction = 'guard';
          this.reactionTimer = p.reaction + Math.random() * p.reactionVar;
        } else if (r < p.mistakeRate + guardProb + p.evadeProb) {
          // 回避反応の内訳: counterRatio でカウンター構え、残りはスウェー/バックステップ
          const r2 = Math.random();
          this.reactionAction = r2 < p.counterRatio ? 'counter'
            : r2 < 0.8 ? 'sway' : 'step';
          this.reactionTimer = p.reaction + Math.random() * p.reactionVar;
        } else {
          this.reactionTimer = Number.POSITIVE_INFINITY;
          this.reactionAction = null;
        }
      }
      if (Number.isFinite(this.reactionTimer) && this.reactionTimer >= 0) {
        this.reactionTimer -= dt;
        if (this.reactionTimer <= 0 && this.reactionAction) {
          const action = this.reactionAction;
          this.reactionAction = null;
          this.reactionTimer = -1;
          if (action === 'guard') {
            this.guarding = true;
            this.guardHold = 0.25;
          } else if (action === 'sway' || action === 'counter') {
            // 防御アクションは技として即時発動する (Fighter.tryAttack 経由)
            return { forward: 0, side: 0, guard: false, attack: action };
          } else {
            this.moveMode = Math.random() < 0.5 ? 'retreat' : 'strafe';
            this.strafeSign = Math.random() < 0.5 ? 1 : -1;
            this.modeTimer = 0.3 + Math.random() * 0.2;
          }
        }
      }
    } else {
      this.reactionTimer = -1;
      this.reactionAction = null;
    }

    // ---- ガード保持/解除 ----
    if (this.guarding) {
      this.guardHold -= dt;
      // プレイヤーが攻撃し続けている間 + 最低保持時間はガード継続
      if (player.state === 'attack' || this.guardHold > 0) {
        return { forward: 0, side: 0, guard: true, attack: null };
      }
      this.guarding = false;
      this.guardPunishReady = true; // 受け切った → 反撃チャンス
    }

    // ---- 差し返し: プレイヤー硬直への確定反撃 / ガードパニッシュ ----
    const punishable = player.state === 'attack' && pStatus.phase === 'recovery' && distance < 1.7;
    if ((punishable || (this.guardPunishReady && distance < 1.45))
        && Math.random() < p.punishProb) {
      this.guardPunishReady = false;
      const attack = this.pickAttack(distance, true);
      if (attack) {
        this.attackTimer = p.attackInterval * 0.6;
        return { forward: 0, side: 0, guard: false, attack };
      }
    }
    if (!punishable) this.guardPunishReady = false;

    // ---- 攻め: 間隔タイマーで攻撃を仕掛ける ----
    // 直近の被弾が多いほど攻め間隔を伸ばす (守備的に)。aggro の高い相手にも少し慎重に
    const defensiveScale = 1 + this.hitsTaken * 0.25 + this.playerAggro * 0.2;
    this.attackTimer -= dt / defensiveScale;
    if (this.attackTimer <= 0 && distance < 1.85) {
      this.attackTimer = p.attackInterval + Math.random() * p.intervalVar;
      if (Math.random() >= p.mistakeRate) {
        const attack = this.pickAttack(distance, false);
        if (attack) return { forward: 0, side: 0, guard: false, attack };
      }
    }

    // ---- 間合い管理 (footsies) ----
    this.modeTimer -= dt;
    if (this.modeTimer <= 0) {
      this.decideMovement(distance);
    }

    return {
      forward: this.moveMode === 'approach' ? 1 : this.moveMode === 'retreat' ? -1 : 0,
      side: this.moveMode === 'strafe' ? this.strafeSign : 0,
      guard: false,
      attack: null,
    };
  }

  // ------------------------------------------------------------ 内部

  /** 距離帯テーブル + 直近使用ペナルティで技を選ぶ。fast=true は発生の速い技優先 (差し返し用) */
  private pickAttack(distance: number, fast: boolean): string | null {
    let pool = attackPool(distance);
    if (pool.length === 0) return null;
    if (fast) {
      // 差し返しは速い技 (ジャブ/ワンツー) に絞る。間合い外ならテーブルのまま
      const quick = pool.filter(([id]) => id === 'jab' || id === 'straight');
      if (quick.length > 0) pool = quick;
    }
    // 同じ技の連発を抑制 (直近 2 回に出した技は重みを下げる)
    const weighted = pool.map(([id, w]) =>
      [id, this.lastAttacks.includes(id) ? w * 0.35 : w] as [string, number]);
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * total;
    for (const [id, w] of weighted) {
      roll -= w;
      if (roll <= 0) {
        this.lastAttacks.push(id);
        if (this.lastAttacks.length > 2) this.lastAttacks.shift();
        return id;
      }
    }
    return weighted[weighted.length - 1][0];
  }

  /** 得意間合い (1.1〜1.75m) を維持する移動を選ぶ */
  private decideMovement(distance: number): void {
    this.modeTimer = 0.25 + Math.random() * 0.3;

    if (distance > 1.75) {
      this.moveMode = 'approach';
      return;
    }
    if (distance < 0.8) {
      this.moveMode = Math.random() < 0.6 ? 'retreat' : 'strafe';
      this.strafeSign = Math.random() < 0.5 ? 1 : -1;
      return;
    }
    // 得意間合い内: 揺さぶり (前後ステップ/横ステップ/静止)
    const r = Math.random();
    if (r < 0.3) {
      this.moveMode = 'strafe';
      this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    } else if (r < 0.5) {
      this.moveMode = 'approach';
      this.modeTimer = 0.18; // 小さく詰める
    } else if (r < 0.65) {
      this.moveMode = 'retreat';
      this.modeTimer = 0.2; // 軽く下がって誘う
    } else {
      this.moveMode = 'hold';
    }
  }
}
