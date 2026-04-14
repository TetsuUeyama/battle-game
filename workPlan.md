# 作業計画 (Work Plan)

## 概要
weapon-combat-v2 ブランチにて武器戦闘システムを改善する。
決め打ちプリセットから「行動意図 + 制約 + 戦況 → 最適解」ベースの自動モーション計算システムへ移行する。

### 設計方針
```
行動意図 (何を達成したいか — 細分化された目的)
  + 制約 (関節可動域、リーチ、バランス、現在の体勢)
  + 武器パラメータ (長さ、重さ、カテゴリ)
  + 戦況コンテキスト (相手の状態予測、次に取りたい行動)
  → MotionSolver → 最適な姿勢・軌道
```

### 行動意図の体系 (AttackIntent / StanceIntent)

行動は「何をするか」ではなく「何を達成したいか」で細分化する。
ソルバーは意図に応じて目的関数の重みを動的に切り替える。

**攻撃の意図 (AttackIntent):**
| 意図 | 説明 | ソルバーへの影響 |
|------|------|-----------------|
| `damage` | ダメージ重視。最大威力を狙う | 力伝達効率↑、到達性↑、速度↓（大振り許容） |
| `disrupt` | 体勢崩し。相手のバランスを崩す | 相手のバランス偏差方向への軌道↑、威力より角度重視 |
| `pressure` | 牽制・プレッシャー。相手を動かす/反応させる | 速度↑、リーチ活用↑、リスク↓（浅い振り） |
| `setup` | コンボ起点。2発目以降を前提とした初撃 | 攻撃後体勢↑↑、strike終了→次windup距離を最小化 |
| `punish` | 確定反撃。相手の隙に差し込む | 速度↑↑、到達性↑、バランス度外視（当てきる） |
| `finisher` | 止め。相手の体力が少ない/よろめき中 | 力伝達効率↑↑、大振り許容、リスク無視 |

**構えの意図 (StanceIntent):**
| 意図 | 説明 | ソルバーへの影響 |
|------|------|-----------------|
| `aggressive` | 攻撃重視。攻撃に素早く移行したい | 攻撃準備性↑、威圧度↑ |
| `defensive` | 防御重視。相手の攻撃に対応したい | 防御カバー↑、相手攻撃対応性↑ |
| `neutral` | バランス型。攻防どちらにも対応 | 各目的を均等に評価 |
| `recovery` | 回復。攻撃後や被弾後に体勢を立て直す | バランス安定性↑↑、遷移コスト↓ |

### 構えの設計

**3種類の基本構え (ソルバーが武器パラメータから計算):**
- **上段構え** — 武器を高い位置に構える。縦振り攻撃への移行が速い
- **中段構え** — 武器を胸〜腰の高さに構える。攻防バランスが良い
- **下段構え** — 武器を低い位置に構える。横振り・突きへの移行が速い

各基本構えの具体的な位置・角度は武器パラメータから自動計算（決め打ちではない）。
試合中は戦況コンテキストに応じて基本構えを基準に微調整する。

```
基本構え (武器装備時にソルバーが計算、キャッシュ)
  ↓
戦況による微調整 (毎構え更新時)
  - 相手が攻撃しそう → 防御方向にずらす
  - 自分が攻撃したい → 攻撃windup方向に寄せる
  - バランスが崩れている → 安定方向に補正
  ↓
最終構え位置 (IKターゲットに適用)
```

### ソルバー入力の3層構造
1. **静的パラメータ** — 武器装備時に確定（武器物理、関節可動域、腕リーチ、3基本構え位置）
2. **動的コンテキスト** — モーション開始時に評価（行動意図、相手の状態、自分の体勢）
3. **フレーム補間** — 毎フレーム（既存のlerp補間、踏み込み処理）

### パフォーマンス戦略
- 静的パラメータ → 武器装備時に1回計算 (~1ms)、結果キャッシュ
- 動的コンテキスト → モーション開始時に1回計算 (~0.5ms)
- 構え微調整 → 構え更新時 (~0.1ms、有効プール内の再スコアリングのみ)
- フレーム補間 → 毎フレーム（既存処理、ソルバー呼び出し不要）

