import { describe, it, expect } from "vitest";
import { parseSpotMatchIndex, uploadSpotIndex, uploadSpotFields, autoUploadSpot, choiceOff, autoOffFor } from "../spotUploadAuto";

/** 投稿で撮影スポットを自動で選ぶ（2026-10-31 判断・journey.photo-ios#425） */
const FOX = "sp_000000000001";
const GINZAN = { spotId: "sp_92dc681b0f47", slug: "ginzan-onsen", name: "銀山温泉", coords: { lat: 38.58, lng: 140.53 } };
const index = uploadSpotIndex(parseSpotMatchIndex({
    v: 1,
    spots: [
        { i: FOX, d: "蔵王キツネ村", n: "蔵王キツネ村", c: [38.02, 140.55], p: "宮城県" },
        { i: GINZAN.spotId, d: "銀山温泉", n: "銀山温泉", c: [38.58, 140.53], p: "山形県" },
    ],
})!);

describe("uploadSpotFields", () => {
    it("撮影スポットの画面から来て付く写真は、そちらが先", () => {
        expect(uploadSpotFields({ target: GINZAN, index, item: { location: "銀山温泉 蔵王キツネ村" } })).toEqual({ spotId: GINZAN.spotId });
    });

    it("自動の候補は spotId にしない（静的な生成が結ぶ）・本人が切ったときだけ spotAuto: off", () => {
        const item = { location: "蔵王キツネ村" };
        expect(uploadSpotFields({ target: null, index, item })).toEqual({});
        expect(uploadSpotFields({ target: null, index, item, off: false })).toEqual({});
        expect(uploadSpotFields({ target: null, index, item, off: true })).toEqual({ spotAuto: "off" });
    });

    it("撮影スポットの画面から来た投稿でも、付かない写真の自動の候補は書かない", () => {
        expect(uploadSpotFields({ target: GINZAN, index, item: { location: "蔵王キツネ村" } })).toEqual({});
    });

    it("選べない・索引が無いときは何も送らない", () => {
        expect(uploadSpotFields({ target: null, index, item: { location: "東京" } })).toEqual({});
        expect(uploadSpotFields({ target: null, index: null, item: { location: "蔵王キツネ村" } })).toEqual({});
    });

    it("題・説明の名前でも選ぶ・写真の位置が 5km より遠ければ選ばない", () => {
        expect(autoUploadSpot(index, { location: "", title: "蔵王キツネ村の朝" })).toBe(FOX);
        expect(autoUploadSpot(index, { location: "蔵王キツネ村", latitude: 38.2, longitude: 140.55 })).toBeNull();
    });

    it("切り替えの記録（入り true／切り false）を off に", () => {
        const m = new Map([["a", true], ["b", false]]);
        expect(choiceOff(m, "a")).toBe(false);
        expect(choiceOff(m, "b")).toBe(true);
        expect(choiceOff(m, "c")).toBeUndefined();
    });
});

describe("autoOffFor（撮影スポットの帯の「外す」）", () => {
    const d = { spotId: GINZAN.spotId, itemId: "a" };
    it("見ていた1枚で、候補が同じ撮影スポットなら切り", () => {
        expect(autoOffFor(new Map(), d, "a", GINZAN.spotId)).toBe(true);
    });
    it("ほかの写真・ほかの候補・外していないときは触らない", () => {
        expect(autoOffFor(new Map(), d, "b", GINZAN.spotId)).toBeUndefined();
        expect(autoOffFor(new Map(), d, "a", FOX)).toBeUndefined();
        expect(autoOffFor(new Map(), null, "a", GINZAN.spotId)).toBeUndefined();
    });
    it("本人の切り替えが先", () => {
        expect(autoOffFor(new Map([["a", true]]), d, "a", GINZAN.spotId)).toBe(false);
    });
});

describe("parseSpotMatchIndex", () => {
    it("形の違う索引は使わない", () => {
        expect(parseSpotMatchIndex(null)).toBeNull();
        expect(parseSpotMatchIndex({ v: 2, spots: [] })).toBeNull();
        expect(parseSpotMatchIndex({ v: 1, spots: [{ i: 1 }] })!.spots).toEqual([]);
    });
});
