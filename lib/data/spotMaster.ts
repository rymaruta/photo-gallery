// lib/data/spotMaster.ts
//
// **撮影スポットの台帳（人が書くぶんだけ）。**
//
// 設計は `docs/spot-master.md`。要点だけ:
//
//  - **スポットの実体は持たない。** モック10の9項目のうち7つは、いまある
//    写真から導出できる（代表画像・カテゴリ・写真数・近くのスポット…）。
//    導出できないのは **ふりがな**と**人が書いた概要**の2つだけなので、
//    その2つだけをここで持つ
//  - **鍵は `/location/<スラッグ>` のスラッグ。** 第二の ID（`spot#` や
//    `sp_…`）を作らない——作ると「行きたい場所」（`spots#<uid>` に入って
//    いるのはこのスラッグ）と検索の面が割れる
//  - **DynamoDB に置かない。** 静的書き出しなので、どこに置いても直せば
//    再ビルドが要る＝「すぐ反映される」にはならない。置き場所を増やすと
//    同期スクリプト・IAM・provision-env・診断・staging のテーブルまで
//    保守が増える
//
// ## `app/data/` ではなく `content/` に置く理由
//
// `app/data/*.json` は **`npm run build` のたびに
// `scripts/sync-photos-from-ddb.js` が DynamoDB から作り直す**
// （`prepare-static-build.js` が呼ぶ）。手で書いた行をあそこに置くと、
// **次のビルドで消える側の棚**に人の文章を置くことになる。
// `content/` は誰も書き換えない。

import raw from "@/content/spot-master.json";

export type SpotMasterEntry = {
    /**
     * `/location/<スラッグ>` の綴り（`slugify(_, "location")` を通した形）。
     * **ここが唯一の鍵。** 綴りがずれていれば、そのぶんは画面に出ない
     * ——`spotMaster.test.ts` が「正規化済みであること」を固定している。
     */
    slug: string;
    /** ふりがな（モック③）。写真からは導き出せない */
    reading?: string;
    /**
     * 概要（モック⑤）。**人が書いたものだけを出す。**
     * 生成しない（owner の指示。`lib/utils/spot.ts` の「無い情報を作らない境界」）。
     */
    summary?: string;
    /** 表記ゆれ・別名・旧称（いまは画面で使っていない。持つだけ） */
    aliases?: string[];
};

/**
 * スラッグ → 台帳の1件。
 *
 * **module の読み込み時に1回だけ組む。** 静的書き出しは撮影地ページを
 * 全部作るので、ページごとに配列を舐めると件数×ページ数になる。
 */
const BY_SLUG: ReadonlyMap<string, SpotMasterEntry> = (() => {
    const m = new Map<string, SpotMasterEntry>();
    for (const e of raw as SpotMasterEntry[]) {
        // **形の違う行は落とす**（`readUserList` と同じ構え）。
        // 人が書くファイルなので、空の鍵や重複は必ず起こりうる
        if (!e || typeof e.slug !== "string" || e.slug.length === 0) continue;
        // **先に書いた方を残す。** 後勝ちにすると、重複に気づかないまま
        // 「下に書き足したぶんだけが効く」という分かりにくい形になる
        if (!m.has(e.slug)) m.set(e.slug, e);
    }
    return m;
})();

/**
 * そのスポットについて**人が書いたもの**。無ければ `null`。
 *
 * @param slug **正規化済みの**スラッグ（`SpotPage` の `savedKey` と同じ値）。
 *   ここで正規化し直さない——正規化を2か所に置くと、片方だけ直したときに
 *   静かにずれる（このリポジトリが何度も踏んでいる形）。
 */
export function spotMasterFor(slug: string): SpotMasterEntry | null {
    return BY_SLUG.get(slug) ?? null;
}

/** 台帳の全件（テストと道具のため。**画面は使わない**） */
export const SPOT_MASTER: readonly SpotMasterEntry[] = raw as SpotMasterEntry[];
