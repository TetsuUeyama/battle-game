# battle-game 作業記録

## 2026-09-18: dev 環境の復旧 + モーション一覧ビューア `/motions` 追加

### dev 環境の復旧
- `node_modules` が空だったため `npm ci` (317 パッケージ / 56 秒)。
  `eslint-visitor-keys` の EBADENGINE 警告 (Node 23) が出るがビルドには影響なし。
- `npx tsc --noEmit`: src 0 エラー。born-editer は独自 tsconfig/node_modules の
  別サブプロジェクトなのでエラーが出るが従来どおり無関係。
- `npm run dev` → http://localhost:3000。`/`, `/fight`, `/fight?tab=edit` いずれも 200。
  アセット配信も実バイト数つきで確認 (maskman 8.75MB / kb_movement 4.43MB /
  kb_punches 8.08MB / clip-settings.json 115KB)、`/api/characters` は `{"characters":[]}`。

### `/motions` (新規): モーション一覧ビューア
対戦画面を通さずに FAP の全クリップを 1 つずつ確認したい、という要望への対応。

- `src/app/motions/page.tsx` (新規・単一ファイル)。ゲーム層 (Fighter/CombatController) を
  一切通さず、リターゲット済み AnimationGroup をそのまま再生する。
- 一覧は `assets-manifest.json` を実行時 fetch して構築 (手書きリストを持たない)。
  11 カテゴリ / 244 クリップ (BindPose・tpose は除外)。
- ロード方式: モデル GLB は初回 1 回だけ (`loadFightingCharacter`、アニメ無し)。
  アニメ GLB はカテゴリ選択時に `preloadAnimations().bindTo(targetNodes)` で
  遅延バインドし、ソースは即 dispose。読み込み済みカテゴリはキャッシュ (✓ 表示)。
  targetNodes は `[...rig.nodesByName.values(), ...rig.meshes]` で
  loadFightingCharacter 内部と同じ組み立て。
- UI: カテゴリ一覧 / クリップ絞り込み + 一覧 / 再生・一時停止・最初から・前後送り /
  ループ / 速度 0.05〜2.0x / フレームシーク / 現在フレーム表示 (fps・秒つき)。
  ↑↓ で前後のクリップ、Space で再生切替。カメラは alpha=+π/2 (= +Z 側 = 正面)、
  床に +Z を示す水色マーカーを置いて向きの取り違えを防ぐ。
- `?cat=<id>&clip=<name>` で初期選択できる (hydration 不一致を避けるため
  URL は必ず effect 内で読む)。ヘッドレス検証にも使う。

### 検証
- `npx tsc --noEmit`: src 0 エラー。
- dev で `/motions` ✓ Compiled / HTTP 200。
- **ヘッドレス Chrome (swiftshader) で実描画を確認**:
  - `/motions` → Maskman が正面向きで描画、「モデル OK (ボーン 90)」、11 カテゴリ/244 クリップ
    (tmp/motions.png)。
  - `/motions?cat=kb_punches&clip=KB_m_Hook_L` → 「kb_punches: 49 クリップ /
    リターゲット 51 グループ」、フック中間ポーズで描画、frame 25.6/76 @ 60fps (1.27s)、
    シークバーも追従 (tmp/motions-hook.png)。
  → アニメ GLB の遅延バインドと再生は実描画で動いている。
- **未検証**: 実ブラウザでのクリック操作全般 (カテゴリ切替の連続、シークのドラッグ、
  ↑↓ キー送り)、12 カテゴリすべての読み込み、クリップ切替時に前クリップの
  ポーズが残らないか (FAP は全クリップが同じ全身骨を書く前提で作っている)。

## 2026-07-05: ボクセル化キャラのモーションずれ (ポーズ不統一) の根本修正

### 症状
キャラクターエディットのボクセル化で、ポーズの統一ができず、元のモーション (Maskman) から
ずれたモーションになる。

### 根本原因 (ヘッドレス NullEngine で数値再現して確定)
- FAP クリップは各ボーンの**ローカル回転を毎フレーム絶対値で上書き**する。回転カーブは
  Maskman rest の「親ローカル空間での骨オフセット方向」を前提とする。
- `applyJointMarkers` は setAbsolutePosition でローカルオフセットを**方向ごと**取込モデルの
  ポーズへ書き換える。markers 使用時は keepPositionFor=/^(Root|Hips)$/ で Hips 以外の
  position カーブを捨てるため、この「取込ポーズの方向」が再生中もそのまま残る。
- 結果、全モーションが (取込ポーズ − Maskman rest) 分だけ**恒常的に**ずれる。
  再現実測 (肩まわり40°の A ポーズ模擬マーカー): 上腕 38.0° / 前腕 19.8° のずれが
  クリップ全フレームで一定 (tmp/repro-marker-pose.mjs)。
- fitPose(tpose) のみ・マーカー無しの経路は position トラックが全て残るため再生姿勢は
  Maskman と完全一致 = ずれない (今回の症状はマーカー経路)。

### 修正 (src/fighting/voxelize)
- `fitMarkers.ts`: rest ポーズ管理を追加 — `snapshotRestPose` (全ボーンのローカル変換控え) /
  `applyRestPose` (そのまま書き戻し) / `restorePlaybackPose` (**再生ポーズ正規化**:
  回転・スケール=控えた元 rest、位置=**元の方向 × 現在の長さ**。Root/Hips/__root__ は
  position トラックが生きるため元値へ)。ヘッダの再生時注意を2点に更新。
- `createVoxelFighter.ts`: ロード直後 (fitPose/markers 前) に `snapshotRestPose` で元 rest を
  控え、バインド (ウェイト計算 + buildVoxelSkinMesh の invRest 焼き込み) 完了後に
  `restorePlaybackPose` で正規化。restPose/resetPose は正規化後の姿勢を控える方式に変更
  (= resetPose はバインドポーズではなく再生 rest を表示)。マーカー診断の一時 console.log を
  撤去 (「後で削除」予定だったもの)。
- `index.ts`: 新 API をエクスポート。
- 意味: **マーカー = バインド専用ポーズ**。マーカーから引き継ぐのは骨長 (プロポーション)
  のみで、骨方向は元 rest に戻るためモーションは Maskman と一致する。取込メッシュは
  invRest 経由のスキニングで FAP の構えへ再ポーズされる = ポーズの統一。

### 検証
- `npx tsc --noEmit`: src 0 エラー (born-editer の既存エラーは別サブプロジェクト)。
- 実装本体の検証 (tmp/verify-fix.ts を esbuild でバンドルし実 GLB + 実クリップで実行):
  修正前相当 = 上腕38.0°/前腕19.8° の恒常ずれ、修正後 = **方向ずれ 0.0°** かつ
  マーカーで1.3倍にした前腕骨長が**再生中も 1.300 倍で維持**。
  fitPose=tpose + マーカー併用 (SkinEdit stage3 と同順: tpose 適用後のスケルトンに
  マーカー→restorePlaybackPose) でも 方向ずれ 0.0° / 骨長 1.300 を確認。
