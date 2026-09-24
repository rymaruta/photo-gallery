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

## World-map expansion: official national imagery (2026-09-24)

The existing GSI MODIS layer remains a *low-resolution world overview*, not a
worldwide close-up satellite map. `OFFICIAL_COUNTRY_IMAGERY` in
`app/map/loadVectorBasemap.ts` now registers thirteen geographic extents spanning
ten additional countries, in addition to Japan (Belgium: Flanders only; Australia: New South Wales only):

| Country/area | Government source | Keyless endpoint / technical notes | Implementation status |
|---|---|---|---|
| United States: contiguous US, Alaska, Hawaii | USGS The National Map, Imagery Only; mostly USDA NAIP imagery in the contiguous US | ArcGIS cached image tiles in `/{z}/{y}/{x}` order, requested at z9–16. USGS says its own National Map map-service data are free/public domain, but Alaska imagery can contain third-party restrictions. | Source configured; region imagery/browser checks pending |
| Metropolitan France (including Corsica in bounding box) | IGN Géoplateforme, `ORTHOIMAGERY.ORTHOPHOTOS` | Public WMTS `data.geopf.fr/wmts`, PM Web Mercator matrix, z9–19 requested; check the actual layer matrix limits, format, CORS and terms before release. French overseas territories not included. | Source configured; tile response and license/service checks pending |
| Spain mainland + Balearic Islands and Canary Islands | Spain IGN/CNIG PNOA `OI.OrthoimageCoverage` | Public WMTS, `GoogleMapsCompatible` matrix, z9–19 requested. CNIG PNOA licensing requires origin/property attribution and is described as CC-BY-4.0-compatible; inspect service terms for application use. | Source configured; tile response and license/service checks pending |
| Switzerland | Federal Office of Topography swisstopo SWISSIMAGE | Keyless 3857 WMTS orthophoto z9–19 requested. Its geoservices are free without signup within a documented fair-use request limit; exceeding that limit may require a paid contract, which this project must not enter. | Source configured; actual tiles/fair-use sizing pending |
| Netherlands | Dutch government PDOK / Beeldmateriaal `Actueel_ortho25` | Open aerial imagery WMTS with 3857 tiles, z9–19 requested, source attribution required. | Source configured; actual tile response/terms pending |
| Austria | Austrian provinces and Vienna basemap.at Orthofoto | Public, keyless Google3857 WMTS REST cache with z/y/x order; z9–19 requested; basemap.at requires linked source credit and permits commercial use under CC BY 4.0. | Source configured; live browser proof pending |
| Czechia | ČÚZK Ortofoto ČR | Web Mercator ArcGIS cached tiles (z/y/x); z9–20 requested. Source dataset is provided as open data under CC BY 4.0; check individual service terms and attribution in released app. | Source configured; live browser proof pending |
| Belgium (Flanders and imagery-covered parts of Brussels only) | Digitaal Vlaanderen `omwrgbmrvl` winter orthophoto | Free public WMTS with `GoogleMapsVL` matrix and PNG tiles; requested z9–19. **Not a claim of coverage of the Walloon region or all of Brussels.** | Source configured; live browser proof pending |
| Poland | GUGiK Geoportal `ORTOFOTOMAPA` | Public national orthophoto `StandardResolution` WMTS using EPSG:3857 and JPEG; z9–19 requested. National dataset is described as free to download and use; confirm separate live tile access and web-service terms. | Source configured; live browser proof pending |
| Australia (New South Wales only) | NSW Spatial Services `NSW_Imagery` | NSW state government publishes public Web Mercator ArcGIS image tile cache, requested at z9–18. NSW data catalogue lists public imagery WMTS under CC BY 3.0 and its spatial services terms require state attribution; source includes externally copyrighted aerial images, so verify third-party rights before any public commercial release. **Not Australia-wide.** | Source configured; Sydney live browser proof and third-party rights pending |

Official references (not inferred rights for third-party content):

