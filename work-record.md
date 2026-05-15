# 作業記録 (Work Record)

---

## 2026-03-30

- コード作成ルールを策定・メモリに保存
  - 再修正時は前回の修正を全て元に戻してからやり直す
  - workPlan.md に沿って作業し、将来の実装予定を考慮してコードを作成する
  - 作業内容を work-record.md に記録する
  - 媚びる返答NG、不明な点は率直に伝える
- workPlan.md、work-record.md を新規作成
- 現在の weapon-combat 実装を全面調査
  - IK、BodyMotion、力伝達、バランス、AI状態マシン、歩行ステッピング等の全体構造を把握
- 「目的 + 制約 → 最適解」ベースの自動モーション計算システムの設計を策定
- workPlan.md を Phase 1〜4 の段階的計画として更新
  - Phase 1: 構えの自動計算（目的関数5種 + 制約5種、球面探索アルゴリズム）
  - Phase 2: 攻撃モーションの自動計算（swing-presets.ts のプリセット廃止）
  - Phase 3: 移動の物理ベース化
  - Phase 4: クリーンアップ
- workPlan.md を更新: 行動意図の細分化と構えの微調整設計を追加
  - AttackIntent: damage / disrupt / pressure / setup / punish / finisher の6種
  - StanceIntent: aggressive / defensive / neutral / recovery の4種
  - 構え: 3基本構え（上段/中段/下段）をソルバーが計算 + 戦況で微調整
- workPlan.md に運動連鎖モデル (Kinetic Chain) を追加
  - 原則: 中心始動、末端起点でも中心が先行、中心連動ほど力モーメント大
  - KineticChainProfile: 各関節の遅延・回転量・ピーク時刻を定義
  - lerpBody → lerpBodyChained: 関節ごとの遅延進行度で補間
  - AttackIntent連動: damage/finisher=体幹大・遅い、pressure/punish=末端中心・速い
- workPlan.md にダメージモデルを追加
  - 新モデル: impactEnergy = weaponKineticEnergy × forceChainMultiplier × weaponMomentum
  - 武器が重い・先端速度が速い・体幹連動が大きい → ダメージ増
  - 手首だけで振る → 速いが弱い。全身連動 → 遅いが強い
  - physics.ts, swing-attack.ts のダメージ計算を改修予定
- Phase 1 実装開始: weapon-combat-v2 ブランチ作成
  - solver/types.ts 作成 (AttackIntent 6種, StanceIntent 4種, StanceLevel, SolverCache 等)
  - solver/constraints.ts 作成 (手首トルク制限, 腕リーチ, 自己貫通, 背中側, バランス)
  - solver/objectives.ts 作成 (攻撃準備性, 防御カバー, 威圧度, バランス, 力伝達, 相手対応, 遷移性)
  - solver/combat-context.ts 作成 (戦況コンテキスト構築, StanceIntent/AttackIntent 決定)
  - solver/stance-solver.ts 作成 (球面探索144×3点, 制約フィルタ, 3基本構え計算, 動的微調整)
  - solver/precompute.ts 作成 (キャッシュ管理)
  - weapon/stance.ts 修正 (ソルバー結果優先, 旧プリセットはフォールバック)
  - weapon/equip.ts 修正 (装備時にソルバーキャッシュ初期化, 解除時にクリア)
  - ai/decide.ts 修正 (Decision に attackIntent, stanceIntent を追加)
  - TypeScript 型チェック通過
- 動作確認: 構えは変わっているが武器の向きに問題あり
  - 問題: 親指が下向き・武器も下向きの構えになる。イメージは親指が上・武器先端が手より上
  - 原因: stance-solver.ts の createCandidate() の weaponDir 計算が Down() 成分過多
  - 関節可動域の制限自体は変えず、weaponDir の計算ロジックの修正が必要
  - 試行: weaponDir の計算式を Down→Up ベースに変更 → 効果なし（見た目変化なし）
  - 考察: weaponDir の変更だけでは構えの見た目が変わらない。
    武器の最終的な向きは equip.ts の setWeaponDirection() が制御しており、
    ソルバーの weaponDir はそこに渡されるが、IKの手の回転やアタッチメントの
    回転との相互作用で最終結果が決まる。weaponDir 単体の修正では不十分。
    次回は setWeaponDirection() や weaponAttachR の回転との関係を調査する必要がある。
  - 修正は破棄済み

---

## 2026-04-01 〜 2026-04-02

