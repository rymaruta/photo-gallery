import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import { spotPageTitle, spotPageDescription, spotCheckedClaim, spotWhere, titleWidth, SPOT_TITLE_MAX, isClosureSeasonText } from "../spotPageMeta";
import { SEASON_JA } from "../spotTopics";
import { isPublished } from "../../utils/spotGuide";

/**
 * 撮影地ページの title・description と、地域のページの「どう確かめたか」の1文（2026-10-11）。
 * 🔴 宣伝文は事実だけ: 載っていない項目・していない確認を書かない
 */
const ledger = rawLedger as unknown as Spot[];
const base = ledger.find((s) => s.slug === "himeji-castle")!;

describe("title（2026-10-22: 検索される型「〈名所〉 写真／撮影／撮影地」に合わせる）", () => {
    const himeji = { name: "姫路城", region: { country: "日本", prefecture: "兵庫県", city: "姫路市" } };

    it("名前のすぐ後に「の写真・撮影スポット」、押す理由（作例の節の枚数）、収まれば地名。サイト名は付けない", () => {
        const t = spotPageTitle(himeji, { samples: 5, cover: true, light: true });
        // 🔴 作例は節に並ぶ5枚だけ（代表写真は数えない・2026-10-22 レビュー）
        expect(t).toBe("姫路城の写真・撮影スポット｜作例5枚（兵庫県 姫路市）");
        expect(t).not.toContain("Journey Photo");
        expect(titleWidth(t)).toBeLessThanOrEqual(SPOT_TITLE_MAX);
    });

    it("🔴 作例が0枚なら「作例」を書かない・写真が1枚も無ければ「写真」と名乗らない", () => {
        expect(spotPageTitle(himeji, { samples: 0, cover: true, light: true })).toBe("姫路城の写真・撮影スポット（兵庫県 姫路市）");
        expect(spotPageTitle(himeji, { samples: 2, cover: false })).toBe("姫路城の写真・撮影スポット｜作例2枚（兵庫県 姫路市）");
        expect(spotPageTitle(himeji, { samples: 0, cover: false, light: true })).toBe("姫路城の撮影スポット（兵庫県 姫路市）");
        expect(spotPageTitle(himeji, {})).toBe("姫路城の撮影スポット（兵庫県 姫路市）");
    });

    it("短くする規則: 地域 → 作例の順に落とし、「の写真」は最後まで残す", () => {
        const abukuma = { name: "あぶくま洞", region: { country: "日本", prefecture: "福島県", city: "田村市" } };
        expect(spotPageTitle(abukuma, { samples: 5, cover: true })).toBe("あぶくま洞の写真・撮影スポット｜作例5枚（福島県 田村市）");
        const longer = { name: "国営ひたち海浜公園 みはらしの丘", region: { country: "日本", prefecture: "茨城県", city: "ひたちなか市" } };
        // 地名まで入れると 33 を超える → 地名を落とし、作例は残す
        expect(spotPageTitle(longer, { samples: 5, cover: true })).toBe("国営ひたち海浜公園 みはらしの丘の写真・撮影スポット｜作例5枚");
        const opera = { name: "オペラ・ガルニエ（パレ・ガルニエ）", region: { country: "フランス", prefecture: "イル・ド・フランス", city: "パリ" } };
        expect(spotPageTitle(opera, { cover: true })).toBe("オペラ・ガルニエ（パレ・ガルニエ）の写真・撮影スポット");
        // 名前そのものが長い → 「〇〇の写真」（写真は落とさない）
        expect(spotPageTitle({ name: "あ".repeat(40), region: undefined }, { samples: 3 })).toBe(`${"あ".repeat(40)}の写真`);
        expect(spotPageTitle({ name: "あ".repeat(40), region: undefined }, {})).toBe(`${"あ".repeat(40)}の撮影スポット`);
    });

    it("全角換算の長さ（半角は 0.5）", () => {
        expect(titleWidth("ab")).toBe(1);
        expect(titleWidth("あa")).toBe(1.5);
    });

    it("海外は州ではなく国と都市", () => {
        expect(spotWhere({ region: { country: "スペイン", prefecture: "カタルーニャ州", city: "バルセロナ" } })).toBe("スペイン バルセロナ");
        expect(spotWhere({ region: { country: "日本", prefecture: "京都府", city: "宮津市" } })).toBe("京都府 宮津市");
    });

    it("公開中の全件: 写真があれば必ず「〇〇の写真」を含み、上限を超えるのは名前そのものが長いときだけ。無ければ「写真」を含まない", () => {
        for (const s of ledger.filter(isPublished)) {
            const t = spotPageTitle(s, { samples: 5, cover: true, light: true });
            expect(t, s.slug).toContain(`${s.name}の写真`);
            if (t !== `${s.name}の写真`) expect(titleWidth(t), s.slug).toBeLessThanOrEqual(SPOT_TITLE_MAX);
            const none = spotPageTitle(s, {});
            expect(none.replace(s.name, ""), s.slug).not.toContain("写真");
        }
    });

    it("ページはサイトの template を外し、title と description に同じ事実を渡す", async () => {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const src = fs.readFileSync(path.join(__dirname, "../../../app/spots/[slug]/page.tsx"), "utf8");
        expect(src).toMatch(/title: \{ absolute: title \}/);
        expect(src).toMatch(/spotPageTitle\(spot, facts\)/);
        expect(src).toMatch(/spotPageDescription\(spot, facts\)/);
    });
});

