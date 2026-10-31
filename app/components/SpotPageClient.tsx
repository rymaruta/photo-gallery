"use client";

import React from "react";
import Link from "next/link";
import {
    MapPinIcon, MapIcon, ArrowLeftIcon, ShareIcon, ArrowUpOnSquareIcon, ChevronLeftIcon, ChevronRightIcon,
} from "@heroicons/react/24/outline";
import GalleryGrid from "./GalleryGrid";
import dynamic from "next/dynamic";
import MoreMenu from "./MoreMenu";
import Thumb from "./Thumb";
import { EDITORIAL_HERO_SIZES, EDITORIAL_PAIR_SIZES, SPOT_HERO_SIZES, SPOT_NEARBY_SIZES, SPOT_STRIP_SIZES } from "./gridSizes";
import SaveSpotButton, { TILE, TILE_OFF, TILE_TEXT, TILE_ICON, TILE_MIN_H } from "./SaveSpotButton";
import SectionHead, { SectionTitle } from "./SectionHead";
import { CARD } from "./rowStyles";
import { CHIP_OFF, CHIP_SIZE, CHIP_HIT, CHIP_ROW } from "./chipStyles";
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
import { GLASS_BTN, GLASS_ICON_STYLE } from "./buttonStyles";

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
/**
 * 帯の絵を一度に読む枚数（格子の `GRID_INITIAL_VISIBLE`／`GRID_STEP` と同じ 60）。
 * `GalleryGrid` から読まないのは、試験が `GalleryGrid` ごと差し替えるため（数だけのために部品を読み込まない）
 */
const STRIP_INITIAL = 60;
const STRIP_STEP = 60;

