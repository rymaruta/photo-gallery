import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Photo, LocalizedText, LocalizedParagraphs } from "../data/photos";
import { getLocalized, getLocalizedParagraphs } from "../data/photos";
import type { GalleryFilters } from "../types/gallery";
import { getLabels } from "../../app/i18n/labels";
import { CATEGORY_ALIASES } from "../utils/collections";

// 表示名 → 正規キーの逆引きマップ（例: "風景" → "landscape"）。
// 日本語名でカテゴリ登録された写真と英語キーの写真が
// 同じカテゴリとして扱われるようにする（フィルタチップの重複表示も防ぐ）。
const DISPLAY_TO_KEY: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const loc of ["ja", "en"] as const) {
        const names = getLabels(loc).category.names ?? {};
        for (const [key, display] of Object.entries(names)) {
            if (key === "all") continue;
            map[display.trim().toLowerCase()] = key;
        }
    }
    return map;
})();

/** タグ比較用の正規化。lib/utils/collections.ts の slugify と同じ規則 */
const tagSlug = (s?: string) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");

const normalizeKey = (s?: string) => {
    const base = (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, "-");
    // 別名表は lib/utils/collections.ts を正とする。i18n のラベルから作る表だけを
    // 見ていた頃は、そこに無い表記ゆれ（「建物」）が抜けていた——トップの絞り込みでは
    // 「建築」と「建物」が別のチップとして並ぶのに、/category/architecture は
    // 同じページにまとまる。同じ写真の集合が、見る場所で違って見えていた。
    return DISPLAY_TO_KEY[base] ?? CATEGORY_ALIASES[base] ?? base;
};

// safe ISO date parse helper — returns ISO string or empty
const toISO = (s?: string) => {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString();
};

function readFiltersFromUrl(): Partial<GalleryFilters> {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const out: Partial<GalleryFilters> = {};
    const cat = params.get("category");
    if (cat) out.category = cat;
    const q = params.get("q");
    if (q) out.query = q;
    const sort = params.get("sort");
    if (sort === "new" || sort === "old" || sort === "popular") out.sort = sort;
    const tags = params.get("tags");
    if (tags) out.selectedTags = tags.split(",").filter(Boolean);
    // **feed もここで読む。** 他のフィルターは URL に載るのに feed だけ
    // 載っていなかったので、「フォロー中」で写真を開いて戻ると
    // 「すべて」に戻っていた（ここだけ挙動が違う）。
    // 値は総当たりで確かめる——知らない文字列を入れられても既定のまま
    if (params.get("feed") === "following") out.feed = "following";
    return out;
}

