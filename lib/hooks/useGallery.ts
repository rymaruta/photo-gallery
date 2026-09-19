import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Photo, LocalizedText, LocalizedParagraphs } from "../data/photos";
import { getLocalized, getLocalizedParagraphs } from "../data/photos";
import type { GalleryFilters } from "../types/gallery";
import { slugify, normalizeForSearch, tagKey, categoryDisplayName } from "../utils/collections";
import { dedupeCameraName } from "../utils/cameraName";
import { compareNewest, compareOldest } from "../utils/photoOrder";

/**
 * タグ比較用の正規化。
 *
 * **`slugify` を借りる。同じ規則を二度書かない。** 以前はここに
 * 「trim + 小文字化 + 空白→ハイフン」だけを書いて「slugify と同じ規則」と
 * コメントしていたが、**同じではなかった**——あちらは `/ \ ? # %` を
 * ハイフンに潰し、連続ハイフンをまとめ、前後のハイフンを落とす。
 * 集約ページ（`/tag/<スラッグ>`）が404のとき `?tags=<スラッグ>` に
 * 振り替える救済があるので、規則がずれていると**一覧に写真があるのに
 * 「条件に一致する写真がありません」**になる。`#旅` や `白/黒` のような
 * 値は自由入力で普通に入る（`slugify` のコメントが挙げているとおり）。
 */
// タグの比較キーは lib/utils/collections.ts に1本化した
// （フィルタバーのチップも同じ物差しで突き合わせる）
const tagSlug = tagKey;

/**
 * カテゴリの正規化。別名（風景→landscape）の解決も `slugify` 側にある。
 *
 * 以前ここには表示名→キーの逆引き表（`DISPLAY_TO_KEY`）もあったが、
 * `slugify(_, "category")` が先に `CATEGORY_ALIASES` を当てるので、
 * 表の中身は**全部「既に正規キーになった値の恒等写像」**になっていた
 * （ja の表示名7つは全部 `CATEGORY_ALIASES` にあり、en は小文字化すると
 * キーそのもの）。効いているように見えて誰も確かめられない残骸なので
 * 落とした。**表示名を増やすときは `CATEGORY_ALIASES` に足すこと。**
 */
const normalizeKey = (s?: string) => {
    const base = slugify((s ?? "").toString(), "category");
    // 別名表は lib/utils/collections.ts を正とする。i18n のラベルから作る表だけを
    // 見ていた頃は、そこに無い表記ゆれ（「建物」）が抜けていた——トップの絞り込みでは
    // 「建築」と「建物」が別のチップとして並ぶのに、/category/architecture は
    // 同じページにまとまる。同じ写真の集合が、見る場所で違って見えていた。
    return base;
};

function readFiltersFromUrl(): Partial<GalleryFilters> {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const out: Partial<GalleryFilters> = {};
    const cat = params.get("category");
    // **URL の値も同じ正規化を通す。** 写真側は normalizeKey を通した姿で
    // 持っているので、生のまま比べると `/category/白-黒` の救済（404 →
    // `?category=白-黒`）が0件になる。表示名（「風景」）で来ても解決する。
    //
    // 正規化で空になる値（`?category=-`）は**フィルタ無しに倒す**。
    // `""` を入れると `!== "all"` なので絞り込みは効いたまま、
    // 「カテゴリ未設定の写真だけ」という理由の見えない部分集合になり、
    // しかも書き戻しでは落ちるので URL からもチップからも消える。
    if (cat) {
        const key = normalizeKey(cat);
        if (key) out.category = key;
    }
    const q = params.get("q");
    if (q) out.query = q;
    const sort = params.get("sort");
    if (sort === "new" || sort === "old" || sort === "popular") out.sort = sort;
    const tags = params.get("tags");
    // 同じタグが2つ来ると、チップの key が衝突して描画が崩れる
    if (tags) out.selectedTags = Array.from(new Set(tags.split(",").filter(Boolean)));
    // 知らない値は既定のまま
    const scope = params.get("scope");
    if (scope === "mine" || scope === "following") out.scope = scope;
    return out;
}

