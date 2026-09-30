"use client";

import React from "react";
import Link from "next/link";
import {
    MapPinIcon, ArrowLeftIcon, ShareIcon, ChevronLeftIcon, ChevronRightIcon,
} from "@heroicons/react/24/outline";
import GalleryGrid from "./GalleryGrid";
import dynamic from "next/dynamic";
import MoreMenu from "./MoreMenu";
import Thumb from "./Thumb";
import { GRID_SIZES_6XL, SPOT_HERO_SIZES, SPOT_NEARBY_SIZES } from "./gridSizes";
import SaveSpotButton from "./SaveSpotButton";
import { useLocale } from "../i18n/context";
import { ROUTES } from "../../lib/routes";
import { useToast } from "../../lib/hooks/useToast";
import { formatStoredDateTime } from "../../lib/utils/photoDate";
import { collectionPath, slugify } from "../../lib/utils/collections";
import { photoAltText } from "../../lib/utils/photoAlt";
import { formatMapHash, PHOTO_LINK_ZOOM } from "../../lib/utils/mapView";
import { useViewerHistory } from "../../lib/hooks/useViewerHistory";
import { shareUrl, copyToClipboard, shareToTwitter, shareToLine } from "../../lib/utils/share";
import type { Photo } from "@/lib/data/photos";
import type { SpotCoords, SpotFacts } from "@/lib/utils/spot";
import type { SpotLink as GuideLink } from "@/lib/data/spotLink";
import SpotLinkCard from "./SpotLinkCard";

/**
 * **ビューアは後ろへ回す**（レビューの指摘6）。
 *
 * 静的 import だと、**写真を1枚も開かない訪問者にも**`/location/*` の
 * 全ページでビューア一式（送り・スワイプ・いいね・保存・共有・
 * キーボード補助）の JS が配られる。開いたときに取りに行けばよい。
 *
 * `ssr: false` にするのは、ビューアが `window` と `document` を前提に
 * するため（静的書き出しの HTML には最初から出さない ＝ 開くまで
 * 存在しない、が正しい姿）。
 */
const GalleryModal = dynamic(() => import("./GalleryModal"), { ssr: false });

type SpotLink = { label: string; count: number; path: string };
/** 周辺のスポット。`cover` はそのスポットの1枚（無ければ `null`） */
type NearbyLink = SpotLink & { km: number; approx: boolean; cover: Photo | null };

type Props = {
    slug: string;
    name: string;
    /** そのページの canonical（共有するURL）。**画面側で組み立てない** */
    canonicalUrl: string;
    /**
     * ふりがな（モック③）と概要（モック⑤）。**人が書いたぶんだけ**
     * （`content/spot-master.json`）。無ければ `null` で、**枠ごと出さない**。
     *
     * 🔴 **`heading` や `description` に混ぜない。** 混ぜると `<title>` と
     * `<meta name=description>` が動く＝検索結果の見え方が変わる
     * （`docs/spot-master.md` の4節）。ここは本文にだけ出す。
     */
    reading: string | null;
    summary: string | null;
    heading: string;
    description: string;
    breadcrumb: string;
    photos: Photo[];
    nearbyPhotos: Photo[];
    facts: SpotFacts;
    coords: SpotCoords | null;
    broader: SpotLink[];
    narrower: SpotLink[];
    nearby: NearbyLink[];
    related: SpotLink[];
    /**
     * この撮影地の写真が**`spotId` で紐付いている**公式撮影地ガイド（重複なし・最大3件）。
     * 名前が似ているだけでは入らない（サーバーの `SpotPage` が `spotLinkForPhoto` で解く）
     */
    guides?: GuideLink[];
};

