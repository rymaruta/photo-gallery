"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftIcon, GlobeAltIcon, EyeSlashIcon, ShareIcon, LinkIcon, PencilSquareIcon, PlusIcon, Squares2X2Icon, PhotoIcon as PhotoStackIcon, CalendarDaysIcon, ChatBubbleOvalLeftIcon, MusicalNoteIcon, ChevronDownIcon, RectangleStackIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { parseMusicEmbed, musicServiceLabel, searchSongs, type SongResult } from "../../lib/utils/music";
import { swipeDirection, stepInList } from "../../lib/utils/swipe";
import { haversineKm } from "../../lib/utils/journey";
import { hapticTap } from "../../lib/utils/haptics";
import { buildTrips, tripAutoTitle, tripDisplayTitle, pickTripCover, type Trip } from "../../lib/utils/trips";
import MusicCard from "../components/MusicCard";
import FollowButton, { FollowAction } from "../components/FollowButton";
import { HeartIcon, StarIcon } from "@heroicons/react/24/solid";
import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { themeRingGradient } from "../../lib/utils/color";
import { useLocale } from "../i18n/context";
import { useToast } from "../../lib/hooks/useToast";
import type { Photo } from "@/lib/data/photos";
import { getLocalized } from "@/lib/data/photos";
import { log } from "../../lib/utils/log";
import { getCurrentSession } from "../../lib/auth/cognito";
import { copyToClipboard, shareToTwitter, shareToLine } from "../../lib/utils/share";
import { publicFetch, userFetch } from "../../lib/utils/api";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "../components/UserAvatar";
import PHOTOS_JSON from "../data/photos.json";

type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

type UserProfile = {
    userId: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
    songUrl?: string;
    songStart?: number;
    songEnd?: number;
    songTitle?: string;
    songArtist?: string;
    songArtwork?: string;
    songPreviewUrl?: string;
    songTrackUrl?: string;
    songs?: SongEntry[];
    ranking?: { title?: string; items: string[] };
    tripTitles?: Record<string, string>;
    tripCovers?: Record<string, string>;
    tripSongs?: Record<string, SongEntry>;
    themeColor?: string;
    statusText?: string;
    pinnedPhotoIds?: string[];
};

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

// Leaflet は window 依存のため SSG では読み込まない

type TabKey = "posts" | "trips" | "timeline";
const TAB_ORDER: TabKey[] = ["posts", "trips", "timeline"];

