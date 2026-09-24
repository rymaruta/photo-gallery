import { describe, expect, it } from "vitest";
import { FREE_GSI_IMAGERY, isBoundaryLayer } from "../loadVectorBasemap";

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