- 全体再点検 (同日): resetPose の doc をバインドポーズ→再生 rest に訂正、
  createVoxelFighter の Vector3 を import type 化。呼び出し側 (Fighter.load /
  MotionPreview / SkinEdit) の markers 伝播と resetPose 使用箇所 (SkinEdit の
  マーカー無し分岐のみ) を確認、VoxelFighter.segments への外部依存なしを確認。
- **未検証 (要ブラウザ)**: SkinEdit の実 UI フロー (マーカー配置→ボクセル化→比較表示) と
  対戦での見た目。resetPose の表示が「バインドポーズ」から「FAP 構え (正規化後)」に
  変わるため、マーカー無し経路のボクセルプレビュー rest 表示も変化する (仕様通りだが要目視)。



## 2026-06-05: fightingGamesystem による 3D 対戦アクションゲーム `/fight` 実装

### やったこと

1. **runtime 取り込み**: `game-assets/fightingGamesystem/runtime` → `src/fighting/` へ
   robocopy /MIR でコピー (35ファイル)。Turbopack がプロジェクト外 tsconfig paths に
   不安定なためコピー方式を採用 (workPlan.md 参照)。
2. **アセット配信**: コピーせず、既存の `/api/game-assets/[...path]` ルートで
   `fightingGamesystem/assets/` を直接配信 (`/api/game-assets/fightingGamesystem/assets/...`)。
3. **`/fight` ページ新規実装** (`src/app/fight/`):
   - `moves.ts` — 技テーブル。フレームデータはクリップ実長比から生成 (jab/straight/hook/
     uppercut/midKick/highKick、ジャブ→ワンツー/フックのキャンセルルート)。
   - `Fighter.ts` — ゲーム層アクター (state: neutral/attack/guard/hitstun/ko、
     ロコモーション切替、被弾リアクション、KO、識別リング)。
   - `CpuBrain.ts` — CPU 思考 (間合い管理・ガード・攻撃選択)。
   - `FightGame.ts` — シーン構築・キーボード入力・ラウンド/タイマー/マッチ進行・
     pushbox・追従カメラ・ヒットスパーク・HUD 通知。
   - `page.tsx` — HUD (HPバー/ラウンド/タイマー/フィード/操作説明/勝利画面)。
   - 使用 API: feature1 `loadFightingCharacter`、feature3 `CombatController`、
     feature2 `PoseLayerController` (CPU の前傾個性)、`loadClipSettings`。
4. **トップページ** に `/fight` リンク追加。
5. **検証**: `npx tsc --noEmit` パス (Babylon 8.50 でも copied runtime に型エラーなし)。
   dev サーバーで `/fight` 200、clip-settings.json / maskman GLB 配信 200。
   ヘッドレス Chrome のスクリーンショットで 2 体の Maskman が FAP 構えで対峙し
   HUD が表示されることを確認 (`tmp/fight-headless.png`)。
6. **不足機能の記録**: `game-assets/fightingGamesystem/MISSING.md` に 16 項目を記述
   (技中断 API 無し、ルートモーションが GLB に焼かれていない、ヒット方向情報無し、
   投げモーション無し、サウンド無し等。各項目に回避策と望ましい対応を記載)。

### 調査で判明した事実

- GLB の Root ノード曲線は全キー 0 (KB_WalkFwd1/KB_Idle_1 で確認) — 全クリップ in-place。
  clip-settings.json の rootMotion フラグとは食い違う。移動はゲーム側制御で問題ないが、
  前進技・吹き飛びは表現不可 (MISSING.md A-3)。
- Maskman の実ボーン名 (RightHand/Spine1 等) は sampleMoves の前提と一致。
- 攻撃中の被弾に対する技中断 API が CombatController に無いため、クリップ停止+
  interrupted フラグで「幽霊ヒット」を無効化する回避策を実装 (MISSING.md A-2)。

### 残課題

- 実機ブラウザでの操作感確認 (フレームデータ比率・CPU 難易度の調整)。
- MISSING.md A-3 (ルートモーション) は motion-editor 側エクスポータの対応が先。

## 2026-06-05 (2): fightingGamesystem 改修版への追従 (/fight 新 API 移行)

motion-editor 側で MISSING.md の A-2/5/6/7/8/9/10, C-1/2 が対応され runtime が再同期
されたため、`src/fighting/` へ再コピー (robocopy /MIR, 9ファイル更新) し /fight を移行。

### 適用した新 API

- **forceCancel** (A-2): 被弾/KO/ラウンドリセット時の技中断を `combat.forceCancel()` に置換。
  クリップ停止+interrupted フラグの回避策を撤去 (幽霊ヒット対策が公式化)。
- **クロスフェード** (A-5): 攻撃は `playMove(move, { fadeSec: 0.1 })`、
  ロコモーション/リアクションは `startWithBlending` (fade 0.14 / 0.08) でポップ解消。
- **部位・方向別やられ** (A-6): HitEvent の `hurtboxBone` + `hitPosition` から
  高さ (High/Mid/Low) と方向 (Front/Left/Right) を解決し、FAP の方向別やられ
  クリップを選択 (moves.ts reactionCandidates + Fighter.pickReactionClip)。
  high 強度は Stagger クリップ優先。
- **共有バインド** (A-7): `preloadAnimations()` でアニメ GLB 6 本を 1 回だけロードし、
  P1/CPU 両方へ `preloadedAnimations` でバインド → `dispose()`。2体目の再DLが消えた。
- **進捗表示** (A-10): preload/モデルロードの onProgress を HUD ローディングに表示。
- resolvePush (A-9) は不採用: rig.root がワールド座標を持つ前提で、/fight の
  ラッパー構成と合わないため自前 separate() を継続 (MISSING.md A-9 に追記)。

### 検証

- `npx tsc --noEmit` パス。/fight 200。ヘッドレス Chrome で対峙画面の描画確認
  (`tmp/fight-headless2.png`)。

## 2026-06-05 (3): CPU 思考 v2 (単調・弱すぎ問題への対応)

「CPU の判断が単調で圧勝する」フィードバックを受け、CpuBrain を全面改修。

### 実装した思考要素 (CpuBrain.ts)

- **反応 (見てから守る)**: プレイヤーの技の startup/active を検知し、難易度別の
  反応速度 (easy 0.42s / normal 0.26s / hard 0.15s + ばらつき) でガード or 回避
  (後退/横ステップ) を選択。プレイヤーの攻撃頻度 EMA が高いほどガード確率を上げる。
- **差し返し (punish)**: プレイヤーの recovery (硬直) を検知して確定反撃
  (ジャブ/ワンツー優先)。ガードで受け切った直後のガードパニッシュも実行。
- **コンボ**: FightGame.handleHit から onHitLanded(move, guarded) 通知を受け、
  cancelInto ルートから次の技を選択 → recovery キャンセルが通るまで毎フレーム入力。
  ガード時はコンボ継続確率を 45% に減衰。
- **間合い管理 (footsies)**: 距離帯別の技テーブル (近: jab/hook/uppercut、
  中: jab/straight/hook、先端: midKick/highKick)。得意間合い 1.1〜1.75m を維持する
  前後ステップ+横ステップの揺さぶり。同じ技の連発は重み 0.35 倍で抑制。
