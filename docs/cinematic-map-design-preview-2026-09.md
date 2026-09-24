# Journey Photo — cinematic map design prototype (2026-09-24)

**Status: separate design branch, not merged or deployed.** Source branch: `design/cinematic-map-preview-20260924` (from current `develop`). This PR is an **independent alternative** to the two-map approach proposed in PR #148. It does not cherry-pick #148's map code or add a second Leaflet instance.

## Objective and design

Reference: owner-provided "撮影地マップ画面（最終版）" showing a navy map, photographic pins, distinct official markers, selected-place card, area search and five-tab navigation.

- Continue using the **one existing** `PhotoMap` from PR #143 (now merged into develop). The photo markers, official markers, current-location button, and search-this-area button operate on the same map.
- Give that map a cinematic navy cartographic surface and blue enamel-style official spot pins while leaving photo pins distinct.
- Show the published official spot list **below the map on mobile** (horizontal scrolling); on desktop it remains in the left column. When "search this area" is selected, the official list filters to the same view bounds as the photo results.
- Enlarge `MapSpotSheet`'s licensed cover photo, add the short published-guide summary where present, and place required photo credits in readable text (not 8px over the thumbnail). Keep the guide and "want to go" operations.
- **Fix existing zero-user-photo dead-end:** a published official spot with a confirmed map point makes the map visible even if there are zero GPS-tagged user photos. Do not add any fake official spots/photos to production data.

## Real cartography and key

A high-quality real basemap is provided by **MapTiler's actual dark raster tiles**, using the current Leaflet instance. Set an authorised browser/API key in the build environment:

`NEXT_PUBLIC_JOURNEY_MAPTILER_KEY=<browser key restricted to journey-photo.com and preview domains>`

The client directly requests `https://api.maptiler.com/maps/streets-v4-dark/256/{z}/{x}/{y}.png?key=...`. The tile source, public key, usage limits, commercial terms and domain/referrer restrictions must be reviewed and configured by the owner before any production deployment. Both MapTiler and OpenStreetMap attribution remain visible in the map.

**When the key is unset:** the existing `tile.openstreetmap.org` tile layer is retained and visually tinted by a CSS filter as a **temporary design fallback only**, not a claim of production-grade map quality. The OSM public tile service has usage rules and no SLA; replace the fallback with a properly licensed provider before commercial rollout. Never cache or mass-download its tiles.

This prototype deliberately keeps Leaflet rather than migrating to MapLibre in one PR. MapLibre + a licensed vector-map provider can replace the renderer in a future PR after map-style/key approval and a screenshot/interaction comparison; this prototype tests visual direction without risking the existing geolocation and clustering implementation.

## Screenshot: what was and was not run

- A **self-contained HTML/CSS design preview** was rendered by local Chromium/Playwright at **390×844 mobile** and **1280×800 desktop**. It uses a clearly labelled **fictional schematic map** and three previously generated AI demo images, *not* OSM/MapTiler tiles or a running Next.js app. Therefore the screenshots demonstrate layout, pin proportions, visual hierarchy and sheet design, but **do not prove the actual /map Next.js route, real map loading, live spot data, coordinate accuracy, or saved-place API**. The standalone HTML preview and PNG screenshots are delivered as chat files; they are not part of the production source tree.
- The private repository could not be cloned into the screenshot runtime, and outbound map-tile loading is not available there. **No end-to-end screenshot of the running branch has been captured.** Do not describe the demo PNGs as real maps or the actual app.
- PR contains unit test cases for **zero-post official spots** and **shared area-filtering**; those new tests were authored but the full repository test/build suite has **not yet been run** in the screenshot runtime.

## Required checks before merge

1. With a legitimate MapTiler browser key configured on a preview deployment, capture the **real** `/map` at 390×844 and 1280×800 (initial/selected/cluster/current-location/zero-user-photo/no-license-cover/error state); check tiles, attribution, responsive layout and real markers. Do not publish test spots to production just to make the screen look populated.
2. Run `npm run verify` and the existing map/saves/visibility/SEO suites; inspect screenshots and fix regressions.
3. Check marker click vs map-background click, current-location denied/allowed, photo privacy/GPS rounding, search-area sync, a currently selected marker outside the new bounds, long title/credit text and bottom-nav/MiniPlayer/sheet overlap.
4. Obtain owner review of both the mobile and desktop real-app screenshots before merging this alternative or conflicting PR #148 into develop/main.
5. Once the owner selects one map approach, resolve the conflicts explicitly. Do **not** merge the second Leaflet/OfficialSpotExplorer implementation from PR #148 into this branch.


## 2026-09-24 継続実装：実在するベクター地図へ変更

**以前のオフラインHTMLで描いた架空の地図は採用しない。** オーナーから「本物の地図になっていない」という再指摘があり、今回の変更で **`PhotoMap` の既定のベースマップを本物のOpenFreeMap Fiordベクタースタイル**（`https://tiles.openfreemap.org/styles/fiord`）に変更した。

- 1つの既存Leaflet地図を使い、MapLibre GL JS 5.16.0 + `@maplibre/maplibre-gl-leaflet` 0.1.4で**背景地図のレイヤーだけ**を描画する。海岸線・道路・町名は実際の地図ベクターデータであり、CSSで色を塗った模式図ではない。
- ピン・現在地・地図履歴・既存の公式スポットカード・検索範囲はLeafletのまま。**2つ目の地図インスタンスは作らない。**
- 見える地図を確保するため、ベクタースタイルの実読込が終わるまでOSMの実タイルを表示。ライブラリ/外部地図への接続が失敗した場合はOSM地図を残し、失敗メッセージを表示する。OSMタイルをCSS反転して「実地図風」に見せる処理を削除した。
- **重要: 今回はDraft試作限定のCDNランタイム読み込み。** MapLibre/Leafletブリッジを固定バージョンのCDNから読み込むため、CDN停止、SRI未設定、CSP、通信状態に依存する。**本番リリース前にnpmで依存関係を管理・固定し、監査済みのJS/CSSを同一サイトのアセットとして配信する実装へ切り替える**。実機でWebGL・CSP・低速通信を確認するまで本番にはマージしない。
- OpenFreeMapの公式説明はキー不要の公共インスタンスであることを示すが、サービスの提供条件・帰属・運用負荷は公開前に改めて確認する。MapLibre本体とOpenFreeMapのライセンス・帰属を維持する。
- **この接続からは実際の地図タイルの描画確認ができない**。従来のスクリーンショットは依然「架空の背景図によるHTMLプレビュー」であり、新しい実ベクター地図を証明しない。実アプリで地図のタイルと地名が描画された**新規の**390px/1280pxスクショが必要。
