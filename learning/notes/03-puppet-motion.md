# 03. 人形モデルでのモーション制作と修正

## デモページ
`/learning/puppet`

## 人形の構造（15ジョイント）

```
hips（腰・Root）
├─ chest ─ neck ─ head
├─ chest ─ leftShoulder ─ leftElbow ─ leftHand
├─ chest ─ rightShoulder ─ rightElbow ─ rightHand
├─ hips ─ leftHip ─ leftKnee ─ leftFoot
└─ hips ─ rightHip ─ rightKnee ─ rightFoot
```

**色分け:**
- オレンジ: 腰・胸（体幹の中心）
- 赤: 肩・股関節（根本）
- 緑: 肘・膝（中間）
- 青: 手・足（末端）
- 紫（半透明）: IK目標マーカー（編集モードのみ）

---

## FKとIKの使い分け

| 部位 | 手法 | パラメータ | 理由 |
|------|------|-----------|------|
| Root(腰) | 直接位置指定 | `rootY` | 体全体の基準位置 |
| Spine(体幹) | **FK** | `spine.pitch/yaw/roll` | 角度指定が直感的（前傾・捻り） |
| Head(頭) | **FK** | `head.pitch/yaw` | 首の向きは角度で考える |
| 両腕 | **IK** | `leftHand/rightHand` (x,y,z) | 手の位置を決めたい（武器を持つ位置） |
| 両脚 | **IK** | `leftFoot/rightFoot` (x,y,z) | 足を地面に接地したい |

→ **「体幹・頭はFK、手足はIK」がプロシージャルモーションの基本形**

---

## プリセット4種

| プリセット | 特徴 |
|-----------|------|
| T-Pose | 全関節デフォルト。基準姿勢 |
| Guard | 手を前に構え、やや前傾 |
| Swing | 縦振り攻撃（start → windup → strike の3キーフレーム） |
| Crouch | 膝を曲げて腰を下げる |

Swingモーションは `start(0) → windup(0.5) → strike(1.0)` の3点を補間。前半は ease-in（t²）、後半は ease-out（1-(1-t)²）。

---

## モーションを作る手順

1. **Rootの高さを決める** (`rootY`)
2. **体幹の傾きをFKで決める** (`spine.*`)
3. **手足の目標位置をIKで決める** (`leftHand/rightHand/leftFoot/rightFoot`)
4. **必要なら頭の向きをFKで微調整** (`head.*`)
5. **複数ポーズ（キーフレーム）を作って補間**でモーションにする

---

## 修正したい場面と対応

| 症状 | 修正箇所 | 手法 |
|------|---------|------|
| 手が変な位置に来る | `leftHand/rightHand` の x/y/z | IK |
| 足が地面にめり込む | `leftFoot/rightFoot` の y を上げる | IK |
| 足が浮く | `leftFoot/rightFoot` の y を下げる | IK |
| 体の前傾が足りない | `spine.pitch` を大きく | FK |
| 体をもっと捻りたい | `spine.yaw` を変える | FK |
| 全体が高すぎ/低すぎ | `rootY` を修正 | Root |
| 頭の向きだけ変えたい | `head.pitch/yaw` | FK |
| 肘が変な向きに曲がる | `armPoleL/armPoleR` を修正 | ポールヒント |
| 膝が後ろに曲がる | `legPoleL/legPoleR` を修正 | ポールヒント |
| モーションの振幅不足 | windup/strikeキーフレーム値 | キーフレーム |
| モーションの速さ | 再生ループの持続秒数 | 時間制御 |
| イージングを強めたい | `eased = t*t*t` 等に変更 | 時間カーブ |

---

## コード内の重要な関数