- **適応**: 直近被弾数 (時間減衰) が多いと攻め間隔を伸ばし守備的に (連打対策)。
- **ミス注入**: 難易度別 mistakeRate (easy 25% / normal 10% / hard 3%) で
  「反応しない/様子見」を混ぜ人間らしい揺らぎに。

### 難易度 UI

- 3 段階 (EASY/NORMAL/HARD)。キー 1/2/3 または中央パネルのボタンで随時切替。
  HUD に現在難易度を表示。ラウンド開始時に brain.resetForRound()。

### 検証

- `npx tsc --noEmit` パス。/fight 200、ヘッドレス Chrome で難易度ボタン付き HUD の
  描画確認 (`tmp/fight-headless3.png`)。
- 操作感 (難易度ごとの勝率バランス) は実機プレイでの調整待ち。
  調整箇所は CpuBrain.ts の PROFILES 定数に集約してある。

## 2026-06-05 (4): CPU vs CPU 観戦モード

- FightGame に `mode: 'pvc' | 'cvc'` を追加。cvc では P1 側にも CpuBrain を
  割り当て (`p1Brain`)、キーボードの攻撃入力は捨てる。試合を中断せずに切替可能。
- 切替: C キー or 中央パネルのトグルボタン or URL `?mode=cvc`。
- cvc 中はラベルが CPU 1 / CPU 2 になり、マッチ終了後 5 秒で自動再戦 (放置観戦可)。
- 難易度 (1/2/3) は cvc 時両方の CPU に適用。ヒット通知 (onHitLanded/onGotHit) も
  両 brain へ配線。ラウンド開始時に両 brain をリセット。

## 2026-06-05 (5): 1P/2P の技セット分離 (ファイトスタイル)

- moves.ts に `FightStyle = 'boxer' | 'kicker'` を導入し、技テーブルをスタイル別に分離。
  技 id は 6 スロット共通 (jab/straight/hook/uppercut/midKick/highKick) のため、
  CpuBrain の距離帯テーブル・コンボルートは無変更で両スタイルに対応。
- **1P = boxer (パンチ主体)**: ジャブ/ワンツー/フック/アッパー +
  前蹴り (KB_p_MidKickFront_R) / 上段前蹴り (KB_p_HighKickStraight_R)。
- **2P/CPU = kicker (蹴り・肘・膝主体)**: KB_m_Jab_L / KB_m_OneTwo /
  回し肘 (KB_m_ElbowRound_R, hitbox=RightForeArm) / 右膝 (KB_m_KneeRight, hitbox=RightLeg) /
  ミドル回し蹴り (KB_m_MidKickRoud_R_1) / 上段回し蹴り (KB_m_HighKickRound_R_1)。
  単発火力とリーチで勝り、boxer は手数で勝る差別化。
- 全クリップ名は assets-manifest.json と照合済み。typecheck OK・描画確認済み。

## 2026-06-05 (6): タイプ別総当たりリーグ戦モード

- スタイルを 4 種に拡張: boxer / kicker に加え
  **power** (肘打ち/バックスイング/裏拳回し/剛アッパー17/剛ミドル15/かかと落とし20。
  発生・回転が重い高火力型) と
  **speed** (速ジャブ4/ダブルジャブ/中段フック/中段アッパー/ローキック/ラビットキック。
  低火力・高回転でキャンセルルートが広い) を追加。
- `Fighter.setStyle()` 追加 — 全クリップはロード済みなので技テーブル差替のみで
  スタイル変更可能 (再ロード無し)。displayName をスタイル名に差替。
- **リーグ戦 (mode='league')**: 4 タイプの総当たり 6 試合を自動進行 (両者 CPU、
  ラウンド 45 秒・2 本先取)。試合間 4 秒で次カードへ。結果は leagueStats に集計し、
  HUD 左に常時順位表 (勝/敗/ラウンド得失差)、全試合終了で CHAMPION 画面 + 最終順位表。
  R で再リーグ、B で操作モードへ復帰。
- 起動方法: B キー / 中央パネル「タイプ別リーグ戦」ボタン / URL `?mode=league`。
- HUD リファクタ: p1Label/cpuLabel/matchWinnerSide を FightGame 側で算出し、
  page.tsx のモード分岐を排除。フィードは displayName (リーグ中はスタイル名) を使用。

## 2026-06-05 (7): バグ修正 — KO 時に上半身が前方にぐるぐる回る (赤側のみ)

- **症状**: CPU (赤) が KO されると、倒れた後に上半身が前方へ回転し続ける。
- **原因**: PoseLayerController (CPU の前傾個性 Spine+0.12rad) の合成式
  `base ⊗= offset` が毎フレーム現在値に掛ける方式のため、KO クリップ再生終了後
  (アニメがボーンを上書きしなくなった後) にオフセットが累積 (毎秒約412°回転)。
  青側はポーズレイヤー無しのため発生せず。
- **修正**: Fighter.knockOut() で pose.setWeight(0)、resetForRound() で復帰。
- **システム側フィードバック**: MISSING.md A-11 として記録 (本質対応は runtime 側で
  「アニメが書いていないフレームは掛け直さない」検知が必要)。typecheck OK。

## 2026-06-05 (8): Phase 1 実装 — 技属性 (animSpeed/無敵/アーマー/ヒットストップ)

workPlan.md の Phase 1 を実装。システムアップデートの第一弾。

- **GameMove** (moves.ts): MoveDefinition + animSpeed/invuln/armor。
  MoveSpec に animSpeed / invulnPct / armorPct を追加しクリップ長比→フレームへ展開。
- **animSpeed**: Fighter.startMove() で playMove 成功後に clip.speedRatio を設定。
  CombatController が masterFrame 追跡のため判定が見た目に追従する。
- **無敵/アーマー** (Fighter.applyHit): 優先順 無敵 > アーマー > ガード > ヒット。
  無敵=完全回避、アーマー=ダメージのみ受け仰け反らず技続行 (KB 0.3倍)。
  戻り値を HitOutcome ('invuln'|'armor'|'guarded'|'hit'|'ko') に変更し、
  FightGame.handleHit で結果別のフィード/スパーク (アーマー=金色)/ヒットストップを出し分け。
- **ヒットストップ**: 強度別 0.06/0.09/0.13s (ガード 0.04s)。再生中の全クリップ
  (ループ/リアクション/攻撃) の speedRatio を 0.02 に下げて復元。停止中の攻撃入力は
  1 つ先行入力保持。KO 演出中の相手側は止めない。resetForRound で残骸解消。
- **タイプ個性**: boxer=アッパー出始め無敵 [4-35%] + ジャブ1.1x /
  kicker=上段回し蹴り1.1x / power=剛アッパー[6-55%]・かかと落とし[8-60%]アーマー /
  speed=ジャブ1.2x 他全体高速 + ラビットキック出始め無敵 [5-30%]。
- 検証: typecheck OK、/fight 200、ヘッドレス描画確認 (`tmp/fight-phase1.png`)。
  無敵/アーマーの発動はリーグ観戦 (パワー vs 他) で確認可能。

## 2026-06-06: runtime 06-06版へ追従 (feature5 emotion / A-9 / A-11)

fightingGamesystem が更新されたため再同期 (`robocopy /MIR`, 9ファイル+emotion/ 追加)。
配布物の `tsconfig.check.json` 型検証 0 を確認してから取り込み。

