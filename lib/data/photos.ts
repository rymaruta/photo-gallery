// app/data/photos.ts
// （変更済み）BASE_PHOTOS の mapLinks.google を指定のショートリンクに置き換え、
// "オペラ座" を "オペラ・ガルニエ" に更新した版を以下に示します。
// そのまま既存ファイルを差し替えてください。

export type Locale = "ja" | "en";

export type LocalizedText = {
    ja?: string;
    en?: string;
};

// 段落配列で保持する型
export type LocalizedParagraphs = {
    ja?: string[];
    en?: string[];
};

/** 2枚目以降の1枚。`api-user/src/photoImages.ts` の `PhotoImage` と対 */
export type PhotoImage = {
    src: string;
    srcAvif?: string;
    thumbSrc?: string;
    thumbAvif?: string;
    thumbSm?: string;
    thumbSmAvif?: string;
    width?: number;
    height?: number;
    dominantColor?: string;
    blurDataURL?: string;
};

export type Photo = {
    id: string;
    src: string;
    thumbSrc?: string; // 一覧グリッド用の軽量サムネイル（512px WebP）。ない写真は src を使う
    slug?: string;
    title?: string | LocalizedText;
    alt?: string | LocalizedText;
    // description は文字列か段落配列を受け取れるようにする
    description?: string | LocalizedParagraphs;
    category?: string;
    tags?: string[];
    photographer?: string;
    location?: string;
    coords?: { lat: number; lng: number };
    // coords が location 名からのジオコーディング（おおよその位置）であることを示す
    geoApprox?: boolean;
    // 写真BGM（オーナーが1曲添えられる。30秒プレビュー）
    song?: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string };
    // 写真のフル再生MV（YouTube リンク）。30秒プレビューとは別枠で共存
    songYoutubeUrl?: string;
    mapLinks?: { google?: string; osm?: string; label?: string };
    license?: string;
    copyrightOwner?: string;
    copyrightYear?: string;
    date?: string;
    width?: number;
    height?: number;
    aspectRatio?: number;
    dominantColor?: string;
    // 極小のぼかしプレビュー（data:image/webp;base64,...）。読み込み中の blur-up 表示に使う
    blurDataURL?: string;
    // レスポンシブ/AVIF 派生（バックフィル生成）。無ければ thumbSrc/src にフォールバック
    thumbAvif?: string;   // 512 AVIF
    thumbSm?: string;     // 256 WebP
    thumbSmAvif?: string; // 256 AVIF
    srcAvif?: string;     // 詳細用（≤1600）AVIF
    /**
     * 2枚目以降（1投稿に複数枚。**表紙は `src` のまま**）。
     *
     * 表紙を `src` に残すことで、og:image・サムネ・地図・サイトマップ・
     * JSON-LD の入口を1つも書き換えずに済む。検証と保存は
     * `api-user/src/photoImages.ts`（画面側は受け取るだけ）
     */
    extraImages?: PhotoImage[];
    focalPoint?: { x: number; y: number };
    published?: boolean;
    /**
     * **運営が選んだ「おすすめ」。** トップに出す。
     *
     * **自分の編集画面（`/user/edit`）からは触れない。** 利用者が自分の写真を
     * トップへ出せると「おすすめ」の意味が消えるので、**管理APIだけ**が書く。
     * いまは投稿者がほぼ owner 1人なので差が出ないが、そこを混ぜると
     * 後から分けられない。
     */
    featured?: boolean;
    userId?: string;
    displayName?: string;
    createdAt?: string;
    updatedAt?: string;
    exif?: {
        camera?: string;
        lens?: string;
        aperture?: string;
        exposure?: string;
        iso?: number;
        focalLength?: string;
        whiteBalance?: string;
        imageSize?: string;
        fileFormat?: string;
        dateTimeOriginal?: string;
    };
    translationStatus?: { ja?: boolean; en?: boolean };
    relatedIds?: string[];
    likes?: number;
    commentCount?: number;// コメント数
    views?: number;
    sourceUrl?: string;
    sensitive?: boolean;
    uploadedBy?: string;
    uploaderUsername?: string;
    uploaderDisplayName?: string;
};

/**
 * getLocalized: 文字列またはローカライズオブジェクトから文字列を返すユーティリティ
 */
export function getLocalized(v: string | LocalizedText | undefined, locale: Locale): string {
    if (!v) return "";
    if (typeof v === "string") return v;
    // 空文字でも次の言語に落とす。?? は null/undefined でしか落ちないので、
    // { en: "", ja: "..." } のようなデータで英語ページが空になっていた。
    return (v[locale] || v.ja || v.en || "") as string;
}

