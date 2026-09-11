"use client";

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/solid";
import { HeartIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline } from "@heroicons/react/24/outline";
import { ShareIcon, LinkIcon } from "@heroicons/react/24/outline";
import type { Photo } from "@/lib/data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "@/lib/data/photos";
import { usePhotoLikes } from "../../../lib/hooks/usePhotoLikes";
import { hapticTap } from "../../../lib/utils/haptics";
import { dropCachedPhoto } from "../../../lib/utils/photoCache";
import { parseMusicEmbed } from "../../../lib/utils/music";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { type SongEntry } from "../../music/MusicContext";
import MusicCard from "../../components/MusicCard";
import SongArtwork from "../../components/SongArtwork";
import { MusicalNoteIcon, XMarkIcon, MapPinIcon, CameraIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useToast } from "../../../lib/hooks/useToast";
import { shareUrl, copyToClipboard, shareToTwitter, shareToLine } from "../../../lib/utils/share";
import { siteConfig, generatePhotoStructuredData, generateBreadcrumbStructuredData } from "../../../lib/utils/seo";
import { slugify, collectionPath } from "../../../lib/utils/collections";
import ProfileLink from "../../components/ProfileLink";
import RelatedPhotos from "../../components/RelatedPhotos";
import CommentSection from "../../components/CommentSection";
import { relatedSections, adjacentPhotos } from "../../../lib/utils/related";
import { ROUTES } from "../../../lib/routes";
import { formatMapHash, PHOTO_LINK_ZOOM } from "../../../lib/utils/mapView";
import { formatCameraName, dedupeCameraName } from "../../../lib/utils/cameraName";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";
import { isImageReady } from "../../../lib/utils/imageReady";
import { formatStoredDateTime } from "@/lib/utils/photoDate";
import { isImeKey } from "../../../lib/utils/ime";
import { useSongSearch } from "../../../lib/hooks/useSongSearch";
import { usablePhotoRows } from "../../../lib/utils/apiRows";
import { sessionErrorMessage } from "../../../lib/utils/api";

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
    onExifLoaded
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
}) {
    const [imageError, setImageError] = useState(false);
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
        if (img.complete && img.naturalWidth === 0) { setImageError(true); setPhase("loaded"); return; }
        if (isImageReady(img)) setPhase("loaded");
        else if (!fromHtml) setPhase("pending");
    }, [fromHtml]);

    // データ側 exif が欠けている写真のみ、画像読み込み後に EXIF をクライアント抽出する。
    // exifr は重いので初期バンドルに含めず、必要時だけ動的 import する。
    useEffect(() => {
        if (!extractExif) return;              // 既に photo.exif がある場合は再ダウンロード/解析しない
        if (imageLoading || imageError) return;

        let cancelled = false;
        const loadExif = async () => {
            try {
                const { default: exifr } = await import("exifr"); // 遅延ロード
                const opts = { pick: EXIF_PICK, translateKeys: false } as const;
                let exif: ExtractedExif | null = null;

                if (src.startsWith("http://") || src.startsWith("https://")) {
                    // まず URL を直接試し（CORS が正しければ動作）、ダメなら fetch → blob で再試行
                    try {
                        exif = await exifr.parse(src, opts);
                    } catch {
                        try {
                            const response = await fetch(src, { mode: "cors", credentials: "omit" });
                            if (response.ok) exif = await exifr.parse(await response.blob(), opts);
                        } catch (fetchError) {
                            log.warn("Failed to fetch image for EXIF:", fetchError);
                        }
                    }
                } else {
                    // ローカルパス（/images/ 等）は URL を直接使用
                    exif = await exifr.parse(src, opts);
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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
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
        <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ minHeight: reserve, position: "relative" }}>
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
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}
            <div className="relative w-full" style={{ minHeight: reserve, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* AVIF があれば優先（詳細=LCP を軽く）、無ければ従来 src(WebP) にフォールバック */}
                <picture className="w-full flex items-center justify-center">
                    {srcAvif && <source type="image/avif" srcSet={srcAvif} />}
                    <img
                        src={src}
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

type RelatedSets = { author: Photo[]; location: Photo[]; prev: Photo | null; next: Photo | null };

type PhotoPageClientProps = {
    photoId: string;
    initialPhoto?: Photo;
    // ビルド時にサーバで計算した回遊リンク。クライアント取得完了までのSSR/初期表示に使う
    initialRelated?: RelatedSets;
};

export default function PhotoPageClient({ photoId, initialPhoto, initialRelated }: PhotoPageClientProps) {
    const { locale, labels } = useLocale();
    const [extractedExif, setExtractedExif] = useState<ExtractedExif | null>(null);
    const [allPhotos, setAllPhotos] = useState<Photo[]>(initialPhoto ? [initialPhoto] : []);
    const [loading, setLoading] = useState(!initialPhoto);
    // API の取得に失敗したか。静的データに無い新着写真の URL では、失敗を
    // 黙ると「写真が見つかりません」＝消されたように読める表示に化ける。
    // 見つからない × 失敗、のときだけ再試行を出す（下の 404 分岐）。
    const [fetchFailed, setFetchFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

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

    // いいね機能（ハート＝ローカルお気に入り + サーバーいいね数）
    const { isAuthenticated, userId: authUserId, loading: authLoading } = useAuth();
    const { liked: isFav, count: likeCount, pending: likePending, toggle: toggleLike } =
        usePhotoLikes(photoId, photo?.likes ?? 0, isAuthenticated, authLoading);


    // 写真BGM: オーナーが1曲添えられる（全員が写真ページで再生できる）
    const isOwnPhoto = isAuthenticated && !!authUserId && photo?.userId === authUserId;
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
    const { showToast } = useToast();

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
        // パンくずの名前。**同じページの `ImageObject` は `name: ""` を出す**
        // ので、ここだけ "Untitled" にすると**同じ写真について2つの
        // 構造化データが違うことを言う**。日本語のサイトなので文言も揃える
        const title = getLocalized(photo.title, locale) || getLocalized(photo.title, "ja") || getLocalized(photo.title, "en")
            || (locale === "en" ? "Untitled" : "無題");
        return generateBreadcrumbStructuredData([
            { name: locale === "en" ? "Home" : "ホーム", url: siteConfig.url },
            { name: title, url: `${siteConfig.url}/photo/${photo.id}` },
        ]);
    }, [photo, locale]);

    // 回遊導線: 同じ投稿者の写真 / 同じ場所の写真 / 前後の写真。
    // クライアント取得前（allPhotos が initialPhoto だけの間）はサーバ計算済みの
    // initialRelated を使う＝静的HTMLに内部リンクが焼き込まれる（SEO）。
    const related = useMemo(() => {
        if (!photo) return { author: [] as Photo[], location: [] as Photo[], prev: null as Photo | null, next: null as Photo | null };
        if (allPhotos.length <= 1 && initialRelated) return initialRelated;
        return {
            ...relatedSections(photo, allPhotos, 8),
            ...adjacentPhotos(photo, allPhotos),
        };
    }, [photo, allPhotos, initialRelated]);

    // ローディング中
    if (loading) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            </main>
        );
    }

    // 写真が見つからない場合は404。ただし **API の取得に失敗している間は
    // 「存在しません」と断定しない**——静的データに無い新着写真だと、
    // 一時的な失敗が「消された」ように読める（実在するのに）。
    if (!photo && fetchFailed) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                    <h1 className="text-3xl font-bold mb-4">
                        {locale === "en" ? "Couldn't load the photo" : "写真を読み込めませんでした"}
                    </h1>
                    <p className="text-white/60 mb-6">
                        {locale === "en"
                            ? "A temporary network problem may be the cause."
                            : "一時的な通信の問題かもしれません。"}
                    </p>
                    <button
                        onClick={() => { setLoading(true); setReloadKey((k) => k + 1); }}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 active:scale-95 transition"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {locale === "en" ? "Retry" : "もう一度読み込む"}
                    </button>
                </div>
            </main>
        );
    }
    if (!photo) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                    <h1 className="text-3xl font-bold mb-4">
                        {locale === "en" ? "Photo Not Found" : "写真が見つかりません"}
                    </h1>
                    <p className="text-white/60 mb-6">
                        {locale === "en" 
                            ? "The photo you are looking for does not exist." 
                            : "お探しの写真は存在しません。"}
                    </p>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
                        style={{ 
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            minHeight: "44px"
                        }}
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        <span>{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                    </Link>
                </div>
            </main>
        );
    }

    const titleText = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const altText = getLocalized(photo.alt, locale) || titleText || "";
    // もう一方の言語のテキスト。視覚非表示(sr-only)で静的HTMLに含め、
    // 日英どちらの検索クエリでも拾えるようにする（既定SSRは ja のため主に英語が対象）
    const otherLocale: "ja" | "en" = locale === "ja" ? "en" : "ja";
    const otherTitle = getLocalized(photo.title, otherLocale);
    const otherParagraphs = getLocalizedParagraphs(photo.description, otherLocale);
    const locationText = typeof photo.location === "string" ? photo.location : "";
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
    const shareText = titleText || "写真";

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
    const categoryDisplayName = photo ? (labels.category?.names?.[photo.category ?? ""] ?? photo.category ?? "") : "";

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
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full">
            {/* ヘッダー */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
                <div className="flex-1">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-2"
                        style={{ 
                            touchAction: "manipulation",
                            WebkitTapHighlightColor: "transparent",
                            minHeight: "44px"
                        }}
                    >
                        <ArrowLeftIcon className="w-4 h-4" />
                        <span className="text-sm">{locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}</span>
                    </Link>
                </div>
            </div>

            {/* PC(lg以上)は2カラム: 左に写真（スクロールに追従）、右に情報。
                モバイルは従来どおり縦積み */}
            <div className="lg:grid lg:grid-cols-5 lg:gap-10 lg:items-start">

            {/* 写真 */}
            <div className="mb-6 relative lg:col-span-3 lg:mb-0 lg:sticky lg:top-8">
                <PhotoImage
                    src={photo.src}
                    alt={altText}
                    focalPoint={photo.focalPoint}
                    blurDataURL={photo.blurDataURL}
                    srcAvif={photo.srcAvif}
                    width={photo.width}
                    height={photo.height}
                    extractExif={!hasStoredExif(photo.exif)}
                    onExifLoaded={setExtractedExif}
                />

            </div>

            {/* 写真情報 */}
            <div className="space-y-4 lg:col-span-2">
                {/* タイトルとカテゴリ */}
                <div>
                    {/* `break-words`: 長い URL・連続文字でページごと横に流れるのを防ぐ
                        （自己紹介・説明と同じ。実測で幅375pxの55文字から超える） */}
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2.5 break-words">{titleText}</h1>
                    {categoryDisplayName && photo.category && (
                        // カテゴリの集約ページへ（内部リンク＝SEO・回遊）
                        <Link
                            href={collectionPath("category", slugify(photo.category, "category"))}
                            className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/10 ring-1 ring-white/10 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
                            style={{ touchAction: "manipulation" }}
                        >
                            {categoryDisplayName}
                        </Link>
                    )}
                </div>

                {/* 説明 */}
                {paragraphs.length > 0 && (
                    <div className="text-sm sm:text-base text-white/80 leading-relaxed break-words">
                        {paragraphs.map((line, i) => (
                            <p key={i} className={i === 0 ? "" : "mt-3"}>
                                {line}
                            </p>
                        ))}
                    </div>
                )}

                {/* 他言語のタイトル/説明（視覚非表示・検索エンジン向け。見た目は不変） */}
                {((otherTitle && otherTitle !== titleText) || (otherParagraphs.length > 0 && otherParagraphs.join(" ") !== paragraphs.join(" "))) && (
                    <div className="sr-only" lang={otherLocale}>
                        {otherTitle && otherTitle !== titleText && <p>{otherTitle}</p>}
                        {otherParagraphs.join(" ") !== paragraphs.join(" ") && otherParagraphs.map((line, i) => (
                            <p key={i}>{line}</p>
                        ))}
                    </div>
                )}

                {/* 場所チップ（地図リンクがあればそのまま地図へ飛べる）＋この場所の写真一覧へ */}
                {locationText && (
                    <div className="flex flex-wrap items-center gap-2">
                        {href ? (
                            <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-sm text-white/75 hover:bg-white/10 hover:text-white active:scale-[0.98] transition"
                                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                                title={locale === "ja" ? "地図で見る" : "View on map"}
                            >
                                <MapPinIcon className="w-4 h-4 text-sky-400 flex-shrink-0" />
                                <span className="truncate">{locationText}</span>
                                <span className="text-[11px] text-white/50 flex-shrink-0">{locale === "ja" ? "地図" : "Map"} ↗</span>
                            </a>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-sm text-white/75">
                                <MapPinIcon className="w-4 h-4 text-sky-400 flex-shrink-0" />
                                <span className="truncate">{locationText}</span>
                            </span>
                        )}
                        {/* 撮影地マップのその位置へ（内部リンク）。おおよその座標
                            （geoApprox）でも出す——地図の側は「おおよそ」の断りを
                            出したうえでピンを立てているので、そこへ飛ぶのは嘘にならない。
                            上の Google マップの chip とは別で、あちらは正確な座標のときだけ */}
                        {mapHash && (
                            <Link
                                href={`${ROUTES.MAP}${mapHash}`}
                                className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "See on the map" : "撮影地マップで見る"}
                            </Link>
                        )}
                        {/* 同じ場所の集約ページへ（内部リンク） */}
                        <Link
                            href={collectionPath("location", slugify(locationText))}
                            className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                            style={{ touchAction: "manipulation" }}
                        >
                            {locale === "en" ? "Photos from here" : "この場所の写真"}
                        </Link>
                    </div>
                )}

                {/* タグ（集約ページへの内部リンク） */}
                {(photo.tags?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {(photo.tags ?? []).map((tag) => (
                            <Link
                                key={tag}
                                href={collectionPath("tag", slugify(tag))}
                                className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                #{tag}
                            </Link>
                        ))}
                    </div>
                )}

                {/* 撮影者とライセンス */}
                {(photo.photographer || photo.license) && (
                    <div className="text-sm text-white/50">
                        {photo.photographer && <span>{photo.photographer}</span>}
                        {photo.photographer && photo.license && <span className="mx-2">·</span>}
                        {photo.license && <span>{photo.license}</span>}
                    </div>
                )}

                {/* アップロードユーザーへのリンク */}
                {photo.userId && photo.displayName && (
                    <div>
                        <ProfileLink
                            userId={photo.userId}
                            displayName={photo.displayName}
                            uploaderUsername={photo.uploaderUsername}
                            size="md"
                        />
                    </div>
                )}

                {/* EXIF情報: カメラのスペックシート風カード（ラベル上・値下の2列グリッド） */}
                {(() => {
                    const specs: Array<{ label: string; value: string; wide?: boolean; href?: string }> = [];
                    const add = (label: string, value: string | number | undefined | null, wide = false, href?: string) => {
                        if (value !== undefined && value !== null && `${value}`.trim() !== "") specs.push({ label, value: `${value}`, wide, href });
                    };
                    // **機種名からその機材の一覧へ行けるようにする。**
                    // 撮影地・カテゴリ・タグは前から集約ページへ繋いであるのに、
                    // カメラだけ行き止まりだった。sitemap に載せても内部リンクが
                    // 1本も無いページは辿ってもらえない。
                    //
                    // **リンクは「保存済みの値」から作る。表示は mergedExif のまま。**
                    // 最初 `mergedExif.camera` から作ったが、あれは端末で抽出した値を
                    // 含む——そして端末抽出が走るのは `extractExif={!hasStoredExif(...)}`
                    // ＝**保存済み exif が無いときだけ**。一方 `valuesFor(p,"camera")` は
                    // 保存済みの値しか見ない。つまり「リンクが抽出値から作られる」
                    // 状況と「その写真が集約に1件も数えられない」状況が**完全に一致**し、
                    //   - 他の写真が同じ機種を保存済み → **飛んだ先に自分が居ない**
                    //   - 誰も保存していない機種 → 静的生成の対象外で**ハード404**
                    // になる（`dynamicParams = false`）。実データで公開30枚中3枚が
                    // 保存済み exif を持たない。
                    const storedCamera = dedupeCameraName(photo.exif?.camera);
                    add(locale === "en" ? "Camera" : "カメラ", mergedExif.camera, false,
                        storedCamera ? collectionPath("camera", slugify(storedCamera, "camera")) : undefined);
                    add(locale === "en" ? "Lens" : "レンズ", mergedExif.lens);
                    add(locale === "en" ? "Aperture" : "絞り", mergedExif.aperture);
                    add(locale === "en" ? "Shutter" : "シャッター速度", mergedExif.exposure);
                    add("ISO", mergedExif.iso);
                    add(locale === "en" ? "Focal Length" : "焦点距離", mergedExif.focalLength);
                    add(locale === "en" ? "White Balance" : "ホワイトバランス", mergedExif.whiteBalance);
                    add(locale === "en" ? "Image Size" : "画像サイズ", mergedExif.imageSize);
                    // 撮影日時は**保存されている通り**に出す。toLocaleString を
                    // 描画中に呼んでいた頃は、ビルド(UTC)と閲覧者のゾーンで
                    // 文字列が食い違ってハイドレーション不一致になり、しかも
                    // 日付だけの値（"2024-10-12"）が UTC 0時として読まれるため
                    // ニューヨークからは前日と表示されていた。
                    const shotAt = formatStoredDateTime(mergedExif.dateTimeOriginal, locale === "en" ? "en" : "ja");
                    if (shotAt) {
                        add(locale === "en" ? "Date Taken" : "撮影日時", shotAt, true);
                    }
                    if (specs.length === 0) return null;
                    return (
                        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 max-w-md">
                            <div className="flex items-center gap-1.5 mb-3">
                                <CameraIcon className="w-3.5 h-3.5 text-white/50" />
                                <span className="text-[11px] tracking-widest uppercase text-white/50">
                                    {locale === "en" ? "Camera Settings" : "撮影情報"}
                                </span>
                            </div>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                                {specs.map((s) => (
                                    <div key={s.label} className={s.wide ? "col-span-2" : ""}>
                                        <dt className="text-[10px] uppercase tracking-wider text-white/50">{s.label}</dt>
                                        <dd className="text-[13px] text-white/85 mt-0.5 break-words">
                                            {/* リンクにするのは行き先がある項目だけ。
                                                見た目（大きさ・色）は変えず、下線だけで示す */}
                                            {s.href
                                                ? <Link href={s.href} className="underline decoration-white/30 underline-offset-2 hover:decoration-white/70">{s.value}</Link>
                                                : s.value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    );
                })()}

                {/* この写真のBGM */}
                {(photoSong || photoYtUrl || isOwnPhoto) && (
                    <div className="pt-4 border-t border-white/10 space-y-2">
                        {photoSong && (
                            <MusicCard
                                key={photoSong.previewUrl}
                                queueKey={`photo:${photoId}`}
                                songs={[photoSong]}
                                label={locale === "en" ? "Photo BGM" : "この写真のBGM"}
                                locale={locale}
                            />
                        )}

                        {/* フル再生MV（YouTube）。大きいので折りたたみ式 */}
                        {mvEmbed && (
                            <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden max-w-md">
                                <div className="flex items-center gap-1.5 px-3.5 py-2.5">
                                    <MusicalNoteIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                                    <span className="text-[11px] tracking-widest uppercase text-white/50">{locale === "en" ? "Full MV" : "フル再生MV"}</span>
                                    <button
                                        onClick={() => setMvOpen((v) => !v)}
                                        aria-expanded={mvOpen}
                                        className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-white/60 hover:text-white active:scale-95 transition"
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
                                <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-2.5 space-y-2 max-w-md">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={songQuery}
                                            onChange={(e) => setSongQuery(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter" && !isImeKey(e.nativeEvent)) { e.preventDefault(); void searchPhotoSongs(); } }}
                                            placeholder={locale === "en" ? "Song or artist" : "曲名・アーティスト名"}
                                            autoFocus
                                            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
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
                                        <p className="text-xs text-amber-400/80">
                                            {locale === "en" ? "Search failed. Try again." : "検索に失敗しました。もう一度お試しください。"}
                                        </p>
                                    )}
                                    {songResults.length > 0 && (
                                        <ul className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden max-h-56 overflow-y-auto no-scrollbar">
                                            {songResults.map((r) => (
                                                <li key={r.id}>
                                                    <button
                                                        onClick={() => void savePhotoSong({ title: r.title, artist: r.artist, artwork: r.artwork, previewUrl: r.previewUrl, trackUrl: r.trackUrl })}
                                                        className="w-full flex items-center gap-2.5 p-2 hover:bg-white/5 active:bg-white/10 transition text-left"
                                                    >
                                                        <SongArtwork src={r.artwork} className="w-8 h-8 rounded object-cover bg-white/10 flex-shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs text-white truncate">{r.title}</p>
                                                            <p className="text-[11px] text-white/50 truncate">{r.artist}</p>
                                                        </div>
                                                        <span className="text-[11px] text-white/50 flex-shrink-0">{locale === "en" ? "Set" : "設定"}</span>
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
                                        <MusicalNoteIcon className="w-3.5 h-3.5 text-fuchsia-300" />
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
                                className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/60 hover:bg-white/10 hover:text-white transition-colors"
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
                                    className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
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

                {/* アクションボタン */}
                <div className="pt-4 border-t border-white/10 space-y-4">

                    <div className="flex flex-wrap gap-2">
                        {/* いいねボタン（数を表示） */}
                        <button
                            onClick={() => {
                                hapticTap();
                                // 失敗すると楽観更新がロールバックしてハートが
                                // 黙って戻る。フォローは文言を出すのに、いいねだけ
                                // 無言だった（SW-b4）
                                void toggleLike().then((r) => {
                                    // 押し直しても直らない失敗（セッション切れ・
                                    // 通信できない）はその文言をそのまま出す
                                    if (!r.ok) showToast(r.message ?? (locale === "en"
                                        ? "Couldn't save your like. Please try again."
                                        : "いいねを保存できませんでした。もう一度お試しください"), "error");
                                });
                            }}
                            disabled={likePending}
                            aria-pressed={isFav}
                            aria-label={isFav
                                ? (locale === "en" ? "Unlike" : "いいねを取り消す")
                                : (locale === "en" ? "Like" : "いいね")}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors disabled:opacity-60 active:scale-[0.98]"
                            style={{
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                                minHeight: "44px"
                            }}
                        >
                            {isFav
                                ? <HeartIcon className="w-5 h-5 text-red-500" />
                                : <HeartIconOutline className="w-5 h-5" />}
                            <span>
                                {isFav
                                    ? (locale === "en" ? "Liked" : "いいね済み")
                                    : (locale === "en" ? "Like" : "いいね")}
                            </span>
                            {likeCount > 0 && (
                                <span className="text-sm text-white/60 tabular-nums">{likeCount}</span>
                            )}
                        </button>

                    </div>

                    {/* 共有: 丸形のガラスアイコンボタン列（プロフィールの共有ボタンと同じ質感） */}
                    <div>
                        <div className="text-[11px] tracking-widest uppercase text-white/50 mb-2.5">
                            {locale === "en" ? "Share" : "共有"}
                        </div>
                        <div className="flex flex-wrap gap-2.5">
                            {([
                                {
                                    key: "native",
                                    label: locale === "en" ? "Share" : "共有",
                                    onClick: handleShare,
                                    icon: <ShareIcon className="w-5 h-5" />,
                                },
                                {
                                    key: "copy",
                                    label: locale === "en" ? "Copy link" : "リンクをコピー",
                                    onClick: handleCopyLink,
                                    icon: <LinkIcon className="w-5 h-5" />,
                                },
                                {
                                    key: "x",
                                    label: locale === "en" ? "Share on X" : "Xで共有",
                                    onClick: () => shareToTwitter(currentUrl, shareText),
                                    icon: (
                                        <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                    ),
                                },
                                ...(locale === "ja"
                                    ? [{
                                        key: "line",
                                        label: "LINEで共有",
                                        onClick: () => shareToLine(currentUrl, shareText),
                                        icon: (
                                            <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.63.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.086.766.063 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                                            </svg>
                                        ),
                                    }]
                                    : []),
                            ]).map((b) => (
                                <button
                                    key={b.key}
                                    onClick={b.onClick}
                                    aria-label={b.label}
                                    title={b.label}
                                    className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white/5 ring-1 ring-white/10 text-white/75 hover:bg-white/10 hover:text-white active:scale-95 transition"
                                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                                >
                                    {b.icon}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                </div>

            </div>{/* /2カラムグリッド */}

            {/* コメント欄 */}
            <div className="mt-8 max-w-2xl">
                <CommentSection
                    photoId={photo.id}
                    photoOwnerId={photo.userId}
                    locale={locale}
                    initialCount={typeof photo.commentCount === "number" ? photo.commentCount : 0}
                />
            </div>

            {/* 回遊導線: 前後の写真 + 同じ投稿者 / 同じ場所 */}
            {(related.prev || related.next || related.author.length > 0 || related.location.length > 0) && (
                <div className="mt-10 space-y-6">
                    {/* 前後の写真（新しい順で隣接） */}
                    {(related.prev || related.next) && (
                        <nav className="flex items-stretch gap-2.5" aria-label={locale === "en" ? "Adjacent photos" : "前後の写真"}>
                            {related.prev ? (
                                <Link
                                    href={ROUTES.PHOTO(related.prev.id)}
                                    data-photo-id={related.prev.id}
                                    className="flex-1 inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 active:scale-[0.99] transition min-w-0"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    <ChevronLeftIcon className="w-5 h-5 flex-shrink-0 text-white/50" />
                                    <span className="min-w-0">
                                        <span className="block text-[10px] uppercase tracking-wider text-white/50">{locale === "en" ? "Newer" : "新しい写真"}</span>
                                        <span className="block text-sm text-white/85 truncate">{getLocalized(related.prev.title, locale) || (locale === "en" ? "Photo" : "写真")}</span>
                                    </span>
                                </Link>
                            ) : <span className="flex-1" />}
                            {related.next ? (
                                <Link
                                    href={ROUTES.PHOTO(related.next.id)}
                                    data-photo-id={related.next.id}
                                    className="flex-1 inline-flex items-center justify-end gap-2 px-4 py-3 rounded-2xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 active:scale-[0.99] transition min-w-0 text-right"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    <span className="min-w-0">
                                        <span className="block text-[10px] uppercase tracking-wider text-white/50">{locale === "en" ? "Older" : "古い写真"}</span>
                                        <span className="block text-sm text-white/85 truncate">{getLocalized(related.next.title, locale) || (locale === "en" ? "Photo" : "写真")}</span>
                                    </span>
                                    <ChevronRightIcon className="w-5 h-5 flex-shrink-0 text-white/50" />
                                </Link>
                            ) : <span className="flex-1" />}
                        </nav>
                    )}

                    <RelatedPhotos
                        title={photo.displayName
                            ? (locale === "en" ? `More from ${photo.displayName}` : `${photo.displayName}さんの他の写真`)
                            : (locale === "en" ? "More photos" : "他の写真")}
                        photos={related.author}
                        locale={locale}
                    />

                    <RelatedPhotos
                        title={locationText
                            ? (locale === "en" ? `More in ${locationText}` : `「${locationText}」の他の写真`)
                            : (locale === "en" ? "Nearby" : "同じ場所の写真")}
                        photos={related.location}
                        locale={locale}
                    />
                </div>
            )}
            </main>
        </>
    );
}
