import { describe, expect, it } from "vitest";
import { satelliteHybridStyle, shouldHideSatelliteLayer } from "../loadVectorBasemap";

describe("Journey Photo satellite hybrid selection", () => {
    it("does not mistake an absent or placeholder MapTiler key for an enabled satellite map", () => {
        expect(satelliteHybridStyle("")).toBeNull();
        expect(satelliteHybridStyle("   ")).toBeNull();
        expect(satelliteHybridStyle("YOUR_MAPTILER_API_KEY")).toBeNull();
        expect(satelliteHybridStyle("REPLACE_ME")).toBeNull();
    });

    it("uses an actual MapTiler hybrid style URL when a browser key is configured", () => {
        const url = satelliteHybridStyle("key with safe&chars");
        expect(url).toBe("https://api.maptiler.com/maps/hybrid-v4/style.json?key=key%20with%20safe%26chars");
    });

    it.each([
        ["boundary_country_z0-4", "line"],
        ["admin-0-boundary", "line"],
        ["maritime_boundary", "line"],
        ["territorial-border", "line"],
        ["disputed-boundary", "line"],
        ["poi_restaurant", "symbol"],
        ["highway_name_other", "symbol"],
    ])("hides extraneous satellite layer %s", (id, type) => {
        expect(shouldHideSatelliteLayer({ id, type })).toBe(true);
    });

    it.each([
        ["water", "fill"],
        ["satellite", "raster"],
        ["place_city", "symbol"],
        ["place_country", "symbol"],
        ["water_name", "symbol"],
        ["natural_coastline", "line"],
    ])("keeps satellite imagery and meaningful geographic layer %s", (id, type) => {
        expect(shouldHideSatelliteLayer({ id, type })).toBe(false);
    });
});