### 適用内容

- **A-11 (PoseLayer 累積バグ) 修正済み** → Fighter.knockOut の `setWeight(0)` 回避策と
  resetForRound の復帰処理を撤去 (poseWeight フィールドも削除)。
- **A-9 resolvePush の PushTarget 化** → 自前 separate() を削除し
  `resolvePush(p1.node, cpu.node, 0.72)` へ移行 (ラッパー TransformNode を直接渡せる)。
- **feature5 emotion 統合**:
  - スタイル→性格: boxer=STEADY / kicker=COOLHEADED / power=HOTBLOOD / speed=TIMID
    (moves.ts STYLE_PERSONALITY)。setStyle / resetForRound でメーター再生成。
  - startMove: `emotion.applyToMove(move)` → `playMove(mod.move, { startupSpeedRatio:
    mod.startupSpeedRatio × animSpeed })`。ダメージ/CT/発生が感情で連続変化。
    HitEvent の damage は補正済みが届く (handleHit で Math.round)。
  - **注意 (干渉対策)**: CombatController は startupSpeedRatio 使用時、active 移行で
    speedRatio を 1 に戻す。技固有 animSpeed は Fighter.update の attack 分岐で
    active/recovery 中に再適用して維持する。
  - イベント配線 (handleHit): 通常ヒット=attacker dealHit / 相手の攻撃を潰したら
    cleanHit (Zone への道) / 被弾 damage≥12 で bigDamage (Fear への道)、それ以外 takeHit /
    ガード成功=guardSuccess / 無敵すかし=attacker whiff。
    技が当たらず終了した場合の whiff は Fighter 側 (landedThisMove) で検知。
  - HUD: 両者に 興奮(橙)/冷静(水色) のミニバー + ZONE/FEAR バッジ。
    足元リングも Zone=金 / Fear=灰青 に発光変化。Zone/Fear 突入・離脱をフィード表示。
- 検証: typecheck OK、/fight 200、ヘッドレス確認。

## 2026-06-06 (2): 防御行動 3 パターン (ガード / スウェー / カウンター)

スウェーとカウンターは「攻撃判定なし + 無敵区間つきの GameMove」として実装
(Phase 1 の属性システムを再利用。専用 state 追加なし)。

- **ガード (Space)**: 従来どおり。被ダメ 20% チップ・仰け反らない安全択。
- **スウェー (Q)**: KB_Dodge_L。無敵 [12-50%]、recovery 終了 62% と短く、
  recovery を全攻撃でキャンセル可 = 回避から最速で攻撃に移れる。
  無敵の前後を殴られると軽減なしのフルヒット (ガードより高リスク)。CT 1.0。
- **カウンター (E)**: KB_p_Duck。無敵窓 [10-42%] とシビアで、空振り時は
  recovery 95% まで隙 + キャンセル不可 (最高リスク)。無敵中に攻撃を受けると
  自動で反撃 (スタイルの uppercut × 1.3 倍ダメージ) に移行 — 守→攻の転換択。
  実装: Fighter.applyHit の無敵判定で move.id==='counter' なら
  forceCancel({keepCooldown}) → startMove(uppercut, {damageMul:1.3})。
  成功時は emotion cleanHit (Zone への道) + 攻撃側 0.12s ヒットストップ + 緑スパーク。
- **CPU 対応**: 反応の回避枝を counterRatio (easy 10% / normal 30% / hard 50%) で
  カウンター、残りをスウェー 50%/バックステップに配分。反応発火時は即時 intent で発動。
- HitOutcome に 'counter' を追加。無敵/カウンターすかし時の whiff 二重通知を
  noteHitLanded で抑止。
- **検証時の注意**: スクリーンショット取得中に page.tsx を編集すると HMR で
  キャラ消失+Issue バッジが出る (一時的・リロードで解消)。編集なしの再取得で
  正常確認、コンソールエラーも 240s 走行で 0 件。

## 2026-06-06 (3): 体格 4 キャラクター + キャラクター選択画面

### 体格 (moves.ts STYLE_BODY → Fighter.applyStyle)

スタイルに体格を紐付け、wrapper.scaling (水平X/Z等倍 + 垂直Y) で実現:
- ボクサー = 標準 (1.0, 1.0) / キックボクサー = 高身長 (1.05, 1.15) /
  スピード = 低身長 (0.9, 0.86) / パワー = 太め標準身長 (1.28, 1.0)。
- 水平等倍 (sx=sz) なので Y 回転 (相手への正対) で歪まない。
- リーチはボーン位置に自動追従。大柄=リーチ長いが的もデカい、のトレードオフ。

### スケール追従 (固定値の解消)

- hitbox/hurtbox 半径: radiusScaleOf(body)=(width×2+height)/3 を掛けて再構築。
- 押し合い: MIN_SEPARATION × 両者の平均 reachScale。
- CPU 間合いテーブル: 距離を平均水平スケールで正規化してから判定。
- ヒットスパーク高さ: 1.3 × verticalScale。
- setStyle → applyStyle に一本化 (技/性格/体格/判定/表示名)。リーグ戦でも体格が変わる。

### キャラクター選択画面

- ロード完了後、試合を始めずに選択画面 (hud.selecting)。背後で両者 idle 待機。
- P1 / 相手それぞれ 4 キャラから選択 + モード (あなたが操作 / CPU vs CPU 観戦) +
  対戦開始 / タイプ別リーグ戦ボタン。
- FightGame.startMatch(p1Style, cpuStyle, mode) で開始。Esc でいつでも選択画面へ戻る
  (backToSelect)。URL ?mode=cvc / ?mode=league は従来どおり選択を飛ばして即開始。
- HUD ラベルはキャラ名ベースに変更: 「ボクサー (YOU)」「キックボクサー (CPU)」等。
- 検証: typecheck OK、選択画面・体格差の描画確認。

## 2026-06-09 (3): Phase 7-3 スキン (FBX/GLB→ボクセル化) ※ユーザー要望で先行

機能1 (スキン) を先に実装。voxelize は Babylon のみ依存 (three 不要) と確認し採用。

- runtime 再同期で `src/fighting/voxelize/` 取得 (createVoxelFighter 等)。typecheck 0。
- `importMesh.ts`: GLB は ImportMeshAsync で頂点+マテリアル色を world 抽出 (LOD1+ 除外)、
  FBX は fbx-parser (FBXReader) で Geometry の Vertices/PolygonVertexIndex を扇状三角形化。
  TriangleMesh を返す。URL 版 (importUrlToTriangleMesh) も用意。
- `skinStore.ts`: style→{triangles, fitPose, yawDeg, scale, resolution} のメモリ保持
  (バイナリは localStorage 不可。セッション内)。
- `SkinEdit.tsx`: 専用 Babylon プレビューシーン。ファイル取り込み→createVoxelFighter→
  resetPose で rest 静止表示 (自動回転)。構え/向き/大きさ/解像度を調整→対象スタイルへ適用。
- `Fighter.load`: getSkin(style) があれば createVoxelFighter で「ボクセル+FAPモーション」の
  rig を生成 (なければ従来 loadFightingCharacter)。dispose で voxelDispose も呼ぶ。
