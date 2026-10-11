/**
 * /fight の 1 キャラ分のアクター。
 *
 * fightingGamesystem が提供するのは「ロード+リバインド (CharacterRig)」と
 * 「技のフレーム進行+hitbox 判定 (CombatController)」まで。
 * 移動・向き・ロコモーションアニメ切替・ガード・ヒットリアクション・KO・HP は
 * システム側に存在しないため、このクラスがゲーム層として実装する (MISSING.md 参照)。
 */

import type { Scene } from '@babylonjs/core/scene';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import {
  loadFightingCharacter,
  type FightingCharacter,
  type PreloadedAnimations,
} from '@/fighting/retarget';
import { createVoxelFighter } from '@/fighting';
import { getSkin } from './skinStore';
import { CombatController, startWithBlending } from '@/fighting/combat';
import { PoseLayerController } from '@/fighting/pose';
import { EmotionMeter, EMOTION_PERSONALITIES, type EmotionMood } from '@/fighting/emotion';
import type { ClipSettings } from '@/fighting/loader';

import {
  MODEL_GLB_PATH, HURTBOXES, CLIP, STYLE_PERSONALITY, getBody, STYLE_LABELS,
  COUNTER_FOLLOWUP_ID, COUNTER_DAMAGE_MUL, radiusScaleOf,
  buildMoves, hitStrength, HIT_REACTIONS, KO_CLIPS, reactionCandidates,
  type HitStrength, type FightStyle, type GameMove, type MoveOverride,
} from './moves';
import {
  getStats, statMaxHp, statDamageMul, statDefenseMul, statSpeedMul,
  type CharStats,
} from './stats';
import type { CharacterRecord } from './characterModel';

export type FighterState = 'neutral' | 'attack' | 'guard' | 'hitstun' | 'ko';

/** applyHit の結果。FightGame がフィード/エフェクト/ヒットストップを出し分ける */
export type HitOutcome = 'invuln' | 'counter' | 'armor' | 'guarded' | 'hit' | 'ko';

/** 1 フレーム分の行動入力 (プレイヤー/CPU 共通の語彙) */
export interface FighterIntent {
  /** 前後移動 -1..1 (+ が相手方向) */
  forward: number;
  /** 横移動 -1..1 (+ が自分から見て右) */
  side: number;
  guard: boolean;
  /** このフレームに発動したい技 id (押下エッジ) */
  attack: string | null;
}

const WALK_SPEED = 1.5;
const BACK_SPEED = 1.2;
const SIDE_SPEED = 1.0;

export interface FighterLoadOptions {
  name: string;
  baseUrl: string;
  startPosition: Vector3;
  /** 識別用リングの色 */
  ringColor: Color3;
  clipSettings: Map<string, ClipSettings>;
  /** ファイトスタイル (技セット)。1P=boxer / 2P=kicker など */
  style: FightStyle;
  /** preloadAnimations() で先読みしたアニメ群 (複数キャラで共有) */
  preloadedAnimations: PreloadedAnimations;
  /** モデル GLB ロード進捗の通知 */
  onProgress?: (loaded: number, total: number, path: string) => void;
  /** CPU など「前傾の個性」を付けるときの Spine 前傾量 (ラジアン) */
  poseLean?: number;
  /**
   * マイキャラクター (Phase 7-4)。指定すると見た目=record のボクセルスキン、
   * 技=record.style、ステータス/体格/表示名も record のものを使う。
   * 未指定なら従来通り (style ベース + skinStore)。
   */
  character?: CharacterRecord | null;
}

