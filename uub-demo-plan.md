# Unity Uub (Human Basic Motions) Babylon.js 移植プラン

## 概要

Unity プロジェクト `C:\Users\user\My project` に含まれる Kevin Iglesias 製アセット「Human Basic Motions FREE」を Babylon.js + Next.js（既存 battle-game プロジェクト内）で段階的に再現する。

**目的**: Unity Animator の動作（特に 2 レイヤーアニメーション + SpineProxy）を Babylon.js で実装する学習・検証。

## ⚠️ ライセンス注意

`Human Basic Motions FREE` は Unity Asset Store の無料アセット。原則として Unity 以外への移植・再配布は規約違反になる可能性がある。

- **MVP〜Phase 2**: ローカル個人検証用途。Web デプロイしない
- **公開段階**: アセット同梱の `Human Basic Motions 2.4 FREE.pdf` を読んでライセンス条件を確認。必要なら作者に確認 or 別アセットへ差し替え
- FBX ファイルは `.gitignore` で Git 管理外にする

## 移植対象（元 Unity プロジェクト）

| 要素 | 元の場所 |
|---|---|
| Model (♂) | `Assets/Kevin Iglesias/Human Animations/Models/HumanM_Model.fbx` |
| Model (♀) | `Assets/Kevin Iglesias/Human Animations/Models/HumanF_Model.fbx` |
| アニメ | `Assets/Kevin Iglesias/Human Animations/Animations/{Female,Male}/...` （計86 FBX）|
| Animator | `Assets/.../AnimatorControllers/HumanBasicMotionsScene.controller` |
| Avatar Mask | `.../AnimatorControllers/` 内（GUID `142a22760aae71...`）|
| SpineProxy スクリプト | `Assets/Kevin Iglesias/Human Animations/Scripts/SpineProxy.cs` |
| Demo シーン | `.../Unity Demo Scenes/Human Basic Motions/Human Basic Motions FREE - Unity Demo Scene.unity` |
| Demo スクリプト | `.../Script/HumanBasicMotionsDemo.cs` |

## 元アセットの主要構造（解析済み）

- **リグ**: Generic Rig（Humanoid ではない）、独自命名 `B-` プレフィックス
  - HumanM: 59 Models（Bone 51 / Mesh 1 / Null 6 / Root 1）、Y-up
  - HumanF: 58 Models（Bone 56 / Mesh 1 / Null 1）、**Z-up**（軸違い注意）
- **キー特殊ボーン**: `B-spineProxy` — 上半身レイヤー再生時に背骨を補正する独自機構
- **Animator**: 2 レイヤー（Base / Upper + Mask）、Trigger `ClearUpper`
- **演出**: トレッドミル床（RootMotion を UV オフセットに反映）、ブロブシャドウ（両足の距離からスケール）

## 技術スタック（既存活用）

- Next.js 15 + React 19 + TypeScript
- Babylon.js 8.50（@babylonjs/core, /loaders, /materials）
- `fbx-parser` 2.1（既存 devDependency）
- `src/lib/motion-converter/` — 既存の座標変換パイプライン（Y-up→Y-up + cm→m + RH→LH）
- `scripts/extract-bones.mjs` — 既存 FBX ボーン抽出スクリプト（Mixamo Y Bot 用 → 汎用化予定）

## Phase 1: MVP（最小動作確認）★今ここ

### 目標
HumanM_Model.fbx を Babylon.js で表示、Idle01.fbx を再生してループする。

### 範囲外（やらない）
- HumanF, 他アニメ, 2 レイヤー, SpineProxy, RootMotion, UI, 床演出

### ステップ
1. `public/uub/` に `HumanM_Model.fbx` と `HumanM@Idle01.fbx` をコピー（.gitignore 対象）
2. `scripts/extract-uub.mjs` を作成 — FBX → `bone-data.json` + `motion.json` を生成（既存 extract-bones.mjs をベース）
3. `motion-converter/pipeline.ts` が HumanM データに対応できるか確認、必要なら `bone-mapping.ts` に Kevin Iglesias リグの定義を追加
4. `src/app/learning/uub-demo/page.tsx` を作成
   - Babylon.js Scene + Camera + Light セットアップ（既存 ik-fk デモを参考）
   - Skeleton 構築（bone-data.json から）
   - SkinnedMesh 構築（FBX 内のメッシュデータが必要 → SceneLoader.ImportMesh では FBX 非対応のため自前構築 or 別経路検討）
   - AnimationGroup 構築（motion.json から）
   - 再生
5. `npm run dev` でブラウザ確認

### 想定リスク・未確認事項
- ⚠️ Babylon.js は FBX 非対応 — メッシュデータの取り込み経路を確認必要
  - 案A: FBX を Blender で GLB 変換してから読込（FBX→GLB 経路の問題は memory 参照）
  - 案B: 自前で FBX バイナリからメッシュ頂点・スキニングウェイトを抽出
  - 案C: メッシュは仮（ボックス）にしてボーン階層と動きだけ確認
- `B-spineProxy` を含む 51 ボーンが既存 `bone-mapping.ts` の Mixamo 系命名と異なる → マッピング再定義必要

## Phase 2: アニメ拡張（未着手）

- Idle01, Idle02, Idle01↔Idle02 遷移、Walk_Forward、Run_Forward の 5 種を読込
- UI でクリップ選択
- AnimationGroup 切替

## Phase 3: 2 レイヤー + Avatar Mask（未着手）

- Avatar Mask `.mask` から「上半身ボーン名リスト」を抽出
- Base レイヤー（全身）+ Upper レイヤー（上半身のみ）の混在再生
- Babylon.js には Unity の AnimatorLayer 相当が無いため、Bone ごとに「どのレイヤーの値を使うか」を制御する自前ミキサーが必要

## Phase 4: SpineProxy 機構（未着手）

- `SpineProxy.cs` を TypeScript 化
- 上半身アニメ再生中に B-spine の回転を B-spineProxy に転写する処理

## Phase 5: 演出再現（未着手）

- ブロブシャドウ（両足距離からスケール、ジャンプ高度でアルファ）
- トレッドミル床（Root Motion を床マテリアルの UV オフセットに反映）
- カメラピボット回転、FOV ズーム

## Phase 6: デモ UI 完成（未着手）

- フォルダ階層ボタン UI
- キャラ切替（M/F、※ HumanF の Z-up 対応必要）
- 2 レイヤー切替タブ

## ファイル配置案

```
battle-game/
├── public/
│   └── uub/                          ← FBX 一式（.gitignoreで除外）
│       ├── HumanM_Model.fbx
│       └── animations/
│           └── HumanM@Idle01.fbx
├── public/uub-data/                  ← 変換済み JSON（Git管理）
│   ├── bone-data-humanM.json
│   └── motions/
│       └── HumanM@Idle01.json
├── scripts/
│   └── extract-uub.mjs               ← FBX → JSON 変換スクリプト
├── src/
│   ├── app/learning/uub-demo/
│   │   └── page.tsx                  ← Babylon ビューア
│   └── lib/motion-converter/
│       └── bone-mapping.ts           ← Kevin Iglesias リグ命名を追加
└── uub-demo-plan.md                  ← このファイル
```

## 完了基準（MVP）

- [ ] ブラウザで `/learning/uub-demo` が開く
- [ ] HumanM のシルエット or プレースホルダーが表示される
- [ ] Idle01 のアニメーションが再生される（カクついていてもOK、動きが見える）
- [ ] エラーログがコンソールに出ていない