### 運動連鎖モデル (Kinetic Chain)

全モーションは以下の原則に従う:

**原則1: 中心始動**
モーションは体の中心（腰/体幹）から始まり、末端（手/武器先端）に順次伝播する。
```
腰 → Spine → Spine1 → Spine2 → 肩 → 上腕 → 前腕 → 手 → 武器先端
```

**原則2: 末端起点モーションも中心が先行**
末端のみを動かすモーション（例: 手首だけの牽制）でも、体幹が先に微細に動く。
中心部を「動かさなかった」のではなく「微細に動かした結果として末端が動いた」と扱う。
```
例: 手首のフリック牽制
  腰: 0.01rad lean (ほぼ不動)  → t=0.00s に開始
  Spine: 0.02rad twist         → t=0.01s に開始
  肩: 0.05rad                  → t=0.02s に開始
  手首: メインの動き            → t=0.03s に開始
```

**原則3: 力のモーメント**
体の中心から連動して末端を動かすほど大きな力のモーメントが発生する。
末端のみのモーションは速いが弱い、全身連動は遅いが強い。
```
力のモーメント = Σ(各関節の回転角速度 × 回転半径 × 質量)

全身連動 (damage/finisher):
  腰回転(大) → Spine(大) → 肩(大) → 肘(中) → 手首(小)
  = 大きな力のモーメント、遅い始動

末端のみ (pressure/punish):
  腰(微) → Spine(微) → 肩(小) → 肘(中) → 手首(大)
  = 小さな力のモーメント、速い始動
```

**原則4: 時間遅延**
各関節の回転は前の関節の回転開始から一定時間遅れて始まる。
遅延量は関節間の距離と動作の大きさに比例する。
```
jointDelay = baseDelay × (1 + motionMagnitude × 0.5)

baseDelay:
  腰→Spine:    0.01s
  Spine→Spine1: 0.01s
  Spine1→Spine2: 0.01s
  Spine2→肩:   0.015s
  肩→肘:       0.02s
  肘→手首:     0.015s
```

**AttackIntentとの連動:**
| AttackIntent | 体幹関与度 | 末端速度 | 力モーメント | 始動速度 |
|-------------|-----------|---------|------------|---------|
| `damage`    | 大 (0.8-1.0) | 中 | 最大 | 遅い |
| `finisher`  | 最大 (1.0) | 低 | 最大 | 最も遅い |
| `disrupt`   | 中 (0.5-0.7) | 中 | 中 | 中 |
| `setup`     | 中 (0.4-0.6) | 中高 | 中 | 中 |
| `pressure`  | 小 (0.1-0.3) | 高 | 小 | 速い |
| `punish`    | 小 (0.2-0.4) | 最高 | 小中 | 最も速い |

### ダメージモデル (運動連鎖 + 武器物理)

ダメージは「武器先端にどれだけの運動エネルギーが集中したか」で決まる。

**現在のダメージ計算 (置換対象):**
```
power += tipMoveDist × weapon.weight
damage = (power × 5 + 5) × boneMul
→ 問題: 体幹の関与度が反映されない。手首だけ振っても全身で振っても同じ移動距離なら同じダメージ
```

**新ダメージモデル:**
```
impactEnergy = weaponKineticEnergy × forceChainMultiplier × weaponMomentum

weaponKineticEnergy:
  = 0.5 × weapon.weight × tipVelocity²
  武器が重いほど、先端が速いほどエネルギーが大きい

forceChainMultiplier:
  = 運動連鎖による力の増幅率
  = Σ(jointRotationRate[i] × jointRadius[i] × jointMass[i]) / baselineForce
  体幹から連動して振るほど大きい値になる
  既存の computeForceMultiplier() を拡張して時間的な連動度を反映

weaponMomentum:
  = weapon.weight × weapon.length × tipAngularVelocity
  重い武器 × 長い武器 × 速い回転 = 大きな運動量
  角速度は「武器のグリップ点を中心とした先端の回転速度」

damage = impactEnergy × boneMul × armorReduction(将来)
```

