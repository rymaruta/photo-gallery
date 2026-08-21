import { describe, it, expect } from "vitest";
import { splitStoredDate, formatStoredDateTime, EN_MONTHS } from "../photoDate";

// 写真ページの「撮影日時」は描画中に toLocaleString を呼んでいた。
// 2つ壊れていた:
//  1. 静的書き出しのビルドは UTC、閲覧者は各自のゾーン。同じノードの文字列が
//     食い違い、全写真ページでハイドレーション不一致になっていた。
//  2. 保存されている撮影日は "2024-10-12" という日付だけの形で、
//     new Date() はこれを UTC 0時として読む。ローカル整形を当てると
//     ニューヨーク（UTC−5）からは前日と表示される。

describe("splitStoredDate", () => {
    it("日付だけの値は時刻を持たない", () => {
        expect(splitStoredDate("2024-10-12")).toEqual({ y: 2024, m: 10, d: 12 });
    });

    it("時刻付きは時刻も返す", () => {
        expect(splitStoredDate("2024-10-12T09:05:00.000Z")).toEqual({ y: 2024, m: 10, d: 12, hh: 9, mm: 5 });
    });

    it("日付として成立しないものは null", () => {
        for (const v of ["", "きのう", "2024-13-01", "2024-10-32", undefined, null, 20241012]) {
            expect(splitStoredDate(v)).toBeNull();
        }
    });
});

describe("formatStoredDateTime", () => {
    // ここが本丸。ゾーンに関係なく同じ文字列になることを固定する。
    it("日付だけの値を、変換せずにそのまま出す", () => {
        expect(formatStoredDateTime("2024-10-12", "ja")).toBe("2024年10月12日");
        expect(formatStoredDateTime("2024-10-12", "en")).toBe("October 12, 2024");
    });

    // 「12日」が「11日」にならないこと。ここが 5-1 の再現。
    it("実行環境のタイムゾーンに影響されない", () => {
        const tz = process.env.TZ;
        const seen = new Set<string>();
        for (const zone of ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati"]) {
            process.env.TZ = zone;
            seen.add(formatStoredDateTime("2024-10-12", "ja")!);
        }
        process.env.TZ = tz;
        expect([...seen]).toEqual(["2024年10月12日"]);
    });

    it("日付だけの値に 00:00 を作らない", () => {
        expect(formatStoredDateTime("2024-10-12", "ja")).not.toContain(":");
    });

    it("時刻があれば分まで出す", () => {
        expect(formatStoredDateTime("2024-10-12T09:05:00.000Z", "ja")).toBe("2024年10月12日 09:05");
    });

    it("整形できなければ null（＝その行を出さない）", () => {
        expect(formatStoredDateTime(undefined, "ja")).toBeNull();
        expect(formatStoredDateTime("", "ja")).toBeNull();
    });
});

// 年表の見出しでも同じ月名を使う（並びを2か所に持たない）。
// グループ分けは UTC なのに英語ラベルだけ toLocaleDateString だったので、
// UTC より西の閲覧者には **キーが 2024-1 なのに見出しが "December 2023"**
// という食い違いが出ていた。
describe("EN_MONTHS", () => {
    it("1月から12月まで揃っている", () => {
        expect(EN_MONTHS).toHaveLength(12);
        expect(EN_MONTHS[0]).toBe("January");
        expect(EN_MONTHS[11]).toBe("December");
    });

    it("formatStoredDateTime と同じ月名を使う（表記が割れない）", () => {
        expect(formatStoredDateTime("2024-01-15", "en")).toContain(EN_MONTHS[0]);
        expect(formatStoredDateTime("2024-12-15", "en")).toContain(EN_MONTHS[11]);
    });
});
