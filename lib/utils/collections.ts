// lib/utils/collections.ts
// タグ / 場所 / カテゴリの集約（ランディング）ページ用の純関数ユーティリティ。
// fs や JSX を持たないため、サーバー・クライアント・テストのどこからでも読める。

import type { Photo } from "../data/photos";
import { sortByNewest } from "./photoOrder";
import { sameLocation } from "./related";
import { stripLoneSurrogates } from "./text";

export type CollectionType = "tag" | "location" | "category";

/**
 * カテゴリの日本語表記を英語キーへ寄せる表。
 * 「風景」と「landscape」が別ページになると、同じ内容が2つのURLに分かれて
 * どちらも弱くなるため、集約ページを作る段階で1つにまとめる。
 * 表記ゆれ（建物→建築）もここで吸収する。
 */
export const CATEGORY_ALIASES: Record<string, string> = {
    "風景": "landscape",
    "自然": "nature",
    "建築": "architecture",
    "建物": "architecture",
    "街": "street",
    "写真": "photography",
    "イラスト": "illustration",
    "デザイン": "design",
};

/**
 * スラッグの長さ（バイト）の上限。
 *
 * **スラッグはファイル名になる。** 静的書き出しは `/location/<slug>` に対して
 * `out/location/<slug>.html` と `.next/server/app/location/<slug>.segments` を
 * 掘る。Linux のファイル名上限は **255 バイト**で、`.segments` の9バイトを
 * 引くと 246 バイトしか使えない。撮影地の上限は 200 **文字**なので、
 * 日本語（1文字3バイト）なら **83文字で超える**。
 *
 * 超えると `ENAMETOOLONG` で `next build` が落ちる——**誰か1人が保存した
 * 瞬間から、新しい写真も削除の反映も一切出せなくなる**（消えたページを
 * S3 から消す site-rebuild も同じビルドを通る）。下の `.` / `..` と同じ型で、
 * 実際に 83文字で落ち 82文字で通ることを確かめた。
 *
 * 余裕をみて 200 バイトで切る。切った結果が別の撮影地とぶつかることは
 * ありうるが、**ページが1つに混ざる**のと**サイト全体が出せない**のとでは
 * 後者の方がはるかに悪い。表示に使う値（`location` そのもの）は切らない。
 */
const MAX_SLUG_BYTES = 200;

/** UTF-8 のバイト数（`Buffer` も `TextEncoder` も使わない。この関数は画面からも読む） */
function utf8Len(codePoint: number): number {
    if (codePoint < 0x80) return 1;
    if (codePoint < 0x800) return 2;
    if (codePoint < 0x10000) return 3;
    return 4;
}

/** バイト数で切る。**文字の途中では切らない**（孤立サロゲートを作らない） */
function clampSlugBytes(s: string): string {
    let bytes = 0;
    for (const ch of s) bytes += utf8Len(ch.codePointAt(0)!);
    if (bytes <= MAX_SLUG_BYTES) return s;
    let out = "";
    bytes = 0;
    for (const ch of s) {
        const b = utf8Len(ch.codePointAt(0)!);
        if (bytes + b > MAX_SLUG_BYTES) break;
        out += ch;
        bytes += b;
    }
    // 切った先が区切りだと `旅行-` のような尻尾が残る
    return out.replace(/-+$/, "");
}