**武器の重さ・移動量とダメージの関係:**

| 要素 | ダメージへの影響 | 理由 |
|------|----------------|------|
| 武器が重い | ↑↑ | 運動エネルギー ∝ mass（KE = 0.5mv²） |
| 先端速度が速い | ↑↑↑ | 運動エネルギー ∝ v²（速度の2乗） |
| 武器が長い | ↑ | 同じ角速度でも先端の線速度が大きい（v = ωr） |
| 体幹の関与度が大きい | ↑↑ | 力モーメントが大きく先端速度が上がる |
| 手首だけで振る | ↓ | 力モーメントが小さく先端速度が限定的 |

**具体例:**
```
大剣 (weight=5kg, length=1.2m) × 全身連動 (damage intent):
  tipVelocity = 12 m/s (体幹回転 + 腕の振り)
  KE = 0.5 × 5 × 12² = 360
  forceChain = 1.8 (全関節が大きく連動)
  momentum = 5 × 1.2 × 10 = 60
  → impactEnergy = 高い

短剣 (weight=0.5kg, length=0.3m) × 手首フリック (pressure intent):
  tipVelocity = 8 m/s (手首の回転のみ)
  KE = 0.5 × 0.5 × 8² = 16
  forceChain = 0.4 (末端のみ)
  momentum = 0.5 × 0.3 × 26 = 3.9
  → impactEnergy = 低い

短剣 (weight=0.5kg, length=0.3m) × 全身連動 (punish intent):
  tipVelocity = 15 m/s (全身の力で突き)
  KE = 0.5 × 0.5 × 15² = 56
  forceChain = 1.5 (体幹連動)
  momentum = 0.5 × 0.3 × 50 = 7.5
  → impactEnergy = 中程度 (短剣でも全身を使えばそれなりのダメージ)
```

**実装への影響:**
- `physics.ts` の `updateWeaponPower()` を改修 — 単純な `dist × weight` 累積から運動エネルギーベースに
- `swing-attack.ts` のダメージ計算を改修 — `impactEnergy` ベースに
- `KineticChainProfile` から `forceChainMultiplier` を毎フレーム計算
- 先端の角速度 (`tipAngularVelocity`) をグリップ点基準で毎フレーム計算・追跡

### 既存システムの活用（変更しない部分）
- IKソルバー（2-bone analytic + 3パスクランプ）
- バランスシステム
- AI状態マシン（evaluate → decide → state）

### 既存システムの改修が必要な部分
- `applyBodyMotion()` — 現在は全Spine骨を同時に回転。運動連鎖の時間遅延を組み込む
- `updateSwingMotion()` — 現在は全パラメータを同時にlerp。関節ごとの遅延進行度を導入
- `force-chain.ts` / `force-propagation.ts` — 力の大きさの計算は既存を活用。時間的伝播を追加

---

## Phase 1: 構えの自動計算（進行中）

### 目標
固定オフセット値の3構え → 武器パラメータから3基本構えを自動計算 + 戦況による微調整

### 新規ファイル
- `src/lib/havok-character/solver/types.ts` — AttackIntent, StanceIntent 等の型定義
- `src/lib/havok-character/solver/objectives.ts` — 目的関数の定義
- `src/lib/havok-character/solver/constraints.ts` — 制約関数の定義
- `src/lib/havok-character/solver/combat-context.ts` — 戦況コンテキスト（相手予測・自分の意図）
- `src/lib/havok-character/solver/stance-solver.ts` — 構えの最適化ソルバー
- `src/lib/havok-character/solver/precompute.ts` — 武器装備時の事前計算・キャッシュ

### 変更ファイル
- `weapon/stance.ts` — `getStanceTargets()` の3分岐をソルバー呼び出しに置換
- `weapon/equip.ts` — `applyStance()` で事前計算結果を使用
- `weapon/loader.ts` — `equipGameAssetWeapon()` で事前計算を呼び出す
- `types.ts` — `HavokCharacter` に `solverCache` フィールド追加
- `ai/decide.ts` — StanceIntent / AttackIntent を Decision に追加