/**
 * 履歴の state を書くときに、**Next の内部キーを持ち越す**。
 *
 * `replaceState({}, ...)` で潰していたので、そのエントリに戻ると Next の
 * popstate ハンドラが `if (!event.state.__NA) window.location.reload()`
 * （`app-router.js`）に落ちる——**ページが丸ごと再読み込みされ、一覧の
 * スクロール位置が消える**。モーダルを閉じるたびにそれが起きていた
 * （`e6aa8c7` で `back()` を呼ぶようにして初めて表に出た。潰し自体は
 * それ以前からあった）。Next 自身も `copyNextJsInternalHistoryState` で
 * 同じことをしている。
 */
function withNextHistoryState(extra: Record<string, unknown>): Record<string, unknown> {
    const cur = (typeof window !== "undefined" ? window.history.state : null) as Record<string, unknown> | null;
    const out: Record<string, unknown> = { ...extra };
    if (cur?.__NA) out.__NA = cur.__NA;
    if (cur?.__PRIVATE_NEXTJS_INTERNALS_TREE) out.__PRIVATE_NEXTJS_INTERNALS_TREE = cur.__PRIVATE_NEXTJS_INTERNALS_TREE;
    return out;
}

/**
 * @param ownUserId ログイン中の本人の id。`scope: "mine"` はこの id の写真に絞る。
 *   無ければ（未ログイン）`mine` は `all` と同じ（絞れないので絞らない）
 */
