"use client";

import React from "react";
import Link from "next/link";
import {
    MapPinIcon, ArrowLeftIcon, ShareIcon, ChevronLeftIcon, ChevronRightIcon,
} from "@heroicons/react/24/outline";
import GalleryGrid from "./GalleryGrid";
import GalleryModal from "./GalleryModal";
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
import { shareUrl, copyToClipboard, shareToTwitter, shareToLine } from "../../lib/utils/share";
import type { Photo } from "@/lib/data/photos";
import type { SpotCoords, SpotFacts } from "@/lib/utils/spot";
import { nextTabIndex } from "../../lib/utils/tabKeys";

type SpotLink = { label: string; count: number; path: string };
/** 周辺のスポット。`cover` はそのスポットの1枚（無ければ `null`） */
type NearbyLink = SpotLink & { km: number; approx: boolean; cover: Photo | null };

type Props = {
    slug: string;
    name: string;
    /** そのページの canonical（共有するURL）。**画面側で組み立てない** */
    canonicalUrl: string;
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
};

type TabKey = "overview" | "photos" | "map";

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
    slug, name, canonicalUrl, heading, description, breadcrumb,
    photos, nearbyPhotos, facts, coords, broader, narrower, nearby, related,
}: Props) {
    const { locale } = useLocale();
    const en = locale === "en";
    const { showToast } = useToast();
    const [tab, setTab] = React.useState<TabKey>("photos");

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
    const openById = React.useCallback((photoId: string) => {
        const i = photos.findIndex((p) => p.id === photoId);
        // **見つからなければ `false` を返す。** `GalleryGrid` はこの戻り値で
        // 「遷移を止めるか」を決めるので、開けないのに止めると**タップが
        // 無反応**になる（写真ページへ行く方が、何も起きないよりずっと良い）
        if (i < 0) return false;
        setOpenIndex(i);
        return true;
    }, [photos]);

    const TABS: Array<[TabKey, string]> = [
        ["overview", en ? "Overview" : "概要"],
        ["photos", en ? "Photos" : "写真"],
        ["map", en ? "Map" : "地図"],
    ];

    /**
     * 矢印キーでタブを移る（`Home` / `End` も）。移った先にフォーカスを送る
     * ——送らないと、見た目だけ動いて読み上げの位置が置いていかれる。
     * 端では折り返す（WAI-ARIA の tabs の作法）。
     */
    const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const keys = TABS.map(([k]) => k);
        // 計算は `lib/utils/tabKeys.ts`（`NotificationsBell` と共有）。
        // 選び方とフォーカスの送り先だけがここの仕事
        const next = nextTabIndex(e.key, keys.indexOf(tab), keys.length);
        if (next === null) return;
        // 矢印での横スクロールを起こさない
        e.preventDefault();
        setTab(keys[next]);
        document.getElementById(`spot-tab-${keys[next]}`)?.focus();
    };

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

                押すとその写真のページへ。**一覧の格子と同じ行き先**にして、
                新しい操作を発明しない（その場での拡大は `GalleryModal` を
                使い回す別の PR）。

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
                    >
                        {/* **比で枠を予約する**（読み込み後に高さが伸びて下がガタつかない）。
                            `slimForGrid` は `width` / `height` を渡さないので、
                            `TimelineCard` と同じ 3:2 の既定に倒す */}
                        <div
                            className="relative w-full overflow-hidden"
                            style={{
                                paddingTop: "66.6667%",
                                backgroundColor: hero.dominantColor ?? "#0d1a26",
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

            {/* 所在地。**推測しない**——同じ一覧にある「この場所を含む撮影地」
                だけを出す（書かれている字から読み取れるぶん）。
                無ければ何も出さない（国名を当てに行かない）。

                **`/` 区切りの住所のようには描かない。** 一度そう描いていたが、
                この並びは**広い順であることを保証できない**——
                `photoIsInLocation` は字の包含なので「パリ」と「フランス」は
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

            <div className="mb-5">
                <SaveSpotButton slug={slug} name={name} locale={locale} />
            </div>

            {/* タブ。**クチコミは無い**（理由は上の docstring）。

                **`role="tablist"` を名乗るなら、矢印キーで動けること。**
                名乗るだけだと、読み上げは「タブ 1/3」と案内するのに矢印が
                効かない——案内された通りに操作できない方が、ただのボタンの
                並びより悪い。`aria-selected` を持つものだけ Tab で止まる
                （roving tabindex）のも同じ作法の片割れ。 */}
            <div
                role="tablist"
                aria-label={en ? "Spot sections" : "スポットの内容"}
                className="flex gap-1 border-b border-white/10 mb-5"
                onKeyDown={onTabKeyDown}
            >
                {TABS.map(([key, text]) => (
                    <button
                        key={key}
                        type="button"
                        role="tab"
                        id={`spot-tab-${key}`}
                        aria-selected={tab === key}
                        aria-controls={`spot-panel-${key}`}
                        // **選ばれていないタブは Tab で止まらない**（矢印で移る）
                        tabIndex={tab === key ? 0 : -1}
                        onClick={() => setTab(key)}
                        // 44px の押せる高さを px で書く（`96eb86db`）
                        style={{ touchAction: "manipulation", minHeight: 44 }}
                        className={`px-4 text-sm font-semibold transition border-b-2 -mb-px ${
                            tab === key
                                ? "border-white text-white"
                                : "border-transparent text-white/50 hover:text-white/80"
                        }`}
                    >
                        {text}
                    </button>
                ))}
            </div>

            {/* ── 概要 ───────────────────────────────────────── */}
            <section role="tabpanel" id="spot-panel-overview" aria-labelledby="spot-tab-overview" hidden={tab !== "overview"}>
                {/* **その場所の説明**は、既にあるページ固有の文（`collectionCopy`）。
                    ここで新しい紹介文を作らない */}
                <p className="text-sm text-white/70 mb-5">{description}</p>

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
            </section>

            {/* ── 写真 ───────────────────────────────────────── */}
            <section role="tabpanel" id="spot-panel-photos" aria-labelledby="spot-tab-photos" hidden={tab !== "photos"}>
                <p className="mb-4 text-sm text-white/70">
                    {description}
                    <span className="ml-1 whitespace-nowrap text-white/50">（{photos.length}枚）</span>
                </p>
                <GalleryGrid
                    photos={photos}
                    locale={locale}
                    sizes={GRID_SIZES_6XL}
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
                        <GalleryGrid photos={nearbyPhotos} locale={locale} sizes={GRID_SIZES_6XL} />
                    </section>
                )}
            </section>

            {/* ── 地図 ───────────────────────────────────────── */}
            <section role="tabpanel" id="spot-panel-map" aria-labelledby="spot-tab-map" hidden={tab !== "map"}>
                {coords ? (
                    <>
                        <p className="text-sm text-white/70 mb-4">
                            {en
                                ? "Open the photo map centred on this spot."
                                : "撮影地マップを、この場所に寄せて開きます。"}
                        </p>
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
                        {/* **位置の出どころを断る。** `geoApprox` を正確な GPS と
                            区別する。座標は `sanitizeCoords` が約1kmに丸めた値で、
                            ここはそれを読むだけ（精度を上げ直さない）。
                            **小さい字なので色は薄くしない**（white/40 は黒地で
                            約3.7:1 ＝ 小さい文字の基準 4.5:1 に届かない） */}
                        <p className="mt-3 text-xs text-white/60">
                            {en ? "Positions are rounded to about 1 km. " : "位置は約1km の粒度に丸めています。"}
                            {coords.approx && (en
                                ? "This one is approximate (derived from the place name, not GPS)."
                                : "この場所の位置は、GPS ではなく地名から引いたおおよその位置です。")}
                        </p>
                    </>
                ) : (
                    // **「地図に出せる位置を持っていない」と言い切る。**
                    // 空の地図を出したり、地名から勝手に座標を当てたりしない
                    <p className="text-sm text-white/60">
                        {en
                            ? "No map position for this spot yet. Photos taken with GPS, or given a place from the edit screen, put it on the map."
                            : "この場所には、地図に出せる位置がまだありません。GPS 付きの写真を上げるか、編集画面で場所を選ぶと地図に載ります。"}
                        {/* **行き先は上と同じ式（`mapHref`）。** ここだけ
                            `ROUTES.MAP` を直書きしていたので、「座標が無ければ
                            寄せない」を見張るテストが**この直書きを読んで
                            素通り**していた（座標を勝手に 0,0 にする変異を
                            入れても緑だった＝実測）。同じ答えを2か所で
                            組まない */}
                        <Link href={mapHref} prefetch={false} className="ml-1 text-link hover:text-white underline underline-offset-4">
                            {en ? "Open the map" : "撮影地マップを開く"}
                        </Link>
                    </p>
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
                                                backgroundColor: n.cover.dominantColor ?? "#0d1a26",
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
                    onClose={() => setOpenIndex(null)}
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
