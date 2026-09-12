import React from "react";
import Link from "next/link";
import type { Photo, Locale } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { getLabels } from "../i18n/labels";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { HeartIcon } from "@heroicons/react/24/solid";
import { ROUTES } from "../../lib/routes";
import Thumb from "./Thumb";
import { photoAltText } from "../../lib/utils/photoAlt";

type Props = {
    photos: Photo[];
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
    /**
     * 静的ページの無い新着写真をその場でモーダル表示できる画面（ホーム）が渡す。
     * 渡されていれば、/?photo=<id> への遷移ではなく直接モーダルを開く。
     */
    onOpenPhoto?: (photoId: string) => boolean;
};

/**
 * 最初に描く枚数と、下端に近づいたときに足す枚数。
 *
 * **一覧は全部を一度に DOM へ置いていた。** 枚数に比例して重くなり、
 * Chromium で実測（390x844・CPU 4倍遅い＝中位のスマホ相当・画像はモック）:
 *
 *   枚数   要素数    描き終わるまで   いちばん長い詰まり
 *     30     465          632ms              248ms
 *    300   3,165        1,231ms              739ms
 *  1,000  10,165        2,226ms            2,704ms   ← 2.7秒 何も反応しない
 *  3,000  30,165        3,585ms            8,778ms   ← 8.8秒
 *
 * `content-visibility: auto` も試したが 1割ほどしか効かない（重いのは
 * 描画ではなく DOM を作ること）。**作らない**のが唯一効く。
 *
 * 60 は スマホ2列で30行・タブレット3列で20行・PC4列で15行＝どの幅でも数画面ぶん
 * （いちばん広い `lg:grid-cols-4` でも約2,730px で、下端800px手前の番兵には届かない）。
 */
export const GRID_INITIAL_VISIBLE = 60;
export const GRID_STEP = 60;

export default function GalleryGrid({
    photos,
    locale,
    categoryDisplayMap = {},
    onOpenPhoto,
}: Props) {
    const labels = React.useMemo(() => getLabels(locale), [locale]);
    const emptyMessage = labels.gallery?.emptyMessage ?? (locale === "en" ? "No photos found." : "該当する写真がありません。");
    const total = photos?.length ?? 0;
    const [visible, setVisible] = React.useState(GRID_INITIAL_VISIBLE);
    const sentinelRef = React.useRef<HTMLDivElement>(null);

    // **絞り込みが変わったら最初から。** 深くスクロールしてから絞り込むと、
    // 数件しかないのに何百枚ぶんの枠が残る
    React.useEffect(() => { setVisible(GRID_INITIAL_VISIBLE); }, [photos]);

    React.useEffect(() => {
        if (visible >= total) return;
        // 監視できない環境（古いブラウザ・jsdom）では全部出す。
        // **出さない方に倒すと、その環境では写真が60枚で打ち切られる**
        if (typeof IntersectionObserver === "undefined") { setVisible(total); return; }
        const el = sentinelRef.current;
        if (!el) return;
        // 下端に着く前に足す（800px ＝ スマホで約1画面ぶん手前）
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) setVisible((v) => Math.min(v + GRID_STEP, total));
        }, { rootMargin: "800px 0px" });
        io.observe(el);
        // **`visible` を依存に入れて作り直す。** 足したあとも番兵が画面に
        // 入ったままだと、交差の状態が変わらないので二度と呼ばれない（＝止まる）
        return () => io.disconnect();
    }, [visible, total]);

    if (!photos || photos.length === 0) {
        return <div className="text-sm text-white/70">{emptyMessage}</div>;
    }

    const shown = photos.slice(0, visible);

    return (
        <>
        {/* 写真同士は少し余白を空けて呼吸させる（ユーザー好みで gap-0 から変更） */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1 sm:gap-1.5">
            {shown.map((p, idx) => {
                const localizedTitle = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
                // alt の組み方は `photoAlt.ts` に1本化した。**ここだけに入っていて
                // 写真ページ本体・モーダル・OGP に無かった**ので、効かせたい1枚
                // （画像検索が見る本体画像）にだけ効いていなかった
                const localizedAlt = photoAltText(p, locale);
                const placeholderColor = p.dominantColor ?? "#111";
                const objectPosition =
                    p.focalPoint ? `${Math.round(p.focalPoint.x * 100)}% ${Math.round(p.focalPoint.y * 100)}%` : undefined;

                return (
                    <GalleryItem
                        key={p.id}
                        photo={p}
                        index={idx}
                        localizedTitle={localizedTitle}
                        localizedAlt={localizedAlt}
                        placeholderColor={placeholderColor}
                        objectPosition={objectPosition}
                        categoryDisplayMap={categoryDisplayMap}
                        onOpenPhoto={onOpenPhoto}
                    />
                );
            })}
        </div>
        {/* 続きを読み込む番兵。**見た目は何も足さない**——下まで送ると
            勝手に増える（ボタンを置くとデザインの追加になる） */}
        {visible < total && <div ref={sentinelRef} data-testid="gallery-sentinel" aria-hidden={true} style={{ height: 1 }} />}
        </>
    );
}