export default function useGallery(raw: Photo[], followingIds?: Set<string>) {
    // ISO日付を正規化ステップで一度だけ計算（ソート時の繰り返しパースを回避）
    const PHOTOS = useMemo(
        () =>
            raw.map((p) => {
                const category = normalizeKey(p.category);
                const tags = (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
                const date = p.date || p.createdAt || "";
                const _dateISO = toISO(date);

                return { ...p, category, tags, date, _dateISO };
            }),
        [raw]
    );

    // URL から初期フィルターを読み込む（マウント時一度だけ）
    const [filters, setFilters] = useState<GalleryFilters>(() => ({
        category: "all",
        selectedTags: [],
        query: "",
        sort: "new",
        feed: "all",
        ...readFiltersFromUrl(),
    }));

    const [currentIndex, setCurrentIndex] = useState<number | null>(null);

    const filteredPhotos = useMemo(() => {
        let arr = PHOTOS.slice();

        // フォロー中フィード: フォローしているユーザーの写真だけに絞る
        if (filters.feed === "following") {
            const set = followingIds ?? new Set<string>();
            arr = arr.filter((p) => p.userId && set.has(p.userId));
        }

        if (filters.category !== "all") arr = arr.filter((p) => p.category === filters.category);
        if (filters.selectedTags.length) {
            // タグは slug に正規化してから比べる。
            //
            // 写真ページのタグリンクは slugify した形（"Mount Fuji" → "mount-fuji"）
            // を指す。まだ /tag/mount-fuji が生成されていない新着写真では
            // 404 → /?tags=mount-fuji に振り替わるが、ここが生のタグとの
            // 完全一致だったため、一覧に写真が読み込まれているのに
            // 「条件に一致する写真がありません」になっていた。
            const wanted = filters.selectedTags.map((t) => tagSlug(t));
            arr = arr.filter((p) => {
                const have = new Set((p.tags || []).map((t) => tagSlug(t)));
                return wanted.every((t) => have.has(t));
            });
        }
        if (filters.query.trim()) {
            const q = filters.query.toLowerCase();
            arr = arr.filter((p) => {
                const titleJa = typeof p.title === "string" ? p.title : getLocalized(p.title as LocalizedText, "ja");
                const titleEn = typeof p.title === "string" ? p.title : getLocalized(p.title as LocalizedText, "en");

                let descJa = "";
                let descEn = "";
                if (typeof p.description === "string") {
                    descJa = p.description;
                    descEn = p.description;
                } else {
                    descJa = getLocalizedParagraphs(p.description as LocalizedParagraphs, "ja").join(" ");
                    descEn = getLocalizedParagraphs(p.description as LocalizedParagraphs, "en").join(" ");
                }

                // location も検索対象に含める
                const loc = p.location ?? "";

                const haystack = `${titleJa} ${titleEn} ${descJa} ${descEn} ${loc}`.toLowerCase();
                // **スラッグ経由の検索も通す。** 集約ページの404救済
                // （lib/utils/notFoundRedirect.ts）は /location/<スラッグ> を
                // `/?q=<スラッグ>` に振り替えるが、スラッグは空白をハイフンに
                // 潰してある。生の includes だけだと
                //   "フランス ヴェルサイユ".includes("フランス-ヴェルサイユ") → false
                // で、**多語の撮影地が必ず「該当なし」に落ちていた**。
                // タグ側は tagSlug を両側にかけて解決済み（上の分岐）。ここも
                // 両側に同じ正規化（空白→ハイフン）をかけて比べる。
                const qSlug = q.replace(/\s+/g, "-");
                const haySlug = haystack.replace(/\s+/g, "-");
                return haystack.includes(q) || haySlug.includes(qSlug);
            });
        }

        // 事前計算済みの _dateISO を使ってソート（パースなし）
        if (filters.sort === "new") {
            arr.sort((a, b) => b._dateISO.localeCompare(a._dateISO));
        } else if (filters.sort === "old") {
            arr.sort((a, b) => a._dateISO.localeCompare(b._dateISO));
        } else if (filters.sort === "popular") {
            arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        }

        return arr;
    }, [filters, PHOTOS, followingIds]);

    // filteredPhotos を ref で追跡 → コールバックを安定させる
    const filteredPhotosRef = useRef(filteredPhotos);
    useEffect(() => {
        filteredPhotosRef.current = filteredPhotos;
    }, [filteredPhotos]);

    /** モーダルで開いている写真のID（閉じているときは undefined） */
    const openPhotoId = currentIndex === null ? undefined : filteredPhotos[currentIndex]?.id;

    // フィルターが変わるたびに URL を更新（pushせず replaceState で履歴を汚さない）。
    //
    // 以前はここで URL を filters だけから作り直していたため、
    // /?photo=<id> で開いた共有リンクの ?photo= がマウント直後に消えていた。
    // 見えている写真とアドレスバーが食い違い、再読込・ブックマーク・
    // アドレスバーのコピーのどれでも写真に戻れなかった。
    // 開いている写真も URL に残す。
    /**
     * **まだ開けていない `?photo=`。**
     *
     * 下の同期は「開いている写真」しか書かないので、マウント直後
     * （まだ開いていない）に走ると URL から `?photo=` を落とす。すぐ
     * 開ければ書き戻るが、**一覧がその場に無いと落ちたまま**になる:
     *   - `?feed=following` はフォロー集合が届くまで一覧が空
     *   - 新着写真は API の一覧が届くまで見つからない
     * どちらも待てば開けることが多いのに、その前に id を失うと二度と開けない
     * （**待ちに上限は無い**。API が落ちていればセッション中ずっと残る）。
     * 開けるか「無い」と分かるまで、最初に載っていた id を持っておく。
     */
    const pendingPhotoRef = useRef<string | null>(
        typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("photo"),
    );
    /**
     * 待ち id を立てる／捨てる。
     *
     * **立てる方も要る。** マウント時に URL から種を入れるだけでは足りない
     * ——`?photo=` が来る主経路（通知の `<Link>`）は**同じルートへの遷移**で、
     * 画面は再マウントされない。種は null のままなので、そのあと絞り込みを
     * 触った瞬間に同期が `?photo=` を落とし、id が失われる。
     * （この「再マウントされない」は GalleryPageClient のコメントが
     * 同じ理由で先に書いていたのに、隣で同じ間違いをしていた。）
     *
     * 捨てるときは **URL からもその場で外す**。覚えを消すだけだと、下の同期が
     * 次に走る（フィルターを触る・写真を開く）まで死んだ `?photo=` が残り、
     * 再読込のたびに同じ「見つかりません」が出る。
     */
    const setPendingPhoto = useCallback((id: string | null) => {
        pendingPhotoRef.current = id;
        // 立てるときは URL を触らない（そこから来た値なので既に載っている）
        if (id !== null) return;
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (!params.has("photo")) return;
        params.delete("photo");
        const search = params.toString();
        window.history.replaceState({}, "", search ? `?${search}` : window.location.pathname);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams();
        if (filters.category && filters.category !== "all") params.set("category", filters.category);
        if (filters.query) params.set("q", filters.query);
        if (filters.sort && filters.sort !== "new") params.set("sort", filters.sort);
        if (filters.selectedTags.length) params.set("tags", filters.selectedTags.join(","));
        if (filters.feed === "following") params.set("feed", "following");
        if (openPhotoId) {
            params.set("photo", openPhotoId);
            pendingPhotoRef.current = null;   // 開けたのでもう待つ必要は無い
        } else if (pendingPhotoRef.current) {
            params.set("photo", pendingPhotoRef.current);
        }
        const search = params.toString();
        window.history.replaceState({}, "", search ? `?${search}` : window.location.pathname);
    }, [filters, openPhotoId]);

    // 依存配列なし → 参照が変わらない安定したコールバック
    const open = useCallback((i: number) => {
        const len = filteredPhotosRef.current.length;
        setCurrentIndex(i >= 0 && i < len ? i : null);
    }, []);

    /** 写真IDでモーダルを開く（見つからなければ何もしない）。URL の ?photo= 用 */
    const openById = useCallback((id: string) => {
        const i = filteredPhotosRef.current.findIndex((p) => p.id === id);
        if (i !== -1) setCurrentIndex(i);
        return i !== -1;
    }, []);

    const close = useCallback(() => setCurrentIndex(null), []);

    const next = useCallback(() =>
        setCurrentIndex((i) => {
            const len = filteredPhotosRef.current.length;
            return i === null ? null : len ? (i + 1) % len : null;
        }), []);

    const prev = useCallback(() =>
        setCurrentIndex((i) => {
            const len = filteredPhotosRef.current.length;
            return i === null ? null : len ? (i - 1 + len) % len : null;
        }), []);

    const updateFilters = useCallback((next: Partial<GalleryFilters>) => {
        setFilters((s) => ({ ...s, ...next }));
    }, []);

    return {
        PHOTOS,
        filters,
        setFilters: updateFilters,
        filteredPhotos,
        currentIndex,
        openPhotoId,
        open,
        openById,
        setPendingPhoto,
        close,
        next,
        prev,
    } as const;
}
