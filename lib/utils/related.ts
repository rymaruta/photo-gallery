import type { Photo } from "../data/photos";
import { compareNewest, sortByNewest } from "./photoOrder";
import { tagKey, slugify } from "./collections";

// 写真ページの回遊導線に使う「関連写真」の選定ロジック。
// ビルド時の photos.json（+ APIの最新一覧）だけで計算でき、API追加は不要。

/** 場所名を緩く正規化して比較する（前後空白・大文字小文字・全角空白を無視） */
function normalizeLocation(loc?: string): string {
    return (loc ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * 2つの場所名が「同じ場所」とみなせるか（完全一致 or 一方が他方を含む）。
 *
 * **これは写真ページの回遊（「この場所の写真」）のための緩い判定。**
 * 向きを見ないので、「ロヴァニエミ, フィンランド」の写真に「フィンランド」の
 * 写真を並べる。**見て回る導線としてはそれでよい**（近くの写真が出る）。
 *
 * **集約ページには使えない**——そちらは `photoIsInLocation` を使う。
 * 理由はそちらに書いた。
 */
export function sameLocation(a?: string, b?: string): boolean {
    const na = normalizeLocation(a);
    const nb = normalizeLocation(b);
    if (na.length < 2 || nb.length < 2) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * その写真は `/location/<見出し>` のページに載るか（**向きがある**）。
 *
 * 条件は「**写真の撮影地が、ページの見出しと同じか、より細かい**」。
 *
 * `sameLocation` は対称（`a.includes(b) || b.includes(a)`）なので、
 * 集約ページに使うと**広い方の写真が狭いページに載る**:
 *
 *     ページ「フィンランド」        ← 写真「ヘルシンキ, フィンランド」   ○ 正しい
 *     ページ「ヘルシンキ, フィンランド」← 写真「フィンランド」            ✗ 撮影地が違う
 *
 * 実測（撮影地12枚を埋めた状態で実ビルド）: `/location/ロヴァニエミ,-フィンランド`
 * が **7枚**を並べていた（ロヴァニエミで撮ったのは1枚）。
 * 現データでも `/location/オペラ・ガルニエ（パリ）` が、撮影地が「パリ」の
 * 写真を1枚数えて **2枚**になっていた。
 *
 * **これは `MIN_INDEXABLE_LOCATION = 2` を骨抜きにしていた。**
 * 「1枚しか無い撮影地ページは、その写真の個別ページと中身が同じだから
 * 索引に載せない」と決めてあるのに、**別の場所の写真で枚数を水増しして**
 * 通り抜けていた。実測で索引に載る撮影地は **7 → 5**（減った2つは
 * (a) 1枚しか無いページ (b) `/location/パリ` とほぼ同じ中身の
 * `/location/パリ,-フランス`）。**枚数は減るが、嘘は消える。**
 */
export function photoIsInLocation(photoLocation?: string, pageLabel?: string): boolean {
    const photo = normalizeLocation(photoLocation);
    const page = normalizeLocation(pageLabel);
    if (photo.length < 2 || page.length < 2) return false;
    return photo.includes(page);
}

// 並べ替えは lib/utils/photoOrder.ts に1本化した（ホーム・集約ページと
// 同じ規則にする。逆にすると、一覧で隣にあった写真と「次の写真」が
// 食い違う——撮影日と投稿日は普通ズレるため）。

/** 公開写真だけに絞る（published===false を除外） */
function isPublic(p: Photo): boolean {
    return p.published !== false && !!p.src;
}

/**
 * 同じ投稿者の他の写真（新しい順）。current自身は除く。
 */
export function sameAuthorPhotos(current: Photo, all: Photo[], limit = 8): Photo[] {
    const owner = current.userId;
    if (!owner) return [];
    return all
        .filter((p) => p.id !== current.id && isPublic(p) && p.userId === owner)
        .sort(compareNewest)
        .slice(0, limit);
}

/**
 * 同じ場所の写真（新しい順）。current自身と非公開・ストーリーを除く。
 * **同一投稿者は除かない**（下の実装コメント参照。以前この JSDoc が
 * 「同一投稿者の写真は除く」と逆のことを書いていた）。
 */
export function sameLocationPhotos(
    current: Photo,
    all: Photo[],
    limit = 8,
    exclude?: ReadonlySet<string>,
): Photo[] {
    const loc = current.location;
    if (!loc || normalizeLocation(loc).length < 2) return [];
    return all
        .filter(
            (p) =>
                p.id !== current.id &&
                // **除外は上限で切る前にかける。** あとから間引くと、
                // 同じ場所の写真が9枚あっても「8枚取って重複を落として3枚」
                // のように、出せるはずの写真が出なくなる
                !exclude?.has(p.id) &&
                isPublic(p) &&
                // **同一投稿者を除かない。** 投稿者が実質1人なので、この条件が
                // あると常に偽になり、out/photo/*.html 30枚すべてで
                // 「同じ場所の写真」が1件も出ていなかった（実測 0/30）。
                // SEO のために作った内部リンク面が丸ごと死んでいた。
                sameLocation(p.location, loc),
        )
        .sort(compareNewest)
        .slice(0, limit);
}

/**
 * 一覧の並び（新しい順）における前後の写真。
 * ホームの既定ソートと同じ「新しい順」で隣接するものを返す。
 * 端はループしない（先頭のprev/末尾のnextはnull）。
 */
export function adjacentPhotos(
    current: Photo,
    all: Photo[],
): { prev: Photo | null; next: Photo | null } {
    const ordered = all.filter(isPublic).sort(compareNewest);
    const idx = ordered.findIndex((p) => p.id === current.id);
    if (idx === -1) return { prev: null, next: null };
    return {
        prev: idx > 0 ? ordered[idx - 1] : null,
        next: idx < ordered.length - 1 ? ordered[idx + 1] : null,
    };
}

/**
 * 写真ページの回遊セクション（同じ投稿者 / 同じ場所）。
 *
 * **場所側は、投稿者側に出したものを除く。** この2つは同じ画面に上下で
 * 並ぶのに、互いを知らずに選んでいたので、**同じサムネイルが2度出て**
 * いた——実データ30枚での実測では、場所セクションが出る6ページのうち
 * **3ページで重複**、その3ページは中身が**全部**上の再掲だった
 * （投稿者が実質1人なので、同じ場所の写真はほぼ最新8枚に含まれる）。
 *
 * 呼び出し側2つ（静的生成の `page.tsx` とクライアントの `PhotoPageClient`）
 * が同じ組を作るので、ここに1本化する——片方だけ直すと、静的HTMLと
 * ハイドレーション後で中身が変わる。
 *
 * 除いた結果が0件ならセクションごと出ない（`RelatedPhotos` は0件で null）。
 */
export function relatedSections(
    current: Photo,
    all: Photo[],
    limit = 8,
): { author: Photo[]; location: Photo[] } {
    const author = sameAuthorPhotos(current, all, limit);
    const shown = new Set(author.map((p) => p.id));
    return { author, location: sameLocationPhotos(current, all, limit, shown) };
}


/**
 * 集約ページの「ほかにこんな写真も」。
 *
 * **1〜2枚の集約ページを、人が読んで次へ行けるページにするため。**
 * 実データの `/location/*` は14ページ中10ページが写真2枚以下で、
 * 開いても行き止まりだった。
 *
 * **これは「索引に載せてよい」の根拠にはしない。** ここで足す写真は
 * 他のページにも出るもので、そのページ固有の中身ではない
 * （`isIndexableCollection` は `matched` の枚数だけで見る）。効くのは
 * 回遊——押せば個別ページへ行ける、内部リンクが増える、の2つ。
 *
 * **既存の `relatedSections` は使えない。** あれは「同じ撮影者／同じ撮影地」で、
 * 集約ページが既に出しているものと重なる（撮影地ページなら丸ごと同じ）。
 * ここで欲しいのは「**そのページに出ていない、近い写真**」。
 *
 * 近さは共有する**タグとカテゴリ**で測る。撮影地は足さない——足すと
 * 撮影地ページで「同じ場所の写真」が二重に出る。
 *
 * 並びは決定的（点数 → 新しい順 → 新しい順で表示）にして、ビルドの
 * たびに順が変わらないようにする。
 */
export function relatedCollectionPhotos(
    shown: Photo[],
    all: Photo[],
    limit = 6,
): Photo[] {
    if (shown.length === 0) return [];
    const here = new Set(shown.map((p) => p.id));
    const tags = new Set<string>();
    const cats = new Set<string>();
    for (const p of shown) {
        for (const t of p.tags ?? []) if (typeof t === "string" && t.trim()) tags.add(tagKey(t));
        const c = typeof p.category === "string" ? p.category.trim() : "";
        if (c) cats.add(slugify(c, "category"));
    }
    if (tags.size === 0 && cats.size === 0) return [];

    const scored: Array<{ p: Photo; score: number }> = [];
    for (const p of all) {
        if (here.has(p.id) || p.published === false) continue;
        let score = 0;
        for (const t of p.tags ?? []) {
            if (typeof t === "string" && t.trim() && tags.has(tagKey(t))) score += 1;
        }
        const c = typeof p.category === "string" ? p.category.trim() : "";
        if (c && cats.has(slugify(c, "category"))) score += 2;
        if (score > 0) scored.push({ p, score });
    }
    // **同点の決着まで書く。** `slice` で切る前に順序が決まっていないと、
    // 「どの写真が載るか」が `all` の並び順という**書いていない規則**で
    // 決まる（`Array.sort` は安定なので、渡された配列の順がそのまま
    // 出る）。集約ページはビルド時の `photos.json` から、写真ページは
    // APIの一覧からも組むので、同じ点数の写真のうち載る側が経路で変わる。
    // 表示の並びと同じ「新しい順」で決める。
    return sortByNewest(
        scored.sort((a, b) => b.score - a.score || compareNewest(a.p, b.p))
            .slice(0, limit).map((x) => x.p),
    );
}

/**
 * 回遊リンクに要る項目だけに絞る。
 *
 * **写真ページの RSC ペイロードに、読まれない項目が載っていた。**
 * `app/photo/[id]/page.tsx` は `relatedSections(photo, photos, 8)` と
 * `adjacentPhotos` を丸ごと props に渡す——**写真オブジェクト最大18個**が
 * 説明も EXIF もタグも付いたまま、全写真ページの HTML に埋め込まれる。
 *
 * 使うのは `RelatedPhotos`（`id` / `title` / `dominantColor` ＋ `Thumb`）と
 * 前後のリンク（`id` / `title`）だけ。`Thumb` が読むのは
 * `src` / `thumbSrc` / `thumbSm` / `thumbAvif` / `thumbSmAvif` /
 * `blurDataURL` の6つで、`alt` は呼び出し側が prop で渡す。
 *
 * **消す側ではなく残す側を並べる。** 「要らないものを消す」形にすると、
 * 新しい項目が増えた日に黙って載る（台帳の型: `PRIVATE_FIELDS` を
 * 「落とす一覧」で持っていて、増えた属性が公開JSONに出た）。
 */
const THUMB_FIELDS = ["src", "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif", "blurDataURL"] as const;
const LINK_FIELDS = ["id", "title", "dominantColor"] as const;
/**
 * グリッド（`GalleryGrid`）が追加で読むもの。
 *   `focalPoint` … 切り抜きの中心
 *   `category`   … hover で出す分類名
 *   `alt` / `location` … `photoAltText` が読む（題＋撮影地で alt を組む）
 */
const GRID_FIELDS = ["focalPoint", "category", "alt", "location"] as const;

function pick(p: Photo, keys: readonly string[]): Photo {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
        const v = (p as unknown as Record<string, unknown>)[k];
        if (v !== undefined) out[k] = v;
    }
    return out as unknown as Photo;
}

export function slimForLinks(p: Photo): Photo {
    return pick(p, [...LINK_FIELDS, ...THUMB_FIELDS]);
}

/**
 * 集約ページのグリッドに要る項目だけに絞る。
 *
 * 集約ページ（`/tag/*` `/location/*` `/category/*` `/camera/*` ＝約86ページ）も
 * 写真オブジェクトを丸ごと props に渡していた。実測:
 *
 *     /category/landscape  67.7KB → gzip 15.0KB
 *       description 19回 / exif 15回 / tags 16回 / userId 16回
 *
 * グリッドが読むのは `id` / `title` / `dominantColor` / `focalPoint` /
 * `category` と、`photoAltText` の `alt` / `location`、それに `Thumb` の6項目。
 * **JSON-LD は絞る前の `matched` から作る**ので影響しない。
 */
export function slimForGrid(p: Photo): Photo {
    return pick(p, [...LINK_FIELDS, ...THUMB_FIELDS, ...GRID_FIELDS]);
}

/** 写真ページに焼き込む回遊リンクの材料（**絞ったもの**） */
export type InitialRelated = {
    author: Photo[];
    location: Photo[];
    prev: Photo | null;
    next: Photo | null;
};

/**
 * 写真ページに渡す回遊リンクを組み立てる（**純関数**）。
 *
 * **絞る処理を呼び出し側に置かない。** ページの中で
 * `relatedSections(...).author.map(slimForLinks)` と書いていると、
 * **`map(slimForLinks)` を1つ消しても誰も気づかない**（配線は
 * サーバーコンポーネントの中で、テストから触れない）。
 * 台帳が `cdnLines` / `reportFunctions` で同じ判断をしている
 * ——「配線は『呼んでいるか』ではなく『出たもの』で見る」。
 */
export function initialRelatedFor(current: Photo, all: Photo[], limit = 8): InitialRelated {
    const sections = relatedSections(current, all, limit);
    const adjacent = adjacentPhotos(current, all);
    return {
        author: sections.author.map(slimForLinks),
        location: sections.location.map(slimForLinks),
        prev: adjacent.prev ? slimForLinks(adjacent.prev) : null,
        next: adjacent.next ? slimForLinks(adjacent.next) : null,
    };
}
