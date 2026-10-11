/**
 * clip-settings.json（`tools/unity-import/cli/extract-clip-settings.ts` が
 * Unity の .meta から生成）を読み込むランタイム側ローダー。
 *
 * GLB にはボーンの曲線しか入らないため、ループ可否 / ルートモーション /
 * イベントといった「再生設定」はこの JSON から取得して使う。
 */

export interface ClipRootMotionAxes {
  /** true = ルートモーションがこの軸を駆動する（Bake Into Pose が OFF） */
  rotation: boolean;
  positionY: boolean;
  positionXZ: boolean;
}

export interface ClipSettings {
  name: string;
  /** ループ再生するか（Unity の Loop Time） */
  loop: boolean;
  firstFrame: number;
  lastFrame: number;
  rootMotion: ClipRootMotionAxes;
  bakeIntoPose: ClipRootMotionAxes;
  events: { time: number; functionName: string }[];
}

export interface ClipSettingsAsset {
  id: string;
  sourcePath: string;
  clips: ClipSettings[];
}

export interface ClipSettingsJson {
  generatedAt: string;
  source: string;
  assets: ClipSettingsAsset[];
}

/**
 * clip-settings.json を取得し、clip 名 → 設定 の Map にして返す。
 * ファイルが無い場合は空 Map（呼び出し側は loop=true 等の既定にフォールバック）。
 */
export async function loadClipSettings(
  baseUrl = "/assets/",
): Promise<Map<string, ClipSettings>> {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  const map = new Map<string, ClipSettings>();
  try {
    const res = await fetch(base + "clip-settings.json", { cache: "no-store" });
    if (!res.ok) return map;
    const json = (await res.json()) as ClipSettingsJson;
    for (const asset of json.assets) {
      for (const clip of asset.clips) {
        if (!map.has(clip.name)) map.set(clip.name, clip);
      }
    }
  } catch {
    // 取得失敗時は空のまま（既定動作にフォールバック）
  }
  return map;
}
