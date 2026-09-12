import type { Photo } from "../data/photos";
import { compareNewest, sortByNewest } from "./photoOrder";
import { tagKey, slugify } from "./collections";

// 写真ページの回遊導線に使う「関連写真」の選定ロジック。
// ビルド時の photos.json（+ APIの最新一覧）だけで計算でき、API追加は不要。

/** 場所名を緩く正規化して比較する（前後空白・大文字小文字・全角空白を無視） */
function normalizeLocation(loc?: string): string {
    return (loc ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** 2つの場所名が「同じ場所」とみなせるか（完全一致 or 一方が他方を含む） */
export function sameLocation(a?: string, b?: string): boolean {
    const na = normalizeLocation(a);
    const nb = normalizeLocation(b);
    if (na.length < 2 || nb.length < 2) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
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
 * **薄いページを、読む価値のあるページにするため。** 実データの
 * `/location/*` は14ページ中10ページが写真2枚以下で、`isIndexableCollection`
 * が noindex にしていた——「高屋神社」のような**具体語で1位を狙える
 * 唯一のページ**を、こちらから検索に出すなと言っている状態だった。
 *
 * **既存の `relatedSections` は使えない。** あれは「同じ撮影者／同じ撮影地」で、
 * 集約ページが既に出しているものと重なる（撮影地ページなら丸ごと同じ）。
 * ここで欲しいのは「**そのページに出ていない、近い写真**」。
 *
 * 近さは共有する**タグとカテゴリ**で測る。撮影地は足さない——足すと
 * 撮影地ページで「同じ場所の写真」が二重に出る。
 *
 * **水増しではない。** 出すのは実在の写真で、押せば個別ページへ行ける
 * （回遊が増える）。並びは決定的（点数 → 新しい順）にして、
 * ビルドのたびに順が変わらないようにする。
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
    return sortByNewest(
        scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.p),
    );
}
