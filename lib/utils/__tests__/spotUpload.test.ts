import { describe, it, expect } from "vitest";
import { spotUploadHref, readSpotParam, parseSpotBody, coversSpot, spotIdToSend, type SpotUploadTarget } from "../spotUpload";

/**
 * **スポットの画面から投稿したとき、どの写真にスポットを付けるか。**
 * iOS の `UploadSpotTarget`（`UploadDraftTests.testSpotIdIsSentOnlyForSpotUploadsWithPlaceKept`）と同じ規則。
 */
const GINZAN: SpotUploadTarget = { spotId: "sp_92dc681b0f47", slug: "ginzan-onsen", name: "銀山温泉", coords: { lat: 38.58, lng: 140.53 } };

describe("spotUpload", () => {
    it("リンクは ?spot=<slug> だけを運ぶ（ID も名前も載せない）", () => {
        expect(spotUploadHref("ginzan-onsen")).toBe("/user/upload?spot=ginzan-onsen");
    });

    it("?spot= は綴りの形のものだけ読む", () => {
        expect(readSpotParam("ginzan-onsen")).toBe("ginzan-onsen");
        for (const bad of [null, undefined, "", "../x", "a/b", "Ginzan", "a--b", "x".repeat(101), "sp_92dc681b0f47"]) {
            expect(readSpotParam(bad as string), String(bad)).toBeNull();
        }
    });

    it("本文 JSON: 頼んだ綴りと違う・ID の形が違う・名前が無いなら読まない", () => {
        const ok = { spotId: GINZAN.spotId, slug: "ginzan-onsen", name: "銀山温泉", coords: { lat: 38.58, lng: 140.53 } };
        expect(parseSpotBody(ok, "ginzan-onsen")).toEqual(GINZAN);
        expect(parseSpotBody(ok, "other")).toBeNull();
        expect(parseSpotBody({ ...ok, spotId: "sp_x" }, "ginzan-onsen")).toBeNull();
        expect(parseSpotBody({ ...ok, name: " " }, "ginzan-onsen")).toBeNull();
        expect(parseSpotBody(null, "ginzan-onsen")).toBeNull();
        expect(parseSpotBody({ ...ok, coords: { lat: "x" } }, "ginzan-onsen")).toEqual({ ...GINZAN, coords: undefined });
    });

    it("位置情報が無い写真・10km 以内の写真は近いとみなし、離れた写真は近くない", () => {
        expect(coversSpot(GINZAN, { location: "" })).toBe(true);
        expect(coversSpot(GINZAN, { location: "", latitude: 38.6, longitude: 140.5 })).toBe(true);
        // 別の旅（バルセロナ）の写真を同じ画面で混ぜた
        expect(coversSpot(GINZAN, { location: "", latitude: 41.39, longitude: 2.17 })).toBe(false);
        // 約 20km 北
        expect(coversSpot(GINZAN, { location: "", latitude: 38.76, longitude: 140.53 })).toBe(false);
    });

    it("送るのは、近くで撮った写真の撮影地にスポット名が残っているときだけ", () => {
        expect(spotIdToSend(GINZAN, { location: "銀山温泉" })).toBe(GINZAN.spotId);
        expect(spotIdToSend(GINZAN, { location: "銀山温泉 夜" })).toBe(GINZAN.spotId);
        expect(spotIdToSend(GINZAN, { location: "" }), "撮影地を消した").toBeUndefined();
        expect(spotIdToSend(GINZAN, { location: "山寺" }), "別の場所に書き換えた").toBeUndefined();
        expect(spotIdToSend(GINZAN, { location: "銀山温泉", latitude: 41.39, longitude: 2.17 }), "遠い").toBeUndefined();
        expect(spotIdToSend(null, { location: "銀山温泉" }), "スポットを外した").toBeUndefined();
    });
});
