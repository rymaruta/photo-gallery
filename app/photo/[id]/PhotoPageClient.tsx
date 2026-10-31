"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { DISPLAY_MINCHO_STACK } from "@/lib/utils/headingFont";

/**
 * カテゴリ・タグのチップ。**板（`PhotoDetail.dc.html`）の寸法**
 * ——高さ32px・字12px・角丸999・白5%地・1px白10%枠。
 *
 * 🔴 **同じ行に2種類の綴りが並んでいた。** カテゴリとタグは見た目が同じ
 * チップなのに className を別々に書いていたので、片方だけ直したら
 * **大小のチップが1行に混ざった**（直す前より悪い）。1か所に置いて両方から使う。
 *
 * 🔴 **直す前は高さ 17.5px・字 10.5px** だった——`py-0.5` と `text-xs` が
 * 640px 未満（当時の root 14px）で縮んでいたため。指で押す的としても、読む字としても
 * 小さすぎた。**px で書く。**
 */
// 2026-10-30 束 0b C5: 以前は 32・12 の小さいタグ。iOS のチップ（34・13・当たり 44）にそろえる
const CHIP_CLASS = `${CHIP_HIT} inline-flex items-center rounded-full ${CHIP_OFF} transition-colors`;
import { HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline } from "@heroicons/react/24/outline";
import { ChatBubbleOvalLeftIcon, ArrowUpOnSquareIcon, BookmarkIcon, BookOpenIcon } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolidIcon } from "@heroicons/react/24/solid";
import { usePhotoSave } from "../../../lib/hooks/usePhotoSave";
import { useSwipe } from "../../../lib/hooks/useSwipe";
import { formatPhotoStamp } from "../../../lib/utils/photoDate";
import { FollowAction } from "../../components/FollowButton";
import UserAvatar from "../../components/UserAvatar";
import MoreMenu from "../../components/MoreMenu";
import type { Photo } from "@/lib/data/photos";
import { getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "@/lib/data/photos";
import { usePhotoLikes } from "../../../lib/hooks/usePhotoLikes";
import { hapticTap } from "../../../lib/utils/haptics";
import { photoAltText, relatedPhotoAlt } from "../../../lib/utils/photoAlt";
import { photoOwnTitle, fallbackPhotoTitle, photoTitleFor } from "../../../lib/utils/photoTitle";
import { dropCachedPhoto } from "../../../lib/utils/photoCache";
import { parseMusicEmbed, isYouTubeMvUrl } from "../../../lib/utils/music";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { type SongEntry } from "../../music/MusicContext";
import MusicCard from "../../components/MusicCard";
import SongArtwork from "../../components/SongArtwork";
import { MusicalNoteIcon, XMarkIcon, MapPinIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import ReportDialog from "../../components/ReportDialog";
import { useToast } from "../../../lib/hooks/useToast";
import { shareUrl, copyToClipboard, shareToTwitter, shareToLine } from "../../../lib/utils/share";
import { siteConfig, generatePhotoStructuredData, generateBreadcrumbStructuredData } from "../../../lib/utils/seo";
import { slugify, collectionPath, categoryLabel } from "../../../lib/utils/collections";
import RelatedPhotos from "../../components/RelatedPhotos";
import CommentSection from "../../components/CommentSection";
import { relatedSections, adjacentPhotos, nearbyPhotos } from "../../../lib/utils/related";
import Thumb from "../../components/Thumb";
import { ROUTES } from "../../../lib/routes";
import { formatMapHash, PHOTO_LINK_ZOOM } from "../../../lib/utils/mapView";
import { formatCameraName, dedupeCameraName } from "../../../lib/utils/cameraName";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { isImageReady } from "../../../lib/utils/imageReady";
import { ExifRow, buildExifSpecs } from "../../components/ExifSpecs";
import { exifSettingsLine, exifSettingsCells } from "../../../lib/utils/exifDisplay";
import { isImeKey } from "../../../lib/utils/ime";
import { useSongSearch } from "../../../lib/hooks/useSongSearch";
import { usablePhotoRows } from "../../../lib/utils/apiRows";
import { sessionErrorMessage } from "../../../lib/utils/api";
import { publicImageUrl } from "@/lib/utils/seo";
import SongSearchError from "../../components/SongSearchError";
import SpotRows, { type SpotRow } from "../../components/SpotRows";
import InspiredByLine from "../../components/InspiredByLine";
import { inspiredSourceFor, type InspiredLink } from "@/lib/utils/inspired";
import type { SpotLink } from "@/lib/data/spotLink";
import { CHIP_OFF, CHIP_SIZE, CHIP_HIT } from "@/app/components/chipStyles";
import PhotoTripSection from "./PhotoTripSection";
import { LoadingState, ErrorState } from "@/app/components/StateViews";
// **全画面は押したときに読む**（写真ページの最初の JS に載せない。検索の着地点で、
// 押さずに去る人が大半）。静的書き出しでは描かないので ssr: false
const PhotoViewer = dynamic(() => import("./PhotoViewer"), { ssr: false });
import { photoLightZone, directionsTarget, offersInspiredShoot } from "@/lib/utils/photoTrip";
import { MoreLink } from "@/app/components/SectionHead";
import { ROW_TALL, CARD, ROW_TITLE, ROW_SUB, ROW_CHEVRON } from "@/app/components/rowStyles";
import { GLASS_BTN, GLASS_ICON_STYLE } from "@/app/components/buttonStyles";

/** 写真を押した／引いたの境目（px）。これより動いたら「送った」で、全画面は開かない */
const HERO_TAP_SLOP = 10;

/**
 * 写真ページの戻る・「…」。**スマホは写真の上のガラスの丸**（共通の `GLASS_BTN`・44・黒55%＋ぼかし 18＋白10%の縁）、
 * PC は2カラムの上の行に素の白で（今までの見た目）。
 * 2026-10-31 判断（束 1 P1）: 共有の丸は外し、「…」の中と写真の下の操作の段へ（iOS は戻る・「…」の2つだけ）
 */
const TOP_BUTTON = `pointer-events-auto ${GLASS_BTN} lg:bg-transparent lg:backdrop-blur-none lg:ring-0 lg:text-white/85 lg:hover:text-white lg:hover:bg-white/10`;

/**
 * **写真の上の道しるべの行**（iOS の `placeRow`・`spotGuideRow`・束 1 P2）。写真の上なので白だけ・12・
 * 白60%の下線・影。当たりは 44（行の当たりどうしは重ねない）
 */
// 2026-10-31 束 1 の確かめの直し: 負の余白（-my-2）で2行の当たりが上下 8px ずつ重なっていたのを外した（行は 44 ずつ並ぶ）
const FOOT_ROW = "flex items-center gap-1.5 min-w-0 max-w-full text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white rounded-sm";
const FOOT_ROW_STYLE = { fontSize: "12px", lineHeight: "16px", minHeight: "44px", textShadow: "0 1px 3px rgb(0 0 0 / 0.6)", touchAction: "manipulation" } as const;
/** 前後の写真の札（二行の行 64 を1つずつ札にしたもの・C11） */
const ROW_CARD_TALL = `${ROW_TALL} ${CARD}`;
const FOOT_UNDERLINE = "truncate underline decoration-white/60 underline-offset-2";

/**
 * **操作の段の1つ**（iOS の `actionLabel`・束 1 P6）: 白い線の細い印 24（線 1.25＝iOS の `.title2` light）、
 * 数は 15 の等幅の数字・白。当たり 44（左右 6）。保存も白（以前は真鍮）——iOS は4つとも白
 */
const ACTION_BTN = "inline-flex items-center gap-[5px] px-1.5 text-white hover:text-white/80 transition-colors disabled:opacity-60 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded-md";
const ACTION_BTN_STYLE = { minHeight: "44px", minWidth: "44px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as const;
const ACTION_ICON_STYLE = { width: 24, height: 24, strokeWidth: 1.25 } as const;
const ACTION_COUNT_STYLE = { fontSize: "15px", lineHeight: "20px" } as const;

// EXIF情報の型定義
type ExtractedExif = {
    Make?: string;
    Model?: string;
    LensModel?: string;
    FNumber?: number;
    ExposureTime?: number;
    ISO?: number;
    FocalLength?: number;
    WhiteBalance?: number;
    DateTimeOriginal?: string;
    ImageWidth?: number;
    ImageHeight?: number;
    Orientation?: number;
};

const EXIF_PICK = [
    "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO",
    "FocalLength", "WhiteBalance", "DateTimeOriginal", "ImageWidth", "ImageHeight", "Orientation",
];

/** データ側 exif に表示可能な情報が既にあるか（あればクライアント再抽出は不要） */
function hasStoredExif(exif?: Photo["exif"]): boolean {
    return !!exif && Object.values(exif).some((v) => v !== undefined && v !== null && v !== "");
}


/**
 * この描画が「ハイドレーション」（静的HTMLに React を付けている）かどうか。
 * サーバー側の値（false）はハイドレーションの最初の描画でだけ使われ、
 * クライアント遷移で新しく作られた部品は最初から true。
 * **ハイドレーション由来の `<img>` は隠さない**——Chromium は JPEG/WebP を
 * 届いた行まで逐次描くので、途中まで見えている写真を React が付いた瞬間に
 * `opacity-0` にすると「見えた → 消える → 出る」になる。ブラウザに任せ、
 * 届いたら（onLoad）ぼかしを外すだけ。フェードで出すのは、クライアント遷移で
 * 新しく作った `<img>`（作った瞬間に隠すので何も描かれていない）だけ
 */
const subscribeNoop = () => () => {};
function useHydratedFromHtml(): boolean {
    const clientRender = useSyncExternalStore(subscribeNoop, () => true, () => false);
    // 最初の描画の値だけを覚える（あとで true に変わっても、この部品が
    // 静的HTML由来であることは変わらない）。初期化関数は最初の描画でしか走らない
    const [fromHtml] = useState(() => !clientRender);
    return fromHtml;
}

// 画像コンポーネント（エラーハンドリング付き、EXIF読み取り機能付き）
function PhotoImage({
    src,
    alt,
    focalPoint,
    blurDataURL,
    srcAvif,
    width,
    height,
    extractExif = false,
    onExifLoaded,
    onImageError,
}: {
    src: string;
    alt: string;
    focalPoint?: { x: number; y: number };
    blurDataURL?: string;
    srcAvif?: string;
    // 実寸（`generate-thumbnails.js` が書く）。**無ければ何も名乗らない**
    width?: number;
    height?: number;
    // データ側 exif が無い写真だけ true。画像から EXIF をクライアント抽出する
    extractExif?: boolean;
    onExifLoaded?: (exif: ExtractedExif | null) => void;
    /** 読み込めなかった（呼ぶ側は全画面を開かない） */
    onImageError?: () => void;
}) {
    const [imageError, setImageError] = useState(false);
    // 失敗の知らせは ref 越しに呼ぶ（下の `attach` を描くたびに作り直さない）
    const onImageErrorRef = useRef(onImageError);
    useEffect(() => { onImageErrorRef.current = onImageError; }, [onImageError]);
    // **ハイドレーションまでは隠さない**（`Thumb` と同じ理由。この画面は検索の
    // 着地点なので、JS を待ってから写真を出すのは LCP をそのぶん遅らせる）。
    // "unknown" = React がまだ付いていない（静的HTMLのまま）。ref で決める。
    // 静的HTML由来の `<img>` は届いていなくても隠さない（途中まで描かれて
    // いるかもしれない。`useHydratedFromHtml` を参照）
    const [phase, setPhase] = useState<"unknown" | "pending" | "loaded">("unknown");
    const imageLoading = phase !== "loaded";
    const fromHtml = useHydratedFromHtml();
    // ref は `useCallback` で固定（`Thumb` と同じ理由）
    const attach = useCallback((img: HTMLImageElement | null) => {
        if (!img) return;
        // React より先に失敗が終わっていた画像（`Thumb` と同じ）
        if (img.complete && img.naturalWidth === 0) {
            // 控えも捨てる（`Thumb` と同じ。この画面は検索の着地点で、
            // 本体は静的HTML由来＝失敗は React より先に終わっている）
            setImageError(true);
            setPhase("loaded");
            onImageErrorRef.current?.();
            void dropCachedPhoto(img.currentSrc || img.src);
            return;
        }
        if (isImageReady(img)) setPhase("loaded");
        else if (!fromHtml) setPhase("pending");
    }, [fromHtml]);

    // データ側 exif が欠けている写真のみ、画像読み込み後に EXIF をクライアント抽出する。
    // exifr は重いので初期バンドルに含めず、必要時だけ動的 import する。
    //
    // 🔴 **取りに行く先も `publicImageUrl` を通す。**
    // 下の `<picture>` は通しているのに、ここだけ生の `src` を使っていた。
    // 保存されている値は CloudFront の既定ドメイン（api-user の
    // `canonicalUploadUrl` が `CLOUDFRONT_URL` を土台にする）なので、
    // **同じ1枚に対して2つのホストへ要求が飛ぶ**——
    //
    //   - `<img>`      → サイトのドメイン（同一オリジン）
    //   - EXIF の抽出  → CloudFront の既定ドメイン（別オリジン）
    //
    // 別オリジンなので **CORS が要る**。返ってこなければ `exifr.parse` も
    // 控えの `fetch` も投げ、**撮影情報の欄が黙って出ない**（例外は握るので
    // 画面には何も出ない＝気づけない）。同一オリジンにすれば CORS は要らず、
    // Service Worker の写真の控え（`journey-photo-img-v1`）にも当たる。
    // `CLAUDE.md` の「実際に飛ぶ要求は同一オリジンだけ」とも、ここだけ食い違っていた。
    //
    // 実データ（`app/data/photos.json` の30枚）では **3枚が
    // 「exif 無し ＋ 既定ドメイン」**＝この経路に入る。
    useEffect(() => {
        if (!extractExif) return;              // 既に photo.exif がある場合は再ダウンロード/解析しない
        if (imageLoading || imageError) return;

        let cancelled = false;
        const loadExif = async () => {
            try {
                const { default: exifr } = await import("exifr"); // 遅延ロード
                const opts = { pick: EXIF_PICK, translateKeys: false } as const;
                let exif: ExtractedExif | null = null;
                // **`<img>` が実際に取った1枚と同じ URL**（同一オリジンに揃う）
                const from = publicImageUrl(src);

                if (from.startsWith("http://") || from.startsWith("https://")) {
                    // まず URL を直接試し（CORS が正しければ動作）、ダメなら fetch → blob で再試行
                    try {
                        exif = await exifr.parse(from, opts);
                    } catch {
                        try {
                            const response = await fetch(from, { mode: "cors", credentials: "omit" });
                            if (response.ok) exif = await exifr.parse(await response.blob(), opts);
                        } catch (fetchError) {
                            log.warn("Failed to fetch image for EXIF:", fetchError);
                        }
                    }
                } else {
                    // ローカルパス（/images/ 等）は URL を直接使用
                    exif = await exifr.parse(from, opts);
                }

                if (!cancelled) onExifLoaded?.(exif || null);
            } catch (error) {
                // 失敗時は null（photo.exif をフォールバックとして使用）
                log.warn("Failed to read EXIF data from image:", error);
                if (!cancelled) onExifLoaded?.(null);
            }
        };

        loadExif();
        return () => { cancelled = true; };
    }, [extractExif, imageLoading, imageError, src, onExifLoaded]);

    if (imageError) {
        return (
            <div className="flex items-center justify-center bg-black min-h-[400px] rounded-lg">
                <div className="text-white/60 text-center px-4">
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">画像を読み込めません</p>
                </div>
            </div>
        );
    }

    // **枠の高さの予約は、実寸が分からないときだけ。** 実寸があれば `<img>` の
    // 幅・高さ属性で比率ぶんの高さが先に確保される（CLS 0）。そこへ
    // `min-height: 400px` を重ねると、幅の狭い画面では写真より箱が高くなり
    // 上下が黒帯になる（Chromium 実測・390px: 3:2 の写真が 362x241、箱 400px
    // → 上下 79px ずつ黒。768px では 0）。検索から着地する画面の一番上がこれだった
    const reserve = width && height ? undefined : "400px";
    return (
        <div className="relative w-full bg-black overflow-hidden" style={{ minHeight: reserve, position: "relative" }}>
            {/* blur-up: ぼかしプレビューを背景に即表示。本画像がロードされるとフェードで重なる */}
            {blurDataURL && imageLoading && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={blurDataURL}
                    alt=""
                    aria-hidden={true}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ filter: "blur(24px)", transform: "scale(1.1)" }}
                />
            )}
            {/* 回転は「まだ」と分かってから。分からないうちに黒で覆うと、
                届いている写真まで隠す */}
            {phase === "pending" && !blurDataURL && (
                // 2026-10-30 束 0b C17: 回る輪ではなく iOS の骨組みの灰（surface-4 #1C1C1E）。光は流さない
                <div aria-hidden="true" className="absolute inset-0 bg-surface-4 z-10" data-testid="photo-skeleton" />
            )}
            <div className="relative w-full" style={{ minHeight: reserve, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* AVIF があれば優先（詳細=LCP を軽く）、無ければ従来 src(WebP) にフォールバック。
                    **出すURLはここで揃える**（`publicImageUrl`）——保存されている値は
                    CloudFront の既定ドメインで書かれる（api-user の `canonicalUploadUrl` が
                    `CLOUDFRONT_URL` を土台にする）ので、そのまま描くとサイトのドメインと
                    2つのホストに割れる。**呼ぶ側ではなく部品の中で揃える**——ここは
                    検索の着地点の LCP で、AVIF を出す端末が実際に取りに行くのは
                    `<source>` の方。呼ぶ側で `src` だけ包んでいた間、AVIF は生のままだった。
                    ⚠️ **手元のビルドでは確かめられない**——コミットしてある
                    `app/data/photos.json` は古い断面で、30枚すべて派生
                    （`srcAvif`・`thumbSrc` …）を持たないので `<source>` が1つも出ない。
                    本番に派生が揃っていることは 2026-09-05 の `diagnose-image-perf`
                    の実測（公開32枚すべてにサムネ・AVIF3種）による */}
                <picture className="w-full flex items-center justify-center">
                    {srcAvif && <source type="image/avif" srcSet={publicImageUrl(srcAvif)} />}
                    <img
                        src={publicImageUrl(src)}
                        alt={alt}
                        // **実寸が分かるときだけ名乗る。** 以前は全写真が
                        // `1200x800`（3:2）を名乗っていたので、縦位置の写真は
                        // 読み込み後に高さが伸びて下の情報がガタつく。
                        //
                        // Chromium 実測（390x844・画像を500ms遅延・この関数の
                        // 入れ子を素の CSS で再現して layout-shift を読む）:
                        //
                        //                    旧1200x800  属性なし  実寸
                        //   縦 1000x1500        0.188     0.073   0.000
                        //   横 3000x2000        0.000     0.000   0.000
                        //   正方 1000x1000      0.036     0.000   0.000
                        //   超縦長 1000x2500    0.315     0.108   0.000
                        //
                        // **数値は測り方（画面幅・遅延・入れ物の再現度）で動く**
                        // ——外側の `min-height:400px` を落とすと符号ごと変わる。
                        // 動かないのは並び順の方で、どの形でも
                        // 「属性なし ≤ 旧」「実寸は 0」。
                        //
                        // 同じ「1200x800 の嘘」は OGP 側では既に直してある
                        // （`usersMetadata.test.ts`「実寸を知らないのに
                        // 1200x800 を名乗っている」）のに、`<img>` に残っていた。
                        // **本番の写真は全部 実寸を持っている**（2026-09-05 に
                        // `maintenance` の `image-perf` で実測: 公開32枚すべてに
                        // 幅・高さ・サムネ・AVIF・ぼかし・下地色が揃っている）。
                        // ＝この画面の CLS は実測で 0 になる枝に入る。
                        // 一度「実寸を持つ写真はまだ少ない（`photos.json` 30枚で
                        // 0件）」と書いたが、**あれはコミット済みの古い断面**で、
                        // 本番の DynamoDB とは別物だった。それでも門を残すのは、
                        // `generate-thumbnails.js` が失敗した写真・入れ直した写真は
                        // 一時的に持たないため（`deploy.yml` は `continue-on-error`）。
                        // **無いときは属性ごと出さない**
                        {...(width && height ? { width, height } : {})}
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                        fetchPriority="high"
                        decoding="async"
                        className={`w-full h-auto object-contain max-h-[80vh] select-none transition-opacity duration-500 ${phase === "pending" ? "opacity-0" : "opacity-100"}`}
                        style={{
                            WebkitTouchCallout: "none",
                            ...(focalPoint ? { objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%` } : {}),
                        }}
                        onError={(e) => {
                            setImageError(true);
                            setPhase("loaded");
                            onImageErrorRef.current?.();
                            void dropCachedPhoto(e.currentTarget.currentSrc || e.currentTarget.src);
                        }}
                        onLoad={() => setPhase("loaded")}
                        // React が付いた時点で「もう届いている／まだ」を決める
                        // （キャッシュ済みで load を取り逃す件も含む。imageReady.ts 参照）
                        ref={attach}
                    />
                </picture>
            </div>
        </div>
    );
}

type RelatedSets = { author: Photo[]; location: Photo[]; prev: Photo | null; next: Photo | null; nearby: Photo[] };

type PhotoPageClientProps = {
    photoId: string;
    initialPhoto?: Photo;
    // ビルド時にサーバで計算した回遊リンク。クライアント取得完了までのSSR/初期表示に使う
    initialRelated?: RelatedSets;
    /**
     * この写真が指す公式スポット（**サーバー側で解いたもの**）。
     *
     * 🔴 **画面から台帳を読まない。** `content/spots.json` を
     * `"use client"` のファイルが import すると、全文が写真ページ30枚の
     * チャンクに載る（実測）。解くのは `lib/data/spotLink.ts`。
     */
    spotLink?: SpotLink | null;
    /**
     * 近くの撮影スポット（`nearbySpotsForPhoto`・サーバーで解いた名前・地域・slug だけ。距離は持たない）。
     * 2026-10-22: 写真ページから撮影地ガイドへの道
     */
    nearbySpots?: SpotRow[];
    /**
     * 「この写真を見て撮影」の元の写真（**ビルド時に公開の一覧から解いたもの**）。
     * クライアントの取得が済むまではこれを出し、済んだら取得した一覧で解き直す
     * （そのあいだに非公開・削除になった元の写真は消える）。
     */
    initialInspired?: InspiredLink | null;
    /**
     * 写真が指すスポットの時刻帯（**サーバー側で解いたもの**・`spotTimeZoneForPhoto`）。
     * 「次のゴールデンアワー」をその土地の時計で言う。無ければ出さない（写真の座標から推測しない・`photoLightZone`）
     */
    spotTimeZone?: string | null;
};

export default function PhotoPageClient({ photoId, initialPhoto, initialRelated, spotLink, initialInspired, spotTimeZone, nearbySpots = [] }: PhotoPageClientProps) {
    const { locale, labels } = useLocale();
    const [extractedExif, setExtractedExif] = useState<ExtractedExif | null>(null);

    const [allPhotos, setAllPhotos] = useState<Photo[]>(initialPhoto ? [initialPhoto] : []);
    const [loading, setLoading] = useState(!initialPhoto);
    // API の取得に失敗したか。静的データに無い新着写真の URL では、失敗を
    // 黙ると「写真が見つかりません」＝消されたように読める表示に化ける。
    // 見つからない × 失敗、のときだけ再試行を出す（下の 404 分岐）。
    const [fetchFailed, setFetchFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    // 公開の一覧を API から受け取ったか（「この写真を見て撮影」をどちらで解くか）
    const [listFetched, setListFetched] = useState(false);

    // APIから写真を読み込む（編集済みのデータで静的ビルド時データを上書き）
    useEffect(() => {
        const controller = new AbortController();
        const loadPhotos = async () => {
            try {
                const { publicFetch } = await import("../../../lib/utils/api");
                const response = await publicFetch("/photos", { signal: controller.signal });
                if (response.ok) {
                    // **読めない行は落としてから入れる。** ここは
                    // `relatedSections` / `adjacentPhotos` / `find(p => p.id)` に
                    // そのまま渡るので、1件の `null` でページ全体が
                    // `ErrorBoundary` のカードになる（`usePhotos` と同じ
                    // エンドポイント・同じ壊れ方）
                    const data = usablePhotoRows<Photo>(await response.json(), "GET /photos") ?? [];
                    // 空配列で静的ビルド時のデータを潰さない。潰すと、いま表示できて
                    // いる写真が「写真が見つかりません」に化ける（usePhotos.ts にも
                    // 同じガードがある）。
                    if (data.length > 0) {
                        setAllPhotos(data);
                        setListFetched(true);
                        setFetchFailed(false);
                    } else {
                        log.warn("写真APIが空を返したため静的データを維持します");
                        // 隣のガードが「空応答は怪しい」と扱っているのに、
                        // ここだけ「正」と扱うと、静的未収録の新着写真URL ×
                        // 怪しい空200 で「存在しません」と断定してしまう
                        setFetchFailed(true);
                    }
                } else {
                    log.error("写真の取得に失敗しました", { status: response.status });
                    setFetchFailed(true);
                }
            } catch (error) {
                if ((error as { name?: string }).name !== "AbortError") {
                    log.error("写真取得エラー:", error);
                    setFetchFailed(true);
                }
            } finally {
                setLoading(false);
            }
        };

        loadPhotos();
        return () => controller.abort();
    }, [reloadKey]);

    // 全写真から該当する写真を検索
    const photo = useMemo(() => {
        return allPhotos.find(p => p.id === photoId);
    }, [photoId, allPhotos]);

    /**
     * 「この写真を見て撮影」の元の写真。**追加の読み取りはしない。**
     *
     * **出してよいかを決めるのはビルド時のもの（`initialInspired`）だけ。** 静的な
     * `photos.json` は sync が「元の写真が公開の一覧に居ない」「付けた人と元の作者が
     * どちら向きでもブロックの関係」を落としてある（`scripts/sync-photos-from-ddb.js` の
     * `pruneInspiredBy`）。API の `GET /photos` はブロックを見られないので、
     * **API の一覧だけで行を出す（復活させる）ことはしない**——減らす側にだけ使う:
     * 取得した一覧で写真の `inspiredBy` が外れた・元の写真が居なくなったら消す。
     * 取得に失敗したら、ビルド時のものを出し続ける（写真そのものも静的データのまま）
     */
    const inspired = useMemo<InspiredLink | null>(() => {
        if (!photo?.inspiredBy || !initialInspired || initialInspired.id !== photo.inspiredBy) return null;
        if (!listFetched) return initialInspired;
        return inspiredSourceFor(photo, allPhotos) ? initialInspired : null;
    }, [photo, allPhotos, listFetched, initialInspired]);

    /**
     * 1投稿に複数枚（owner のモックの「1/10」）。**表紙は `src`**、
     * 2枚目以降が `extraImages`。
     *
     * **`shown` の初期値は 0 で固定する。** 静的書き出しなので、ここを
     * URL やストレージから決めると水和で食い違う（サーバーが描いた木と
     * 変わる）。この画面は検索の着地点で、1枚目が LCP そのもの。
     *
     * **`photo` はまだ届いていないことがある**（クライアント取得の前）ので
     * `?.` で読む。届く前は1枚も無い＝送る仕組みも出ない。
     */
    const images = useMemo(() => {
        if (!photo?.src) return [];
        return [
            {
                src: photo.src, srcAvif: photo.srcAvif, blurDataURL: photo.blurDataURL,
                width: photo.width, height: photo.height,
            },
            // **壊れた要素は落とす**（本番のデータは何でもありうる。ここで
            // 落ちると写真ページが丸ごとエラーカードになる）
            ...(photo.extraImages ?? []).filter((i) => typeof i?.src === "string" && !!i.src),
        ];
    }, [photo?.src, photo?.srcAvif, photo?.blurDataURL, photo?.width, photo?.height, photo?.extraImages]);
    const [shown, setShown] = useState(0);
    /** 写真を全画面で見ている（`PhotoViewer`）。開いている間の送りは `shown` を共有する */
    const [viewerOpen, setViewerOpen] = useState(false);
    /** 写真を包むボタン（全画面を閉じたらここへフォーカスを戻す） */
    const heroButtonRef = React.useRef<HTMLButtonElement>(null);
    /** 読み込めなかった写真の src（押しても全画面を開かない。開いても同じく読めない） */
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    /** 写真の上で指・マウスを置いた所（引いて送った後の click で全画面を開かない） */
    const heroPressRef = React.useRef<{ x: number; y: number } | null>(null);
    /**
     * いま出す1枚。**枚数が減っても落ちない**ように挟む（写真を差し替えた直後など）。
     *
     * **`images` が空のまま描画に届くことは無い**——`photo` が無い回は
     * 622行の早期 return（「写真が見つかりません」）で抜けるので、
     * ここから下では必ず1枚以上ある。`photo` の有無で分かれる判定を
     * 増やさないために、その事実に頼る。
     */
    const current = images[Math.min(shown, Math.max(0, images.length - 1))];

    // いいね機能（ハート＝ローカルお気に入り + サーバーいいね数）
    const { isAuthenticated, userId: authUserId, loading: authLoading } = useAuth();
    const { liked: isFav, count: likeCount, pending: likePending, toggle: toggleLike } =
        usePhotoLikes(photoId, photo?.likes ?? 0, isAuthenticated, authLoading);


    // 写真BGM: オーナーが1曲添えられる（全員が写真ページで再生できる）
    const isOwnPhoto = isAuthenticated && !!authUserId && photo?.userId === authUserId;
    // **通報。** 自分の投稿と未ログインには出さない（押しても断られる）
    const [reportOpen, setReportOpen] = useState(false);
    const reportBtnRef = React.useRef<HTMLButtonElement>(null);
    const { showToast } = useToast();
    // 最終版モックの並び: コメント／関連写真のタブ・コメント数・保存・ヒーローのスワイプ
    const [commentCount, setCommentCount] = useState<number>(typeof photo?.commentCount === "number" ? photo.commentCount : 0);
    // 吹き出しを押したら送る先（コメントの節）。2026-10-31 束 1 P11: コメントと関連写真のタブをやめ、縦に節で並べた
    const commentsRef = React.useRef<HTMLElement>(null);
    const { saved, pending: savePending, toggle: toggleSave } = usePhotoSave(photo?.id ?? "", isAuthenticated, authLoading);
    const handleSave = useCallback(() => {
        hapticTap();
        void toggleSave().then((r) => {
            if (r.ok) return;
            // **未ログインは「失敗」ではなく案内**（モーダル・ホームのカードと同じ文言）
            if (r.requiresAuth) {
                showToast(locale === "en" ? "Log in to save photos." : "写真を保存するにはログインしてください", "error");
                return;
            }
            showToast(r.message ?? (locale === "en" ? "Couldn't save this photo. Please try again." : "保存できませんでした。もう一度お試しください"), "error");
        });
    }, [toggleSave, showToast, locale]);
    // いいねを切り替える（下の ♡ と全画面の ♡・2回叩きが同じ口を通る）
    const handleLike = useCallback(() => {
        hapticTap();
        void toggleLike().then((r) => {
            // 押し直しても直らない失敗（セッション切れ・通信できない）は
            // その文言をそのまま出す
            if (!r.ok) showToast(r.message ?? (locale === "en"
                ? "Couldn't save your like. Please try again."
                : "いいねを保存できませんでした。もう一度お試しください"), "error");
        });
    }, [toggleLike, showToast, locale]);
    const { handlers: swipeHandlers } = useSwipe({
        onSwipeLeft: () => setShown((i) => (i + 1) % Math.max(1, images.length)),
        onSwipeRight: () => setShown((i) => (i - 1 + images.length) % Math.max(1, images.length)),
    });
    const [photoSong, setPhotoSong] = useState<SongEntry | null>(null);
    useEffect(() => { setPhotoSong((photo?.song as SongEntry | undefined) ?? null); }, [photo?.id, photo?.song]);

    // フル再生MV（YouTube リンク）。30秒プレビューとは別枠で共存
    const [photoYtUrl, setPhotoYtUrl] = useState<string | null>(null);
    useEffect(() => { setPhotoYtUrl((photo?.songYoutubeUrl as string | undefined) ?? null); }, [photo?.id, photo?.songYoutubeUrl]);
    const [mvOpen, setMvOpen] = useState(false);
    const [ytInput, setYtInput] = useState("");
    const [ytSaving, setYtSaving] = useState(false);
    const mvEmbed = useMemo(() => (photoYtUrl ? parseMusicEmbed(photoYtUrl) : null), [photoYtUrl]);
    const savePhotoYoutube = async (url: string | null) => {
        // **送る前に断る。** サーバーは合わなければ 400「不正なYouTube URLです」を
        // 返すが、画面は `!ytInput.trim()` しか見ていなかったので、Vimeo の
        // リンクや `abc` を貼ると**必ず往復1回ぶん無駄にしてから**同じ文言が出る。
        // **文言はサーバーと同じものを使う**（利用者から見た結果を変えない）。
        // 見た目も変えない——新しい注意書きは置かず、押したときの手応えだけ早くする。
        if (url !== null && !isYouTubeMvUrl(url)) {
            showToast(locale === "en" ? "Not a valid YouTube URL" : "不正なYouTube URLです", "error");
            return;
        }
        setYtSaving(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, {
                method: "PUT",
                body: JSON.stringify({ songYoutubeUrl: url ?? "" }),
            });
            if (!res.ok) {
                // 失敗の理由はサーバーの文言をそのまま出す（400 なら
                // 「不正なYouTube URLです」が返る）。以前は通信断・認証切れ・
                // 500 まで一律「YouTubeリンクが正しくありません」に潰していて、
                // 正しいリンクを何度も貼り直させる形だった。
                showToast(await readApiError(res, locale === "en" ? "Could not save the MV" : "MVを保存できませんでした"), "error");
                return;
            }
            setPhotoYtUrl(url);
            setYtInput("");
            showToast(
                url ? (locale === "en" ? "MV added 🎬" : "MVを設定しました 🎬") : (locale === "en" ? "MV removed" : "MVを外しました"),
                "success",
            );
        } catch (e) {
            // fetch 自体の失敗。トークン不在（userFetch が投げる）は
            // 「時間をおいて」では直らないので、そのまま伝える
            // **catch の中で動的 import しない。** そこで落ちると
            // トーストが1つも出ない——しかも落ちやすいのは
            // まさに通信が died している今の状況（台帳の既知の型）
            showToast(sessionErrorMessage(e)
                ?? (locale === "en" ? "Network error. Please try again." : "通信に失敗しました。時間をおいてもう一度お試しください"), "error");
        } finally {
            setYtSaving(false);
        }
    };
    const [songPickerOpen, setSongPickerOpen] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    // 検索そのものは共有のフック（3画面で同じものを書いていた）
    const {
        results: songResults, searching: songSearching, error: songSearchError,
        search: runSongSearch, clear: clearSongSearch,
    } = useSongSearch();
    // 検索の失敗が「0件」と同じ（結果欄は length>0 でしか描かれない）ので、
    // 押しても無反応に見えた。プロフィール編集には既に同じ表示がある（SW-b6）
    const searchPhotoSongs = async () => { await runSongSearch(songQuery); };
    const savePhotoSong = async (song: SongEntry | null) => {
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, {
                method: "PUT",
                body: JSON.stringify({ song }),
            });
            if (!res.ok) {
                // 隣の savePhotoYoutube と同じ形にする。番号だけ投げて
                // 「保存に失敗しました」に潰していたので、認証切れ（押し直しても
                // 直らない）と一時障害の区別が付かなかった
                showToast(await readApiError(res, locale === "en" ? "Could not save the BGM" : "BGMを保存できませんでした"), "error");
                return;
            }
            setPhotoSong(song);
            setSongPickerOpen(false);
            clearSongSearch();
            setSongQuery("");
            showToast(
                song
                    ? (locale === "en" ? "Photo BGM set 🎵" : "この写真のBGMを設定しました 🎵")
                    : (locale === "en" ? "Photo BGM removed" : "BGMを外しました"),
                "success",
            );
        } catch (e) {
            // **catch の中で動的 import しない。** そこで落ちると
            // トーストが1つも出ない——しかも落ちやすいのは
            // まさに通信が died している今の状況（台帳の既知の型）
            showToast(sessionErrorMessage(e)
                ?? (locale === "en" ? "Network error. Please try again." : "通信に失敗しました。時間をおいてもう一度お試しください"), "error");
        }
    };

    // トースト通知

    // EXIF情報を画像から読み取った情報を優先し、なければデータ側のexifをフォールバック
    const mergedExif = useMemo(() => {
        const extracted = extractedExif || {};
        const fallback = photo?.exif || {};
        
        // 画像サイズの生成（優先順位: extracted > photo.width/height > fallback.imageSize）
        let imageSize: string | undefined;
        if (extracted.ImageWidth && extracted.ImageHeight) {
            imageSize = `${extracted.ImageWidth} × ${extracted.ImageHeight}`;
        } else if (photo?.width && photo?.height) {
            imageSize = `${photo.width} × ${photo.height}`;
        } else if (fallback.imageSize) {
            imageSize = fallback.imageSize;
        }
        
        return {
            // `formatCameraName` に寄せる。素の連結だと Model がメーカー名を含む機種
            // （Hasselblad "X2D 100C" は Model が "Hasselblad X2D 100C"）で
            // 「Hasselblad Hasselblad X2D 100C」になる。アップロード側は前から
            // 同じ関数で畳んでいた（`lib/utils/exif.ts`）——画面で抽出する経路だけ
            // 素のままだった
            // 控え（保存済みの値）には二重のメーカー名が混じるので、そこも通す
            camera: formatCameraName(extracted.Make, extracted.Model) || dedupeCameraName(fallback.camera) || undefined,
            lens: extracted.LensModel || fallback.lens || undefined,
            aperture: extracted.FNumber 
                ? `f/${extracted.FNumber}` 
                : fallback.aperture || undefined,
            exposure: extracted.ExposureTime 
                ? extracted.ExposureTime < 1 
                    ? `1/${Math.round(1 / extracted.ExposureTime)}s` 
                    : `${extracted.ExposureTime}s`
                : fallback.exposure || undefined,
            iso: extracted.ISO || fallback.iso || undefined,
            focalLength: extracted.FocalLength 
                ? `${Math.round(extracted.FocalLength)}mm` 
                : fallback.focalLength || undefined,
            whiteBalance: extracted.WhiteBalance !== undefined
                ? extracted.WhiteBalance === 0 ? "Auto" : "Manual"
                : fallback.whiteBalance || undefined,
            imageSize: imageSize,
            // **createdAt にフォールバックしない。** 撮影日を持つのは30枚中8枚で、
            // 残りは「撮影日時」の欄にアップロード時刻が分単位で出ていた
            // （しかも日付だけの値には無い 00:00 まで作っていた）。
            // 分からないなら、その行を出さない。
            dateTimeOriginal: extracted.DateTimeOriginal || fallback.dateTimeOriginal || photo?.date || undefined,
        };
    }, [extractedExif, photo]);

    // 構造化データ（JSON-LD）を生成（条件分岐の前に配置）
    const structuredData = useMemo(() => {
        if (!photo) return null;
        return generatePhotoStructuredData(photo, locale);
    }, [photo, locale]);

    // BreadcrumbList構造化データを生成
    const breadcrumbData = useMemo(() => {
        if (!photo) return null;
        // パンくずの名前。**同じページの `ImageObject.name`・`<title>` と同じ決め方**
        // （`photoTitleFor`）にする——別々に組むと、同じ写真について2つの構造化データが
        // 違うことを言う。題が無い（旧い「無題」を含む）写真は「<撮影地>の写真」/「写真」
        const title = photoTitleFor(photo, locale === "en" ? "en" : "ja").text;
        return generateBreadcrumbStructuredData([
            { name: locale === "en" ? "Home" : "ホーム", url: siteConfig.url },
            { name: title, url: `${siteConfig.url}/photo/${photo.id}` },
        ]);
    }, [photo, locale]);

    // 回遊導線: 同じ投稿者の写真 / 同じ場所の写真 / 前後の写真。
    // クライアント取得前（allPhotos が initialPhoto だけの間）はサーバ計算済みの
    // initialRelated を使う＝静的HTMLに内部リンクが焼き込まれる（SEO）。
    const related = useMemo(() => {
        if (!photo) return { author: [] as Photo[], location: [] as Photo[], prev: null as Photo | null, next: null as Photo | null, nearby: [] as Photo[] };
        // 古い形（`nearby` を持たない）の props でも落ちない
        if (allPhotos.length <= 1 && initialRelated) return { ...initialRelated, nearby: initialRelated.nearby ?? [] };
        return {
            ...relatedSections(photo, allPhotos, 8),
            ...adjacentPhotos(photo, allPhotos),
            nearby: nearbyPhotos(photo, allPhotos, 8),
        };
    }, [photo, allPhotos, initialRelated]);

    // ローディング中
    if (loading) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full">
                {/* 2026-10-30 束 0b C17: 回る輪ではなく iOS と同じ灰の骨組み（`StateViews`） */}
                <LoadingState kind="rows" locale={locale === "en" ? "en" : "ja"} className="min-h-[60vh]" />
            </main>
        );
    }

    // 写真が見つからない場合は404。ただし **API の取得に失敗している間は
    // 「存在しません」と断定しない**——静的データに無い新着写真だと、
    // 一時的な失敗が「消された」ように読める（実在するのに）。
    if (!photo && fetchFailed) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full">
                {/* 2026-10-30 束 0b C17: 共通の失敗の形（灰の三角・明朝 20・本文 15・副ボタン 44 の「もう一度」） */}
                <ErrorState
                    className="min-h-[60vh]"
                    headingLevel={1}
                    title={locale === "en" ? "Couldn't load the photo" : "写真を読み込めませんでした"}
                    message={locale === "en" ? "A temporary network problem may be the cause." : "一時的な通信の問題かもしれません。"}
                    onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }}
                    retryLabel={locale === "en" ? "Retry" : "もう一度読み込む"}
                    locale={locale === "en" ? "en" : "ja"}
                />
            </main>
        );
    }
    if (!photo) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                    <h1 className="font-serif text-xl font-bold mb-4">
                        {locale === "en" ? "Photo Not Found" : "写真が見つかりません"}
                    </h1>
                    <p className="text-white/60 mb-6">
                        {locale === "en" 
                            ? "The photo you are looking for does not exist." 
                            : "お探しの写真は存在しません。"}
                    </p>
                    <Link
                        href="/"
                        prefetch={false}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                        style={{ 
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            minHeight: "44px"
                        }}
                    >
                        <ChevronLeftIcon className="w-4 h-4" aria-hidden="true" />
                        <span>{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                    </Link>
                </div>
            </main>
        );
    }

    // **一覧（`GalleryGrid`）と同じく `displayTitle` を通す**（`photoOwnTitle` の中）。サーバーが入れていた
    // 「無題」（`{ ja: "無題" }`）は題として扱わない（`photoTitle.ts`）
    const titleText = photoOwnTitle(photo, locale === "en" ? "en" : "ja");
    // **画像検索が見るのはこの1枚。** 撮影地まで入れる（`photoAlt.ts`）
    const altText = photoAltText(photo, locale);
    // **もう一方の言語の本文は出さない。**
    //
    // 以前はここで英語の題と説明を組み、`sr-only` で静的HTMLに焼いていた
    // （コメントは「視覚非表示・検索エンジン向け」）。実ビルドで **28/30
    // ページ**に入っていた。やめる理由:
    //
    //   1. **英語のページが存在しない。** `locale` は `ja` 固定で切替は
    //      `6d72bfb` で撤去済み。英語の検索から来た人は日本語のページに
    //      着地する。同じ理由で `og:locale:alternate`（I18N-2）・
    //      JSON-LD の説明・画像サイトマップの日英併記も外してある
    //   2. **利用者が消せない。** `app/user/edit/page.tsx` が既に書いている
    //      とおり、**英語を編集・削除する画面はどこにも無い**（この画面も
    //      `/admin/edit` も日本語欄しか描かない）。日本語を消しても英訳が
    //      残る形を「消した方を優先する」で潰したのに、**その英訳を
    //      画面に出し続けていた**
    //   3. 見えない文字を検索エンジンのためだけに置くのは、Google が
    //      「隠しテキスト」として名指ししている形に当たる
    //
    // **題の英語は捨てていない**——`ImageObject.alternateName` が持つ。
    const locationText = typeof photo.location === "string" ? photo.location : "";
    // **題が無い写真の見出し。** 題は空にできる（`api-user/src/upload.ts` は
    // 空なら `title` の欄ごと持たない）ので、題をそのまま見出しに入れるだけだと
    // **中身の無い見出し**になる——読み上げは「見出し」とだけ言い、検索の
    // 着地点のページに見出しが無い。2026-10-17 に本番で初めて題の無い写真が
    // 公開され、デプロイ前のスモーク（`e2e-smoke.mjs` の「個別ページが
    // 表示される」）がこれで止まった。
    //
    // **見た目は変えない**（owner:「タイトルなくてもいいよ」——画面に
    // 「無題」も代わりの文字も出さない）。見出しは読み上げ用（`sr-only`）に置く。
    // 上の 3. の「隠しテキスト」とは別物: 中身は画面に出ている撮影地と同じ
    // 短い説明で、検索のために語を足すものではない。
    // 言い方は `fallbackPhotoTitle` 1つに置く（`<title>`・パンくず・RSS・共有も同じ）
    const fallbackHeading = fallbackPhotoTitle(locationText, locale === "en" ? "en" : "ja");
    // 撮影日（保存された通りに出す。`createdAt` には落とさない: 投稿日と撮影日は別）。
    // **形は iOS と同じ「2026.09.23 · 14:29」**（`PhotoMetaLine.stamp`・2026-10-21）。
    // 時刻はカメラが書いた撮影時刻（EXIF）からだけ。画面で抜いた値を先に見る
    const shotDate = formatPhotoStamp(photo.date, extractedExif?.DateTimeOriginal ?? photo.exif?.dateTimeOriginal) ?? "";
    const paragraphs = getLocalizedParagraphs(photo.description, locale);

    const preferred = getPreferredMapLink(photo);
    // **地名から引いたおおよその座標（`geoApprox`）では地図のピンを出さない。**
    // 街の中心に立つピンは「ここで撮った」と読まれる。地名（テキスト）は
    // そのまま出るので、場所が分からなくなるわけではない
    const fallbackHref = photo.coords && !photo.geoApprox ? makeGoogleSearch(photo.coords.lat, photo.coords.lng) : undefined;
    const href = preferred?.href ?? fallbackHref;
    // 撮影地マップ（/map）へ、この写真の位置に寄せて飛ぶためのハッシュ。
    // 座標が無ければ出さない（マップにもピンが無い）
    const mapHash = photo.coords && Number.isFinite(photo.coords.lat) && Number.isFinite(photo.coords.lng)
        ? formatMapHash({ lat: photo.coords.lat, lng: photo.coords.lng, zoom: PHOTO_LINK_ZOOM })
        : "";

    // 共有機能
    const currentUrl = typeof window !== "undefined" 
        ? `${window.location.origin}/photo/${photo.id}` 
        : `${siteConfig.url}/photo/${photo.id}`;
    // 題が無ければ見出しと同じ「<撮影地>の写真」（以前は一律「写真」）
    const shareText = titleText || fallbackHeading;

    const handleShare = async (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const result = await shareUrl(currentUrl, shareText, paragraphs.join(" "));
        // cancelled（利用者が閉じた）と shared は何も出さない
        if (result === "copied") {
            showToast(locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
        } else if (result === "failed") {
            showToast(locale === "en" ? "Could not share" : "共有できませんでした", "error");
        }
    };

    const handleCopyLink = async (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        if (await copyToClipboard(currentUrl)) {
            showToast(locale === "en" ? "Link copied!" : "リンクをコピーしました");
        } else {
            showToast(locale === "en" ? "Failed to copy link" : "リンクのコピーに失敗しました", "error");
        }
    };

    // カテゴリ表示名の取得
    // **鍵はスラッグ。** 生の値で引くと、別名で保存された写真だけ
    // 表に当たらず生のまま出る（「建物」と出して「建築の写真」へ飛ぶ）
    const categoryDisplayName = photo ? categoryLabel(photo.category, labels.category?.names ?? {}) : "";

    return (
        <>
            {structuredData && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
                />
            )}
            {breadcrumbData && (
                <script
                    type="application/ld+json"
                    // 写真のタイトルが入るためエスケープ必須（直前の構造化データと同じ扱い）
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
                />
            )}
            <main className="relative min-h-screen text-white bg-bg max-w-2xl lg:max-w-6xl mx-auto w-full pb-8" data-chromeless-phone="">
            {/* **最終版モックの並び**（2026-09-21・owner「全く同じにしたい」）:
                戻る/共有/⋯ の行 → 端までのヒーロー（撮影地チップ・地図）→ 題 →
                作者行（枠線のフォロー）→ 撮影日 · 撮影地 → 本文 → チップ →
                ♡ 💬 🔖 ⬆ の行 → BGM → 撮影情報（折りたたみ）→ コメント／関連写真のタブ。
                PC も中央に幅を絞った同じ画面（以前の2カラムはやめた）。
                **全体ヘッダー（ロゴ・ハンバーガー）は layout のもの**——本番の
                スモークがハンバーガーの存在と開くことを見るので、この行は
                その下に置く（重ねない）。
                **スマホ（1024px 未満）では行をやめ、写真の左上・右上にガラスの丸を重ねる**
                （iOS の `PhotoDetailView`・板 02・2026-10-21）。行のぶん（約 52px）写真が上へ
                上がり、写真がサイトの見出しのすぐ下から始まる。写真の上なので白だけ・
                当たりは 44px。PC は2カラムの上に今までどおり行で置く（同じボタンを1組だけ
                描き、位置だけを幅で切り替える——2組描くと読み上げにも2組出る） */}
            {/* 2026-10-31 束 1 P1: **スマホではサイトの見出しを出さない**（`data-chromeless-phone`・`globals.css`）。
                写真が画面の上端から始まり、戻る・「…」は写真の上のガラスの丸（iOS の板 02）。
                ホーム画面から起動したときは時計の帯のぶん下げる（`safe-area-inset-top`） */}
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-2 pt-[calc(8px+env(safe-area-inset-top,0px))] pointer-events-none lg:static lg:z-auto lg:py-1.5 lg:pt-1.5"
                 data-testid="photo-top-bar">
                <Link
                    href="/"
                    prefetch={false}
                    aria-label={locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                    className={TOP_BUTTON}
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <ChevronLeftIcon aria-hidden="true" style={GLASS_ICON_STYLE} />
                </Link>
                <MoreMenu
                    label={locale === "en" ? "More" : "その他"}
                    buttonRef={reportBtnRef}
                    className="pointer-events-auto"
                    buttonClassName={TOP_BUTTON}
                    buttonSize={44}
                    items={[
                        { key: "share", label: locale === "en" ? "Share" : "共有", onSelect: () => void handleShare() },
                        { key: "copy", label: locale === "en" ? "Copy link" : "リンクをコピー", onSelect: () => void handleCopyLink() },
                        { key: "x", label: locale === "en" ? "Share on X" : "Xで共有", onSelect: () => shareToTwitter(currentUrl, shareText) },
                        ...(locale === "ja" ? [{ key: "line", label: "LINEで共有", onSelect: () => shareToLine(currentUrl, shareText) }] : []),
                        // 撮影地マップのこの写真の位置（以前は写真の右下の丸。iOS は写真の上に地図の丸を置かない・束 1 P2）。
                        // 「この近くで撮られた写真」の節の「地図で見る」と同じ行き先——近くに写真が無い写真でも行き先を消さない
                        ...(mapHash ? [{ key: "map", label: locale === "en" ? "See on the map" : "撮影地マップで見る", href: `${ROUTES.MAP}${mapHash}` }] : []),
                        // 正確な座標（または持ち主が付けた地図のリンク）の Google マップ。以前は本文の上の撮影地の字のリンク
                        // （住所の全文の行は外した・束 1 P4）。おおよその座標では出さない（`href` が無い）
                        ...(href ? [{ key: "gmap", label: locale === "en" ? "Open in Google Maps" : "Google マップで開く", href, external: true }] : []),
                        // **通報。** 自分の投稿と未ログインには出さない（押しても断られるため）
                        ...(isAuthenticated && !isOwnPhoto
                            ? [{ key: "report", label: locale === "en" ? "Report this post" : "この投稿を通報する", onSelect: () => setReportOpen(true), danger: true }]
                            : []),
                    ]}
                />
            </div>

            {/* **PC は2カラム**（owner の指示書 2026-09-22:「PCではスマホ画面を
                そのまま横に引き伸ばさず、写真詳細は写真を大きく、撮影情報やコメントを
                別カラムに」）。スマホ（1024px 未満）は最終版モックのまま縦に積む。
                左は写真だけ・スクロールに追従、右に題から下を全部入れる。
                2026-10-31（束 1・PC の幅の決まり W5）: 右の文の列は 400 固定（以前は 3:2 で幅とともに伸びた）。中の並びと部品は電話の iOS の順 */}
            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-8 lg:px-4 lg:pt-3 lg:items-start">
            {/* ヒーロー。**スマホでは端まで**（左右の余白なし・角丸なし）。
                複数枚は左右スワイプでも送れる */}
            <div
                className="relative lg:sticky lg:top-4 lg:rounded-2xl lg:overflow-hidden"
                {...(images.length > 1 ? swipeHandlers : {})}
                style={images.length > 1 ? { touchAction: "pan-y" } : undefined}
            >
                {/* **1枚目は必ずここで描く。** 静的書き出しなので、送る仕組みを
                    state で包むと JS が届くまで写真が出ない——この画面は
                    検索の着地点で、LCP がそのぶん遅れる。`shown === 0` の間は
                    今までとまったく同じ木になる。
                    **押すと全画面で開く**（`PhotoViewer`・iOS と同じ）。ボタンは写真を包むだけで、
                    静的HTMLにも同じ形で出る（水和で木が変わらない） */}
                <button
                    ref={heroButtonRef}
                    type="button"
                    onPointerDown={(e) => { heroPressRef.current = { x: e.clientX, y: e.clientY }; }}
                    onClick={(e) => {
                        // **引いて送ったあとの click は捨てる**（PC でマウスを引いて写真を送ると、
                        // 離したところで click が来て全画面が開いていた）。キーボード（Enter）の
                        // click は pointerdown を伴わないので、そのまま開く
                        const press = heroPressRef.current;
                        heroPressRef.current = null;
                        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > HERO_TAP_SLOP) return;
                        if (failedSrc === current.src) return;
                        setViewerOpen(true);
                    }}
                    aria-haspopup={failedSrc === current.src ? undefined : "dialog"}
                    aria-disabled={failedSrc === current.src ? true : undefined}
                    className={`block w-full p-0 m-0 border-0 bg-transparent text-left ${failedSrc === current.src ? "cursor-default" : "cursor-zoom-in"} focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white`}
                    style={{ touchAction: images.length > 1 ? "pan-y" : "manipulation", WebkitTapHighlightColor: "transparent" }}
                    data-testid="photo-hero-open"
                >
                <PhotoImage
                    key={shown}
                    src={current.src}
                    alt={shown === 0 ? altText : `${altText}（${shown + 1}/${images.length}）`}
                    focalPoint={shown === 0 ? photo.focalPoint : undefined}
                    blurDataURL={current.blurDataURL}
                    srcAvif={current.srcAvif}
                    width={current.width}
                    height={current.height}
                    // **EXIF を抜くのは表紙だけ。** 撮影情報は投稿に1組しか
                    // 無いので、2枚目以降から抜くと表紙のものと食い違う
                    extractExif={shown === 0 && !hasStoredExif(photo.exif)}
                    onExifLoaded={setExtractedExif}
                    onImageError={() => setFailedSrc(current.src)}
                />
                {failedSrc !== current.src && (
                    <span className="sr-only">{locale === "en" ? " (view full screen)" : "（全画面で見る）"}</span>
                )}
                </button>
                {/* **上の端の黒のぼかし**（iOS の `TopBarScrim`: 黒 70% → 0）。スマホだけ——
                    戻る・共有・「…」の白い丸が明るい空の上でも沈まないように。押せない飾り */}
                <div aria-hidden="true" data-testid="photo-top-scrim" className="lg:hidden absolute inset-x-0 top-0 pointer-events-none"
                     style={{ height: "96px", background: "linear-gradient(to bottom, rgb(0 0 0 / 0.7), rgb(0 0 0 / 0))" }} />

                {images.length > 1 && (
                    <>
                        {/* 何枚目かは写真の裾の点（白と白40%・6px）と、題の下の1行「… · 1/3枚」が言う
                            （iOS の `pageDots`・`headline`・束 1 P4。以前は写真の上の「1/3」の札） */}
                        {/* **読み上げには別に伝える。** 上のバッジは
                            `aria-hidden`（送るたびに読み上げが割り込むと邪魔）。
                            こちらは操作の結果として伝わる */}
                        <p className="sr-only" aria-live="polite">
                            {locale === "en"
                                ? `Photo ${shown + 1} of ${images.length}`
                                : `${images.length}枚中 ${shown + 1}枚目`}
                        </p>
                        <button
                            type="button"
                            onClick={() => setShown((i) => (i - 1 + images.length) % images.length)}
                            aria-label={locale === "en" ? "Previous photo" : "前の写真"}
                            className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white transition-colors"
                            style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                        >
                            <ChevronLeftIcon style={{ width: "24px", height: "24px" }} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setShown((i) => (i + 1) % images.length)}
                            aria-label={locale === "en" ? "Next photo" : "次の写真"}
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white transition-colors"
                            style={{ width: "44px", height: "44px", touchAction: "manipulation" }}
                        >
                            <ChevronRightIcon style={{ width: "24px", height: "24px" }} />
                        </button>
                    </>
                )}

                {/* **写真の裾**（iOS の `photoFoot`・束 1 P2）: 黒 72% → 0 の暗がり（下 150・短い写真では 6 割まで）の上に、
                    束の点と「📍 撮影地 · 撮影地の詳細」「📖 撮影スポット · 名前 ›」の行。**写真の上なので白だけ**。
                    以前は住所の全文の黒い札と、右下の地図の丸（地図は「…」と「この近くで撮られた写真」の「地図で見る」へ） */}
                {(locationText || spotLink || images.length > 1) && (
                    <>
                        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 pointer-events-none"
                             style={{ height: "min(150px, 60%)", background: "linear-gradient(to bottom, rgb(0 0 0 / 0), rgb(0 0 0 / 0.72))" }} />
                        <div className="absolute inset-x-0 bottom-0 px-4 pb-1 flex flex-col items-start pointer-events-none" data-testid="photo-foot">
                            {images.length > 1 && (
                                <span aria-hidden="true" className="self-center flex gap-1.5 pb-2" data-testid="photo-page-dots">
                                    {images.map((_, i) => (
                                        <span key={i} className={`block w-[6px] h-[6px] rounded-full ${i === shown ? "bg-white" : "bg-white/40"}`} />
                                    ))}
                                </span>
                            )}
                            {locationText && (
                                <Link
                                    href={collectionPath("location", slugify(locationText, "location"))}
                                    prefetch={false}
                                    aria-label={locale === "en" ? `${locationText} · Place details` : `${locationText} · 撮影地の詳細`}
                                    className={`${FOOT_ROW} pointer-events-auto`}
                                    style={FOOT_ROW_STYLE}
                                    data-testid="photo-place-link"
                                >
                                    <MapPinIcon aria-hidden="true" className="flex-shrink-0" style={{ width: 13, height: 13, strokeWidth: 1.8 }} />
                                    <span className={FOOT_UNDERLINE}>{locationText}</span>
                                    <span className="flex-shrink-0 whitespace-nowrap text-white/80" aria-hidden="true">
                                        {locale === "en" ? " · Place details" : " · 撮影地の詳細"}
                                    </span>
                                </Link>
                            )}
                            {/* 台帳の撮影スポット（写真が確かめ済みの `spotId` を持つときだけ）。以前は本文の下の札（`SpotLinkCard`） */}
                            {spotLink && (
                                <Link
                                    href={`/spots/${spotLink.slug}`}
                                    prefetch={false}
                                    aria-label={locale === "en" ? `Photo spot: ${spotLink.name}` : `撮影スポット: ${spotLink.name}`}
                                    className={`${FOOT_ROW} pointer-events-auto`}
                                    style={FOOT_ROW_STYLE}
                                    data-testid="photo-spot-guide"
                                >
                                    <BookOpenIcon aria-hidden="true" className="flex-shrink-0" style={{ width: 13, height: 13, strokeWidth: 1.8 }} />
                                    <span className={FOOT_UNDERLINE}>{locale === "en" ? `Photo spot · ${spotLink.name}` : `撮影スポット · ${spotLink.name}`}</span>
                                    <span className="flex-shrink-0" aria-hidden="true">›</span>
                                </Link>
                            )}
                        </div>
                    </>
                )}
            </div>

            <div className="min-w-0">
            {/* **iOS の写真の詳細の順**（`PhotoDetailView.details`・束 1 P4）: 題 → 日時 → カテゴリ → 本文 → 作者 →
                「この写真を見て撮影」→ 操作の段 → 次の旅へ → 撮影情報 → タグ → 曲 → 近くの写真 → 近くの撮影スポット → 関連 → コメント。
                節の間は 16（iOS の `VStack(spacing: 16)`）・写真との間 20。以前は 題 → 作者 → 日時と住所 → 本文 → タグ の順 */}
            <div className="px-4 pt-5 lg:px-0 lg:pt-0 flex flex-col gap-4" data-testid="photo-details">
                {/* 題（明朝 26・iOS `JPFont.screenTitle`・束 1 P3）と、その下の1行（日時 · 何枚目・13・text-3・等幅の数字）。
                    `break-words`: 長い URL・連続文字でページごと横に流れるのを防ぐ。
                    字体は `lib/utils/headingFont.ts` の並び（先頭は自前で配る Shippori Mincho B1 Bold） */}
                <div className="flex flex-col gap-2">
                    {titleText
                        ? <h1 className="font-bold break-words m-0" style={{ fontSize: "26px", lineHeight: 1.3, fontFamily: DISPLAY_MINCHO_STACK }}>{titleText}</h1>
                        : <h1 className="sr-only">{fallbackHeading}</h1>}
                    {(shotDate || images.length > 1) && (
                        <p className="m-0 text-text-3 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }} data-testid="photo-headline">
                            {shotDate && <span data-testid="photo-shot-stamp">{shotDate}</span>}
                            {shotDate && images.length > 1 && <span aria-hidden="true"> · </span>}
                            {images.length > 1 && <span>{locale === "en" ? `${shown + 1}/${images.length}` : `${shown + 1}/${images.length}枚`}</span>}
                        </p>
                    )}
                </div>

                {/* カテゴリ（iOS は題の下の小さな札・板に無く実装にだけある）。集約ページへの内部リンク＝SEO・回遊。**先読みしない** */}
                {categoryDisplayName && photo.category && (
                    <div className="flex flex-wrap gap-x-2 gap-y-2.5">
                        <Link
                            href={collectionPath("category", slugify(photo.category, "category"))}
                            prefetch={false}
                            className={CHIP_CLASS}
                            style={{ ...CHIP_SIZE, touchAction: "manipulation" }}
                        >
                            {categoryDisplayName}
                        </Link>
                    </div>
                )}

                {/* 本文（iOS: 15・text-2・行送り 1.8・段落の間 12）。以前は 14・白85%・行送り 22。
                    撮影地の住所の全文は本文の上から外した——撮影地の頁と、写真の裾の行が持つ（束 1 P4） */}
                {paragraphs.length > 0 && (
                    <div className="text-text-2 break-words flex flex-col gap-3" style={{ fontSize: "15px", lineHeight: 1.8 }}>
                        {paragraphs.map((line, i) => (
                            <p key={i} className="m-0">
                                {line}
                            </p>
                        ))}
                    </div>
                )}

                {/* 撮影者とライセンス（Web だけ・残す） */}
                {(photo.photographer || photo.license) && (
                    <div className="text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>
                        {photo.photographer && <span>{photo.photographer}</span>}
                        {photo.photographer && photo.license && <span className="mx-2">·</span>}
                        {photo.license && <span>{photo.license}</span>}
                    </div>
                )}

                {/* 作者行（iOS の `authorRow`）: 顔 40（白8%の縁）・名前 15 semibold・@名 12 text-3 ／ 右にフォロー（C8） */}
                {photo.userId && photo.displayName && (
                    <div className="flex items-center gap-[10px]" data-testid="photo-author">
                        <Link href={ROUTES.USER_PROFILE(photo.userId)} prefetch={false}
                              className="flex-shrink-0 rounded-full inline-flex items-center justify-center"
                              aria-label={locale === "en" ? `${photo.displayName}'s profile` : `${photo.displayName} のプロフィール`}
                              style={{ minWidth: "44px", minHeight: "44px", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}>
                            <UserAvatar userId={photo.userId} className="w-10 h-10 ring-1 ring-line" iconClassName="w-6 h-6" />
                        </Link>
                        <div className="min-w-0 flex-1">
                            <Link href={ROUTES.USER_PROFILE(photo.userId)} prefetch={false}
                                  className="block text-white font-semibold truncate hover:text-white/80 transition-colors"
                                  style={{ fontSize: "15px", lineHeight: "20px", touchAction: "manipulation" }}>
                                {photo.displayName}
                            </Link>
                            {photo.uploaderUsername && (
                                <p className="m-0 mt-0.5 text-text-3 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>@{photo.uploaderUsername}</p>
                            )}
                        </div>
                        {!isOwnPhoto && (
                            <FollowAction
                                targetUserId={photo.userId}
                                isOwner={false}
                                isAuthenticated={isAuthenticated}
                                locale={locale === "en" ? "en" : "ja"}
                                variant="outline"
                            />
                        )}
                    </div>
                )}

                {/* 「この写真を見て撮影」。元の写真が公開の一覧に居るときだけ出る */}
                <InspiredByLine source={inspired} locale={locale} />

                {/* 操作の段（iOS の `socialBar`・束 1 P6）: 左に いいね・コメント、右に 保存・共有。**印だけ**（白・線の細い 24）、
                    数は 0 より大きいときだけ（15・等幅の数字）。下に白8%の線。以前は「保存」「シェア」の字つき・保存は真鍮。
                    読み上げの名前は残す（数があれば名前にも入れる＝見える字が名前に含まれる） */}
                <div className="flex flex-col gap-2" data-testid="photo-actions">
                    <div className="flex items-center gap-2 -mx-1.5">
                        <button
                            type="button"
                            onClick={handleLike}
                            disabled={likePending}
                            aria-pressed={isFav}
                            // **名前は押しても変えない**——押した状態は `aria-pressed` が伝える
                            aria-label={likeCount > 0
                                ? (locale === "en" ? `Like (${likeCount.toLocaleString()})` : `いいね ${likeCount.toLocaleString()}件`)
                                : (locale === "en" ? "Like" : "いいね")}
                            className={ACTION_BTN}
                            style={ACTION_BTN_STYLE}
                        >
                            {isFav
                                ? <HeartIcon aria-hidden="true" style={ACTION_ICON_STYLE} />
                                : <HeartIconOutline aria-hidden="true" style={ACTION_ICON_STYLE} />}
                            {likeCount > 0 && <span className="tabular-nums" style={ACTION_COUNT_STYLE}>{likeCount.toLocaleString()}</span>}
                        </button>
                        <button
                            type="button"
                            onClick={() => commentsRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" })}
                            aria-label={commentCount > 0
                                ? (locale === "en" ? `${commentCount} comments. Show comments` : `コメント ${commentCount}件。コメントを見る`)
                                : (locale === "en" ? "Show comments" : "コメントを見る")}
                            className={ACTION_BTN}
                            style={ACTION_BTN_STYLE}
                        >
                            <ChatBubbleOvalLeftIcon aria-hidden="true" style={ACTION_ICON_STYLE} />
                            {commentCount > 0 && <span className="tabular-nums" style={ACTION_COUNT_STYLE}>{commentCount.toLocaleString()}</span>}
                        </button>
                        <span className="flex-1" aria-hidden="true" />
                        <button
                            type="button"
                            onClick={handleSave}
                            aria-pressed={saved}
                            aria-disabled={savePending || undefined}
                            aria-label={saved ? (locale === "en" ? "Remove from saved" : "保存を取り消す") : (locale === "en" ? "Save" : "保存")}
                            className={ACTION_BTN}
                            style={ACTION_BTN_STYLE}
                        >
                            {saved ? <BookmarkSolidIcon aria-hidden="true" style={ACTION_ICON_STYLE} /> : <BookmarkIcon aria-hidden="true" style={ACTION_ICON_STYLE} />}
                        </button>
                        <button
                            type="button"
                            onClick={handleShare}
                            aria-label={locale === "en" ? "Share" : "共有"}
                            className={ACTION_BTN}
                            style={ACTION_BTN_STYLE}
                        >
                            <ArrowUpOnSquareIcon aria-hidden="true" style={ACTION_ICON_STYLE} />
                        </button>
                    </div>
                    <div aria-hidden="true" className="h-px bg-line" />
                </div>

            {/* NEXT TRIP · 次の旅へ（行きたい・経路・次のゴールデンアワー・撮りに行く）。
                アプリと同じ位置: いいね・コメント・保存・共有の段のすぐ下 */}
            <PhotoTripSection
                spot={spotLink ?? null}
                directionsTo={directionsTarget(photo, spotLink?.coords)}
                zone={photoLightZone(spotLink?.coords, spotTimeZone)}
                inspiredPhotoId={offersInspiredShoot(photo, authUserId) ? photo.id : null}
                locale={locale}
            />

            {/* 撮影情報（iOS の `ExifRow`・束 1 P8）: 札で囲まない1行（印・「撮影情報」15・要約 13・⌄）、開くと 4 つの升とカメラ・レンズの行。
                **機種名からその機材の一覧へ**。リンクは「保存済みの値」から作る（表示は mergedExif のまま）——端末で抜いた値から
                作ると、飛んだ先に自分が居ない・静的生成の対象外でハード404（`dynamicParams = false`）になる */}
            {(() => {
                const storedCamera = dedupeCameraName(photo.exif?.camera);
                const cameraHref = storedCamera ? collectionPath("camera", slugify(storedCamera, "camera")) : undefined;
                return (
                    <ExifRow
                        cells={exifSettingsCells(mergedExif, locale === "en" ? "en" : "ja")}
                        specs={buildExifSpecs(mergedExif, locale, cameraHref)}
                        settings={exifSettingsLine(mergedExif)}
                        locale={locale}
                    />
                );
            })()}

            {/* タグ（iOS の `TagRow`: 撮影情報の下・折り返す・頭に「#」）。集約ページへの内部リンク。**先読みしない**
                （一覧で何本も出るリンクなので、画面に入るたびに行き先の RSC の控えを落とし直す・`GalleryGrid` の注記） */}
            {(photo.tags?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-2.5" data-testid="photo-tags">
                    {(photo.tags ?? []).map((tag) => (
                        <Link
                            key={tag}
                            href={collectionPath("tag", slugify(tag, "tag"))}
                            prefetch={false}
                            className={CHIP_CLASS}
                            style={{ ...CHIP_SIZE, touchAction: "manipulation" }}
                        >
                            #{tag}
                        </Link>
                    ))}
                </div>
            )}

            {/* この写真のBGM */}
            {(photoSong || photoYtUrl || isOwnPhoto) && (
                <div className="space-y-2">
                    {photoSong && (
                        <MusicCard
                            key={photoSong.previewUrl}
                            queueKey={`photo:${photoId}`}
                            songs={[photoSong]}
                            label={locale === "en" ? "Photo BGM" : "この写真のBGM"}
                            locale={locale}
                            compact
                        />
                    )}

                    {/* フル再生MV（YouTube）。大きいので折りたたみ式 */}
                    {mvEmbed && (
                        <div className="rounded-2xl bg-surface ring-1 ring-line overflow-hidden max-w-md">
                            <div className="flex items-center gap-1.5 px-3.5 py-2.5">
                                <MusicalNoteIcon className="w-3.5 h-3.5 text-accent" />
                                <span className="text-[11px] tracking-widest uppercase text-white/50">{locale === "en" ? "Full MV" : "フル再生MV"}</span>
                                <button
                                    onClick={() => setMvOpen((v) => !v)}
                                    aria-expanded={mvOpen}
                                    className="ml-auto inline-flex items-center gap-0.5 text-[12px] text-white/60 hover:text-white active:scale-95 transition"
                                >
                                    {mvOpen ? (locale === "en" ? "Hide" : "畳む") : (locale === "en" ? "Play MV" : "MVを開く")}
                                    <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${mvOpen ? "rotate-180" : ""}`} />
                                </button>
                            </div>
                            {mvOpen && (
                                <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                                    <iframe
                                        src={mvEmbed.embedUrl}
                                        title="この写真のMV"
                                        className="absolute inset-0 w-full h-full"
                                        allow="encrypted-media; picture-in-picture; web-share"
                                        referrerPolicy="strict-origin-when-cross-origin"
                                        loading="lazy"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {isOwnPhoto && (
                        songPickerOpen ? (
                            <div className="rounded-xl bg-surface ring-1 ring-line p-2.5 space-y-2 max-w-md">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={songQuery}
                                        onChange={(e) => setSongQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter" && !isImeKey(e.nativeEvent)) { e.preventDefault(); void searchPhotoSongs(); } }}
                                        placeholder={locale === "en" ? "Song or artist" : "曲名・アーティスト名"}
                                        autoFocus
                                        className="flex-1 min-w-0 bg-surface-2 border border-line rounded-field px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                                    />
                                    <button
                                        onClick={() => void searchPhotoSongs()}
                                        disabled={songSearching || !songQuery.trim()}
                                        className="px-3.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-xs disabled:opacity-40 flex items-center justify-center min-w-[56px]"
                                    >
                                        {songSearching
                                            ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            : (locale === "en" ? "Search" : "検索")}
                                    </button>
                                    <button
                                        onClick={() => { setSongPickerOpen(false); clearSongSearch(); setSongQuery(""); }}
                                        className="px-2 rounded-lg text-white/50 hover:text-white/80 text-xs active:scale-95 transition"
                                    >
                                        {locale === "en" ? "Cancel" : "閉じる"}
                                    </button>
                                </div>
                                {songSearchError && (
                                    <SongSearchError />
                                )}
                                {songResults.length > 0 && (
                                    <ul className="rounded-lg ring-1 ring-line divide-y divide-white/5 overflow-hidden max-h-56 overflow-y-auto no-scrollbar">
                                        {songResults.map((r) => (
                                            <li key={r.id}>
                                                <button
                                                    onClick={() => void savePhotoSong({ title: r.title, artist: r.artist, artwork: r.artwork, previewUrl: r.previewUrl, trackUrl: r.trackUrl })}
                                                    className="w-full flex items-center gap-2.5 p-2 hover:bg-white/5 active:bg-white/10 transition text-left"
                                                >
                                                    <SongArtwork src={r.artwork} className="w-8 h-8 rounded object-cover bg-white/10 flex-shrink-0" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs text-white truncate">{r.title}</p>
                                                        <p className="text-[12px] text-white/50 truncate">{r.artist}</p>
                                                    </div>
                                                    <span className="text-[12px] text-white/50 flex-shrink-0">{locale === "en" ? "Set" : "設定"}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setSongPickerOpen(true)}
                                    className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 active:scale-95 transition"
                                >
                                    <MusicalNoteIcon className="w-3.5 h-3.5 text-accent" />
                                    {photoSong
                                        ? (locale === "en" ? "Change BGM" : "BGMを変更")
                                        : (locale === "en" ? "Add a BGM to this photo" : "この写真にBGMを付ける")}
                                </button>
                                {photoSong && (
                                    <button
                                        onClick={() => void savePhotoSong(null)}
                                        className="inline-flex items-center gap-0.5 text-xs text-white/50 hover:text-white/70 active:scale-95 transition"
                                    >
                                        <XMarkIcon className="w-3 h-3" />
                                        {locale === "en" ? "Remove" : "外す"}
                                    </button>
                                )}
                            </div>
                        )
                    )}

                    {/* オーナー: 編集画面（タイトル・説明・撮影地・タグ・削除）への導線。
                        これまで /user/edit へのリンクは**下書き一覧にしか無く**、
                        公開済みの写真は編集画面に辿り着けなかった（＝直す手段も
                        消す手段も画面上に無い）。気づいた場所から入れるようにする。 */}
                    {isOwnPhoto && (
                        <Link
                            href={ROUTES.EDIT(photoId)}
                            prefetch={false}
                            className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-full bg-surface ring-1 ring-line text-xs text-white/60 hover:bg-surface-2 hover:text-white transition-colors"
                            style={{ touchAction: "manipulation" }}
                        >
                            {locale === "en" ? "Edit or delete this photo" : "この写真を編集・削除"}
                        </Link>
                    )}

                    {/* オーナー: フル再生MV（YouTube リンク）の設定 */}
                    {isOwnPhoto && !songPickerOpen && (
                        <div className="flex items-center gap-2 max-w-md">
                            <input
                                type="url"
                                value={ytInput}
                                onChange={(e) => setYtInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !isImeKey(e.nativeEvent) && ytInput.trim()) { e.preventDefault(); void savePhotoYoutube(ytInput.trim()); } }}
                                placeholder={photoYtUrl
                                    ? (locale === "en" ? "Change YouTube MV link" : "YouTube MV リンクを変更")
                                    : (locale === "en" ? "Paste a YouTube link for full playback" : "YouTubeリンクを貼るとフル再生MVに")}
                                // **サーバーは 500 文字で切る**（`isValidYouTubeUrl` の
                                // `raw.trim().slice(0, 500)`）。上限が無いと、500 を
                                // またぐ長さで画面とサーバーの答えが割れる。
                                // プロフィールの曲のリンク欄は既に 500 なので揃える
                                maxLength={500}
                                className="flex-1 min-w-0 bg-surface-2 border border-line rounded-field px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                                style={{ fontSize: "16px" }}
                            />
                            <button
                                onClick={() => void savePhotoYoutube(ytInput.trim())}
                                disabled={ytSaving || !ytInput.trim()}
                                className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-xs disabled:opacity-40 flex-shrink-0"
                            >
                                {ytSaving
                                    ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    : (locale === "en" ? "Set MV" : "MV設定")}
                            </button>
                            {photoYtUrl && (
                                <button
                                    onClick={() => void savePhotoYoutube(null)}
                                    aria-label={locale === "en" ? "Remove MV" : "MVを外す"}
                                    className="p-1.5 text-white/40 hover:text-white/70 active:scale-95 transition flex-shrink-0"
                                >
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

                {/* **この近くで撮られた写真 ／ 地図で見る ›**（v2 の板の末尾・アプリの `nearbySection`）。
                    正確な座標どうしで 5km 以内（`nearbyPhotos`）。**1枚も無ければ節ごと出さない**。
                    ビルド時に組んだもの（`initialRelated.nearby`）で静的HTMLにも焼く（写真から写真への内部リンク）。
                    見出しは明朝（板）、「地図で見る」は撮影地マップのこの写真の位置へ */}
                {related.nearby.length > 0 && (
                    <section aria-labelledby="photo-nearby-heading" className="pt-3" data-testid="photo-nearby">
                        <div className="flex items-baseline justify-between gap-3">
                            {/* 明朝は Shippori だけ（`font-serif`）・18（iOS `JPTypeScale.title3`）。2026-10-30 束 0b C10（以前はヒラギノ明朝 19） */}
                            <h2 id="photo-nearby-heading" className="m-0 font-serif font-bold" style={{ fontSize: "18px", lineHeight: "24px" }}>
                                {locale === "en" ? "Taken nearby" : "この近くで撮られた写真"}
                            </h2>
                            {mapHash && (
                                <MoreLink href={`${ROUTES.MAP}${mapHash}`} label={locale === "en" ? "View on map" : "地図で見る"} />
                            )}
                        </div>
                        <div className="grid grid-cols-4 gap-0.5 rounded-field overflow-hidden">
                            {related.nearby.map((p) => {
                                // alt は名前が要る。題（撮影地）→「撮影地の写真」（`photoAltText`・旧い「無題」も落とす）
                                const t = relatedPhotoAlt(p, locale === "en" ? "en" : "ja");
                                return (
                                    <Link key={p.id} href={ROUTES.PHOTO(p.id)} prefetch={false}
                                          data-photo-id={p.id}
                                          className="relative block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                          style={{ aspectRatio: "1 / 1", backgroundColor: p.dominantColor ?? "var(--color-surface)", touchAction: "manipulation" }}>
                                        <Thumb photo={p} alt={t} sizes="(max-width:640px) 25vw, 120px" />
                                    </Link>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* **近くの撮影スポット**（2026-10-22）。公開済みの撮影地ガイドを近い順に数件（`nearbySpotsForPhoto`）。
                    距離は出さない（写真の場所を割り出させない）。見出しは明朝（上の節と同じ）。行は撮影地ページと同じ部品 */}
                {nearbySpots.length > 0 && (
                    <section aria-labelledby="photo-nearby-spots-heading" className="pt-5" data-testid="photo-nearby-spots">
                        <h2 id="photo-nearby-spots-heading" className="m-0 mb-3 font-serif font-bold" style={{ fontSize: "18px", lineHeight: "24px" }}>
                            {locale === "en" ? "Photo spots nearby" : "近くの撮影スポット"}
                        </h2>
                        <SpotRows rows={nearbySpots} isJa={locale !== "en"} />
                    </section>
                )}

                {reportOpen && (
                    <ReportDialog
                        photoId={photo.id}
                        blockTargetId={photo.userId && photo.userId !== authUserId ? photo.userId : undefined}
                        locale={locale}
                        onClose={() => setReportOpen(false)}
                        openerRef={reportBtnRef}
                    />
                )}
            </div>

            {/* **関連写真とコメントは縦に節で並べる**（2026-10-31 束 1 P11・iOS は「この近くで撮られた写真」の下にコメントの節）。
                以前は「コメント (N)」「関連写真」の切り替えで、片方は `hidden` だった。関連写真の `/photo/<id>` リンクは
                静的 HTML に焼く（回遊＝SEO。本番のスモークも「ほかの写真への導線」を数える） */}
            {(related.prev || related.next || related.author.length > 0 || related.location.length > 0) && (
                <div className="mt-6 px-4 lg:px-0 flex flex-col gap-6" data-testid="photo-related">
                    {/* 前後の写真（新しい順で隣接・Web だけ）。札の行（C11）を2つ並べる */}
                    {(related.prev || related.next) && (
                        <nav className="grid grid-cols-2 gap-2" aria-label={locale === "en" ? "Adjacent photos" : "前後の写真"}>
                            {related.prev ? (
                                <Link
                                    href={ROUTES.PHOTO(related.prev.id)}
                                    prefetch={false}
                                    data-photo-id={related.prev.id}
                                    className={`${ROW_CARD_TALL} min-w-0`}
                                    style={{ touchAction: "manipulation" }}
                                >
                                    <ChevronLeftIcon className={ROW_CHEVRON} aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className={ROW_SUB}>{locale === "en" ? "Newer" : "新しい写真"}</span>
                                        <span className={ROW_TITLE}>{photoOwnTitle(related.prev, locale === "en" ? "en" : "ja") || (locale === "en" ? "Photo" : "写真")}</span>
                                    </span>
                                </Link>
                            ) : <span />}
                            {related.next ? (
                                <Link
                                    href={ROUTES.PHOTO(related.next.id)}
                                    prefetch={false}
                                    data-photo-id={related.next.id}
                                    className={`${ROW_CARD_TALL} min-w-0 text-right`}
                                    style={{ touchAction: "manipulation" }}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className={ROW_SUB}>{locale === "en" ? "Older" : "古い写真"}</span>
                                        <span className={ROW_TITLE}>{photoOwnTitle(related.next, locale === "en" ? "en" : "ja") || (locale === "en" ? "Photo" : "写真")}</span>
                                    </span>
                                    <ChevronRightIcon className={ROW_CHEVRON} aria-hidden="true" />
                                </Link>
                            ) : <span />}
                        </nav>
                    )}

                    <RelatedPhotos
                        title={photo.displayName
                            ? (locale === "en" ? `More from ${photo.displayName}` : `${photo.displayName}さんの他の写真`)
                            : (locale === "en" ? "More photos" : "他の写真")}
                        photos={related.author}
                        locale={locale}
                        fallbackAlt={photo.displayName
                            ? (locale === "en" ? `Photo by ${photo.displayName}` : `${photo.displayName}さんの写真`)
                            : undefined}
                    />

                    <RelatedPhotos
                        title={locationText
                            ? (locale === "en" ? `More in ${locationText}` : `「${locationText}」の他の写真`)
                            : (locale === "en" ? "Nearby" : "同じ場所の写真")}
                        photos={related.location}
                        locale={locale}
                        fallbackAlt={locationText
                            ? (locale === "en" ? `Photo taken in ${locationText}` : `${locationText}の写真`)
                            : undefined}
                    />
                </div>
            )}

            {/* **コメントの節**（iOS の `commentsBlock`）: 「コメント」15 semibold ＋ 数 15 text-3 の等幅数字、その下に一覧と入力欄（44・C6）。
                吹き出しを押したらここへ送る。ヘッダーは sticky なので、その高さぶん手前で止める（PC。スマホは見出しが無いので 0） */}
            <section ref={commentsRef} aria-labelledby="photo-comments-heading" className="mt-6 px-4 lg:px-0"
                     style={{ scrollMarginTop: "var(--header-h)" }} data-testid="photo-comments">
                <h2 id="photo-comments-heading" className="m-0 mb-2 flex items-baseline gap-1.5" style={{ fontSize: "15px", lineHeight: "20px" }}
                    aria-label={locale === "en" ? `Comments (${commentCount})` : `コメント ${commentCount}件`}>
                    <span className="font-semibold text-white">{locale === "en" ? "Comments" : "コメント"}</span>
                    <span className="text-text-3 tabular-nums font-normal">{commentCount}</span>
                </h2>
                <CommentSection
                    photoId={photo.id}
                    photoOwnerId={photo.userId}
                    locale={locale}
                    initialCount={typeof photo.commentCount === "number" ? photo.commentCount : 0}
                    hideHeading
                    onCountChange={setCommentCount}
                />
            </section>
            </div>{/* /右カラム */}
            </div>{/* /2カラム（PC） */}
            </main>
            {viewerOpen && (
                <PhotoViewer
                    images={images}
                    index={shown}
                    onIndexChange={setShown}
                    altFor={(i) => (i === 0 ? altText : `${altText}（${i + 1}/${images.length}）`)}
                    title={titleText || fallbackHeading}
                    liked={isFav}
                    likeCount={likeCount}
                    likePending={likePending}
                    onToggleLike={handleLike}
                    onClose={() => setViewerOpen(false)}
                    restoreRef={heroButtonRef}
                    locale={locale === "en" ? "en" : "ja"}
                />
            )}
        </>
    );
}