### 基本構えの計算

3種類の基本構え（上段・中段・下段）を武器パラメータから自動計算する。
各構えは異なる目的関数の重み配分で最適化する:

**上段構え — 高い位置からの攻撃に有利:**
| 目的 | 重み | 理由 |
|------|------|------|
| 縦振り攻撃準備性 | 0.30 | vertical windup への距離を最小化 |
| 防御カバー (頭部) | 0.15 | 頭部へのガード距離 |
| 威圧度 | 0.20 | 武器先端が相手を上から向く |
| バランス安定性 | 0.15 | 高い構えはバランスが崩れやすいので確保が重要 |
| 力伝達準備 | 0.10 | 肩の曲げ角が力を生む準備 |
| 相手攻撃対応性 | 0.10 | 上段からの防御移行 |

**中段構え — 攻防バランス:**
| 目的 | 重み | 理由 |
|------|------|------|
| 攻撃準備性 (全タイプ平均) | 0.20 | どの攻撃にも均等に移行 |
| 防御カバー (胴体) | 0.20 | 胴体へのガード距離 |
| 威圧度 | 0.10 | 前方投射 |
| バランス安定性 | 0.20 | 最も安定した構え |
| 力伝達準備 | 0.15 | 全身の関節が適度に曲がる |
| 相手攻撃対応性 | 0.15 | どの方向の攻撃にも対応 |

**下段構え — 横振り・突きに有利:**
| 目的 | 重み | 理由 |
|------|------|------|
| 横振り/突き攻撃準備性 | 0.30 | horizontal/thrust windup への距離を最小化 |
| 防御カバー (下半身) | 0.10 | 腰へのガード距離 |
| 威圧度 | 0.10 | 低い位置からの威圧 |
| バランス安定性 | 0.20 | 低い重心で安定 |
| 力伝達準備 | 0.15 | 腰の回転力を活用する準備 |
| 相手攻撃対応性 | 0.15 | 下段からの防御移行 |

### 戦況による微調整

基本構えを基準に、戦況に応じて構え位置を微調整する:

**微調整の入力:**
- StanceIntent (aggressive/defensive/neutral/recovery) → 目的関数の重み比率を変更
- 相手の構え・武器方向 → 防御しやすい方向にオフセット
- 相手の距離 → 近距離ほど防御カバーの重みを上げる
- 自分のバランス偏差 → 崩れている方向の逆にオフセット
- 前の攻撃の終了位置 → 遷移コストが低い方向にオフセット

**微調整の方法:**
有効構えプール（事前計算済み）から、微調整済み目的関数で再スコアリング。
基本構えからの偏差にペナルティをかけて大きく逸脱しすぎないよう制限。

### 制約（違反したら不可）
- 関節可動域内（既存 `joints.ts` の `JOINT_CONFIG`）
- 腕のリーチ内（IKChain.lengthA + lengthB）
- 武器が体に貫通しない（既存 body-collision ロジック流用）
- バランス維持（重心が支持基底面内）
- 手首トルク制限（新規）: `weapon.weight × weapon.length × sin(角度)` → 重い武器は自然と低い構えになる
- 現在の体勢からの遷移が物理的に可能（関節角速度の上限内）

### アルゴリズム

**事前計算（武器装備時）:**
1. 肩を中心とした球面上の候補点（θ×φ = 12×12 = 144点）を探索
2. 制約を満たす候補を「有効構えプール」としてキャッシュ
3. 上段/中段/下段それぞれの目的関数重みで最適点を選び、3基本構えとしてキャッシュ

**動的選択（構え更新時）:**
1. 現在のStanceIntentと戦況コンテキストから目的関数の重みを微調整
2. 有効構えプール内で再スコアリング（基本構え付近にボーナス）
3. 最高スコアの構えを選択