describe("description（押す理由を頭・Wikipedia 由来の紹介文は後ろ）", () => {
    const plain = { ...base, seasonalGuide: undefined, timeOfDayGuide: undefined };

    it("頭に「〇〇の写真・撮影地ガイド。」と作例の節の枚数・光の表、紹介文は最後", () => {
        const d = spotPageDescription(plain, { light: true, samples: 5, cover: true });
        expect(d).toBe(`姫路城の写真・撮影地ガイド。作例5枚、月ごとの日の出・日の入り・ゴールデンアワー。${base.summary}`);
        expect(d.indexOf("作例5枚")).toBeLessThan(d.indexOf(base.summary!));
    });

    it("無いものは書かない（作例0枚なら作例を書かない・写真が無ければ「写真」と名乗らない）", () => {
        expect(spotPageDescription(plain, { samples: 0, cover: true })).toBe(`姫路城の写真・撮影地ガイド。${base.summary}`);
        const none = spotPageDescription(plain, { samples: 0, cover: false });
        expect(none).toBe(`姫路城の撮影地ガイド。${base.summary}`);
        expect(none).not.toContain("作例");
    });

    it("季節ごとの景色は在る季節だけを春夏秋冬の順で・計算の要約（方角・天の川）は紹介文より前", () => {
        const d = spotPageDescription(
            { ...base, seasonalGuide: [{ season: "winter", text: "氷柱" }, { season: "spring", text: "桜" }] as unknown as Spot["seasonalGuide"], timeOfDayGuide: [{ time: "morning", text: "順光" }] as unknown as Spot["timeOfDayGuide"] },
            { samples: 1, computed: "日の入りは6月が西北西寄り、12月が西南西寄り" },
        );
        expect(d).toBe(`姫路城の写真・撮影地ガイド。作例1枚、季節ごとの景色（春・冬）、時間帯ごとの撮り方。日の入りは6月が西北西寄り、12月が西南西寄り。${base.summary}`);
    });

    it("🔴 閉鎖・運休・見学できない季節は並べない（公開中の台帳の実例で）", () => {
        const closed = ledger.filter(isPublished).flatMap((s) => (s.seasonalGuide ?? [])
            .filter((g) => isClosureSeasonText(g.text)).map((g) => ({ s, season: g.season })));
        expect(closed.length, "台帳に閉鎖の季節が1件も無い（見張りが空回りしている）").toBeGreaterThan(3);
        for (const { s, season } of closed) {
            const d = spotPageDescription(s, { samples: 1 });
            const m = /季節ごとの景色（([^）]*)）/.exec(d);
            const listed = m ? m[1].split("・") : [];
            // 同じ季節に閉鎖でない案内もあれば並べてよい
            const open = (s.seasonalGuide ?? []).some((g) => g.season === season && !isClosureSeasonText(g.text));
            if (!open) expect(listed, `${s.slug} ${season}`).not.toContain(SEASON_JA[season]);
        }
        const akita = ledger.find((s) => s.slug === "akitainu-no-sato");
        if (akita && isPublished(akita)) expect(spotPageDescription(akita, {})).not.toMatch(/季節ごとの景色（[^）]*冬/);
    });

    it("「撮影に向く」のような価値判断の言い方はしない", () => {
        for (const s of ledger.filter(isPublished).slice(0, 300)) {
            expect(spotPageDescription(s, { samples: 1 }), s.slug).not.toMatch(/向く季節|おすすめの季節/);
        }
    });

    it("下書きは頭でそう名乗る", () => {
        expect(spotPageDescription({ ...base, status: "review" }, {}).startsWith("【下書き・運営未確認】")).toBe(true);
    });
});

describe("🔴 文章に「撮りどき」を使わない（2026-10-22 owner）", () => {
    it("title・description に出ない（季節・時間帯・光の表・作例がそろった行でも）", () => {
        for (const s of ledger.filter(isPublished).slice(0, 300)) {
            const facts = { samples: 5, cover: true, light: true, computed: "日の入りは6月が西北西寄り" };
            expect(spotPageTitle(s, facts), s.slug).not.toContain("撮りどき");
            expect(spotPageDescription(s, facts), s.slug).not.toContain("撮りどき");
        }
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