### 構え自動計算 (Phase 1 続き)
- solver の weaponDir 計算式を修正 (Down 成分除去 → dir×0.4 + facing×0.6)
- 動的微調整 (selectDynamicStance) を AI dispatch に接続 → 毎フレーム再スコアリングで不安定になったため一旦無効化
- reconstructStance() を追加: キャッシュ済み候補の theta/phi/reachRatio から現在の肩位置で毎フレーム再計算
- IK 到達性検証 (validateWithIK) を precomputeStances に追加: IK + clamp 後の手の位置が意図した位置から 5cm 以上ズレる候補を棄却
- 手首トルク制約を制約チェックから除去 (構えの高さは戦術意図で決まるべき)

### 方向の問題
- getCharacterDirections の forward は Cross(charRight, Up) で既にキャラの視覚的な前方
- 複数箇所で forward.scale(-1) と誤って反転していた → stance.ts, attack-swing.ts, wrist-control.ts, stance-solver.ts, combat-context.ts から反転を除去
- ただし stance.ts のフォールバックの forward は元々反転が必要だった可能性あり → 要検証

### IK・関節制限の構造問題
- JOINT_LIMITS (types.ts) と JOINT_CONFIG (joints.ts) の二重定義を発見 → clampJointAngles を JOINT_CONFIG に統一
- getBoneBaseRot が初回呼び出し時の回転をキャプチャする方式 → ikBaseRotations から正確な T-pose を参照する方式に変更
- **重大なバグ発見**: allBones のキー (mixamorig:RightArm) と bone.name (f1_mixamorig:RightArm) が不一致
  - ikBaseRotations は bone.name (プレフィックス付き) で保存
  - getBoneBaseRot は allBones のキー (プレフィックスなし) で検索
  - → clampBone3Axis が常に null を返し、**3軸関節制限が一度も実行されていなかった**
  - getBoneBaseRot を修正して bone.name 経由で検索するよう変更 → クランプが有効になった
  - ただし有効化により左手が上がる副作用 (Z軸制限 -45° で腕を下ろしきれない) → **修正を一旦リバート**
  - 根本修正には Z 軸制限値の調整が必要

### enforceMotionRateLimit の問題
- IK + clamp の後にレート制限が実行され、クランプ結果を上書きしていた
- 腕・肩・手のボーンをレート制限から除外

### 攻撃モーション
- ボディモーション (SWING_PRESETS) を有効化 (neutralBody() で無効化されていた)
- 縦振りの IK ターゲット: 振りかぶりは頭上後方、振り下ろしは前方下方に設定
- 振りかぶりの easing を ease-out (素早く上げて頂点で減速)、振り下ろしを t(2-t) (最初から速い) に変更
- 振りかぶり 60% / 振り下ろし 40% の時間配分
- computeForceMultiplier (fm) による body motion 減衰を除去
- 背中側 IK ターゲット押し出しをスイング中スキップ
- 自己衝突チェックをスイング中スキップ
- ヒット判定: Strike フェーズ 20% 以降から開始、ヒットしてもモーション継続 (振り抜く)
- ダメージ計算: power×5+5 → power×1+1.5 に調整
- 攻撃タイプを縦振り固定、パワー 100% 固定、コンボ 1 回固定 (テスト用)

### 手首回転・武器慣性
- wrist-control.ts を新規作成
- 振りかぶり時: 武器先端を上方+背中側に向ける
- 振り下ろし時: 武器先端を前方下方に向ける (慣性で遅延追従)
- 手首の関節制限 (±55°/±30°/±30°) 内に収まる範囲のみ適用
- Hand ボーンのベース回転を create.ts に保存追加

### ガード
- guard.ts を書き直し: 相手の武器先端を追跡し、その軌道上に武器を配置
- checkWeaponBlock: 攻撃者の武器先端と防御者の武器ライン (grip→tip) の最短距離でブロック判定
- swing-attack.ts: 体へのヒット前に武器ブロックをチェック、ブロック時はダメージ大幅軽減
- CombatAI に defenseOnly フラグ追加、赤キャラを防御専用に設定
- decide.ts に防御専用モードのステート遷移追加 (ガードのみに固定)

### 髪・その他
- attach-vox-hair.ts: 前後反転修正 (mesh.rotation.y = Math.PI)、headTopRatio パラメータ追加
- 髪の呼び出しを page.tsx から削除 (不要)
- resetSpineGradual を削除 → スイング後にのみ復活
- havok-test: Joint ROM Test セクション追加、カメラ向き修正
- Shoulder ボーンのベース回転を create.ts に保存追加

### 未解決の問題
- **3軸関節制限のキー不一致**: getBoneBaseRot の修正をリバート済み。有効化すると Z 軸制限 -45° で腕が下ろせなくなる。制限値の調整と合わせて再修正が必要
- 左右ボーンの軸方向反転: 左右で同じ制限値を適用しているが、ミラーされたボーンでは軸の符号が逆の可能性あり → ROM テストで要検証
- 構えの前後方向: stance.ts フォールバックの facing 方向が正しいか要検証

---

## 2026-05-16