export class Fighter {
  readonly name: string;
  /** HUD/フィード用の表示名。リーグ戦ではスタイル名に差し替わる */
  displayName: string;
  /** 位置と向きを書くラッパー。glTF の __root__ は rotationQuaternion を持つため直接回せない */
  readonly node: TransformNode;
  readonly character: FightingCharacter;
  readonly combat: CombatController;
  style: FightStyle;
  moves: Map<string, GameMove>;
  /** feature5: excited/calm の感情ゲージ (スタイル別の性格付き) */
  emotion: EmotionMeter;
  /** 体格による水平スケール (CPU の間合い正規化・押し合い距離に使う) */
  reachScale = 1;
  /** 体格による垂直スケール (エフェクト高さに使う) */
  verticalScale = 1;
  private readonly pose: PoseLayerController | null;
  private readonly clipSettings: Map<string, ClipSettings>;
  /** 識別リング (Zone/Fear で発光色を変える) */
  private readonly ringMat: StandardMaterial;
  private readonly baseRingColor: Color3;
  private lastMoodVisual: EmotionMood = 'neutral';
  /** この技でヒット/ガードさせたか (空振り whiff 判定用) */
  private landedThisMove = true;

  hp = 100;
  /** ステータス由来の最大 HP (体力) */
  maxHp = 100;
  /** ステータス由来の与ダメージ倍率 (攻撃) */
  damageMul = 1;
  /** ステータス由来の被ダメージ倍率 (防御。小さいほど硬い) */
  defenseMul = 1;
  /** ステータス由来の移動速度倍率 (機動) */
  speedMul = 1;
  wins = 0;
  state: FighterState = 'neutral';
  private stunLeft = 0;

  // ヒットストップ (一瞬の停止演出)
  private hitstopLeft = 0;
  private frozenGroups: { group: AnimationGroup; speed: number }[] = [];
  /** ヒットストップ中に押された攻撃を 1 つだけ先行入力として保持 */
  private bufferedAttack: string | null = null;

  private activeLoop: string | null = null;
  private reactionClip: string | null = null;
  /** ボクセルスキン使用時の破棄関数 (通常ロードは null) */
  private readonly voxelDispose: (() => void) | null;

  /** マイキャラクターのステータス上書き (null = スタイル既定 getStats) */
  private statsOverride: CharStats | null = null;
  /** マイキャラクターの体格上書き (null = スタイル既定 getBody) */
  private bodyOverride: { width: number; height: number } | null = null;
  /** マイキャラクターの表示名上書き (null = STYLE_LABELS) */
  private displayNameOverride: string | null = null;
  /** マイキャラクターの技モーション上書き (null = スタイル既定/グローバル上書き) */
  private moveOverrides: Record<string, MoveOverride> | null = null;

  private constructor(
    name: string,
    node: TransformNode,
    character: FightingCharacter,
    clipSettings: Map<string, ClipSettings>,
    pose: PoseLayerController | null,
    style: FightStyle,
    ringMat: StandardMaterial,
    ringColor: Color3,
    voxelDispose: (() => void) | null,
    overrides?: {
      stats?: CharStats | null;
      body?: { width: number; height: number } | null;
      displayName?: string | null;
      moves?: Record<string, MoveOverride> | null;
    },
  ) {
    this.voxelDispose = voxelDispose;
    this.name = name;
    this.displayName = name;
    this.node = node;
    this.character = character;
    this.clipSettings = clipSettings;
    this.pose = pose;
    this.ringMat = ringMat;
    this.baseRingColor = ringColor;
    this.combat = new CombatController(character.rig);
    this.style = style;
    this.moves = new Map();
    this.emotion = new EmotionMeter();
    this.statsOverride = overrides?.stats ?? null;
    this.bodyOverride = overrides?.body ?? null;
    this.displayNameOverride = overrides?.displayName ?? null;
    this.moveOverrides = overrides?.moves ?? null;
    this.applyStyle(style);
  }

  /**
   * ファイトスタイル (技セット + emotion 性格 + 体格) を切り替える。全クリップは
   * ロード済みなので再ロード不要。進行中の技は強制キャンセルする (試合間の切替を想定)。
   */
  setStyle(style: FightStyle): void {
    if (this.style === style) return;
    this.combat.forceCancel();
    this.applyStyle(style);
  }

