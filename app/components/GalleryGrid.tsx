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
import { displayTitle } from "../../lib/utils/photoTitle";

type Props = {
    photos: Photo[];
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
    /**
     * 静的ページの無い新着写真をその場でモーダル表示できる画面（ホーム）が渡す。
     * 渡されていれば、/?photo=<id> への遷移ではなく直接モーダルを開く。
     */
    onOpenPhoto?: (photoId: string) => boolean;
    /**
     * **静的ページのある写真も、その場で開く**（既定は false ＝今までどおり）。
     *
     * `onOpenPhoto` は元々「静的ページの無い新着写真」専用だった
     * （`/?photo=<id>` へ遷移しても今いる URL なので何も起きない、という
     * 不具合の受け皿）。撮影スポット詳細のモック⑧は
     * 「タップで拡大表示に切り替わる」なので、**ページのある写真でも
     * その場で開きたい**。
     *
     * **`<Link href="/photo/<id>">` はそのまま残る。** 消すと
     * `/location/*`（検索に載っている14ページ）から写真の個別ページへの
     * 内部リンクが丸ごと消える——出しているのは同じ `<a href>` で、
     * 変えるのは「押したときに遷移を止めるか」だけ。
     *
     * **既定を false にしてあるので、既存の呼び出し側の振る舞いは1つも
     * 変わらない**（ホーム・お気に入り・保存・他の集約ページ）。
     */
    openInPlace?: boolean;
    /**
     * **先に読む枚数**（既定 8 ＝今までどおり）。
     *
     * この格子が**画面の最初のものでない**画面が渡す。撮影スポット詳細は
     * 上に代表画像（ヒーロー）が在り、**格子の1枚目は折り返しのずっと下**
     * ——実測（Chromium 390x844）で **y=1064 / 画面 844**。それでも先頭8枚を
     * `priority`（eager ＋ fetchpriority high）で取っていたので、
     * **画面に出ていない8枚が、LCP であるヒーローと帯域を奪い合っていた**。
     *
     * しかも1枚目はヒーローと**同じ写真**なので、箱の大きさが違うぶん
     * **512w と 256w を両方**取っていた（390px で実測）。
     *
     * **既定は 8 のまま**なので、ホーム・お気に入り・保存・他の集約ページは
     * 1つも変わらない。
     */
    priorityCount?: number;
    /**
     * `<picture>` の `sizes`。**画面の容器ごとに違うので呼ぶ側が必ず渡す。**
     *
     * **既定値は置かない。** 置くと、容器の違う画面に足したときに黙って
     * 間違った値が使われる（実際、集約ページが渡すのをやめる変異が
     * テストを素通りした——箱 276px に 236px と申告して小さすぎる候補を選ぶ）。
     * 必須にすれば型検査が落とす＝「設定ミスは動かないに倒す」という
     * このリポジトリの方針どおりになる。
     */
    sizes: string;
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
    openInPlace = false,
    priorityCount = 8,
    sizes,
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
                // 題が無ければ空。サーバーが入れていた「無題」も題として扱わない（`photoTitle.ts`）
                const localizedTitle = displayTitle(getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : ""));
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
                        openInPlace={openInPlace}
                        priorityCount={priorityCount}
                        sizes={sizes}
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
    openInPlace,
    priorityCount,
    sizes,
}: {
    photo: Photo;
    index: number;
    localizedTitle: string;
    localizedAlt: string;
    placeholderColor: string;
    objectPosition?: string;
    categoryDisplayMap?: Record<string, string>;
    onOpenPhoto?: (photoId: string) => boolean;
    openInPlace?: boolean;
    priorityCount?: number;
    sizes: string;
}) {
    const { isFavorite } = useFavorites();
    const isFav = isFavorite(photo.id);
    /**
     * 2枚目以降の枚数（1投稿に複数枚）。**壊れた要素は数えない**
     * ——本番のデータは何でもありうるので、`src` を持つものだけ数える
     * （数え違えると「1/3」と出して開くと2枚、になる）
     */
    const extraCount = Array.isArray(photo.extraImages)
        ? photo.extraImages.filter((i) => typeof i?.src === "string" && !!i.src).length
        : 0;
    const isPriority = index < (priorityCount ?? 8);
    // 分類の表示名。**帯を出すかどうかの判定と同じ値で描く**——別々に書くと
    // 片方だけの変異がどちらも観測できなくなる（`2bba4291` の型）
    const categoryLabel = categoryDisplayMap?.[photo.category ?? ""] ?? "";
    const href = ROUTES.PHOTO(photo.id);
    // 静的ページが無い写真は /?photo=<id> を指す。ホームで開いている場合、
    // これは「今いるURLへの遷移」なので Next のルーターが何もせず、
    // タップしても無反応だった。同じ画面で開けるならその場で開く。
    // **その場で開く条件は2つ。** (1) 静的ページが無い写真（`/?photo=<id>` は
    // 今いる URL なので遷移しても何も起きない・元からの受け皿）。
    // (2) 呼ぶ側が `openInPlace` を立てた画面（撮影スポット詳細のモック⑧）。
    // どちらでも `<Link href>` は残るので、内部リンクは消えない
    const opensHere = !!onOpenPhoto && (openInPlace || href.startsWith("/?photo="));

    return (
        <div className="w-full m-0 p-0">
            {/* タップで個別ページへ直接遷移する。まだ静的ページが無い新着写真は
                ROUTES.PHOTO が /?photo=<id> を返し、ホームがモーダルで表示する。

                **先読みはしない（`prefetch={false}`）。**
                Next の `<Link>` は既定で「画面に入ったら先読み」で、一覧は
                カードが30枚ある。**先読みが引くのは行き先のHTML（1本およそ55KB）と
                セグメントの `.txt` 数本**——静的書き出しなので RSC の口が無く、
                文書そのものを取りに行く（重いのはHTMLの方で、実測でトップの
                先読みの86%）。しかも **`deploy-static-site.js` はどちらも
                `no-cache, no-store` で配る**（`isHtmlOrTxt`）——つまりカードが
                画面に出入りするたびに**毎回落とし直す**。

                実測（`out/` を手元に配り、往復80msを足して5回の中央値）:

                    先読みあり  1訪問あたり 142要求 / **1.74 MB**（生）  タップ→表示 150ms
                    先読みなし  1訪問あたり   1要求 /    18 KB          タップ→表示 233ms

                **1.72 MB を落とさなくなる代わりに、最初のタップが +83ms。**
                1枚も開かずに帰る人にも毎回 1.7MB 掛かっていたので、
                写真そのものと帯域を奪い合う方が高くつく（このサイトの優先度は
                表示速度）。写真が増えるほど差は開く。

                ⚠️ **この +83ms は「速い回線で、しばらく置いてから押した」ときの数字。**
                回線を絞って（1.6Mbps）**すぐ押す**と符号が逆転し、
                **先読みなしの方が 94ms 速い**（先読みの要求が先に並んでいて、
                タップの取得がその後ろに付くため）。条件によっては代償ですらない。

                ⚠️ **JS が減るのは初回訪問だけ。** `_next/**` は
                `max-age=31536000, immutable` で配られ、Service Worker も
                キャッシュ優先で持つ。毎回効くのは `no-store` の HTML と
                `.txt` のぶん（写真ページで約1MB）。

                ⚠️ **`prefetch={false}` は hover / touchstart の先読みも止める**
                （`next/dist/client/app-dir/link.js` の `prefetchEnabled`）。
                タップの手前で温める形（`router.prefetch` を `onTouchStart` で）
                にすれば 83ms の大半は取り戻せるはずだが、**この環境では
                実機のタップ間隔を作れないので測れない**——測れないものを
                入れない。遷移が遅いと感じたらそこが次の一手。 */}
            <Link
                href={href}
                prefetch={false}
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
                        sizes={sizes}
                        priority={isPriority}
                        objectPosition={objectPosition}
                    />

                                {/* お気に入りアイコン */}
                                {isFav && (
                                    <div className="absolute top-2 right-2 z-10">
                                        <HeartIcon className="w-4 h-4 sm:w-5 sm:h-5 text-red-500 drop-shadow-lg" />
                                    </div>
                                )}

                                {/* **複数枚なら枚数を出す**（owner のモックの「1/5」）。
                                    これが無いと、一覧では1枚の投稿と見分けが付かない
                                    ——開いて初めて「他にもある」と分かる。
                                    **お気に入りと重ならないよう左上に置く**（あちらは右上）。
                                    寸法と字は px（640px 未満で root が 14px に落ちる）。
                                    数字は `aria-hidden`——読み上げにはカードの名前
                                    （`aria-label`）で伝える方が筋が良いが、そちらは
                                    別の仕事なので、ここでは**目で見る人にだけ**出す */}
                                {extraCount > 0 && (
                                    <p
                                        className="absolute top-2 left-2 z-10 rounded-full bg-black/60 backdrop-blur-sm text-white pointer-events-none"
                                        style={{ fontSize: "11px", lineHeight: "13px", padding: "3px 7px" }}
                                        aria-hidden="true"
                                    >
                                        1/{extraCount + 1}
                                    </p>
                                )}

                                {/* **題も分類も無ければ、帯ごと出さない。** 題の無い写真に
                                    空の行を敷くと、写真の下だけ黒くなって理由が分からない
                                    （owner:「タイトルなくてもいいよ」） */}
                                {(localizedTitle || categoryLabel) && (
                                <div
                                    className="absolute left-0 right-0 bottom-0 px-2"
                                    style={{
                                        background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)",
                                    }}
                                >
                                    {/* 中の行は空でも高さを持たない（中身が無い block は
                                        行ボックスを作らない）ので、出し分けはしない
                                        ——**観測できない条件を置かない**（`bf3df612`）。
                                        黒く見えるのは上の帯だけなので、判定もそこ1つ */}
                                    <div className="py-1 sm:py-2">
                                        <div
                                            className="text-sm font-semibold text-white truncate"
                                            title={localizedTitle}
                                        >
                                            {localizedTitle}
                                        </div>
                                        <div
                                            className="text-xs text-white/60 truncate"
                                            title={categoryLabel}
                                        >
                                            {categoryLabel}
                                        </div>
                                    </div>
                                </div>
                                )}
                            </div>
                        </Link>
                    </div>
                );
});