/**
 * 撮影スポット詳細。
 *
 * ## クチコミは作らない
 *
 * モックには無いが、この手の画面には付き物なので明記しておく——
 * **投稿する口も、荒れたものを裁く仕組みも持っていない**。枠だけ置くと
 * 「いつまでも0件の欄」か「誰も見ていない投稿欄」のどちらかになる。
 *
 * ## 概要に文章を作らない
 *
 * 出すのは `spotFacts` が**数えた結果**と、写真が持っていた値そのものだけ
 * （owner の指示）。紹介文は生成しない。人気の根拠を持っていないので
 * 「最近人気」のような肩書きも名乗らない。
 *
 * ## タブは全部 DOM に残す
 *
 * `/location/*` は**検索に載っているページ**。切り替えで中身を差し替えると、
 * 本文がその時の状態でしか HTML に出ない。3つとも描いて `hidden` で隠す
 * （画面に出るのは1つ、HTML には3つとも在る）。
 *
 * **初期タブは「写真」。** このページは今まで写真グリッドが本体で、
 * 既に索引に載っている。既定を「概要」にすると、**20ページぶんの
 * 最初に見えるものが変わる**——`CLAUDE.md` の「デザインは勝手に変えない」に
 * 倒して、既定は今まで見えていたものを保つ。タブの並びはモックの通り。
 * JS が動かない環境でも写真が見える、という副産物もある。
 */
