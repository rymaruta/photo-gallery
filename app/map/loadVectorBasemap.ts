"use client";

import type { Map as LeafletMap, Layer as LeafletLayer } from "leaflet";

/**
 * Actual vector cartography for the single existing Leaflet map.
 *
 * Preview-only dependency strategy: fixed-version MapLibre GL JS v5 UMD +
 * official Leaflet bridge loaded from HTTPS CDN; no second Leaflet map or
 * fake/image-based basemap. For production, install audited npm dependencies
 * and ship their JS/CSS with the app instead of depending on runtime CDN.
 *
 * Background style is the REAL OpenFreeMap Dark vector style: coastline,
 * streets, place labels and geographic coordinates from OpenStreetMap.
 * https://openfreemap.org/quick_start/
 */
const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@5.16.0/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@5.16.0/dist/maplibre-gl.css";
const LEAFLET_BRIDGE = "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.js";
// "dark" is the restrained editorial/vector style. Fiord's bright contour
// outlines overpower photo pins at the Greece/Japan travel zoom levels.
export const REAL_DARK_MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

type VectorMap = {
    once: (event: string, callback: () => void) => void;
    on: (event: string, callback: (event?: unknown) => void) => void;
    off: (event: string, callback: (event?: unknown) => void) => void;
    loaded: () => boolean;
    getStyle: () => { layers?: Array<{ id: string; type: string }> };
    getSource: (id: string) => unknown;
    addSource: (id: string, source: Record<string, unknown>) => void;
    addLayer: (layer: Record<string, unknown>, before?: string) => void;
    setPaintProperty: (layerId: string, property: string, value: unknown) => void;
    setLayoutProperty: (layerId: string, property: string, value: unknown) => void;
};
type VectorLayer = LeafletLayer & {
    getMaplibreMap: () => VectorMap;
};
type Adapter = (options: { style: string; interactive: boolean; attributionControl: boolean }) => VectorLayer;
type BridgeWindow = Window & {
    L?: Record<string, unknown>;
    maplibregl?: object;
    MaplibreGLLeaflet?: { maplibreGL?: Adapter };
};
let adapterPromise: Promise<Adapter> | null = null;