- CharacterEdit にサブタブ「スキン」追加。
- **hydration 修正**: initialTab/initialSection を useState 直接初期化 → useEffect で URL 反映に
  変更 (SSR は固定値と一致)。
- 検証: typecheck 0。autosample で Maskman 取り込み→ボクセル化成功
  (42,468三角形→3,065voxel)。プレビュー描画・hydrationエラー0 を確認。
- **既知の注意**: Maskman はスキン済みアニメモデルのため自己ボクセル化は bind 空間ズレで
  崩れる (サンプルボタンは削除)。ユーザーの静的/Tポーズ GLB/FBX が想定用途。
  対戦への実適用 (適用→対戦開始でボクセルキャラが動く) は実機確認推奨
  (ヘッドレスでファイル選択→適用→対戦の連鎖が自動化困難。createVoxelFighter 自体は
  プレビューで動作確認済み)。

## 2026-06-09 (5): スキン色 — 頂点カラー stride バグ修正

- (4) のテクスチャ対応後も「カラフルなGLBで色が出ない」報告。診断ログで原因特定:
  頂点カラー (ColorKind) を stride 4 固定で読んでいたが、glTF COLOR_0 が vec3 (stride 3)
  のモデル (qm_skinned 等 MagicaVoxel 由来) では範囲外読みで triColors が **NaN** になっていた。
- 修正: `getVertexBuffer(ColorKind).getSize()` で stride (3/4) を取得して indexing。
- 検証: qm_skinned_original.glb で triColors range 正常 (0.35〜0.97)、肌色の人型ボクセルが
  正しく表示 (skin-qm2.png)。診断ログは削除。typecheck 0。
- 教訓: 推測せず診断ログで NaN を実測して特定 ([[feedback_no_speculative_fixes]] 準拠)。

## 2026-06-09 (4): スキンの色反映 修正

- **問題**: ボクセルが白/グレーで元モデルの色が出ない。
- **原因**: importMesh がマテリアル単色 (albedoColor/diffuseColor) のみ参照。
  テクスチャでカラーを持つ GLB は albedoColor=白なので白くなっていた。
- **修正**: extractTriangleSoup を async 化し、三角形色を
  「頂点カラー(ColorKind平均) → テクスチャ(重心UVサンプリング、readPixels) →
  マテリアル単色 → グレー」の優先で決定。
- **検証**: crimson.glb (146,946三角形→4,068voxel) で直立人型 + 色付き表示を確認
  (skin-color.png)。Maskman の横倒しは Maskman 特有 (__root__ scaling.z=-1 のスキンメッシュ)
  で、一般 GLB (crimson) は素直に直立・有色で出ることも判明。
- autosample に URL 指定対応 (?autosample=/path.glb) を追加 (検証/共有用)。

## 2026-06-09 (2): Phase 7-1 ステータス振り分け

キャラクターエディットの機能1。進め方は「軽い順に1つずつ完成」(ユーザー決定)で、
ステータス→モーション→スキンの順。今回はステータスを対戦反映まで完成。

- `stats.ts` (新): 4ステータス (体力/攻撃/防御/機動) をポイント制 (各0..10、合計20固定)。
  スタイル別初期配分 (power=7/8/3/2、speed=3/3/4/10 等) + getStats/setStatsOverride
  (体格 getBody と同パターン)。効果: statMaxHp(100±8/Lv)、statDamageMul(±0.05)、
  statDefenseMul(防御高で被ダメ減)、statSpeedMul(±0.05)。
- `prefs.ts`: stats フィールド追加。applyBodyOverrides → applyOverrides に統合
  (体格+ステータス両方反映、旧名は別名で残す)。
- `Fighter.ts`: maxHp/damageMul/defenseMul/speedMul を applyStyle で getStats から計算。
  resetForRound で hp=maxHp、移動速度に speedMul。
- `FightGame.ts`: handleHit のダメージに attacker.damageMul × defender.defenseMul を乗算。
  FightHud に p1MaxHp/cpuMaxHp 追加。
- `ArenaView.tsx`: HP表記を「hp / maxHp」、バー割合を maxHp 基準に。
- `CharacterEdit.tsx`: サブタブ化 (体格/ステータス)。BodySection/StatsSection に分割。
  StatsSection=レベルバー+±ボタン+残ポイント+実効値プレビュー。?section= で初期サブタブ指定。
- 検証: typecheck OK。ステータスタブ描画 (tab-stats2.png)、対戦HUDで maxHp 反映確認
  (boxer 100/100, kicker 108/108 = stats-battle.png)。

## 2026-06-09: トップページ (左タブ3機能)

/fight を左タブ式トップページに再編。タブ: キャラクターエディット / 対戦モード / 設定。

### ファイル構成 (リファクタ)

- `ArenaView.tsx` (新): 旧 page.tsx の対戦画面本体を切り出し。props visible (非表示は
  display:none でエンジン維持→復帰時 resize) + onGameReady (FightGame を親へ)。
  main を 100vw/vh→100% に。init 前に prefs を反映。
- `prefs.ts` (新): localStorage 永続化 (key fight-prefs-v1)。bodies (体格上書き) /
  difficulty / showHitboxes。applyBodyOverrides で moves のオーバーライドへ反映。
- `CharacterEdit.tsx` (新): 4キャラの体格 (横幅/身長) スライダー + 矩形プレビュー +
  技サマリ。保存で savePrefs + applyBodyOverrides → 対戦の次の試合から反映。
- `Settings.tsx` (新): デフォルト難易度 + 判定表示。game prop で対戦中に即反映。
- `page.tsx` (作り直し): flex 左ナビ(132px) + コンテンツ。対戦は常時マウント
  (display 出し分け)、edit/settings は条件レンダリング。?tab= で初期タブ指定可。

### システム側の小改修

- moves.ts: getBody/setBodyOverride (体格オーバーライド)、styleMoveSummary
  (エディット表示用)。Fighter は STYLE_BODY 直参照→getBody 経由に。
- FightGame: public resize() / setDebugVisible() を追加 (タブ復帰・設定反映用)。

### 検証

- typecheck OK。3タブ全てヘッドレス描画確認
  (tab-edit / tab-settings / tab-battle.png)。体格プレビュー・難易度選択・
  キャラ選択が左ナビと共存して正常表示。


---

## 2026-06-09 (追記): スキン取り込みを段階式ボクセル化ウィザードへ刷新

Phase 7-3 の SkinEdit を「①ファイル選択 → ②生3D表示で確認 → ③現行格闘モデル(FAP
スケルトン)へ骨を合わせる → ④ボクセル化」の4段階フローに作り替えた (ユーザー要望)。
従来は選択即ボクセル化で、生データ確認や骨の重なり調整の段階が無かった。

### 位置合わせ数式の共通化 (src/fighting/voxelize)

- `alignSkeleton.ts` (新): createVoxelFighter のステップ3 (yaw→身長フィット→接地) を
  切り出し。`skeletonFitInfo(segments)` / `computeSkeletonFit(tris,info,opts)` /
  `applyFit` / `fitMeshToSkeleton`。一様スケールなので Babylon TransformNode
  (scaling/rotation.y/position) でそのまま再現でき、プレビューの見た目と最終
  ボクセル化が一致する。offsetY も正式パラメータ化。