### Unity Uub (Human Basic Motions) Babylon.js 移植 - MVP 完成

Unity プロジェクト `C:\Users\user\My project` の Kevin Iglesias アセット解析、および Babylon.js での再現 Phase 1 (MVP) 完了。

**新ブランチ**: `unity-uub-demo` (weapon-combat-v2 から派生)

**新規ファイル**:
- `uub-demo-plan.md` — 6 Phase の移植計画
- `scripts/extract-uub.mjs` — FBX → bone-data.json / motion.json 変換スクリプト（Kevin Iglesias リグ対応、汎用化）
- `src/app/learning/uub-demo/page.tsx` — Babylon.js ビューア（球+線でスケルトン表示、アイドルアニメ再生）
- `public/uub/` — オリジナル FBX 配置（.gitignore 対象）
- `public/uub-data/` — 変換済み JSON

**.gitignore**: `public/uub/` 追加（Kevin Iglesias FREE はライセンス不明のため Git 管理外）

**今回ハマったポイント**:
- **PreRotation の二重適用**: motion FBX では PreRotation が Lcl Rotation に焼き込まれている（=0）のに、bone-data FBX 由来の PreRotation を毎フレーム掛けて二重回転していた。「足が上を向く・手が後ろ」現象の原因。再生時は `preRotQuat = Identity` で対応
- **座標系**: Babylon デフォルトの LH と FBX RH の利き手変換でバグりやすかったが、`scene.useRightHandedSystem = true` で RH モードにすることで FBX データを変換なしで使えるようにした（Z 反転や Quaternion mirror が不要に）
- **抽出スクリプトのバグ**: motion mode で不要な worldPosition 計算がボーン順序エラーで落ちていた → bones mode 専用処理に分離 + 深さ順ソート追加

**Unity アセット解析サマリ**:
- HumanM/F リグ: 56 ボーン (Generic Rig, "B-" プレフィックス, 独自命名)
- アニメ 86 クリップ (Idle/Movement/Social, RootMotion 版あり)
- Animator: 2 レイヤー (Base / Upper + Mask), Trigger `ClearUpper`
- 特殊機構: `B-spineProxy` (上半身レイヤー再生時の背骨補正)
- HumanM は Y-up, HumanF は **Z-up** で座標系が異なる

### Phase 2 完成: 複数アニメ + 切替UI

**追加アセット**: Idle02, Idle01-Idle02 (遷移), Walk_Forward, Run_Forward, Sprint_Forward, Jump01 の6本

**追加機能**:
- 右上にカテゴリ別アニメ選択UI (Idle / Movement)
- アニメは初回クリック時に遅延ロード + キャッシュ
- 切替時に frame カウンタを 0 にリセット
- React の useRef でモーションデータを保持し、Babylon の render observer から参照

### Phase 3 完成: 2 レイヤー + Avatar Mask 移植

**新規ファイル**:
- `scripts/extract-mask.mjs` — Unity .mask YAML → {boneName: weight} JSON
- `public/uub-data/masks/upper.json` — Human Body Upper Mask (48 enabled / 8 disabled bones)

**機能**:
- Base + Upper 別々のアニメ選択
- Avatar Mask に基づくボーンごとミキシング: weight>0 なら Upper, 否なら Base
- Base/Upper は独立タイマーで進行 (フレームレート違いを許容)
- Upper有効ボーンは青色表示 (Color-code mask トグル)

### Phase 4 完成: SpineProxy 機構移植

**実装**:
- T-pose 時に bone-data preRotation チェーンで B-spine / B-spineProxy のワールド回転を計算
- rotationOffset = inverse(restProxyRot) × restSpineRot
- 毎フレーム最終段で B-spine.worldRot を B-spineProxy.worldRot × rotationOffset で上書き
- B-spine 子孫 (chest, neck, head, arms, hands) を再計算

**ハマったポイント**: 標準 Upper Mask + Kevin Iglesias 標準アニメだと **B-spine と B-spineProxy のワールド回転が完全一致するよう調整されている**ため、SpineProxy ON/OFF で差が見えない (数値検証で確認: 全フレームで diff 0.00°)。
→ カスタムマスクモード (B-spine をマスクから除外) を追加。Base=Walk, Upper=Idle02 + Spine⤖Base + SpineProxy ON/OFF で姿勢の違いが視覚化されるようにした。

### Phase 5 完成: 床トレッドミル + ブロブ影 + カメラ制御

**追加アセット**: Walk/Run/Sprint/Jump の RM 版 4本を追加コピー & 抽出

