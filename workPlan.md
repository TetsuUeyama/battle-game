# battle-game 作業計画

## 現在の作業: fightingGamesystem を使った 3D 対戦アクションゲーム (`/fight`)

`game-assets/fightingGamesystem`（FAP × Babylon.js 格闘ゲームシステム配布物）を使用して、
プレイヤー(キーボード操作) vs CPU の 3D 対戦アクションゲームを実装する。

### 構成方針

- **ランタイム**: `fightingGamesystem/runtime` を `src/fighting/` へコピーして参照する。
  - 理由: battle-game の dev は `next dev --turbopack` であり、プロジェクト外ソースの
    tsconfig paths 参照は Turbopack で不安定なため、README 記載の「コピー利用」を採用。
  - 更新時は再コピー:
    `robocopy C:\Users\user\developsecond\game-assets\fightingGamesystem\runtime .\src\fighting /MIR`
- **アセット**: コピーしない。既存の `/api/game-assets/[...path]` ルートで
  `game-assets/fightingGamesystem/assets/` を直接 HTTP 配信する
  (`baseUrl = "/api/game-assets/fightingGamesystem/assets/"`)。
- **使用 API**: feature1 `loadFightingCharacter` / feature3 `CombatController` /
  feature2 `PoseLayerController` / `loadClipSettings`。
- **ゲーム層** (`src/app/fight/`): 移動・向き・ガード・ヒットリアクション・HP・ラウンド管理は
  fightingGamesystem に存在しないため、ゲーム側で実装する。
  不足機能は `fightingGamesystem/MISSING.md` に記録する。
- **2026-06-05 改修追従済み**: MISSING.md A-2/5/6/7/8/10, C-1/2 がシステム側で対応された。
  /fight は forceCancel / fadeSec クロスフェード / 部位・方向別やられ / preloadAnimations
  共有バインド / onProgress 進捗表示へ移行済み。
- **2026-06-06 改修追従済み**: A-11 (PoseLayer累積) 修正→KO回避策撤去、
  A-9 resolvePush PushTarget化→自前separate()撤去、feature5 emotion 統合
  (スタイル別性格 / startupSpeedRatio / 感情HUD / Zone・Fearリング発光)。

### 実装内容 (`/fight`)

- Maskman 同士の 1v1。P1=キーボード、P2=CPU。
- アニメ GLB: kb_movement / kb_punches / kb_kicks / kb_hits / kb_kos / kb_blocks。
- 技: jab / straight(OneTwo) / hook / uppercut / midKick / highKick。
  フレームデータはクリップ実長から比率で生成 (調整値)。
- ラウンド制 (60秒 / 2 本先取)、HP バー、ヒットスパーク、hitbox デバッグ表示 (Hキー)。

### 実装計画: モーションエディット (2026-06-05 計画、未着手)

優先順に Phase 分け。Phase 1〜3 は battle-game 内で完結、Phase 4 は Blender 作業を含む。

**Phase 1: 技属性の拡張 (MoveSpec) — ✅ 完了 (2026-06-05)**
- `animSpeed` / `invulnPct` / `armorPct` を MoveSpec に追加 (GameMove へ展開)。
- ヒットストップ実装 (強度別 0.06〜0.13s、ガード時 0.04s。先行入力1つ保持)。
- タイプ個性: boxer=アッパー出始め無敵+速ジャブ、kicker=上段回し蹴り高速、
  power=剛アッパー/かかと落としにスーパーアーマー、speed=全体高速+ラビット出始め無敵。

**Phase 2: ロード時キーフレーム加工 (リタイム)**
- `Animation.getKeys()/setKeys()` で技クリップを加工し、
  「発生を早くしたら見た目も追従」を実現 (前半圧縮・ヒット後間引き)。
- 将来: 左右ミラー生成 (R技→L技)、振り角スケール。

**Phase 3: 時間変化ポーズレイヤー (軌道の味付け)**
- PoseLayerController を「技の進行率に応じた可変オフセット」へ拡張し、
  パンチ/キックの高さ・角度をキャラ個性として変える。

