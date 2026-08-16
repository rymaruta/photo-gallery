"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/solid";
import { HeartIcon } from "@heroicons/react/24/solid";
import { PaperAirplaneIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartIconOutline } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon as PaperAirplaneIconOutline } from "@heroicons/react/24/outline";
import { ShareIcon, LinkIcon } from "@heroicons/react/24/outline";
import type { Photo } from "@/lib/data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "@/lib/data/photos";
import { usePhotoLikes } from "../../../lib/hooks/usePhotoLikes";
import { useGoTo } from "../../../lib/hooks/useGoTo";
import { hapticTap } from "../../../lib/utils/haptics";
import { searchSongs, parseMusicEmbed, type SongResult } from "../../../lib/utils/music";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { type SongEntry } from "../../music/MusicContext";
import MusicCard from "../../components/MusicCard";
import { MusicalNoteIcon, XMarkIcon, MapPinIcon, CameraIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useToast } from "../../../lib/hooks/useToast";
import { shareUrl, copyToClipboard, shareToTwitter, shareToLine } from "../../../lib/utils/share";
import { siteConfig, generatePhotoStructuredData, generateBreadcrumbStructuredData } from "../../../lib/utils/seo";
import ProfileLink from "../../components/ProfileLink";
import LocaleToggle from "../../components/LocaleToggle";
import RelatedPhotos from "../../components/RelatedPhotos";
import CommentSection from "../../components/CommentSection";
import { sameAuthorPhotos, sameLocationPhotos, adjacentPhotos } from "../../../lib/utils/related";
import { ROUTES } from "../../../lib/routes";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../../i18n/context";
import { log } from "../../../lib/utils/log";

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

