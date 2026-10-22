// lib/data/spotPageMeta.ts
//
// **撮影地ページ（`/spots/<slug>`）と地域のページの title・description。**（2026-10-11）
//
// owner の方針（2026-10-11）「検索で見つけてもらう」「写真が無くても役立つ撮影ガイド」。
// 2026-10-22: GSC で実際に検索されている型（「〈名所〉 写真」「〈名所〉 撮影」「〈名所〉 撮影地」）に合わせ、
// title は名前＋「の写真・撮影スポット」＋押す理由（作例の節の枚数）、description は押す理由を頭に、
// 紹介文（`summary`・Wikipedia 由来）を後ろに置く。
//
// 🔴 **書くのは事実だけ。** 載っていないもの（アクセス・駐車場は出典つきで数件しか無い）や、
// していない確認（「運営が調べた」——人が確かめたのは数件で、多くは AI 照合）を宣伝文に書かない。
//
// 2026-10-11 判断: 別の担当（`claude/spot-computed-guide`）が計算の撮影情報の要約を返す関数を作る。
// ここは `computed`（その要約の文）を受け取れる口だけ用意し、今は既存の事実だけで組み立てる。
// `spotSeo.ts`・`SpotGuidePage.tsx` と衝突しないよう、別のファイルに置いた。

import type { Spot } from "./spots";
import { isPublished, isVerified } from "../utils/spotGuide";
import { SEASON_JA } from "./spotTopics";

/** 地名の部分（日本は「県 市」、海外は「国 都市」——海外の州名より国名の方が検索に効く） */
export function spotWhere(spot: Pick<Spot, "region">): string {
    const r = spot.region;
    if (!r) return "";
    const overseas = r.country && r.country !== "日本";
    return (overseas ? [r.country, r.city] : [r.prefecture, r.city]).filter(Boolean).join(" ");
}

/**
 * title の長さの上限（全角で数える。半角は 0.5）。
 * 2026-10-22 判断: 検索の題に収まる **全角 30 前後**（33 まで）。サイト名（「 | Journey Photo」）は付けない
 * ——検索結果はサイト名を別の行に出すので、限られた字数を検索される語と「押す理由」に使う
 */
export const SPOT_TITLE_MAX = 33;

/** 全角換算の長さ（半角の英数・記号は 0.5） */
export function titleWidth(s: string): number {
    return [...s].reduce((n, ch) => n + (/[\u0020-\u007e]/.test(ch) ? 0.5 : 1), 0);
}

/** ページに在るもの（title・description の材料）。**数えたものだけ**を渡す */
export type SpotPageFacts = {
    /** 月ごとの撮影の光の表がある（`lightCalendar` が値を返した） */
    light?: boolean;
    /** 作例の枚数（**作例の節に並ぶ枚数**・代表写真と同じ写真は除いたもの）。「作例N枚」はこの数だけ */
    samples?: number;
    /** 代表写真がある（作例の数には入れない。「写真」と名乗れるかの判断にだけ使う） */
    cover?: boolean;
    /**
     * 計算の撮影情報の要約（日の入りの方角・天の川の月）。撮影地ページが `spotSkyDescription(spot)` を渡す
     */
    computed?: string;
};

/** 作例の節に並ぶ枚数（2026-10-22 レビュー: 代表写真を足すと節の枚数と食い違った） */
export function spotSampleCount(facts: SpotPageFacts): number {
    return Math.max(0, facts.samples ?? 0);
}

/** ページに写真が1枚でもあるか（作例か代表写真）。無ければ title・description で「写真」と名乗らない */
export function spotHasPhotos(facts: SpotPageFacts): boolean {
    return spotSampleCount(facts) > 0 || Boolean(facts.cover);
}