**Phase 4: 外部モーション取り込み (Mixamo / 他アセット)**
- 推奨経路 (オフライン):
  1. Mixamo FBX をダウンロード (**In Place 必須** — 現行ゲームは in-place 前提)
  2. `scripts/blender/retarget_mixamo.py` のターゲットリグ定義を FAP/Maskman 用に適応
     (rest roll 差補正 C=restS⁻¹@restT は実装済み。Maskman の rest を解析して定義追加)
  3. Maskman と同名ボーンの GLB として出力
  4. `moves.ts` の ANIM_GLB_PATHS に追加 (preloadAnimations が自動ロード)
  5. MoveSpec 1 エントリ追加で技化 (クリップ長比方式なので任意の長さ/FPS で動く)。
     ロコモーション/やられ/勝利ポーズはクリップ名差し替えのみ
- 簡易経路 (ランタイム検証用): BindingProfile
  (sourceToStandard=avatar/presets/mixamo.json + targetToStandard=maskman
  bone-mapping.json の標準名ブリッジ) で直接リターゲット。
  rest ポーズ差で手足の向きが破綻するリスクあり、品質確認のみに使う。
- 注意: FAP はファイティングスタンス基準のため棒立ち開始の Mixamo モーションは
  継ぎ目が目立つ (クロスフェードで緩和)。ボーン不足カーブは自動で捨てられるので可。
- Unity Humanoid 系アセットパックは motion-editor 側 unity-import が正規ルート。

**Phase 5: 格闘ゲーム要素の拡張**

*5a. アセットが揃っており、ゲーム層実装のみで可能 (優先)*
- **飛び道具**: モーションは kb_specials.glb に有り
  (KB_Projectile_1〜5/Up, KB_EyeLasers, KB_Superpunch 等。現在未ロード)。
  ゲーム層に弾エンティティ (発射フレームで手ボーン位置にスポーン→直進→
  相手胴体ボーンとの距離判定→ヒット処理) と弾の見た目 (球+グロー/パーティクル) を追加。
- **ジャンプ + 空中攻撃**: kb_jumping.glb に有り (KB_Jump_Start/Loop/Land,
  KB_JumpPunch, KB_JumpKick_Loop 等)。root が in-place のため放物線は
  ゲーム側物理 (jumpsquat→空中→着地の状態追加、空中専用 MoveSpec)。
- **しゃがみ + 下段/中段**: kb_crouched.glb に一式有り (しゃがみ移動/攻撃/
  ガード/やられ)。立ち/しゃがみガードと上段/下段のガード方向相性を導入。
- **ダッシュ/バックステップ**: KB_SkipFwd/Bwd_1,2。回避: KB_Dodge_L/R。
- **ダウン/起き上がり**: kb_kos (倒れ) + kb_lay (寝モーション) + KB_GetUp* (起き上がり4種) +
  KB_HitOnGround* (ダウン追撃やられ) + KB_GroundAttack (ダウン攻撃)。
  KO 演出強化・ハードノックダウン・起き攻めの土台になる。

*5b. システム拡張が必要 (中工数)*
- **簡易投げ**: 掴み判定 (至近距離+ガード不能) 成立→両者の位置/向きをスナップ→
  攻め側は既存モーション流用 (KB_m_Backelbow 等)、受け側は KB_*KO / Hit_Stagger 流用で
  「掴んで投げ飛ばす風」を合成。対モーション無しでも成立する範囲で実装。
- **ゲージ/超必殺**: ヒット/被弾でゲージ増加→消費で KB_Superpunch / KB_EyeLasers。
- **ガードクラッシュ**: ガード耐久値の追加。

*5c. アセット制作が必要 (難・保留)*
- **本格的な投げ/関節技の対モーション**: FAP/Mixamo に攻め受けが同期した
  ペアモーションがほぼ無い。Blender で対ポーズ自作 or 外部アセット調達が前提
  (MISSING.md B-1)。簡易投げ (5b) で代替しつつ将来検討。

### Phase 7: キャラクターエディット 3 機能 (2026-06-09〜)

進め方: 軽い順に1つずつ対戦反映まで完成 (ユーザー決定)。