/** 写真の無い撮影地の戻る・共有（見出しの下の素の行・40 の的・22 の絵） */
const TOP_PLAIN = "inline-flex items-center justify-center rounded-full text-white/85 hover:text-white hover:bg-white/10 transition-colors";
const TOP_PLAIN_STYLE = { width: "40px", height: "40px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as const;

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

    /**
     * **帯の絵は最初の 60 枚だけ読む**（`STRIP_INITIAL`・2026-10-31 束 2 の確かめ）。
     * リンク（`<a href="/photo/<id>">`）は全部の写真ぶん最初から出す——検索に載る頁の内部リンクを減らさない。
     * 絵の無い札が帯の右の端に近づいたら（帯の中で 800px 手前）、次の 60 枚の絵を読む。
     * 監視できない環境では全部読む（読まない方に倒すと、その環境では 61 枚目から絵が出ない）
     */
    const [stripShown, setStripShown] = React.useState(STRIP_INITIAL);
    const stripMoreRef = React.useRef<HTMLLIElement>(null);
    React.useEffect(() => {
        if (stripShown >= photos.length) return;
        if (typeof IntersectionObserver === "undefined") { setStripShown(photos.length); return; }
        const el = stripMoreRef.current;
        if (!el) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) setStripShown((v) => Math.min(v + STRIP_STEP, photos.length));
        }, { root: el.parentElement, rootMargin: "0px 800px" });
        io.observe(el);
        return () => io.disconnect();
    }, [stripShown, photos.length]);

    /** 戻る・共有・⋯ の行。`overPhoto` は代表写真の上（ガラスの丸）、そうでなければ見出しの下の素の行 */
    const topRow = (overPhoto: boolean) => (
        <div className={overPhoto
            ? "absolute top-3 inset-x-3 z-10 flex items-center justify-between gap-2 pointer-events-none"
            : "flex items-center justify-between gap-2 -mx-2 mb-1"}
             data-testid="spot-top-row">
            <Link
                href="/"
                prefetch={false}
                aria-label={en ? "Back to Gallery" : "ギャラリーに戻る"}
                className={overPhoto ? `pointer-events-auto ${GLASS_BTN}` : TOP_PLAIN}
                style={overPhoto ? { touchAction: "manipulation" } : TOP_PLAIN_STYLE}
            >
                <ArrowLeftIcon aria-hidden="true" style={overPhoto ? GLASS_ICON_STYLE : { width: "22px", height: "22px" }} />
            </Link>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => void handleShare()}
                    aria-label={en ? "Share" : "共有"}
                    className={overPhoto ? `pointer-events-auto ${GLASS_BTN}` : TOP_PLAIN}
                    style={overPhoto ? { touchAction: "manipulation" } : TOP_PLAIN_STYLE}
                >
                    <ShareIcon aria-hidden="true" style={overPhoto ? GLASS_ICON_STYLE : { width: "22px", height: "22px" }} />
                </button>
                {/* **⋯ は共通部品を使い回す**（`MoreMenu`。写真ページが既に使っている）。
                    中身は**この画面に本当にある操作だけ**——通報・ブロック・非表示は
                    「人」や「投稿」に対するもので、**場所には相手が居ない**ので置かない
                    （`MoreMenu` は `items` が空ならボタンごと出さない作り）。 */}
                <MoreMenu
                    className={overPhoto ? "pointer-events-auto" : ""}
                    buttonClassName={overPhoto ? GLASS_BTN : undefined}
                    buttonSize={overPhoto ? 44 : 40}
                    label={en ? "More" : "その他"}
                    items={[
                        { key: "copy", label: en ? "Copy link" : "リンクをコピー", onSelect: () => void handleCopyLink() },
                        { key: "x", label: en ? "Share on X" : "Xで共有", onSelect: () => shareToTwitter(canonicalUrl, shareText) },
                        ...(en ? [] : [{ key: "line", label: "LINEで共有", onSelect: () => shareToLine(canonicalUrl, shareText) }]),
                    ]}
                />
            </div>
        </div>
    );

    return (
        <main className={`mx-auto max-w-6xl px-4 ${hero ? "pt-0 sm:pt-6" : "pt-6"} pb-28`}>
            {/* ── ヘッダー行（モック①: 戻る・シェア・⋯）──────────────
                **全体ヘッダー（ロゴ・ハンバーガー）は layout のもの**なので、
                この行はその下に置く（重ねない）。寸法は `PhotoPageClient` の
                同じ行に揃えた——40px の的・22px の絵・px 直書き
                （以前は 640px 未満で root が 14px に落ちていた（2026-10-30 束 0a で外した）。台帳 `96eb86db`）。

                **戻るは `router.back()` にしない。** `/location/*` は検索の
                着地点なので、直接開かれた回の `back()` は**サイトの外**へ出る。
                写真ページが同じ理由で `<Link href="/">` にしている
                （`history.length` を見る書き方は `/users/search` と
                `/user/upload` に既に2つあり、3つ目を作らない）。 */}
            {!hero && topRow(false)}

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
                    aria-label={en ? "Featured photo" : "この撮影地の写真"}
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
                            比は iOS の `heroPager` と同じ 4:3（2026-10-31 束 2 L2。以前は 3:2） */}
                        <div
                            className="relative w-full overflow-hidden"
                            style={{
                                paddingTop: "75%",
                                backgroundColor: hero.dominantColor ?? "var(--color-surface)",
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

                    {topRow(true)}

                    {photos.length > 1 && (
                        <>
                            {/* 「N/M」（モックの「1/10」）。**送るたびに読み上げが
                                割り込むと邪魔**なので、バッジは `aria-hidden` にして
                                下の `aria-live` で伝える（写真ページと同じ形） */}
                            {/* iOS の数の札（黒55%・12 semibold・等幅の数字）。右上は戻る・共有・⋯ が在るので右下に置く */}
                            <p
                                className="absolute bottom-3 right-3 rounded-full bg-black/55 text-white font-semibold tabular-nums pointer-events-none"
                                style={{ fontSize: "12px", lineHeight: "14px", padding: "5px 10px" }}
                                aria-hidden="true"
                                data-testid="spot-hero-count"
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
                                className={`absolute left-2 top-1/2 -translate-y-1/2 ${GLASS_BTN}`}
                                style={{ touchAction: "manipulation" }}
                            >
                                <ChevronLeftIcon aria-hidden="true" style={GLASS_ICON_STYLE} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setShown((i) => (i + 1) % photos.length)}
                                aria-label={en ? "Next photo" : "次の写真"}
                                className={`absolute right-2 top-1/2 -translate-y-1/2 ${GLASS_BTN}`}
                                style={{ touchAction: "manipulation" }}
                            >
                                <ChevronRightIcon aria-hidden="true" style={GLASS_ICON_STYLE} />
                            </button>
                        </>
                    )}
                </section>
            )}

            {/* パンくず（iOS には無い。構造化データの道で「ホーム」への内部リンク）。12・text-3 で静かに（集約の頁と同じ） */}
            <nav aria-label="パンくずリスト" className="mb-2 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>
                <Link href="/" prefetch={false} className="hover:text-white">ホーム</Link>
                <span className="mx-1.5" aria-hidden>/</span>
                <span>{breadcrumb}</span>
            </nav>

            {/* 見出し（スポット名）。**`heading` はそのまま使う**
                （「◯◯の写真」という既存の文言。title・JSON-LD と同じ字） */}
            {/* 題は iOS の `JPFont.photoTitle`（明朝 32・2026-10-31 束 2 L3）。以前はゴシック 24 */}
            <h1 className="m-0 mb-1 font-serif font-bold text-white wrap-anywhere" style={{ fontSize: "32px", lineHeight: 1.25 }}>{heading}</h1>

            {/* ふりがな（モック③）。**書かれていなければ行ごと出さない。**
                読みを機械で当てに行かない——地名の読みは当てると外れる
                （「高屋」は たかや／こうや、「山中湖」は やまなかこ） */}
            {reading && <p data-testid="spot-reading" className="m-0 mb-1 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>{reading}</p>}

            {/* 所在地。**推測しない**——同じ一覧にある「この場所を含む撮影地」
                だけを出す（書かれている字から読み取れるぶん）。
                無ければ何も出さない（国名を当てに行かない）。

                **`/` 区切りの住所のようには描かない。** 一度そう描いていたが、
                この並びは**広い順であることを保証できない**——
                `photoIsInLocation` は名前として含むかの判定なので「パリ」と「フランス」は
                互いに含まず、どちらが広いかをこのデータは知らない。
                住所の形に描くと、知らない順序を主張することになる。 */}
            {broader.length > 0 && (
                // iOS の `placeLine`（印＋15・text-2、「・」で区切る）
                <p className="m-0 mt-1 mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-text-2" style={{ fontSize: "15px", lineHeight: "22px" }} data-testid="spot-place-line">
                    <MapPinIcon className="w-4 h-4 shrink-0 text-white/50" aria-hidden />
                    <span className="sr-only">{en ? "Part of" : "この撮影地を含む広い撮影地"}</span>
                    {broader.map((b, i) => (
                        <React.Fragment key={b.path}>
                            {i > 0 && <span aria-hidden="true">・</span>}
                            <Link
                                href={b.path}
                                prefetch={false}
                                className="hover:text-white underline underline-offset-4 decoration-white/20"
                            >
                                {b.label}
                            </Link>
                        </React.Fragment>
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
            {/* iOS の行動の札（`SpotDetailParts.actionLabel`: 同じ幅の札を 8 の隙間で・高さ 64・角 14・印 18 の下に 13 の字）。
                並びも iOS と同じ「行きたい・シェア・地図で見る」（2026-10-31 束 2 L4）。以前は丸い札が2つ（行きたい・撮影地マップを開く）。
                PC は本文の列の幅（36rem）で止める——撮影スポットの頁と同じ */}
            <div className={`mb-3 grid ${coords ? "grid-cols-3" : "grid-cols-2"} gap-2 max-w-xl`} data-testid="spot-actions">
                <SaveSpotButton slug={slug} name={name} locale={locale} variant="tile" />
                <button type="button" onClick={() => void handleShare()}
                        className={`${TILE} ${TILE_OFF} min-w-0`}
                        style={{ minHeight: TILE_MIN_H, touchAction: "manipulation" }}>
                    <ArrowUpOnSquareIcon className={TILE_ICON} aria-hidden />
                    <span className={TILE_TEXT}>{en ? "Share" : "シェア"}</span>
                </button>
                {coords && (
                    <Link
                        // **この場所に寄せて開く**（`#ズーム/緯度/経度`）。
                        // 受け取るのは `PhotoMap` の `chooseInitialView`
                        href={mapHref}
                        prefetch={false}
                        className={`${TILE} ${TILE_OFF} min-w-0`}
                        style={{ minHeight: TILE_MIN_H, touchAction: "manipulation" }}
                    >
                        <MapIcon className={TILE_ICON} aria-hidden />
                        <span className={TILE_TEXT}>{en ? "Map" : "地図で見る"}</span>
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
                        : "この撮影地の位置は、GPS ではなく地名から引いたおおよその位置です。")}
                </p>
            ) : (
                // **「地図に出せる位置を持っていない」と言い切る。**
                // 空の地図を出したり、地名から勝手に座標を当てたりしない
                <p className="mb-5 text-sm text-white/60">
                    {en
                        ? "No map position for this spot yet. Photos taken with GPS, or given a place from the edit screen, put it on the map."
                        : "この撮影地には、地図に出せる位置がまだありません。GPS 付きの写真を上げるか、編集画面で場所を選ぶと地図に載ります。"}
                    <Link href={mapHref} prefetch={false} className="ml-1 text-link hover:text-white underline underline-offset-4">
                        {en ? "Open the map" : "撮影地マップを開く"}
                    </Link>
                </p>
            )}

            {/* ── 概要（モック⑤）─────────────────────────────
                **人が書いたものだけ**（`content/spot-master.json`）。生成しない
                ——owner の指示で、`lib/utils/spot.ts` が「無い情報を作らない
                境界」と書いている通り。**書かれていなければ枠ごと出ない。** */}
            {summary && <p data-testid="spot-summary" className="m-0 mb-4 text-white/85 whitespace-pre-line" style={{ fontSize: "15px", lineHeight: "24px" }}>{summary}</p>}

            {/* **公式撮影地ガイドへ**（2026-09-30 のレビュー: 正式なスポットが確定している写真は、
                そのスポットへ自然に辿れるように）。出すのは写真が `spotId` を持つときだけ */}
            {guides.map((g, i) => (
                <div key={g.slug} className="mb-4" data-testid="spot-guide-link">
                    <SpotLinkCard spot={g} locale={locale} headingId={`location-guide-${i}`}
                                  heading={i > 0 ? null : (en ? "Photo spot guide for these photos" : "この撮影地の写真が紐付いている撮影スポット")} />
                </div>
            ))}

            {/* **その場所の説明**は、既にあるページ固有の文（`collectionCopy`）。
                ここで新しい紹介文を作らない。**1回だけ出す**——タブだった頃は
                概要と写真の両方に出ていたが、節にすると同じ文が2回並ぶ */}
            <p className="m-0 mb-5 text-text-2" style={{ fontSize: "15px", lineHeight: 1.6 }}>{description}</p>

            {/* ── 統計（モック⑦）─────────────────────────────
                出せるのは**数えられるものだけ**。「行きたい人数」は
                `spots#<uid>` に逆引きが無いので数えられず、評価は仕組みが
                無い——**枠ごと出さない**（`docs/spot-master.md` の3節） */}
            <dl className="grid grid-cols-3 gap-2 mb-6 max-w-xl" data-testid="spot-facts">
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
                    heading={en ? "Tags on these photos" : "この撮影地の写真に付いたタグ"}
                    items={facts.tags.map((t) => ({
                        key: t.slug, label: `#${t.label}`, count: t.count, path: collectionPath("tag", t.slug),
                    }))}
                />
            )}
            {narrower.length > 0 && (
                <Chips
                    heading={en ? "Spots within" : "中にある撮影地"}
                    items={narrower.map((n) => ({ key: n.path, label: n.label, count: n.count, path: n.path }))}
                />
            )}

            {/* ── この撮影地の写真 ───────────────────────────────
                2026-10-31 判断（束 2 L7）: **iOS の `SpotDetailView.spotPhotos` と同じ横に流す帯**（幅 118・3:4・角 12・隙間 8）。
                以前は「すべて見る」の行き先が自分自身になるのを避けて格子にしていたが、帯にも「すべて見る」は置かない
                （iOS も置かない）。**全部の写真を帯に並べる**ので、`<a href="/photo/<id>">` の内部リンクは減らない。
                押すとその場で拡大する（ヒーローと同じ）。先読みしない（ヒーローが LCP） */}
            <section aria-labelledby="spot-photos-heading" className="mt-8">
                <SectionHead id="spot-photos-heading" title={en ? `Photos here (${photos.length})` : `この撮影地の写真（${photos.length}）`} />
                <ul className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 m-0 p-0 snap-x" style={{ listStyle: "none" }} data-testid="spot-photo-strip">
                    {photos.map((p, i) => (
                        <li key={p.id} className="m-0 p-0 flex-shrink-0 snap-start" style={{ width: 118 }}
                            ref={i === stripShown ? stripMoreRef : undefined}>
                            <Link
                                href={ROUTES.PHOTO(p.id)}
                                prefetch={false}
                                data-photo-id={p.id}
                                onClick={(e) => {
                                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                                    if (openById(p.id)) e.preventDefault();
                                }}
                                className="relative block overflow-hidden rounded-field focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                                style={{ aspectRatio: "3 / 4", backgroundColor: p.dominantColor ?? "var(--color-surface)", touchAction: "manipulation" }}
                            >
                                {i < stripShown
                                    ? <Thumb photo={p} alt={photoAltText(p, locale)} sizes={SPOT_STRIP_SIZES} cellAspect={3 / 4} />
                                    // まだ絵を読まない札。リンクの名前だけ持たせる（読み上げ・検索のリンクは減らさない）
                                    : <span className="sr-only">{photoAltText(p, locale)}</span>}
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>

            {/* **写真が少ないページにだけ。** 既存の `CollectionPage` と同じ扱い（並びもタグの頁と同じ）。
                **ここも先読みしない。** ページの下の方に在る */}
            {nearbyPhotos.length > 0 && (
                <section aria-labelledby="spot-more-photos" className="mt-8">
                    <SectionHead id="spot-more-photos" title={en ? "You might also like" : "ほかにこんな写真も"} />
                    <GalleryGrid photos={nearbyPhotos} locale={locale} layout="editorial" sizes={EDITORIAL_PAIR_SIZES} heroSizes={EDITORIAL_HERO_SIZES} priorityCount={0} />
                </section>
            )}

            {/* ── 近くの撮影地（距離順）───────────────────────
                iOS の `SpotDetailParts.nearbyCard`（幅 180・写真 16:10・角 14・白8%の縁・名前 15 semibold・距離 12）を横に流す。
                呼び名は「近くの撮影地」（写真から導く場所＝撮影地。以前の「周辺のスポット」は呼び名の決まりに外れていた）。
                **評価も♡も出さない**——出せるのは**サムネ・名前・距離・枚数**の4つだけ */}
            {nearby.length > 0 && (
                <section aria-labelledby="spot-nearby-heading" className="mt-8">
                    <SectionHead id="spot-nearby-heading" title={en ? "Nearby places" : "近くの撮影地"} />
                    <ul className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-4 px-4 m-0 p-0 snap-x" style={{ listStyle: "none" }} data-testid="spot-nearby">
                        {nearby.map((n) => (
                            <li key={n.path} className="m-0 p-0 flex-shrink-0 snap-start" style={{ width: 180 }}>
                                <Link
                                    href={n.path}
                                    prefetch={false}
                                    className={`block h-full ${CARD} hover:bg-white/5 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
                                    style={{ borderRadius: 14, touchAction: "manipulation" }}
                                >
                                    {/* **絵が無ければ枠ごと出さない。** 代わりの絵を
                                        置くと「写真がある場所」のカードで、持って
                                        いない絵を見せることになる */}
                                    {n.cover && (
                                        <div
                                            className="relative w-full overflow-hidden"
                                            style={{ aspectRatio: "16 / 10", backgroundColor: n.cover.dominantColor ?? "var(--color-surface)" }}
                                        >
                                            <Thumb photo={n.cover} alt={photoAltText(n.cover, locale)} sizes={SPOT_NEARBY_SIZES} cellAspect={16 / 10} />
                                        </div>
                                    )}
                                    <div className="p-2.5">
                                        <p className="m-0 text-white font-semibold truncate" style={{ fontSize: "15px", lineHeight: "20px" }}>{n.label}</p>
                                        <p className="m-0 mt-0.5 text-white/60 tabular-nums truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>
                                            {/* **距離の粒度を偽らない。** 元の座標が約1kmに
                                                丸めてあるので、小数第1位までしか出さない。
                                                推定に基づくぶんは「約」を付ける */}
                                            {n.approx && (en ? "~" : "約")}{n.km < 10 ? n.km.toFixed(1) : Math.round(n.km)}km
                                            <span aria-hidden> · </span>
                                            {en ? `${n.count} photo${n.count === 1 ? "" : "s"}` : `${n.count}枚`}
                                        </p>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* 同タイプの他ページへの相互リンク（孤立防止・SEO）。押せるチップ（`chipStyles`） */}
            {related.length > 0 && (
                <section aria-labelledby="spot-related-heading" className="mt-8">
                    <SectionHead id="spot-related-heading" title={en ? "More locations" : "他の撮影地"} />
                    <ul className={CHIP_ROW}>
                        {related.map((r) => (
                            // **先読みしない**（一覧で何本も出るリンク。理由は
                            // `GalleryGrid` のカードのコメント）
                            <li key={r.path} className="m-0 p-0">
                                <Link
                                    href={r.path}
                                    prefetch={false}
                                    className={`${CHIP_HIT} inline-flex items-center gap-1.5 rounded-full transition-colors ${CHIP_OFF}`}
                                    style={{ ...CHIP_SIZE, touchAction: "manipulation" }}
                                >
                                    {r.label}
                                    <span className="text-white/60 tabular-nums" style={{ fontSize: "12px" }}>{r.count}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
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
// iOS の `SpotDetailParts.statPill`（札の面・値 17 semibold を上・名前 12 を下・中央寄せ・2026-10-31 束 2 L5）。
// 以前は名前が上・値 14 の左寄せの札
function Fact({ label, value }: { label: string; value: string | null }) {
    return (
        <div className={`${CARD} flex flex-col-reverse items-center justify-center gap-0.5 px-2 py-3 text-center`}>
            <dt className="text-white/60" style={{ fontSize: "12px", lineHeight: "16px" }}>{label}</dt>
            <dd className="m-0 text-white font-semibold tabular-nums wrap-anywhere" style={{ fontSize: "17px", lineHeight: "22px" }}>{value ?? <span className="text-white/60">—</span>}</dd>
        </div>
    );
}

// 押せるチップの並び（`chipStyles`・2026-10-31 束 2 L6）。見出しは札の上の静かな型（`SectionTitle`）。
// 以前は 12 の字・当たり 24 の小さなチップだった
function Chips({ heading, items }: { heading: string; items: Array<{ key: string; label: string; count: number; path: string }> }) {
    return (
        <section className="mt-5">
            <SectionTitle>{heading}</SectionTitle>
            <ul className={CHIP_ROW}>
                {items.map((i) => (
                    <li key={i.key} className="m-0 p-0">
                        <Link
                            href={i.path}
                            prefetch={false}
                            className={`${CHIP_HIT} inline-flex items-center gap-1.5 rounded-full transition-colors ${CHIP_OFF}`}
                            style={{ ...CHIP_SIZE, touchAction: "manipulation" }}
                        >
                            {i.label}
                            <span className="text-white/60 tabular-nums" style={{ fontSize: "12px" }}>{i.count}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