- `createVoxelFighter.ts`: 自前の身長フィット計算を削除し alignSkeleton を使用
  (単一の真実)。挙動は不変。
- `voxelize/index.ts`: 上記をエクスポート追加。

### 表示メッシュ生成 (src/app/fight/importMesh.ts)

- `buildDisplayMesh(scene,tris,opts)` (新): TriangleMesh を確認用 Babylon メッシュへ。
  三角形カラーを出すため non-indexed 展開 + フラットシェーディング。色無し(FBX)は
  一様色。alpha 指定で半透明 (骨オーバーレイ用)。

### SkinEdit.tsx (全面書き換え)

- ステージ state 機械 (select/review/align/voxelize) + 上部ステップインジケータ。
- ②review: 生メッシュをそのまま表示 (原点寄せ + バウンディングでカメラ自動寄せ)。
- ③align: モデルGLBのみロード(アニメ不要=軽い)した FAP スケルトンの骨を
  CreateLineSystem(水色) + 関節スフィア(黄, インスタンス)で重ね描画。生モデルを
  半透明でラッパー配下に置き、向き/大きさ/上下/構え(none/tpose)で骨へ合わせる。
  yaw/scale/offsetY はラッパー変換のみ更新(再ロード無し)、fitPose 変更時のみ再ロード。
- ④voxelize: createVoxelFighter で③と同パラメータでボクセル化→rest プレビュー。
  解像度変更で再ボクセル化。スタイルへ適用 (skinStore に offsetY も保存)。
- 各ステージ遷移で表示物 (display/skeleton/boneVis/voxel) を破棄管理。

### 連動

- `skinStore.ts`: SkinConfig に offsetY? 追加。
- `Fighter.ts`: createVoxelFighter 呼び出しに offsetY を伝播。

### 検証

- `npx tsc --noEmit` クリーン。dev サーバで /fight?tab=edit&section=skin が
  ✓ Compiled / HTTP 200。クライアント実行(骨オーバーレイ等)はブラウザ確認が必要。

## 2026-06-09 (6): Phase 7-3b Mixamo 式マーカー関節合わせ

### 背景・方針

様々なポーズの取込モデルに対応するため、決め打ちポーズ(Tポーズ)依存をやめ、
ユーザーが少数マーカーで実関節を指定 → ゲーム骨(FAP)をその位置へ合わせる方式を実装
(Mixamo Auto-Rigger 参照)。角度逆算はしない: autoSkin はボーン線分への近接距離で
ウェイトを決め、applyJointMarkers は位置のみ合わせれば十分。角度逆算は rest roll 差
リターゲット問題(project_glb_orientation)を再導入するため不可。

### やったこと

1. **landmarkRig.ts (新)**: Mixamo 式10ランドマーク(あご/手首LR/肘LR/膝LR/股下/足首LR)
   → 全 FAP 関節を推定する純関数 `inferMarkersFromLandmarks`。確定ランドマークを端点に、
   間の未確定関節(Spine/Spine2/Neck/肩/UpLeg)を FAP 既定姿勢の弧長比率で比例補間
   (Spine→腕→脚 の順に解き、腕脚は起点 Spine2 を確定済みとして使う)。
   `landmarkDefaults` / `mirrorPlaneX` / `mirrorLandmark` / `LANDMARKS` / `MIRROR_PAIRS` も。
   voxelize/index で公開。
2. **createVoxelFighter**: メッシュの位置合わせ(computeSkeletonFit)を**マーカー適用の前**
   (fitPose 後)の preMarkerSegments で計算するよう順序変更。マーカーは「位置合わせ済み
   メッシュへスケルトン関節を寄せる」だけになり、マーカーでメッシュが再シフトしない
   (= SkinEdit プレビューと一致)。ウェイト用 segments はマーカー後に再取得。
3. **skinStore / Fighter**: SkinConfig に markers?: JointMarkers 追加、Fighter.load が
   createVoxelFighter へ伝播 (markers 指定時 keepPositionFor 自動でプロポーション維持)。
4. **SkinEdit.tsx**: stage3 内にマーカーモードを追加。
   - 「関節を合わせる」で入場 → 正面固定(alpha=+π/2)・自動回転停止。
   - 10個のドラッグ可能マーカー球(中央=橙/左=緑/右=桃)。dragPlaneNormal=Z で XY ドラッグ、
     確定時に Z 軸レイ(multiPickWithRay)でメッシュ表裏ヒット中点=手足中心を奥行きに自動採用。
   - 左右対称トグル(股下x=ミラー面)。ドラッグ中は推定全関節から骨線をライブ再描画。
   - リセット/完了。粗フィット(yaw/scale/offsetY/fitPose)変更時はマーカーをクリア(整合維持)。
   - buildVoxel/apply で markers を引き回し、skinStore に保存。

### 検証

- `npx tsc --noEmit` クリーン (EXIT=0)。
- クライアント実行(ドラッグ/奥行き推定/対称ミラー/再生のずれ)はブラウザ確認が必要。
- 注: プロジェクトに ESLint 設定ファイルが無く `next lint` は未セットアップ(初回プロンプト)。

### 追記: マーカーが「非常に合わせにくい」問題の操作方式改善

初回実装(固定world-XY平面ドラッグ + 離した瞬間に奥行きスナップ + 球が常に最前面)は
「マーカーが今どこにあるか分からず離すと飛ぶ」状態で合わせにくかった。操作方式を差し替え:
- PointerDragBehavior(固定平面)を廃止し、シーンの pointer observer で自前ドラッグ。
- 球を掴んでモデルをなぞると、カメラレイでモデルにヒットした**表裏中点(手足の中心)へ
  リアルタイムで吸い付く** (Vector3.Center)。どの視点からでも置け、離してもズレない。
- モデルから外れた間はカメラ正対平面へ投影して追従(掴み外し防止)。
- 入場時にモデルへカメラ寄せ(reframe)、球を一回り大きく。ドラッグ中のみカメラ回転を停止
  (detach/attachControl)、それ以外は視点回転可。
- landmarkRig/createVoxelFighter/skinStore/Fighter の配線・推定ロジックは不変。
- `npx tsc --noEmit` クリーン (EXIT=0)。実機ドラッグ感はブラウザ確認が必要。

## 2026-06-09 (7): Phase 7-4 マイキャラクター制リデザイン — 段階1 (データ模型+ストレージ層)

### 背景
「全4スタイル編集」をやめ、自分が作る最大3キャラのみを編集→保存→対戦で自キャラ使用
(相手は既存)へリデザイン。モードは 1対1/リーグ/トーナメント。保存は差し替え前提
(今はプロジェクト内ファイル、将来 DB へルート差し替え)。決定事項は workPlan.md 7-4。

### やったこと (段階1)
- `characterModel.ts` (新): CharacterRecord/CharacterMeta/SerializedCharacter 型 +
  TypedArray⇄base64 シリアライズ (三角形メッシュをbase64でJSONに載せる。変換はブラウザ側)。
  自キャラ = 自作スキン(triangles/markers/fit params) + 技スタイル + ステータス + 体格。
- `characterStore.ts` (新): client リポジトリ (list/get/save/delete + newCharacterId, MAX=3)。
  画面はこの抽象越しにのみ読み書き → 将来 DB 化は API 側のみ差し替え。
