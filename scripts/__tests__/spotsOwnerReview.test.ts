import { describe, it, expect } from "vitest";
import {
    spotContentHash, buildReviewData, flattenReviews, promoteReviewed, ABROAD,
} from "../spots-owner-review.mjs";

/**
 * **owner が確認帳で押した判定を台帳へ戻すスクリプト**を、固定データで縛る。
 *
 * いちばん守りたいのは「確かめた後に文章が変わった行を、owner の名前で
 * 公開しない」こと（指紋の突き合わせ）。
 */

const draft = {
    spotId: "sp_000000000001",
    slug: "a",
    name: "A 滝",
    status: "review",
    region: { country: "日本", prefecture: "千葉県", city: "君津市" },
    coords: { lat: 35.24, lng: 140.06 },
    summary: "あ".repeat(40),
    description: "春分のころの早朝が見頃です。",
    highlights: ["洞窟の光"],
    seasonalGuide: [{ season: "spring", text: "春分のころ" }],
    timeOfDayGuide: [{ time: "dawn", text: "6時30分ごろ" }],
    compositionTips: ["三脚を使う"],
    officialWebsiteUrl: "https://example.jp/a",
    draftedAt: "2026-09-24",
    draftedBy: "claude",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
};

const ok = (s: typeof draft, extra = {}) => ({ verdict: "ok", note: "", hash: spotContentHash(s), at: "2026-09-26T03:00:00.000Z", ...extra });

describe("中身の指紋", () => {
    it("同じ中身なら同じ、1文字でも変われば変わる", () => {
        expect(spotContentHash({ ...draft })).toBe(spotContentHash(draft));
        expect(spotContentHash({ ...draft, description: "春分のころの早朝が見頃。" })).not.toBe(spotContentHash(draft));
        expect(spotContentHash({ ...draft, timeOfDayGuide: [{ time: "dawn", text: "7時ごろ" }] })).not.toBe(spotContentHash(draft));
        expect(spotContentHash({ ...draft, officialWebsiteUrl: "https://example.jp/b" })).not.toBe(spotContentHash(draft));
        expect(spotContentHash({ ...draft, coords: { lat: 35.25, lng: 140.06 } })).not.toBe(spotContentHash(draft));
    });

    it("画面に出ない項目（作成日など）では変わらない", () => {
        expect(spotContentHash({ ...draft, updatedAt: "2027-01-01T00:00:00.000Z" })).toBe(spotContentHash(draft));
    });
});

describe("確認帳のデータ", () => {
    it("下書きだけを都道府県ごとに分け、各行に指紋を付ける", () => {
        const spots = [
            draft,
            { ...draft, slug: "b", status: "published" },
            { ...draft, slug: "c", region: { country: "フランス", prefecture: "イル・ド・フランス", city: "パリ" } },
        ];
        const { index, files } = buildReviewData(spots) as unknown as { index: { total: number; prefs: { id: string; name: string }[] }; files: Record<string, { slug: string; hash: string; city: string }[]> };
        expect(index.total).toBe(2);
        expect(index.prefs.map((p: { name: string }) => p.name)).toEqual(["千葉県", ABROAD]);
        const chiba = files[index.prefs[0].id];
        expect(chiba.map((r: { slug: string }) => r.slug)).toEqual(["a"]);
        expect(chiba[0].hash).toBe(spotContentHash(draft));
        expect(files[index.prefs[1].id][0].city).toBe("フランス イル・ド・フランス パリ");
    });
});

describe("確認帳の保存形を畳む", () => {
    it("都道府県ごとの items を1枚にする（判定でないものは捨てる）", () => {
        const flat = flattenReviews({
            p01: { items: { a: { verdict: "ok", hash: "x" } } },
            p02: { items: { b: { verdict: "fix", hash: "y" }, junk: 3 } },
        });
        expect(Object.keys(flat).sort()).toEqual(["a", "b"]);
    });

    it("ArtifactData の読み出し（id と data の配列）も受ける", () => {
        const flat = flattenReviews([{ id: "p01", data: { items: { a: { verdict: "ok", hash: "x" } } } }]) as unknown as Record<string, { verdict: string }>;
        expect(flat.a.verdict).toBe("ok");
    });
});

describe("公開に上げる", () => {
    const opts = { by: "rymaruta", today: "2026-09-27" };

    it("「公開してよい」で指紋が合う下書きを、押した日付で公開にする", () => {
        const { next, promoted, skipped } = promoteReviewed([draft], { a: ok(draft) }, opts);
        expect(promoted).toEqual(["a"]);
        expect(skipped).toEqual([]);
        expect(next[0]).toMatchObject({ status: "published", verifiedBy: "rymaruta", verifiedAt: "2026-09-26" });
    });

    it("🔴 確かめた後に文章が変わった行は上げない", () => {
        const review = ok(draft);
        const edited = { ...draft, description: "春分のころの早朝、6時ごろが見頃です。" };
        const { next, promoted, skipped } = promoteReviewed([edited], { a: review }, opts);
        expect(promoted).toEqual([]);
        expect(skipped[0].slug).toBe("a");
        expect(next[0].status).toBe("review");
        expect(next[0]).not.toHaveProperty("verifiedBy");
    });

    it("「直してほしい」・判定なしの行は触らない", () => {
        const { next, promoted } = promoteReviewed([draft], { a: ok(draft, { verdict: "fix", note: "三脚は禁止" }) }, opts);
        expect(promoted).toEqual([]);
        expect(next[0]).toBe(draft);
        expect(promoteReviewed([draft], {}, opts).next[0]).toBe(draft);
    });

    it("公開済みの行は上げ直さない", () => {
        const published = { ...draft, status: "published", verifiedBy: "someone", verifiedAt: "2026-09-25" };
        const { next, promoted } = promoteReviewed([published], { a: ok(published) }, opts);
        expect(promoted).toEqual([]);
        expect(next[0]).toBe(published);
    });

    it("出典が要る項目（注意点）は、公式サイトを確かめた人の名前つきの出典にする", () => {
        const withSafety = { ...draft, safetyNotes: ["洞窟の正面は落石のおそれがあります。"] };
        const { next } = promoteReviewed([withSafety], { a: ok(withSafety) }, opts);
        expect(next[0].sources).toEqual([
            { field: "safetyNotes", url: "https://example.jp/a", title: "A 滝", checkedAt: "2026-09-26", checkedBy: "rymaruta" },
        ]);
    });

    it("🔴 確かめた人に AI の名前・空は書けない", () => {
        expect(() => promoteReviewed([draft], { a: ok(draft) }, { ...opts, by: "Claude" })).toThrow();
        expect(() => promoteReviewed([draft], { a: ok(draft) }, { ...opts, by: " " })).toThrow();
    });
});