/**
 * 撮影地ページの title（**サイトの template を外した完全な形**・`title: { absolute }` に渡す）。
 *
 * 2026-10-22 判断（GSC で実際に検索されている型に合わせた）: 「〈名所〉 写真」「〈名所〉 撮影」
 * 「〈名所〉 撮影地」。名前のすぐ後に「の写真・撮影スポット」、押す理由（作例の実数）を「｜」の後ろに置く。
 *
 * **短くする規則**（全角 33 を超えたら上から順に試す。検索される語「の写真」は最後まで落とさない）:
 *   1. 〇〇の写真・撮影スポット｜作例6枚（県 市）
 *   2. 〇〇の写真・撮影スポット｜作例6枚        … 地域を落とす
 *   3. 〇〇の写真・撮影スポット（県 市）         … 作例を落とし地域を戻す
 *   4. 〇〇の写真・撮影スポット
 *   5. 〇〇の写真                               … 名前そのものが長いとき（33 を超えてもこれ）
 * 写真が1枚も無いスポットは「写真」と名乗らない: 〇〇の撮影スポット（県 市）→ 〇〇の撮影スポット
 * 🔴 作例が0枚なら「作例」を書かない（無いものを title で約束しない）。
 * 🔴 「撮りどき」は使わない（2026-10-22 owner: 検索語としてはよいが、ページの文章に出ると腹が立つ）
 */
export function spotPageTitle(
    spot: Pick<Spot, "name" | "region">,
    facts: SpotPageFacts = {},
): string {
    const where = spotWhere(spot);
    const n = spotSampleCount(facts);
    const fit = (cands: string[], last: string) => cands.find((t) => titleWidth(t) <= SPOT_TITLE_MAX) ?? last;
    if (!spotHasPhotos(facts)) {
        const head = `${spot.name}の撮影スポット`;
        return fit([...(where ? [`${head}（${where}）`] : []), head], head);
    }
    const pitch = n > 0 ? `作例${n}枚` : "";
    const head = `${spot.name}の写真・撮影スポット`;
    return fit([
        ...(pitch && where ? [`${head}｜${pitch}（${where}）`] : []),
        ...(pitch ? [`${head}｜${pitch}`] : []),
        ...(where ? [`${head}（${where}）`] : []),
        head,
    ], `${spot.name}の写真`);
}

const SEASON_ORDER = ["spring", "summer", "autumn", "winter"] as const;

/**
 * 季節の案内が**閉鎖・運休・見学できない**ことを言っているか（2026-10-22 レビュー）。
 * そういう季節を「季節ごとの景色」に並べると、行けない季節を勧めることになる
 */
export function isClosureSeasonText(text: string): boolean {
    return /閉鎖|運休|休館|閉館|閉園|見学できない|見学できません|見学不可|通行止め|入れません|入場できません|立入禁止|立ち入り禁止/.test(text);
}

/**
 * 撮影地ページの description。**頭に押す理由**（作例の数・季節ごとの景色・日の入りの方角・天の川）を置き、
 * Wikipedia 由来の紹介文（`summary`）は後ろへ回す（2026-10-22 判断: 検索結果に出る頭の 80〜120 字で
 * 「この場所の写真が見られる・季節や光の案内がある」を伝える）。
 * 季節は価値判断を含まない「季節ごとの景色」と言い、閉鎖・運休を書いた季節は並べない。
 * 写真が1枚も無いスポットは「写真」と名乗らない。
 * 下書きは頭に「【下書き・運営未確認】」（共有のプレビューで確認済みに見せない）
 */
export function spotPageDescription(
    spot: Pick<Spot, "name" | "summary" | "seasonalGuide" | "timeOfDayGuide"> & Partial<Spot>,
    facts: SpotPageFacts = {},
): string {
    const draft = isPublished(spot as Spot) ? "" : "【下書き・運営未確認】";
    const lead = spotHasPhotos(facts) ? `${spot.name}の写真・撮影地ガイド。` : `${spot.name}の撮影地ガイド。`;
    const parts: string[] = [];
    const n = spotSampleCount(facts);
    if (n > 0) parts.push(`作例${n}枚`);
    const seasons = SEASON_ORDER.filter((k) =>
        spot.seasonalGuide?.some((g) => g.season === k && !isClosureSeasonText(g.text ?? "")));
    if (seasons.length) parts.push(`季節ごとの景色（${seasons.map((k) => SEASON_JA[k]).join("・")}）`);
    if (spot.timeOfDayGuide?.length) parts.push("時間帯ごとの撮り方");
    if (facts.light) parts.push("月ごとの日の出・日の入り・ゴールデンアワー");
    const computed = facts.computed?.trim();
    const summary = spot.summary?.trim();
    return [
        draft,
        lead,
        parts.length ? `${parts.join("、")}。` : "",
        computed ? (/[。.!?！？]$/.test(computed) ? computed : `${computed}。`) : "",
        summary ? (/[。.!?！？]$/.test(summary) ? summary : `${summary}。`) : "",
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
