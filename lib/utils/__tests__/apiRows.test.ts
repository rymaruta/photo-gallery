import { describe, it, expect, vi, beforeEach } from "vitest";
import { usableRows, usablePhotoRows } from "../apiRows";
import { log } from "../log";

// **100件中1件が壊れているだけで、ページ全体が落ちていた。**
//
// これまでは `Array.isArray(data)` までしか見ずに状態へ入れていた。中身は
// 描画の途中で読むので、`null` が1件混じるだけで `ErrorBoundary` のカードに
// 置き換わる——ヘッダーもフッターもトーストも消える（実測で確認）。
// 通知ベルはレイアウトに常駐しているので、**どのページを開いてもカード**になる。
describe("usableRows", () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it("配列でなければ null（取れなかったと扱える）", () => {
        expect(usableRows({}, "x")).toBeNull();
        expect(usableRows(null, "x")).toBeNull();
        expect(usableRows("[]", "x")).toBeNull();
    });

    // **1件の巻き添えで全部を失わない**のがこの関数の目的
    it("読めない行だけ落とす", () => {
        const rows = usableRows<{ id: string }>(
            [{ id: "a" }, null, { id: "b" }, undefined, "文字列", 42, [1]], "x");
        expect(rows?.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("全部読めるなら1件も落とさない", () => {
        const input = [{ id: "a" }, { id: "b" }];
        expect(usableRows(input, "x")).toEqual(input);
    });

    it("空配列はそのまま（0件と『取れなかった』は違う）", () => {
        expect(usableRows([], "x")).toEqual([]);
    });

    // **黙って落とさない。** ただし件数だけ——過去に診断ログへ表示名を
    // 全部書き出した事故があるので、利用者の中身は出さない
    it("落としたら件数だけ記録する", () => {
        const warn = vi.spyOn(log, "warn").mockImplementation(() => { });
        usableRows([{ id: "a" }, null], "GET /photos");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("GET /photos"), { dropped: 1, total: 2 });
        // **「利用者の中身が出ていない」の検査になっていなかった**——ログに
        // 出るのはラベルと件数だけなので `"id"` を探しても意味が無く、
        // 逆に `useComments` のラベル（`GET /photos/{id}/comments`）で
        // 同じ検査を書くと**実装が正しいのに落ちる**。
        // 渡した行の中身が出ていないことを、実際の値で見る
        vi.spyOn(log, "warn").mockRestore();
        const warn2 = vi.spyOn(log, "warn").mockImplementation(() => { });
        usableRows([{ secret: "利用者の本文" }, null], "GET /photos");
        const logged = JSON.stringify(warn2.mock.calls);
        expect(logged, "行の中身をログに出している").not.toContain("利用者の本文");
        expect(logged, "件数を出していない").toContain("dropped");
    });

    it("落とすものが無ければ記録しない", () => {
        const warn = vi.spyOn(log, "warn").mockImplementation(() => { });
        usableRows([{ id: "a" }], "x");
        expect(warn).not.toHaveBeenCalled();
    });
});

// `id` は React のキーであり、写真の突き合わせ（`find(p => p.id === photoId)`・
// お気に入り・関連写真）の唯一の手がかり。無い行を通すと
// 「一覧には出るのに開けない」写真ができる
describe("usablePhotoRows", () => {
    it("id が文字列でない行も落とす", () => {
        const rows = usablePhotoRows<{ id?: unknown }>(
            [{ id: "a" }, { id: 1 }, { id: "" }, { title: "id なし" }, null], "x");
        expect(rows?.map((r) => r.id)).toEqual(["a"]);
    });

    it("配列でなければ null", () => {
        expect(usablePhotoRows({}, "x")).toBeNull();
    });

    // **写真ごと捨てない。** 描画側は `(p.tags ?? []).map(...)` と、配列で
    // あることを構造として当てにしているので `.map is not a function` で
    // ページが落ちる（実際に再現した）。おかしいのはタグの欄だけなので、
    // そこだけ捨てて写真は出す
    it.each([
        ["文字列", "旅"],
        ["オブジェクト", {}],
        ["数値", 3],
        ["null", null],
    ])("tags が%sの行は、tags だけ捨てて残す", (_name, tags) => {
        const rows = usablePhotoRows<{ id?: unknown; tags?: unknown }>([{ id: "a", tags }], "x");
        expect(rows?.map((r) => r.id), "写真ごと捨てている").toEqual(["a"]);
        expect(rows?.[0].tags).toEqual([]);
    });

    it("tags が無い行・正しい行は触らない", () => {
        const input = [{ id: "a" }, { id: "b", tags: ["旅"] }];
        expect(usablePhotoRows(input, "x")).toEqual(input);
    });

    it("全部読めるなら1件も落とさない", () => {
        const input = [{ id: "a" }, { id: "b" }];
        expect(usablePhotoRows(input, "x")).toEqual(input);
    });
});
