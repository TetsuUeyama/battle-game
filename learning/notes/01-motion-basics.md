# 01. モーションの基礎概念

## 3Dキャラクターの構成要素

### スケルトン（骨格）
ボーン（骨）が親子関係で繋がった階層構造。人間の骨格と同じ。

```
Hips（腰）← 全体の基点（ルートボーン）
├── Spine → Spine1 → Spine2 → Neck → Head（体幹〜頭）
│   ├── L-Shoulder → L-Arm → L-ForeArm → L-Hand → 指（左腕）
│   └── R-Shoulder → R-Arm → R-ForeArm → R-Hand → 指（右腕）
├── L-UpLeg → L-Leg → L-Foot → L-Toe（左足）
└── R-UpLeg → R-Leg → R-Foot → R-Toe（右足）
```

**親子関係のポイント:** 親ボーンを回すと、子ボーンも全部ついてくる。
例: 肩(Arm)を前に出す → 前腕(ForeArm) → 手(Hand) → 指 まで全部前に出る。

### メッシュ（見た目）
ボーンにくっついた3Dの形状。このプロジェクトでは簡略化した箱（Box）を使用。
定義場所: `types.ts` の `BODY_PARTS`（約50パーツ）

---

## モーションの2つの方式

### キーフレーム方式（一般的なゲーム）
- Blender、Maya等のツールで事前にアニメーションを作成
- 「フレーム10で腕をこの角度、フレーム20でこの角度」とキーを打つ
- ゲーム中はそのデータを再生するだけ
- メリット: アニメーターが直感的に作れる
- デメリット: 状況に応じた動的な変化が苦手

### プロシージャル方式（このプロジェクト）
- コードで毎フレーム計算して動かす
- 「手をこの位置に持っていけ」→ IKが関節角度を計算
- メリット: 相手の位置、武器の種類に応じて動的にモーションが変わる
- デメリット: パラメータ調整が必要、直感的に作りにくい

---

## 攻撃モーションの構成要素

### 1. 手の軌道（SwingMotion）
3点で定義される:
- **startPos** — 攻撃開始時の手の位置
- **windupPos** — 振りかぶり到達位置
- **strikePos** — 打撃終了位置

### 2. 体幹の動き（BodyMotion）
| パラメータ | 意味 | 単位 | 正の値 |
|-----------|------|------|--------|
| torsoLean | 胴体の前傾/後傾 | ラジアン | 前傾 |
| torsoTwist | 胴体の左右捻り | ラジアン | 右回転 |
| hipsOffset | 腰の上下移動 | メートル | 上 |
| hipsForward | 腰の前後移動 | メートル | 前 |
| footStepR | 右足の踏み出し | メートル | 前 |
| offHandOffset | 左手の位置補正 | メートル | [前, 上, 右] |

### 3. 時間制御
- `progress`: 0→1 に進行
- `windupRatio`: 振りかぶりと打撃の境目（0.6 = 前半60%が振りかぶり）
- ease-in: 振りかぶりはゆっくり加速
- ease-out: 打撃は最初が速く減速

---

## 1フレームの処理フロー

```
AI決定「縦振り、パワー80%」
  ↓
createSwingMotion()
  手の軌道3点を計算
  swing-presetsからBodyMotionプリセットをロード
  power × bodyCommitment × gripCommitment でスケーリング
  ↓
毎フレーム updateSwingMotion(dt)
  progressを進める
  手の位置を補間 → IKターゲットにセット
  BodyMotionを補間 → 背骨・腰に適用
  ↓
IKソルバー（3パス）
  手の位置 → 肩・肘の角度を逆算
  関節角度をクランプ（肘5°〜150°）
  足をIKで地面に接地
  ↓
描画
```

---

## 主要ファイルマップ

| ファイル | 役割 |
|---------|------|
| `types.ts` | BodyMotion, SwingMotion, IKChain等の型定義 |
| `character/create.ts` | スケルトン構築、メッシュ作成、IKチェーン初期化 |
| `character/body/swing-presets.ts` | 攻撃タイプ別の体幹プリセット値 |
| `weapon/attack-swing.ts` | 手の軌道生成・フレーム更新・BodyMotion適用 |
| `character/ik-solver.ts` | 2ボーンIKソルバー、関節クランプ |
| `character/update.ts` | 毎フレームのIK解決・足接地・レート制限 |
| `actions/swing-attack.ts` | 攻撃実行・ヒット判定 |
| `actions/guard.ts` | ガード位置計算・ブロック判定 |
| `motion-converter/pipeline.ts` | FBX→Babylon.js座標変換 |