/**
 * 改行は段落の区切り。**エントリの中に入っていても割る。**
 *
 * 説明を保存する経路は3つあるが、改行を段落に割っているのは
 * `/admin/edit` だけだった:
 *
 *     /admin/edit   descJa.split("\n") → { ja: [...] }        割る
 *     /user/edit    英語があれば割る / 無ければ**素の文字列**   半分
 *     /user/upload  `description: item.description`（文字列）   割らない
 *
 * 割られなかった改行は1エントリの中に残り、読む側が `<p>` を1つしか
 * 出さないので**画面から消える**（HTML は素の改行を空白に潰す）。
 * 実データ30枚のうち **4枚**がこの形で、打った改行が出ていなかった。
 *
 * **入口ではなく読む側で揃える。** 入口は3つあって片方だけ直すと
 * また割れる（台帳がいちばん多く記録している型）うえ、**既に保存済みの
 * 4枚は入口を直しても直らない**。
 *
 * `\r\n` は `trim()` が末尾の `\r` を落とすので一緒に扱える。
 */
function splitParagraphs(lines: string[]): string[] {
    return lines.flatMap((p) => p.split("\n")).map((p) => p.trim()).filter(Boolean);
}

/**
 * getLocalizedParagraphs: description が段落配列か文字列かを吸収して常に string[] を返す
 */
export function getLocalizedParagraphs(v: string | LocalizedParagraphs | undefined, locale: Locale): string[] {
    if (!v) return [];
    if (typeof v === "string") return splitParagraphs([v]);
    // 空配列でも次の言語に落とす。?? だと止まるため、
    // { en: [], ja: ["..."] } のような写真の英語ページ・英語キャプションが
    // 空になっていた（実データに2件ある）。
    const pick = (x?: string[]) => (Array.isArray(x) && x.length > 0 ? x : undefined);
    const arr = pick(v[locale]) ?? pick(v.ja) ?? pick(v.en);
    return arr ? splitParagraphs(arr) : [];
}

/**
 * Helper: coords から map リンクを生成（エンコード済み）
 */
const encode = (v: number) => encodeURIComponent(v.toString());
export const makeGoogleSearch = (lat: number, lng: number) =>
    `https://www.google.com/maps/search/?api=1&query=${encode(lat)},${encode(lng)}`;
export const makeOSM = (lat: number, lng: number, zoom = 15) =>
    `https://www.openstreetmap.org/?mlat=${encode(lat)}&mlon=${encode(lng)}#map=${zoom}/${encode(lat)}/${encode(lng)}`;

/**
 * generateMapLinksFromCoords:
 * - p.mapLinks があればそれをベースにし、欠けている provider を coords から補完する
 * - coords がなければ補完は行わない（既存の mapLinks があればそれを返す）
 */
export function generateMapLinksFromCoords(p: Photo): Photo["mapLinks"] | undefined {
    const base = p.mapLinks ? { ...p.mapLinks } : {};

    // **地名から引いたおおよその座標（`geoApprox`）からはリンクを作らない。**
    // 街の中心へ飛ぶピンは「ここで撮った」と読まれる。明示の `mapLinks` は
    // 人が付けたものなのでそのまま通す
    if (!p.coords || p.geoApprox) {
        return Object.keys(base).length > 0 ? base : undefined;
    }

    const { lat, lng } = p.coords;

    if (!base.google) {
        base.google = makeGoogleSearch(lat, lng);
    }

    if (!base.osm) {
        base.osm = makeOSM(lat, lng);
    }

    return base;
}

/**
 * getPreferredMapLink: mapLinks の優先取得ロジック（UI 側で使用）
 */
export function getPreferredMapLink(p: Photo): { href: string; provider: "google" | "osm" } | undefined {
    const links = generateMapLinksFromCoords(p) ?? p.mapLinks ?? undefined;

    if (!links) return undefined;
    if (links.google) return { href: links.google, provider: "google" };
    if (links.osm) return { href: links.osm, provider: "osm" };
    return undefined;
}

/**
 * BASE_PHOTOS: 編集者はこの配列の location と coords（ある場合）や mapLinks を編集
 * sample1〜sample7 のテンプレ例（撮影者名を「丸田　竜平」に統一、description は仮テキスト）
 */
export const BASE_PHOTOS: Photo[] = [
];
export default BASE_PHOTOS;

