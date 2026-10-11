import { describe, it, expect } from "vitest";
import { takenMonth, takenMonthCounts, takenMonthLine } from "../takenMonth";

/**
 * 作例が撮られた月（2026-10-11）。`spot-samples.json` の撮影日時は出どころの書き方のまま。
 * **月が確かに読めるものだけ**数える（年だけ・幅・日と月の順が決まらない書き方は数えない）
 */
describe("作例の撮影日時から月を読む", () => {
    it("台帳にある書き方（実データの形）", () => {
        expect(takenMonth("2016-10-14 13:41:43")).toBe(10);
        expect(takenMonth("2013-08-05")).toBe(8);
        expect(takenMonth("2006-10")).toBe(10);
        expect(takenMonth("2022-07-26 18:42")).toBe(7);
        expect(takenMonth("2018/03/21")).toBe(3);
        expect(takenMonth("2008-04-28(JST)")).toBe(4);
        expect(takenMonth("2011年9月20日")).toBe(9);
        expect(takenMonth("2014年11月28日, 13:19")).toBe(11);
        expect(takenMonth("2024年5月19日 ( Exif データによる)")).toBe(5);
        expect(takenMonth("Taken on 14 August 2015, 10:26:38")).toBe(8);
        expect(takenMonth("Taken on 2024-11-04T 09:47:22Z")).toBe(11);
        expect(takenMonth("17 August 2007 (according to Exif data)")).toBe(8);
        expect(takenMonth("August 18, 2010")).toBe(8);
    });

    it("月が確かでないものは数えない（推測の月を事実として出さない）", () => {
        for (const s of ["2003", "Unknown date", "不明な日付", "04-10-2025", "11/01/2009", "7/10/06", "2010-2012",
            "between 1890 and 1905", "before 25 May 2026 date QS:P,+2026-05-25T00:00:00Z/7", "1880年頃", "circa 1900",
            "Summer 2005", "2009年", "", undefined, null]) {
            expect(takenMonth(s as string), String(s)).toBeNull();
        }
    });

    it("月ごとの枚数と、節の末尾の1行（日付の無い作例は数に入れない）", () => {
        const list = [{ takenAt: "2016-10-14" }, { takenAt: "Taken on 2 October 2010" }, { takenAt: "2011年4月1日" }, { takenAt: "2003" }, {}];
        expect(takenMonthCounts(list)).toEqual({ counts: [{ month: 4, count: 1 }, { month: 10, count: 2 }], dated: 3 });
        expect(takenMonthLine(list, true)).toBe("作例が撮られた月（撮影日の分かる3枚）: 4月 1枚・10月 2枚");
        expect(takenMonthLine(list, false)).toBe("Months the example photos were taken (3 with a known date): Apr 1, Oct 2");
        expect(takenMonthLine([{ takenAt: "2003" }], true)).toBeNull();
    });
});
