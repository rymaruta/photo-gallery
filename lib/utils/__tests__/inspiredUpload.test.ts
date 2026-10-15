import { describe, it, expect } from "vitest";
import { normalizeInspiredId, inspiredPickFrom, InspiredCarrier, inspiredWasDropped } from "../inspired";

/**
 * 投稿画面の「この写真を見て撮影」（`/user/upload?inspiredBy=<id>`）の決まり。
 * アプリの `InspiredBy`（`normalizedId`・`canAttach`・`Carrier`・`wasDropped`）と同じ考え。
 */
const SOURCE = {
    id: "src-1", src: "https://cdn.example.com/uploads/alice/a.webp", thumbSm: "https://cdn.example.com/uploads/alice/a-256.webp",
    title: "朝の湖", location: "銀山温泉", userId: "alice", displayName: "アリス",
};

describe("normalizeInspiredId（サーバーが受ける形だけ送る）", () => {
    it("英数とハイフン 1〜64 文字。前後の空白は落とす", () => {
        expect(normalizeInspiredId(" src-1 ")).toBe("src-1");
        expect(normalizeInspiredId("a".repeat(64))).toBe("a".repeat(64));
    });
    it.each([["空", ""], ["長すぎ", "a".repeat(65)], ["#（別の文書のキー）", "notifs#x"], ["空白入り", "a b"], ["日本語", "写真"]])(
        "%s は送らない", (_n, v) => {
            expect(normalizeInspiredId(v)).toBeNull();
        });
    it("文字列でなければ null", () => {
        expect(normalizeInspiredId(null)).toBeNull();
        expect(normalizeInspiredId(undefined)).toBeNull();
    });
});

describe("inspiredPickFrom（付けてよい元の写真か）", () => {
    it("公開で全員に見せている他人の写真は、題・撮影地・作者・小さい画像を持つ札にする", () => {
        expect(inspiredPickFrom(SOURCE, "src-1", "bob")).toEqual({
            id: "src-1", title: "朝の湖", location: "銀山温泉", thumb: SOURCE.thumbSm, displayName: "アリス",
        });
        expect(inspiredPickFrom({ ...SOURCE, audience: "everyone" }, "src-1", null)?.id).toBe("src-1");
    });
    it("自分の写真には付けない（userId でも古い行の uploadedBy でも）", () => {
        expect(inspiredPickFrom(SOURCE, "src-1", "alice")).toBeNull();
        expect(inspiredPickFrom({ ...SOURCE, userId: undefined, uploadedBy: "alice" }, "src-1", "alice")).toBeNull();
    });
    it("非公開・ストーリー・公開範囲を絞った写真には付けない", () => {
        expect(inspiredPickFrom({ ...SOURCE, published: false }, "src-1", "bob")).toBeNull();
        expect(inspiredPickFrom({ ...SOURCE, story: true }, "src-1", "bob")).toBeNull();
        expect(inspiredPickFrom({ ...SOURCE, audience: "followers" }, "src-1", "bob")).toBeNull();
        expect(inspiredPickFrom({ ...SOURCE, audience: "closeFriends" }, "src-1", "bob")).toBeNull();
    });
    it("読めない答え・画像の無い行・頼んだものと違う ID には付けない", () => {
        expect(inspiredPickFrom(null, "src-1", "bob")).toBeNull();
        expect(inspiredPickFrom({ error: "写真が見つかりません" }, "src-1", "bob")).toBeNull();
        expect(inspiredPickFrom({ ...SOURCE, src: "" }, "src-1", "bob")).toBeNull();
        expect(inspiredPickFrom({ ...SOURCE, id: "other" }, "src-1", "bob")).toBeNull();
    });
    it("小さい画像が無ければ 512px → 原寸", () => {
        expect(inspiredPickFrom({ ...SOURCE, thumbSm: undefined, thumbSrc: "t.webp" }, "src-1", "bob")?.thumb).toBe("t.webp");
        expect(inspiredPickFrom({ ...SOURCE, thumbSm: undefined }, "src-1", "bob")?.thumb).toBe(SOURCE.src);
    });
});

describe("InspiredCarrier（投稿のうち1枚だけに載せる）", () => {
    it("最初に送った写真にだけ載せ、通ったら以後どれにも載せない", () => {
        const c = new InspiredCarrier();
        expect(c.idToSend("a", "src-1")).toBe("src-1");
        expect(c.idToSend("b", "src-1")).toBeNull();
        c.saved("a");
        expect(c.idToSend("a", "src-1")).toBeNull();
        expect(c.idToSend("c", "src-1")).toBeNull();
    });
    it("届いたか分からない間は、後ろの写真に載せない。押し直しは同じ写真に載せる", () => {
        const c = new InspiredCarrier();
        expect(c.idToSend("a", "src-1")).toBe("src-1");
        // a の保存が時間切れ（何も呼ばない＝分からない）
        expect(c.idToSend("b", "src-1")).toBeNull();
        expect(c.idToSend("a", "src-1")).toBe("src-1");
    });
    it("確実に届いていない（4xx・外した）なら、次の写真に引き継ぐ", () => {
        const c = new InspiredCarrier();
        c.idToSend("a", "src-1");
        c.notDelivered("a");
        expect(c.idToSend("b", "src-1")).toBe("src-1");
    });
    it("通ったあとに外しても、別の写真には載せない", () => {
        const c = new InspiredCarrier();
        c.idToSend("a", "src-1");
        c.saved("a");
        c.notDelivered("a");
        expect(c.idToSend("b", "src-1")).toBeNull();
    });
    it("形の合わない ID は載せず、1枚も決めない", () => {
        const c = new InspiredCarrier();
        expect(c.idToSend("a", "bad#id")).toBeNull();
        expect(c.idToSend("b", "src-1")).toBe("src-1");
    });
});

describe("inspiredWasDropped（送ったのに付かなかったか）", () => {
    it("応答の写真に同じ ID があれば付いた", () => {
        expect(inspiredWasDropped("src-1", { id: "new", inspiredBy: "src-1" })).toBe(false);
    });
    it("応答の写真に無ければ付かなかった", () => {
        expect(inspiredWasDropped("src-1", { id: "new" })).toBe(true);
    });
    it("応答に写真が無い・送っていないなら言わない", () => {
        expect(inspiredWasDropped("src-1", undefined)).toBe(false);
        expect(inspiredWasDropped(null, { id: "new" })).toBe(false);
    });
});
