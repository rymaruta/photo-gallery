/**
 * 題が無い写真の扱い。
 *
 * owner:「中には、タイトルとか入れずに気軽に投稿する人もいるみたい。
 * タイトルに無題と入ってしまう。一覧を見たときに無題ではなくて、
 * タイトルなくてもいいよ」
 *
 * **「無題」は表示の落とし先ではなく、サーバーが実際に保存していた文字列**
 * だった（`api-user/src/upload.ts` が `sanitizeTitle(title) ?? { ja: "無題" }`）。
 * 保存をやめても**既に上がっている写真には残る**ので、出す側でも落とす。
 *
 * **利用者が自分で「無題」と名付けた回も落ちる。** それは承知のうえ
 * ——その人が言いたいことは「題は無い」なので、結果は同じになる。
 */
const SERVER_PLACEHOLDERS: ReadonlySet<string> = new Set(["無題", "Untitled"]);

/** 題として出してよい文字列。無ければ空（呼ぶ側が「出さない」を決める） */
export function displayTitle(title: string | undefined): string {
    const t = (title ?? "").trim();
    return SERVER_PLACEHOLDERS.has(t) ? "" : t;
}

/**
 * 写真が名乗る題の材料（`Photo` のほか、`InspiredLink` のような縮めた形も受ける）。
 * **型だけ**を見る——このファイルは一覧・写真ページ・RSS・地図の札のどれからも読まれる。
 */
export type TitleSource = {
    title?: string | { ja?: string; en?: string } | null;
    location?: unknown;
};

const asText = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * 写真自身の題（このページの言語 → もう一方の言語）。「無題」と空白だけは落とす。
 * 無ければ空——**一覧や見える見出しは、空なら題を出さない**（owner:「タイトルなくてもいいよ」）。
 *
 * 言語ごとに `displayTitle` を通す——`{ ja: "無題", en: "Sunset" }` のような行で
 * 「無題」に引っかかって英語の題を捨てない。
 */
export function photoOwnTitle(photo: TitleSource | null | undefined, locale: "ja" | "en"): string {
    const t = photo?.title;
    if (!t) return "";
    if (typeof t === "string") return displayTitle(t);
    const other = locale === "en" ? "ja" : "en";
    return displayTitle(asText(t[locale])) || displayTitle(asText(t[other]));
}

/**
 * 題が無い写真の代わりの題。「<撮影地>の写真」、撮影地も無ければ「写真」
 * （英語は `Photo taken in <place>` / `Photo`）。
 *
 * 写真ページの読み上げ用の見出し（2026-10-17）と同じ言い方。
 */
export function fallbackPhotoTitle(location: unknown, locale: "ja" | "en"): string {
    const place = asText(location).trim();
    if (locale === "en") return place ? `Photo taken in ${place}` : "Photo";
    return place ? `${place}の写真` : "写真";
}

/**
 * **検索結果・SNS・RSS・構造化データ・共有に出す題**（必ず空でない）。
 *
 * 題があればその題。無ければ（「無題」を含む）撮影地から組む。
 * `fromTitle` が偽のときは、題そのものが撮影地から作られている——
 * 呼ぶ側で「｜<撮影地>」を足すと「板橋区の写真｜板橋区」と二重になるので足さない。
 *
 * owner（2026-10-17）:「撮影地を使って『板橋区の写真』のように出す。
 * 画面の見た目は変えない。検索結果と SNS に出る題だけ良くする」
 */
export function photoTitleFor(photo: TitleSource | null | undefined, locale: "ja" | "en"): { text: string; fromTitle: boolean } {
    const own = photoOwnTitle(photo, locale);
    if (own) return { text: own, fromTitle: true };
    return { text: fallbackPhotoTitle(photo?.location, locale), fromTitle: false };
}
