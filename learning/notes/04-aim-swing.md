# 04. エイムスイング（ターゲット追従攻撃）

## デモページ
`/learning/aim-swing`

## シーン構成

| キャラ | 位置 | 向き(yaw) | 色 |
|--------|------|----------|-----|
| 自キャラ（攻撃者） | z = -1.0 | 0° (+Z向き = 相手方向) | 青系 |
| 相手キャラ | z = 可変(デフォルト+1.0) | 180° (-Z向き = 自キャラ方向) | 赤系 |

カメラは +X 側から見下ろし、自キャラが画面左・相手が画面右になるように配置。両者は対峙している。

---

## 主な機能

1. **ランダムターゲット選択** — 相手の15ジョイントから1つを選んで黄色球でマーク
2. **セレクターでも選択可能** — 狙いたい部位を直接指定
3. **攻撃実行** — Swingモーション再生（start → windup → strike）
4. **自動補正** — ターゲット位置に応じて Spine 回転と IK 目標を補正
5. **補正強度スライダー** — 0（固定モーション）〜1（完全追従）で比較
6. **ヒット判定** — 右手先とターゲットの距離で HIT / 惜しい / MISS を判定
7. **軌跡表示** — 右手先が通った経路を緑の小球で可視化

---

## 補正ロジックの中身

### Spine yaw 補正（左右方向）
```ts
const horizontalAngle = atan2(rel.x, rel.z) * 180/π;
base.spine1.yaw += horizontalAngle * 0.2 * w;  // 腰椎 20%
base.spine2.yaw += horizontalAngle * 0.3 * w;  // 胸椎 30%
base.chest.yaw  += horizontalAngle * 0.5 * w;  // 胸上部 50%（主役）
```
→ 総量の50%を胸上部（chest）に配分するため、腰はどっしり、上半身だけが大きく捻れる

### Spine pitch 補正（上下方向）
```ts
const vertical = atan2(rel.y - 0.4, horizDist) * 180/π;
base.spine1.pitch += -vertical * 0.15 * w;
base.chest.pitch  += -vertical * 0.2 * w;
```
→ 目標が高い時は反らし気味、低い時は前傾

### 右手IK目標の引き寄せ
```ts
const reach = min(horizDist, 0.95);
const targetHandHip = {
  x: sin(horizontalAngle) * reach,
  y: rel.y - 0.1,
  z: cos(horizontalAngle) * reach,
};
base.rightHand = lerpV3(base.rightHand, targetHandHip, w);
```
→ 打撃フェーズで右手目標がターゲット方向に収束

### 踏み込み（距離補正）
```ts
if (horizDist > 0.7) base.rightFoot.z += (horizDist - 0.7) * 0.6 * w;
```
→ 遠い時は右足を踏み出す

### しゃがみ（下段補正）
```ts
if (rel.y < 0) {
  base.rootY -= min(0.2, -rel.y * 0.4) * w;
  base.leftFoot.y += crouch * w;
  base.rightFoot.y += crouch * w;
}
```
→ 低いターゲット時は腰を落とす

### strikeWeight
```ts
const strikeWeight = max(0, (progress - 0.3) / 0.7);
```
→ 振りかぶり中は補正0、打撃にかけて徐々に補正を効かせる

---

## 観察ポイント

| 操作 | 観察 |
|------|------|
| 補正=0 で頭を狙う | モーションが固定のまま → 頭には届かず手は中段を通る |
| 補正=1 で頭を狙う | Spineが反り、右手が頭の高さへ → HIT |
| 補正=1 で rightFoot を狙う | しゃがみが入って手が低い位置に |
| 相手を X=1.0 に | 体全体が右を向いて追従 |
| 相手を Z=1.8 に | 踏み込みで右足が前に出る |
| 補正=0.5 で中段を狙う | 半端に追従、惜しい判定が多い |
| 補正=1 で leftHand を狙う | 相手の左手（画面右手前）に向けて体が捻れる |

---

## 「補正の配分」の設計原則

本番ゲームでも同じ発想。キーは:

1. **捻り(yaw)は胸主役** — 腰から均等に配分すると動きが硬い
2. **上下(pitch)は腰主役** — 全身の前傾が自然
3. **IK目標は最後に「結果を保証」** — 体幹補正で近づけ、最後に手目標で決める
4. **足の位置は独立して制御** — 接地感を保つためRootと手の補正に巻き込まれない
5. **補正ウェイトは打撃フェーズに集中** — 振りかぶりまで補正をかけると予備動作が崩れる

---

## 本番プロジェクトとの対応

| このデモ | 本番プロジェクト (`weapon-combat-v2` 等) |
|---------|------------------------------------------|
| `aimedSwingPose` | `attack-swing.ts` の軌道生成+IKターゲット更新 |
| Spine yaw 配分 | `body/swing-presets.ts` の `torsoTwist` + AI による敵方向計算 |
| 踏み込み | `swing-presets.ts` の `footStepR` |
| しゃがみ補正 | `hipsOffset` パラメータ |
| ヒット判定 | `actions/swing-attack.ts` の武器先端衝突判定 |

本番は武器慣性・ブロック判定・連続攻撃を加えるが、**「目標に合わせて体幹を配分補正しつつIKで末端を保証」** という骨格は同じ。

---

## 発展

- **複数攻撃種類**（縦振り・横振り・突き）で軌道の違いを比較
- **ターゲット移動**で追従性を確認
- **ブロック判定**を相手側に追加（腕で防がれる条件）
- **軌跡の補間**を Catmull-Rom 等で滑らかに

---

## 攻撃種別5種への拡張（追加）

`aimedSwingPose` を汎用化し、5種類の攻撃に対応しました。