/** 値を URL スラッグへ正規化（小文字化・trim・空白をハイフンに）。日本語はそのまま（URLでは percent-encoded）。 */
export function slugify(value: string, type?: CollectionType): string {
    const base = (value ?? "").toString().trim().toLowerCase()
        .replace(/\s+/g, "-")
        // **URL のパスに置けない文字を落とす。** タグ・撮影地・カテゴリは
        // 自由入力で、そのまま `/tag/<値>` のパス片になる。写真サイトでは
        // `F/2.8`・`24/70mm`・`白/黒`・`東京 / 渋谷`・`#旅` はごく普通の入力。
        //
        //  - `/` `\` … 静的書き出しはファイル名を `旅行%2F2024.html` と
        //    パーセントエンコードして保存するが、参照側（collectionPath）は
        //    1回だけエンコードするので `/tag/…%2F2024` になる。S3 は
        //    リクエストパスを1回デコードしてキーにするため、
        //    `tag/旅行/2024.html` を探して**永久に当たらない**。
        //    サイトマップにも canonical にもその 404 が載る。
        //  - `?` `#` … URL のクエリ・フラグメント区切り。同上。
        //  - `%` … 二重エンコードの入口。decodeURIComponent が化ける。
        .replace(/[/\\?#%]+/g, "-")
        // **制御文字も落とす。** `\u0000` が混じると、静的書き出しの
        // `mkdir` が `ERR_INVALID_ARG_VALUE: must be a string without null
        // bytes` で落ちる（`/` と同じく「パスに置けない文字」）。他の C0 も
        // URL とファイル名の両方で扱いが定まらない。`\s` に当たるのは
        // タブ・改行だけなので、上の空白の正規化では落ちきらない。
        .replace(/[\u0000-\u001F\u007F-\u009F]+/g, "-")
        // **孤立サロゲートも落とす。** 切り詰めが絵文字を割った値が保存されて
        // いると、`encodeURIComponent` がここで `URIError` を投げる。
        // 一度 collectionPath 側だけで掃除したが**それは誤りだった**——
        // ルート（generateStaticParams）は slugify の値をそのまま使うので、
        // **ページの実体が置かれる URL と、リンク・canonical・サイトマップの
        // URL が食い違う**（どこからもリンクの無いページと、0件の404 ができる）。
        // `/` や `%` を落としているのと同じ場所・同じ理由で落とす。
        .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : ""))
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    // **`.` と `..` は捨てる。** パス片としては「今のディレクトリ／親」の
    // 意味になり、Next の静的書き出しが `/location/..` を `/` に解決して
    // 「Requested and resolved page mismatch」でビルドごと落ちる。
    // 誰か1人が保存した瞬間から**新しい写真も削除の反映も一切出せなくなる**
    // （消えたページを S3 から消す site-rebuild も同じビルドを通る）。
    // 4-1 で直した「壊れた行1件で全デプロイが止まる」と同じ型。
    if (/^\.+$/.test(base)) return "";
    if (type === "category") return CATEGORY_ALIASES[base] ?? clampSlugBytes(base);
    return clampSlugBytes(base);
}

/**
 * 検索エンジンに載せてよい最小の写真枚数。
 * 写真1〜2枚＋定型文だけのページを大量に作ると「中身の薄いサイト」と
 * 判断されて全体の評価が下がる。人がサイト内から辿る分には見られる。
 */
/**
 * タグの同一性を見るキー。
 *
 * 表示は生のタグ（`Mount Fuji`・`#旅`）のままで、**比べるときだけ**
 * スラッグに寄せる。集約ページの404救済は `?tags=<スラッグ>` に振り替える
 * ので、生のタグとスラッグが同じ画面に並ぶ場面がある——そのとき完全一致で
 * 比べると、**同じタグのチップが2つ**出て、片方は件数0・もう片方は
 * 押しても選択が外れない、という形になる。
 *
 * `slugify` が空を返す値（`-` `###` `...`）は生の小文字に落とす。空のまま
 * 比べると別々のタグ同士が一致してしまうため（`3a0e3ce` で塞いだ穴）。
 */
export function tagKey(value: string | undefined): string {
    const raw = (value ?? "").toString().trim().toLowerCase();
    return slugify(raw, "tag") || raw;
}

export const MIN_INDEXABLE_COUNT = 3;

/** そのページを検索エンジンに載せてよいか */
export function isIndexableCollection(count: number): boolean {
    return count >= MIN_INDEXABLE_COUNT;
}

/**
 * 統合前の旧スラッグのうち、実際に写真が使っているもの。
 *
 * カテゴリを統合すると、それまで公開していた `/category/風景` などが
 * 生成されなくなる。静的エクスポート + dynamicParams=false ではリダイレクトの
 * 層が無いためハード404になり、外部リンクや検索結果からの流入を落としてしまう。
 * 旧URLもページとして残し、canonical で統合後へ寄せる。
 */
export function legacyCategorySlugs(photos: Photo[]): string[] {
    const out = new Set<string>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        const raw = (p.category ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
        // 別名表に載っていて、かつ統合後の名前と違うものだけが「旧URL」
        const canonical = CATEGORY_ALIASES[raw];
        if (canonical && canonical !== raw) out.add(raw);
    }
    return [...out];
}

/** 統合後の正しいスラッグ（旧スラッグを渡すと統合後を返す） */
export function canonicalCategorySlug(slug: string): string {
    return slugify(decodeURIComponentSafe(slug), "category");
}

/** ルートパラメータ（既にデコード済みのことが多いが念のため）を安全にデコードして正規化 */
function normalizeParam(slug: string, type?: CollectionType): string {
    let s = slug ?? "";
    try {
        s = decodeURIComponent(s);
    } catch {
        // 不正な % シーケンスはそのまま扱う
    }
    return slugify(s, type);
}

