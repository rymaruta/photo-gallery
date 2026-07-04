import { describe, it, expect, beforeEach } from "vitest";
import { loadSeenStoryIds, markStorySeen } from "../stories";

// localStorage モック
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
    value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    configurable: true,
});

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
});

describe("ストーリー既読管理", () => {
    it("markStorySeen した ID が loadSeenStoryIds に含まれる", () => {
        markStorySeen("s1");
        markStorySeen("s2");
        const seen = loadSeenStoryIds();
        expect(seen.has("s1")).toBe(true);
        expect(seen.has("s2")).toBe(true);
        expect(seen.has("s3")).toBe(false);
    });

    it("25時間より古い既読記録は読み込み時に除外される", () => {
        const old = Date.now() - 26 * 60 * 60 * 1000;
        store["jp_seen_stories"] = JSON.stringify({ "old-story": old, "new-story": Date.now() });
        const seen = loadSeenStoryIds();
        expect(seen.has("old-story")).toBe(false);
        expect(seen.has("new-story")).toBe(true);
    });

    it("markStorySeen 時に期限切れの記録が掃除される", () => {
        const old = Date.now() - 26 * 60 * 60 * 1000;
        store["jp_seen_stories"] = JSON.stringify({ "old-story": old });
        markStorySeen("fresh");
        const saved = JSON.parse(store["jp_seen_stories"]) as Record<string, number>;
        expect(saved["old-story"]).toBeUndefined();
        expect(saved["fresh"]).toBeTypeOf("number");
    });

    it("壊れた JSON でも例外を投げず空集合を返す", () => {
        store["jp_seen_stories"] = "{broken";
        expect(loadSeenStoryIds().size).toBe(0);
        expect(() => markStorySeen("x")).not.toThrow();
    });

    it("不正な値（数値以外のタイムスタンプ）は無視される", () => {
        store["jp_seen_stories"] = JSON.stringify({ bad: "not-a-number", good: Date.now() });
        const seen = loadSeenStoryIds();
        expect(seen.has("bad")).toBe(false);
        expect(seen.has("good")).toBe(true);
    });
});