### AttackDef 型
```ts
type AttackDef = {
  label: string;
  start, windup, strike: Pose;           // 3キーフレーム
  endEffector: keyof Skeleton;            // ヒット判定に使う末端
  correctionTargetKey: ...;               // 補正で動かす IK目標
  sign: 1 | -1;                           // 右攻撃=+1、左攻撃=-1
  yawWeights: [number, number, number];   // spine1/spine2/chest への配分
  pitchWeights: [number, number, number];
  pivotFoot?: 'leftFoot' | 'rightFoot';   // 軸足（補正除外）
  kneeMode?: boolean;                     // 膝蹴りモード
};
```

### 5種類の攻撃

| 攻撃 | 末端 | IK目標 | yaw配分(sum) | 特徴 |
|------|------|--------|--------------|------|
| 右縦振り | rightHand | rightHand | 0.2/0.3/0.5=1.0 | 上から振り下ろし、胸主役で捻り戻し |
| 左ジャブ | leftHand | leftHand | 0.15/0.25/0.5=0.9 | 直線・高速、yaw配分は弱め |
| 右ストレート | rightHand | rightHand | 0.2/0.3/0.5=1.0 | 直線・重い、胸で押し出し |
| 右ミドルキック | rightFoot | rightFoot | 0.1/0.2/0.4=0.7 | 軸足=left、Spine rollで傾き |
| 右膝蹴り | rightKnee | rightFoot | 0.1/0.15/0.3=0.55 | 末端=膝、IKは足目標で逆算 |

### 膝蹴りの特殊ロジック（kneeMode）

膝を狙った位置に持っていくには、**IK目標は足（rightFoot）だが、膝（rightKnee）の位置を制御したい**。
解決策: 足目標を「hip→target方向の延長線上、さらに後方下」に置く。
```ts
footHipLocal = hipLocal + (rel - normalize(rel)*0.25) + (0, -0.15, 0)
```
これで IK が膝を前方上に押し出す。膝蹴り特有のテクニック。

### 攻撃種別ごとの設計原則

1. **手攻撃はSpine配分強め** — 上半身主導で体を回す
2. **蹴り攻撃は軸足を固定** — 補正対象から外さないと軸足が浮く
3. **Spine rollは蹴りでのみ使用** — パンチで傾くと不自然
4. **直線攻撃(ストレート/ジャブ)はpitch補正弱め** — 軌道が上下しないため
5. **末端ごとの reach 上限** — 手は0.95m、足は0.75m（実際の到達距離に合わせる）

### 観察ポイント（攻撃別）

- **左ジャブ**: Spineが右攻撃と逆方向に捻れる。補正を見るには相手を画面手前側に
- **ストレート**: 軌跡が直線的。縦振りと比べて軌道の違いが明確
- **ミドルキック**: `Spine roll` でキャラが軸足側に傾く様子が分かる
- **膝蹴り**: 末端=rightKneeなので緑軌跡は膝。膝が前に押し出される様子を確認

---

## 攻撃8種への拡張（追加）

さらに3種類追加し、合計8種類の攻撃プリセットを揃えました。

### 追加攻撃

| 攻撃 | 末端 | 特徴 |
|------|------|------|
| 右フック | rightHand | chest yaw 配分が最大(0.55)。横方向の大きな弧。Spine roll も使用 |
| 右アッパー | rightHand | windupで深くしゃがむ(rootY=-0.15)、strikeで伸び上がりながら下→上の弧 |
| 右前蹴り | rightFoot | 旧「膝蹴り」から改名。足を前方に突き出す |
| 右膝蹴り(本物) | rightKnee | **新規**。腰ごと前進(rootZ)し、脚を畳んだまま膝で当てる |

### Pose.rootZ フィールドの追加

膝蹴りではターゲットまで腰を前進させる必要があるため、`Pose` に `rootZ`（前後位置）を追加:

```ts
type Pose = {
  rootY: number;
  rootZ?: number;  // 前後方向オフセット、default 0
  ...
};
```

- `poseToSkeleton` で `hips0 = Vector3(0, rootY, rootZ ?? 0)` として使用
- `lerpPose` でも補間対象
- 攻撃者は yaw=0 固定なので、local z = world z に直結

### 膝蹴りの新補正ロジック（kneeMode）

旧ロジックは「足IK目標で膝位置を制御」しようとしていたが、
IKの幾何学上 `|hip - knee| = upperLeg (0.38m)` は固定なので、**hipがtargetから0.38m以内にないと膝は届かない**。

新ロジック:

```ts
// 1. 腰ごと前進: rootZ += (horizDist - 0.33) * w
const stepInNeeded = horizDist - desiredHipDistFromTarget;
base.rootZ = (base.rootZ ?? 0) + stepInCap * w;

// 2. 軸足(左)は世界位置維持（地面に残す）
base.leftFoot.z -= stepInCap * w;

// 3. 腰の高さをターゲット高に寄せる
base.rootY += (desiredRootY - base.rootY) * w * 0.6;

// 4. 右足は尻寄りにタイトに畳む（膝が前に突き出す形）
base.rightFoot → (0.06, -0.2, -0.25) に引き寄せ
```

ポイント:
- **rootZ で腰ごと前進** → hip が target の近くに
- **leftFoot.z 逆補正** → 軸足が地面に残る（世界位置維持）
- **rightFoot を尻寄り** → 脚が強くベンドし、膝が前方に突き出る
- IK が残りの幾何を自動解決

### 使い方のコツ

- **膝蹴りでヒットしない時** → 補正強度を1.0に、ターゲットを chest / hips 付近に
- **アッパーの効果を見る** → ターゲット=head でしゃがみ→伸び上がりが派手
- **フックの横振り** → ターゲット=leftShoulder（画面手前の相手の左肩）でchest yawが最大に振れる
