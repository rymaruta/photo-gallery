import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import { spotPageTitle, spotPageDescription, spotCheckedClaim, spotWhere, SPOT_TITLE_MAX } from "../spotPageMeta";
import { isPublished } from "../../utils/spotGuide";

/**
 * 撮影地ページの title・description と、地域のページの「どう確かめたか」の1文（2026-10-11）。
 * 🔴 宣伝文は事実だけ: 載っていない項目・していない確認を書かない
 */
const ledger = rawLedger as unknown as Spot[];
const base = ledger.find((s) => s.slug === "himeji-castle")!;

describe("title", () => {
    it("検索の語（撮影スポット・時間帯・季節）と地名を入れる", () => {
        const t = spotPageTitle({ name: "姫路城", region: { country: "日本", prefecture: "兵庫県", city: "姫路市" } });
        expect(t).toBe("姫路城の撮影ガイド｜撮影スポット・時間帯・季節（兵庫県 姫路市）");
    });

    it("長い名前は後ろから削る（上限を超えない）", () => {
        const long = { name: "オペラ・ガルニエ（パレ・ガルニエ）", region: { country: "フランス", prefecture: "イル・ド・フランス", city: "パリ" } };
        const t = spotPageTitle(long);
        expect(t).toBe("オペラ・ガルニエ（パレ・ガルニエ）の撮影ガイド（フランス パリ）");
        expect([...t].length).toBeLessThanOrEqual(SPOT_TITLE_MAX);
        expect(spotPageTitle({ name: "あ".repeat(40), region: undefined })).toBe(`${"あ".repeat(40)}の撮影ガイド`);
    });

    it("海外は州ではなく国と都市", () => {
        expect(spotWhere({ region: { country: "スペイン", prefecture: "カタルーニャ州", city: "バルセロナ" } })).toBe("スペイン バルセロナ");
        expect(spotWhere({ region: { country: "日本", prefecture: "京都府", city: "宮津市" } })).toBe("京都府 宮津市");
    });

    it("公開中の全件で上限を超えない", () => {
        for (const s of ledger.filter(isPublished)) expect([...spotPageTitle(s)].length, s.slug).toBeLessThanOrEqual(Math.max(SPOT_TITLE_MAX, [...s.name].length + 6));
    });
});

describe("description", () => {
    it("紹介文＋ページに在るもの（撮影の光・作例の枚数）", () => {
        const d = spotPageDescription({ ...base, seasonalGuide: undefined, timeOfDayGuide: undefined }, { light: true, samples: 5, cover: true });
        expect(d).toBe(`${base.summary}撮影の光（月ごとの日の出・日の入り・ゴールデンアワー）・写真6枚を掲載。`);
    });

    it("無いものは書かない", () => {
        const d = spotPageDescription({ ...base, seasonalGuide: undefined, timeOfDayGuide: undefined }, {});
        expect(d).toBe(base.summary);
    });

    it("季節・時間帯の案内があれば足す。計算の要約（computed）は紹介文のすぐ後", () => {
        const d = spotPageDescription(
            { ...base, seasonalGuide: [{ season: "spring", text: "桜" }] as unknown as Spot["seasonalGuide"], timeOfDayGuide: [{ time: "morning", text: "順光" }] as unknown as Spot["timeOfDayGuide"] },
            { computed: "夕日は11月に正面" },
        );
        expect(d).toBe(`${base.summary}夕日は11月に正面。季節の撮りどき・時間帯ごとの撮り方を掲載。`);
    });

    it("下書きは頭でそう名乗る", () => {
        expect(spotPageDescription({ ...base, status: "review" }, {}).startsWith("【下書き・運営未確認】")).toBe(true);
    });
});

describe("どう確かめたか（spotCheckedClaim）", () => {
    it("🔴 AI 照合の行が混ざれば「運営が確かめた」と書かない", () => {
        const ai = ledger.filter((s) => isPublished(s) && s.aiCheck && !s.verifiedBy).slice(0, 3);
        expect(spotCheckedClaim(ai)).toContain("AI による照合");
        expect(spotCheckedClaim(ai)).not.toContain("運営が確かめ");
    });

    it("全部が人の確認なら「運営が確かめています」・公開が無ければ空", () => {
        const human = ledger.filter((s) => isPublished(s) && s.verifiedBy);
        expect(human.length).toBeGreaterThan(0);
        expect(spotCheckedClaim(human)).toBe("内容は運営が確かめています。");
        expect(spotCheckedClaim([{ ...base, status: "review" }])).toBe("");
    });
});

describe("実態と合わない宣伝文を戻さない（2026-10-11）", () => {
    // アクセスは出典つきで数件しか無く、人が確かめたのは数件（多くは AI 照合）
    const files = [
        "app/spots/area/[area]/page.tsx", "app/spots/page.tsx",
        "app/components/SpotAreaIndexClient.tsx", "app/components/SpotIndexClient.tsx",
    ];
    it.each(files)("%s に「アクセスまで」「運営が調べた撮影地」「Guides we researched」が無い", async (f) => {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const src = fs.readFileSync(path.join(__dirname, "../../..", f), "utf8")
            .split("\n").filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n");
        expect(src).not.toMatch(/アクセスまで|`運営が調べた撮影地|Guides we researched/);
    });
});