function scriptOnce(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-journey-vector="${src}"]`);
        if (existing?.dataset.ready === "true") { resolve(); return; }
        const script = existing ?? document.createElement("script");
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            script.removeEventListener("load", onLoad);
            script.removeEventListener("error", onError);
            if (ok) { script.dataset.ready = "true"; resolve(); }
            else { script.remove(); reject(new Error(`Could not load vector map runtime: ${src}`)); }
        };
        const onLoad = () => finish(true);
        const onError = () => finish(false);
        const timeout = window.setTimeout(() => finish(false), 16000);
        script.addEventListener("load", onLoad);
        script.addEventListener("error", onError);
        if (!existing) {
            script.src = src;
            script.async = true;
            script.crossOrigin = "anonymous";
            script.dataset.journeyVector = src;
            document.head.appendChild(script);
        }
    });
}

/** Leaflet uses an ESM module namespace; the UMD adapter expects window.L. */
export function loadVectorAdapter(leaflet: typeof import("leaflet")): Promise<Adapter> {
    if (typeof window === "undefined") return Promise.reject(new Error("Browser-only map adapter"));
    if (adapterPromise) return adapterPromise;
    adapterPromise = (async () => {
        const w = window as BridgeWindow;
        // Copy the exports into a writable plain object. Classes and map() keep
        // their identity; the UMD adapter can register its L.maplibreGL factory.
        w.L = { ...leaflet };
        if (!document.querySelector('link[data-journey-maplibre-css]')) {
            const css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = MAPLIBRE_CSS;
            css.dataset.journeyMaplibreCss = "true";
            document.head.appendChild(css);
        }
        await scriptOnce(MAPLIBRE_JS);
        if (!w.maplibregl) throw new Error("MapLibre GL JS did not initialize");
        await scriptOnce(LEAFLET_BRIDGE);
        const adapter = w.MaplibreGLLeaflet?.maplibreGL
            ?? w.L?.maplibreGL as Adapter | undefined;
        if (typeof adapter !== "function") throw new Error("Leaflet vector bridge did not initialize");
        return adapter;
    })().catch((error: unknown) => {
        adapterPromise = null;
        throw error;
    });
    return adapterPromise;
}

/**
 * Readable midnight-blue palette for the REAL vector basemap.
 *
 * OpenFreeMap "dark" defaults to almost-black land (#0c0c0c), water (#1b1b1d),
 * road lines (#181818) and place names (#656565); on a phone the geography
 * disappears. Change ONLY visual paint in this one shared map instance.
 * Actual coastline/roads/labels remain provider-supplied vector geometry.
 *
 * Explicit IDs were checked against the live OpenFreeMap dark style on
 * 2026-09-24. Ignore absent IDs so provider changes cannot blank the map.
 */
function applyReadableMapPalette(gl: VectorMap): void {
    const layers = new Set(gl.getStyle().layers?.map((layer) => layer.id) ?? []);
    const paint = (id: string, property: string, value: unknown) => {
        if (!layers.has(id)) return;
        try { gl.setPaintProperty(id, property, value); } catch { /* retain source style */ }
    };

    // Geographic contrast: lighter slate-blue land against a deeper blue sea.
    paint("background", "background-color", "#2D455B");
    paint("water", "fill-color", "#113653");
    paint("waterway", "line-color", "#2F6586");
    paint("landcover_ice_shelf", "fill-color", "#667C8F");
    paint("landcover_glacier", "fill-color", "#637789");
    paint("landuse_residential", "fill-color", "#395368");
    paint("landcover_wood", "fill-color", "#355765");
    paint("landuse_park", "fill-color", "#3C625D");
    paint("building", "fill-color", "#365066");
    paint("building", "fill-outline-color", "#54718A");

    // Routes must be visible even where the NASA terrain texture is present.
    // Motorway casing remains darker than the road center for definition.
    paint("highway_path", "line-color", "#8EA6B9");
    paint("highway_minor", "line-color", "#708DA4");
    paint("highway_major_casing", "line-color", "#304B63");
    paint("highway_major_inner", "line-color", "#9AB2C7");
    paint("highway_major_subtle", "line-color", "#8AA4BC");
    paint("highway_motorway_casing", "line-color", "#385A75");
    paint("highway_motorway_inner", "line-color", "#C0D2E3");
    paint("highway_motorway_subtle", "line-color", "#A3BAD0");
    paint("railway", "line-color", "#7E9CB3");
    paint("railway_minor", "line-color", "#7894AA");
    paint("railway_transit", "line-color", "#7894AA");
    paint("railway_dashline", "line-color", "#324C63");
    paint("railway_minor_dashline", "line-color", "#324C63");
    paint("railway_transit_dashline", "line-color", "#324C63");
    paint("boundary_state", "line-color", "#7189A0");
    paint("boundary_country_z0-4", "line-color", "#8DA5BC");
    paint("boundary_country_z5-", "line-color", "#8DA5BC");

    // Explicitly lighten map labels, not Journey Photo's data-driven cards.
    // Dark halos keep long and small Japanese/English names readable.
    for (const layer of gl.getStyle().layers ?? []) {
        if (layer.type !== "symbol") continue;
        if (layer.id.startsWith("place_")) {
            paint(layer.id, "text-color", "#E4EEF8");
            paint(layer.id, "text-halo-color", "#1A2F44");
            paint(layer.id, "text-halo-width", 1.4);
        } else if (layer.id.startsWith("highway_name_")) {
            paint(layer.id, "text-color", "#B8D0E4");
            paint(layer.id, "text-halo-color", "#1A2F44");
            paint(layer.id, "text-halo-width", 1.2);
        } else if (layer.id === "water_name") {
            paint(layer.id, "text-color", "#AFD7ED");
            paint(layer.id, "text-halo-color", "#103451");
            paint(layer.id, "text-halo-width", 1.4);
        }
    }
}

/**
 * Completely keyless imagery from the Geospatial Information Authority of
 * Japan. Tile URLs and zoom limits are from GSI's official tile list:
 * https://maps.gsi.go.jp/development/ichiran.html
 *
 * Global MODIS: z2-8, comparatively coarse. Within Japan, Landsat imagery:
 * z2-13, seamless orthophotos: z14-18 where the agency has coverage. No
 * paid map API, metered account or browser key. Missing/offshore imagery
 * reveals the real OpenFreeMap vector map underneath; we never fake detail.
 *
 * For geographic image layers, the same MapLibre rendering surface and
 * Leaflet markers/selection controls are retained. Attribution stays visible.
 */
export const FREE_GSI_IMAGERY = {
    world: "https://cyberjapandata.gsi.go.jp/xyz/modis/{z}/{x}/{y}.png",
    japan: "https://cyberjapandata.gsi.go.jp/xyz/lndst/{z}/{x}/{y}.png",
    japanDetail: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
} as const;

/**
 * Regional official orthophotos layered over the global low-resolution map.
 * A source is registered only after finding its publicly documented tile endpoint.
 * Geographic bounds are REQUEST LIMITS, not precise national borders; the
 * provider controls actual pixel coverage. Review license, attribution, service
 * availability and displayed imagery before enabling a region in production.
 * Do not substitute a commercial/free-trial API or claim every country is covered.
 */
export const OFFICIAL_COUNTRY_IMAGERY = [
    // USGS The National Map. ArcGIS cache ordering is {z}/{y}/{x} (NOT XYZ).
    { id: "usgs-contiguous-us", country: "US", provider: "USGS / USDA NAIP",
        url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        bounds: [-125, 24, -66, 50], min: 9, max: 16, until: 17 },
    { id: "usgs-alaska", country: "US", provider: "USGS / USDA NAIP",
        url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        bounds: [-170, 51, -129, 72], min: 9, max: 16, until: 17 },
    { id: "usgs-hawaii", country: "US", provider: "USGS / USDA NAIP",
        url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        bounds: [-161, 18, -154, 23], min: 9, max: 16, until: 17 },
    // IGN France Géoplateforme, PM = Google-compatible EPSG:3857 tile matrix.
    { id: "ign-france", country: "FR", provider: "IGN France / Géoplateforme",
        url: "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        bounds: [-5.6, 41.2, 9.8, 51.3], min: 9, max: 19, until: 20 },
    // Spain's national PNOA maximum-current orthophoto; also covers islands.
    { id: "ign-spain-mainland", country: "ES", provider: "IGN España / CNIG / PNOA",
        url: "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&FORMAT=image/png&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        bounds: [-10, 35, 5, 44], min: 9, max: 19, until: 20 },
    { id: "ign-spain-canaries", country: "ES", provider: "IGN España / CNIG / PNOA",
        url: "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&FORMAT=image/png&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        bounds: [-19, 27, -12, 30], min: 9, max: 19, until: 20 },
    // Swiss federal swisstopo SWISSIMAGE: public keyless Web Mercator WMTS.
    { id: "swisstopo-swissimage", country: "CH", provider: "swisstopo / SWISSIMAGE",
        url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
        bounds: [5.9, 45.8, 10.6, 47.9], min: 9, max: 19, until: 20 },
    // Dutch government PDOK aerial orthophoto 25cm open-data WMTS.
    { id: "pdok-netherlands", country: "NL", provider: "PDOK / Beeldmateriaal",
        url: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
        bounds: [3.25, 50.5, 7.6, 54], min: 9, max: 19, until: 20 },
    // Austrian federal/provincial open government basemap.at Orthofoto.
    // Its WMTS REST template uses {z}/{y}/{x}, not generic XYZ order.
    { id: "basemap-austria", country: "AT", provider: "basemap.at Orthofoto",
        url: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
        bounds: [9.4, 46.35, 17.1, 49.05], min: 9, max: 19, until: 20 },
    // Czech state survey ČÚZK publishes a Web Mercator ArcGIS cached orthophoto.
    { id: "cuzk-czechia", country: "CZ", provider: "ČÚZK Ortofoto ČR",
        url: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
        bounds: [12.05, 48.5, 18.9, 51.1], min: 9, max: 20, until: 21 },
    // Belgian Flemish Region (+ available Brussels coverage), NOT all Belgium.
    // Government's GoogleMapsVL is a Web Mercator WMTS matrix series.
    { id: "vlaanderen-flanders", country: "BE", provider: "Digitaal Vlaanderen Orthofotomozaïek",
        url: "https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=omwrgbmrvl&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
        bounds: [2.48, 50.63, 5.93, 51.53], min: 9, max: 19, until: 20 },
    // GUGiK Polish Geoportal standard orthophotomap. Source WMTS is published
    // by the national survey authority; confirm response headers and service
    // usage conditions in browser checks prior to production release.
    { id: "gugik-poland", country: "PL", provider: "GUGiK Geoportal Ortofotomapa",
        url: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        bounds: [14.1, 48.9, 24.2, 55.1], min: 9, max: 19, until: 20 },
    // Australia: NSW only, not all Australia. State Spatial Services public
    // Web Mercator cached imagery contains third-party imagery; release review
    // must confirm per-source copyright alongside NSW government CC BY terms.
    { id: "nsw-australia", country: "AU", provider: "NSW Spatial Services imagery (NSW only)",
        url: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
        bounds: [140.7, -38.0, 154.1, -28.0], min: 9, max: 18, until: 19 },
    // Republic of Estonia Land and Spatial Development Board. The official
    // WMTS Web Mercator (GMC) orthophoto is distinct from native LEST/TMS.
    // Add the provider-requested service identification query parameters.
    { id: "maaruum-estonia", country: "EE", provider: "Maa- ja Ruumiamet orthophoto",
        url: "https://tiles.maaamet.ee/tm/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=foto&STYLE=default&FORMAT=image/png&TILEMATRIXSET=GMC&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&ASUTUS=JOURNEYPHOTO&KESKKOND=LIVE&IS=JOURNEYPHOTO",
        bounds: [21.7, 57.5, 28.3, 59.9], min: 9, max: 18, until: 19 },
    // Germany: North Rhine-Westphalia ONLY. Geobasis NRW Open Data orthophoto
    // cache advertises 3857 tile matrix; do not substitute Germany-wide BKG
    // DOP service, which is subject to federal entitlement restrictions.
    { id: "nrw-germany", country: "DE", provider: "Geobasis NRW DOP (NRW only)",
        url: "https://www.wmts.nrw.de/geobasis/wmts_nw_dop/tiles/nw_dop/EPSG_3857_16/{z}/{y}/{x}",
        bounds: [5.8, 50.3, 9.5, 52.55], min: 9, max: 16, until: 17 },
    // Grand Duchy of Luxembourg: ACT government open-data 2023 orthophoto.
    // Official WMTS REST ResourceURL uses TileCol BEFORE TileRow. Matrix IDs
    // z>=10 are unpadded and align with standard global Web Mercator tile z.
    // Official open-data publication designates this orthophoto dataset CC0.
    { id: "act-luxembourg-2023", country: "LU", provider: "ACT Luxembourg orthophoto 2023",
        url: "https://wmts1.geoportail.lu/opendata/wmts/ortho_2023/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg",
        bounds: [5.72, 49.43, 6.55, 50.19], min: 10, max: 19, until: 20 },
] as const;

export function isBoundaryLayer(id: string): boolean {
    return /boundary|border|admin|maritime|marine|disputed|territorial/i.test(id);
}

function addFreeImagery(gl: VectorMap): boolean {
    // Keep satellite pictures ON TOP of roads/borders but BELOW actual place
    // labels, photo pins and the rest of the app interface.
    const firstLabel = gl.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
    try {
        const imagery = [
            { id: "gsi-global", url: FREE_GSI_IMAGERY.world, min: 2, max: 8, until: 8.5 },
            { id: "gsi-japan-land", url: FREE_GSI_IMAGERY.japan, min: 2, max: 13, until: 13.5,
                bounds: [122, 20, 154, 46] },
            { id: "gsi-japan-ortho", url: FREE_GSI_IMAGERY.japanDetail, min: 14, max: 18, until: 19,
                bounds: [122, 20, 154, 46] },
            ...OFFICIAL_COUNTRY_IMAGERY,
        ];
        for (const item of imagery) {
            gl.addSource(item.id, {
                type: "raster",
                tiles: [item.url],
                tileSize: 256,
                minzoom: item.min,
                maxzoom: item.max,
                ...("bounds" in item ? { bounds: item.bounds } : {}),
            });
            gl.addLayer({
                id: `journey-${item.id}`,
                type: "raster",
                source: item.id,
                minzoom: item.min,
                maxzoom: item.until,
                paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
            }, firstLabel);
        }
        // Do not display borders even where GSI tiles are unavailable.
        for (const layer of gl.getStyle().layers ?? []) {
            if (isBoundaryLayer(layer.id)) {
                try { gl.setLayoutProperty(layer.id, "visibility", "none"); }
                catch { /* the basemap remains usable */ }
            }
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Shows GSI global/Japan imagery plus selected official national imagery over one existing vector basemap. Note that source
 * coverage and source zoom are limited; never claim Google-Earth-level detail.
 * Switches the base layer only AFTER actual vector tiles rendered.
 * Keep the readable OSM fallback in place on script/style failure.
 * Caller owns map lifecycle; cleanup is registered by the caller's effect.
 */
export async function upgradeToRealVectorBasemap(
    leaflet: typeof import("leaflet"),
    map: LeafletMap,
    fallback: LeafletLayer,
    shouldContinue: () => boolean,
    onState: (state: "free-imagery-ready" | "vector-ready" | "fallback") => void,
): Promise<void> {
    let vector: VectorLayer | null = null;
    try {
        const adapter = await loadVectorAdapter(leaflet);
        if (!shouldContinue()) return;
        vector = adapter({
            style: REAL_DARK_MAP_STYLE,
            interactive: false,
            attributionControl: false,
        });
        vector.addTo(map);
        const gl = vector.getMaplibreMap();
        const activeLayer = vector;
        await new Promise<void>((resolve, reject) => {
            let finished = false;
            const finish = (ok: boolean) => {
                if (finished) return;
                finished = true;
                window.clearTimeout(timeout);
                gl.off("error", onError);
                if (ok) resolve();
                else reject(new Error("Vector map style/tiles did not load"));
            };
            const onError = () => finish(false);
            const timeout = window.setTimeout(() => finish(false), 18000);
            gl.on("error", onError);
            gl.once("idle", () => finish(true));
            if (gl.loaded()) finish(true);
        });
        if (!shouldContinue()) { map.removeLayer(activeLayer); return; }
        applyReadableMapPalette(gl);
        // Replace shaded-relief-only texture with GSI's real true-color
        // aerial/satellite photographs. No MapTiler/Mapbox key is used.
        const imageryAdded = addFreeImagery(gl);
        map.removeLayer(fallback);
        if (imageryAdded) map.attributionControl?.addAttribution(
            '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院（地理院タイル）</a>'
            + ' ・Landsat8: GSI, TSIC, GEO Grid/AIST, USGS'
            + ' ・Global MODIS: NASA LP DAAC / USGS EROS'
            + ' ・<a href="https://www.usgs.gov/the-national-map" target="_blank" rel="noopener noreferrer">USGS / USDA NAIP</a>'
            + ' ・<a href="https://cartes.gouv.fr/" target="_blank" rel="noopener noreferrer">IGN France</a>'
            + ' ・<a href="https://pnoa.ign.es/" target="_blank" rel="noopener noreferrer">IGN España / CNIG / PNOA</a>'
            + ' ・<a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener noreferrer">© swisstopo</a>'
            + ' ・<a href="https://www.pdok.nl/" target="_blank" rel="noopener noreferrer">PDOK / Beeldmateriaal</a>'
            + ' ・Datenquelle: <a href="https://basemap.at/" target="_blank" rel="noopener noreferrer">basemap.at</a>'
            + ' ・<a href="https://geoportal.cuzk.gov.cz/" target="_blank" rel="noopener noreferrer">© ČÚZK</a>'
            + ' ・<a href="https://www.vlaanderen.be/digitaal-vlaanderen" target="_blank" rel="noopener noreferrer">© Digitaal Vlaanderen (Flanders orthophoto)</a>'
            + ' ・<a href="https://www.geoportal.gov.pl/" target="_blank" rel="noopener noreferrer">GUGiK Geoportal (Poland)</a>'
            + ' ・<a href="https://www.spatial.nsw.gov.au/" target="_blank" rel="noopener noreferrer">© NSW Department of Customer Service / NSW Spatial Services</a>'
            + ' ・<a href="https://geoportaal.maaamet.ee/" target="_blank" rel="noopener noreferrer">Maa- ja Ruumiamet (Estonia orthophoto)</a>'
            + ' ・<a href="https://www.bezreg-koeln.nrw.de/geobasis-nrw" target="_blank" rel="noopener noreferrer">Geobasis NRW (Germany, NRW orthophoto)</a>'
            + ' ・<a href="https://data.public.lu/en/datasets/bd-l-ortho-webservices-wms-et-wmts/" target="_blank" rel="noopener noreferrer">ACT Luxembourg — ortho_2023 (CC0)</a>',
        );
        map.attributionControl?.addAttribution(
            '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> '
            + '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> '
            + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        );
        onState(imageryAdded ? "free-imagery-ready" : "vector-ready");
    } catch {
        if (vector && shouldContinue()) map.removeLayer(vector);
        if (shouldContinue()) {
            if (!map.hasLayer(fallback)) fallback.addTo(map);
            onState("fallback");
        }
    }
}
