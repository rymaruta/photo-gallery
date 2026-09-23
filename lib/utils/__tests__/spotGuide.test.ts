import { describe, it, expect } from "vitest";
import {
    SOURCED_FIELDS, sourcesFor, showsField, coverImageProblems,
    needsVisibleCredit, publishBlockers, publishableSpots, usesMapHero, SUMMARY_MIN,
} from "../spotGuide";
import type { Spot } from "@/lib/data/spots";

/**
 * **公式撮影地ガイドの「出してよいか」。**
 *
 * owner の指示書（2026-09-23）が機械で守れと言っている3つを見る:
 *   1. 未確認の情報を推測で埋めない（出典が無ければ出さない）
 *   2. 薄いページを索引へ大量に入れない（公開条件）
 *   3. 代表写真は権利が確認できているものだけ
 */

/** 公開条件を全部満たす1件（ここから1つずつ欠けさせて確かめる） */
function fullSpot(over: Partial<Spot> = {}): Spot {
    return {
        spotId: "sp_000000000001",
        slug: "example-spot",
        name: "例のスポット",
        summary: "あ".repeat(SUMMARY_MIN),
        region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
        coords: { lat: 34.1, lng: 133.6 },
        highlights: ["雲海が出る朝がある"],
        officialWebsiteUrl: "https://example.example/",
        status: "published",
        verifiedAt: "2026-09-23",
        createdAt: "2026-09-23T00:00:00.000Z",
        updatedAt: "2026-09-23T00:00:00.000Z",
        ...over,
    };
}

describe("出典が無ければ出さない", () => {
    it("出典が要るのは、間違うと実害が出る3つだけ", () => {
        expect([...SOURCED_FIELDS].sort()).toEqual(["access", "parking", "safetyNotes"]);
    });

    it("見どころ・構図は出典を求めない（事実ではなく運営の助言）", () => {
        const s = fullSpot({ highlights: ["朝もやが出る"], compositionTips: ["石段を前景に"] });
        expect(showsField(s, "highlights")).toBe(true);
        expect(showsField(s, "compositionTips")).toBe(true);
    });

    /// 🔴 **中身が書いてあっても、出典が無ければ出さない。**
    /// 「書いたのに出ない」は書いた人が気づくが、「出典の無い交通規制が出る」は
    /// 誰も気づかない。気づける側に倒す
    it("アクセスは、中身があっても出典が無ければ出さない", () => {
        const s = fullSpot({ access: { car: "国道から15分" } });
        expect(showsField(s, "access")).toBe(false);
    });

    it("出典を足すと出る", () => {
        const s = fullSpot({
            access: { car: "国道から15分" },
            sources: [{ field: "access", url: "https://example.example/access", checkedAt: "2026-09-23" }],
        });
        expect(showsField(s, "access")).toBe(true);
        expect(sourcesFor(s, "access")).toHaveLength(1);
    });

    it("別の項目の出典では効かない", () => {
        const s = fullSpot({
            parking: { available: true },
            sources: [{ field: "access", url: "https://example.example/", checkedAt: "2026-09-23" }],
        });
        expect(showsField(s, "parking"), "access の出典が parking を通している").toBe(false);
    });

    it("url か確認日が空の出典は数えない", () => {
        const s = fullSpot({
            safetyNotes: ["立入禁止の区域がある"],
            sources: [
                { field: "safetyNotes", url: "", checkedAt: "2026-09-23" },
                { field: "safetyNotes", url: "https://example.example/", checkedAt: "" },
            ],
        });
        expect(showsField(s, "safetyNotes")).toBe(false);
    });
});

describe("代表写真は権利が確認できているものだけ", () => {
    const img = {
        src: "/spots/example.jpg", alt: "例", credit: "丸田 竜平",
        license: "owner" as const, checkedAt: "2026-09-23", verifiedPlace: true,
    };

    it("揃っていれば問題なし", () => {
        expect(coverImageProblems(fullSpot({ coverImage: img }))).toEqual([]);
    });

    it.each(["src", "alt", "credit", "checkedAt"])("%s が空なら止める", (key) => {
        const broken = { ...img, [key]: "" };
        expect(coverImageProblems(fullSpot({ coverImage: broken }))).toContain(key);
    });

    /// 🔴 **「写真がある」と「そこで撮った」は別。**
    /// 被写体と撮影位置は違いうる（高屋神社は麓からも撮れる）
    it("その場所の写真だと確かめていなければ止める", () => {
        expect(coverImageProblems(fullSpot({ coverImage: { ...img, verifiedPlace: false } })))
            .toContain("verifiedPlace");
    });

    it("代表写真が無いのは「問題」ではない（無いなら地図を主役にする）", () => {
        expect(coverImageProblems(fullSpot())).toEqual([]);
        expect(usesMapHero(fullSpot())).toBe(true);
        expect(usesMapHero(fullSpot({ coverImage: img })).valueOf()).toBe(false);
    });

    it("owner 以外はクレジットを画面に出す", () => {
        expect(needsVisibleCredit(fullSpot({ coverImage: img }))).toBe(false);
        expect(needsVisibleCredit(fullSpot({
            coverImage: { ...img, license: "cc-by", credit: "撮影者名" },
        }))).toBe(true);
    });

    it("owner でも、条件つきのクレジット文があれば出す", () => {
        expect(needsVisibleCredit(fullSpot({
            coverImage: { ...img, requiredCreditText: "© 例" },
        }))).toBe(true);
    });
});