  /** スタイルに紐づく一式 (技/性格/体格/判定スケール/表示名) を適用する */
  private applyStyle(style: FightStyle): void {
    this.style = style;
    // マイキャラは固有名、そうでなければスタイル名
    this.displayName = this.displayNameOverride ?? STYLE_LABELS[style];

    // 体格: 水平 (X/Z) 等倍 + 垂直。リーチ・被弾面積・身長が変わる。
    // マイキャラは record の体格、そうでなければ getBody (キャラエディット上書き含む)
    const body = this.bodyOverride
      ? { ...getBody(style), ...this.bodyOverride }
      : getBody(style);
    this.node.scaling.set(body.width, body.height, body.width);
    this.reachScale = body.width;
    this.verticalScale = body.height;

    // 判定半径も体格に追従させる (ボーン追従の判定球は半径が固定値のため)。
    // 注: デバッグ表示の球メッシュはボーン経由でスケールが二重に掛かるが、
    // 実判定は worldCenter + 設定半径で行われるので表示だけの誤差。
    const rs = radiusScaleOf(body);
    this.combat.setupHurtboxes(HURTBOXES.map((b) => ({ ...b, radius: b.radius * rs })));
    // マイキャラは record の自己完結した技上書き、そうでなければ従来 (グローバル上書き)
    this.moves = buildMoves(this.character.rig.clips, style, rs, this.moveOverrides ?? undefined);
    this.emotion = new EmotionMeter(EMOTION_PERSONALITIES[STYLE_PERSONALITY[style]]);

    // ステータス (Phase 7-1): 最大HP・与ダメ・被ダメ・移動速度。
    // マイキャラは record のステータス、そうでなければ getStats
    const stats = this.statsOverride ?? getStats(style);
    this.maxHp = statMaxHp(stats);
    this.damageMul = statDamageMul(stats);
    this.defenseMul = statDefenseMul(stats);
    this.speedMul = statSpeedMul(stats);
    this.hp = this.maxHp;
  }

  static async load(scene: Scene, opts: FighterLoadOptions): Promise<Fighter> {
    // マイキャラクター (Phase 7-4): record のスキン/技スタイルを使う。
    // 無ければ従来 (style + skinStore)。技セットは下の resolvedStyle に集約。
    const resolvedStyle = opts.character ? opts.character.style : opts.style;
    // ボクセルスキン: マイキャラは record.skin、そうでなければ skinStore(style)。
    // Maskman メッシュの代わりにボクセル化スキンへ FAP モーションをバインドする。
    const skin = opts.character ? opts.character.skin : getSkin(opts.style);
    let character: FightingCharacter;
    let voxelDispose: (() => void) | null = null;
    if (skin) {
      const vf = await createVoxelFighter(scene, {
        triangles: skin.triangles,
        modelGlbPath: MODEL_GLB_PATH,
        preloadedAnimations: opts.preloadedAnimations,
        baseUrl: opts.baseUrl,
        onProgress: opts.onProgress,
        fitPose: skin.fitPose,
        yawDeg: skin.yawDeg,
        scale: skin.scale,
        offsetY: skin.offsetY,
        resolution: skin.resolution,
        markers: skin.markers,
      });
      character = { rig: vf.rig, retargetStats: vf.retargetStats };
      voxelDispose = vf.dispose;
    } else {
      // アニメは preloadAnimations() 済みのソースを共有バインド (再ダウンロード無し)
      character = await loadFightingCharacter(scene, {
        modelGlbPath: MODEL_GLB_PATH,
        preloadedAnimations: opts.preloadedAnimations,
        baseUrl: opts.baseUrl,
        onProgress: opts.onProgress,
      });
    }

    // ラッパーを被せて position / rotation.y をゲーム側で制御する
    const wrapper = new TransformNode(`${opts.name}_wrapper`, scene);
    wrapper.position.copyFrom(opts.startPosition);
    character.rig.root.parent = wrapper;

    // 識別リング (P1 青 / CPU 赤)
    const ring = MeshBuilder.CreateTorus(`${opts.name}_ring`, {
      diameter: 1.0, thickness: 0.035, tessellation: 48,
    }, scene);
    ring.parent = wrapper;
    ring.position.y = 0.02;
    const ringMat = new StandardMaterial(`${opts.name}_ringMat`, scene);
    ringMat.emissiveColor = opts.ringColor;
    ringMat.disableLighting = true;
    ring.material = ringMat;
    ring.isPickable = false;

    // feature2: ポーズレイヤーで個性付け (前傾)
    let pose: PoseLayerController | null = null;
    if (opts.poseLean) {
      pose = new PoseLayerController(character.rig);
      pose.setLayer({ offsets: { Spine: [opts.poseLean, 0, 0] }, weight: 0.6 });
    }

    return new Fighter(
      opts.name, wrapper, character, opts.clipSettings, pose, resolvedStyle,
      ringMat, opts.ringColor, voxelDispose,
      opts.character
        ? {
            stats: opts.character.stats,
            body: opts.character.body,
            displayName: opts.character.name,
            moves: opts.character.moves,
          }
        : undefined,
    );
  }

