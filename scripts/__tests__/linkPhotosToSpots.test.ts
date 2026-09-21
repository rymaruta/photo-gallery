import { describe, it, expect } from "vitest";
import { splitItems, formatPreview, SPOT_ID_PREFIX } from "../link-photos-to-spots";

describe("splitItems", () => {
    it("台帳の行と写真を仕分ける（マーカー・文書は落とす）", () => {
        const { photos, spots } = splitItems([
            { id: "uploads/a.jpg", src: "/uploads/a.jpg" },
            { id: `${SPOT_ID_PREFIX}sp_1`, name: "高屋神社" },
            { id: "like#uploads/a.jpg#u1" },          // マーカー（src 無し）
            { id: "comments#uploads/a.jpg", items: [] }, // 文書
        ]);
        expect(photos.map((p) => p.id)).toEqual(["uploads/a.jpg"]);
        expect(spots).toHaveLength(1);
    });

    it("台帳の行を写真として数えない（photos.json に漏らさない形と同じ）", () => {
        const { photos } = splitItems([{ id: `${SPOT_ID_PREFIX}sp_1`, src: "/uploads/cover.jpg" }]);
        expect(photos).toEqual([]);
    });
});

describe("formatPreview", () => {
    it("確定・保留・対象外の件数を出す", () => {
        const text = formatPreview([
            { photoId: "p1", location: "高屋神社", spotId: "sp_1", spotName: "高屋神社", verdict: "confirmed", reason: "名前が1件だけ一致" },
            { photoId: "p2", location: "清水寺", verdict: "ambiguous", reason: "同名異所" },
            { photoId: "p3", location: "東京", verdict: "unmatched", reason: "台帳に無い" },
        ]);
        expect(text).toContain("付ける 1 件 / 保留 1 件 / 対象外 1 件");
        expect(text).toContain("p1");
        expect(text).toContain("未設定のまま残す");
    });
});