- `src/app/api/characters/route.ts` (新): GET 一覧(メタのみ) / POST 保存。
- `src/app/api/characters/[id]/route.ts` (新): GET 完全取得(meta+mesh結合) / DELETE。
  保存先 `data/characters/` (meta と mesh を別ファイル化、一覧はメタだけ読む)。.gitignore に /data/ 追加。

### 検証
- `npx tsc --noEmit` クリーン (EXIT=0)。
- dev サーバ(:3003)で API CRUD を実走: GET空→POST→GET一覧(meshなし)→GET個別(mesh有)→DELETE→GET空 を確認。
- 日本語名のUTF-8保持を確認 (ファイル直読で「スモーク太郎」。当初の文字化けは
  curl 引数のシェル encoding 由来で、API/fs は UTF-8 正しく保存)。

### 次 (段階2)
マイキャラエディタUI (3スロット管理 + 取込→ボーン→ボクセル→技/ステ/体格→保存)。
CharacterEdit の全スタイル編集UIを置換。

## 2026-06-09 (8): Phase 7-4 段階2 — マイキャラエディタUI

### やったこと
- `SkinEdit.tsx` を再利用可能に拡張: props `onApply(skin: CharacterSkin)` / `initialSkin` / `applyLabel`。
  - onApply 指定時は「マイキャラモード」: スタイル適用(skinStore)UIを隠し、完成スキンを親へ渡す
    単一ボタン「このスキンを使う」を出す。未指定なら従来のスタイル適用UI(後方互換)。
  - initialSkin で既存スキンを voxelize 段階から再編集 (loadInitialSkin)。
  - markers 参照を markersRef.current 一本化 (hasMarkers state の非同期ズレを回避)。
- `CharacterEdit.tsx` を全面置換 (旧「全4スタイル編集」→「マイキャラ最大3体」):
  - 一覧: 3スロット (埋まり=名前/スタイル/ファイル名+編集・削除、空き=「＋新規作成」)。
  - 編集フォーム: 名前 / 技スタイル(4種) / スキン(SkinEdit を全面表示して作成・調整) /
    ステータス振り分け(単体, 合計20) / 体格(横幅・身長)。保存(skin必須)/キャンセル。
  - characterStore 経由で list/get/save/delete。保存はプロジェクト内 data/characters/。
  - MotionEdit/per-style 編集は撤去 (将来必要なら別途)。

### 検証
- `npx tsc --noEmit` クリーン (EXIT=0)。
- dev サーバで /fight?tab=edit が ✓ Compiled / HTTP 200、/api/characters 200。
- 注: この段階では保存しても対戦には未反映 (Fighter は従来 skinStore 経由)。反映は段階3。
- 実機の取込→ボーン→ボクセル→保存フローと表示はブラウザ確認が望ましい。

### 次 (段階3)
対戦統合: キャラ選択で P1=自キャラ/相手=既存。1対1/リーグ/トーナメント。
FightGame にトーナメント進行追加 + リーグ5者対応。Fighter を CharacterRecord から構築。

## 2026-06-10: Phase 7-4 段階3a — 対戦統合 (1対1で自キャラ使用)

### やったこと
- `Fighter`: load を CharacterRecord 対応に。opts.character 指定時は
  見た目=record.skin のボクセル、技=record.style、ステータス/体格/表示名も record のもの。
  applyStyle に statsOverride/bodyOverride/displayNameOverride を追加 (未指定は従来 getStats/getBody)。
- `FightGame`:
  - preloaded アニメと clipSettings を dispose せず保持 (P1 再ロード用)。dispose で preloaded も破棄。
  - wireFighters() を切り出し。reloadFighters(p1Choice, cpuStyle): 両キャラを作り直す
    (CombatController に removeOpponent が無く片側差し替えだと相手に古い参照が残るため両方新規)。
  - startMatch を async + 新シグネチャ P1Choice (mine:record / style) へ変更。ロード中は loading HUD。
  - P1Choice 型を export。
- `ArenaView`: キャラ選択を刷新。P1=マイキャラ一覧(characterStore.listCharacters)+既存スタイル
  フォールバック、相手=既存スタイル。開始時に getCharacter で record を取得し startMatch。
  cvc トグルは選択画面から撤去 (Cキーは残存)。「タイプ別リーグ戦(既存4体)」は従来のまま。

### 検証
- `npx tsc --noEmit` クリーン (EXIT=0)。dev で /fight ✓ Compiled / HTTP 200。
- 実機の「マイキャラ選択→1対1で対戦」(ボクセル表示・操作・KO) はブラウザ確認が必要。

### 既知の暫定事項 (段階3bで対応)
- 既存「リーグ(B)」は従来どおり既存4体のみ。自キャラのリーグ/トーナメント参戦は 3b。
- 1対1で自キャラ使用後に B でリーグへ入ると、P1 が自キャラのメッシュ/ステータスのまま
  スタイルだけ既存に切替わる見た目/数値の不整合がある (クラッシュはしない)。3b で整理。

### 次 (段階3b)
リーグ/トーナメントの自キャラ参戦: 自キャラ+既存4体。プレイヤーの試合は描画、
それ以外の対戦は簡易自動判定。トーナメント進行とブラケットUIを追加。

## 2026-06-10 (2): マーカー関節合わせ「全く動かない」不具合の修正

### 症状
「関節を合わせる」でマーカー球をクリック/ドラッグしても全く動かない。
最終的に実行時エラー `Ray needs to be imported before as it contains a side-effect required by your code`。

### 根本原因 (2点)
1. 掴み判定が Babylon 既定 pick(pi.pickInfo) 依存だった。マーカー球は初期=FAP関節位置で
   半透明モデルの内側/奥にあり、モデルも pickable のため pick は手前のモデルを返し、
   球(lm_*)に当たらず activeDrag が立たない → 何も動かない。
2. depthAtXY を作り直した際に `import { Ray } from '@babylonjs/core/Culling/ray'` を削除。
   これは副作用 import で、scene.createPickingRay/multiPickWithRay を Scene に生やす。
   失ったため createPickingRay が実行時に例外 → ピッキング全滅。

### 修正
- 掴みを「モデル無視・ポインタのレイに最も近い球」方式へ (pickNearestMarker, 半径×2.4 許容)。
- 入力を scene.onPointerObservable/scene.pointerX 依存から、キャンバスの DOM ポインタ
  イベント(canvas相対座標)へ変更。move/up は window 受けでキャンバス外も追従。
  掴み中のみ cam.detachControl、離して再アタッチ。アンマウント/モード切替でリスナー解除。
- `import '@babylonjs/core/Culling/ray'` を副作用 import として復活 (Ray クラスは直接未使用)。

### 検証
- `npx tsc --noEmit` クリーン。実機ドラッグはブラウザ要確認。

## 2026-06-10 (3): 保存したマイキャラで対戦できない不具合の修正

### 原因
ArenaView のマイキャラ一覧読込 effect の依存が [hud.selecting] のみだった。
ArenaView はタブを跨いでもマウントされ続けるため、別タブ(エディット)でキャラを作成・保存して
対戦タブへ戻っても hud.selecting は変化せず、一覧が再読込されない → 選択画面に保存済みキャラが
出てこず選べない。

