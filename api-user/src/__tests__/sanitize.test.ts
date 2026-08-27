import { describe, it, expect, vi } from "vitest";
import { sanitizeBlurDataURL, sanitizeTags, sanitizeTitle, sanitizeText, sanitizeDate } from "../sanitize";

describe("sanitizeBlurDataURL", () => {
    it("webp/jpeg/png の base64 data URI を許可", () => {
        const webp = "data:image/webp;base64,UklGRAAAAA";
        expect(sanitizeBlurDataURL(webp)).toBe(webp);
        expect(sanitizeBlurDataURL("data:image/jpeg;base64,/9j/4AAQ==")).toBe("data:image/jpeg;base64,/9j/4AAQ==");
        expect(sanitizeBlurDataURL("data:image/png;base64,iVBORw0K")).toBe("data:image/png;base64,iVBORw0K");
    });
    it("http/その他スキーム・svg・非文字列は弾く", () => {
        expect(sanitizeBlurDataURL("https://x/x.webp")).toBeUndefined();
        expect(sanitizeBlurDataURL("data:image/svg+xml;base64,PHN2Zz4=")).toBeUndefined();
        expect(sanitizeBlurDataURL("data:text/html;base64,PGh0bWw+")).toBeUndefined();
        expect(sanitizeBlurDataURL(123)).toBeUndefined();
        expect(sanitizeBlurDataURL(undefined)).toBeUndefined();
    });
    it("4000文字超は弾く", () => {
        expect(sanitizeBlurDataURL("data:image/webp;base64," + "A".repeat(4100))).toBeUndefined();
    });
});

describe("sanitize 基本ヘルパ", () => {
    it("sanitizeText は trim/空/上限", () => {
        expect(sanitizeText("  hi ", 10)).toBe("hi");
        expect(sanitizeText("", 10)).toBeUndefined();
        expect(sanitizeText("x".repeat(20), 5)).toBe("xxxxx");
    });
    it("sanitizeTags は文字列のみ・重複排除・上限", () => {
        expect(sanitizeTags(["a", "a", 1, "  ", "b"])).toEqual(["a", "b"]);
        expect(sanitizeTags("nope")).toBeUndefined();
    });
    it("sanitizeTitle は string/{ja,en}/空", () => {
        expect(sanitizeTitle("  T ")).toBe("T");
        expect(sanitizeTitle({ ja: "あ", en: "" })).toEqual({ ja: "あ" });
        expect(sanitizeTitle("   ")).toBeUndefined();
    });
});

describe("sanitizeDate（撮影日）", () => {
    it("ISO 文字列を ISO に正規化する", () => {
        expect(sanitizeDate("2024-10-12T07:32:00.000Z")).toBe("2024-10-12T07:32:00.000Z");
    });
    // 以前は "2024-10-12" が "2024-10-12T00:00:00.000Z" になり、表示側が
    // 0時ちょうどという**存在しない時刻**を描いていた（/user/edit の撮影日
    // 入力は日付だけを送る）。日付だけの入力は日付のまま保つ。
    it("日付だけの入力は日付のまま保つ（0時を捏造しない）", () => {
        expect(sanitizeDate("2024-10-12")).toBe("2024-10-12");
        // 範囲チェックは日付だけでも効く
        expect(sanitizeDate("1980-01-01")).toBeUndefined();
    });
    // EXIF の撮影日時にはゾーンが無い。lib/utils/exif.ts は「その土地の
    // 壁時計」を `2024-11-01T07:30:00` の形で送ってくる。ここで
    // toISOString に通すと、**この Lambda のゾーン**（既定 UTC）で
    // 解釈し直した値になり、環境に依存する保存になる。
    // 表示側は保存されている数字をそのまま出す（photoDate.ts）ので、
    // 書かれたまま保つのが正しい。
    it("ゾーンを書いていない日時は、書かれたまま保つ", () => {
        expect(sanitizeDate("2024-11-01T07:30:00")).toBe("2024-11-01T07:30:00");
        expect(sanitizeDate("2024-11-01T07:30")).toBe("2024-11-01T07:30");
        // Z 付きは今までどおり正規化する（別の意味＝本当に UTC の瞬間）
        expect(sanitizeDate("2024-11-01T07:30:00Z")).toBe("2024-11-01T07:30:00.000Z");
        // 範囲チェックはゾーン無しでも効く
        expect(sanitizeDate("1980-11-01T07:30:00")).toBeUndefined();
    });

    it("実行環境のゾーンが変わっても保存値が変わらない", () => {
        const orig = process.env.TZ;
        try {
            const seen = new Set<string | undefined>();
            for (const tz of ["Asia/Tokyo", "UTC", "America/New_York"]) {
                process.env.TZ = tz;
                seen.add(sanitizeDate("2024-11-01T07:30:00"));
            }
            expect(Array.from(seen)).toEqual(["2024-11-01T07:30:00"]);
        } finally {
            process.env.TZ = orig;
        }
    });

    it("日付だけの未来境界: 昨日は通り、明後日は弾く（+24h マージンとの噛み合い）", () => {
        // "明日" の date-only は UTC 深夜として +24h マージン内に必ず収まる
        // （時差で「現地の今日」が弾かれないための余白）。明後日は必ず外れる。
        // 時刻は固定する——d() の計算と sanitizeDate 内部の Date.now() が
        // UTC 0時をまたぐと両断言が反転しうる（レビュー指摘の μs 窓）。
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
        try {
            const d = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
            expect(sanitizeDate(d(-1))).toBe(d(-1));
            expect(sanitizeDate(d(2))).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
    it("空・非文字列・解釈不能はundefined", () => {
        expect(sanitizeDate("")).toBeUndefined();
        expect(sanitizeDate("   ")).toBeUndefined();
        expect(sanitizeDate(12345)).toBeUndefined();
        expect(sanitizeDate("いつか")).toBeUndefined();
    });
    it("カメラの日付未設定（1990年より前）は捨てる", () => {
        expect(sanitizeDate("1970-01-01T00:00:00.000Z")).toBeUndefined();
        expect(sanitizeDate("1980-01-01T00:00:00.000Z")).toBeUndefined();
    });
    it("未来日は捨てる", () => {
        const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
        expect(sanitizeDate(future)).toBeUndefined();
    });
});
