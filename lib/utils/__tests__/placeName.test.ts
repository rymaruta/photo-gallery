import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import { placeParts, placeLine, areaKind, COUNTRIES, OVERSEAS_AREAS, PREFECTURES } from "../placeName";

/**
 * 撮影地の文字列を「見出し／どこの／地域か」に分ける（表示専用・データは変えない）。
 * 2026-09-30 のレビュー: 「フランス」「パリ」「フランス ヴェルサイユ」が同じ一覧に並ぶ・
 * 長い住所がそのまま見出しになる。
 */
describe("placeParts", () => {
    it("長い住所は、具体的な場所を見出しに・地域を「どこの」に", () => {
        expect(placeParts("香川県 観音寺市 高屋神社")).toEqual({ title: "高屋神社", context: "香川県 観音寺市", kind: "place" });
        expect(placeParts("茨城県 ひたちなか市 国営ひたち海浜公園")).toEqual({ title: "国営ひたち海浜公園", context: "茨城県 ひたちなか市", kind: "place" });
    });

    it("国・都市は地域と分かる（どちらの書き順でも）", () => {
        expect(placeParts("フランス")).toEqual({ title: "フランス", context: "", kind: "country" });
        expect(placeParts("パリ")).toEqual({ title: "パリ", context: "", kind: "municipality" });
        expect(placeParts("フランス ヴェルサイユ")).toEqual({ title: "ヴェルサイユ", context: "フランス", kind: "municipality" });
        expect(placeParts("パリ, フランス")).toEqual({ title: "パリ", context: "フランス", kind: "municipality" });
        expect(placeParts("北海道").kind).toBe("prefecture");
        expect(placeParts("東京").kind).toBe("prefecture");
        expect(placeParts("福岡").kind).toBe("prefecture");
    });

    it("括弧の中は「どこの」", () => {
        expect(placeParts("オペラ・ガルニエ（パリ）")).toEqual({ title: "オペラ・ガルニエ", context: "パリ", kind: "place" });
        expect(placeParts("金閣寺 (京都府)")).toEqual({ title: "金閣寺", context: "京都府", kind: "place" });
    });

    it("地域と分からないものは「場所」——撮影スポットだとは名乗らない", () => {
        expect(placeParts("山中湖")).toEqual({ title: "山中湖", context: "", kind: "place" });
        expect(areaKind("高屋神社")).toBe("place");
        expect(areaKind("観音寺市")).toBe("municipality");
    });

    // 1語の「〜町」「〜村」は地名・施設名のことが多い（祇園町・明治村）。並んだときだけ地域
    it("区・町・村は、県か市と並んでいるときだけ地域", () => {
        expect(placeParts("祇園町").kind).toBe("place");
        expect(placeParts("明治村").kind).toBe("place");
        expect(placeParts("東京都 渋谷区")).toEqual({ title: "渋谷区", context: "東京都", kind: "municipality" });
        expect(placeParts("観音寺市").kind).toBe("municipality");
    });

    it("カードの2行目: 地域でも「どこの」を残す（「パリ」と「パリ, フランス」を見分ける）", () => {
        expect(placeLine("パリ")).toBe("地域・");
        expect(placeLine("パリ, フランス")).toBe("フランス・地域・");
        expect(placeLine("香川県 観音寺市 高屋神社")).toBe("香川県 観音寺市・");
        expect(placeLine("山中湖")).toBe("");
    });

    it("空は空", () => {
        expect(placeParts("  ")).toEqual({ title: "", context: "", kind: "place" });
    });

    /// 台帳に地域が増えたら表を足す（増えた地域を「場所」と誤って名乗らない）
    it("台帳（公開済み）の国・都道府県・海外の地域名は、すべて地域と分かる", () => {
        const rows = (rawLedger as Array<{ status: string; region?: { country?: string; prefecture?: string; city?: string } }>)
            .filter((r) => r.status === "published");
        const missing = new Set<string>();
        for (const r of rows) {
            const g = r.region ?? {};
            if (g.country && !COUNTRIES.includes(g.country)) missing.add(g.country);
            if (g.country === "日本") {
                if (g.prefecture && !PREFECTURES.includes(g.prefecture)) missing.add(g.prefecture);
            } else {
                for (const v of [g.prefecture, g.city]) if (v && !OVERSEAS_AREAS.includes(v)) missing.add(v);
            }
        }
        expect([...missing], "placeName.ts の表に足すこと").toEqual([]);
    });
});
