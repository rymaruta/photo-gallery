import { describe, expect, it } from "vitest";
import { FREE_GSI_IMAGERY, OFFICIAL_COUNTRY_IMAGERY, isBoundaryLayer } from "../loadVectorBasemap";

describe("keyless GSI satellite and aerial imagery", () => {
    it("uses public source tiles, not a metered API or any browser credential", () => {
        expect(FREE_GSI_IMAGERY.world).toBe("https://cyberjapandata.gsi.go.jp/xyz/modis/{z}/{x}/{y}.png");
        expect(FREE_GSI_IMAGERY.japan).toBe("https://cyberjapandata.gsi.go.jp/xyz/lndst/{z}/{x}/{y}.png");
        expect(FREE_GSI_IMAGERY.japanDetail).toBe("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg");
        Object.values(FREE_GSI_IMAGERY).forEach((url) => {
            expect(url).not.toMatch(/key=|token=|maptiler|mapbox|google/i);
        });
    });

    it.each(["boundary_state", "boundary_country_z0-4", "maritime_boundary", "admin-1", "disputed-border", "territorial-sea"])("suppresses unwanted boundary layer %s", (id) => {
        expect(isBoundaryLayer(id)).toBe(true);
    });

    it.each(["water", "place_city", "place_country", "natural_coastline", "satellite", "place_island"])("retains actual geographic imagery and place names %s", (id) => {
        expect(isBoundaryLayer(id)).toBe(false);
    });
});

describe("official regional aerial imagery additions to the worldwide map", () => {
    it("registers official imagery from thirteen overseas countries alongside Japan without keys", () => {
        expect(new Set(OFFICIAL_COUNTRY_IMAGERY.map((source) => source.country))).toEqual(
            new Set(["US", "FR", "ES", "CH", "NL", "AT", "CZ", "BE", "PL", "AU", "EE", "DE", "LU"]),
        );
        for (const source of OFFICIAL_COUNTRY_IMAGERY) {
            expect(source.url).toMatch(/^https:\/\//);
            expect(source.url).toContain("{z}");
            expect(source.url).toContain("{x}");
            expect(source.url).toContain("{y}");
            expect(source.url).not.toMatch(/(?:apikey|access_token|maptiler|mapbox|google\.com\/maps)/i);
            expect(source.bounds).toHaveLength(4);
            expect(source.bounds[0]).toBeLessThan(source.bounds[2]);
            expect(source.bounds[1]).toBeLessThan(source.bounds[3]);
            expect(source.min).toBeGreaterThan(8);
            expect(source.max).toBeGreaterThanOrEqual(source.min);
            expect(source.until).toBeGreaterThan(source.max);
        }
    });

    it("uses an ArcGIS row/column URL, not an accidentally transposed XYZ URL, for USGS", () => {
        const us = OFFICIAL_COUNTRY_IMAGERY.filter((source) => source.country === "US");
        expect(us).toHaveLength(3);
        us.forEach((source) => expect(source.url).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}$/));
    });

    it("keeps French and Spanish orthophotos on explicitly declared Mercator tile matrices", () => {
        const fr = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "FR");
        const es = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "ES");
        expect(fr?.url).toContain("TILEMATRIXSET=PM");
        expect(es?.url).toContain("TILEMATRIXSET=GoogleMapsCompatible");
        expect(fr?.url).toContain("ORTHOIMAGERY.ORTHOPHOTOS");
        expect(es?.url).toContain("OI.OrthoimageCoverage");
        const ch = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "CH");
        const nl = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "NL");
        expect(ch?.url).toContain("ch.swisstopo.swissimage/default/current/3857/");
        expect(nl?.url).toContain("Actueel_ortho25/EPSG:3857/");
        const at = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "AT");
        const cz = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "CZ");
        const be = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "BE");
        const pl = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "PL");
        expect(at?.url).toContain("bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg");
        expect(cz?.url).toContain("ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}");
        expect(be?.url).toContain("LAYER=omwrgbmrvl&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL");
        expect(pl?.url).toContain("LAYER=ORTOFOTOMAPA&STYLE=default&TILEMATRIXSET=EPSG:3857");
        expect([at, cz, be, pl].every((source) => source?.url.startsWith("https://"))).toBe(true);
        const au = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "AU");
        expect(au?.url).toContain("public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}");
        expect(au?.bounds[0]).toBeGreaterThan(140);
        expect(au?.bounds[2]).toBeLessThan(155);
        const ee = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "EE");
        const de = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "DE");
        expect(ee?.url).toContain("LAYER=foto&STYLE=default&FORMAT=image/png&TILEMATRIXSET=GMC");
        expect(ee?.url).toContain("ASUTUS=JOURNEYPHOTO&KESKKOND=LIVE&IS=JOURNEYPHOTO");
        expect(de?.url).toContain("wmts_nw_dop/tiles/nw_dop/EPSG_3857_16/{z}/{y}/{x}");
        expect(de?.bounds[0]).toBeGreaterThan(5);
        expect(de?.bounds[2]).toBeLessThan(10);
        const lu = OFFICIAL_COUNTRY_IMAGERY.find((source) => source.country === "LU");
        expect(lu?.url).toContain("opendata/wmts/ortho_2023/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg");
        expect(lu?.min).toBeGreaterThanOrEqual(10);
    });
});
