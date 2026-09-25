import { describe, it, expect } from "vitest";
import {
    reviewStage, reviewStageOne, stripEmphasis, needsReviewStage, formatLedger, buildReport, DRAFTED_BY,
} from "../spots-review-stage.mjs";

/**
 * **台帳から「人が確かめた」という主張を外すスクリプト**を、固定データで縛る。
 *
 * 実物の台帳（1,417件）に対する検査は `lib/data/__tests__/spotsLedger.test.ts`
 * が `reviewStage` を掛けて差分0であることで見る（冪等性を見張りに兼用）。
 */

const base = {
    spotId: "sp_000000000001",
    slug: "a",
    name: "A",
    status: "published",
    verified: true,
    verifiedAt: "2026-09-24",
    summary: "あ".repeat(40),
    description: "**海が地面に見える**現象です。**氷が割れる瞬間**が撮れる。",
    highlights: ["**水平線**まで続く氷原", "普通の行"],
    seasonalGuide: [{ season: "winter", text: "**本番**の季節" }],
    timeOfDayGuide: [{ time: "day", text: "対比が**最大**になります" }],
    compositionTips: ["**引き**で撮る"],
    createdAt: "2026-09-24T01:02:03.000Z",
    updatedAt: "2026-09-24T01:02:03.000Z",
};

describe("確認者の無い行は下書き（review）に落とす", () => {
    it("published → review。verified と verifiedAt を消し、draftedAt/draftedBy を足す", () => {
        const [s] = reviewStage([base]);
        expect(s.status).toBe("review");
        expect("verified" in s).toBe(false);
        expect("verifiedAt" in s).toBe(false);
        expect(s.draftedAt).toBe("2026-09-24");
        expect(s.draftedBy).toBe(DRAFTED_BY);
        // 入力は変えない（純関数）
        expect(base.status).toBe("published");
        expect(base.verified).toBe(true);
    });

    it("鍵の並びは元のまま。消した位置に draftedAt/draftedBy が入る", () => {
        const [s] = reviewStage([base]);
        const keys = Object.keys(s);
        expect(keys.indexOf("status")).toBeLessThan(keys.indexOf("draftedAt"));
        expect(keys.indexOf("draftedAt") + 1).toBe(keys.indexOf("draftedBy"));
        expect(keys.indexOf("draftedBy")).toBeLessThan(keys.indexOf("summary"));
    });

    it("AI が書いた行でも確認者（verifiedBy）を持つなら、旧い verified を消すだけ", () => {
        const [s] = reviewStage([{ ...base, verifiedBy: "運営" }]);
        expect(s.status).toBe("published");
        expect(s.verifiedAt).toBe("2026-09-24");
        expect(s.verifiedBy).toBe("運営");
        expect("verified" in s).toBe(false);
        expect("draftedAt" in s).toBe(false);
    });

    /// 🔴 **人が書いた行（旧い verified を持たない）は触らない。** 名前の
    /// 書き忘れをスクリプトが黙って「下書き」に直すと、人の日付が消える
    /// ——それは台帳のテストが赤にして知らせる仕事
    it("人が書いた行は、確認者が無くても verifiedAt を消さず draftedBy も付けない", () => {
        const human = { ...base } as Record<string, unknown>;
        delete human.verified;
        const [s] = reviewStage([human]);
        expect(s.status).toBe("published");
        expect(s.verifiedAt).toBe("2026-09-24");
        expect("draftedBy" in s).toBe(false);
        expect("draftedAt" in s).toBe(false);
        // 強調だけは剥がす
        expect(s.description).not.toContain("**");
    });

    it("draft は draft のまま（ページを作らない下書き）", () => {
        const [s] = reviewStage([{ ...base, status: "draft" }]);
        expect(s.status).toBe("draft");
        expect(s.draftedAt).toBe("2026-09-24");
    });

    it("2回掛けても同じ（冪等）", () => {
        const once = reviewStage([base]);
        const twice = reviewStage(once);
        expect(twice).toEqual(once);
        expect(needsReviewStage([base])).toBe(true);
        expect(needsReviewStage(once)).toBe(false);
    });
});

describe("本文の **強調** を剥がす（画面は Markdown を描かない）", () => {
    it("文字列・配列・{ text } の配列すべてから剥がす", () => {
        const s = reviewStageOne(base);
        expect(s.description).toBe("海が地面に見える現象です。氷が割れる瞬間が撮れる。");
        expect(s.highlights).toEqual(["水平線まで続く氷原", "普通の行"]);
        expect(s.seasonalGuide[0].text).toBe("本番の季節");
        expect(s.timeOfDayGuide[0].text).toBe("対比が最大になります");
        expect(s.compositionTips).toEqual(["引きで撮る"]);
    });

    it("`*` 単独・奇数個・空の強調は触らない（意図が分からないものは残す）", () => {
        expect(stripEmphasis("3*4 の格子")).toBe("3*4 の格子");
        expect(stripEmphasis("**閉じていない")).toBe("**閉じていない");
        expect(stripEmphasis("****")).toBe("****");
        expect(stripEmphasis("行を**またぐ\n強調**は残す")).toBe("行を**またぐ\n強調**は残す");
    });
});

describe("書式と確認キュー", () => {
    it("台帳の書式は JSON.stringify(_, null, 2) ＋ 改行1つ", () => {
        expect(formatLedger([{ a: 1 }])).toBe("[\n  {\n    \"a\": 1\n  }\n]\n");
    });

    it("確認キューは変わりやすい事実・最上級・出典・残った * を slug つきで並べる", () => {
        const spots = reviewStage([
            { ...base, description: "駐車場は無料。開園9時。日本一の眺め。3*4 の格子" },
            { ...base, slug: "b", officialWebsiteUrl: "https://x.pref.example.gov.jp/", sources: [{ field: "access", url: "https://example.example/a", checkedAt: "2026-09-24" }] },
        ]);
        const md = buildReport(spots);
        expect(md).toContain("- a: 駐車・開園");
        expect(md).toContain("- a: 日本一");
        expect(md).toContain("x.pref.example.gov.jp: b");
        expect(md).toContain("- b: access https://example.example/a");
        expect(md).toMatch(/`\*` が残っている 1 件[\s\S]*- a/);
    });
});
