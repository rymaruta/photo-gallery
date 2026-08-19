"use client";
import React from "react";
import Link from "next/link";
import { ShareIcon, LinkIcon, MusicalNoteIcon, ChatBubbleOvalLeftIcon } from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { useMusic } from "../../music/MusicContext";
import type { Photo, Locale } from "@/lib/data/photos";
import { shareToTwitter, shareToLine } from "../../../lib/utils/share";
import { ROUTES } from "../../../lib/routes";
import ProfileLink from "../ProfileLink";

type Props = {
    photo: Photo;
    locale: Locale;
    titleText: string;
    paragraphs: string[];
    locationText: string;
    mapHref?: string;
    mapText: string;
    categoryDisplayMap: Record<string, string>;
    currentUrl: string;
    shareText: string;
    onShare: () => void | Promise<void>;
    onCopyLink: () => void | Promise<void>;
};


const SHARE_STYLE: React.CSSProperties = {
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
    minHeight: "44px",
};

export default function ModalCaption({
    photo, locale, titleText, paragraphs, locationText, mapHref, mapText,
    categoryDisplayMap, currentUrl, shareText, onShare, onCopyLink,
}: Props) {
    const stop = (e: React.MouseEvent | React.TouchEvent) => e.stopPropagation();
    const music = useMusic();

    return (
        <div
            className="flex-shrink-0 overflow-y-auto bg-black text-white/90 px-4 sm:px-6 py-3 sm:py-4"
            style={{
                maxHeight: "calc(100vh - 60vh - 40px)",
                minHeight: "200px",
                WebkitOverflowScrolling: "touch",
            }}
        >
            <div className="text-base sm:text-lg font-medium mb-1">{titleText}</div>

            <div className="text-xs sm:text-sm text-white/60 mb-2">
                {categoryDisplayMap[photo.category ?? ""] ?? (photo.category ?? "")}
            </div>

            {/* 写真BGM: タップでミニプレイヤー再生（閉じても流れ続ける） */}
            {photo.song && (
                <button
                    onClick={(e) => {
                        stop(e);
                        music.play(`photo:${photo.id}`, [photo.song!], 0, locale === "en" ? "Photo BGM" : "この写真のBGM");
                    }}
                    onTouchStart={stop}
                    className="mb-2 inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full bg-fuchsia-500/15 ring-1 ring-fuchsia-400/30 text-fuchsia-200 text-xs hover:bg-fuchsia-500/25 active:scale-95 transition"
                    style={SHARE_STYLE}
                >
                    <MusicalNoteIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{photo.song.title}{photo.song.artist ? ` — ${photo.song.artist}` : ""}</span>
                    <PlayIcon className="w-3 h-3 flex-shrink-0" />
                </button>
            )}

            {paragraphs.length > 0 && (
                <div className="mt-2 text-xs sm:text-sm text-white/70" role="note">
                    {paragraphs.map((line, i) => (
                        <p key={i} className={i === 0 ? "" : "mt-2"}>{line}</p>
                    ))}
                </div>
            )}

            {locationText && (
                <div className="mt-3">
                    <div className="text-xs sm:text-sm text-white/50 truncate" title={locationText}>
                        {locationText}
                    </div>
                    {mapHref && (
                        <div className="mt-2">
                            <a
                                href={mapHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-xs sm:text-sm text-white/50 underline hover:text-white/70 transition-colors"
                                onClick={stop}
                                aria-label={mapText}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" className="text-white/60">
                                    <path d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6z" fill="currentColor" />
                                    <circle cx="12" cy="8" r="2.2" fill="black" />
                                </svg>
                                <span>{mapText}</span>
                            </a>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-3 text-xs text-white/50">
                {photo.photographer && <span>{photo.photographer}</span>}
                {photo.photographer && photo.license && <span className="mx-2">·</span>}
                {photo.license && <span>{photo.license}</span>}
            </div>

            {/* 撮影者リンク */}
            {photo.userId && photo.displayName && (
                <div className="mt-3">
                    <ProfileLink
                        userId={photo.userId}
                        displayName={photo.displayName}
                        uploaderUsername={photo.uploaderUsername}
                        size="sm"
                        onClick={stop}
                    />
                </div>
            )}

            {/* 撮影情報（簡易版）: ビルド前の新着写真は個別ページが無く
                モーダルでしか見られないため、ここにも1行で出す */}
            {photo.exif && (() => {
                const e = photo.exif;
                const parts = [
                    e.camera, e.lens, e.aperture, e.exposure,
                    e.iso ? `ISO${e.iso}` : undefined, e.focalLength,
                ].filter(Boolean);
                return parts.length > 0 ? (
                    <p className="mt-3 text-[11px] leading-relaxed text-white/45">{parts.join(" ・ ")}</p>
                ) : null;
            })()}

            {/* コメント数（個別ページで読める） */}
            {typeof photo.commentCount === "number" && photo.commentCount > 0 && (
                <p className="mt-2 text-xs text-white/50 inline-flex items-center gap-1.5">
                    <ChatBubbleOvalLeftIcon className="w-3.5 h-3.5" />
                    {locale === "en" ? `${photo.commentCount} comments` : `コメント ${photo.commentCount}件`}
                </p>
            )}

            {/* 行く + 個別ページへのリンク */}
            <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-2">
                <Link
                    href={ROUTES.PHOTO(photo.id)}
                    onClick={stop}
                    onTouchStart={stop}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-white/10 hover:bg-white/20 active:scale-[0.98] text-white rounded-full transition"
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", minHeight: "44px" }}
                >
                    <span>{locale === "en" ? "View Full Page" : "個別ページを見る"}</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                </Link>
            </div>

            {/* 共有 */}
            <div className="mt-4 pt-3 border-t border-white/10 pb-4">
                <div className="flex items-center gap-2.5">
                    <span className="text-xs text-white/50 mr-1">{locale === "en" ? "Share:" : "共有:"}</span>
                    <button
                        onClick={(e) => { stop(e); void onShare(); }}
                        onTouchStart={stop}
                        className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/70 hover:text-white transition"
                        aria-label={locale === "en" ? "Share" : "共有"}
                        title={locale === "en" ? "Share" : "共有"}
                        style={SHARE_STYLE}
                    >
                        <ShareIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={(e) => { stop(e); void onCopyLink(); }}
                        onTouchStart={stop}
                        className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/70 hover:text-white transition"
                        aria-label={locale === "en" ? "Copy link" : "リンクをコピー"}
                        title={locale === "en" ? "Copy link" : "リンクをコピー"}
                        style={SHARE_STYLE}
                    >
                        <LinkIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={(e) => { stop(e); shareToTwitter(currentUrl, shareText); }}
                        onTouchStart={stop}
                        className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/70 hover:text-white transition"
                        aria-label="Share on X"
                        title="X (Twitter)"
                        style={SHARE_STYLE}
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                    </button>
                    {locale === "ja" && (
                        <button
                            onClick={(e) => { stop(e); shareToLine(currentUrl, shareText); }}
                            onTouchStart={stop}
                            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white/70 hover:text-white transition"
                            aria-label="Share on LINE"
                            title="LINE"
                            style={SHARE_STYLE}
                        >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.63.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.086.766.063 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