### ステップ
1. `solver/types.ts` を作成（AttackIntent, StanceIntent, CombatContext 等の型定義）
2. `solver/objectives.ts`, `solver/constraints.ts` を実装
3. `solver/combat-context.ts` を実装（戦況コンテキストの収集・評価）
4. `solver/stance-solver.ts` を実装（事前計算: 3基本構え + 動的微調整）
5. `solver/precompute.ts` を実装（武器装備時に有効構えプール + 3基本構えをキャッシュ）
6. `weapon/stance.ts` を修正（ソルバー結果があれば使用、なければ旧プリセットにフォールバック）
7. `ai/decide.ts` を修正（StanceIntent / AttackIntent を Decision に含める）
8. テスト・調整（各武器カテゴリ × 各StanceIntent × 戦況パターンで確認）

---

## Phase 2: 攻撃モーションの自動計算（未着手）

### 目標
`swing-presets.ts` のハードコードプリセット → ソルバーが行動意図に応じてwindup/strike位置・BodyMotionを自動計算

### 新規ファイル
- `src/lib/havok-character/solver/swing-solver.ts` — 攻撃モーションの最適化ソルバー

### 変更ファイル
- `weapon/attack-swing.ts` — `createSwingMotion()` 内部をソルバーに段階的に置換
- `character/body/swing-presets.ts` — Phase 2完了後に非推奨化
- `ai/decide.ts` — AttackIntent の決定ロジックを追加

### AttackIntent ごとの目的関数の重み

**`damage` (ダメージ重視):**
| 目的 | 重み | 内容 |
|------|------|------|
| 到達性 | 0.25 | 武器先端がターゲットに確実に届く |
| 力伝達効率 | 0.35 | 全身の力を最大限先端に伝える |
| バランス維持 | 0.10 | 大振りなので多少崩れても許容 |
| 速度 | 0.05 | 遅くても威力優先 |
| 相手防御回避 | 0.10 | ガードの上から叩く想定 |
| 攻撃後体勢 | 0.15 | 大振り後の隙を最小限に |

**`disrupt` (体勢崩し):**
| 目的 | 重み | 内容 |
|------|------|------|
| 到達性 | 0.20 | 相手に届けば十分 |
| 力伝達効率 | 0.10 | 威力より角度が重要 |
| バランス維持 | 0.20 | 自分は崩れない |
| 速度 | 0.15 | ある程度速く |
| 相手バランス崩し効果 | 0.20 | 相手のバランス偏差方向に押し込む軌道 |
| 攻撃後体勢 | 0.15 | 崩した後の追撃に備える |

**`pressure` (牽制):**
| 目的 | 重み | 内容 |
|------|------|------|
| 到達性 | 0.15 | 当たらなくても威圧できれば良い |
| 力伝達効率 | 0.05 | 威力は不要 |
| バランス維持 | 0.25 | 自分は絶対崩れない |
| 速度 | 0.30 | 素早く出して素早く引く |
| 相手防御回避 | 0.10 | 反応させることが目的 |
| 攻撃後体勢 | 0.15 | すぐ次の行動に移れる |

**`setup` (コンボ起点):**
| 目的 | 重み | 内容 |
|------|------|------|
| 到達性 | 0.20 | 初撃は当てる |
| 力伝達効率 | 0.10 | 威力より連携重視 |
| バランス維持 | 0.15 | 2発目に繋ぐため安定 |
| 速度 | 0.15 | 素早い初撃 |
| 相手防御回避 | 0.10 | ガードを開けさせる方向 |
| 攻撃後体勢 | 0.30 | strike終了位置→次のwindup開始位置の距離を最小化 |

**`punish` (確定反撃):**
| 目的 | 重み | 内容 |
|------|------|------|
| 到達性 | 0.30 | 確実に当てる |
| 力伝達効率 | 0.15 | そこそこの威力 |
| バランス維持 | 0.05 | 当てきるので崩れてもいい |
| 速度 | 0.35 | 相手の隙が閉じる前に届かせる |
| 相手防御回避 | 0.05 | 隙中なのでガードは来ない |
| 攻撃後体勢 | 0.10 | 当てた後のことは後で考える |