  // ------------------------------------------------------------ クリップ制御

  private clip(name: string): AnimationGroup | undefined {
    return this.character.rig.clips.get(name);
  }

  /** ループクリップ (ロコモーション/ガード) をクロスフェード付きで切り替える */
  private playLoop(name: string, speedRatio = 1): void {
    if (this.activeLoop === name) {
      const g = this.clip(name);
      if (g) g.speedRatio = speedRatio;
      return;
    }
    this.stopLoop();
    const g = this.clip(name);
    if (!g) return;
    const loop = this.clipSettings.get(name)?.loop ?? true;
    startWithBlending(g, { fadeSec: 0.14, loop, speedRatio });
    this.activeLoop = name;
  }

  private stopLoop(): void {
    if (!this.activeLoop) return;
    this.clip(this.activeLoop)?.stop();
    this.activeLoop = null;
  }

  private stopReaction(): void {
    if (!this.reactionClip) return;
    this.clip(this.reactionClip)?.stop();
    this.reactionClip = null;
  }

  /** ワンショットのリアクション/KO クリップを再生 (ループ・技を止めてから) */
  private playReaction(name: string, speedRatio = 1): void {
    this.stopLoop();
    this.stopReaction();
    const g = this.clip(name);
    if (!g) return;
    startWithBlending(g, { fadeSec: 0.08, speedRatio });
    this.reactionClip = name;
  }

  /** rig.clips に存在する最初の候補クリップ名を返す */
  private firstAvailableClip(candidates: string[]): string | null {
    for (const name of candidates) {
      if (this.character.rig.clips.has(name)) return name;
    }
    return null;
  }

  // ------------------------------------------------------------ 行動

  /** 技を出す。成功したら true */
  tryAttack(moveId: string): boolean {
    if (this.state === 'hitstun' || this.state === 'ko' || this.state === 'guard') return false;
    const move = this.moves.get(moveId);
    if (!move) return false;
    return this.startMove(move);
  }

  /**
   * playMove + emotion 補正 + animSpeed 適用 + ループ停止。キャンセル時にも使う。
   * emotion (feature5) でダメージ/クールタイム/発生速度が現在の感情で連続変化する。
   * 発生区間の speedRatio = 技固有 animSpeed × 感情の発生補正。
   * (CombatController が active 移行で speedRatio を 1 に戻すため、
   *  以降の animSpeed 維持は update() 側で行う)
   */
  private startMove(move: GameMove, opts?: { damageMul?: number }): boolean {
    const mod = this.emotion.applyToMove(move);
    if (opts?.damageMul !== undefined && mod.move.damage !== undefined) {
      mod.move.damage *= opts.damageMul;
    }
    const ok = this.combat.playMove(mod.move, {
      fadeSec: 0.1,
      startupSpeedRatio: mod.startupSpeedRatio * move.animSpeed,
    });
    if (!ok) return false;
    this.stopLoop();
    this.stopReaction();
    this.landedThisMove = false;
    this.state = 'attack';
    return true;
  }