// 写真を「YYYY年 / M月」で時系列グループ化（撮影日 date 優先、なければ createdAt）
type TimelineGroup = { key: string; year: string; label: string; photos: Photo[] };
function buildTimeline(photos: Photo[], locale: "ja" | "en"): TimelineGroup[] {
    const withDate = photos
        .map((p) => ({ p, t: Date.parse(String(p.date ?? p.createdAt ?? "")) }))
        .filter((x) => !isNaN(x.t))
        .sort((a, b) => b.t - a.t);
    const map = new Map<string, TimelineGroup>();
    for (const { p, t } of withDate) {
        const d = new Date(t);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const key = `${y}-${m}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                year: String(y),
                label: locale === "en"
                    ? d.toLocaleDateString("en-US", { year: "numeric", month: "long" })
                    : `${y}年${m}月`,
                photos: [],
            });
        }
        map.get(key)!.photos.push(p);
    }
    return Array.from(map.values());
}

// ヒーロー背景としてのカバー写真。上部の横長バンドに写真をくっきり表示し、
// バンドの下は黒（フェードで徐々に黒くする演出はしない）。
function CoverBackground({ userId }: { userId: string }) {
    const [coverError, setCoverError] = useState(false);
    const coverUrl = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}/cover` : "";
    const hasCover = coverUrl && !coverError;

    return (
        <div className="absolute inset-0 overflow-hidden bg-black" aria-hidden="true">
            {hasCover ? (
                <>
                    {/* カバーは上部の横長バンドに限定（縦長ヒーロー全体を object-cover で
                        覆うと強く切り取られ "どアップ" に見えるため）。写真は暗くしない。 */}
                    <div className="absolute top-0 inset-x-0 h-56 sm:h-64 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={coverUrl}
                            alt=""
                            className="w-full h-full object-cover object-center"
                            onError={() => setCoverError(true)}
                        />
                        {/* 戻るリンクの視認性用に上端のみ薄いスクリム（全体は暗くしない） */}
                        <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black/45 to-transparent" />
                    </div>
                    {/* バンド下端から下は黒（グラデーションなし） */}
                    <div className="absolute inset-x-0 top-56 sm:top-64 bottom-0 bg-black" />
                </>
            ) : (
                <div className="w-full h-full bg-black" />
            )}
        </div>
    );
}

function PhotoCard({ photo, locale, isOwner, onTogglePublish, pinned = false, onTogglePin, coverSelected = false, onSetCover }: {
    photo: Photo;
    locale: string;
    isOwner: boolean;
    onTogglePublish?: (id: string, published: boolean) => void;
    pinned?: boolean;
    onTogglePin?: (id: string, pin: boolean) => void;
    coverSelected?: boolean;
    onSetCover?: (id: string) => void;
}) {
    const [imageError, setImageError] = useState(false);
    const title = getLocalized(photo.title, locale as "ja" | "en") || (typeof photo.title === "string" ? photo.title : "");
    const isHidden = photo.published === false;

    const likeCount = typeof photo.likes === "number" && photo.likes > 0 ? photo.likes : 0;

    return (
        <div className="relative rounded-md overflow-hidden group" style={{ paddingTop: "100%" }}>
            <Link
                href={ROUTES.PHOTO(photo.id)}
                className={`absolute inset-0 overflow-hidden bg-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${isHidden ? "opacity-40" : ""}`}
                style={photo.dominantColor ? { backgroundColor: photo.dominantColor } : undefined}
            >
                {!imageError ? (
                    <Image
                        src={photo.thumbSrc ?? photo.src}
                        alt={title}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        sizes="(max-width:640px) 33vw, (max-width:1024px) 25vw, 20vw"
                        loading="lazy"
                        onError={() => setImageError(true)}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                        <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                )}
                {/* ホバー: いいね数オーバーレイ */}
                {likeCount > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <HeartIcon className="w-5 h-5 text-white" />
                        <span className="text-white font-semibold text-sm tabular-nums">{likeCount}</span>
                    </div>
                )}
            </Link>

            {/* ピン留め: オーナーはトグル、訪問者にはバッジ */}
            {isOwner && onTogglePin ? (
                <button
                    onClick={(e) => { e.preventDefault(); onTogglePin(photo.id, !pinned); }}
                    className={`absolute top-1.5 left-1.5 p-1.5 rounded-full transition-colors z-10 ${
                        pinned
                            ? "bg-amber-400/90 text-black"
                            : "bg-black/0 text-white/0 hover:bg-black/60 hover:text-white/80"
                    }`}
                    title={pinned ? (locale === "en" ? "Unpin" : "ピン留め解除") : (locale === "en" ? "Pin to top" : "先頭にピン留め")}
                >
                    {pinned ? <StarIcon className="w-4 h-4" /> : <StarIconOutline className="w-4 h-4" />}
                </button>
            ) : pinned ? (
                <span className="absolute top-1.5 left-1.5 p-1 rounded-full bg-black/50 text-amber-300 z-10 pointer-events-none">
                    <StarIcon className="w-3.5 h-3.5" />
                </span>
            ) : null}

            {/* 自分のプロフィール: 公開/非公開トグル */}
            {isOwner && (
                <button
                    onClick={(e) => { e.preventDefault(); onTogglePublish?.(photo.id, !isHidden); }}
                    className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-colors z-10 ${
                        isHidden
                            ? "bg-black/80 text-white/80 hover:bg-black"
                            : "bg-black/0 text-white/0 hover:bg-black/60 hover:text-white/80"
                    }`}
                    title={isHidden ? (locale === "en" ? "Show" : "公開する") : (locale === "en" ? "Hide" : "非公開にする")}
                >
                    <EyeSlashIcon className="w-4 h-4" />
                </button>
            )}

            {/* 旅アルバムのカバー選択（オーナーのみ・右下） */}
            {isOwner && onSetCover && (
                <button
                    onClick={(e) => { e.preventDefault(); onSetCover(photo.id); }}
                    className={`absolute bottom-1.5 right-1.5 p-1.5 rounded-full transition-colors z-10 ${
                        coverSelected
                            ? "bg-sky-400/90 text-black"
                            : "bg-black/0 text-white/0 hover:bg-black/60 hover:text-white/80"
                    }`}
                    title={coverSelected
                        ? (locale === "en" ? "Cover (tap to reset)" : "カバー中（タップで自動に戻す）")
                        : (locale === "en" ? "Use as cover" : "この写真をカバーにする")}
                >
                    <PhotoStackIcon className="w-4 h-4" />
                </button>
            )}

            {/* 非公開バッジ */}
            {isOwner && isHidden && (
                <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 bg-black/80 rounded text-xs text-white/70 pointer-events-none">
                    {locale === "en" ? "Hidden" : "非公開"}
                </div>
            )}
        </div>
    );
}

// 旅アルバムのカード。カバー写真 + タイトル + 期間/枚数/距離。タップで写真を展開。
// オーナーは展開時に旅の名前を編集できる（カスタム名はプロフィールに保存され全員に見える）。
function TripCard({ trip, locale, isOwner, onTogglePublish, open, onToggle, customTitle, onRename, coverId, onSetCover, song, onSetSong }: {
    trip: Trip;
    locale: string;
    isOwner: boolean;
    onTogglePublish?: (id: string, published: boolean) => void;
    open: boolean;
    onToggle: () => void;
    customTitle?: string;
    onRename?: (title: string | null) => void;
    coverId?: string;
    onSetCover?: (photoId: string) => void;
    song?: SongEntry;
    onSetSong?: (song: SongEntry | null) => void;
}) {
    const en = locale === "en";
    const cover = pickTripCover(trip, coverId);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    // 旅のBGM設定（オーナーのみ）: インライン曲検索
    const [songPickerOpen, setSongPickerOpen] = useState(false);
    const [songQuery, setSongQuery] = useState("");
    const [songResults, setSongResults] = useState<SongResult[]>([]);
    const [songSearching, setSongSearching] = useState(false);
    const searchTripSongs = async () => {
        const q = songQuery.trim();
        if (!q) return;
        setSongSearching(true);
        try {
            setSongResults(await searchSongs(q));
        } catch {
            setSongResults([]);
        } finally {
            setSongSearching(false);
        }
    };

    const autoTitle = tripAutoTitle(trip, en ? "en" : "ja");
    const title = tripDisplayTitle(trip, customTitle ? { [trip.id]: customTitle } : undefined, en ? "en" : "ja");
    const editable = isOwner && !!onRename;

    const fmt = (t: number) => {
        const d = new Date(t);
        return en ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : `${d.getMonth() + 1}/${d.getDate()}`;
    };
    const sameDay = new Date(trip.start).toDateString() === new Date(trip.end).toDateString();
    const range = sameDay ? fmt(trip.start) : `${fmt(trip.start)} – ${fmt(trip.end)}`;
    const year = new Date(trip.start).getFullYear();
    const stats = [
        en ? `${range}, ${year}` : `${year}年 ${range}`,
        en ? `${trip.photos.length} photos` : `${trip.photos.length}枚`,
        ...(trip.distanceKm >= 1 ? [`${Math.round(trip.distanceKm).toLocaleString()}km`] : []),
    ].join(" ・ ");

    return (
        <div className="rounded-2xl overflow-hidden ring-1 ring-white/10 bg-[#16181c]">
            <button onClick={onToggle} aria-expanded={open} className="relative w-full text-left group" style={{ touchAction: "manipulation" }}>
                <div className="relative w-full" style={{ aspectRatio: "16 / 7" }}>
                    <Image
                        src={cover.src}
                        alt={title}
                        fill
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        sizes="(max-width: 640px) 100vw, 640px"
                        loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                </div>
                <div className="absolute bottom-0 inset-x-0 p-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold leading-tight truncate drop-shadow">{title}</h3>
                        <p className="text-xs text-white/70 mt-0.5">{stats}</p>
                    </div>
                    <ChevronDownIcon className={`w-5 h-5 text-white/70 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                </div>
            </button>
            {open && (
                <>
                    {/* オーナー: 旅の名前を編集 */}
                    {editable && (
                        editing ? (
                            <div className="flex items-center gap-2 px-3 pt-3">
                                <input
                                    type="text"
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { onRename?.(draft.trim() || null); setEditing(false); } }}
                                    maxLength={80}
                                    placeholder={autoTitle}
                                    autoFocus
                                    className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                                />
                                <button
                                    onClick={() => { onRename?.(draft.trim() || null); setEditing(false); }}
                                    className="px-3.5 py-2 rounded-full bg-white text-black text-xs font-semibold hover:bg-white/90 active:scale-95 transition flex-shrink-0"
                                >
                                    {en ? "Save" : "保存"}
                                </button>
                                <button
                                    onClick={() => setEditing(false)}
                                    className="px-2.5 py-2 rounded-full text-white/50 hover:text-white/80 text-xs active:scale-95 transition flex-shrink-0"
                                >
                                    {en ? "Cancel" : "キャンセル"}
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 px-3 pt-2.5">
                                <button
                                    onClick={() => { setDraft(customTitle ?? ""); setEditing(true); }}
                                    className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 active:scale-95 transition"
                                >
                                    <PencilSquareIcon className="w-3.5 h-3.5" />
                                    {en ? "Rename trip" : "旅の名前を変更"}
                                </button>
                                {customTitle && (
                                    <button
                                        onClick={() => onRename?.(null)}
                                        className="text-xs text-white/40 hover:text-white/70 active:scale-95 transition"
                                    >
                                        {en ? "Reset to auto" : "自動タイトルに戻す"}
                                    </button>
                                )}
                            </div>
                        )
                    )}
                    {/* この旅のBGM */}
                    {(song || (editable && onSetSong)) && (
                        <div className="px-2 pt-2 space-y-2">
                            {song && (
                                <MusicCard
                                    key={song.previewUrl}
                                    queueKey={`trip:${trip.id}`}
                                    songs={[song]}
                                    label={en ? "Trip BGM" : "この旅のBGM"}
                                    locale={locale}
                                    autoPlay
                                />
                            )}
                            {editable && onSetSong && (
                                songPickerOpen ? (
                                    <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-2.5 space-y-2">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={songQuery}
                                                onChange={(e) => setSongQuery(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchTripSongs(); } }}
                                                placeholder={en ? "Song or artist" : "曲名・アーティスト名"}
                                                autoFocus
                                                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors"
                                            />
                                            <button
                                                onClick={() => void searchTripSongs()}
                                                disabled={songSearching || !songQuery.trim()}
                                                className="px-3.5 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 transition text-xs disabled:opacity-40 flex items-center justify-center min-w-[56px]"
                                            >
                                                {songSearching
                                                    ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    : (en ? "Search" : "検索")}
                                            </button>
                                            <button
                                                onClick={() => { setSongPickerOpen(false); setSongResults([]); setSongQuery(""); }}
                                                className="px-2 rounded-lg text-white/50 hover:text-white/80 text-xs active:scale-95 transition"
                                            >
                                                {en ? "Cancel" : "閉じる"}
                                            </button>
                                        </div>
                                        {songResults.length > 0 && (
                                            <ul className="rounded-lg ring-1 ring-white/10 divide-y divide-white/5 overflow-hidden max-h-56 overflow-y-auto no-scrollbar">
                                                {songResults.map((r) => (
                                                    <li key={r.id}>
                                                        <button
                                                            onClick={() => {
                                                                onSetSong({ title: r.title, artist: r.artist, artwork: r.artwork, previewUrl: r.previewUrl, trackUrl: r.trackUrl });
                                                                setSongPickerOpen(false);
                                                                setSongResults([]);
                                                                setSongQuery("");
                                                            }}
                                                            className="w-full flex items-center gap-2.5 p-2 hover:bg-white/5 active:bg-white/10 transition text-left"
                                                        >
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img src={r.artwork} alt="" loading="lazy" className="w-8 h-8 rounded object-cover bg-white/10 flex-shrink-0" />
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-xs text-white truncate">{r.title}</p>
                                                                <p className="text-[11px] text-white/50 truncate">{r.artist}</p>
                                                            </div>
                                                            <span className="text-[11px] text-white/40 flex-shrink-0">{en ? "Set" : "設定"}</span>
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
                                            <MusicalNoteIcon className="w-3.5 h-3.5" />
                                            {song ? (en ? "Change BGM" : "BGMを変更") : (en ? "Add a BGM to this trip" : "この旅にBGMを付ける")}
                                        </button>
                                        {song && (
                                            <button
                                                onClick={() => onSetSong(null)}
                                                className="text-xs text-white/40 hover:text-white/70 active:scale-95 transition"
                                            >
                                                {en ? "Remove" : "外す"}
                                            </button>
                                        )}
                                    </div>
                                )
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-1 p-1 pt-2">
                        {trip.photos.map((photo) => (
                            <PhotoCard
                                key={photo.id}
                                photo={photo}
                                locale={locale}
                                isOwner={isOwner}
                                onTogglePublish={onTogglePublish}
                                coverSelected={photo.id === cover.id}
                                onSetCover={editable && onSetCover ? onSetCover : undefined}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ユーザープロフィール画面本体。
// /users/<id>（静的生成・OGP付き）と /users?id=<id>（新規ユーザー向けフォールバック）の
// 両方から使われる。
export default function UserProfileClient({ userId }: { userId: string }) {
    const { locale } = useLocale();
    const { showToast } = useToast();

    // ビルド時 JSON から同期的に初期表示（API 待ちなし）。
    // userId が変わるケースは呼び出し側の key={userId} でコンポーネントごと作り直す。
    const [photos, setPhotos] = useState<Photo[]>(
        () => (PHOTOS_JSON as Photo[]).filter(p => p.userId === userId),
    );
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [isOwner, setIsOwner] = useState(false);
    const [viewerAuthed, setViewerAuthed] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            try {
                const userApiBase = process.env.NEXT_PUBLIC_USER_API_BASE_URL ?? "";
                const [profileRes, sessionResult] = await Promise.all([
                    fetch(`${userApiBase}/profile/${encodeURIComponent(userId)}`, { signal: controller.signal }),
                    getCurrentSession(),
                ]);
                if (profileRes.ok) {
                    const prof = await profileRes.json() as UserProfile;
                    setUserProfile(prof);
                }
                if (sessionResult) setViewerAuthed(true);
                const isCurrentUserOwner = !!sessionResult &&
                    (sessionResult.getIdToken().payload["sub"] as string | undefined) === userId;
                if (isCurrentUserOwner) setIsOwner(true);

                // API から最新の写真を取得。オーナーも取得することで、アップロードや
                // 場所の修正がビルドを待たずに足あと・地名へ即反映される。
                // オーナーは API に無いビルド時JSONの写真（非公開など）を残してマージする。
                const photosRes = await publicFetch(`/photos?userId=${encodeURIComponent(userId)}`, {
                    signal: controller.signal,
                    cache: "no-store",
                });
                if (photosRes.ok) {
                    const data = await photosRes.json() as unknown;
                    if (Array.isArray(data)) {
                        const fresh = data as Photo[];
                        if (isCurrentUserOwner) {
                            setPhotos((prev) => {
                                const ids = new Set(fresh.map((p) => p.id));
                                return [...fresh, ...prev.filter((p) => !ids.has(p.id))];
                            });
                        } else {
                            setPhotos(fresh);
                        }
                    }
                }
            } catch (e) {
                if ((e as { name?: string }).name !== "AbortError") {
                    log.error("user profile fetch error:", e);
                }
            }
        };
        void load();
        return () => controller.abort();
    }, [userId]);

    const displayName = useMemo(() => {
        if (userProfile?.displayName) return userProfile.displayName;
        return photos.find(p => p.displayName)?.displayName ?? null;
    }, [userProfile, photos]);

    const publishedPhotos = useMemo(
        () => photos.filter(p => p.published !== false),
        [photos]
    );

    // 表示対象の写真（オーナーは非公開含む）
    const visiblePhotos = isOwner ? photos : publishedPhotos;
    const postCount = visiblePhotos.length;
    const totalLikes = useMemo(
        () => visiblePhotos.reduce((sum, p) => sum + (typeof p.likes === "number" && p.likes > 0 ? p.likes : 0), 0),
        [visiblePhotos]
    );

    const [tab, setTab] = useState<TabKey>("posts");
    const [shareOpen, setShareOpen] = useState(false);
    // プロフィールQRコード（対面共有用）
    const [qrOpen, setQrOpen] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [mvOpen, setMvOpen] = useState(false);


    // タブを横スワイプで切り替え（投稿 ⇄ 足あと ⇄ 年表）。
    // Pointer Events で PC(マウス)・スマホ(タッチ)・ペンを一本化。
    // touch-action: pan-y を併用し、縦スクロールは残しつつ横ジェスチャを JS が拾う。
    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
    const onTabPointerDown = useCallback((e: React.PointerEvent) => {
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
    }, []);
    const onTabPointerUp = useCallback((e: React.PointerEvent) => {
        const s = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!s) return;
        const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y);
        if (dir !== 0) {
            hapticTap(8);
            setTab((cur) => stepInList(TAB_ORDER, cur, dir));
        }
    }, []);


    const timeline = useMemo(() => buildTimeline(visiblePhotos, locale as "ja" | "en"), [visiblePhotos, locale]);

    // 旅アルバム: 撮影日の間隔で自動グルーピング
    const trips = useMemo(() => buildTrips(visiblePhotos), [visiblePhotos]);
    const [openTripId, setOpenTripId] = useState<string | null>(null);

    // プロフィール項目の部分更新。PUT は全置換のため、既知の項目を丸ごと送り返す。
    const saveProfilePatch = useCallback(async (patch: Partial<UserProfile>, successMsg: string) => {
        const prev = userProfile;
        // 楽観的更新
        setUserProfile((p) => (p ? { ...p, ...patch } : ({ userId, ...patch } as UserProfile)));
        try {
            const base = userProfile ?? ({ userId } as UserProfile);
            const res = await userFetch("/user/profile", {
                method: "PUT",
                body: JSON.stringify({
                    displayName: base.displayName,
                    bio: base.bio,
                    instagram: base.instagram,
                    website: base.website,
                    songUrl: base.songUrl,
                    songStart: base.songStart,
                    songEnd: base.songEnd,
                    songTitle: base.songTitle,
                    songArtist: base.songArtist,
                    songArtwork: base.songArtwork,
                    songPreviewUrl: base.songPreviewUrl,
                    songTrackUrl: base.songTrackUrl,
                    songs: base.songs,
                    ranking: base.ranking,
                    tripTitles: base.tripTitles,
                    tripCovers: base.tripCovers,
                    tripSongs: base.tripSongs,
                    themeColor: base.themeColor,
                    statusText: base.statusText,
                    pinnedPhotoIds: base.pinnedPhotoIds,
                    ...patch,
                }),
            });
            if (!res.ok) throw new Error(String(res.status));
            showToast(successMsg, "success");
        } catch {
            setUserProfile(prev ?? null);
            showToast(locale === "en" ? "Failed to save" : "保存に失敗しました", "error");
        }
    }, [userProfile, userId, locale, showToast]);

    // 旅のカスタム名（オーナーが編集可能・プロフィールに保存され全員に見える）
    const tripTitles = userProfile?.tripTitles;
    const renameTrip = useCallback(async (tripId: string, title: string | null) => {
        const next = { ...(userProfile?.tripTitles ?? {}) };
        if (title) next[tripId] = title; else delete next[tripId];
        await saveProfilePatch({ tripTitles: next }, locale === "en" ? "Trip name saved" : "旅の名前を保存しました");
    }, [userProfile?.tripTitles, saveProfilePatch, locale]);

    // 旅アルバムのカバー写真（同じ写真をもう一度選ぶと自動に戻る）
    const tripCovers = userProfile?.tripCovers;
    const setTripCover = useCallback(async (tripId: string, photoId: string) => {
        const next = { ...(userProfile?.tripCovers ?? {}) };
        const reset = next[tripId] === photoId;
        if (reset) delete next[tripId]; else next[tripId] = photoId;
        await saveProfilePatch(
            { tripCovers: next },
            reset
                ? (locale === "en" ? "Cover reset to auto" : "カバーを自動に戻しました")
                : (locale === "en" ? "Cover updated 🖼" : "カバーを設定しました 🖼"),
        );
    }, [userProfile?.tripCovers, saveProfilePatch, locale]);

    // 旅アルバムのBGM（1旅1曲）。null で解除
    const tripSongs = userProfile?.tripSongs;
    const setTripSong = useCallback(async (tripId: string, song: SongEntry | null) => {
        const next = { ...(userProfile?.tripSongs ?? {}) };
        if (song) next[tripId] = song; else delete next[tripId];
        await saveProfilePatch(
            { tripSongs: next },
            song
                ? (locale === "en" ? "Trip BGM set 🎵" : "この旅のBGMを設定しました 🎵")
                : (locale === "en" ? "Trip BGM removed" : "この旅のBGMを外しました"),
        );
    }, [userProfile?.tripSongs, saveProfilePatch, locale]);

    // ピン留め（投稿タブ先頭に固定・最大3枚・全員に見える）
    const pinnedPhotoIds = useMemo(() => userProfile?.pinnedPhotoIds ?? [], [userProfile?.pinnedPhotoIds]);
    const togglePin = useCallback(async (photoId: string, pin: boolean) => {
        const cur = userProfile?.pinnedPhotoIds ?? [];
        if (pin && cur.length >= 3) {
            showToast(locale === "en" ? "You can pin up to 3 photos" : "ピン留めは3枚までです", "info");
            return;
        }
        const next = pin ? [...cur, photoId] : cur.filter((id) => id !== photoId);
        await saveProfilePatch(
            { pinnedPhotoIds: next },
            pin
                ? (locale === "en" ? "Pinned to top ⭐" : "先頭にピン留めしました ⭐")
                : (locale === "en" ? "Unpinned" : "ピン留めを解除しました"),
        );
    }, [userProfile?.pinnedPhotoIds, saveProfilePatch, locale, showToast]);

    // 投稿タブの表示順: ピン留めが先頭
    const orderedPhotos = useMemo(() => {
        if (pinnedPhotoIds.length === 0) return visiblePhotos;
        const pinned = pinnedPhotoIds
            .map((id) => visiblePhotos.find((p) => p.id === id))
            .filter((p): p is Photo => !!p);
        const rest = visiblePhotos.filter((p) => !pinnedPhotoIds.includes(p.id));
        return [...pinned, ...rest];
    }, [visiblePhotos, pinnedPhotoIds]);

    // 足あとサマリー: 訪れた場所数（ユニークな location）と旅の期間（撮影日の最古〜最新）
    const footprint = useMemo(() => {
        const places = new Set<string>();
        for (const p of visiblePhotos) {
            const loc = (p.location ?? "").trim().toLowerCase();
            if (loc) places.add(loc);
        }
        const times = visiblePhotos
            .map(p => Date.parse(String(p.date ?? p.createdAt ?? "")))
            .filter(t => !isNaN(t))
            .sort((a, b) => a - b);

        // 旅した総移動距離: 位置情報つき写真を撮影日順につなぎ、大円距離を積算
        const geo = visiblePhotos
            .filter(p => p.coords && typeof p.coords.lat === "number" && typeof p.coords.lng === "number")
            .map(p => ({ c: p.coords as { lat: number; lng: number }, t: Date.parse(String(p.date ?? p.createdAt ?? "")) }))
            .filter(x => !isNaN(x.t))
            .sort((a, b) => a.t - b.t);
        let distanceKm = 0;
        for (let i = 1; i < geo.length; i++) distanceKm += haversineKm(geo[i - 1].c, geo[i].c);

        return { places: places.size, first: times[0], last: times[times.length - 1], distanceKm, geoCount: geo.length };
    }, [visiblePhotos]);


    // 訪れた場所（地名）を新しい順・重複なしで。抽象的な「N箇所」ではなく実際の地名を見せる。

    // テーマソング: 保存された URL を埋め込みプレイヤーに変換（好きな部分の開始・終了つき）
    const songEmbed = useMemo(
        () => (userProfile?.songUrl ? parseMusicEmbed(userProfile.songUrl, userProfile.songStart, userProfile.songEnd) : null),
        [userProfile?.songUrl, userProfile?.songStart, userProfile?.songEnd],
    );

    // 共有には常に正規URL（静的生成済みなら /users/<id>）を使う
    const shareUrl = useMemo(() => {
        const path = ROUTES.USER_PROFILE(userId);
        return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    }, [userId]);

    const handleTogglePublish = useCallback(async (photoId: string, publish: boolean) => {
        try {
            const res = await userFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify({ published: publish }),
            });
            if (res.ok) {
                setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, published: publish } : p));
                showToast(publish
                    ? (locale === "en" ? "Photo is now public" : "写真を公開しました")
                    : (locale === "en" ? "Photo is now hidden" : "写真を非公開にしました"),
                    "success"
                );
            } else {
                showToast(locale === "en" ? "Failed to update" : "更新に失敗しました", "error");
            }
        } catch {
            showToast(locale === "en" ? "Failed to update" : "更新に失敗しました", "error");
        }
    }, [locale, showToast]);

    const handleShareProfile = useCallback(async () => {
        try {
            await copyToClipboard(shareUrl);
            showToast(locale === "en" ? "Link copied!" : "リンクをコピーしました", "success");
        } catch {
            showToast(locale === "en" ? "Failed to copy" : "コピーに失敗しました", "error");
        }
    }, [locale, showToast, shareUrl]);

    return (
        <main className="min-h-screen text-white bg-black">
            {/* ヒーロー: カバー写真を背景に、戻る/アバター/名前/統計/アクションを重ねる */}
            <div className="relative">
                <CoverBackground userId={userId} />

                <div className="relative max-w-5xl mx-auto px-4 sm:px-6 md:px-8">
                    {/* 上部バー: 戻る（左）+ 共有（右）。どちらもカバー上のガラスボタンで
                        背景に関わらず視認性を確保し、左右対称でバランスを取る。 */}
                    <div className="pt-4 mb-2 flex items-center justify-between">
                        <Link
                            href="/"
                            aria-label={locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/15 text-white/90 hover:bg-black/60 active:scale-95 transition shadow-lg shadow-black/30"
                        >
                            <ArrowLeftIcon className="w-5 h-5" />
                        </Link>
                        {/* 共有: 戻ると対になる単一のガラスボタン。タップでメニューを開く */}
                        <div className="relative">
                            <button
                                onClick={() => setShareOpen((v) => !v)}
                                aria-haspopup="menu"
                                aria-expanded={shareOpen}
                                className={`inline-flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md ring-1 transition shadow-lg shadow-black/30 active:scale-95 ${shareOpen ? "bg-white text-black ring-white" : "bg-black/40 text-white/90 ring-white/15 hover:bg-black/60"}`}
                                title={locale === "en" ? "Share" : "共有"}
                                aria-label={locale === "en" ? "Share profile" : "プロフィールを共有"}
                            >
                                <ShareIcon className="w-4 h-4" />
                            </button>

                            {shareOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} aria-hidden="true" />
                                    <div role="menu" className="absolute right-0 top-full mt-2 z-50 w-48 rounded-2xl bg-[#16181c]/95 backdrop-blur-md ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in">
                                        <button
                                            role="menuitem"
                                            onClick={() => { setShareOpen(false); void handleShareProfile(); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-white/10 active:bg-white/15 transition text-left"
                                        >
                                            <LinkIcon className="w-[18px] h-[18px] text-white/50" />
                                            {locale === "en" ? "Copy link" : "リンクをコピー"}
                                        </button>
                                        <button
                                            role="menuitem"
                                            onClick={() => { setShareOpen(false); shareToTwitter(shareUrl, displayName ?? ""); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-white/10 active:bg-white/15 transition text-left border-t border-white/5"
                                        >
                                            <svg className="w-[18px] h-[18px] text-white/50" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                                            {locale === "en" ? "Share on X" : "Xで共有"}
                                        </button>
                                        <button
                                            role="menuitem"
                                            onClick={() => { setShareOpen(false); shareToLine(shareUrl, displayName ?? ""); }}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-white/10 active:bg-white/15 transition text-left border-t border-white/5"
                                        >
                                            <ChatBubbleOvalLeftIcon className="w-[18px] h-[18px] text-emerald-400/80" />
                                            {locale === "en" ? "Share on LINE" : "LINEで共有"}
                                        </button>
                                        <button
                                            role="menuitem"
                                            onClick={() => {
                                                setShareOpen(false);
                                                setQrOpen(true);
                                                if (!qrDataUrl) {
                                                    void import("qrcode").then((QRCode) =>
                                                        QRCode.toDataURL(shareUrl, { width: 512, margin: 1 })
                                                            .then(setQrDataUrl)
                                                            .catch(() => { /* 生成失敗時はスピナーのまま */ }),
                                                    );
                                                }
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-white/10 active:bg-white/15 transition text-left border-t border-white/5"
                                        >
                                            <QrCodeIcon className="w-[18px] h-[18px] text-white/50" />
                                            {locale === "en" ? "QR code" : "QRコードを表示"}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* プロフィールヘッダー: アバターだけがカバーバンドの下端に重なり、
                        名前と一言はカバーの外（黒背景）に置く。カバー写真の柄と
                        文字が重なって読みにくくなるのを避けるため。 */}
                    <div className="pb-6 pt-24 sm:pt-32">
                        {/* アバター（オリジナルのオーロラリング: 旅パレットで回転） */}
                        <div className="relative w-fit rounded-full shadow-lg shadow-sky-500/20">
                            {/* 回転するグラデーション層（アバターは静止したまま背面だけ回る） */}
                            <div
                                className="absolute inset-0 rounded-full avatar-orbit"
                                style={{ background: themeRingGradient(userProfile?.themeColor) }}
                                aria-hidden="true"
                            />
                            <div className="relative rounded-full p-[3px]">
                                <div className="rounded-full p-[2px] bg-black">
                                    <UserAvatar userId={userId} className="w-20 h-20 sm:w-24 sm:h-24" iconClassName="w-11 h-11 sm:w-14 sm:h-14" />
                                </div>
                            </div>
                        </div>

                        {/* 名前 + 一言（カバーの下・黒背景の上） */}
                        <div className="mt-3.5 mb-4">
                            <h1 className="text-2xl sm:text-3xl font-bold leading-tight truncate">
                                {displayName ?? (locale === "en" ? "Anonymous" : "ユーザー")}
                            </h1>
                            {userProfile?.statusText && (
                                <div className="mt-2.5 inline-flex items-start gap-2 max-w-full rounded-2xl rounded-tl-md bg-white/[0.06] ring-1 ring-white/10 px-3.5 py-2 story-media-in">
                                    <span aria-hidden className="font-serif text-lg leading-none text-white/30 -mt-0.5 flex-shrink-0">“</span>
                                    <p className="text-[13px] text-white/85 leading-relaxed break-words min-w-0">
                                        {userProfile.statusText}
                                    </p>
                                    <span aria-hidden className="font-serif text-lg leading-none text-white/30 self-end -mb-1 flex-shrink-0">”</span>
                                </div>
                            )}
                        </div>

                    {/* 統計（投稿 / いいね / フォロワー / フォロー中）— 1行にまとめる */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <div className="inline-flex items-baseline gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                            <span className="text-sm font-bold tabular-nums leading-none">{postCount}</span>
                            <span className="text-[11px] text-white/60">{locale === "en" ? "posts" : "投稿"}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5">
                            <HeartIcon className="w-3 h-3 text-rose-400" />
                            <span className="text-sm font-bold tabular-nums leading-none">{totalLikes.toLocaleString()}</span>
                            <span className="text-[11px] text-white/60">{locale === "en" ? "likes" : "いいね"}</span>
                        </div>
                        {/* 3つ目は自明な指標のみ: 旅した距離（GPSがある時だけ）。無ければ出さない */}
                        {footprint.geoCount >= 2 && footprint.distanceKm >= 1 && (
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-md ring-1 ring-white/10 px-3 py-1.5" title={locale === "en" ? "Total distance traveled" : "旅した総移動距離"}>
                                <GlobeAltIcon className="w-3 h-3 text-sky-400" />
                                <span className="text-sm font-bold tabular-nums leading-none">{Math.round(footprint.distanceKm).toLocaleString()}</span>
                                <span className="text-[11px] text-white/60">km</span>
                            </div>
                        )}
                        {/* フォロワー / フォロー中（同じ行に並べる） */}
                        <FollowButton
                            targetUserId={userId}
                            isOwner={isOwner}
                            isAuthenticated={viewerAuthed}
                            locale={locale as "ja" | "en"}
                        />
                    </div>


                    {userProfile?.bio && (
                        <p className="text-sm text-white/85 whitespace-pre-wrap mb-3 leading-relaxed drop-shadow-sm">{userProfile.bio}</p>
                    )}

                    {userProfile?.website && (
                        <div className="flex flex-wrap gap-3">
                            {userProfile.website && /^https?:\/\//.test(userProfile.website) && (
                                <a
                                    href={userProfile.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
                                >
                                    <GlobeAltIcon className="w-3.5 h-3.5" />
                                    <span className="truncate max-w-[180px]">{userProfile.website.replace(/^https?:\/\//, "")}</span>
                                </a>
                            )}
                        </div>
                    )}

                    {/* マイBGM: プレイリスト（検索曲・最大5曲）優先、URL貼付は埋め込み */}
                    {(userProfile?.songs?.length || (userProfile?.songPreviewUrl && userProfile?.songTitle)) ? (
                        <div className="mt-4">
                            <MusicCard
                                queueKey={`bgm:${userId}`}
                                songs={userProfile.songs?.length
                                    ? userProfile.songs
                                    : [{
                                        title: userProfile.songTitle!,
                                        artist: userProfile.songArtist,
                                        artwork: userProfile.songArtwork,
                                        previewUrl: userProfile.songPreviewUrl!,
                                        trackUrl: userProfile.songTrackUrl,
                                    }]}
                                label={locale === "en" ? "My BGM" : "マイBGM"}
                                locale={locale}
                            />
                        </div>
                    ) : songEmbed && (
                        <div className="mt-4 rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden max-w-md">
                            <div className="flex items-center gap-1.5 px-3.5 py-2.5">
                                <MusicalNoteIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                                <span className="text-[11px] tracking-widest uppercase text-white/45">{locale === "en" ? "My BGM" : "マイBGM"}</span>
                                <span className="ml-auto text-[10px] text-white/30">{musicServiceLabel(songEmbed.service)}</span>
                                {/* MV(YouTube)は大きいので折りたたみ式 */}
                                {songEmbed.service === "youtube" && (
                                    <button
                                        onClick={() => setMvOpen((v) => !v)}
                                        aria-expanded={mvOpen}
                                        className="inline-flex items-center gap-0.5 text-[11px] text-white/60 hover:text-white active:scale-95 transition"
                                    >
                                        {mvOpen ? (locale === "en" ? "Hide" : "畳む") : (locale === "en" ? "Play MV" : "MVを開く")}
                                        <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${mvOpen ? "rotate-180" : ""}`} />
                                    </button>
                                )}
                            </div>
                            {songEmbed.service === "youtube" ? (
                                mvOpen && (
                                    <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
                                        <iframe
                                            src={songEmbed.embedUrl}
                                            title="my bgm"
                                            className="absolute inset-0 w-full h-full"
                                            allow="encrypted-media; picture-in-picture; web-share"
                                            referrerPolicy="strict-origin-when-cross-origin"
                                            loading="lazy"
                                        />
                                    </div>
                                )
                            ) : (
                                <iframe
                                    src={songEmbed.embedUrl}
                                    title="my bgm"
                                    className="w-full"
                                    style={{ height: songEmbed.height ?? 152 }}
                                    allow="encrypted-media; autoplay; clipboard-write"
                                    loading="lazy"
                                />
                            )}
                        </div>
                    )}


                    {/* 自分のプロフィール: 編集・アップロード導線（インスタ風） */}
                    {isOwner && (
                        <div className="flex gap-2 mt-4">
                            <Link
                                href="/user/profile"
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-black/30 backdrop-blur-md ring-1 ring-white/15 hover:bg-black/40 text-white text-sm font-medium rounded-full transition-colors"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                <PencilSquareIcon className="w-4 h-4" />
                                {locale === "en" ? "Edit profile" : "プロフィール編集"}
                            </Link>
                            <Link
                                href="/user/upload"
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                <PlusIcon className="w-4 h-4" strokeWidth={2.5} />
                                {locale === "en" ? "Add photos" : "写真を追加"}
                            </Link>
                        </div>
                    )}
                    {isOwner && (
                        <div className="mt-2 text-center">
                            <Link
                                href="/user/drafts"
                                className="inline-flex items-center justify-center px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "Drafts →" : "下書き →"}
                            </Link>
                        </div>
                    )}

                    {/* 他人のプロフィール: フォローボタン（オーナーの操作行と同じ位置） */}
                    {!isOwner && (
                        <div className="flex gap-2 mt-4">
                            <FollowAction
                                targetUserId={userId}
                                isOwner={isOwner}
                                isAuthenticated={viewerAuthed}
                                locale={locale as "ja" | "en"}
                            />
                        </div>
                    )}
                    </div>
                </div>
            </div>

            {/* コンテンツ（黒背景）: 投稿 / 足あとマップ / タイムライン */}
            <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8">
                {/* タブバー */}
                <div className={"grid grid-cols-3 border-t border-white/10 mb-1"}>
                    {([
                        { key: "posts", icon: Squares2X2Icon, label: locale === "en" ? "Posts" : "投稿" },
                        { key: "trips", icon: RectangleStackIcon, label: locale === "en" ? "Trips" : "旅" },
                        { key: "timeline", icon: CalendarDaysIcon, label: locale === "en" ? "Timeline" : "年表" },
                    ] as const).filter(({ key }) => (TAB_ORDER as string[]).includes(key)).map(({ key, icon: Icon, label }) => {
                        const active = tab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setTab(key)}
                                aria-pressed={active}
                                data-profile-tab={key}
                                className={`relative flex items-center justify-center gap-1.5 py-3 text-xs font-medium tracking-wide transition-colors ${active ? "text-white" : "text-white/40 hover:text-white/70"}`}
                                style={{ touchAction: "manipulation" }}
                            >
                                <Icon className="w-4 h-4" />
                                <span>{label}</span>
                                {active && <span className="absolute -top-px inset-x-0 h-0.5 rounded-full" style={{ backgroundColor: userProfile?.themeColor ?? "#ffffff" }} />}
                            </button>
                        );
                    })}
                </div>

                {/* タブ内容: 横スワイプでタブ切替。Leaflet 地図内で始まる操作だけ除外
                     */}
                <div
                    data-testid="tab-swipe-area"
                    onPointerDown={onTabPointerDown}
                    onPointerUp={onTabPointerUp}
                    onPointerCancel={() => { swipeStartRef.current = null; }}
                    style={{ touchAction: "pan-y" }}
                >
                {/* 投稿タブ */}
                {tab === "posts" && (
                    postCount === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-white/40 gap-3">
                            <div className="w-16 h-16 rounded-full border-2 border-white/15 flex items-center justify-center">
                                <PhotoStackIcon className="w-7 h-7" />
                            </div>
                            <p className="text-sm">{locale === "en" ? "No photos yet." : "まだ写真がありません。"}</p>
                            {isOwner && (
                                <Link href="/user/upload" className="mt-1 px-5 py-2 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors">
                                    {locale === "en" ? "Share your first photo" : "最初の写真を投稿"}
                                </Link>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-1 pb-8">
                            {orderedPhotos.map(photo => (
                                <PhotoCard
                                    key={photo.id}
                                    photo={photo}
                                    locale={locale}
                                    isOwner={isOwner}
                                    onTogglePublish={handleTogglePublish}
                                    pinned={pinnedPhotoIds.includes(photo.id)}
                                    onTogglePin={isOwner ? (id, pin) => void togglePin(id, pin) : undefined}
                                />
                            ))}
                        </div>
                    )
                )}

                {/* 旅アルバムタブ: 撮影日から自動生成される旅ごとのアルバム */}
                {tab === "trips" && (
                    <div className="pb-8 pt-2">
                        {trips.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 text-white/40 gap-3">
                                <RectangleStackIcon className="w-10 h-10" />
                                <p className="text-sm text-center max-w-xs">
                                    {locale === "en"
                                        ? "Photos with dates are automatically grouped into trips."
                                        : "撮影日のある写真があると、旅ごとのアルバムが自動でできます。"}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <p className="text-[11px] text-white/40">
                                    {locale === "en"
                                        ? `${trips.length} trips, grouped automatically from your photo dates.`
                                        : `${trips.length}つの旅 — 撮影日から自動でまとまります。`}
                                </p>
                                {trips.map((trip) => (
                                    <TripCard
                                        key={trip.id}
                                        trip={trip}
                                        locale={locale}
                                        isOwner={isOwner}
                                        onTogglePublish={handleTogglePublish}
                                        open={openTripId === trip.id}
                                        onToggle={() => setOpenTripId((cur) => (cur === trip.id ? null : trip.id))}
                                        customTitle={tripTitles?.[trip.id]}
                                        onRename={isOwner ? (title) => void renameTrip(trip.id, title) : undefined}
                                        coverId={tripCovers?.[trip.id]}
                                        onSetCover={isOwner ? (photoId) => void setTripCover(trip.id, photoId) : undefined}
                                        song={tripSongs?.[trip.id]}
                                        onSetSong={isOwner ? (sg) => void setTripSong(trip.id, sg) : undefined}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* タイムラインタブ */}
                {tab === "timeline" && (
                    <div className="pb-8 pt-2">
                        {timeline.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 text-white/40 gap-3">
                                <CalendarDaysIcon className="w-10 h-10" />
                                <p className="text-sm">{locale === "en" ? "No dated photos yet." : "撮影日のある写真がまだありません。"}</p>
                            </div>
                        ) : (
                            <div className="relative pl-6">
                                {/* 縦の軸線 */}
                                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-white/15" />
                                {timeline.map((g) => (
                                    <div key={g.key} className="relative mb-6">
                                        {/* 節点 + 月ラベル */}
                                        <div className="flex items-center gap-2 mb-2 -ml-6">
                                            <span className="w-3.5 h-3.5 rounded-full bg-white ring-4 ring-black flex-shrink-0" />
                                            <span className="text-sm font-bold">{g.label}</span>
                                            <span className="text-[11px] text-white/40">{g.photos.length}{locale === "en" ? "" : "枚"}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-1">
                                            {g.photos.map((photo) => (
                                                <PhotoCard key={photo.id} photo={photo} locale={locale} isOwner={isOwner} onTogglePublish={handleTogglePublish} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                </div>
            </div>

            {/* プロフィールQRコード */}
            {qrOpen && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
                    onClick={() => setQrOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={locale === "en" ? "Profile QR code" : "プロフィールQRコード"}
                >
                    <div
                        className="w-full max-w-[300px] rounded-3xl bg-white p-6 text-center shadow-2xl story-media-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {qrDataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qrDataUrl} alt="QR" className="w-full rounded-xl" />
                        ) : (
                            <div className="aspect-square flex items-center justify-center">
                                <div className="w-8 h-8 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
                            </div>
                        )}
                        <p className="mt-3 text-sm font-bold text-black truncate">
                            {displayName ?? (locale === "en" ? "Profile" : "プロフィール")}
                        </p>
                        <p className="mt-0.5 text-[11px] text-black/50">
                            {locale === "en" ? "Scan to open this profile" : "スキャンしてプロフィールを開く"}
                        </p>
                        <button
                            onClick={() => setQrOpen(false)}
                            className="mt-4 w-full py-2.5 rounded-full bg-black text-white text-sm font-semibold active:scale-[0.98] transition"
                        >
                            {locale === "en" ? "Close" : "閉じる"}
                        </button>
                    </div>
                </div>
            )}
        </main>
    );
}