**`finisher` (止め):**
| 目的 | 重み | 内容 |
|------|------|------|
| 到達性 | 0.30 | 確実に当てる |
| 力伝達効率 | 0.40 | 最大威力 |
| バランス維持 | 0.00 | 崩れてもいい |
| 速度 | 0.05 | 遅くても構わない |
| 相手防御回避 | 0.15 | よろめき中でもガードされる可能性を考慮 |
| 攻撃後体勢 | 0.10 | 倒せなかった場合の保険 |

### AttackIntent の決定ロジック (ai/decide.ts に追加)

```
相手よろめき中 & HP低い → finisher
相手よろめき中 & HP高い → damage
相手の攻撃後の隙 → punish
相手がガード姿勢 → disrupt (ガードの上から崩す) or pressure (様子見)
自分のコンボ1発目 → setup
自分のコンボ2発目以降 → damage or finisher (HP次第)
距離が遠い / 様子見 → pressure
```

### 戦況コンテキスト入力（攻撃開始時に評価）

**相手の予想防御:**
- 相手のgrip位置・武器方向 → ガードされやすい角度を推定
- 相手の防御スイング範囲 → Bezier迂回が必要かを判定
- 相手がガード姿勢か攻撃中か → 攻撃チャンスの評価

**相手の予想攻撃（反撃リスク）:**
- 攻撃中に相手が反撃する可能性
- 自分の打撃後のリカバリ時間と相手の攻撃到達時間の比較
- → リスクが高ければ速度重視・バランス重視に重み調整

**自分の体勢:**
- 現在の構え位置 → windup位置への遷移コスト
- 現在のSpine lean/twist → 使える体幹回転の余裕
- 現在のバランス偏差 → 踏み込みの余裕

**次に取りたい行動:**
- setup → strike終了位置が次のwindup開始に近い軌道を選択
- 退避予定 → strike後にバランスが後退方向に残る軌道を優先
- 防御予定 → strike後に手がガード位置に近い軌道を優先

### 制約
- 関節可動域内
- windup → strike の軌道が相手に到達
- 武器慣性による最大角速度制限: `weight × length²` が大きいほど振りが遅い
- バランスが破綻しない（stagger閾値未満、ただし finisher/punish は緩和）
- 現在の体勢から windup への遷移が関節角速度の上限内

### SwingType の扱い
- vertical / horizontal / thrust は残す（AIの戦術判断に必要）
- 各タイプの具体的なwindup角度・strike角度・体幹の使い方はソルバーが決定
- BodyMotionの逆算: 「肩をこの位置に出すには torsoLean/torsoTwist がいくつ必要か」を計算

### 運動連鎖の実装

**新規ファイル:**
- `src/lib/havok-character/solver/kinetic-chain.ts` — 運動連鎖の時間遅延・力モーメント計算

**変更ファイル:**
- `weapon/attack-swing.ts` — `applyBodyMotion()` に運動連鎖の時間遅延を組み込む
- `weapon/attack-swing.ts` — `updateSwingMotion()` に関節ごとの遅延進行度を導入

**KineticChainProfile (攻撃開始時にソルバーが生成):**
```
各関節の回転プロファイル:
  joint: 'hips' | 'spine' | 'spine1' | 'spine2' | 'shoulder' | 'elbow' | 'wrist'
  startDelay: number     — モーション開始からこの関節が動き始めるまでの遅延 (秒)
  magnitude: number      — この関節の回転量 (0-1、AttackIntentの体幹関与度に基づく)
  peakTime: number       — 最大回転速度に達する時刻 (秒)
```

**lerpBody の改修:**
現在の `lerpBody(a, b, t)` は全パラメータを同じ `t` で補間しているが、
運動連鎖では各パラメータが異なる進行度を持つ:
```
lerpBodyChained(a, b, globalProgress, chainProfile):
  hipsProgress   = getJointProgress('hips', globalProgress, chainProfile)
  spineProgress  = getJointProgress('spine', globalProgress, chainProfile)
  shoulderProgress = getJointProgress('shoulder', globalProgress, chainProfile)

  torsoLean  = lerp(a.torsoLean,  b.torsoLean,  spineProgress)
  torsoTwist = lerp(a.torsoTwist, b.torsoTwist, spineProgress)
  hipsOffset = lerp(a.hipsOffset, b.hipsOffset, hipsProgress)
  hipsForward = lerp(a.hipsForward, b.hipsForward, hipsProgress)
  footStepR  = lerp(a.footStepR,  b.footStepR,  hipsProgress)
```