  /** この技がヒット/ガードされた (空振りではない) ことを記録する */
  noteHitLanded(): void {
    this.landedThisMove = true;
  }

  /** 現在攻撃中の技 (攻撃中でなければ undefined) */
  private currentMove(): GameMove | undefined {
    const id = this.combat.getStatus().moveId;
    return id ? this.moves.get(id) : undefined;
  }

  /**
   * 被弾処理。優先順: 無敵 > アーマー > ガード > 通常ヒット。
   * contact (HitEvent の部位情報) があれば高さ・方向別のやられクリップを選ぶ。
   */
  applyHit(
    damage: number,
    attackerPos: Vector3,
    contact?: { hurtboxBone: string; hitPosition: [number, number, number] },
  ): HitOutcome {
    if (this.state === 'ko') return 'hit';

    const strength: HitStrength = hitStrength(damage);

    // 攻撃中の無敵 / スーパーアーマー区間判定
    if (this.state === 'attack') {
      const move = this.currentMove();
      if (move) {
        const frame = this.combat.getStatus().frame;
        if (move.invuln && frame >= move.invuln[0] && frame <= move.invuln[1]) {
          // カウンター構え中の回避成功 → 自動で反撃へ移行 (守→攻)
          if (move.id === 'counter') {
            // keepCooldown でカウンター自体の連発は防ぐ
            this.combat.forceCancel({ keepCooldown: true });
            this.state = 'neutral'; // startMove の前提を満たす
            const followup = this.moves.get(COUNTER_FOLLOWUP_ID);
            if (followup) this.startMove(followup, { damageMul: COUNTER_DAMAGE_MUL });
            this.emotion.notify('cleanHit'); // ジャスト行動成功 = Zone への道
            return 'counter';
          }
          return 'invuln'; // 完全回避: ダメージもノックバックも無し
        }
        if (move.armor && frame >= move.armor[0] && frame <= move.armor[1]) {
          // アーマー: ダメージは受けるが仰け反らず技を続行
          this.hp = Math.max(0, this.hp - damage);
          this.knockback(attackerPos, HIT_REACTIONS[strength].knockback * 0.3);
          if (this.hp <= 0) {
            this.knockOut(strength);
            return 'ko';
          }
          return 'armor';
        }
      }
    }

    const guarded = this.state === 'guard';
    const dealt = guarded ? Math.max(1, Math.ceil(damage * 0.2)) : damage;
    this.hp = Math.max(0, this.hp - dealt);
    this.knockback(attackerPos, HIT_REACTIONS[strength].knockback * (guarded ? 0.5 : 1));

    if (this.hp <= 0) {
      this.knockOut(strength);
      return 'ko';
    }

    if (guarded) return 'guarded'; // ガード時はモーションを乱さない

    // 攻撃中に被弾したら技を強制キャンセル (幽霊ヒット・残骸 hitbox も消える)
    if (this.state === 'attack') {
      this.combat.forceCancel();
    }

    this.playReaction(this.pickReactionClip(strength, contact), 1.4);
    this.state = 'hitstun';
    this.stunLeft = HIT_REACTIONS[strength].stun;
    return 'hit';
  }

  /** 相手から離れる方向へ水平ノックバック */
  private knockback(attackerPos: Vector3, amount: number): void {
    const away = this.node.position.subtract(attackerPos);
    away.y = 0;
    const dir = away.lengthSquared() > 1e-6 ? away.normalize() : new Vector3(0, 0, 1);
    this.node.position.addInPlace(dir.scale(amount));
  }

  // ------------------------------------------------------------ ヒットストップ

