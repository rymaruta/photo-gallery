import { describe, it, expect } from "vitest";
import { COUNTRY_TABLE, countryIn, visitedCountryCount } from "../visitedCountries";

// 訪れた国・地域。iOS の `VisitedCountriesTests.swift` と同じ見張り
// （表と当て方を iOS と揃えておく——マイページの数が Web とアプリで割れないように）。

describe("訪れた国・地域", () => {
    it("書かれていれば当たる（日本語・英語とも）", () => {
        expect(countryIn("サントリーニ島, ギリシャ")).toBe("ギリシャ");
        expect(countryIn("Paris, France")).toBe("フランス");
        expect(countryIn("REYKJAVIK　ICELAND")).toBe("アイスランド");
    });

    it("🔴 地名から国を推測しない（書いていない国を実績に並べない）", () => {
        expect(countryIn("山中湖")).toBeNull();
        expect(countryIn("バルセロナ")).toBeNull();
        expect(countryIn("")).toBeNull();
        expect(countryIn(undefined)).toBeNull();
    });

    it("同じ国は1つ。「パリ」「パリ, フランス」で2にならない", () => {
        const photos = [{ location: "パリ, フランス" }, { location: "ニース, フランス" }, { location: "パリ" }];
        expect(visitedCountryCount(photos)).toBe(1);
    });

    it("長い名前から当てる", () => {
        expect(countryIn("ケープタウン, 南アフリカ")).toBe("南アフリカ");
        expect(countryIn("オークランド, ニュージーランド")).toBe("ニュージーランド");
    });

    it("見るのは撮影地の文字列だけ（文字列でない値は数えない）", () => {
        expect(visitedCountryCount([{ location: "天空の鳥居" }])).toBe(0);
        expect(visitedCountryCount([{ location: "天空の鳥居, 日本" }])).toBe(1);
        expect(visitedCountryCount([{ location: { ja: "日本" } }, {}])).toBe(0);
    });

    it("表に同じ国を2行書かない（二重に数える）", () => {
        const ja = COUNTRY_TABLE.map((e) => e.ja);
        const en = COUNTRY_TABLE.map((e) => e.en);
        expect(new Set(ja).size).toBe(ja.length);
        expect(new Set(en).size).toBe(en.length);
        // 英語は小文字で持つ（当てる側が小文字にして比べる）
        expect(en.every((e) => e === e.toLowerCase())).toBe(true);
    });
});
