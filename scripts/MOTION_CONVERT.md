# Mixamo → Babylon.js モーション変換

Mixamo の FBX アニメーションを、ターゲットキャラ（qm 系リグの GLB）へ
retarget し、Babylon.js でそのまま読める **1つの GLB（複数クリップ入り）**＋
ランタイム用 metadata を生成するパイプライン。

```
config.json ──▶ scripts/convert-motions.mjs
                  │
                  ├─(1) Blender: scripts/blender/convert_motions.py
                  │        全クリップを retarget → <glbOut>.glb (複数アニメ)
                  │
                  └─(2) Node: metadata 生成
                           <assetsDir>/<assetId>/bone-mapping.json
                           <assetsDir>/<assetId>/animator.json (雛形/上書きしない)
                           <assetsDir>/assets-manifest.json (entry を upsert)
```

## 使い方

```bash
# 設定ファイルを用意（scripts/motion-convert.config.example.json を複製）
npm run convert:motions -- scripts/motion-convert.config.example.json
```

- Blender 実行ファイルは既定で `C:\Program Files\Blender Foundation\Blender 5.0\blender.exe`。
  異なる場合は環境変数 `BLENDER_PATH` で上書き。
- 生成物はそのまま `UnityAssetLoader`（`src/runtime`）で `assetId` を指定して読める。

## 設定ファイル

| フィールド | 必須 | 内容 |
|---|---|---|
| `assetId` | ✓ | アセット ID（出力フォルダ名・manifest の id） |
| `targetRig` | ✓ | ターゲットリグ GLB（mesh+skeleton）。絶対パス or リポジトリルート相対 |
| `glbOut` | ✓ | 出力 GLB（リポジトリルートからの相対）|
| `clips` | ✓ | `[{ name, fbx, loop }]`。`name`=クリップ名、`fbx`=Mixamo FBX 絶対パス |
| `rigPreset` | | bone-mapping 生成元プリセット（既定 `mixamo`）。`src/runtime/avatar/presets/` を参照 |
| `scaleFbxToGlb` | | cm→m スケール（既定 `0.01`、Mixamo FBX は cm）|
| `assetsDir` | | metadata 出力先（既定 `public/assets`）|
| `defaultClip` | | animator 雛形の初期ステート（既定: 先頭クリップ）|
| `sourceLabel` | | manifest の `sourcePath` ラベル |

## 変換ロジックの核：rest 差補正

Mixamo ソースとターゲット（qm）リグは、**腕・脚の rest（bind）姿勢がボーン
長軸まわりに 180° ロールずれている**ことがある（Hips/Spine は一致）。

素朴な「ワールド回転コピー」`targetWorldRot = sourceWorldRot` はこの rest 差を
無視するため、手足が bind から 180° ねじれ、**手のひら・つま先が前後逆**になる。

そこで各ボーンに定数補正を掛ける：

```
C_bone       = restS_world⁻¹ · restT_world        (rest のロール差を打ち消す)
targetWorldRot(frame) = sourceWorldRot(frame) · C_bone
```

- `restS_world` / `restT_world` … ソース / ターゲットの rest ワールド回転。
- rest が一致するボーン（Hips/Spine）は `C ≈ 単位` で従来通り。
- 腕・脚のロール差だけが打ち消され、手足の前後反転が解消する。

スケール（cm→m）はソースアーマチュアを `scaleFbxToGlb` 倍して吸収。Hips のみ
ワールド位置もコピーしてルートモーションを保持。各フレームを手動ベイクし、
クリップごとに名前付き action として GLB へ出力（`export_animation_mode=ACTIONS`）。

## 出力と Babylon 連携

- GLB: ターゲット mesh + 各クリップ（glTF animation = `clips[].name`）。
- `bone-mapping.json`: プリセットを GLB 実ボーンで絞った標準名⇔ソース名の対応。
- `animator.json`: 各クリップを 1 ステートにした **雛形**（遷移なし、`defaultClip`
  を初期ステート）。既存があれば上書きせず `animator.scaffold.json` に出す。
  遷移・パラメータは手で追記する想定。
- `assets-manifest.json`: `assetId` の entry を upsert。`glbPath` は web パス
  （例 `/motion-test/qmdancer.glb`）。

## 制限・メモ

- ターゲットは qm 系（Mixamo 由来の同名ボーン）を想定。bone-mapping は同名対応。
- 指ボーンを持たないリグでは、FBX の指カーブはエクスポート時に無視される（警告のみ）。
- 長尺クリップは手動ベイクのため時間がかかる（1フレーム毎に depsgraph 更新）。
- 詳細な向き調査メモ・実測は会話メモリ `project_glb_orientation` を参照。