/** 写真から、指定タイプの生の値（表示ラベル候補）を取り出す */
function valuesFor(p: Photo, type: CollectionType): string[] {
    if (type === "tag") {
        return (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
    }
    if (type === "location") {
        return p.location ? [p.location.toString().trim()].filter(Boolean) : [];
    }
    // category
    return p.category ? [p.category.toString().trim()].filter(Boolean) : [];
}

const isPublished = (p: Photo) => p.published !== false;

export type CollectionEntry = { slug: string; label: string; count: number };

/**
 * 全写真から、指定タイプの一意な集約エントリ（slug / 代表ラベル / 件数）を集める。
 * 同一写真内での重複はカウントしない。件数降順・slug 昇順で安定ソート。
 */
export function collectEntries(photos: Photo[], type: CollectionType): CollectionEntry[] {
    const bySlug = new Map<string, { label: string; count: number }>();
    for (const p of photos) {
        if (!isPublished(p)) continue;
        const seen = new Set<string>();
        for (const v of valuesFor(p, type)) {
            const slug = slugify(v, type);
            if (!slug || seen.has(slug)) continue;
            seen.add(slug);
            const cur = bySlug.get(slug);
            if (cur) cur.count++;
            else bySlug.set(slug, { label: v, count: 1 });
        }
    }
    // 撮影地の件数は photosInCollection と同じ数え方（緩い一致）にする。
    // ここが1件ずつの加算だと、ページの見出し「（N枚）」と実際に並ぶ枚数、
    // そして noindex の判定（MIN_INDEXABLE_COUNT）が食い違う。
    if (type === "location") {
        return [...bySlug.entries()]
            .map(([slug, { label }]) => ({
                slug,
                label,
                count: photos.filter((p) => isPublished(p) && sameLocation(p.location, label)).length,
            }))
            .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
    }
    return [...bySlug.entries()]
        .map(([slug, { label, count }]) => ({ slug, label, count }))
        .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/**
 * 指定 slug に一致する（公開）写真を返す。
 *
 * **撮影地だけは「緩い一致」で見る（related.ts の sameLocation と同じ）。**
 * ここが完全一致だったせいで、生成側と回遊リンクが食い違っていた:
 * 写真ページの「「パリ」の他の写真」は部分一致で3枚出るのに、そこから
 * 飛ぶ `/location/パリ` は**自分1枚**しか無い、という状態。
 * 実データ14件の撮影地は、完全一致だと**1つも 3枚（MIN_INDEXABLE_COUNT）に
 * 届かず、14ページすべてが noindex・サイトマップ0件**だった——SEO のために
 * 作ったランディングが1枚も検索に出ていなかった。緩い一致なら4つが載る。
 *
 * 撮影地は「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」のように
 * 入れ子の書き方が混ざる。タグ・カテゴリは離散的なラベルなので完全一致のまま。
 * 代償として `/location/パリ` と `/location/パリ,-フランス` は写真が重なるが、
 * 同じ写真を別の地名から辿れること自体は狙いどおり。
 */
/**
 * その集約ページに載る写真。**新しい順に並べて返す。**
 *
 * 以前は並べ替えていなかったので、入力配列の順（＝`photos.json` の
 * `createdAt` 降順）がそのまま出ていた。ホームは `date || createdAt` で
 * 並べるので、**同じ絞り込みでも `/tag/風景` と `/?tags=風景` で順が違う**
 * ——実データ30枚のうち28枚が別の位置に来る。どちらも「新しい順」を
 * 名乗るので、利用者には「さっき上にあった写真が下にある」としか見えない。
 *
 * 並べ方を入力配列に任せないこと自体も要る: 呼び出し側（静的生成・
 * サイトマップ・関連ページ）が渡す配列の作り方が変わると、黙って順が変わる。
 */
export function photosInCollection(photos: Photo[], type: CollectionType, slug: string): Photo[] {
    const target = normalizeParam(slug, type);
    if (!target) return [];
    if (type === "location") {
        const label = labelForSlug(photos, "location", slug);
        return sortByNewest(photos.filter((p) => isPublished(p) && sameLocation(p.location, label)));
    }
    return sortByNewest(photos.filter((p) => isPublished(p) && valuesFor(p, type).some((v) => slugify(v, type) === target)));
}

/** slug に対応する代表表示ラベル（最初に一致した生の値）。無ければデコードした slug。 */
export function labelForSlug(photos: Photo[], type: CollectionType, slug: string): string {
    const target = normalizeParam(slug, type);
    for (const p of photos) {
        for (const v of valuesFor(p, type)) {
            if (slugify(v, type) === target) return v;
        }
    }
    try {
        return decodeURIComponent(slug);
    } catch {
        return slug;
    }
}

const TYPE_PATH: Record<CollectionType, string> = { tag: "tag", location: "location", category: "category" };

/** 集約ページの相対 URL（/tag/<encoded slug> 等） */
export function collectionPath(type: CollectionType, slug: string): string {
    // slug は「素の値」でも「パーセントエンコード済み」でも来る
    // （ルートのパラメータは非ASCIIだとエンコードされた形で渡ってくる）。
    // そのまま encodeURIComponent すると % 自体が %25 になり、
    // /location/%25E6%259D%25B1%25E4%25BA%25AC のような**存在しないURL**を
    // canonical に出していた（検索エンジンには 404 を正規URLとして申告していた）。
    // 一度デコードしてから1回だけエンコードする。
    let raw = slug ?? "";
    try {
        raw = decodeURIComponent(raw);
    } catch {
        // 不正な % シーケンスはそのまま扱う
    }
    // **保険。** 掃除の本体は `slugify` にある（ルートとリンクが同じ値に
    // なるのはそちらのおかげ）。ここは slugify を通っていない値が渡ったとき
    // のためだけに残す——`encodeURIComponent` は孤立サロゲートで `URIError`
    // を投げ、静的ビルドではそれがビルドごと止める。
    let encoded;
    try {
        encoded = encodeURIComponent(raw);
    } catch {
        encoded = encodeURIComponent(stripLoneSurrogates(raw));
    }
    return `/${TYPE_PATH[type]}/${encoded}`;
}

/**
 * そのページの**正規URL**（旧カテゴリなら統合後を指す）。
 *
 * canonical と JSON-LD（ImageGallery の url・パンくず）が別々にURLを
 * 組んでいて、旧カテゴリで食い違っていた: `/category/風景` は
 * canonical が `/category/landscape` を指すのに、構造化データは
 * `/category/風景` を名乗る——「評価を統合後にまとめる」という目的に
 * 対して、構造化データが逆を言っていた。組み立てを1か所にする。
 */
export function canonicalCollectionPath(type: CollectionType, slug: string): string {
    const canonicalSlug = type === "category" ? canonicalCategorySlug(slug) : slug;
    return collectionPath(type, canonicalSlug);
}

export type CollectionCopy = { title: string; description: string; heading: string; breadcrumb: string };

/** ランディングページの見出し・メタ文言（日本語主体・ページ固有の導入文つき） */
export function collectionCopy(type: CollectionType, label: string, count: number): CollectionCopy {
    const kindJa = type === "tag" ? "タグ" : type === "location" ? "撮影地" : "カテゴリ";
    const heading =
        type === "location" ? `${label}の写真` : type === "category" ? `${label}の写真` : `#${label} の写真`;
    // サイト名は app/layout.tsx の `template` が付ける（同上）
    const title = `${label}の写真${count ? `（${count}枚）` : ""}`;
    const description =
        type === "location"
            ? `${label}で撮影した旅の写真${count ? `${count}枚` : ""}を掲載。現地で切り取った風景やスナップを、撮影地・カメラ情報（EXIF）付きで紹介します。${label}への旅の参考にどうぞ。`
            : type === "category"
                ? `${label}カテゴリの旅写真${count ? `${count}枚` : ""}を掲載。国内外の旅先で撮影した${label}の作品を、撮影地やカメラ情報（EXIF）と合わせて閲覧できます。`
                : `「${label}」に関する旅の写真${count ? `${count}枚` : ""}を掲載。${label}のタグが付いた作品を、撮影地・カメラ情報（EXIF）付きでまとめています。`;
    return { title, description, heading, breadcrumb: `${kindJa}: ${label}` };
}

/**
 * 同タイプの他の集約エントリ（現在の slug を除く・件数順）。
 * ランディングページ同士の相互リンク（孤立防止・回遊）に使う。
 */
export function relatedEntries(photos: Photo[], type: CollectionType, slug: string, limit = 12): CollectionEntry[] {
    const current = slugify(decodeURIComponentSafe(slug), type);
    return collectEntries(photos, type)
        .filter((e) => e.slug !== current)
        .slice(0, limit);
}

function decodeURIComponentSafe(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}