export default function useGallery(raw: Photo[], ownUserId?: string | null) {
    // ISO日付を正規化ステップで一度だけ計算（ソート時の繰り返しパースを回避）
    const PHOTOS = useMemo(
        () =>
            raw.map((p) => {
                const category = normalizeKey(p.category);
                const tags = (p.tags ?? []).map((t) => (t ?? "").toString().trim()).filter(Boolean);
                // 並びの比較キーは lib/utils/photoOrder.ts に1本化した
                // （ここで `new Date()` を通していた頃は、ゾーン無しの
                // `T` 形式がローカル時刻・日付だけが UTC と解釈され、
                // **並びが閲覧者のタイムゾーンで変わって**いた）。
                // キーは比較のたびに写真から作るので、ここには持たせない。
                const date = p.date || p.createdAt || "";

                return { ...p, category, tags, date };
            }),
        [raw]
    );

    // URL から初期フィルターを読み込む（マウント時一度だけ）
    const [filters, setFilters] = useState<GalleryFilters>(() => ({
        category: "all",
        selectedTags: [],
        query: "",
        sort: "new",
        scope: "all",
        ...readFiltersFromUrl(),
    }));

    const [currentIndex, setCurrentIndex] = useState<number | null>(null);

    const filteredPhotos = useMemo(() => {
        let arr = PHOTOS.slice();

        // 自分の写真だけ（トップの「自分」タブ）。本人の id が無ければ絞らない
        if (filters.scope === "mine" && ownUserId) {
            arr = arr.filter((p) => p.userId === ownUserId);
        }
        // 「フォロー中」はグリッドではなく `TimelineFeed` が描くので、この一覧は
        // **空にする**。空にしないと `?photo=` が来たとき `openById` が通って
        // **フィードの上にモーダルが重なる**（前後の送りは全写真を回る）。空なら
        // 画面側の救済が「すべて」へ外してから開く。本人の id が無ければ絞らない
        if (filters.scope === "following" && ownUserId) arr = [];

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
                // **カメラ名も。** `/camera/<スラッグ>` の404救済が `/?q=` に
                // 振り替えるので、ここに無いと**必ず0件**になる（撮影地で
                // 一度踏んだ形）。機材名で探す人が居ることが案Dの前提でもある。
                // **畳んだ名前も入れる。** 404救済が振り替える `?q=` の値は
                // `dedupeCameraName` を通したスラッグ（集約ページの鍵と同じ）
                // なのに、ここは保存された生の値だけを見ていた。いま当たって
                // いるのは「先頭の語がすぐ繰り返される」形だから
                // ——`"hasselblad-hasselblad-x2d-ii-100c"` が
                // `"hasselblad-x2d-ii-100c"` を含む、という偶然に乗っている。
                // 畳み方が末尾や中間に広がった瞬間に 0件になる。
                // 両方入れる（生の値でも探せるようにする）。
                const camRaw = p.exif?.camera ?? "";
                const camFolded = dedupeCameraName(camRaw) ?? "";
                const cam = camFolded && camFolded !== camRaw ? `${camRaw} ${camFolded}` : camRaw;

                // **タグとカテゴリも。** 入っていなかったので、owner 自身が
                // 書いた語を打っても0件になっていた。実データ（公開30枚）で:
                //
                //     タグ59種のうち **12種が0件**（nature 3枚・architecture 2枚・
                //       yamanaka 2枚・loyly 2枚・白鳥の写真の「動物」…）
                //     当たっていた43種も**偶然**（題か説明に同じ語がある回だけ）
                //     カテゴリは `landscape` 12枚 → **0件**・`nature` 3枚 → 0件
                //
                // しかも**ホームのタグチップは上位10種だけ**（`POPULAR_TAG_LIMIT`）
                // なので、残り49種はチップからも選べない——打つしかないのに
                // 打っても出ない、という形だった。
                //
                // 撮影地とカメラは既に入っている（欄の文言だけが「タイトルや説明」の
                // まま古かった）。**材料を足すのであって、規則は変えない**。
                // **ここに来る `p` は正規化済み**（上の `PHOTOS`）——`tags` は
                // 生のまま配列で、`category` は **`normalizeKey` でスラッグ**に
                // なっている。なので `?? []` / `?? ""` は要らない（書くと
                // 二重の守りになり、片方ずつの変異がどちらも観測できなくなる）。
                const tags = p.tags.map(String).join(" ");
                // **スラッグだけでは日本語で探せない。** カテゴリは保存された
                // 「建築」が `architecture` に畳まれるので、スラッグだけ入れると
                // 日本語で打った人に当たらない。表示に使っている日本語名も足す
                // （カメラ名で先にやった「生の値でも探せるようにする」と同じ判断）。
                //
                // ⚠️ **当たるのは「代表の日本語名」1つだけ。** `categoryDisplayName` は
                // 別名表の**先頭**しか返さない（`建築`/`建物` → どちらも `建築`）ので、
                // 「建物」と打つとカテゴリとしては当たらない。**別名表に載っていない
                // からではない**（`建物` は載っている）——次に読む人が表を足しに
                // 行かないよう、理由を書いておく。
                const category = `${p.category} ${categoryDisplayName(p.category) ?? ""}`;
                const haystack = `${titleJa} ${titleEn} ${descJa} ${descEn} ${loc} ${cam} ${tags} ${category}`.toLowerCase();
                // **スラッグ経由の検索も通す。** 集約ページの404救済
                // （lib/utils/notFoundRedirect.ts）は /location/<スラッグ> を
                // `/?q=<スラッグ>` に振り替えるが、スラッグは空白をハイフンに
                // 潰してある。生の includes だけだと
                //   "フランス ヴェルサイユ".includes("フランス-ヴェルサイユ") → false
                // で、**多語の撮影地が必ず「該当なし」に落ちていた**。
                // タグ側は tagSlug を両側にかけて解決済み（上の分岐）。ここも
                // 両側に同じ正規化（空白→ハイフン）をかけて比べる。
                // 両側に同じ規則をかける。空白だけを潰していた頃は、
                // `/` や `#` を含む撮影地（「東京 / 渋谷」）が必ず0件だった
                // **空に落ちる検索語はスラッグ比較に使わない。**
                // `-` `#` `/` `%` `...` は slugify が空を返し、
                // `includes("")` は常に真——**全件が一致して絞り込みが
                // 効かなくなる**（`slugify` に寄せたときに作った穴）。
                // **`slugify` は使わない。** あちらはファイル名の上限に
                // 合わせて 200 バイトで切るので、タイトル＋説明＋撮影地を
                // つないだこの `haystack` に掛けると後ろが落ちる——実データ
                // 30件のうち16件が 200 バイト超で、**8件は撮影地がその外側**
                // （＝この救済が必ず0件になる）。比べるだけなので切らない。
                const qSlug = normalizeForSearch(q);
                if (haystack.includes(q)) return true;
                return qSlug ? normalizeForSearch(haystack).includes(qSlug) : false;
            });
        }

        // 並べ替えは共通の比較関数（集約ページ・写真ページの前後と同じ規則）
        if (filters.sort === "new") {
            arr.sort(compareNewest);
        } else if (filters.sort === "old") {
            arr.sort(compareOldest);
        } else if (filters.sort === "popular") {
            arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
        }

        return arr;
    }, [filters, PHOTOS, ownUserId]);

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
     *   - 新着写真は API の一覧が届くまで見つからない
     *   - 絞り込みで外れているだけの写真は、絞りを外すまで見つからない
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
        window.history.replaceState(withNextHistoryState({}), "", search ? `?${search}` : window.location.pathname);
    }, []);

    /**
     * モーダルのために自分で履歴を1件積んだか（HIST-1）。
     *
     * **開くときに履歴を積んでいなかった。** URL の同期は全部
     * `replaceState` なので、グリッドから開いた写真（静的ページがまだ無い
     * 新着写真は、遷移せずその場でモーダルが開く）は**戻るで閉じずに
     * ページごと戻る**——スマホの主要導線でこれをやると、一覧のスクロール
     * 位置も絞り込みもまとめて失う。
     *
     * 積むのは**開いた1回だけ**。前後に送るたびに積むと、閉じるのに
     * 送った回数ぶん戻るを押すことになる。
     */
    const modalEntryRef = useRef<"ours" | "url" | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams();
        if (filters.category && filters.category !== "all") params.set("category", filters.category);
        if (filters.query) params.set("q", filters.query);
        if (filters.sort && filters.sort !== "new") params.set("sort", filters.sort);
        if (filters.selectedTags.length) params.set("tags", filters.selectedTags.join(","));
        // タブも URL に載せる（開いて戻ったとき・再読込で「自分」が「すべて」に戻らない）
        if (filters.scope !== "all") params.set("scope", filters.scope);
        if (openPhotoId) {
            params.set("photo", openPhotoId);
            pendingPhotoRef.current = null;   // 開けたのでもう待つ必要は無い
        } else if (pendingPhotoRef.current) {
            params.set("photo", pendingPhotoRef.current);
        }
        const search = params.toString();
        const url = search ? `?${search}` : window.location.pathname;

        if (openPhotoId) {
            // **「モーダルの履歴エントリ」は開いている間ずっと1つ。**
            // 誰のものかまで覚える——`"ours"`（自分で積んだ）と
            // `"url"`（共有リンク・通知で来た＝そのエントリが既に
            // 開いている状態を指す）で、閉じ方が変わる。
            //
            // 前の版は「**いま**の URL にその id が載っているか」だけで
            // 決めていたので、共有リンクで開いて**次へ送った瞬間に条件が
            // 揃って積んで**しまい、閉じると `back()` が1枚目のエントリへ
            // 戻して**モーダルが開き直っていた**（1回目の「閉じる」が
            // 効かない）。実ブラウザで再現済み。
            if (modalEntryRef.current === null) {
                const alreadyInUrl = new URLSearchParams(window.location.search).get("photo") === openPhotoId;
                if (alreadyInUrl) {
                    // 共有リンク・通知。ここで積むと、閉じたときの戻り先が
                    // `?photo=` 付きになり、画面と アドレスバーが食い違う
                    modalEntryRef.current = "url";
                } else {
                    modalEntryRef.current = "ours";
                    window.history.pushState(withNextHistoryState({ photoModal: openPhotoId }), "", url);
                    return;
                }
            }
            // 送るたびには積まない（積むと閉じるのに送った回数ぶん戻ることになる）
            window.history.replaceState(withNextHistoryState({ photoModal: openPhotoId }), "", url);
            return;
        }

        // 閉じた。自分が積んだ1件がまだ現在地なら**戻して消す**。
        // `replaceState` で消すと「?photo= の無い同じページ」が2件並び、
        // 閉じたあとの戻るが**空振り**になる。戻る操作で閉じた場合は
        // popstate が既に1件戻しているので、印を見て二重に戻さない。
        const entry = modalEntryRef.current;
        modalEntryRef.current = null;
        if (entry === "ours" && (window.history.state as { photoModal?: string } | null)?.photoModal) {
            window.history.back();
            return;
        }
        window.history.replaceState(withNextHistoryState({}), "", url);
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
