import { describe, it, expect, afterEach } from "vitest";
import { toDateInputValue, mergeDate, todayForDateInput } from "../dateInput";

// 背景: <input type="date"> に ISO 文字列を渡すと黙って空欄になる。
// 空欄を「撮影日が未入力」と誤解して選び直すと、今度は時刻が落ちて
// 同じ日に撮った写真の並び順が崩れていた。読み・書きの両方を固定する。

describe("toDateInputValue", () => {
    it("ISO 文字列から日付部分だけを取り出す", () => {
        expect(toDateInputValue("2026-05-03T10:22:00.000Z")).toBe("2026-05-03");
    });

    it("すでに YYYY-MM-DD ならそのまま返す", () => {
        expect(toDateInputValue("2026-05-03")).toBe("2026-05-03");
    });

    it("未設定・空文字は空文字", () => {
        expect(toDateInputValue(undefined)).toBe("");
        expect(toDateInputValue("")).toBe("");
    });

    it("日付として読めない文字列は空文字（input を壊さない）", () => {
        expect(toDateInputValue("春の京都")).toBe("");
    });

    it("ISO 以外でも解釈できる形式は日付に変換する", () => {
        expect(toDateInputValue("May 3, 2026 00:00:00 UTC")).toBe("2026-05-03");
    });
});

describe("mergeDate", () => {
    it("同じ日を選び直しても元の時刻を保つ", () => {
        expect(mergeDate("2026-05-03T10:22:00.000Z", "2026-05-03"))
            .toBe("2026-05-03T10:22:00.000Z");
    });

    it("別の日に変えたら入力値をそのまま使う", () => {
        expect(mergeDate("2026-05-03T10:22:00.000Z", "2026-05-04")).toBe("2026-05-04");
    });

    it("元の値が無ければ入力値をそのまま使う", () => {
        expect(mergeDate(undefined, "2026-05-04")).toBe("2026-05-04");
    });

    it("元の値が壊れていても入力値を優先する", () => {
        expect(mergeDate("不明", "2026-05-04")).toBe("2026-05-04");
    });

    it("空入力は空のまま（撮影日を消す操作を潰さない）", () => {
        expect(mergeDate("2026-05-03T10:22:00.000Z", "")).toBe("");
    });

    // 「UTC 0時ちょうど」は旧 sanitizeDate が日付だけの入力に付けていた
    // 捏造の時刻（C-12）。元の値を返し続けると、日付を変えない再保存で
    // 永久に移行されない（7951e8c レビューの指摘）。日付だけに直して返す。
    it("元が 0時ちょうど（旧仕様の捏造）なら、同じ日の保存で日付だけに直す", () => {
        expect(mergeDate("2026-01-20T00:00:00.000Z", "2026-01-20")).toBe("2026-01-20");
    });

    it("0時0分1秒は本物の時刻として保つ（直すのは 0時ちょうどだけ）", () => {
        expect(mergeDate("2026-01-20T00:00:01.000Z", "2026-01-20")).toBe("2026-01-20T00:00:01.000Z");
    });
});

// 入力欄に出す範囲。サーバー（両パッケージの sanitizeDate）が 1990年より前と
// 未来を断るので、入れる前に気づけるようにする
describe("todayForDateInput", () => {
    it("YYYY-MM-DD の形で、端末の暦の今日を返す", () => {
        expect(todayForDateInput(new Date(2026, 8, 7))).toBe("2026-09-07");
        // 1桁の月日を0埋めする（`2026-9-7` は input が黙って無視する）
        expect(todayForDateInput(new Date(2026, 0, 3))).toBe("2026-01-03");
    });

    // **UTC で出すと、日本の 0:30 に撮った写真が今日として選べない**
    // （UTC ではまだ前日なので `max` が昨日になる）。この環境は TZ=UTC なので、
    // 素の `new Date(...)` では違いが出ない——ずれる時刻を作って測る
    it("UTC ではなく端末の暦で決める（時差で1日ずれない）", () => {
        const prev = process.env.TZ;
        process.env.TZ = "Asia/Tokyo";
        try {
            // JST 2026-09-07 00:30 ＝ UTC 2026-09-06 15:30
            const d = new Date("2026-09-06T15:30:00Z");
            expect(d.getUTCDate(), "前提: UTC ではまだ前日").toBe(6);
            expect(todayForDateInput(d), "UTC の日付を出している").toBe("2026-09-07");
        } finally {
            if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
        }
    });
});

// **端末のタイムゾーンで、撮影時刻が黙って落ちていた。**
// EXIF 由来の撮影日時は `exifWallClock` が「書いてあるとおりの壁時計」
// （`2024-11-01T07:30:00`・ゾーン指定なし）で保存する——`toISOString` を
// 使うと端末のゾーンぶん平行移動するから、というのがその関数の存在理由。
// ところが `mergeDate` の同日判定が `Date.parse` + `toISOString` で、
// **ゾーン無しの文字列を端末のゾーンで解釈する**ので、同じずれを
// 画面側で作り直していた。日付を1文字も触らずに保存すると時刻が消える。
describe("mergeDate: 端末のタイムゾーンで結果が変わらない", () => {
    const TZS = ["Asia/Tokyo", "UTC", "America/New_York"];
    // **前の値に戻す**（消すと、外から `TZ` を渡して走らせたときに
    // このファイルより下の describe が黙ってゾーンを失う）
    const prevTZ = process.env.TZ;
    afterEach(() => { if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ; });

    // JST では 00:00〜08:59、ニューヨークでは 19:00〜23:59 が UTC で別の日になる。
    // **期待する入力は書き下す。** `toDateInputValue(stored)` を渡していた頃は、
    // 両側が同じだけずれれば必ず一致するので、**`toDateInputValue` から
    // 「先頭の YYYY-MM-DD をそのまま返す」枝を消しても 3,312 件が緑**だった
    // （＝日本の朝に撮った写真の編集欄に前日が出る状態を、誰も見ていない）
    it.each([["2024-11-01T07:30:00", "2024-11-01"], ["2024-11-01T20:30:00", "2024-11-01"],
        ["2024-11-01T12:00:00", "2024-11-01"]])(
        "%s は、どのゾーンでも時刻ごと保たれる", (stored, shown) => {
            for (const tz of TZS) {
                process.env.TZ = tz;
                expect(toDateInputValue(stored), `${tz} で欄に出る日付がずれた`).toBe(shown);
                expect(mergeDate(stored, shown), `${tz} で時刻が落ちた`).toBe(stored);
            }
        });

    it("日付を変えたら、どのゾーンでも新しい日付だけになる", () => {
        for (const tz of TZS) {
            process.env.TZ = tz;
            expect(mergeDate("2024-11-01T07:30:00", "2024-11-02")).toBe("2024-11-02");
        }
    });

    // 捏造の UTC 0時（C-12）は今までどおり日付だけへ移行する
    it("UTC 0時ちょうどは、どのゾーンでも日付だけに直す", () => {
        for (const tz of TZS) {
            process.env.TZ = tz;
            expect(mergeDate("2024-11-01T00:00:00.000Z", "2024-11-01")).toBe("2024-11-01");
        }
    });

    it("本物の Z 付きは、どのゾーンでも保たれる", () => {
        for (const tz of TZS) {
            process.env.TZ = tz;
            expect(mergeDate("2024-11-01T22:30:00.000Z", "2024-11-01")).toBe("2024-11-01T22:30:00.000Z");
        }
    });
});
