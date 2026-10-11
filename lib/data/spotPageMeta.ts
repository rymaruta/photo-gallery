// lib/data/spotPageMeta.ts
//
// **撮影地ページ（`/spots/<slug>`）と地域のページの title・description。**（2026-10-11）
//
// owner の方針（2026-10-11）「検索で見つけてもらう」「写真が無くても役立つ撮影ガイド」。
// 検索で引かれる語（「〇〇 撮影スポット」「〇〇 撮影 時間」「〇〇 季節」）を title に入れ、
// description は紹介文（`summary`）に**ページに実際に在るもの**の要約を足す。
//
// 🔴 **書くのは事実だけ。** 載っていないもの（アクセス・駐車場は出典つきで数件しか無い）や、
// していない確認（「運営が調べた」——人が確かめたのは数件で、多くは AI 照合）を宣伝文に書かない。
//
// 2026-10-11 判断: 別の担当（`claude/spot-computed-guide`）が計算の撮影情報の要約を返す関数を作る。
// ここは `computed`（その要約の文）を受け取れる口だけ用意し、今は既存の事実だけで組み立てる。
// `spotSeo.ts`・`SpotGuidePage.tsx` と衝突しないよう、別のファイルに置いた。

import type { Spot } from "./spots";
import { isPublished, isVerified } from "../utils/spotGuide";

/** 地名の部分（日本は「県 市」、海外は「国 都市」——海外の州名より国名の方が検索に効く） */
export function spotWhere(spot: Pick<Spot, "region">): string {
    const r = spot.region;
    if (!r) return "";
    const overseas = r.country && r.country !== "日本";
    return (overseas ? [r.country, r.city] : [r.prefecture, r.city]).filter(Boolean).join(" ");
}

/** title の後ろに付けるサイトの名前（サイト全体の template より短い形・`title.absolute` で使う） */
export const SPOT_TITLE_BRAND = " | Journey Photo";

/** title の長さの上限（全角で数える。半角は 0.5）。検索結果の題に収まる 35 字前後 */
export const SPOT_TITLE_MAX = 35;

/** 全角換算の長さ（半角の英数・記号は 0.5） */
export function titleWidth(s: string): number {
    return [...s].reduce((n, ch) => n + (/[\u0020-\u007e]/.test(ch) ? 0.5 : 1), 0);
}

/**
 * 撮影地ページの title（**サイトの template を外した完全な形**・`title: { absolute }` に渡す）。
 * 2026-10-11 レビュー: 長すぎた（template 込みで 60 字超）ので短くした。長ければ後ろから削る:
 *   1. 〇〇の撮影スポット・撮影ガイド（県 市） | Journey Photo
 *   2. 〇〇の撮影スポット・撮影ガイド | Journey Photo
 *   3. 〇〇の撮影ガイド | Journey Photo
 *   4. 〇〇の撮影ガイド
 * 「時間帯・季節」は入れない（光の表が無いページもあり、全部のページで言えることではない）
 */
export function spotPageTitle(spot: Pick<Spot, "name" | "region">): string {
    const where = spotWhere(spot);
    const candidates = [
        ...(where ? [`${spot.name}の撮影スポット・撮影ガイド（${where}）${SPOT_TITLE_BRAND}`] : []),
        `${spot.name}の撮影スポット・撮影ガイド${SPOT_TITLE_BRAND}`,
        `${spot.name}の撮影ガイド${SPOT_TITLE_BRAND}`,
    ];
    return candidates.find((t) => titleWidth(t) <= SPOT_TITLE_MAX) ?? `${spot.name}の撮影ガイド`;
}

/** ページに在るもの（description の要約の材料）。**数えたものだけ**を渡す */
export type SpotPageFacts = {
    /** 月ごとの撮影の光の表がある（`lightCalendar` が値を返した） */
    light?: boolean;
    /** 作例の枚数（画面に出すもの・代表写真を除く）。代表写真と合わせて「作例・代表写真N枚」と書く */
    samples?: number;
    /** 代表写真がある */
    cover?: boolean;
    /**
     * 計算の撮影情報の要約（`claude/spot-computed-guide` の関数が返す1文）。あれば紹介文のすぐ後に入れる。
     * 今は誰も渡さない
     */
    computed?: string;
};

/**
 * 撮影地ページの description。紹介文（無ければ決まり文句）＋ページに在るものの要約。
 * 下書きは頭に「【下書き・運営未確認】」（共有のプレビューで確認済みに見せない）
 */
export function spotPageDescription(
    spot: Pick<Spot, "name" | "summary" | "seasonalGuide" | "timeOfDayGuide"> & Partial<Spot>,
    facts: SpotPageFacts = {},
): string {
    const head = (isPublished(spot as Spot) ? "" : "【下書き・運営未確認】")
        + (spot.summary?.trim() || `${spot.name}で写真を撮るための情報。`);
    const parts: string[] = [];
    if (facts.light) parts.push("撮影の光（月ごとの日の出・日の入り・ゴールデンアワー）");
    if (spot.seasonalGuide?.length) parts.push("季節の撮りどき");
    if (spot.timeOfDayGuide?.length) parts.push("時間帯ごとの撮り方");
    const photos = (facts.samples ?? 0) + (facts.cover ? 1 : 0);
    if (photos > 0) parts.push(`作例・代表写真${photos}枚`);
    const computed = facts.computed?.trim();
    return [
        head,
        computed ? (/[。.!?！？]$/.test(computed) ? computed : `${computed}。`) : "",
        parts.length ? `${parts.join("・")}を掲載。` : "",
    ].join("");
}

/**
 * 「内容をどう確かめたか」の1文（地域・索引のページの説明）。**実際の確認の仕方に合わせる**:
 *   - 公開の行が全部人の確認（`isVerified`）なら「運営が確かめています」
 *   - AI 照合の行が混ざれば「出典（Wikipedia など）と照らして確かめています（AI による照合を含む）」
 *   - 公開の行が無ければ空
 */
export function spotCheckedClaim(spots: readonly Spot[]): string {
    const published = spots.filter(isPublished);
    if (published.length === 0) return "";
    return published.every(isVerified)
        ? "内容は運営が確かめています。"
        : "内容は出典（Wikipedia など）と照らして確かめています（AI による照合を含む）。";
}