// 個別のギャラリーアイテムコンポーネント（エラーハンドリング用、メモ化）
const GalleryItem = React.memo(function GalleryItem({
    photo,
    index,
    localizedTitle,
    localizedAlt,
    placeholderColor,
    objectPosition,
    categoryDisplayMap,
    onOpenPhoto,
}: {
    photo: Photo;
    index: number;
    localizedTitle: string;
    localizedAlt: string;
    placeholderColor: string;
    objectPosition?: string;
    categoryDisplayMap?: Record<string, string>;
    onOpenPhoto?: (photoId: string) => boolean;
}) {
    const { isFavorite } = useFavorites();
    const isFav = isFavorite(photo.id);
    const isPriority = index < 8;
    const href = ROUTES.PHOTO(photo.id);
    // 静的ページが無い写真は /?photo=<id> を指す。ホームで開いている場合、
    // これは「今いるURLへの遷移」なので Next のルーターが何もせず、
    // タップしても無反応だった。同じ画面で開けるならその場で開く。
    const opensHere = href.startsWith("/?photo=") && !!onOpenPhoto;

    return (
        <div className="w-full m-0 p-0">
            {/* タップで個別ページへ直接遷移する。まだ静的ページが無い新着写真は
                ROUTES.PHOTO が /?photo=<id> を返し、ホームがモーダルで表示する */}
            <Link
                href={href}
                onClick={opensHere ? (e) => {
                    // 新しいタブ・別ウィンドウで開く操作は邪魔しない
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    if (onOpenPhoto(photo.id)) e.preventDefault();
                } : undefined}
                className="block w-full p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                aria-label={localizedTitle ? `${localizedTitle} を開く` : "写真を開く"}
                title={localizedTitle}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                data-photo-id={photo.id}
            >
                <div
                    className="relative w-full overflow-hidden"
                    style={{ paddingTop: "75%", backgroundColor: placeholderColor, fontSize: 0, lineHeight: 0 }}
                >
                    <div className="absolute inset-0" aria-hidden={true} />

                    {/* AVIF/WebP・256/512 を <picture> で出し分け（派生が無ければ従来サムネにフォールバック）。blur-up 内包 */}
                    <Thumb
                        photo={photo}
                        alt={localizedAlt}
                        sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
                        priority={isPriority}
                        objectPosition={objectPosition}
                    />

                                {/* お気に入りアイコン */}
                                {isFav && (
                                    <div className="absolute top-2 right-2 z-10">
                                        <HeartIcon className="w-4 h-4 sm:w-5 sm:h-5 text-red-500 drop-shadow-lg" />
                                    </div>
                                )}

                                <div
                                    className="absolute left-0 right-0 bottom-0 px-2"
                                    style={{
                                        background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)",
                                    }}
                                >
                                    <div className="py-1 sm:py-2">
                                        <div
                                            className="text-sm font-semibold text-white truncate"
                                            title={localizedTitle}
                                        >
                                            {localizedTitle}
                                        </div>
                                        <div
                                            className="text-xs text-white/60 truncate"
                                            title={categoryDisplayMap?.[photo.category ?? ""] || ""}
                                        >
                                            {categoryDisplayMap?.[photo.category ?? ""]}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </div>
                );
});
