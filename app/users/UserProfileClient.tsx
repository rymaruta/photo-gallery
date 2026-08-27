"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Thumb from "../components/Thumb";
import Link from "next/link";
import { ArrowLeftIcon, GlobeAltIcon, EyeSlashIcon, ShareIcon, LinkIcon, PencilSquareIcon, PlusIcon, Squares2X2Icon, PhotoIcon as PhotoStackIcon, CalendarDaysIcon, ChatBubbleOvalLeftIcon, MusicalNoteIcon, ChevronDownIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import { parseMusicEmbed, musicServiceLabel } from "../../lib/utils/music";
import { swipeDirection, stepInList } from "../../lib/utils/swipe";
import { haversineKm } from "../../lib/utils/journey";
import { hapticTap } from "../../lib/utils/haptics";
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
import { publicFetch, userFetch, userPublicFetch, readApiError } from "../../lib/utils/api";
import { EN_MONTHS } from "../../lib/utils/photoDate";
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
    username?: string;
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
    tripTitles?: Record<string, string>;
    tripCovers?: Record<string, string>;
    tripSongs?: Record<string, SongEntry>;
    themeColor?: string;
    statusText?: string;
    pinnedPhotoIds?: string[];
};

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

// Leaflet は window 依存のため SSG では読み込まない

type TabKey = "posts" | "timeline";
const TAB_ORDER: TabKey[] = ["posts", "timeline"];