  /**
   * 現在再生中のクリップを sec 秒ほぼ停止する (ヒットの重み付け演出)。
   * CombatController は speedRatio に追従するため判定タイミングも一緒に止まる。
   */
  applyHitstop(sec: number): void {
    if (this.state === 'ko' && this.hitstopLeft <= 0) {
      // KO 演出は止めない (倒れモーション優先)
      return;
    }
    if (this.hitstopLeft <= 0) {
      this.frozenGroups = [];
      for (const g of this.playingGroups()) {
        this.frozenGroups.push({ group: g, speed: g.speedRatio });
        g.speedRatio = 0.02;
      }
    }
    this.hitstopLeft = Math.max(this.hitstopLeft, sec);
  }

  /** いま再生中の AnimationGroup 群 (ループ / リアクション / 攻撃クリップ) */
  private playingGroups(): AnimationGroup[] {
    const out: AnimationGroup[] = [];
    const push = (name: string | null | undefined) => {
      if (!name) return;
      const g = this.clip(name);
      if (g && g.isPlaying) out.push(g);
    };
    push(this.activeLoop);
    push(this.reactionClip);
    push(this.currentMove()?.clip);
    return out;
  }

  /** ヒットストップの進行。停止中なら true (行動更新をスキップする) */
  private updateHitstop(dt: number): boolean {
    if (this.hitstopLeft <= 0) return false;
    this.hitstopLeft -= dt;
    if (this.hitstopLeft <= 0) {
      for (const f of this.frozenGroups) f.group.speedRatio = f.speed;
      this.frozenGroups = [];
      return false;
    }
    return true;
  }

  /** HitEvent の部位情報から方向・高さ別のやられクリップを選ぶ */
  private pickReactionClip(
    strength: HitStrength,
    contact?: { hurtboxBone: string; hitPosition: [number, number, number] },
  ): string {
    if (contact) {
      // ヒット位置を自分の右方向軸に射影して左右ずれ量を出す
      const hit = new Vector3(...contact.hitPosition).subtract(this.node.position);
      const y = this.node.rotation.y;
      const lateral = hit.x * Math.cos(y) - hit.z * Math.sin(y); // dot(hit, rightAxis)
      const found = this.firstAvailableClip(
        reactionCandidates(strength, contact.hurtboxBone, lateral),
      );
      if (found) return found;
    }
    return strength === 'weak' ? 'KB_Hit_p_MidFront_Weak' : 'KB_Hit_m_MidFront_Med';
  }

  private knockOut(strength: HitStrength): void {
    this.state = 'ko';
    this.combat.forceCancel();
    // 旧: KO クリップ終了後のポーズレイヤー累積回避で setWeight(0) していたが、
    // runtime 側 A-11 修正 (アニメ未書き込みフレームは再合成) により不要になった。
    this.playReaction(KO_CLIPS[strength]);
  }

  // ------------------------------------------------------------ 毎フレーム