// 画像コンポーネント（エラーハンドリング付き、EXIF読み取り機能付き）
function PhotoImage({
    src,
    alt,
    focalPoint,
    blurDataURL,
    extractExif = false,
    onExifLoaded
}: {
    src: string;
    alt: string;
    focalPoint?: { x: number; y: number };
    blurDataURL?: string;
    // データ側 exif が無い写真だけ true。画像から EXIF をクライアント抽出する
    extractExif?: boolean;
    onExifLoaded?: (exif: ExtractedExif | null) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);

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

    return (
        <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ minHeight: "400px", position: "relative" }}>
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
            {imageLoading && !blurDataURL && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                    <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}
            <div className="relative w-full" style={{ minHeight: "400px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Image
                    src={src}
                    alt={alt}
                    width={1200}
                    height={800}
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`w-full h-auto object-contain max-h-[80vh] select-none transition-opacity duration-500 ${imageLoading ? "opacity-0" : "opacity-100"}`}
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 90vw, 1200px"
                    priority
                    style={{
                        WebkitTouchCallout: "none",
                        ...(focalPoint ? { objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%` } : {}),
                    }}
                    onError={() => {
                        setImageError(true);
                        setImageLoading(false);
                    }}
                    onLoad={() => setImageLoading(false)}
                />
            </div>
        </div>
    );
}

type PhotoPageClientProps = {
    photoId: string;
    initialPhoto?: Photo;
};

export default function PhotoPageClient({ photoId, initialPhoto }: PhotoPageClientProps) {
    const { locale, setLocale, labels } = useLocale();
    const [extractedExif, setExtractedExif] = useState<ExtractedExif | null>(null);
    const [allPhotos, setAllPhotos] = useState<Photo[]>(initialPhoto ? [initialPhoto] : []);
    const [loading, setLoading] = useState(!initialPhoto);

    // APIから写真を読み込む（編集済みのデータで静的ビルド時データを上書き）
    useEffect(() => {
        const controller = new AbortController();
        const loadPhotos = async () => {
            try {
                const { publicFetch } = await import("../../../lib/utils/api");
                const response = await publicFetch("/photos", { signal: controller.signal });
                if (response.ok) {
                    const data = await response.json();
                    setAllPhotos(data);
                } else {
                    log.error("写真の取得に失敗しました", { status: response.status });
                }
            } catch (error) {
                if ((error as { name?: string }).name !== "AbortError") {
                    log.error("写真取得エラー:", error);
                }
            } finally {
                setLoading(false);
            }
        };

        loadPhotos();
        return () => controller.abort();
    }, []);

    // 全写真から該当する写真を検索
    const photo = useMemo(() => {
        return allPhotos.find(p => p.id === photoId);
    }, [photoId, allPhotos]);

    // いいね機能（ハート＝ローカルお気に入り + サーバーいいね数）
    const { isAuthenticated, userId: authUserId } = useAuth();
    const { liked: isFav, count: likeCount, pending: likePending, toggle: toggleLike } =
        usePhotoLikes(photoId, photo?.likes ?? 0, isAuthenticated);

    // 「行く」= この場所に行きたい（行きたいリストへ）。行けば投稿者に通知が届く
    const { going, goCount, moved, pending: goPending, toggle: toggleGo } =
        useGoTo(photoId, isAuthenticated);

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
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, {
                method: "PUT",
                body: JSON.stringify({ songYoutubeUrl: url ?? "" }),
            });
            if (!res.ok) throw new Error(String(res.status));
            setPhotoYtUrl(url);
            setYtInput("");
            showToast(
                url ? (locale === "en" ? "MV added 🎬" : "MVを設定しました 🎬") : (locale === "en" ? "MV removed" : "MVを外しました"),
                "success",
            );
        } catch {
            showToast(locale === "en" ? "Invalid YouTube link" : "YouTubeリンクが正しくありません", "error");
        } finally {
            setYtSaving(false);
        }
    };
    const [songPickerOpen, setSongPickerOpen] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    const [songResults, setSongResults] = useState<SongResult[]>([]);
    const [songSearching, setSongSearching] = useState(false);
    const searchPhotoSongs = async () => {
        const q = songQuery.trim();
        if (!q) return;
        setSongSearching(true);
        try { setSongResults(await searchSongs(q)); } catch { setSongResults([]); } finally { setSongSearching(false); }
    };
    const savePhotoSong = async (song: SongEntry | null) => {
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, {
                method: "PUT",
                body: JSON.stringify({ song }),
            });
            if (!res.ok) throw new Error(String(res.status));
            setPhotoSong(song);
            setSongPickerOpen(false);
            setSongResults([]);
            setSongQuery("");
            showToast(
                song
                    ? (locale === "en" ? "Photo BGM set 🎵" : "この写真のBGMを設定しました 🎵")
                    : (locale === "en" ? "Photo BGM removed" : "BGMを外しました"),
                "success",
            );
        } catch {
            showToast(locale === "en" ? "Failed to save" : "保存に失敗しました", "error");
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
            camera: extracted.Make && extracted.Model 
                ? `${extracted.Make} ${extracted.Model}`.trim() 
                : extracted.Make || extracted.Model || fallback.camera || undefined,
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
            dateTimeOriginal: extracted.DateTimeOriginal || fallback.dateTimeOriginal || photo?.date || photo?.createdAt || undefined,
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
        const title = getLocalized(photo.title, locale) || getLocalized(photo.title, "ja") || getLocalized(photo.title, "en") || "Untitled";
        return generateBreadcrumbStructuredData([
            { name: locale === "en" ? "Home" : "ホーム", url: siteConfig.url },
            { name: title, url: `${siteConfig.url}/photo/${photo.id}` },
        ]);
    }, [photo, locale]);

    // 回遊導線: 同じ投稿者の写真 / 同じ場所の写真 / 前後の写真
    const related = useMemo(() => {
        if (!photo) return { author: [] as Photo[], location: [] as Photo[], prev: null as Photo | null, next: null as Photo | null };
        return {
            author: sameAuthorPhotos(photo, allPhotos, 8),
            location: sameLocationPhotos(photo, allPhotos, 8),
            ...adjacentPhotos(photo, allPhotos),
        };
    }, [photo, allPhotos]);

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

    // 写真が見つからない場合は404
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
    const locationText = typeof photo.location === "string" ? photo.location : "";
    const paragraphs = getLocalizedParagraphs(photo.description, locale);

    const preferred = getPreferredMapLink(photo);
    const fallbackHref = photo.coords ? makeGoogleSearch(photo.coords.lat, photo.coords.lng) : undefined;
    const href = preferred?.href ?? fallbackHref;

    // 共有機能
    const currentUrl = typeof window !== "undefined" 
        ? `${window.location.origin}/photo/${photo.id}` 
        : `${siteConfig.url}/photo/${photo.id}`;
    const shareText = titleText || "Photo";

    const handleShare = async (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const usedClipboard = await shareUrl(currentUrl, shareText, paragraphs.join(" "));
        if (usedClipboard) showToast(locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
    };

    const handleCopyLink = async (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        try {
            await copyToClipboard(currentUrl);
            showToast(locale === "en" ? "Link copied!" : "リンクをコピーしました");
        } catch {
            showToast(locale === "en" ? "Failed to copy link" : "リンクのコピーに失敗しました");
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
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
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
                <div className="flex-shrink-0">
                    <LocaleToggle
                        locale={locale}
                        setLocale={setLocale}
                        labels={labels.ui?.language ?? { ja: "日本語", en: "English" }}
                    />
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
                    extractExif={!hasStoredExif(photo.exif)}
                    onExifLoaded={setExtractedExif}
                />

            </div>

            {/* 写真情報 */}
            <div className="space-y-4 lg:col-span-2">
                {/* タイトルとカテゴリ */}
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2.5">{titleText}</h1>
                    {categoryDisplayName && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/10 ring-1 ring-white/10 text-xs text-white/70">
                            {categoryDisplayName}
                        </span>
                    )}
                </div>

                {/* 説明 */}
                {paragraphs.length > 0 && (
                    <div className="text-sm sm:text-base text-white/80 leading-relaxed">
                        {paragraphs.map((line, i) => (
                            <p key={i} className={i === 0 ? "" : "mt-3"}>
                                {line}
                            </p>
                        ))}
                    </div>
                )}

                {/* 場所チップ（地図リンクがあればそのまま地図へ飛べる） */}
                {locationText && (
                    <div>
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
                                <span className="text-[11px] text-white/40 flex-shrink-0">{locale === "ja" ? "地図" : "Map"} ↗</span>
                            </a>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-sm text-white/75">
                                <MapPinIcon className="w-4 h-4 text-sky-400 flex-shrink-0" />
                                <span className="truncate">{locationText}</span>
                            </span>
                        )}
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
                    const specs: Array<{ label: string; value: string; wide?: boolean }> = [];
                    const add = (label: string, value: string | number | undefined | null, wide = false) => {
                        if (value !== undefined && value !== null && `${value}`.trim() !== "") specs.push({ label, value: `${value}`, wide });
                    };
                    add(locale === "en" ? "Camera" : "カメラ", mergedExif.camera);
                    add(locale === "en" ? "Lens" : "レンズ", mergedExif.lens);
                    add(locale === "en" ? "Aperture" : "絞り", mergedExif.aperture);
                    add(locale === "en" ? "Shutter" : "シャッター速度", mergedExif.exposure);
                    add("ISO", mergedExif.iso);
                    add(locale === "en" ? "Focal Length" : "焦点距離", mergedExif.focalLength);
                    add(locale === "en" ? "White Balance" : "ホワイトバランス", mergedExif.whiteBalance);
                    add(locale === "en" ? "Image Size" : "画像サイズ", mergedExif.imageSize);
                    if (mergedExif.dateTimeOriginal) {
                        const d = new Date(mergedExif.dateTimeOriginal);
                        if (!isNaN(d.getTime())) {
                            add(
                                locale === "en" ? "Date Taken" : "撮影日時",
                                d.toLocaleString(locale === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }),
                                true,
                            );
                        }
                    }
                    if (specs.length === 0) return null;
                    return (
                        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 max-w-md">
                            <div className="flex items-center gap-1.5 mb-3">
                                <CameraIcon className="w-3.5 h-3.5 text-white/50" />
                                <span className="text-[11px] tracking-widest uppercase text-white/45">
                                    {locale === "en" ? "Camera Settings" : "撮影情報"}
                                </span>
                            </div>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                                {specs.map((s) => (
                                    <div key={s.label} className={s.wide ? "col-span-2" : ""}>
                                        <dt className="text-[10px] uppercase tracking-wider text-white/35">{s.label}</dt>
                                        <dd className="text-[13px] text-white/85 mt-0.5 break-words">{s.value}</dd>
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
                                    <span className="text-[11px] tracking-widest uppercase text-white/45">{locale === "en" ? "Full MV" : "フル再生MV"}</span>
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
                                            title="photo mv"
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
                                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchPhotoSongs(); } }}
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
                                            onClick={() => { setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                            className="px-2 rounded-lg text-white/50 hover:text-white/80 text-xs active:scale-95 transition"
                                        >
                                            {locale === "en" ? "Cancel" : "閉じる"}
                                        </button>
                                    </div>
                                    {songResults.length > 0 && (
                                        <ul className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden max-h-56 overflow-y-auto no-scrollbar">
                                            {songResults.map((r) => (
                                                <li key={r.id}>
                                                    <button
                                                        onClick={() => void savePhotoSong({ title: r.title, artist: r.artist, artwork: r.artwork, previewUrl: r.previewUrl, trackUrl: r.trackUrl })}
                                                        className="w-full flex items-center gap-2.5 p-2 hover:bg-white/5 active:bg-white/10 transition text-left"
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img src={r.artwork} alt="" loading="lazy" className="w-8 h-8 rounded object-cover bg-white/10 flex-shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs text-white truncate">{r.title}</p>
                                                            <p className="text-[11px] text-white/50 truncate">{r.artist}</p>
                                                        </div>
                                                        <span className="text-[11px] text-white/40 flex-shrink-0">{locale === "en" ? "Set" : "設定"}</span>
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
                                            className="inline-flex items-center gap-0.5 text-xs text-white/40 hover:text-white/70 active:scale-95 transition"
                                        >
                                            <XMarkIcon className="w-3 h-3" />
                                            {locale === "en" ? "Remove" : "外す"}
                                        </button>
                                    )}
                                </div>
                            )
                        )}

                        {/* オーナー: フル再生MV（YouTube リンク）の設定 */}
                        {isOwnPhoto && !songPickerOpen && (
                            <div className="flex items-center gap-2 max-w-md">
                                <input
                                    type="url"
                                    value={ytInput}
                                    onChange={(e) => setYtInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter" && ytInput.trim()) { e.preventDefault(); void savePhotoYoutube(ytInput.trim()); } }}
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
                    {/* この写真が動かした人数 */}
                    {moved > 0 && (
                        <p className="text-sm text-sky-300/90 flex items-center gap-1.5">
                            <PaperAirplaneIcon className="w-4 h-4 -rotate-45" />
                            {locale === "en"
                                ? `This photo has moved ${moved} ${moved === 1 ? "person" : "people"} to travel.`
                                : `この写真は ${moved}人 を旅立たせました`}
                        </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                        {/* いいねボタン（数を表示） */}
                        <button
                            onClick={() => { hapticTap(); void toggleLike(); }}
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

                        {/* 「行く」ボタン: 行きたいリストへ。行けば投稿者に通知が届く */}
                        <button
                            onClick={() => {
                                hapticTap();
                                void (async () => {
                                    const r = await toggleGo();
                                    if (r === "auth-required") {
                                        showToast(locale === "en" ? "Log in to save places you want to visit" : "ログインすると「行く」で行きたいリストに保存できます", "info");
                                    } else if (r === "added") {
                                        showToast(locale === "en" ? "Added to your travel list 🧭" : "行きたいリストに追加しました 🧭", "success");
                                    }
                                })();
                            }}
                            disabled={goPending}
                            aria-pressed={going}
                            aria-label={going
                                ? (locale === "en" ? "Remove from travel list" : "行きたいを取り消す")
                                : (locale === "en" ? "I'll go here" : "この場所に行く")}
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full transition-colors disabled:opacity-60 active:scale-[0.98] ${going ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40" : "bg-white/10 hover:bg-white/20 text-white"}`}
                            style={{
                                touchAction: "manipulation",
                                WebkitTapHighlightColor: "transparent",
                                minHeight: "44px"
                            }}
                        >
                            {going
                                ? <PaperAirplaneIcon className="w-5 h-5 -rotate-45 text-sky-400" />
                                : <PaperAirplaneIconOutline className="w-5 h-5 -rotate-45" />}
                            <span>
                                {going
                                    ? (locale === "en" ? "Going!" : "行く！")
                                    : (locale === "en" ? "I'll go" : "行く")}
                            </span>
                            {goCount > 0 && (
                                <span className="text-sm text-white/60 tabular-nums">{goCount}</span>
                            )}
                        </button>
                    </div>

                    {/* 共有: 丸形のガラスアイコンボタン列（プロフィールの共有ボタンと同じ質感） */}
                    <div>
                        <div className="text-[11px] tracking-widest uppercase text-white/45 mb-2.5">
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
                                        <span className="block text-[10px] uppercase tracking-wider text-white/35">{locale === "en" ? "Newer" : "新しい写真"}</span>
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
                                        <span className="block text-[10px] uppercase tracking-wider text-white/35">{locale === "en" ? "Older" : "前の写真"}</span>
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