// 写真を「YYYY年 / M月」で時系列グループ化（撮影日 date 優先、なければ createdAt）
type TimelineGroup = { key: string; year: string; label: string; photos: Photo[] };
function buildTimeline(photos: Photo[], locale: "ja" | "en"): TimelineGroup[] {
    const withDate = photos
        .map((p) => ({ p, t: Date.parse(String(p.date || p.createdAt || "")) }))
        .filter((x) => !isNaN(x.t))
        .sort((a, b) => b.t - a.t);
    const map = new Map<string, TimelineGroup>();
    for (const { p, t } of withDate) {
        const d = new Date(t);
        // 年月は UTC で切る。撮影日は "2024-01-01" のような日付だけの形で
        // 保存されており、Date.parse はこれを UTC 0時として読む。
        // そこにローカル時刻の getFullYear/getMonth を当てると、
        // UTC より西の閲覧者（例: ニューヨーク）には1日の写真が
        // 前月・前年の見出しに入って見える。
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const key = `${y}-${m}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                year: String(y),
                // 見出しも UTC で組む。グループ分けは UTC なのに英語ラベルだけ
                // toLocaleDateString（ローカル時刻）だったので、UTC より西の
                // 閲覧者には **キーが 2024-1 なのに見出しが "December 2023"**
                // という食い違いが出ていた。
                label: locale === "en" ? `${EN_MONTHS[m - 1]} ${y}` : `${y}年${m}月`,
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
                {/* Thumb が AVIF/256・blur-up・エラー表示まで内包する */}
                <Thumb
                    photo={photo}
                    alt={title}
                    sizes="(max-width:640px) 33vw, (max-width:1024px) 33vw, 340px"
                    className="transition-transform duration-300 group-hover:scale-[1.04]"
                />
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
    // 取得の失敗を無言にしない（SW-b9）。プロフィール（名前・自己紹介・
    // BGM・ピン留め）が黙って出ないと「未設定の人」に見え、オーナーの
    // 一覧が黙って公開分だけになると、非公開が消えたと誤解して目の
    // アイコンを押し直し**本当に再公開してしまう**（下のコメント参照）。
    const [loadError, setLoadError] = useState<"profile" | "ownPhotos" | "photos" | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        // この回でプロフィールを取れたか（catch で「どこが落ちたか」を分ける）
        let profileLoaded = false;
        const load = async () => {
            try {
                // **ここだけ生の環境変数で URL を組み立てていた。**
                // lib/utils/api.ts の getUserApiBaseUrl は、まさにこの問題
                // （NEXT_PUBLIC_USE_LOCAL_API=true でも .env.local に残った
                // 本番のユーザーAPIを叩く）を直すために作られている。
                // 未設定なら `/profile/<id>` になり、静的サイトでは 404 →
                // 下の `if (profileRes.ok)` が握り潰して、名前・自己紹介・
                // BGM・ピン留めが**黙って全部出ない**。
                const [profileRes, sessionResult] = await Promise.all([
                    userPublicFetch(`/profile/${encodeURIComponent(userId)}`, { signal: controller.signal }),
                    getCurrentSession(),
                ]);
                if (profileRes.ok) {
                    const prof = await profileRes.json() as UserProfile;
                    setUserProfile(prof);
                    profileLoaded = true;
                } else {
                    // 名前・自己紹介・BGM・ピン留めが黙って全部出ない状態を
                    // 「未設定」と見分けられるようにする
                    setLoadError("profile");
                }
                if (sessionResult) setViewerAuthed(true);
                const isCurrentUserOwner = !!sessionResult &&
                    (sessionResult.getIdToken().payload["sub"] as string | undefined) === userId;
                if (isCurrentUserOwner) setIsOwner(true);

                // 自分のプロフィールは認証済みの一覧を「正」にする。
                //
                // 以前は公開一覧（published = true だけ）に、ビルド時JSONの
                // 残りをマージしていた。photos.json の写真は全部 published: true
                // なので、非公開にした写真も削除した写真も「公開中」の姿で
                // 復活していた。非公開バッジも出ないので本人には見分けが付かず、
                // もう一度目のアイコンを押すと今度は本当に再公開してしまう。
                if (isCurrentUserOwner) {
                    const mineRes = await userFetch("/user/photos", { signal: controller.signal });
                    if (mineRes.ok) {
                        const mine = await mineRes.json() as unknown;
                        if (Array.isArray(mine)) {
                            setPhotos(mine as Photo[]);
                            return; // 公開一覧は見ない（下書き・非公開まで含む正）
                        }
                    }
                    // **公開一覧で代用しない。** 代用すると非公開・下書きが
                    // 黙って消えて見え、「消えた」と誤解した本人が目のアイコンを
                    // 押し直して**本当に再公開する**誘導になる（この画面の
                    // マージ事故コメントと同じ轍）。失敗は失敗と伝える
                    // **一覧そのものを出さない。** 以前は公開一覧で代用して
                    // いたが、非公開が消えたように見えて誤再公開を誘った。
                    // かといって何もしないと、初期値のビルド時データ
                    // （photos.json は全件 published:true）が「公開中の姿」で
                    // 残り、目のアイコンから**本当に再公開できてしまう**
                    // ——代用先を変えただけで同じ穴だった（レビュー指摘）。
                    log.warn("自分の写真一覧を取得できませんでした");
                    setPhotos([]);
                    setLoadError("ownPhotos");
                    return;
                }

                // API から最新の写真を取得。ビルドを待たずに足あと・地名へ反映される。
                const photosRes = await publicFetch(`/photos?userId=${encodeURIComponent(userId)}`, {
                    signal: controller.signal,
                    cache: "no-store",
                });
                if (photosRes.ok) {
                    const data = await photosRes.json() as unknown;
                    if (Array.isArray(data)) {
                        const fresh = data as Photo[];
                        if (fresh.length > 0) {
                            setPhotos(fresh);
                        } else {
                            // 空配列で静的ビルド時のデータを潰さない。潰すと、
                            // 見えていた写真が「まだ写真がありません」に化ける。
                            log.warn("写真APIが空を返したため静的データを維持します");
                        }
                    }
                }
            } catch (e) {
                if ((e as { name?: string }).name !== "AbortError") {
                    log.error("user profile fetch error:", e);
                    // **どこで落ちたかを取り違えない。** catch は3つの取得
                    // （プロフィール / 自分の一覧 / 公開一覧）で共有なので、
                    // 一律 "profile" にすると「プロフィールは出ているのに
                    // 読み込めませんでしたと出る」誤表示になる（レビュー指摘）。
                    // プロフィールが取れているなら、写真側の失敗として扱う。
                    setLoadError((prev) => prev ?? (profileLoaded ? "photos" : "profile"));
                }
            }
        };
        setLoadError(null);
        void load();
        return () => controller.abort();
    }, [userId, reloadKey]);

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

    // ピン留めの保存に付ける通し番号（応答の追い越しを捨てる）
    const pinSeqRef = useRef(0);

    // プロフィール項目の部分更新。変更する項目だけ送る。
    // `patch` は画面に即反映する見込みの値。`wire` を渡すとそちらを送る
    // （ピン留めのように「配列まるごと」ではなく増減で送りたい場合）。
    const saveProfilePatch = useCallback(async (
        patch: Partial<UserProfile>,
        successMsg: string,
        wire?: Record<string, unknown>,
    ) => {
        // 読み込めていない状態では、楽観的更新の巻き戻し先が無く、
        // 画面と保存内容が食い違ったままになるため保存しない。
        if (!userProfile) {
            showToast(locale === "en"
                ? "Could not load your profile. Please reload and try again."
                : "プロフィールを読み込めていません。再読み込みしてからお試しください。", "error");
            return;
        }
        const prev = userProfile;
        const failMsg = locale === "en" ? "Failed to save" : "保存に失敗しました";
        // **応答の追い越しを捨てる。** ピン留めは連打できるので、先に投げた
        // 要求の応答が後から届く。サーバーは「その要求が書いた時点の姿」を
        // 返すので、そのまま取り込むと**後から届いた古い一覧で新しい一覧を
        // 上書きする**（p1→p2 と押して p1 の応答が遅れると p2 の星が消える。
        // サーバーには2枚あるのに画面は1枚）。最後に投げた分だけを採る。
        const seq = ++pinSeqRef.current;
        const adoptPins = (list: unknown) => {
            if (seq !== pinSeqRef.current) return;
            const pins = Array.isArray(list)
                ? list.filter((x): x is string => typeof x === "string")
                : [];
            setUserProfile((p) => (p ? { ...p, pinnedPhotoIds: pins } : p));
        };
        // 楽観的更新
        setUserProfile((p) => (p ? { ...p, ...patch } : ({ userId, ...patch } as UserProfile)));
        try {
            // PUT は部分更新なので、変更する項目だけ送れば足りる。
            // 以前は全置換だったため全項目を送り返す必要があり、
            // 公開プロフィールAPIが返さなくなった項目が消える事故を起こした。
            const res = await userFetch("/user/profile", {
                method: "PUT",
                body: JSON.stringify(wire ?? patch),
            });
            if (!res.ok) {
                // サーバーの理由をそのまま出す。以前は全部「保存に失敗しました」
                // だったので、上限（409「ピン留めは3枚までです」）を踏んでも
                // 障害と区別が付かず、同じ操作を繰り返すことになっていた。
                //
                // throw で catch に流さないのは、通信そのものが落ちた場合の
                // Error（"Failed to fetch" など英語の生文言）と混ざるため。
                setUserProfile(prev ?? null);
                // **断られた回こそ同期する。** 上限で断るとき、サーバーは
                // 今の一覧を添えてくる。取り込まないと、手元が古いタブは
                // 「星が1つも無いのに3枚までと言われる」まま何度でも同じ
                // ことを繰り返す。本文は clone から読む（readApiError が
                // 同じ res を読むので二度読みにしない）。
                const detail = typeof res.clone === "function"
                    ? await res.clone().json().catch(() => null) as { pinnedPhotoIds?: unknown } | null
                    : null;
                if (detail && Array.isArray(detail.pinnedPhotoIds)) adoptPins(detail.pinnedPhotoIds);
                showToast(await readApiError(res, failMsg), "error");
                return;
            }
            // サーバーが返す保存後の姿でピン留めを揃える。増減で送っている
            // ので、他の端末が先に足した分もここで手元に入る（見込みの値の
            // ままだと、次の操作がまたその1枚を知らないまま送られる）。
            const saved = await res.json().catch(() => null) as { pinnedPhotoIds?: unknown } | null;
            if (saved && "pinnedPhotoIds" in patch) adoptPins(saved.pinnedPhotoIds);
            showToast(successMsg, "success");
        } catch {
            setUserProfile(prev ?? null);
            showToast(failMsg, "error");
        }
    }, [userProfile, userId, locale, showToast]);

    // 旅のカスタム名（オーナーが編集可能・プロフィールに保存され全員に見える）



    // 旅アルバムのカバー写真（同じ写真をもう一度選ぶと自動に戻る）



    // 旅アルバムのBGM（1旅1曲）。null で解除



    // ピン留め（投稿タブ先頭に固定・最大3枚・全員に見える）
    const pinnedPhotoIds = useMemo(() => userProfile?.pinnedPhotoIds ?? [], [userProfile?.pinnedPhotoIds]);
    const togglePin = useCallback(async (photoId: string, pin: boolean) => {
        const cur = userProfile?.pinnedPhotoIds ?? [];
        // **上限の判定はサーバーに任せる。** ここで `cur.length >= 3` を
        // 見ていたが、`cur` はページを開いたときの配列なので、別の端末で
        // 解除したあとのタブは「手元3枚・サーバー2枚」になり、**要求すら
        // 投げずに断る**——投げないので実態を知る機会が永久に来ない。
        // サーバーは 409 に今の一覧を添えて返すので、押せば必ず収束する。
        const next = pin ? [...cur, photoId] : cur.filter((id) => id !== photoId);
        await saveProfilePatch(
            { pinnedPhotoIds: next },
            pin
                ? (locale === "en" ? "Pinned to top ⭐" : "先頭にピン留めしました ⭐")
                : (locale === "en" ? "Unpinned" : "ピン留めを解除しました"),
            // **配列ではなく増減を送る。** この画面はプロフィールを開いた
            // ときに1回読むだけなので、PC のタブを開いたままスマホで
            // ピン留めすると、次に PC でピン留めしたときスマホの分が
            // 消えていた（サーバーは新しい rev を普通に書けるため、
            // 競合として検出されない）。
            { pinPhotoId: photoId, pin },
        );
    }, [userProfile?.pinnedPhotoIds, saveProfilePatch, locale]);

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
            .map(p => Date.parse(String(p.date || p.createdAt || "")))
            .filter(t => !isNaN(t))
            .sort((a, b) => a - b);

        // 旅した総移動距離: 位置情報つき写真を撮影日順につなぎ、大円距離を積算
        const geo = visiblePhotos
            .filter(p => p.coords && typeof p.coords.lat === "number" && typeof p.coords.lng === "number")
            .map(p => ({ c: p.coords as { lat: number; lng: number }, t: Date.parse(String(p.date || p.createdAt || "")) }))
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
        // copyToClipboard は投げずに真偽値を返す（他の画面は移行済みで、
        // ここだけ try/catch が残っていた）。catch は死んでいたので、
        // クリップボードに書けない環境でも「コピーしました」と出ていた。
        const copied = await copyToClipboard(shareUrl);
        showToast(
            copied
                ? (locale === "en" ? "Link copied!" : "リンクをコピーしました")
                : (locale === "en" ? "Failed to copy" : "コピーに失敗しました"),
            copied ? "success" : "error",
        );
    }, [locale, showToast, shareUrl]);

    return (
        <main className="min-h-screen text-white bg-black">
            {loadError && (
                // 取得の失敗を無言にしない。プロフィールが「未設定の人」に、
                // オーナーの一覧が「非公開が消えた」ように見える（SW-b9）
                <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 pt-3">
                    <p className="text-xs text-amber-200/90 bg-amber-500/10 ring-1 ring-amber-400/20 rounded-lg px-3 py-2">
                        {loadError === "ownPhotos"
                            ? (locale === "en"
                                ? "Couldn't load your photo list. Drafts and private photos are not shown. "
                                : "自分の写真一覧を読み込めませんでした。下書き・非公開は表示されていません。")
                            : loadError === "photos"
                                ? (locale === "en"
                                    ? "Couldn't load the latest photos. "
                                    : "最新の写真を読み込めませんでした。")
                                : (locale === "en"
                                    ? "Couldn't load this profile. "
                                    : "プロフィールを読み込めませんでした。")}
                        <button
                            onClick={() => setReloadKey((k) => k + 1)}
                            className="underline text-amber-100 hover:text-white ml-1"
                            style={{ touchAction: "manipulation" }}
                        >
                            {locale === "en" ? "Retry" : "再読み込み"}
                        </button>
                    </p>
                </div>
            )}
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

                        {/* 名前 + @ユーザー名 + フォローボタン（同じ行の右端）。
                            縦の場所を使わずに主要アクションを見せるため。名前は truncate し、
                            ボタン側は縮ませないので、長い名前でも崩れない。 */}
                        <div className="mt-3.5 mb-3 flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                                <h1 className="text-2xl sm:text-3xl font-bold leading-tight truncate">
                                    {displayName ?? (locale === "en" ? "Anonymous" : "ユーザー")}
                                </h1>
                                {userProfile?.username && (
                                    <p className="mt-0.5 text-sm text-white/50 truncate">@{userProfile.username}</p>
                                )}
                            </div>
                            {!isOwner && (
                                <div className="flex-shrink-0">
                                    <FollowAction
                                        targetUserId={userId}
                                        isOwner={isOwner}
                                        isAuthenticated={viewerAuthed}
                                        locale={locale as "ja" | "en"}
                                    />
                                </div>
                            )}
                        </div>

                        {/* 自己紹介: 名前のすぐ下（従来ステータスがあった位置）に置く */}
                        {userProfile?.bio && (
                            <p className="text-sm text-white/85 whitespace-pre-wrap mb-4 leading-relaxed">{userProfile.bio}</p>
                        )}

                    {/* 統計（投稿 / いいね / フォロー中 / フォロワー）— 1行にまとめる */}
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

                    </div>
                </div>
            </div>

            {/* コンテンツ（黒背景）: 投稿 / 足あとマップ / タイムライン */}
            <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8">
                {/* タブバー */}
                <div className={"grid grid-cols-2 border-t border-white/10 mb-1"}>
                    {([
                        { key: "posts", icon: Squares2X2Icon, label: locale === "en" ? "Posts" : "投稿" },
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
