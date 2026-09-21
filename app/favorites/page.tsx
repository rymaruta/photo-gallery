"use client";

import React from "react";
import { HeartIcon } from "@heroicons/react/24/solid";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useAuth } from "../auth/context";
import { useMyServerLikes } from "../../lib/hooks/useMyServerLikes";
import { useImagePreloader } from "../../lib/hooks/useImagePreloader";
import { usePhotos } from "../../lib/hooks/usePhotos";
import GalleryGrid from "../components/GalleryGrid";
import { GRID_SIZES_5XL } from "../components/gridSizes";
import { useLocale } from "../i18n/context";
import { photoCategoryMap } from "../../lib/utils/categoryMap";

export default function FavoritesPage() {
    const { locale, labels } = useLocale();
    const { favorites } = useFavorites();
    const { preloadMultiple } = useImagePreloader();
    const { photos: allPhotos } = usePhotos();
    const { isAuthenticated, loading: authLoading } = useAuth();
    // **サーバーにも聞く。** 端末の控え（localStorage）だけを見ていたので、
    // スマホで押したいいねを PC で開くと0件だった（同じ写真のページは
    // マーカーを見るので「いいね済み」と出る＝同じアカウントで食い違う）
    const serverLikes = useMyServerLikes(isAuthenticated, authLoading);

    // いいねした写真。**サーバーと端末の和**——サーバーは別の端末のぶんを、
    // 端末は未ログインで押したぶんと、一覧の書き込みが落ちた回を拾う
    const favoritePhotos = React.useMemo(() => {
        const ids = new Set<string>(favorites);
        for (const id of serverLikes.photoIds) ids.add(id);
        return allPhotos.filter((p) => ids.has(p.id));
    }, [favorites, serverLikes.photoIds, allPhotos]);

    // お気に入りの画像をプリロード
    React.useEffect(() => {
        if (favoritePhotos.length > 0) {
            const imageSrcs = favoritePhotos.map(p => p.thumbSrc ?? p.src);
            // 最初の10枚を優先的にプリロード
            preloadMultiple(imageSrcs.slice(0, 10));
        }
    }, [favoritePhotos, preloadMultiple]);

    // **鍵は写真が持っている値そのもの**（読む側 `GalleryGrid` が生の値で
    // 引き、落とし先を持たない）。名前を引くときだけスラッグにする
    // ——理由は `lib/utils/categoryMap.ts` に書いた
    const categoryDisplayMap = React.useMemo(
        () => photoCategoryMap(favoritePhotos, labels.category.names ?? {}),
        [labels, favoritePhotos],
    );

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6 min-h-[64px]">
                <div className="flex-1">
                    <h1 id="site-title" className="text-2xl sm:text-3xl font-bold mb-0">
                        {locale === "en" ? "Liked Photos" : "いいねした写真"}
                    </h1>
                    <p className="text-sm text-white/60 mt-1">
                        {/* **「まだ」と「0件」を混ぜない。** 聞いている途中に
                            「0 件」と言い切ると、別の端末で押したぶんが
                            届く前に「無い」と読める */}
                        {serverLikes.pending
                            ? (locale === "en" ? "Loading…" : "読み込み中…")
                            : locale === "en"
                                ? `${favoritePhotos.length} liked photo${favoritePhotos.length !== 1 ? "s" : ""}`
                                : `いいねした写真 ${favoritePhotos.length} 件`}
                    </p>
                </div>

            </div>

            {/* 取りに行って失敗した回は、黙って短い一覧を出さない
                （端末の控えぶんは出るので、足りていないことだけ伝える） */}
            {serverLikes.failed && (
                <p role="alert" className="mb-4 text-sm text-amber-300/90">
                    {locale === "en"
                        ? "Couldn't load the likes saved on your account. Some photos may be missing. "
                        : "アカウントに保存されたいいねを読み込めませんでした。表示されていない写真があるかもしれません。"}
                    <button onClick={serverLikes.retry} className="underline text-white/80 hover:text-white">
                        {locale === "en" ? "Retry" : "再試行"}
                    </button>
                </p>
            )}

            {serverLikes.pending && favoritePhotos.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex items-center justify-center">
                    <p className="text-white/60 text-sm">{locale === "en" ? "Loading…" : "読み込み中…"}</p>
                </div>
            ) : favoritePhotos.length === 0 ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <HeartIcon className="w-8 h-8 text-white/30" />
                    </div>
                    <p className="text-white/70 text-sm">
                        {locale === "en" ? "No liked photos yet." : "いいねした写真はまだありません。"}
                    </p>
                    <p className="text-white/50 text-xs">
                        {locale === "en" ? "Tap the heart on a photo and it will be collected here." : "写真のハート（いいね）を押すとここに集まります。"}
                    </p>
                </div>
            ) : (
                <GalleryGrid
                        sizes={GRID_SIZES_5XL}
                    photos={favoritePhotos}
                    locale={locale}
                    categoryDisplayMap={categoryDisplayMap}
                />
            )}
        </main>
    );
}
