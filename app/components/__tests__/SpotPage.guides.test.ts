import { describe, it, expect, vi } from "vitest";
import type { Photo } from "../../../lib/data/photos";

/**
 * 撮影地のページから公式撮影地ガイドへ（2026-09-30 のレビュー: 正式なスポットが確定している
 * 写真は、そのスポットへ自然に辿れるように）。**`spotId` だけで決める**——撮影地の文字列と
 * スポットの名前が似ているだけでは出さない。
 */
vi.mock("../../../lib/server/photos", () => ({ loadAllPhotos: async () => [] }));
vi.mock("../../../lib/data/spotLink", () => ({
    spotLinkForPhoto: (id: string | undefined | null) =>
        id === "sp_aaaaaaaaaaaa" ? { slug: "ginzan-onsen", name: "銀山温泉" }
            : id === "sp_bbbbbbbbbbbb" ? { slug: "yamadera", name: "山寺" }
                : null,
}));

const { guidesFor } = await import("../SpotPage");
const P = (id: string, extra: Partial<Photo> = {}): Photo => ({ id, src: "x", location: "銀山温泉", ...extra } as Photo);

describe("guidesFor", () => {
    it("写真が spotId を持つときだけ・重複なし・多い順", () => {
        const got = guidesFor([
            P("1", { spotId: "sp_bbbbbbbbbbbb" }),
            P("2", { spotId: "sp_aaaaaaaaaaaa" }), P("3", { spotId: "sp_aaaaaaaaaaaa" }),
            P("4"),
        ]);
        expect(got.map((g) => g.slug)).toEqual(["ginzan-onsen", "yamadera"]);
    });

    it("撮影地の文字列がスポットの名前と同じでも、spotId が無ければ出さない", () => {
        expect(guidesFor([P("1"), P("2")])).toEqual([]);
    });

    it("台帳に無い（公開されていない）spotId は出さない", () => {
        expect(guidesFor([P("1", { spotId: "sp_cccccccccccc" })])).toEqual([]);
    });
});