| 関数 | 役割 |
|------|------|
| `poseToSkeleton(pose)` | 1フレームのPoseから全16ジョイントのワールド位置を計算 |
| `solveIK(root, target, pole, L1, L2)` | 2ボーンIKを解く（余弦定理+ポールヒント） |
| `lerpPose(a, b, t)` | 2つのPoseを線形補間 |
| `getSwingPose(progress)` | Swingモーションの3キーフレーム補間（イージング付き） |

---

## 本番プロジェクトとの対応

| このデモ | 本番プロジェクト |
|---------|------------------|
| `Pose` | `BodyMotion` + IKターゲット |
| `guardPose` | `guard.ts` のガード姿勢 |
| `swingStart/windup/strike` | `swing-presets.ts` の各攻撃プリセット |
| `getSwingPose(progress)` | `attack-swing.ts` の `updateSwingMotion(dt)` |
| `solveIK()` | `ik-solver.ts` の2ボーンIK |
| `poseToSkeleton()` | `update.ts` のフレーム更新処理 |

本番は **武器物理・AI・衝突判定・多パスIK** 等が加わるが、**コアの流れは同じ**。

---

## 観察ポイント

1. **編集モード → 腰の高さだけ変える** → 体全体が上下するが、足は地面位置（IK目標）のまま下にある → 体が足から離れる
   → **IK目標は腰相対で記述しているため**。実プロジェクトでは足をワールド固定することも多い
2. **Spine Pitchを前傾** → 胸・頭・肩は傾くが、足・股関節は動かない
   → Spineは腰から上だけに影響、股関節はRoot直下
3. **右手のZを大きく** → 腕が前に伸びる → 限界を超えると肘が伸びきる（IKが届かない状態）
4. **Swing再生** → 体幹の捻り・手の軌道・足踏み込みが同時進行 → 複数パラメータの協調でモーションになる

---

## Spine3分割への拡張（追加）

### 構造変更
旧: `hips → chest` (単一Spine回転)
新: `hips → spine1 → spine2 → chest` (3段階の階層回転)

### 各関節の役割
| 関節 | 可動域 | 主な役割 |
|------|--------|---------|
| spine1（腰椎） | pitch±30°, yaw±30°, roll±25° | 前傾の基盤、股関節との連動 |
| spine2（胸椎） | pitch±25°, yaw±40°, roll±25° | 中間の柔軟性 |
| chest（胸椎上） | pitch±20°, yaw±50°, roll±30° | 捻りの主役、肩と連動 |

### 階層伝搬（FKの本質）
```
rot1 = spine1のローカル回転
rot2 = rot1 × spine2のローカル回転   ← 親の回転が引き継がれる
rotC = rot2 × chestのローカル回転    ← さらに積み重なる
```
→ spine1を傾けると spine2, chest, 肩、頭まで全部ついてくる
→ chestだけ捻ると、肩と頭だけが捻れる（腰は動かない）

### 観察のコツ
1. 編集モードで **spine1のpitchだけ動かす** → 体全体が前傾する
2. **chestのyawだけ動かす** → 胸から上だけが捻れる（腰は正面）
3. **spine1 = 10°, chest = 30°のyaw** → 腰は少し、胸は大きく捻る（人体らしい）
4. 3つ合計で合計角度を作ると、1関節に集中させるより自然に曲がる

### 攻撃モーションでの活用
Swingプリセットを3分割で書き直し:
- **windup**: 腰はやや反る(-3°)、胸椎・胸上部で捻り(20°→40°) → 右肩を後ろに引く
- **strike**: 腰が前傾(8°)、胸椎・胸上部を逆方向に捻り戻す(-12°→-20°) → 右肩を前へ
- **鞭のような連鎖運動**: 腰→胸→肩→手 と力が伝わる感覚が出る

---

## 次のステップ候補

- ポールヒントをスライダーで動かして肘・膝の曲がる方向を変える
- 新しいプリセット（パンチ、蹴り、ジャンプ）を自作
- 2つのポーズ間の補間速度を変えて「ため」を作る
- モーションを録画・保存・再生する仕組み