- USGS Imagery Only service: https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer
- USGS map service terms: https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map
- France IGN WMTS public access and GetTile syntax: https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/diffusion/wmts/
- France imagery catalogue: https://cartes.gouv.fr/
- Spain PNOA official service: https://pnoa.ign.es/pnoa-lidar/visualizadores-y-servicios-web
- Spain CNIG PNOA license example: https://centrodedescargas.cnig.es/CentroDescargas/detalleArchivo?sec=11547781
- swisstopo open data and fair-use request limits: https://www.swisstopo.admin.ch/en/faq-free-geodata
- swisstopo WMTS technical documentation: https://docs.geo.admin.ch/visualize-data/wmts.html
- Dutch PDOK open aerial photo service: https://www.pdok.nl/ogc-webservices/-/article/pdok-luchtfoto-rgb-open-
- Dutch PDOK raw WMTS tile URL reference: https://github.com/geo-frontend/nlmaps
- basemap.at Austrian Orthofoto and terms: https://basemap.at/en/orthofoto/ and https://basemap.at/
- basemap.at official migrated WMTS domain: https://cdn.basemap.at/basemap.at%20und%20ViennaGIS%20WMTS_URL_Umstellung_2023.pdf
- ČÚZK Web Mercator tiled ArcGIS service: https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer
- ČÚZK open orthophoto rights: https://www.cuzk.gov.cz/Uvod/Produkty-a-sluzby/Otevrena-data/Otevrena-data-zakladni-informace.aspx
- Digitaal Vlaanderen current orthophoto service catalogue: https://www.vlaanderen.be/datavindplaats/catalogus/wmts-orthofotomozaiek-middenschalig-winteropnamen
- Digitaal Vlaanderen WMTS tile matrix example: https://www.vlaanderen.be/digitaal-vlaanderen/nieuws-0/lambert-2008-projectie-beschikbaar-voor-tegeldiensten-wmts
- Polish government WMTS Orthophotomap documentation: https://www.geoportal.gov.pl/en/data/orthophotomap-orto/
- Polish WMTS `StandardResolution` service: https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS%26REQUEST=GetCapabilities
- NSW Spatial Services active cached imagery: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer
- NSW government spatial-services terms (third-party data caveat): https://www.spatial.nsw.gov.au/products_and_services/web_services/terms_and_conditions
- NSW government imagery catalogue and license listing: https://data.nsw.gov.au/data/en/dataset/nsw-imagery/resource/ea1cad4d-3a56-4b3c-9b55-3da83086877a

**Coverage is not national-border-accurate yet.** MapLibre raster-source `bounds`
are rectangular request limits, not country masks. Near borders (notably
France/Spain, France/Switzerland, Austria/Switzerland, Czechia/Poland, Netherlands/Belgium, Belgium/France, Spain/Portugal, US/Canada/Mexico), providers may return blank
tiles or mixed/low-resolution imagery. Check that those tiles do not cover
neighboring imagery incorrectly; if needed, use country-clipped raster
tiles or an audited per-region masking strategy before production.
No maritime border or political boundary overlay should be introduced.

**Do not call this “all countries complete.”** The remaining countries,
French overseas regions and international waters do not yet have a validated
keyless official high-detail imagery source. Adding each country requires
verifying whether that agency offers an open service, its permitted use,
attribution, correct projection/tiling, sufficient coverage, CORS, rate
limits and long-term availability. If any source is unavailable or unsuitable,
the existing GSI low-resolution global overview or real free vector basemap
remains instead of fake detail or paid API usage.

Run `npx vitest run app/map/__tests__/freeImagery.test.ts` and
`node scripts/capture-free-imagery-local.mjs` in an internet-connected
development environment with dependencies installed. The latter creates
**temporary** proof pages for Japan, world overview, US, France, Spain, Switzerland, the Netherlands, Austria, Czechia, Flanders, Poland and NSW (Australia),
checks for a real HTTP 200 image response from each corresponding provider,
and only then saves mobile/desktop screenshots. Static tests do not prove
tile access. The screenshot CI for the original five-country expansion was later confirmed successful on GitHub, but the four newly added country/region checks must be validated on the corresponding updated-branch run. A successful HTTP 200 image response is still not a full visual/rights/availability audit. **Do not mark the new regions fully verified before reviewing the new screenshots and service terms.**

No PR merge, production deploy, account signup, card registration, paid API
or paid runner was performed.

