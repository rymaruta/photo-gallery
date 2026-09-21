"use client";

import React from "react";
import Link from "next/link";
import { BookmarkIcon } from "@heroicons/react/24/solid";
import { useAuth } from "../auth/context";
import { useMySaves } from "../../lib/hooks/useMySaves";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import GalleryGrid from "../components/GalleryGrid";
import { GRID_SIZES_5XL } from "../components/gridSizes";
import { useLocale } from "../i18n/context";
import { photoCategoryMap } from "../../lib/utils/categoryMap";
import { ROUTES, loginWithNext } from "../../lib/routes";

/**
 * 保存した写真（/saves）。**`/favorites`（いいねした写真）とは別のページ。**
 *
 * 見分けが付くように、3つとも違えてある:
 *   - 題: 「保存した写真」／あちらは「いいねした写真」
 *   - 印: しおり（青）／あちらはハート（赤）
 *   - 説明: 「自分用の棚。投稿者には伝わりません」の1行を出す
 *
 * **端末の控え（localStorage）は混ぜない。** いいねは未ログインでも押せる
 * ので `useFavorites` との和を出しているが、保存はログインした人だけの
 * 機能で、真値はサーバーの `saves#<uid>` 1つ。
 */
export default function SavesPage() {
    const { locale, labels } = useLocale();
    const { preloadMultiple } = useImagePreloader();
    // **写真の一覧の状態も見る。** 棚が持っているのは ID だけで、中身は
    // こちらから引く——届いていなければ、保存が10件あっても0件に見える
    // （手元の断面はビルド時のもので、そのあと保存した写真は API の一覧に
    // しか無い）。`loaded` / `failed` を捨てると、それが「まだありません」に
    // 化ける
    const { photos: allPhotos, loaded: photosLoaded, failed: photosFailed } = usePhotos();
    const { isAuthenticated, loading: authLoading } = useAuth();
    const saves = useMySaves(isAuthenticated, authLoading);
    const en = locale === "en";

    /** まだ答えが出そろっていない（棚の一覧・写真の一覧のどちらか待ち） */
    const pending = saves.pending || (!photosLoaded && !photosFailed);
    /** 聞きに行って失敗した。**0件と混ぜない** */
    const failed = saves.failed || photosFailed;

    // 保存した写真。**新しい順はサーバーの一覧が持っている**ので、
    // `allPhotos` の並びではなくそちらに合わせて並べ直す
    // （`filter` だけだと、棚の順番がギャラリーの並びに化ける）。
    const savedPhotos = React.useMemo(() => {
        const byId = new Map(allPhotos.map((p) => [p.id, p]));
        return saves.photoIds
            .map((id) => byId.get(id))
            .filter((p): p is NonNullable<typeof p> => !!p);
    }, [saves.photoIds, allPhotos]);

    React.useEffect(() => {
        if (savedPhotos.length > 0) {
            preloadMultiple(savedPhotos.slice(0, 10).map((p) => p.thumbSrc ?? p.src));
        }
    }, [savedPhotos, preloadMultiple]);

    // **鍵は写真が持っている値そのもの**（読む側 `GalleryGrid` が生の値で
    // 引き、落とし先を持たない）。理由は `lib/utils/categoryMap.ts` に
    const categoryDisplayMap = React.useMemo(
        () => photoCategoryMap(savedPhotos, labels.category.names ?? {}),
        [labels, savedPhotos],
    );

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            <div className="mb-4 sm:mb-6 min-h-[64px]">
                <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
                    {en ? "Saved Photos" : "保存した写真"}
                </h1>
                <p className="text-sm text-white/60 mt-1">
                    {/* **「まだ」と「0件」を混ぜない。** 聞いている途中に
                        「0 件」と言い切ると、別の端末で保存したぶんが届く前に
                        「無い」と読める */}
                    {pending
                        ? (en ? "Loading…" : "読み込み中…")
                        : failed && savedPhotos.length === 0
                            // **失敗した回に「0 件」と言い切らない。**
                            // 数えられていないだけで、棚は空とは限らない
                            ? (en ? "Couldn't load." : "読み込めませんでした")
                            : en
                                ? `${savedPhotos.length} saved photo${savedPhotos.length !== 1 ? "s" : ""}`
                                : `保存した写真 ${savedPhotos.length} 件`}
                </p>
                {/* **いいねとの違いを画面で言う。** どちらも「集めた写真」に
                    見えるので、言わないと2つある理由が分からない */}
                <p className="text-xs text-white/50 mt-2">
                    {en
                        ? "Your own shelf — the photographer isn't notified. "
                        : "自分用の棚です。投稿者には伝わりません。"}
                    <Link
                        href={ROUTES.FAVORITES}
                        prefetch={false}
                        className="underline underline-offset-4 hover:text-white/80"
                    >
                        {en ? "Liked photos are here." : "いいねした写真はこちら"}
                    </Link>
                </p>
            </div>

            {/* 取りに行って失敗した回は、黙って短い一覧を出さない */}
            {failed && (
                <p role="alert" className="mb-4 text-sm text-amber-300/90">
                    {en
                        ? "Couldn't load your saved photos. "
                        : "保存した写真を読み込めませんでした。"}
                    <button onClick={saves.retry} className="underline text-white/80 hover:text-white">
                        {en ? "Retry" : "再試行"}
                    </button>
                </p>
            )}

            {pending && savedPhotos.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex items-center justify-center">
                    <p className="text-white/60 text-sm">{en ? "Loading…" : "読み込み中…"}</p>
                </div>
            ) : failed && savedPhotos.length === 0 ? (
                // **失敗を「まだありません」と言い換えない。** 上の警告だけを
                // 出す（空の棚の絵と「しおりを押すとここに集まります」を一緒に
                // 出すと、読み込めていないだけなのに「保存が消えた」と読める）。
                // `/favorites` は端末の控えがあるので露見しにくいが、
                // ここは控えを持たない設計なので**こちらが普通の経路**
                null
            ) : savedPhotos.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center px-6">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <BookmarkIcon className="w-8 h-8 text-white/30" />
                    </div>
                    {/* **未ログインには「まだありません」と言わない。**
                        保存はログインした人の機能なので、0件なのではなく
                        「まだ使えない」。言い分けないと、別の端末で保存した
                        人に「無い」と読まれる */}
                    {!authLoading && !isAuthenticated ? (
                        <>
                            <p className="text-white/70 text-sm">
                                {en ? "Log in to keep photos here." : "写真を保存するにはログインしてください。"}
                            </p>
                            {/* **戻り先を持たせる。** 素の `/login` だと、
                                ログインしたあとマイページへ飛ばされて、
                                見に来た棚に戻れない */}
                            <Link
                                href={loginWithNext(ROUTES.SAVES)}
                                prefetch={false}
                                className="mt-1 inline-flex items-center px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm text-white transition"
                                style={{ minHeight: "44px" }}
                            >
                                {en ? "Log in" : "ログイン"}
                            </Link>
                        </>
                    ) : (
                        <>
                            <p className="text-white/70 text-sm">
                                {en ? "No saved photos yet." : "保存した写真はまだありません。"}
                            </p>
                            <p className="text-white/50 text-xs">
                                {en
                                    ? "Tap the bookmark on a photo and it will be kept here."
                                    : "写真のしおり（保存）を押すとここに集まります。"}
                            </p>
                        </>
                    )}
                </div>
            ) : (
                <GalleryGrid
                    sizes={GRID_SIZES_5XL}
                    photos={savedPhotos}
                    locale={locale}
                    categoryDisplayMap={categoryDisplayMap}
                />
            )}
        </main>
    );
}