**getJointProgress (関節ごとの遅延進行度):**
```
function getJointProgress(joint, globalProgress, chainProfile):
  entry = chainProfile[joint]
  adjustedTime = max(0, globalProgress - entry.startDelay / totalDuration)
  localProgress = adjustedTime / (1.0 - entry.startDelay / totalDuration)
  return clamp(localProgress, 0, 1) * entry.magnitude
```

**力モーメントの計算:**
```
forceMoment = Σ (jointAngularVelocity[i] × jointRadius[i] × jointMass[i])

jointRadius: 各関節から武器先端までの距離
  hips→tip:     ~1.4m (全身)
  spine1→tip:   ~1.0m (胴体上部)
  shoulder→tip: ~0.8m (腕+武器)
  elbow→tip:    ~0.5m (前腕+武器)
  wrist→tip:    ~weapon.length

体幹関与度が高いほど大きいradiusの関節が大きく動く → 力モーメント増大
```

### ステップ
1. `solver/kinetic-chain.ts` を実装（KineticChainProfile の生成、力モーメント計算）
2. `solver/swing-solver.ts` を実装（AttackIntentを受け取り `SwingMotion` + `KineticChainProfile` を返す）
3. `ai/decide.ts` にAttackIntent決定ロジックを追加
4. `createSwingMotion()` のwindup/strike位置計算をソルバーに委譲
5. `applyBodyMotion()` を改修（KineticChainProfileに基づく関節ごとの遅延適用）
6. `updateSwingMotion()` を改修（`lerpBody` → `lerpBodyChained` への置換）
7. `swing-presets.ts` からの依存を除去
8. `physics.ts` の `updateWeaponPower()` を改修 — 運動エネルギー + 角速度ベースに
9. `swing-attack.ts` のダメージ計算を改修 — `impactEnergy` ベースに
10. テスト（各AttackIntent × 各武器カテゴリ × 各SwingType × 各戦況パターンの組み合わせ確認）
11. ダメージバランス調整（大剣vs短剣、全身連動vs手首フリック等の比較検証）

---

## Phase 3: 移動の物理ベース化（未着手）

### 目標
固定速度の移動 → 武器の重さ・構え姿勢・戦況に応じた動的移動パラメータ

### 変更ファイル
- `actions/move-toward.ts` — 武器重量と構え姿勢を考慮した移動速度計算
- `character/body/foot-plant.ts` — 武器重量に応じたステップ幅・高さの動的調整

### 新規ファイル
- `src/lib/havok-character/solver/movement-solver.ts` — 移動パラメータ計算

### 目的関数

| 目的 | 重み | 内容 |
|------|------|------|
| 移動速度 | 0.25 | 目標位置に素早く到達する |
| 構え維持 | 0.20 | 移動中も構えが崩れない |
| 攻撃即応性 | 0.20 | 移動中から即座に攻撃に移行できる |
| 被弾回避 | 0.20 | 相手の予想攻撃軌道から外れた移動経路 |
| バランス安定性 | 0.15 | ステップ中もバランスが安定 |

### 戦況コンテキスト入力
- 相手の攻撃圏内にいるか → 圏内なら被弾回避の重みを上げる
- 次の行動意図（接近→攻撃 / 距離取り→回復） → 移動方向と構えの向きを連動
- 相手の武器先端位置 → 危険方向を避けた移動経路

---

## Phase 4: クリーンアップ（未着手）

### 内容
- `swing-presets.ts` の `SWING_PRESETS` 削除（ソルバーで完全代替後）
- `StanceType` のリネーム（`'front'|'side'|'overhead'` → `'upper'|'middle'|'lower'`）
- `decide.ts` の `getCategoryWeights()` をソルバーの目的関数評価に統合
- 旧プリセットへのフォールバックコードを除去

---

## 完了済み

(なし)