## Next regions in PR #157 — Estonia and Germany/NRW (2026-09-25)

**Two more countries registered as draft preview sources, not production-complete countries.**

| Area | Official service and license | Source URL shape | Honest scope / required verification |
|---|---|---|---|
| Estonia | Republic of Estonia Land and Spatial Development Board (Maa- ja Ruumiamet), national orthophoto. Official public web-service terms expressly permit commercial reuse with attribution (data title, approximate date/year, agency) and prohibit disruptive request rates. | Official public tile service `https://tiles.maaamet.ee/tm/wmts`, `LAYER=foto`, Web Mercator `TILEMATRIXSET=GMC`, z9–18 requested; service-identification parameters `ASUTUS=JOURNEYPHOTO&KESKKOND=LIVE&IS=JOURNEYPHOTO` used in place of a proxy as described in the agency's older technical guide. | Actual tile response, content-type, matrix IDs, browser CORS, current service identification requirements and year-specific attribution pending CI and release audit. Request volume must remain moderate. |
| Germany — North Rhine-Westphalia (NRW) only | German Land Geobasis NRW official DOP orthophotos under government open-data licensing; **not** the nationwide BKG DOP20 service restricted to government/entitled users. | WMTS cache `https://www.wmts.nrw.de/geobasis/wmts_nw_dop/tiles/nw_dop/EPSG_3857_16/{z}/{y}/{x}`; z9–16 requested. | The provider has several tile matrices and REST patterns; verify actual Web Mercator alignment via Cologne photo proof. Coverage limited to NRW, not Germany as a whole. |

Official references:
- Estonia WMTS layers and projections (orthophoto in national and Web Mercator matrices): https://geoportaal.maaamet.ee/docs/WMS/MapCache_teenused_juhend_v2.pdf
- Estonia public map service conditions (free, commercial permitted with attribution, no guaranteed SLA, avoid disruptive access): https://geoportaal.maaamet.ee/index.php?lang_id=1&page_id=24
- Estonia official TMS/WMTS guidance and identification requirements: https://geoportaal.maaamet.ee/est/Teenused/WMS-teenused/TMS-WMS-C-ja-WMTS-teenused-p481.html
- Geobasis NRW official open imagery licensing catalog: https://www.govdata.de/suche/daten/digitale-orthophotos-nwadd54
- German NRW WMTS service: https://www.wmts.nrw.de/geobasis/wmts_nw_dop/1.0.0/WMTSCapabilities.xml
- Nationwide BKG DOP20 *not* used (restricted entitlement): https://gdz.bkg.bund.de/index.php/default/webdienste/digitale-orthophotos/wmts-digitale-orthophotos-bodenauflosung-20cm-wmts-dop.html

CI proof: the same existing screenshot workflow now checks Tallinn and Cologne at z13 on mobile and desktop. Screenshots for these regions are saved **only if the matching national agency returns an actual HTTP 200 image**. The screenshot must also be reviewed for visible alignment, meaningful aerial detail, unwanted country-border rectangles, and false-positive blank imagery. Do not claim country-wide completion on the basis of one city tile. No new subscription, card, key, hosting, merge or deployment.

## Luxembourg CC0 orthophoto (2026-09-25)

The official Luxembourg Administration du cadastre et de la topographie (ACT) publishes nationwide orthoimagery and keyless Web Mercator WMTS as CC0 open data:
https://data.public.lu/en/datasets/bd-l-ortho-webservices-wms-et-wmts/

The WMTS GetCapabilities advertises `ortho_2023`, `GLOBAL_WEBMERCATOR_4_V3`, `image/jpeg`, and a REST ResourceURL with **TileCol then TileRow**:
https://wmts1.geoportail.lu/opendata/wmts/1.0.0/WMTSCapabilities.xml

The draft source uses `https://wmts1.geoportail.lu/opendata/wmts/ortho_2023/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg` within Luxembourg's published bounds and requested z10–19. Explicitly use the 2023 dataset instead of assuming any later imagery is automatically CC0. Confirm actual imagery requests and visual geographic alignment in Luxembourg City via the updated CI/mobile/desktop screenshot proof. Do not label the entire country as quality-checked from one city test. No cost, registration, new API key, merge or deployment.