### 修正
- 一覧読込 effect の依存に visible を追加 (visible && hud.selecting で読込)。
  対戦タブ復帰時に必ず読み直す。選択中 id が消えていたら先頭へ。
- onStart に catch を追加し、getCharacter 失敗や startMatch 例外を選択画面に表示
  (これまで失敗が無言だったため、残課題の切り分けにも使える)。

### 検証
- `npx tsc --noEmit` クリーン。dev で /fight ✓ Compiled / HTTP 200。実機は要再確認。

## 2026-06-21: 技モーション編集 (フレームタイムライン) をマイキャラ編集に統合

workPlan Phase 7-2 (モーションカスタマイズ) を「マイキャラ制」に合わせて実装。
技ごとに発生/攻撃判定/硬直/CT/ダメージを編集し、格ゲー風のフレームタイムライン
(プログレスバー) で実フレーム数 (60fps 換算) を可視化する。方針はユーザー確認で
「実フレーム表示」+「マイキャラ編集内に統合」。

### やったこと
- `moves.ts`: `buildMoves(clips, style, radiusScale, overrides?)` に第4引数を追加。
  overrides 指定時 (= マイキャラの自己完結した上書き) はそれを使い、未指定なら従来の
  スタイル別グローバル上書き (getMoveOverride) を見る (後方互換)。
  `moveDisplayInfo(style, id)` を追加 (タイムライン用にクリップ名 + 無敵/アーマー区間 pct を返す)。
- `characterModel.ts`: CharacterRecord/CharacterMeta に `moves: Record<string, MoveOverride> | null`
  追加 + serialize/deserialize。moves は小さい JSON なのでメタ側に載る (API は素通しで保存)。
- `clipFrames.ts` (新): NullEngine 上にアニメ GLB を 1 回ロードしてクリップ名→
  {frames, fps} を取得しモジュールレベルでキャッシュ (3D 描画なし)。`toFrames60` で
  ネイティブフレーム→60fps 換算 (実時間に忠実)。
- `MotionEdit.tsx` (全面書き換え): props を `{ style, value, onChange }` の制御方式へ。
  6 技ごとにカード化 — フレームタイムライン (発生黄/持続赤/硬直青の積み上げ + 無敵水色/
  アーマー黄の細帯オーバーレイ) + 発生/持続/硬直/全体/CT/ダメの実フレーム表示 +
  スライダー (整合性: 発生≤判定終了≤硬直終了 を自動保持)。既定と異なる技だけ onChange で親へ。
- `Fighter.ts`: moveOverrides フィールド追加。applyStyle で buildMoves に伝播。
  load の character 分岐で record.moves を constructor overrides へ。
- `CharacterEdit.tsx`: EditDraft に moves 追加。編集フォームに「モーション (技)」セクション
  (MotionEdit を key={style} で表示)。スタイル変更時は技既定が変わるので moves をクリア。
  保存で rec.moves = (空でなければ draft.moves / 空なら null)。

### 検証
- `npx tsc --noEmit` クリーン (src 0 エラー。born-editer の既存エラーは別サブプロジェクト)。
- dev (:3007) で /fight?tab=edit ✓ Compiled / HTTP 200、アニメ GLB 200。
- ヘッドレス Chrome で tab=edit を描画 → マイキャラ一覧が JS クラッシュなく表示
  (MotionEdit モジュール = NullEngine import を含む の読込成功) を確認 (tmp/motion-tabedit.png)。
- **未検証 (要ブラウザ操作)**: 「新規作成」→「モーション(技)」を開いた先の、NullEngine
  ImportMeshAsync によるクリップ実長取得とタイムラインの実フレーム描画、保存→対戦反映。
  クリック操作を伴うためヘッドレス自動化できず。NullEngine + ImportMeshAsync は
  importMesh.ts と同じ glTF ローダ経路 (エンジンのみ NullEngine) だが実行確認は未。

## 2026-06-26: 技モーションの 3D 実演ビュー (編集画面に統合)

「エディットしたモーションがどうなるか同じ画面で実演したい」という要望に対応。
MotionEdit の各技に 3D 実演を組み込み、編集値で技を繰り返し再生して発生→判定→硬直を
リアルタイム可視化する。表示方式=3D再生 / animSpeed も編集対象に追加 (ユーザー確認)。

### 設計上の前提 (実装前にユーザーへ明示)
- 発生/判定終了/硬直終了/CT は「クリップ内で判定が出るフレーム窓・動けない長さ」を
  変えるもので、クリップの体の動き自体 (キーフレーム) は変わらない。
- 体の見た目スピードを変えるのは animSpeed (再生速度)。今回 MotionEdit に追加。

### やったこと
- `moves.ts`: `MoveOverride` に `animSpeed?` を追加。`buildMoves` が
  `ov?.animSpeed ?? spec.animSpeed ?? 1` で展開、`defaultMoveParams` も animSpeed を返す。
  → 保存 (CharacterRecord.moves は素通しシリアライズ) → 対戦反映まで配線済み。
- `MotionPreview.tsx` (新): 編集画面内の 3D 実演ビュー。
  - `CombatController.playMove` で技をループ再生し、`getStatus().phase` を毎フレーム読み
    発生(黄)/判定中(赤)/硬直(青) をタイムライン+プレイヘッド (DOM 直更新で再描画回避) で表示。
  - 判定中は `setDebugVisible(true)` で active hitbox の赤球を 3D 表示。
  - animSpeed を再生全体へ適用 (combat が active 移行で speedRatio=1 に戻すため毎フレーム再適用)。
  - 待機↔技をループ。CT 明け + 小休止で再生し直す。overrides はループ各再生で読み直し。
  - **スキン分岐**: skin があれば `createVoxelFighter` で自分のボクセルキャラ、
    無ければ `loadFightingCharacter` で仮モデル (Maskman)。ヘッダに「マイキャラ/仮モデル」バッジ。
    → スキン未設定でも実演で確認できる (ユーザー要望)。
- `MotionEdit.tsx`: 各技カードに「▶ 実演」ボタン + 速度(animSpeed)スライダー。
  実演ボタンで上部に 3D ビューを遅延マウント (重いので初回クリックまで生成しない)。
  「実演を閉じる」で破棄。MoveParams/defaults/isDiff/toOverrides に animSpeed を反映。
  `skin` prop を受けて MotionPreview へ伝播。
- `CharacterEdit.tsx`: `MotionEdit` に `skin={draft.skin}` を渡す。

### 検証
- `npx tsc --noEmit`: src 0 エラー (born-editer は既知の別サブプロジェクト)。
- dev (:3021) で /fight?tab=edit ✓ Compiled / HTTP 200。MotionPreview モジュール
  (createVoxelFighter/loadFightingCharacter/CombatController 含む) の読込でクラッシュ無し。
- **未検証 (要ブラウザ操作)**: 「実演」クリック→モデルロード→技再生→プレイヘッド/赤hitbox、
  animSpeed の見た目変化、スキン有り時のボクセル実演。ヘッドレスで連鎖自動化できず。
  ロード経路 (loadFightingCharacter/createVoxelFighter + animGlbPaths) は Fighter.load と同一。
