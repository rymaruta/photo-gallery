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
