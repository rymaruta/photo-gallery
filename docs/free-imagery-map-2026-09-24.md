# Keyless, no-paid-plan geographic imagery — Journey Photo

## Requirement

Owner requirement: **no payment, no credit card, no monthly plan, no paid API key, including after public launch**. MapTiler's $0 development tier is therefore NOT the design baseline. This branch does not call MapTiler, Mapbox, Google Maps or Esri's metered satellite API.

It is based on PR #150 and is a free-source alternative to dependent PR #154 (MapTiler hybrid). It does **not** claim that a public photo SNS's hosting, user-upload storage, image traffic or general operational costs will be zero.

## Real-world imagery and coverage (NOT Google Earth at every zoom)

The [GSI official tile list](https://maps.gsi.go.jp/development/ichiran.html) documents these real geographic image datasets, and [GSI's realtime tile usage guide](https://maps.gsi.go.jp/development/) permits direct interactive website/app display with attribution, without a separate map usage application. Check each tile's additional data-source credits, source rights and any future service policy changes before public release.

| View | Real source | Documented native tile zoom | Main limitation |
|---|---|---:|---|
| Whole world | GSI World Satellite Mosaic (MODIS) `/xyz/modis/` | 2–8 | Very low resolution; not equivalent to close-up aerial maps, some global areas missing. At zoom 9+ outside Japan, **show honest vector geography** rather than blurry invented detail. |
| Japan, wide view | GSI Japan Landsat mosaic `/xyz/lndst/` | 2–13 | Landsat resolution is not building-level photography. |
| Japan, close-up | GSI Japan seamless orthophoto `/xyz/seamlessphoto/` | 14–18 | Coverage depends on the government imagery mosaic, age varies. Some areas lack photos and GSI may have additional third-party credits. |

Implementation: MapLibre raster sources rendered within the already-existing **ONE Leaflet/MapLibre map**, behind place-name labels and the photo/official-guide pins. Imagery is undimmed, naturally colored and not a CSS-shaded fake. Place names remain; administrative / territorial / maritime boundaries are hidden. At absent sources/zoom the underlying freely available OpenFreeMap vector map remains visible rather than pretending to be high-detail satellite photography.

The [OpenFreeMap service](https://openfreemap.org/) says its public vector maps are free and commercially permitted without keys or view limits, but its service has no SLA and could change. Preserve map and underlying-data attribution.

**Be precise about 'completely free':** at the moment these public *map providers* do not require paid subscription/API keys for the specified usage. No provider can promise perpetual availability, coverage, unlimited availability or the absence of future policy changes. App infrastructure (hosting/bandwidth/storage) may still have costs. This proposal must never be sold as a guaranteed Google Earth-quality free global imagery service.

## Copyright and geography

Always show `国土地理院（地理院タイル）` linked to the official tile list. For Landsat, also credit GSI/TSIC/GEO Grid/AIST/USGS as documented by GSI. For MODIS, credit NASA LP DAAC/USGS EROS and use the individual imagery source citation prescribed by GSI. Some orthophoto tiles embed third-party imagery requiring extra source credits; audit the GSI tile source policy before launch. Do not download or redistribute provider tiles in bulk or remove visible attribution.

Map photo post coordinates remain subject to existing public/approximately-rounded coordinate protections. No fake user photos or official spots have been published.

## Acceptance checks

- Test script: `npx vitest run app/map/__tests__/page.test.tsx app/map/__tests__/MapPhotoSheet.test.tsx app/map/__tests__/freeImagery.test.ts`.
- Draft-only GitHub Action runs Next.js and tries screenshots at mobile 390×844 and desktop 1280×800. Screenshot evidence is **only** labelled FREE-REAL-IMAGERY when browser receives at least one actual GSI imagery response HTTP 200.
- Critically verify Japanese close-up at native zoom 14–18 (rather than only Greece zoom 5 using coarse world MODIS), boundary disappearance where tiles unavailable, source attribution, geolocation controls, photo pins, and browser errors.
- If GitHub Actions fails before allocating a runner or no GSI imagery HTTP 200 was received, report test/screenshot not verified and leave PR in Draft. Do NOT reuse old MapTiler/blue-vector screenshots and claim they demonstrate this version.

## Why NOT use alternative free-looking providers

- EOX cloudless tiles for recent years specify **non-commercial** use for their free service; not a safe default for a public photo SNS without further licensing.
- Sentinel/Copernicus satellite data itself is openly licensed, but downloading, assembling and distributing an always-on global high-resolution commercial map is a separate storage, processing and tile delivery problem with potential operational costs.
- Free quotas of subscription mapping services are not a permanent zero-cost service guarantee.