  /**
   * intent に従って移動・向き・アニメを更新する。
   * 攻撃クリップの開始/終了は CombatController が司るので、
   * ここでは「attack が終わったら neutral へ戻す」ことだけ面倒を見る。
   */
  update(dt: number, target: Fighter, intent: FighterIntent): void {
    // 感情ゲージは常時更新 (平衡点へ回帰) + Zone/Fear のリング発光
    this.emotion.update(dt);
    this.updateMoodVisual();

    if (this.state === 'ko') return;

    // ヒットストップ中は完全停止 (攻撃入力だけ先行入力として保持)
    if (this.updateHitstop(dt)) {
      if (intent.attack) this.bufferedAttack = intent.attack;
      return;
    }
    if (this.bufferedAttack && !intent.attack) {
      intent = { ...intent, attack: this.bufferedAttack };
    }
    this.bufferedAttack = null;

    // 相手の方を向く (KO 中以外は常時)
    const diff = target.node.position.subtract(this.node.position);
    this.node.rotation.y = Math.atan2(diff.x, diff.z);

    // 硬直の解消
    if (this.state === 'hitstun') {
      this.stunLeft -= dt;
      if (this.stunLeft > 0) return;
      this.stopReaction();
      this.state = 'neutral';
    }

    // 攻撃の終了検知 + recovery 中のキャンセルコンボ受付
    if (this.state === 'attack') {
      const phase = this.combat.getStatus().phase;
      if (phase === 'idle') {
        if (!this.landedThisMove) this.emotion.notify('whiff'); // 空振り
        this.state = 'neutral';
      } else {
        // startup 専用速度の解除後 (active/recovery)、CombatController は
        // speedRatio を 1 に戻すので、技固有の animSpeed をここで維持する
        const cur = this.currentMove();
        if (cur && phase !== 'startup' && cur.animSpeed !== 1) {
          const g = this.clip(cur.clip);
          if (g && g.isPlaying && g.speedRatio === 1) g.speedRatio = cur.animSpeed;
        }
        // recovery 中は cancelInto に含まれる技なら CombatController が通す
        if (intent.attack) {
          const move = this.moves.get(intent.attack);
          if (move) this.startMove(move);
        }
        return; // 攻撃中は移動もガードもできない
      }
    }

    // ガード
    if (intent.guard) {
      this.state = 'guard';
      this.playLoop(CLIP.blockLoop);
      return;
    }
    if (this.state === 'guard') this.state = 'neutral';

    // 技の発動 (押下エッジ)
    if (intent.attack && this.tryAttack(intent.attack)) return;

    // 移動 (forward は相手方向)
    const fwd = new Vector3(Math.sin(this.node.rotation.y), 0, Math.cos(this.node.rotation.y));
    const right = new Vector3(fwd.z, 0, -fwd.x);
    const vel = fwd.scale(intent.forward * (intent.forward > 0 ? WALK_SPEED : BACK_SPEED))
      .add(right.scale(intent.side * SIDE_SPEED));
    // 機動ステータスで移動速度が変わる
    this.node.position.addInPlace(vel.scale(dt * this.speedMul));

    // ロコモーションアニメ
    if (Math.abs(intent.forward) > 0.1) {
      this.playLoop(intent.forward > 0 ? CLIP.walkFwd : CLIP.walkBwd, 1.1);
    } else if (Math.abs(intent.side) > 0.1) {
      this.playLoop(intent.side > 0 ? CLIP.sideR : CLIP.sideL);
    } else {
      this.playLoop(CLIP.idle, 0.9);
    }
  }

  // ------------------------------------------------------------ ラウンド管理

  resetForRound(position: Vector3): void {
    this.hp = this.maxHp;
    this.state = 'neutral';
    this.stunLeft = 0;
    // ヒットストップの残骸を解消 (凍結した speedRatio を戻す)
    if (this.hitstopLeft > 0) {
      for (const f of this.frozenGroups) f.group.speedRatio = f.speed;
    }
    this.hitstopLeft = 0;
    this.frozenGroups = [];
    this.bufferedAttack = null;
    this.landedThisMove = true;
    this.combat.forceCancel();
    // 感情ゲージは性格の平衡点へリセット
    this.emotion = new EmotionMeter(EMOTION_PERSONALITIES[STYLE_PERSONALITY[this.style]]);
    this.updateMoodVisual();
    this.stopReaction();
    this.stopLoop();
    this.node.position.copyFrom(position);
    this.playLoop(CLIP.idle, 0.9);
  }

  /** Zone=金色 / Fear=灰青 / neutral=基本色 にリングの発光を切り替える */
  private updateMoodVisual(): void {
    const mood = this.emotion.getMood();
    if (mood === this.lastMoodVisual) return;
    this.lastMoodVisual = mood;
    this.ringMat.emissiveColor =
      mood === 'zone' ? new Color3(1, 0.84, 0.2)
        : mood === 'fear' ? new Color3(0.35, 0.4, 0.5)
          : this.baseRingColor;
  }

  setDebugVisible(visible: boolean): void {
    this.combat.setDebugVisible(visible);
  }

  dispose(): void {
    this.pose?.dispose();
    this.combat.dispose();
    this.voxelDispose?.();
    this.node.dispose();
  }
}
