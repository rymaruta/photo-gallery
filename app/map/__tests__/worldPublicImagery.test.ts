import { describe, expect, it } from "vitest";
import { FREE_GSI_IMAGERY, FREE_PUBLIC_IMAGERY_PROVIDERS, FREE_USGS_IMAGERY, isBoundaryLayer } from "../loadVectorBasemap";

describe("worldwide public geographic imagery adapters", () => {
    it("keeps Japanese government imagery while adding a US public-domain provider", () => {
        expect(FREE_GSI_IMAGERY.japanDetail).toContain("cyberjapandata.gsi.go.jp");
        expect(FREE_USGS_IMAGERY.contiguousUS).toBe(
            "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        );
    });

    it("uses only explicitly reviewed origins and no key, payment or metered map provider", () => {
        for (const provider of FREE_PUBLIC_IMAGERY_PROVIDERS) {
            expect(provider.country).toBe("US");
            expect(provider.url).toMatch(/^https:\/\/basemap\.nationalmap\.gov\//);
            expect(provider.url).not.toMatch(/api[_-]?key|token|maptiler|mapbox|google/i);
            expect(provider.attribution).toMatch(/USGS/);
            expect(provider.min).toBeGreaterThan(8);
        }
    });

    it("does not extend the US imagery into Alaska's separately licensed SPOT data", () => {
        const us = FREE_PUBLIC_IMAGERY_PROVIDERS.find((provider) => provider.country === "US");
        expect(us?.bounds).toEqual([-125, 24, -66, 50]);
    });

    it.each(["boundary_country_z0-4", "maritime_boundary", "admin-1", "territorial-sea"])("keeps boundary line %s hidden", (layer) => {
        expect(isBoundaryLayer(layer)).toBe(true);
    });
});