**7-1. ステータス振り分け (着手中)**
- 4 ステータス: 体力(最大HP) / 攻撃(与ダメ) / 防御(被ダメ軽減) / 機動(移動速度)。
- ポイント制 (各 0..10、合計 20 固定)。スタイル別の初期配分で個性。
- stats.ts に基準値・効果計算・オーバーライド機構 (体格 getBody と同パターン)。
- Fighter が maxHp/damageMul/defenseMul/speedMul を持ち対戦に反映。HUD は HP/maxHP。
- prefs に保存、CharacterEdit にサブタブ「ステータス」を追加。

**7-2. モーションカスタマイズ ✅ 実装 (2026-06-21) — マイキャラ制へ統合**
- 技ごとに 発生/判定終了/硬直終了/クールタイム/ダメージ を編集。格ゲー風の
  フレームタイムライン (プログレスバー) で実フレーム数 (60fps 換算) + 無敵/アーマー区間を可視化。
- buildMoves に overrides 引数を追加 (マイキャラは自己完結した上書きを使用)。
  保存はキャラ単位 (CharacterRecord.moves)。CharacterEdit の編集フォーム内 (サブタブではなく
  「モーション(技)」セクション) に統合。clipFrames.ts (NullEngine) でクリップ実長を取得。
- 残: ブラウザでのタイムライン実描画・保存→対戦反映の実機確認 (work-record 2026-06-21)。

**7-3. スキン (ボクセル化) ✅ 完了 (2026-06-09) → 段階式へ刷新 (2026-06-09)**
- voxelize を src/fighting へ再同期済み (Babylon のみ依存、three 不要)。
- importMesh.ts: GLB は Babylon ImportMeshAsync で頂点抽出、FBX は fbx-parser で
  Geometry の Vertices/PolygonVertexIndex を三角形化。LOD1+ は除外。
  + buildDisplayMesh で TriangleMesh を確認用メッシュ化 (三角形カラー/半透明)。
- skinStore.ts: style→スキン (triangles+位置合わせ params, offsetY 含む) のメモリ保持。
- alignSkeleton.ts (新): 位置合わせ数式 (yaw→身長フィット→接地) を共通化。
  プレビューのノード変換と最終ボクセル化が一致 (computeSkeletonFit/applyFit)。
  createVoxelFighter は自前計算を廃しこれを使用。
- SkinEdit.tsx: 4段階ウィザード ①選択 →②生3D表示で確認 →③FAP骨を重ねて
  向き/大きさ/上下/構えで合わせる →④ボクセル化→プレビュー→適用。
- Fighter.load: getSkin があれば createVoxelFighter、無ければ従来ロード (分岐)。
- 注: 推奨は直立/Tポーズの静止モデル。スキン済みアニメ GLB は bind 空間ズレで崩れる。
- 残: スキンの永続化 (現状メモリのみ。IndexedDB 化は将来)。

**7-3b. Mixamo 式マーカー関節合わせ (2026-06-09 計画、着手)**
- 目的: 様々なポーズの取込モデルでも、初期ポーズをゲーム骨(FAP)へ揃えモーションのずれを無くす。
  決め打ちポーズ(Tポーズ等)に依存せず、ユーザーが少数マーカーで実関節を指定する方式。
- 参照: Mixamo Auto-Rigger (正面ビューで少数ランドマークをドラッグ→全身骨を推定)。
- 方針 (角度逆算はしない): autoSkin はボーン線分への近接距離だけでウェイトを決め、
  applyJointMarkers は位置(setAbsolutePosition)だけ合わせる。角度逆算は rest roll 差
  リターゲットを再導入するため不可 (project_glb_orientation 参照)。
- **訂正 (2026-07-05)**: 「位置合わせのみでモーションも崩れない」は誤りだった。
  マーカーはローカルオフセットの方向も取込ポーズへ書き換えるが、FAP クリップの
  回転カーブは Maskman rest の骨方向を前提とするため、マーカー姿勢のまま再生すると
  全モーションが (取込ポーズ − rest) 分恒常的にずれる (ヘッドレス実測で上腕38°)。
  正しくは「マーカー = バインド (ウェイト+invRest) 専用ポーズ」であり、バインド後に
  restorePlaybackPose で回転=元rest / 位置=元方向×マーカー長 へ正規化してから再生する
  (createVoxelFighter が自動で実施)。マーカーから残るのは骨長 (プロポーション) のみで、
  モーションは Maskman と一致し、メッシュはスキニングで FAP の構えへ再ポーズされる。
