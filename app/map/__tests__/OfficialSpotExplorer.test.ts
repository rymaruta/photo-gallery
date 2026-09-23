import { describe, expect, it } from "vitest";
import type { SpotLink } from "@/lib/data/spotLink";
import { plottableOfficialSpots } from "../OfficialSpotExplorer";

const item = (slug: string, coords?: { lat: number; lng: number }): SpotLink => ({
    slug, name: slug, region: "", cover: null, coords,
});

describe("official spots map presentation", () => {
    it("uses only spots with finite, geographically valid published coordinates", () => {
        const spots = [
            item("no-coordinates"), item("valid", { lat: 35, lng: 139 }),
            item("invalid-latitude", { lat: 91, lng: 139 }),
            item("invalid-longitude", { lat: 35, lng: 181 }),
            item("nan", { lat: Number.NaN, lng: 140 }),
        ];
        expect(plottableOfficialSpots(spots).map((s) => s.slug)).toEqual(["valid"]);
    });

    it("does not invent a marker from an address or name alone", () => {
        expect(plottableOfficialSpots([item("a"), item("b")])).toEqual([]);
    });
});