**機能**:
- 床: DynamicTexture でグリッド模様を描画。RM アニメ再生時に B-root.localPosition の delta から UV offset を加算 → 床がスクロール
- キャラ位置を強制的に原点固定 (B-root の localPosition を 0 に上書き)
- ブロブ影: 半透明 Plane を Disc 形状で描画。両足距離からスケール、root.y でアルファ/スケール補間 (ジャンプ高 1m で薄く広がる)
- カメラ: ボタン押下中に alpha を変化させる回転、ボタンクリックで FOV ズーム

**実装の注意**:
- Babylon の Plane を床に水平にするには `rotation.x = Math.PI / 2`
- ループ境界でアニメが先頭に戻る瞬間の delta が大きくなるので、閾値 0.3m で異常値検出してスキップ

### HumanF (♀) 追加 + キャラ切替対応

**新規アセット**: HumanF_Model.fbx + Idle01/Idle02/Walk_Forward/[RM版]/Run_Forward[RM]/Jump01

**実装**:
- CHARACTERS 配列に humanM/humanF を定義、ANIMATIONS に character フィールド追加
- characterIdx ステート、scene init effect の依存に追加 → 切替時にシーン再構築
- キャラ切替時に baseAnimIdx/upperAnimIdx を新キャラ用に自動切替 (同名 label を優先)
- 右上アニメリストを current character でフィルタ

**Z-up問題の調査結果**:
- HumanF の FBX は GlobalSettings.upAxis=2 (Z-up) と記録されているが、
  実データ (localPosition) は Y-up と同等の配置 (B-hips Y=96.77cm)
- preRotation 全て 0、motion 側で全姿勢が baked in
- **特別な軸補正は不要** で HumanM と同じパイプラインで動作

### 実メッシュ表示 (スキニングメッシュ) 完成

**新規ファイル**:
- `public/uub-data/mesh-humanM.json` (4.7MB) — 31932 verts, 10644 tris
- `public/uub-data/mesh-humanF.json` (3.1MB) — 31998 verts, 10666 tris
- `extract-uub.mjs` に mesh モード追加 — FBX Geometry + Deformer から頂点・法線・スキンウェイト・bind matrix を JSON 化

**実装**:
- ShaderMaterial + Custom GLSL Vertex/Fragment Shader (Effect.ShadersStore に登録)
- 56 ボーン分の skinMatrix (= inverseBind × currentWorld) を Matrix[] で uniform 送信
- 毎フレーム `multiplyToRef` で in-place 計算
- スティック (球+線) と メッシュ の切替UI

**ハマったポイント**:
1. `setMatrices` は `Matrix[]` 必須 (`Float32Array` を渡すと内部で `matrix.copyToArray` を呼ぼうとして数値 → 関数なし エラー)
2. **HumanF の bind matrix だけ Z-up 座標で記録されていた**:
   - メッシュ頂点・motion: Y-up (bbox Y=0..176cm)
   - TransformLink: Z-up (B-hips translation Z=96.77 が高さ、回転部分も Y/Z 入替)
   - bind matrix にだけ `R_x(-90°)` (Z-up→Y-up) を右から掛けて軸統一
3. 行列の利き手・convention:
   - Babylon: row-major 格納 + row-vector convention (`v_row * M`)
   - GLSL: column-major 格納 + column-vector convention (`M * v_col`)
   - Babylon m[] を直接 GLSL に渡すと自動的に転置されて両 convention で同じ幾何変換になる → 転置不要
   - 合成順序: skinMatrix = inverseBind × currentWorld (頂点 bind world → bone local → current world)

### Phase 6 完成: フォルダ階層UI (drill-down ナビ)

**実装**:
- ANIMATIONS の各エントリに `folderPath` 追加 (例: 'Idles', 'Movement/Walk/RootMotion')
- `browseFolder(folder, anims)` で現在パス直下のサブフォルダ + 直下アニメを取得
- Base/Upper 各々が独立した `currentFolder` ステートを持ち drill-down 可能
- 📁 アイコン + パンくず表示 + ← Back ボタン
- キャラ切替時にフォルダパスをルートにリセット

### 全 Phase 完成 (Unity Uub → Babylon.js 移植)
1. ✅ Phase 1 (MVP): 表示 + 単一アニメ再生
2. ✅ Phase 2: 複数アニメ読込 + 切替
3. ✅ Phase 3: 2 レイヤー + Avatar Mask
4. ✅ Phase 4: SpineProxy 機構
5. ✅ Phase 5: 床トレッドミル + ブロブ影 + カメラ
6. ✅ HumanF (Z-up 問題) + キャラ切替
7. ✅ 実メッシュ表示 (スキニング、Custom GLSL Shader)
8. ✅ Phase 6: フォルダ階層UI
9. ✅ 全アニメ拡充 (118 本: HumanM 全 + HumanF 全 + Masked Poses)
   - scripts/import-all-anims.mjs で一括 copy/extract/manifest 生成
   - public/uub-data/animations-manifest.json から動的ロード