- マーカー10点 (Mixamo純正8点 + 足首2): あご / 手首L,R / 肘L,R / 膝L,R / 股下 / 足首L,R。
  各 FAP 関節へ対応: あご→Head, 手首→Hand, 肘→ForeArm, 膝→Leg, 股下→Hips, 足首→Foot。
- 残り関節 (Spine/Spine2/Neck/Arm肩/UpLeg) は landmarkRig.ts でFAP既定チェーンの
  弧長比率を保って確定済みランドマーク間を比例補間して推定 (Spine→腕→脚の順)。
- UI (SkinEdit stage3 内のマーカーモード):
  - 正面固定(alpha=+π/2)・自動回転停止。半透明モデルに10球を重ねドラッグ。
  - ドラッグは XY 平面 (dragPlaneNormal=Z)。奥行きZは Z軸レイで表裏ヒット中点=手足中心を自動採用。
  - 左右対称トグル (股下x=ミラー面)。リセット/完了。骨線は推定全関節からライブ再描画。
- 配線: skinStore.SkinConfig に markers 追加、Fighter.load と SkinEdit.buildVoxel が
  createVoxelFighter へ markers を渡す (markers 指定時 keepPositionFor 自動でプロポーション維持)。

**7-2. モーションカスタマイズ (次)**

### Phase 7-4: マイキャラクター制 へのリデザイン (2026-06-09 計画、着手)

現状の「全4スタイルを編集」UIをやめ、**自分が作る最大3キャラのみを編集**する構造へ。
各キャラは FBX/GLB から取込→ボーン設定(Mixamo式マーカー)→ボクセル化→保存。
対戦は自キャラを使い、相手は既存(ボクサー等)。モードは 1対1/リーグ/トーナメント。

決定事項 (2026-06-09 ユーザー確認):
- **保存**: 差し替え前提のストレージ層。今は `/api/characters` ルート→プロジェクト内
  ファイル保存(`data/characters/`)。将来 DB ができたらルート実装のみ差し替え(client無改修)。
- **技セット**: 自キャラ作成時に技スタイル(boxer/kicker/power/speed)を1つ選ぶ。
  見た目=自作ボクセル、動き=選んだスタイル。
- **編集項目**: 名前 / FBX・GLB取込 / ボーン設定 / ボクセル化 / 技スタイル / ステータス /
  体格 を自キャラごとに (既存 stats/body 仕組みを流用)。
- **大会出場者**: 1対1=自キャラ vs 選んだ既存1体。リーグ/トーナメント=自キャラ+既存4体(計5)。
  トーナメントは任意人数の単一トーナメント(端数はシード/不戦勝)。

実装段階:
1. **データ模型+ストレージ層 (着手)**: `characterModel.ts`(CharacterRecord型+typed array⇄base64
   シリアライズ), `characterStore.ts`(client リポジトリ: list/get/save/delete, MAX=3),
   `/api/characters` + `/api/characters/[id]`(プロジェクト内ファイル保存。meta と mesh を分離保存)。
2. **マイキャラエディタ**: 3スロット管理 + 各スロットで 取込→ボーン→ボクセル→技/ステ/体格→保存。
   CharacterEdit の全スタイル編集UIを置換。
3. **対戦統合**: キャラ選択で P1=自キャラ/相手=既存。1対1/リーグ/トーナメント。
   FightGame にトーナメント進行追加 + リーグを5者対応へ拡張。Fighter を CharacterRecord から構築。

### 将来計画 (未着手)

- ルートモーション対応 (前進を伴う技、ジャンプ攻撃) — GLB に Root 曲線が無いため
  エクスポートパイプライン側の対応が先 (MISSING.md 参照)。
- クロスフェード遷移 (animator/ の LayerRuntime を combat と統合)。
- 自モデル (qm_mustardui 等 ARP ボクセル) への retarget 適用。
- 2P ローカル対戦 / ネット対戦。

## 過去の作業

- Unity出力→src/runtime(loader/animator/avatar) 再生パイプライン (unity-uub-demo ブランチ)。
- /asset-test, /qm-model, /snake-test, /water-gun, /motion-test(簡易CPUアリーナ) 各デモ。