export default function SpotPageClient({
    slug, name, canonicalUrl, reading, summary, heading, description, breadcrumb,
    photos, nearbyPhotos, facts, coords, broader, narrower, nearby, related, guides = [],
}: Props) {
    const { locale } = useLocale();
    const en = locale === "en";
    const { showToast } = useToast();

    /**
     * ヒーローに出している写真の位置（モック②の「1/10」）。
     *
     * **並びは変えない。** `photosInCollection` が返した順（投稿の新しい順）
     * そのままなので、最初に出るのは**いちばん新しい1枚**。
     * 「代表」を選ぶ規則をここで発明しない——`featured` は実データで 0/30 で、
     * 人気の根拠も持っていない（`lib/utils/spot.ts` の「無い情報を作らない境界」）。
     */
    const [shown, setShown] = React.useState(0);
    const hero = photos[shown];

    /**
     * 共有する URL は**サーバーが組み立てた canonical**。
     *
     * `window.location.href` を使うと、クエリ（`?utm_...`）やタブの状態が
     * 付いたまま配られる。集約ページの canonical は
     * `canonicalCollectionPath` に一本化してあるので、そこから受け取る。
     */
    const shareText = heading;

    const handleShare = async () => {
        const result = await shareUrl(canonicalUrl, shareText, description);
        // shared と cancelled（利用者が閉じた）は何も出さない
        if (result === "copied") {
            showToast(en ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
        } else if (result === "failed") {
            showToast(en ? "Could not share" : "共有できませんでした", "error");
        }
    };

    const handleCopyLink = async () => {
        if (await copyToClipboard(canonicalUrl)) {
            showToast(en ? "Link copied!" : "リンクをコピーしました");
        } else {
            showToast(en ? "Failed to copy link" : "リンクのコピーに失敗しました", "error");
        }
    };

    /**
     * その場で開いている写真の位置（モック⑧「タップで拡大表示に切り替わる」）。
     *
     * **`GalleryModal` を使い回す。2つ目のビューアは作らない**（PM の指示）。
     * 送り・スワイプ・キーボード・フォーカスの閉じ込め・いいね・保存は
     * 全部あちらが持っている。
     *
     * **URL は変えない。** ホームの `?photo=` は「静的ページの無い新着写真を
     * 見せる」ための仕掛けで、こちらの写真は**全部 `/photo/<id>` を持っている**
     * ——深いリンクはその URL が既に担っているので、同じことを2通りで
     * できるようにしない。
     */
    /**
     * 撮影地マップ（`/map`）へ、**このスポットに寄せて**飛ぶためのハッシュ。
     *
     * 写真ページ（`PhotoPageClient`）が同じ形で作っているのと**同じ関数**
     * （`formatMapHash`）。座標が無ければ空文字が返るので、そのまま
     * 「寄せずに開く」側へ倒れる——**`formatMapHash` 自身が非有限を弾く**
     * （`clampView` が `null` を返す）ので、ここで数の検査を写さない。
     *
     * ズームは `PHOTO_LINK_ZOOM`（12）。**座標は約1km に丸めてある**ので、
     * これ以上寄せてもピンの位置に意味が無い、という既にある判断に乗る。
     */
    const mapHash = coords ? formatMapHash({ lat: coords.lat, lng: coords.lng, zoom: PHOTO_LINK_ZOOM }) : "";
    const mapHref = `${ROUTES.MAP}${mapHash}`;

    const [openIndex, setOpenIndex] = React.useState<number | null>(null);
    const closeViewer = React.useCallback(() => setOpenIndex(null), []);
    /**
     * **端末の「戻る」でビューアを閉じる**（履歴を1件積む）。
     *
     * 積まないと、戻るで**ページごと離脱する**——`/location/*` は検索の
     * 着地点なので、そこで押すと**サイトの外**へ出る。その場で拡大する形に
     * した回（③）の取りこぼしで、2026-09-22 のレビューで発覚した。
     */
    useViewerHistory(openIndex !== null, closeViewer);
    const openById = React.useCallback((photoId: string) => {
        const i = photos.findIndex((p) => p.id === photoId);
        // **見つからなければ `false` を返す。** `GalleryGrid` はこの戻り値で
        // 「遷移を止めるか」を決めるので、開けないのに止めると**タップが
        // 無反応**になる（写真ページへ行く方が、何も起きないよりずっと良い）
        if (i < 0) return false;
        setOpenIndex(i);
        return true;
    }, [photos]);

    return (
        <main className="mx-auto max-w-6xl px-4 py-8 pb-28">
            {/* ── ヘッダー行（モック①: 戻る・シェア・⋯）──────────────
                **全体ヘッダー（ロゴ・ハンバーガー）は layout のもの**なので、
                この行はその下に置く（重ねない）。寸法は `PhotoPageClient` の
                同じ行に揃えた——40px の的・22px の絵・px 直書き
                （640px 未満で root が 14px に落ちるため。台帳 `96eb86db`）。

                **戻るは `router.back()` にしない。** `/location/*` は検索の
                着地点なので、直接開かれた回の `back()` は**サイトの外**へ出る。
                写真ページが同じ理由で `<Link href="/">` にしている
                （`history.length` を見る書き方は `/users/search` と
                `/user/upload` に既に2つあり、3つ目を作らない）。 */}
            <div className="flex items-center justify-between gap-2 -mx-2 mb-1">
                <Link
                    href="/"
                    prefetch={false}
                    aria-label={en ? "Back to Gallery" : "ギャラリーに戻る"}
                    className="inline-flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors"
                    style={{ width: "40px", height: "40px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <ArrowLeftIcon aria-hidden="true" style={{ width: "22px", height: "22px" }} />
                </Link>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => void handleShare()}
                        aria-label={en ? "Share" : "共有"}
                        className="inline-flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors"
                        style={{ width: "40px", height: "40px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                    >
                        <ShareIcon aria-hidden="true" style={{ width: "22px", height: "22px" }} />
                    </button>
                    {/* **⋯ は共通部品を使い回す**（`MoreMenu`。写真ページが既に使っている）。
                        中身は**この画面に本当にある操作だけ**——通報・ブロック・非表示は
                        「人」や「投稿」に対するもので、**場所には相手が居ない**ので置かない
                        （`MoreMenu` は `items` が空ならボタンごと出さない作り）。 */}
                    <MoreMenu
                        label={en ? "More" : "その他"}
                        items={[
                            { key: "copy", label: en ? "Copy link" : "リンクをコピー", onSelect: () => void handleCopyLink() },
                            { key: "x", label: en ? "Share on X" : "Xで共有", onSelect: () => shareToTwitter(canonicalUrl, shareText) },
                            ...(en ? [] : [{ key: "line", label: "LINEで共有", onSelect: () => shareToLine(canonicalUrl, shareText) }]),
                        ]}
                    />
                </div>
            </div>

            <nav aria-label="パンくずリスト" className="mb-3 text-sm text-white/60">
                <Link href="/" prefetch={false} className="hover:text-white/90">ホーム</Link>
                <span className="mx-2" aria-hidden>/</span>
                <span className="text-white/80">{breadcrumb}</span>
            </nav>

            {/* ── 代表画像（モック②）───────────────────────────
                「そのスポットを象徴する写真を大きく表示。複数あれば枚数と
                現在の位置を表示」。**運営が選ぶ『注目』ではない**——
                `featured` は実データで 0/30 で、人気の根拠も持っていない。
                出しているのは**いま並んでいる写真の1枚目**（投稿の新しい順）で、
                前/次で送れる＝**バッジの「1/N」が実際に動く**。

                押すと**その場で拡大する**（格子と同じ振る舞い）。`href` は
                `/photo/<id>` のまま残すので、検索に載っているこのページから
                写真の個別ページへの内部リンクは減らない。

                画像は `Thumb`（`<picture>`・AVIF/WebP・blur-up・
                `publicImageUrl` での1オリジン化・毒を食った控えの破棄まで
                入っている共通部品）。**2つ目の実装を作らない。** */}
            {hero && (
                <section
                    aria-label={en ? "Featured photo" : "この場所の写真"}
                    // **640px 以上は 640px で止めて中央に置く**（`SPOT_HERO_SIZES`
                    // に理由を書いた——`Thumb` の派生が 512w までなので、容器
                    // いっぱいに広げると PC で 2.2倍に引き伸ばすことになる）。
                    // 640px 未満はモックのとおり左右いっぱい。
                    className="relative -mx-4 mb-4 sm:mx-auto sm:max-w-[640px] sm:rounded-2xl sm:overflow-hidden"
                >
                    <Link
                        href={ROUTES.PHOTO(hero.id)}
                        prefetch={false}
                        aria-label={en ? "Open this photo" : "この写真を開く"}
                        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        // **格子と同じ振る舞いにする。** 同じ画面で同じ写真が
                        // 「遷移する／その場で開く」の2通りだった（レビューの指摘4）。
                        // 🔴 **`href` は残す**——消すと検索に載っているこの
                        // ページから写真の個別ページへの内部リンクが1本減る。
                        // 止めるのは押したときの遷移だけで、`GalleryGrid` の
                        // `openInPlace` とまったく同じ形
                        onClick={(e) => {
                            // 新しいタブ・別ウィンドウで開く操作は邪魔しない
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                            if (openById(hero.id)) e.preventDefault();
                        }}
                    >
                        {/* **比で枠を予約する**（読み込み後に高さが伸びて下がガタつかない）。
                            `slimForGrid` は `width` / `height` を渡さないので、
                            3:2 の既定に倒す */}
                        <div
                            className="relative w-full overflow-hidden"
                            style={{
                                paddingTop: "66.6667%",
                                backgroundColor: hero.dominantColor ?? "#121212",
                                fontSize: 0,
                                lineHeight: 0,
                            }}
                        >
                            <Thumb
                                // **送るたびに新しい `<img>` にする。** 使い回すと
                                // 前の写真が出たまま次が届くのを待つ
                                key={hero.id}
                                photo={hero}
                                alt={photoAltText(hero, locale)}
                                sizes={SPOT_HERO_SIZES}
                                // 検索の着地点で、これが画面の一番上の絵になる
                                priority
                            />
                        </div>
                    </Link>

                    {photos.length > 1 && (
                        <>
                            {/* 「N/M」（モックの「1/10」）。**送るたびに読み上げが
                                割り込むと邪魔**なので、バッジは `aria-hidden` にして
                                下の `aria-live` で伝える（写真ページと同じ形） */}
                            <p
                                className="absolute top-3 right-3 rounded-full bg-black/60 backdrop-blur-sm text-white pointer-events-none"
                                style={{ fontSize: "12px", lineHeight: "14px", padding: "4px 10px" }}
                                aria-hidden="true"
                            >
                                {shown + 1}/{photos.length}
                            </p>
                            <p className="sr-only" aria-live="polite">
                                {en
                                    ? `Photo ${shown + 1} of ${photos.length}`
                                    : `${photos.length}枚中 ${shown + 1}枚目`}
                            </p>
                            <button
                                type="button"
                                onClick={() => setShown((i) => (i - 1 + photos.length) % photos.length)}
                                aria-label={en ? "Previous photo" : "前の写真"}
                                className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white transition-colors"
                                style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                            >
                                <ChevronLeftIcon aria-hidden="true" style={{ width: "24px", height: "24px" }} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShown((i) => (i + 1) % photos.length)}
                                aria-label={en ? "Next photo" : "次の写真"}
                                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white transition-colors"
                                style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                            >
                                <ChevronRightIcon aria-hidden="true" style={{ width: "24px", height: "24px" }} />
                            </button>
                        </>
                    )}
                </section>
            )}

            {/* 見出し（スポット名）。**`heading` はそのまま使う**
                （「◯◯の写真」という既存の文言。title・JSON-LD と同じ字） */}
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">{heading}</h1>

            {/* ふりがな（モック③）。**書かれていなければ行ごと出さない。**
                読みを機械で当てに行かない——地名の読みは当てると外れる
                （「高屋」は たかや／こうや、「山中湖」は やまなかこ） */}
            {reading && <p data-testid="spot-reading" className="mb-1 text-sm text-white/60">{reading}</p>}

            {/* 所在地。**推測しない**——同じ一覧にある「この場所を含む撮影地」
                だけを出す（書かれている字から読み取れるぶん）。
                無ければ何も出さない（国名を当てに行かない）。

                **`/` 区切りの住所のようには描かない。** 一度そう描いていたが、
                この並びは**広い順であることを保証できない**——
                `photoIsInLocation` は名前として含むかの判定なので「パリ」と「フランス」は
                互いに含まず、どちらが広いかをこのデータは知らない。
                住所の形に描くと、知らない順序を主張することになる。 */}
            {broader.length > 0 && (
                <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/60">
                    <MapPinIcon className="w-4 h-4 shrink-0" aria-hidden />
                    <span className="sr-only">{en ? "Part of" : "この場所を含む撮影地"}</span>
                    {broader.map((b) => (
                        <Link
                            key={b.path}
                            href={b.path}
                            prefetch={false}
                            className="hover:text-white/90 underline underline-offset-4 decoration-white/20"
                        >
                            {b.label}
                        </Link>
                    ))}
                </p>
            )}

            {/* ── 操作（モック⑥）─────────────────────────────

                🔴 **タブを畳んで、節を縦に並べた**（2026-09-22・PM の指示。
                owner の最終版モックは「節が縦に並ぶ1枚のページ」）。

                畳んだことで本文は `hidden` から出て、**常に見える本文**になった。
                元の docstring が守っていたのは「検索に載っているページなので、
                本文が HTML から消えてはいけない」という一点で、**節に
                すればその心配自体が消える**（隠す仕組みが無くなる）。
                `SpotPageClient.test.tsx` が「`hidden` を持つ節が無いこと」と
                「3つぶんの中身が1回の描画で全部在ること」を固定している。

                置くのは**実体のある操作だけ**:
                  - **行きたい** … `spots#<uid>`（`SaveSpotButton`）
                  - **地図で見る** … この場所に寄せて `/map` へ
                  - **シェア** … ヘッダー行に在る（2つ置かない）
                  - ~~保存~~ … **置かない。** 場所に対する「保存」の実体が無く、
                    「行きたい」と同じものが2つ並ぶだけになる */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <SaveSpotButton slug={slug} name={name} locale={locale} />
                {coords && (
                    <Link
                        // **この場所に寄せて開く**（`#ズーム/緯度/経度`）。
                        // 受け取るのは `PhotoMap` の `chooseInitialView`
                        href={mapHref}
                        prefetch={false}
                        className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold bg-white/10 ring-1 ring-white/20 hover:bg-white/20 active:scale-95 transition"
                        style={{ touchAction: "manipulation", minHeight: 44 }}
                    >
                        <MapPinIcon className="w-5 h-5" aria-hidden />
                        {en ? "Open the map" : "撮影地マップを開く"}
                    </Link>
                )}
            </div>

            {/* 位置の出どころ。**`geoApprox` を正確な GPS と区別する。**
                座標は `sanitizeCoords` が約1kmに丸めた値で、ここはそれを
                読むだけ（精度を上げ直さない）。**小さい字なので色は薄く
                しない**（white/40 は黒地で約3.7:1 ＝ 小さい文字の基準
                4.5:1 に届かない） */}
            {coords ? (
                <p className="mb-5 text-xs text-white/60">
                    {en ? "Positions are rounded to about 1 km. " : "位置は約1km の粒度に丸めています。"}
                    {coords.approx && (en
                        ? "This one is approximate (derived from the place name, not GPS)."
                        : "この場所の位置は、GPS ではなく地名から引いたおおよその位置です。")}
                </p>
            ) : (
                // **「地図に出せる位置を持っていない」と言い切る。**
                // 空の地図を出したり、地名から勝手に座標を当てたりしない
                <p className="mb-5 text-sm text-white/60">
                    {en
                        ? "No map position for this spot yet. Photos taken with GPS, or given a place from the edit screen, put it on the map."
                        : "この場所には、地図に出せる位置がまだありません。GPS 付きの写真を上げるか、編集画面で場所を選ぶと地図に載ります。"}
                    <Link href={mapHref} prefetch={false} className="ml-1 text-link hover:text-white underline underline-offset-4">
                        {en ? "Open the map" : "撮影地マップを開く"}
                    </Link>
                </p>
            )}

            {/* ── 概要（モック⑤）─────────────────────────────
                **人が書いたものだけ**（`content/spot-master.json`）。生成しない
                ——owner の指示で、`lib/utils/spot.ts` が「無い情報を作らない
                境界」と書いている通り。**書かれていなければ枠ごと出ない。** */}
            {summary && <p data-testid="spot-summary" className="text-sm text-white/80 mb-4 whitespace-pre-line">{summary}</p>}

            {/* **公式撮影地ガイドへ**（2026-09-30 のレビュー: 正式なスポットが確定している写真は、
                そのスポットへ自然に辿れるように）。出すのは写真が `spotId` を持つときだけ */}
            {guides.map((g, i) => (
                <div key={g.slug} className="mb-4" data-testid="spot-guide-link">
                    <SpotLinkCard spot={g} locale={locale} headingId={`location-guide-${i}`}
                                  heading={i > 0 ? null : (en ? "Photo spot guide for these photos" : "この撮影地の写真が紐付いている撮影地ガイド")} />
                </div>
            ))}

            {/* **その場所の説明**は、既にあるページ固有の文（`collectionCopy`）。
                ここで新しい紹介文を作らない。**1回だけ出す**——タブだった頃は
                概要と写真の両方に出ていたが、節にすると同じ文が2回並ぶ */}
            <p className="text-sm text-white/70 mb-5">{description}</p>

            {/* ── 統計（モック⑦）─────────────────────────────
                出せるのは**数えられるものだけ**。「行きたい人数」は
                `spots#<uid>` に逆引きが無いので数えられず、評価は仕組みが
                無い——**枠ごと出さない**（`docs/spot-master.md` の3節） */}
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                <Fact label={en ? "Photos" : "写真"} value={`${facts.photoCount}${en ? "" : "枚"}`} />
                <Fact
                    label={en ? "Photographers" : "撮った人"}
                    value={facts.photographerCount > 0 ? `${facts.photographerCount}${en ? "" : "人"}` : null}
                />
                {/* **撮影期間は `date` を持つ写真だけから。** 投稿日は使わない
                    （実データは30枚中8枚しか撮影日を持たず、残りは
                    アップロードした年に固まっている——「撮影期間」として
                    出すと嘘になる） */}
                <Fact
                    label={en ? "Shot between" : "撮影時期"}
                    value={facts.period
                        ? facts.period.from === facts.period.to
                            ? formatStoredDateTime(facts.period.from, locale)
                            : `${formatStoredDateTime(facts.period.from, locale)} 〜 ${formatStoredDateTime(facts.period.to, locale)}`
                        : null}
                />
            </dl>

            {/* ── カテゴリタグ（モック④）── */}
            {facts.cameras.length > 0 && (
                <Chips
                    heading={en ? "Cameras used here" : "ここで使われたカメラ"}
                    // **`collectionPath` は正規化しない**（デコードして1回
                    // エンコードするだけ）。生の機種名を渡していたので
                    // `/camera/SONY%20ILCE-7M3` を出していたが、実体は
                    // `out/camera/sony-ilce-7m3.html`——`dynamicParams = false`
                    // の静的書き出しなので、**カメラのチップが出る全ページで
                    // ハード404**だった（実ビルドの `out/location/パリ.html` で確認）。
                    // 隣のタグが `t.slug` を渡しているのと同じ形に揃える
                    items={facts.cameras.map((c) => ({
                        key: c.name, label: c.name, count: c.count,
                        path: collectionPath("camera", slugify(c.name, "camera")),
                    }))}
                />
            )}
            {facts.tags.length > 0 && (
                <Chips
                    heading={en ? "Tags on these photos" : "この場所の写真に付いたタグ"}
                    items={facts.tags.map((t) => ({
                        key: t.slug, label: `#${t.label}`, count: t.count, path: collectionPath("tag", t.slug),
                    }))}
                />
            )}
            {narrower.length > 0 && (
                <Chips
                    heading={en ? "Spots within" : "この場所の中の撮影地"}
                    items={narrower.map((n) => ({ key: n.path, label: n.label, count: n.count, path: n.path }))}
                />
            )}

            {/* ── この場所の写真（モック⑧）───────────────────────
                **格子のまま。横スクロールの帯にしない。**
                モックの帯には「すべて見る」が付いているが、その行き先は
                **このページ自身**（撮影地ページが「その場所の全部」）。
                帯にすると**見える枚数が減って、行き先が自分自身**の
                「すべて見る」を置くことになる。格子は既に
                `<a href="/photo/<id>">` で全部に内部リンクを張っており、
                押せばその場で拡大する（③）。 */}
            <section aria-labelledby="spot-photos-heading" className="mt-10 pt-5 border-t border-white/10">
                <h2 id="spot-photos-heading" className="text-sm font-semibold text-white/70 mb-3">
                    {en ? "Photos here" : "この場所の写真"}
                    <span className="ml-1 whitespace-nowrap text-white/50">
                        {en ? `（${photos.length}）` : `（${photos.length}枚）`}
                    </span>
                </h2>
                <GalleryGrid
                    photos={photos}
                    locale={locale}
                    sizes={GRID_SIZES_6XL}
                    // **先読みしない。** 上にヒーローが在るので、格子の1枚目は
                    // 折り返しのずっと下（実測 y=1064 / 画面 844・390px）。
                    // 既定の8枚 `priority` は、画面に出ていない写真で LCP と
                    // 帯域を奪い合う（レビューの指摘3）
                    priorityCount={0}
                    // モック⑧「タップで拡大表示に切り替わる」。
                    // **`<Link href="/photo/<id>">` は残る**ので、
                    // 検索に載っているこのページからの内部リンクは消えない
                    onOpenPhoto={openById}
                    openInPlace
                />

                {/* **写真が少ないページにだけ。** 既存の `CollectionPage` と同じ扱い */}
                {nearbyPhotos.length > 0 && (
                    <section className="mt-10 pt-5 border-t border-white/10">
                        <h2 className="text-sm font-semibold text-white/70 mb-3">
                            {en ? "You might also like" : "ほかにこんな写真も"}
                        </h2>
                        {/* **ここも先読みしない。** ページのいちばん下で、
                            折り返しから2画面ぶん下に在る */}
                        <GalleryGrid photos={nearbyPhotos} locale={locale} sizes={GRID_SIZES_6XL} priorityCount={0} />
                    </section>
                )}
            </section>

            {/* ── 周辺のスポット（距離順）───────────────────────
                **タブの外に出す。** どのタブから来ても次へ行ける導線にする。
                座標を持つスポットどうしでしか出せないので、出ない断面がある */}
            {nearby.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {en ? "Nearby spots" : "周辺のスポット"}
                    </h2>
                    {/* モック⑨のカード。**評価も♡も出さない**——評価の仕組みが
                        無く、「行きたい」は本人しか読めない（公開の集計が無い）。
                        出せるのは**サムネ・名前・距離・枚数**の4つだけ */}
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {nearby.map((n) => (
                            <li key={n.path}>
                                <Link
                                    href={n.path}
                                    prefetch={false}
                                    className="block rounded-xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    {/* **絵が無ければ枠ごと出さない。** 代わりの絵を
                                        置くと「写真がある場所」のカードで、持って
                                        いない絵を見せることになる */}
                                    {n.cover && (
                                        <div
                                            className="relative w-full overflow-hidden"
                                            style={{
                                                paddingTop: "66.6667%",
                                                backgroundColor: n.cover.dominantColor ?? "#121212",
                                                fontSize: 0,
                                                lineHeight: 0,
                                            }}
                                        >
                                            <Thumb photo={n.cover} alt={photoAltText(n.cover, locale)} sizes={SPOT_NEARBY_SIZES} />
                                        </div>
                                    )}
                                    <div className="px-2.5 py-2">
                                        <p className="text-sm text-white/90 truncate">{n.label}</p>
                                        <p className="mt-0.5 flex items-center gap-1 text-xs text-white/60">
                                            <MapPinIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                            {/* **距離の粒度を偽らない。** 元の座標が約1kmに
                                                丸めてあるので、小数第1位までしか出さない。
                                                推定に基づくぶんは「約」を付ける */}
                                            <span className="tabular-nums">
                                                {n.approx && (en ? "~" : "約")}{n.km < 10 ? n.km.toFixed(1) : Math.round(n.km)}km
                                            </span>
                                            <span aria-hidden>·</span>
                                            <span className="tabular-nums">
                                                {en ? `${n.count} photo${n.count === 1 ? "" : "s"}` : `${n.count}枚`}
                                            </span>
                                        </p>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* 同タイプの他ページへの相互リンク（**既存のまま**・孤立防止・SEO） */}
            {related.length > 0 && (
                <section className="mt-10 pt-5 border-t border-white/10">
                    <h2 className="text-sm font-semibold text-white/70 mb-3">
                        {en ? "More locations" : "他の撮影地"}
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                        {related.map((r) => (
                            // **先読みしない**（一覧で何本も出るリンク。理由は
                            // `GalleryGrid` のカードのコメント）
                            <Link
                                key={r.path}
                                href={r.path}
                                prefetch={false}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {r.label}
                                <span className="text-white/50">{r.count}</span>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
            {/* **その場で拡大**（モック⑧）。`GalleryModal` を使い回す。
                端では折り返す——ヒーローの前/次と同じ作法 */}
            {openIndex !== null && photos[openIndex] && (
                <GalleryModal
                    photos={photos}
                    currentIndex={openIndex}
                    onClose={closeViewer}
                    onNext={() => setOpenIndex((i) => (i === null ? null : (i + 1) % photos.length))}
                    onPrev={() => setOpenIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length))}
                    locale={locale}
                />
            )}
        </main>
    );
}

/** 概要の1項目。**値が無ければ「—」と書く**（0 や推測で埋めない） */
function Fact({ label, value }: { label: string; value: string | null }) {
    return (
        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2">
            <dt className="text-[11px] text-white/50">{label}</dt>
            <dd className="text-sm text-white/90 mt-0.5">{value ?? <span className="text-white/60">—</span>}</dd>
        </div>
    );
}

function Chips({ heading, items }: { heading: string; items: Array<{ key: string; label: string; count: number; path: string }> }) {
    return (
        <section className="mt-5">
            <h2 className="text-sm font-semibold text-white/70 mb-2">{heading}</h2>
            <div className="flex flex-wrap gap-1.5">
                {items.map((i) => (
                    <Link
                        key={i.key}
                        href={i.path}
                        prefetch={false}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
                        style={{ touchAction: "manipulation" }}
                    >
                        {i.label}
                        <span className="text-white/50 tabular-nums">{i.count}</span>
                    </Link>
                ))}
            </div>
        </section>
    );
}