describe("正式公開の条件（薄いページを索引へ入れない）", () => {
    it("全部そろっていれば公開してよい", () => {
        expect(publishBlockers(fullSpot())).toEqual([]);
    });

    /// 🔴 **写真の枚数は条件に入れない**——投稿0枚でも公開できるのが今回の肝
    it("ユーザー投稿の枚数は条件に入っていない", () => {
        const blockers = publishBlockers(fullSpot());
        expect(blockers).toEqual([]);
        // 台帳には写真の枚数を持たせていない（数えようがない＝条件にできない）
        expect(Object.keys(fullSpot())).not.toContain("photoCount");
    });

    /**
     * 🔴 **URL の綴りが無ければ公開しない。**
     *
     * 無いとページが作られないのに画面には出るので、「行きたい」の鍵が
     * `SPOT-`（スラッグが空）で保存され、**外す手段が無くなる**
     * （レビューが指摘した経路）。`generateStaticParams` も空を返す。
     */
    it("URL の綴りが無ければ公開しない", () => {
        expect(publishBlockers(fullSpot({ slug: "" })).some((m) => m.includes("綴り"))).toBe(true);
        expect(publishBlockers(fullSpot({ slug: "   " })).some((m) => m.includes("綴り"))).toBe(true);
        expect(publishableSpots([fullSpot({ slug: "" })])).toEqual([]);
    });

    it("下書きは公開しない", () => {
        expect(publishBlockers(fullSpot({ status: "draft" }))).toContain("status が published でない");
    });

    it("座標が無ければ公開しない（地図に出せない＝名前だけのページ）", () => {
        expect(publishBlockers(fullSpot({ coords: undefined }))
            .some((m) => m.includes("座標"))).toBe(true);
    });

    it("紹介文が短ければ公開しない", () => {
        expect(publishBlockers(fullSpot({ summary: "短い" }))
            .some((m) => m.includes("紹介文"))).toBe(true);
    });

    it("見どころも概要も無ければ公開しない（観光情報ではなく撮影地ガイドなので）", () => {
        expect(publishBlockers(fullSpot({ highlights: [], description: undefined }))
            .some((m) => m.includes("見どころ"))).toBe(true);
    });

    it("概要だけでも見どころの条件は満たす", () => {
        expect(publishBlockers(fullSpot({ highlights: [], description: "長めの概要" }))).toEqual([]);
    });

    it("確認日が無ければ公開しない", () => {
        expect(publishBlockers(fullSpot({ verifiedAt: undefined, verified: undefined }))
            .some((m) => m.includes("確認日"))).toBe(true);
    });

    /// アクセスは**出典が無ければ「無い」と同じ**なので、公式サイトが要る
    it("出典の無いアクセスだけでは公開しない", () => {
        const s = fullSpot({ access: { car: "国道から15分" }, officialWebsiteUrl: undefined });
        expect(publishBlockers(s).some((m) => m.includes("アクセスも公式サイトも無い"))).toBe(true);
    });

    it("出典つきのアクセスがあれば、公式サイトが無くてもよい", () => {
        const s = fullSpot({
            access: { transit: "駅からバス20分" },
            officialWebsiteUrl: undefined,
            sources: [{ field: "access", url: "https://example.example/", checkedAt: "2026-09-23" }],
        });
        expect(publishBlockers(s)).toEqual([]);
    });

    it("権利の欠けた代表写真があると公開しない", () => {
        const s = fullSpot({
            coverImage: {
                src: "/spots/x.jpg", alt: "x", credit: "", license: "cc-by",
                checkedAt: "", verifiedPlace: true,
            },
        });
        expect(publishBlockers(s).some((m) => m.includes("代表写真"))).toBe(true);
    });

    it("足りないものは一覧で返す（真偽1つにしない＝書く人が直せる）", () => {
        const s = fullSpot({ status: "draft", coords: undefined, summary: "短い" });
        expect(publishBlockers(s).length).toBeGreaterThanOrEqual(3);
    });

    it("publishableSpots は条件を満たすものだけ返す", () => {
        const ok = fullSpot();
        const ng = fullSpot({ spotId: "sp_000000000002", slug: "ng", status: "draft" });
        expect(publishableSpots([ok, ng]).map((s) => s.slug)).toEqual(["example-spot"]);
    });
});
