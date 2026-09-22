"use client";

import { usablePhotoRows } from "../../lib/utils/apiRows";
import { sanitizeProfile } from "../../lib/utils/profileShape";
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import Thumb from "../components/Thumb";
import Link from "next/link";
import { ArrowLeftIcon, ChevronRightIcon, GlobeAltIcon, EyeSlashIcon, ShareIcon, LinkIcon, PencilSquareIcon, PlusIcon, Squares2X2Icon, PhotoIcon as PhotoStackIcon, CalendarDaysIcon, ChatBubbleOvalLeftIcon, MusicalNoteIcon, ChevronDownIcon, QrCodeIcon, NoSymbolIcon, TrashIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
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
// **公開ページ**（サイトマップに載る）なので、未ログインの訪問者にも描かれる。
// 薄い入口から引いて、端末に痕跡が無ければ認証 SDK を読み込まない
import { getCurrentSession } from "../../lib/auth/session";
import { noteFollowSevered } from "../../lib/hooks/useFollow";
import { copyToClipboard, shareToTwitter, shareToLine } from "../../lib/utils/share";
import { publicFetch, userFetch, userPublicFetch, readApiError, sessionErrorMessage } from "../../lib/utils/api";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { EN_MONTHS, splitStoredDate } from "../../lib/utils/photoDate";
import { compareNewest, compareOldest, photoTimeKey } from "../../lib/utils/photoOrder";
import { ROUTES } from "../../lib/routes";
import { toastWithStaticPage } from "../../lib/utils/staticPage";
import UserAvatar from "../components/UserAvatar";
import { STAT_NUMBER_PX, STAT_LABEL_PX, STAT_DIVIDER_PX, ACHIEVEMENT_VALUE_PX, ACHIEVEMENT_LABEL_PX, ACHIEVEMENT_ICON_PX } from "../components/statCellStyle";
import PostSheet from "../components/PostSheet";
import dynamic from "next/dynamic";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import HighlightsRow from "../components/stories/HighlightsRow";
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


// Leaflet は window 依存のため SSG では読み込まない

/**
 * ストーリーの一覧（24時間で消える投稿）。owner:「ストーリー見れる場所も
 * マイページに移設したいな」——以前はトップに置いていた。
 *
 * **遅延読み込みにする。** `StoryViewer`・曲・動画まで引き連れる重い部品で、
 * 訪問者のプロフィール（本人でなければ描かない）の初回に載せる理由が無い。
 * 読み込みが済む前にシートからファイルを選んでも、`storyHandoff` が預かって
 * マウント時に受け取るので取りこぼさない。
 */
const StoriesBar = dynamic(() => import("../components/stories/StoriesBar"), { ssr: false });

type TabKey = "posts" | "timeline";
/** タブ。`timeline` は**年表**（内部名は古い）。「フォロー中」はトップのタブに在る */
const TAB_ORDER: TabKey[] = ["posts", "timeline"];

// 写真を「YYYY年 / M月」で時系列グループ化（撮影日 date 優先、なければ createdAt）
type TimelineGroup = { key: string; year: string; label: string; photos: Photo[] };
function buildTimeline(photos: Photo[], locale: "ja" | "en"): TimelineGroup[] {
    const withDate = photos
        .map((p) => ({ p, raw: String(p.date || p.createdAt || "") }))
        .filter((x) => splitStoredDate(x.raw) !== null || (!!x.raw && !isNaN(Date.parse(x.raw))))
        // 並びは共通の比較関数（ホーム・集約ページ・写真ページの前後と同じ）。
        // `Date.parse` の数値で並べていた頃は、EXIF 由来のゾーン無し
        // `T` 形式がローカル時刻として読まれ、**並びが閲覧者のゾーンで
        // 変わって**いた（lib/utils/photoOrder.ts に実測を書いた）。
        .sort((a, b) => compareNewest(a.p, b.p));
    const map = new Map<string, TimelineGroup>();
    for (const { p, raw } of withDate) {
        // **書かれている成分をそのまま使う。** 撮影日は「その土地で撮った
        // 時刻」で、閲覧者のゾーンに変換する値ではない（写真ページの表示
        // ——`formatStoredDateTime`——も同じ立場）。`Date.parse` を通すと、
        // ゾーン無しの `2024-11-01T07:30:00` は**ローカル時刻**として読まれ、
        // JST では前日 22:30 UTC になる——**写真ページが「11月1日」と出す
        // 写真が、年表では「10月」の見出しに入る**。
        const parts = splitStoredDate(raw);
        let y: number, m: number;
        if (parts) {
            y = parts.y;
            m = parts.m;
        } else {
            // 想定外の形（`YYYY-MM-DD` で始まらない）は今までどおり。
            // ここで落とすと、年表からその写真が黙って消える
            const d = new Date(Date.parse(raw));
            y = d.getUTCFullYear();
            m = d.getUTCMonth() + 1;
        }
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

const PROFILE_PRIORITY_THUMBS = 3;

function PhotoCard({ photo, locale, isOwner, onTogglePublish, pinned = false, onTogglePin, coverSelected = false, onSetCover, priority = false, onDelete }: {
    photo: Photo;
    locale: string;
    isOwner: boolean;
    onTogglePublish?: (id: string, published: boolean) => void;
    pinned?: boolean;
    onTogglePin?: (id: string, pin: boolean) => void;
    coverSelected?: boolean;
    onSetCover?: (id: string) => void;
    priority?: boolean;
    /**
     * **消す本人にだけ渡す。** 一覧から消せなかったので、写真を1枚ずつ
     * 開いて `/user/edit` まで行く必要があった（サーバーの
     * `DELETE /photos/{id}` も確認シートも前からある）。
     * 取り消せない操作なので、**押しても消えない**——共有の
     * `DeleteConfirmModal` を必ず挟む。
     */
    onDelete?: (photo: Photo) => void;
}) {
    const title = getLocalized(photo.title, locale as "ja" | "en") || (typeof photo.title === "string" ? photo.title : "");
    const isHidden = photo.published === false;

    const likeCount = typeof photo.likes === "number" && photo.likes > 0 ? photo.likes : 0;
    // 複数枚の印。**壊れた要素は数えない**（「1/3」と出して開くと2枚、を作らない）
    const extraCount = Array.isArray(photo.extraImages)
        ? photo.extraImages.filter((i) => typeof i?.src === "string" && !!i.src).length
        : 0;

    return (
        <div className="relative overflow-hidden group" style={{ paddingTop: "100%" }}>
            {/* **先読みしない。** 一覧で何本も出るリンクなので、画面に入るたびに
                行き先の RSC の控え（`no-store` 配信）を落とし直す。理由と実測は
                `app/components/GalleryGrid.tsx` のカードのコメントに書いた */}
            <Link
                href={ROUTES.PHOTO(photo.id)}
                prefetch={false}
                /**
                 * 🔴 **名前を `alt` 任せにしない。**
                 *
                 * このタイルの中身は `Thumb` だけで、`alt` は題。だから
                 * **サムネの読み込みが落ちた瞬間にリンクの名前が消える**
                 * ——`Thumb` は失敗すると `<img>` ごと絵の受け皿に差し替える
                 * ので、残るのは `aria-hidden` の svg だけ。実測（Chromium・
                 * 画像を落とせない状態）で、このページの**30本すべてが
                 * 名前の無いリンク**になった。題を持たない写真でも同じ
                 * （`alt=""` ＝装飾画像の意味になる）。
                 *
                 * `GalleryGrid` は同じ状況でも名前が残る（あちらは
                 * `aria-label` を持っている）。揃える。
                 */
                aria-label={title
                    ? (locale === "en" ? `Open ${title}` : `${title} を開く`)
                    : (locale === "en" ? "Open photo" : "写真を開く")}
                className={`absolute inset-0 overflow-hidden bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${isHidden ? "opacity-40" : ""}`}
                style={photo.dominantColor ? { backgroundColor: photo.dominantColor } : undefined}
            >
                {/* Thumb が AVIF/256・blur-up・エラー表示まで内包する */}
                <Thumb
                    photo={photo}
                    alt={title}
                    sizes="(max-width:640px) 33vw, (max-width:1024px) 33vw, 340px"
                    priority={priority}
                    className="transition-transform duration-300 group-hover:scale-[1.04]"
                />
                {/* 複数枚の印（モック）。**壊れた要素は数えない**
                    （「1/3」と出して開くと2枚、を作らない） */}
                {extraCount > 0 && (
                    <span className="absolute top-1 right-1 rounded-full bg-black/60 backdrop-blur-sm text-white pointer-events-none"
                          style={{ fontSize: "10px", lineHeight: "12px", padding: "2px 6px" }}
                          aria-hidden="true">
                        1/{extraCount + 1}
                    </span>
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
                            : OWNER_CHIP_IDLE
                    }`}
                    title={pinned ? (locale === "en" ? "Unpin" : "ピン留め解除") : (locale === "en" ? "Pin to top" : "先頭にピン留め")}
                    // `title` はタッチでは読めない（ツールチップが出ない）
                    aria-label={pinned ? (locale === "en" ? "Unpin" : "ピン留め解除") : (locale === "en" ? "Pin to top" : "先頭にピン留め")}
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
                    // **`isHidden` をそのまま渡す**（`publish` の意味で）。
                    // `!isHidden` だと「いまの状態を送り直す」ことになり、
                    // 公開中の写真の「非公開にする」で `published: true` が飛んで
                    // 何も変わらないまま「公開しました」と出ていた（実測）
                    onClick={(e) => { e.preventDefault(); onTogglePublish?.(photo.id, isHidden); }}
                    className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-colors z-10 ${
                        isHidden
                            ? "bg-black/80 text-white/80 hover:bg-black"
                            : OWNER_CHIP_IDLE
                    }`}
                    title={isHidden ? (locale === "en" ? "Show" : "公開する") : (locale === "en" ? "Hide" : "非公開にする")}
                    aria-label={isHidden ? (locale === "en" ? "Show" : "公開する") : (locale === "en" ? "Hide" : "非公開にする")}
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
                            ? "bg-accent text-black"
                            : OWNER_CHIP_IDLE
                    }`}
                    aria-label={coverSelected
                        ? (locale === "en" ? "Cover (tap to reset)" : "カバー中（タップで自動に戻す）")
                        : (locale === "en" ? "Use as cover" : "この写真をカバーにする")}
                    title={coverSelected
                        ? (locale === "en" ? "Cover (tap to reset)" : "カバー中（タップで自動に戻す）")
                        : (locale === "en" ? "Use as cover" : "この写真をカバーにする")}
                >
                    <PhotoStackIcon className="w-4 h-4" />
                </button>
            )}

            {/* 編集（オーナーのみ・右下）。
                **削除だけ足して編集を置いてきていた。** 一覧から消せるようにした
                ときの理由（「写真を1枚ずつ開いて `/user/edit` まで行く必要が
                あった」）は編集にそのまま当てはまるのに、導線は削除にしか
                無かった——台帳がいちばん多く記録している「入口が2つあるのに
                片方だけ」の型。

                **`isOwner` だけで出す**（呼び出し側の旗を増やさない）。投稿と
                年表の2つのグリッドがどちらも `isOwner` を渡すので、片方だけに
                付く形にそもそもならない。

                カバー選択中（`onSetCover`）は右下が埋まっているので出さない。
                置き場所を削除の隣にしないのは、**取り消せない操作の隣に
                取り消せる操作を並べない**ため（誤タップの行き先が変わる）。 */}
            {isOwner && !onSetCover && (
                <Link
                    href={ROUTES.EDIT(photo.id)}
                    // 一覧で何本も出るリンク。行き先の控えを落とし直さない
                    // （カードのリンクと同じ理由）
                    prefetch={false}
                    className={`absolute bottom-1.5 right-1.5 p-1.5 rounded-full transition-colors z-10 ${OWNER_CHIP_IDLE}`}
                    aria-label={locale === "en" ? "Edit this photo" : "この写真を編集"}
                    title={locale === "en" ? "Edit this photo" : "この写真を編集"}
                >
                    <PencilSquareIcon className="w-4 h-4" />
                </Link>
            )}

            {/* 削除（オーナーのみ・左下）。**押しただけでは消えない**——確認シートを挟む */}
            {isOwner && onDelete && (
                <button
                    onClick={(e) => { e.preventDefault(); onDelete(photo); }}
                    className={`absolute bottom-1.5 left-1.5 p-1.5 rounded-full transition-colors z-10 hover:text-red-300 ${OWNER_CHIP_IDLE}`}
                    aria-label={locale === "en" ? "Delete this photo" : "この写真を削除"}
                    title={locale === "en" ? "Delete this photo" : "この写真を削除"}
                >
                    <TrashIcon className="w-4 h-4" />
                </button>
            )}

            {/* 非公開バッジ。削除ボタンが出るときは重ならないよう右へ寄せる */}
            {isOwner && isHidden && (
                <div className={`absolute bottom-1.5 ${onDelete ? "left-10" : "left-1.5"} px-1.5 py-0.5 bg-black/80 rounded text-xs text-white/70 pointer-events-none`}>
                    {locale === "en" ? "Hidden" : "非公開"}
                </div>
            )}
        </div>
    );
}

/**
 * オーナー専用の小さなボタン（ピン留め・非公開・カバー）の未選択時の見た目。
 *
 * **`hover:` だけだとタッチ端末では永久に透明。** Tailwind の `hover:` は
 * `@media (hover: hover)` 付きで出力されるので、スマホではタップしても
 * 現れない——**見えないボタンが写真の上（`z-10`）に乗っている**状態で、
 * セルの隅を触ると気づかないまま非公開になる／ピンが外れる。
 * ポインタで指せる端末では今までどおり hover で出し、そうでない端末
 * （＝タッチ）では最初から薄く見せる。
 */
const OWNER_CHIP_IDLE =
    "bg-black/0 text-white/0 hover:bg-black/60 hover:text-white/80"
    + " [@media(hover:none)]:bg-black/45 [@media(hover:none)]:text-white/70";

// 旅アルバムのカード。カバー写真 + タイトル + 期間/枚数/距離。タップで写真を展開。
// オーナーは展開時に旅の名前を編集できる（カスタム名はプロフィールに保存され全員に見える）。
// /users/<id>（静的生成・OGP付き）と /users?id=<id>（新規ユーザー向けフォールバック）の
// 両方から使われる。
/**
 * @param initialBio ビルド時に分かっている自己紹介（`/users/<id>` の静的生成だけが渡す）。
 *   **JS が走る前の本文に出すため**——実測でこのページの静的本文は**131文字**
 *   （見出しと `…` だけ）で、自己紹介は `<head>` の `description` と JSON-LD には
 *   出ているのに**本文には1文字も無かった**。索引に載るページで、しかも
 *   本人が書いた唯一の自己記述なので、ここに出す価値がいちばん高い。
 *   **`/users?id=` のクエリ版は渡さない**（あちらはビルド時に相手が決まらない）。
 */
export default function UserProfileClient({ userId, initialBio }: { userId: string; initialBio?: string }) {
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
    // **「まだ来ていない」と「0枚」を分ける。**
    //
    // `photos` の初期値はビルド時 JSON の絞り込みなので、ビルド後に登録した人・
    // 新しい環境（photos.json が空）では必ず `[]` から始まる。`postCount === 0`
    // だけで空表示に落とすと、**写真があるのに「まだ写真がありません。」が
    // 一瞬出る**（本人には「最初の写真を投稿」の誘導まで出て消える）。
    // 同じリポジトリの `usePhotos` の `loaded`・`followingLoaded`・
    // `countsKnown` はどれもこの区別を持っていて、この画面だけ抜けていた。
    const [photosResolved, setPhotosResolved] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    // ピン留めの保存に付ける通し番号（応答の追い越しを捨てる）。
    // **ピン専用のつもりで使っている。** 進めるのは `saveProfilePatch` の
    // 入口なので、この関数がピン以外の保存にも使われ始めたら
    // （旅の名前・カバー・BGM の枠がこのファイルに残っている）、
    // 「名前を1文字直したらピンの後追いが捨てられる」が生まれる。
    // そのときは番号を分けること——**巻き戻し（失敗時の `setUserProfile(prev)`）も
    // この番号に乗せた**ので、分けないまま他の項目を保存すると
    // 「星が古い」で済まず、**保存できていない値が画面に残る**方に化ける。
    // 先回りして分岐を足さないのは、呼び出し側が1つしか無い今は
    // 「守っているつもりの死にコード」にしかならないため（このファイルは
    // 同じ理由で一度そういう分岐を消している）。
    const pinSeqRef = useRef(0);

    /**
     * 本人の行（`GET /user/profile`）からピンを採る。オーナーのときだけ呼ぶ。
     *
     * 公開プロフィール（`getPublicProfile`）は「今は見えない写真」の ID を
     * 落として返す。本人がそれをそのまま使うと、非公開にした写真の星が
     * 消えるのに**サーバーの枠は埋まったまま**——4枚目を留めようとすると
     * 409「ピン留めは3枚までです」が出続け、解除ボタンは星の付いた写真に
     * しか無いので画面から直せない。落とすのは訪問者に見せるときだけ。
     *
     * **保存が挟まったら捨てる。** ここが運ぶのは「投げた時点の姿」なので、
     * 待っている間に星を押されると、押したあとの一覧を押す前の一覧で
     * 上書きしてしまう。PUT の応答と同じ `pinSeqRef` で見分ける。
     *
     * **捨てたら取り直す。** 番号は保存の入口で進むので、その保存が
     * 失敗して巻き戻ると「捨てたまま二度と当たらない」——公開ぶんの
     * ピンで固定され、まさに直したかった状態に戻る。だから
     * `saveProfilePatch` の失敗経路からここを呼び直す。
     *
     * 引けなかったときは公開ぶんのまま（星が少なく出る）。ここで一覧を
     * 空にすると、写真一覧と同じ「消えたように見えて押し直す」を作る。
     */
    const loadOwnPins = useCallback((signal?: AbortSignal, authoritative = false) => {
        const pinSeq = pinSeqRef.current;
        void userFetch("/user/profile", signal ? { signal } : undefined)
            .then((res) => (res.ok ? res.json().catch(() => null) : null))
            .then((mineProfile: { userId?: unknown; pinnedPhotoIds?: unknown } | null) => {
                if (signal?.aborted || pinSeq !== pinSeqRef.current) return;
                const raw = mineProfile?.pinnedPhotoIds;
                if (!Array.isArray(raw)) {
                    // **キーが無い＝サーバーは0枚**（保存側は空になると
                    // 項目ごと落とす）。ここの扱いは呼び出し元で変わる:
                    //
                    // - 読み込み時（`authoritative` でない）は触らない。
                    //   公開ぶんは必ず保存ぶんの部分集合なので消しても得が無く、
                    //   応答の形が想定外だったときに星を全部消す方が痛い。
                    // - 失敗の後始末では**下ろす**。画面には見込みで付けた星が
                    //   乗っていて、追い越された保存はもう巻き戻さないので、
                    //   ここで下ろさないと**誰も下ろさない**（サーバーには
                    //   無い星が残り、リロードするまで直らない）。
                    //
                    // ただし「読めた」ことは確かめる——`getMyProfile` は必ず
                    // `userId` を返すので、それが無い 200 は profile ではない。
                    if (!authoritative || typeof mineProfile?.userId !== "string") return;
                }
                const ownPins = (Array.isArray(raw) ? raw : []).filter((x): x is string => typeof x === "string");
                // 公開プロフィールが読めていないときは触らない（その状態では
                // この画面は保存そのものを断るので、星だけ戻しても押せない）
                setUserProfile((p) => (p ? { ...p, pinnedPhotoIds: ownPins } : p));
            })
            .catch(() => {});
    }, []);

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
                // **セッションの判定をプロフィール取得と運命共同体にしない。**
                // `userPublicFetch` は打ち切り・通信断で投げるので、`Promise.all`
                // だと catch に落ちて `setViewerAuthed(true)` に到達しない
                // ——ログイン済みなのに未ログイン扱いになり、フォローボタンも
                // ブロックの項目も消える（**安全のための項目だけが出ない**）。
                const [profileSettled, sessionSettled] = await Promise.allSettled([
                    userPublicFetch(`/profile/${encodeURIComponent(userId)}`, { signal: controller.signal }),
                    getCurrentSession(),
                ]);
                // 中断（画面を離れた・userId が変わった）は何もしない。
                // `throw` をやめたぶん、ここで見ないと `AbortError` が
                // 「取得に失敗」として画面に出る
                if (controller.signal.aborted) return;
                const sessionResult = sessionSettled.status === "fulfilled" ? sessionSettled.value : null;
                // **セッションの結果は、プロフィールの失敗より先に反映する。**
                if (sessionResult) setViewerAuthed(true);
                if (sessionResult && (sessionResult.getIdToken().payload["sub"] as string | undefined) === userId) {
                    setIsOwner(true);
                }
                // **プロフィールが取れなくても、写真の一覧は取りに行く。**
                //
                // 以前はここで `throw` していた。`Promise.all` の頃は
                // `setIsOwner` にも届かなかったので訪問者の見え方に退避して
                // いたが、セッションを先に反映するようにしたぶん、
                // **オーナーの操作（目のアイコン・ピン・カバー）が有効なまま
                // 一覧はビルド時 JSON（`photos.json` は全件 published:true）**
                // という組み合わせが新しくできていた——このファイルが3か所で
                // 戒めている「古い公開状態にオーナー操作を載せて誤再公開を
                // 誘う」形そのもの。プロフィールの失敗は `loadError` に
                // 落とすだけにして、下の一覧の取得へ進む
                if (profileSettled.status === "rejected") {
                    log.error("user profile fetch error:", profileSettled.reason);
                }
                const profileRes = profileSettled.status === "fulfilled" ? profileSettled.value : null;
                const prof = profileRes?.ok
                    ? sanitizeProfile<UserProfile>(await profileRes.json(), `GET /profile/<id>`)
                    : null;
                if (prof) {
                    setUserProfile(prof);
                    profileLoaded = true;
                } else {
                    // 名前・自己紹介・BGM・ピン留めが黙って全部出ない状態を
                    // 「未設定」と見分けられるようにする
                    setLoadError("profile");
                }
                const isCurrentUserOwner = !!sessionResult &&
                    (sessionResult.getIdToken().payload["sub"] as string | undefined) === userId;

                // 自分のプロフィールは認証済みの一覧を「正」にする。
                //
                // 以前は公開一覧（published = true だけ）に、ビルド時JSONの
                // 残りをマージしていた。photos.json の写真は全部 published: true
                // なので、非公開にした写真も削除した写真も「公開中」の姿で
                // 復活していた。非公開バッジも出ないので本人には見分けが付かず、
                // もう一度目のアイコンを押すと今度は本当に再公開してしまう。
                if (isCurrentUserOwner) {
                    // **自分のピンは自分の行から採る**（詳しくは loadOwnPins）。
                    // **一覧をこれに待たせない。** `Promise.all` で束ねると、
                    // 星のためだけの取得が写真一覧の描画を人質に取る
                    // ——その間ビルド時 JSON（全件 published:true）のままなので、
                    // 非公開バッジが出ず、本人が目のアイコンを押して**本当に
                    // 再公開する**窓が開く。星は後から当てれば足りる。
                    loadOwnPins(controller.signal);
                    const mineRes = await userFetch("/user/photos", { signal: controller.signal });
                    if (mineRes.ok) {
                        // **読めない行は落としてから入れる**（1件の巻き添えで
                        // ページ全体が `ErrorBoundary` のカードにならないように）
                        const mine = usablePhotoRows<Photo>(await mineRes.json(), "GET /user/photos");
                        if (mine) {
                            setPhotos(mine);
                            setPhotosResolved(true);
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
                    // 失敗も「分かった」に数える。分からないままにすると、
                    // 上の警告バーだけが出てタブの中身が永久に無言になる
                    setPhotosResolved(true);
                    return;
                }

                // API から最新の写真を取得。ビルドを待たずに足あと・地名へ反映される。
                const photosRes = await publicFetch(`/photos?userId=${encodeURIComponent(userId)}`, {
                    signal: controller.signal,
                    cache: "no-store",
                });
                if (photosRes.ok) {
                    const data = usablePhotoRows<Photo>(await photosRes.json(), "GET /photos?userId=");
                    if (data) {
                        // **空配列もそのまま採る。**
                        //
                        // 以前は「空で静的データを潰さない」ようにしていたが、
                        // `GET /photos?userId=` は**公開ぶんだけ**を返すので、
                        // その人が全部非公開にした／全部消したときの**正解が
                        // 空**。捨てると、隠したはずの写真がビルド時の
                        // スナップショットのまま訪問者に出続ける
                        // （画像・タイトル・`/photo/<id>` へのリンクごと）。
                        //
                        // 「空だと写真が消えて見える」を心配していたが、
                        // **静的側と API 側は同じ集合**なので取り違えない:
                        // 静的の絞り込みは `p.userId === userId` で、
                        // API は `userId` の GSI を引く。`userId` を持たない
                        // 古い行はどちらからも外れる（静的JSONを作る
                        // `sync-photos-from-ddb.js` は `uploadedBy` を
                        // `userId` に写さない）。
                        //
                        // 取得に失敗したときは `photosRes.ok` が false なので
                        // ここに来ない＝静的のまま。潰すのは「聞けて、
                        // 答えが空だった」ときだけ。
                        setPhotos(data);
                    }
                    setPhotosResolved(true);
                } else {
                    // **`else` が無かった。** 上のコメントは「失敗したときは
                    // ここに来ない＝静的のまま」と書いているが、ビルド時の
                    // スナップショットを持たない人（ビルド後に登録した人・
                    // 新しい環境）にとって「静的のまま」は**空**。500 や 403 が
                    // 返っても警告バーも再読込も出ず、「まだ写真がありません。」
                    // のままになる。`loadError` は3つの文言を用意してあるのに、
                    // `photos` を立てる経路が catch（＝回線断）にしか無かった。
                    log.warn("公開の写真一覧を取得できませんでした", { status: photosRes.status });
                    setLoadError((prev) => prev ?? "photos");
                    setPhotosResolved(true);
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
                    setPhotosResolved(true);
                }
            }
        };
        setLoadError(null);
        setPhotosResolved(false);
        void load();
        return () => controller.abort();
    }, [userId, reloadKey, loadOwnPins]);

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
    // **本人と訪問者で「投稿 N」が違う。** 本人は下書き・非公開を含むので、
    // 同じページの OGP（公開ぶんで数える）とも食い違う。数を揃えると
    // 「下書きが数に入らない＝増えていない」に見えるので、**本人にだけ
    // 内訳を添えて**食い違いの理由が分かるようにする。
    const hiddenCount = isOwner ? postCount - publishedPhotos.length : 0;
    const [tab, setTab] = useState<TabKey>("posts");
    const [shareOpen, setShareOpen] = useState(false);
    /** 「投稿する」の2択（`PostSheet`）。「＋」と同じシートを開く */
    const [postOpen, setPostOpen] = useState(false);
    const postBtnRef = useRef<HTMLButtonElement | null>(null);
    const closePost = useCallback(() => setPostOpen(false), []);
    /** ブロック中かどうか（この画面から押した結果だけを持つ。開いた時点では引かない） */
    const [blocked, setBlocked] = useState(false);
    const [blocking, setBlocking] = useState(false);
    // プロフィールQRコード（対面共有用）
    const [qrOpen, setQrOpen] = useState(false);

    // 共有メニューも同じ。閉じる手段が `fixed inset-0` の**マウス専用
    // オーバーレイ**しか無く、QR だけ直して隣を直していなかった。
    useEscapeKey(shareOpen, () => setShareOpen(false));

    /**
     * この人からの反応を受け取らない。
     *
     * **押せる場所がストーリーの返信一覧しか無かった。** そこから足したが、
     * 相手がストーリーに返信していなければ辿り着けない——**コメントを
     * 付けられても止められない**（`getComments` はブロックを見ないので、
     * 既に付いたものは残る。止まるのは以後の投稿と通知）。
     * サーバー側は前から揃っていて、足りないのは押す場所だけだった。
     *
     * **効いたときだけ画面を変える**（`StoryViewer` と同じ）。失敗を成功に
     * 見せると「押したのにまた届く」で二度目の落胆になる。
     */
    const toggleBlock = useCallback(async () => {
        if (!userId || blocking) return;
        setBlocking(true);
        const next = !blocked;
        try {
            const res = await userFetch(`/users/${encodeURIComponent(userId)}/block`, {
                method: next ? "POST" : "DELETE",
            });
            if (res.ok) {
                setBlocked(next);
                // **同じ画面のフォローの状態も直す。** ブロックは
                // `unfollowQuietly` を両向きに撃つのに、共有ストアは
                // ログイン・ログアウトでしか捨てないので、トーストが
                // フォローも外れたと言った直後に**すぐ下のボタンは
                // 「フォロー中」のまま**だった。
                //
                // **ここで `resetFollowingCache()` を撃つのは誤り**（一度
                // そう書いて回帰にした）。あれはログアウト用で、`counts` を
                // 空にするぶん数のピルが消えたまま戻らず、しかも
                // `isFollowing` はコンポーネントの state なので「フォロー中」
                // は直らない——**数字だけ消える**という、より悪い状態になる。
                // ボタン自体はすぐ下で `blocked` のとき出さないので、
                // ここで直すのは**共有している一覧と数**。一覧をコピーして
                // 持っている画面（ギャラリーのフォロー中フィード）は
                // `subscribeFollowingSet` で取り直す。
                //
                // 解除（`next === false`）では撃たない。ブロックを外しても
                // フォローは戻らないので、直すものが無い。
                if (next) noteFollowSevered(userId);
                // **状態を断定しない。** `blocked` はこの画面で押した結果しか
                // 持たない（開き直すと戻る）ので、既にブロック済みの相手に
                // 押しても `blockUser` は冪等に 200 を返す。「ブロック
                // しました」「外れました」と言い切ると、何も変わっていない
                // のに変わったように読める（2回目は外れていない）
                showToast(next
                    ? (locale === "en"
                        ? "This user is blocked. They can't reply, comment, or follow you, and follows in both directions are removed. You can unblock from Settings."
                        // **解除の場所まで言う。** 言っているのは
                        // `StoryViewer` の注意書きだけで、**プロフィールから
                        // ブロックした人はどこで戻せるか受け取っていなかった**
                        // ——コミットに「他の2か所は場所まで言っている」と
                        // 書いたが、1か所だけだった（レビューの指摘）
                        // 行き先は**設定**（2026-09-21 に移設）
                        : "この人をブロック中です。返信・コメント・フォローができなくなり、お互いのフォローは外れます。解除は設定の「ブロックした人」からできます。")
                    : (locale === "en" ? "Unblocked." : "ブロックを解除しました。"), "success");
            } else {
                showToast(await readApiError(res, locale === "en" ? "Couldn't do that." : "できませんでした"), "error");
            }
        } catch {
            showToast(locale === "en" ? "Couldn't do that." : "できませんでした", "error");
        } finally {
            setBlocking(false);
        }
    }, [userId, blocked, blocking, locale, showToast]);

    // Escape で閉じる。共有メニューから開くので、押した瞬間にその
    // ボタン自体がアンマウントされ、フォーカスは body に落ちる。
    // 閉じる手段が「ページ最後尾の閉じるボタンまで Tab で辿る」しか
    // 無かった（aria-modal と言いながら背後が全部たどれる）。
    useEscapeKey(qrOpen, () => setQrOpen(false));
    // 共有メニューから開くので、押した瞬間に起動元がアンマウントされて
    // フォーカスが body に落ちる。中へ入れて、閉じたら戻す
    const qrRef = useRef<HTMLDivElement | null>(null);
    // **戻り先を明示する。** 上のコメントのとおり、開く時点で起動元
    // （メニュー項目）は既に消えていて `activeElement` は body。
    // 渡さないと閉じたあと body に落ちたまま＝次の Tab がページ先頭から。
    // 問題は書いてあったのに、渡すのを忘れていた。
    const shareBtnRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(qrOpen, qrRef, shareBtnRef);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [mvOpen, setMvOpen] = useState(false);


    // タブを横スワイプで切り替え（投稿 ⇄ 年表）。
    // Pointer Events で PC(マウス)・スマホ(タッチ)・ペンを一本化。
    // touch-action: pan-y を併用し、縦スクロールは残しつつ横ジェスチャを JS が拾う。
    const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
    const swallowClickRef = useRef(false);
    const onTabPointerDown = useCallback((e: React.PointerEvent) => {
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
        // **新しい指が触れたら、前回の「食う札」は捨てる。**
        // 札を下ろす経路が click と pointercancel しか無かったので、
        // click が来なかった場合に立ちっぱなしになる——左スワイプで
        // タブが切り替わると、押していた写真のセルが DOM から消えて
        // click が飛ばない（＝札が残り、次の正当なタップが1回丸ごと
        // 飲まれる。「1回目が効かない、2回目で開く」）
        swallowClickRef.current = false;
    }, []);
    // **スワイプの直後に来る click を1回だけ食う。**
    //
    // 写真のセルは全面が `<Link>` なので、グリッドの上で横スワイプすると
    // **タブが切り替わると同時に写真ページへ飛ぶ**（1セル約126px に対して
    // 判定は45pxなので、セル1つの中で成立する）。`click` は指を離せば必ず
    // 発火する——`StoryViewer` が同じ現象を観測して `wasTap()` で塞いだのと
    // 同じ話で、こちらには歯止めが無かった。
    const onTabPointerUp = useCallback((e: React.PointerEvent) => {
        const s = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!s) return;
        const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y);
        if (dir !== 0) {
            hapticTap(8);
            swallowClickRef.current = true;
            setTab((cur) => stepInList(TAB_ORDER, cur, dir));
        }
    }, []);
    /** スワイプで切り替えた直後の click を止める（捕捉フェーズで拾う） */
    const onTabClickCapture = useCallback((e: React.MouseEvent) => {
        if (!swallowClickRef.current) return;
        swallowClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
    }, []);


    const timeline = useMemo(() => buildTimeline(visiblePhotos, locale as "ja" | "en"), [visiblePhotos, locale]);

    // 旅アルバム: 撮影日の間隔で自動グルーピング

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
        /**
         * この保存が**まだ最後の1本か**。
         *
         * 追い越された保存は、巻き戻しも取り直しもしてはいけない
         * ——どちらも「この保存を投げる前の姿」に戻す操作で、あとから
         * 押した分（画面に出ている星）を消すことになる。後始末は、
         * 最後に投げた分が自分の応答でやる。
         */
        const isLatest = () => seq === pinSeqRef.current;
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
                if (isLatest()) setUserProfile(prev ?? null);
                // **断られた回こそ同期する。** 上限で断るとき、サーバーは
                // 今の一覧を添えてくる。取り込まないと、手元が古いタブは
                // 「星が1つも無いのに3枚までと言われる」まま何度でも同じ
                // ことを繰り返す。本文は clone から読む（readApiError が
                // 同じ res を読むので二度読みにしない）。
                const detail = typeof res.clone === "function"
                    ? await res.clone().json().catch(() => null) as { pinnedPhotoIds?: unknown } | null
                    : null;
                if (detail && Array.isArray(detail.pinnedPhotoIds)) adoptPins(detail.pinnedPhotoIds);
                // **番号を進めたまま失敗しない。** 読み込み時の後追い
                // （loadOwnPins）は、この保存が入口で進めた番号のせいで
                // 捨てられている。ここで取り直さないと、公開ぶんのピンで
                // 固定されたまま——非公開にした写真の星が無く、外せない。
                // 一覧が添えられていた回（上の adoptPins）は済んでいる。
                else if (isLatest() && "pinnedPhotoIds" in patch) loadOwnPins(undefined, true);
                showToast(await readApiError(res, failMsg), "error");
                return;
            }
            // サーバーが返す保存後の姿でピン留めを揃える。増減で送っている
            // ので、他の端末が先に足した分もここで手元に入る（見込みの値の
            // ままだと、次の操作がまたその1枚を知らないまま送られる）。
            const saved = await res.json().catch(() => null) as { pinnedPhotoIds?: unknown } | null;
            if (saved && "pinnedPhotoIds" in patch) adoptPins(saved.pinnedPhotoIds);
            showToast(successMsg, "success");
        } catch (e) {
            if (isLatest()) {
                setUserProfile(prev ?? null);
                // 上と同じ（捨てられた後追いを取り直す）。ここも失敗すれば
                // 公開ぶんのまま——星が少なく出るだけで、何も壊さない
                if ("pinnedPhotoIds" in patch) loadOwnPins(undefined, true);
            }
            // トークン不在（userFetch が投げる）は「保存に失敗しました」では
            // 直らない。別のタブでログアウトした人・セッションが切れた人は、
            // 何をすればいいか分からないまま押し直すことになる。
            // PhotoPageClient の MV 保存と同じ見分け方。
            showToast(sessionErrorMessage(e) ?? failMsg, "error");
        }
    }, [userProfile, userId, locale, showToast, loadOwnPins]);

    // 旅のカスタム名（オーナーが編集可能・プロフィールに保存され全員に見える）



    // 旅アルバムのカバー写真（同じ写真をもう一度選ぶと自動に戻る）



    // 旅アルバムのBGM（1旅1曲）。null で解除



    // ピン留め（投稿タブ先頭に固定・最大3枚・全員に見える）
    /**
     * 画面に出す自己紹介。
     *
     * **届いたら控えは使わない。** `userProfile?.bio ?? initialBio` にすると、
     * 自己紹介を**消した**人の画面にビルド時の古い自己紹介が次のビルドまで
     * 残る（消す操作が効かなく見える）。「まだ届いていない間だけ控え」。
     *
     * **1つの式にしておく。** 出すかどうかと何を出すかを別々に書いていたら、
     * **片方だけ `??` に戻す変異がどちらも素通りした**——一方は「空の `<p>` が
     * 出るだけ」、他方は「条件が偽で出ない」で、どちらも文字として現れない。
     */
    const shownBio = userProfile ? userProfile.bio : initialBio;

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

    // 足あとサマリー: 旅した総移動距離（位置情報つきの写真を撮影日順につなぐ）
    //
    // **並べ方は年表と同じ規則にする。** `Date.parse` で並べていた頃は、
    // ゾーン無しの `T` 形式（EXIF 由来の撮影日）がローカル時刻として読まれ、
    // **同じ画面の年表と逆の順**になりえた（年表は書かれている成分で切る）。
    // 積算する順が変われば距離も変わるので、見えている数字が閲覧者の
    // タイムゾーンで変わることになる。
    //
    // 以前ここで数えていた「訪れた場所数」と「期間（最古〜最新）」は、
    // **どこにも出していなかった**ので落とした（画面に出るのは
    // `distanceKm` と `geoCount` だけ）。`Date.parse` の呼び出しも一緒に消える。
    const footprint = useMemo(() => {
        const geo = visiblePhotos
            // **日時を読めない写真は入れない。** 旧実装の `!isNaN(Date.parse(...))`
            // に当たる歯止め。無いとキーが空の写真が先頭に入り、そこから
            // 最初の地点までの1脚ぶん距離が増える（つなぐ順が決まらない
            // 写真を、いちばん古い場所として数えることになる）
            .filter(p => p.coords && typeof p.coords.lat === "number" && typeof p.coords.lng === "number"
                && photoTimeKey(p) !== "")
            .sort(compareOldest)
            .map(p => p.coords as { lat: number; lng: number });
        let distanceKm = 0;
        for (let i = 1; i < geo.length; i++) distanceKm += haversineKm(geo[i - 1], geo[i]);

        return { distanceKm, geoCount: geo.length };
    }, [visiblePhotos]);


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

    // **同じ写真の切り替えを重ねない。** 向きが直るまでこのボタンは何も
    // 変えなかったので踏めなかったが、効くようになった今は「非公開→公開」を
    // 続けて押すと応答の入れ替わりで画面とサーバーがずれる（ピン留めで
    // 同じ型を踏んで `pinSeqRef` を置いたのと同じ話）
    const togglingRef = useRef<Set<string>>(new Set());
    // **一覧から消せるようにする。** サーバーの `DELETE /photos/{id}` も
    // 共有の確認シートも前からあるが、プロフィールの一覧には削除が無く、
    // 写真を1枚ずつ開いて `/user/edit` まで行く必要があった。
    const [photoToDelete, setPhotoToDelete] = useState<Photo | null>(null);
    const [deletingPhoto, setDeletingPhoto] = useState(false);

    const handleDeletePhoto = useCallback(async () => {
        const target = photoToDelete;
        if (!target || deletingPhoto) return;
        setDeletingPhoto(true);
        try {
            const res = await userFetch(`/photos/${encodeURIComponent(target.id)}`, { method: "DELETE" });
            if (!res.ok) {
                // サーバーは理由を返す（「画像の削除を完了できませんでした」など）。
                // 押し直せば続きから消えるので、そう読める文言のまま出す
                // （`/user/edit` の削除と同じ扱い）。シートは開いたままにして、
                // その場でもう一度押せるようにする
                showToast(await readApiError(res, locale === "en" ? "Failed to delete" : "削除に失敗しました"), "error");
                return;
            }
            setPhotos((prev) => prev.filter((p) => p.id !== target.id));
            // **留めの一覧からも落とす。** サーバーは `removePinnedPhoto` で
            // 外しているが、こちらの控えに残ると「留めた写真」の枠が
            // 消えた写真を指したままになる
            setUserProfile((p) => (p && Array.isArray(p.pinnedPhotoIds)
                ? { ...p, pinnedPhotoIds: p.pinnedPhotoIds.filter((id) => id !== target.id) }
                : p));
            setPhotoToDelete(null);
            // 消しても静的ページが残ることがある（`lib/utils/staticPage.ts`）
            toastWithStaticPage(showToast,
                locale === "en" ? "Photo deleted" : "写真を削除しました",
                await res.json().catch(() => null), locale !== "en");
        } catch (e) {
            showToast(sessionErrorMessage(e)
                ?? (locale === "en" ? "Failed to delete" : "削除に失敗しました"), "error");
        } finally {
            // **必ず下ろす。** 立ったまま残ると、その写真だけ二度と消せなくなる
            setDeletingPhoto(false);
        }
    }, [photoToDelete, deletingPhoto, showToast, locale]);

    const handleTogglePublish = useCallback(async (photoId: string, publish: boolean) => {
        if (togglingRef.current.has(photoId)) return;
        togglingRef.current.add(photoId);
        try {
            const res = await userFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify({ published: publish }),
            });
            if (res.ok) {
                setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, published: publish } : p));
                // 非公開にしても静的ページが残ることがある（`lib/utils/staticPage.ts`）
                toastWithStaticPage(showToast,
                    publish
                        ? (locale === "en" ? "Photo is now public" : "写真を公開しました")
                        : (locale === "en" ? "Photo is now hidden" : "写真を非公開にしました"),
                    await res.json().catch(() => null), locale !== "en");
            } else {
                // 別タブで先に消していると 404「写真が見つかりません」が返る。
                // 「更新に失敗しました」に潰していたので、**何度押しても直らない
                // 操作を再試行し続ける**形だった
                showToast(await readApiError(res, locale === "en" ? "Failed to update" : "更新に失敗しました"), "error");
            }
        } catch (e) {
            showToast(sessionErrorMessage(e)
                ?? (locale === "en" ? "Failed to update" : "更新に失敗しました"), "error");
        } finally {
            // **必ず下ろす。** 失敗したまま札が残ると、その写真だけ
            // 二度と切り替えられなくなる（押しても無反応）
            togglingRef.current.delete(photoId);
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
        <main className="min-h-screen text-white bg-bg">
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
            {/* **カバー写真はやめた**（最終版モックに無い・2026-09-22）。
                以前は横長のバンドを背景に敷き、アバターがその下端に重なる形だった
                （`CoverBackground` と `pt-24 sm:pt-32` が対）。編集画面のカバー欄も
                同じ回で外した——設定できるのに出ない状態を残さない */}
            <div className="relative">
                <div className="relative max-w-2xl lg:max-w-5xl mx-auto px-4">
                    {/* 上部バー: 戻る（左）+ 共有（右）。どちらもカバー上のガラスボタンで
                        背景に関わらず視認性を確保し、左右対称でバランスを取る。 */}
                    <div className="pt-4 mb-2 flex items-center justify-between">
                        <Link
                            href="/"
                            prefetch={false}
                            aria-label={locale === "en" ? "Back to Gallery" : "ギャラリーに戻る"}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/15 text-white/90 hover:bg-black/60 active:scale-95 transition shadow-lg shadow-black/30"
                        >
                            <ArrowLeftIcon className="w-5 h-5" />
                        </Link>
                        {/* 共有: 戻ると対になる単一のガラスボタン。タップでメニューを開く */}
                        <div className="relative">
                            <button
                                ref={shareBtnRef}
                                onClick={() => setShareOpen((v) => !v)}
                                aria-haspopup="menu"
                                aria-expanded={shareOpen}
                                className={`inline-flex items-center justify-center w-9 h-9 rounded-full backdrop-blur-md ring-1 transition shadow-lg shadow-black/30 active:scale-95 ${shareOpen ? "bg-accent-fill text-white ring-accent" : "bg-black/40 text-white/90 ring-white/15 hover:bg-black/60"}`}
                                title={locale === "en" ? "Share" : "共有"}
                                aria-label={locale === "en" ? "Share profile" : "プロフィールを共有"}
                            >
                                <ShareIcon className="w-4 h-4" />
                            </button>

                            {shareOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} aria-hidden="true" />
                                    <div role="menu" className="absolute right-0 top-full mt-2 z-50 w-48 rounded-2xl bg-surface-2/95 backdrop-blur-md ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in">
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
                                        {/* **他人のプロフィールにだけ出す。** ログインしていない人は
                                            口が断るので出さない。自分は自分をブロックできない */}
                                        {!isOwner && viewerAuthed && (
                                            <button
                                                role="menuitem"
                                                onClick={() => { setShareOpen(false); void toggleBlock(); }}
                                                disabled={blocking}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/85 hover:bg-white/10 active:bg-white/15 transition text-left border-t border-white/5 disabled:opacity-50"
                                            >
                                                <NoSymbolIcon className="w-[18px] h-[18px] text-white/50 flex-shrink-0" />
                                                {blocked
                                                    ? (locale === "en" ? "Unblock" : "ブロックを解除")
                                                    : (locale === "en" ? "Block this user" : "この人をブロック")}
                                            </button>
                                        )}
                                        {/* **押す前に、戻せないことを言う。**
                                            ブロックは両向きのフォローを切り、
                                            解除しても**戻らない**（`BlockedUsers` が
                                            そう書いている）。それを、無害な4項目
                                            （リンク・X・LINE・QR）の隣に確認なしで
                                            置いていた。`StoryViewer` 側は押す前に
                                            出しているのに、こちらは押したあとの
                                            トーストで初めて言っていた */}
                                        {!isOwner && viewerAuthed && !blocked && (
                                            <p className="px-4 pb-3 text-[11px] text-white/60 leading-relaxed border-t border-white/5 pt-2">
                                                {locale === "en"
                                                    ? "Blocking also removes follows in both directions. Unblocking does not restore them."
                                                    : "ブロックすると、お互いのフォローも外れます。解除しても戻りません。"}
                                            </p>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* プロフィールヘッダー: アバターだけがカバーバンドの下端に重なり、
                        名前と一言はカバーの外（黒背景）に置く。カバー写真の柄と
                        文字が重なって読みにくくなるのを避けるため。 */}
                    {/* **PC は横に使う**（owner の指示書 2026-09-22:「PCでは
                        プロフィールヘッダーを横方向に活用し、写真一覧を複数カラムで」）。
                        スマホ（1024px 未満）は最終版モックのまま縦に積む */}
                    <div className="pb-5 pt-2 lg:flex lg:items-start lg:gap-8">
                        {/* アバター（オリジナルのオーロラリング: 既定は主色で回転）。
                            本人には右下に「＋」（投稿する）——モックと同じ */}
                        <div className="relative w-fit rounded-full shadow-lg shadow-accent/20 lg:flex-shrink-0">
                            {/* 回転するグラデーション層（アバターは静止したまま背面だけ回る） */}
                            <div
                                className="absolute inset-0 rounded-full avatar-orbit"
                                style={{ background: themeRingGradient(userProfile?.themeColor) }}
                                aria-hidden="true"
                            />
                            <div className="relative rounded-full p-[3px]">
                                <div className="rounded-full p-[2px] bg-bg">
                                    <UserAvatar userId={userId} className="w-[84px] h-[84px] lg:w-[120px] lg:h-[120px]" iconClassName="w-11 h-11 lg:w-16 lg:h-16" />
                                </div>
                            </div>
                            {isOwner && (
                                <button
                                    ref={postBtnRef}
                                    type="button"
                                    onClick={() => setPostOpen(true)}
                                    aria-haspopup="dialog"
                                    aria-expanded={postOpen}
                                    aria-label={locale === "en" ? "Create" : "投稿する"}
                                    className="absolute right-0 bottom-0 inline-flex items-center justify-center rounded-full bg-accent-fill text-white ring-[3px] ring-bg hover:brightness-110 active:scale-95 transition"
                                    style={{ width: "28px", height: "28px", touchAction: "manipulation" }}
                                >
                                    <PlusIcon aria-hidden="true" style={{ width: "16px", height: "16px" }} strokeWidth={2.5} />
                                </button>
                            )}
                        </div>

                        <div className="lg:flex-1 lg:min-w-0">
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
                            {/* **ブロック中は出さない。** サーバーは 400
                                「ブロック中の相手です。解除は設定の
                                『ブロックした人』からできます」を必ず返すので、
                                押せる形で置くと**必ず失敗する操作へ誘う**。
                                **`blocked` はこの画面で押した結果しか
                                持たない**ので、開き直すとボタンは戻る
                                ——以前ブロックした相手には今も出る。
                                塞ぐには開いたときに `GET /user/blocks` を
                                引くことになり、プロフィールを開くたびに
                                1往復増えるので別に判断する。
                                これで `key` による張り直しも要らなくなった
                                ——張り直すと `busyRef` / `pending` ごと
                                作り直され、**二重送信の番人が外れる**
                                （飛んでいる POST の最中に押せる） */}
                            {isOwner ? (
                                // モックはここに枠線の「プロフィールを編集」（以前は下の行に
                                // 「投稿する」と並べていた。投稿はアバターの＋へ移した）
                                <Link
                                    href={ROUTES.PROFILE_EDIT}
                                    prefetch={false}
                                    className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-transparent ring-1 ring-accent text-accent hover:bg-accent/10 font-semibold transition"
                                    style={{ fontSize: "13px", lineHeight: "18px", padding: "8px 14px", touchAction: "manipulation", minHeight: "36px" }}
                                >
                                    {locale === "en" ? "Edit profile" : "プロフィールを編集"}
                                </Link>
                            ) : !blocked ? (
                                <div className="flex-shrink-0">
                                    <FollowAction
                                        targetUserId={userId}
                                        isOwner={isOwner}
                                        isAuthenticated={viewerAuthed}
                                        locale={locale as "ja" | "en"}
                                    />
                                </div>
                            ) : null}
                        </div>

                        {/* 自己紹介: 名前のすぐ下（従来ステータスがあった位置）に置く。
                            **`break-words` を落とさない**——URL は `/` で折り返さないので
                            1語として扱われ、**ページ全体が横に流れる**（実測: 幅375pxで
                            55文字、320pxで50文字の URL から `scrollWidth` が超える。
                            自己紹介は300文字まで入る）。ストーリーのキャプションと
                            コメント本文には最初から付いていた */}
                        {shownBio && (
                            <p className="text-sm text-white/85 whitespace-pre-wrap break-words mb-4 leading-relaxed">{shownBio}</p>
                        )}

                    {/* 数字の行（最終版モック）: 投稿 ／ フォロワー ／ フォロー中。
                        縦線で区切り、数字が上・ラベルが下。
                        **いいねの合計はモックに無いので出さない**（本人以外に見せる
                        意味が薄く、実データも 0）。「うち非公開」は本人だけの情報なので
                        投稿の数字の下に小さく残す。
                        **届く前に「0投稿」と言い切らない**——実測で応答を保持すると
                        5秒・20秒・45秒のいずれでも「0投稿」だった。ビルド後に登録した
                        人（定期ビルドは週1なので最大7日）のプロフィールが該当する */}
                    <div className="flex items-center py-4 border-b border-white/10">
                        <div className="flex-1 text-center">
                            <span className="block font-bold tabular-nums leading-none" style={{ fontSize: `${STAT_NUMBER_PX}px` }}>{photosResolved ? postCount : "…"}</span>
                            <span className="block text-white/60 mt-1 leading-none" style={{ fontSize: `${STAT_LABEL_PX}px` }}>{locale === "en" ? "posts" : "投稿"}</span>
                            {photosResolved && hiddenCount > 0 && (
                                <span className="block text-white/50 mt-1" style={{ fontSize: "11px" }}>
                                    {locale === "en" ? `(${hiddenCount} private)` : `（うち非公開 ${hiddenCount}）`}
                                </span>
                            )}
                        </div>
                        <span aria-hidden="true" className="w-px self-center bg-white/10" style={{ height: `${STAT_DIVIDER_PX}px` }} />
                        <FollowButton
                            targetUserId={userId}
                            isOwner={isOwner}
                            isAuthenticated={viewerAuthed}
                            locale={locale as "ja" | "en"}
                            variant="stats"
                        />
                    </div>

                    {/* 旅の実績（最終版モック `docs/mockups/04-mypage.jpg` の3番）。
                        モックは「訪れた国・地域 ｜ 総移動距離 ›」の2枠だが、
                        **訪れた国は持っていない**（撮影地は自由文字列で、国を当てるには
                        逆ジオコードの country を写真に書く必要がある＝データと API の話）。
                        持っていない欄は出さないので、総移動距離の1枠だけになる
                        （座標を持つ写真が2枚以上・1km 以上のときだけ）。

                        **形と大きさはモックのとおりに揃えた**——角丸のカードではなく
                        数字の行と同じ「下に細い線を1本」で、青いアイコンの右に
                        ラベルが上・数字が下。大きさは `statCellStyle.ts`（画素から実測）。

                        **`›` は本人のページだけ。** モックはマイページなので押した先が
                        あるが、このサイトで実在するのは撮影地マップ（`/map`）で、
                        そこに出るのは**全員の写真**。他人のページに置くと
                        「この人の旅の続き」に見えて別のものへ連れて行くので出さない
                        （押せるのに約束と違うものを出さない——CLAUDE.md の型）。 */}
                    {footprint.geoCount >= 2 && footprint.distanceKm >= 1 && (() => {
                        const label = locale === "en" ? "Distance traveled" : "総移動距離";
                        const rowClass = "flex items-center gap-3 py-3 mb-4 border-b border-white/10";
                        const body = (
                            <>
                                <PaperAirplaneIcon aria-hidden="true" className="-rotate-45 text-accent flex-shrink-0" style={{ width: `${ACHIEVEMENT_ICON_PX}px`, height: `${ACHIEVEMENT_ICON_PX}px` }} />
                                <span className="min-w-0">
                                    <span className="block text-white/60 leading-none" style={{ fontSize: `${ACHIEVEMENT_LABEL_PX}px` }}>{label}</span>
                                    <span className="block mt-1 leading-none">
                                        <span className="font-bold tabular-nums" style={{ fontSize: `${ACHIEVEMENT_VALUE_PX}px` }}>{Math.round(footprint.distanceKm).toLocaleString()}</span>
                                        <span className="text-white/60 ml-1" style={{ fontSize: `${ACHIEVEMENT_LABEL_PX}px` }}>km</span>
                                    </span>
                                </span>
                                {isOwner && <ChevronRightIcon aria-hidden="true" className="ml-auto text-white/40 flex-shrink-0" style={{ width: "18px", height: "18px" }} />}
                            </>
                        );
                        const title = locale === "en" ? "Total distance traveled" : "旅した総移動距離";
                        return isOwner ? (
                            <Link href={ROUTES.MAP} prefetch={false} title={title}
                                  aria-label={locale === "en" ? "Open the photo map" : "撮影地マップを開く"}
                                  className={`${rowClass} hover:bg-white/[0.04] transition-colors`}>
                                {body}
                            </Link>
                        ) : (
                            <div className={rowClass} title={title}>{body}</div>
                        );
                    })()}

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
                                <span className="text-[11px] tracking-widest uppercase text-white/50">{locale === "en" ? "My BGM" : "マイBGM"}</span>
                                <span className="ml-auto text-[10px] text-white/50">{musicServiceLabel(songEmbed.service)}</span>
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
                                            title="マイBGM"
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
                                    title="マイBGM"
                                    className="w-full"
                                    style={{ height: songEmbed.height ?? 152 }}
                                    allow="encrypted-media; autoplay; clipboard-write"
                                    loading="lazy"
                                />
                            )}
                        </div>
                    )}


                    {/* **編集は名前の右の枠線ボタン、投稿はアバターの「＋」へ移した**
                        （最終版モック）。ここに在った2つ並びのボタン行は無くなった。
                        `postBtnRef` は `PostSheet` の戻り先として＋ボタンが持つ */}
                    </div>{/* /PC の右列 */}

                    {isOwner && (
                        <div className="mt-2 text-center">
                            <Link
                                href={ROUTES.DRAFTS}
                                prefetch={false}
                                className="inline-flex items-center justify-center px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "Drafts →" : "下書き →"}
                            </Link>
                            {/* ストーリーのアーカイブ（本人だけ）。輪はハイライトで、
                                アーカイブそのものは輪にしない——入口はここ */}
                            <Link
                                href={ROUTES.STORY_ARCHIVE}
                                prefetch={false}
                                className="inline-flex items-center justify-center px-3 py-1.5 text-sm text-white/60 hover:text-white transition-colors"
                                style={{ touchAction: "manipulation" }}
                            >
                                {locale === "en" ? "Archive →" : "アーカイブ →"}
                            </Link>
                        </div>
                    )}

                    </div>
                </div>
            </div>

            {/* ストーリー（24時間で消える投稿）。**本人のページだけ**——出るのは
                自分とフォローしている人のぶんで、他人のページに置く筋が無い */}
            {isOwner && (
                <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 pb-2">
                    <StoriesBar />
                </div>
            )}

            {/* ハイライト（アーカイブから束ねた輪・⑦）。**誰のページにも、誰にでも出る**
                ——それがハイライトの役目（本人だけのアーカイブは輪にしない）。
                0件なら本人以外には何も描かない。本人には「新規」と鉛筆が付く */}
            <HighlightsRow
                userId={userId}
                displayName={displayName ?? (locale === "en" ? "Anonymous" : "ユーザー")}
                isOwner={isOwner}
                isAuthenticated={viewerAuthed}
                ownUserId={isOwner ? userId : null}
                locale={locale as "ja" | "en"}
            />

            {/* コンテンツ（黒背景）: 投稿 / 年表 */}
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
                                className={`relative flex items-center justify-center gap-1.5 py-3 text-xs font-medium tracking-wide transition-colors ${active ? "text-white" : "text-white/50 hover:text-white/70"}`}
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
                    onClickCapture={onTabClickCapture}
                    onPointerCancel={() => { swipeStartRef.current = null; swallowClickRef.current = false; }}
                    style={{ touchAction: "pan-y" }}
                >
                {/* 投稿タブ */}
                {tab === "posts" && (
                    // 分かるまでは何も出さない。**待っている間に「無い」と
                    // 言わない**（言ってしまうと、写真がある人のページでも
                    // 空の案内が一瞬出る）
                    postCount === 0 ? (photosResolved ? (
                        <div className="flex flex-col items-center justify-center py-24 text-white/50 gap-3">
                            <div className="w-16 h-16 rounded-full border-2 border-white/15 flex items-center justify-center">
                                <PhotoStackIcon className="w-7 h-7" />
                            </div>
                            <p className="text-sm">{locale === "en" ? "No photos yet." : "まだ写真がありません。"}</p>
                            {isOwner && (
                                <Link href={ROUTES.UPLOAD} prefetch={false} className="mt-1 px-5 py-2 bg-accent-fill text-white text-sm font-semibold rounded-full hover:brightness-110 transition-colors">
                                    {locale === "en" ? "Share your first photo" : "最初の写真を投稿"}
                                </Link>
                            )}
                        </div>
                    ) : null) : (
                        <div className="grid grid-cols-3 lg:grid-cols-4 gap-[2px] pb-8">
                            {orderedPhotos.map((photo, i) => (
                                <PhotoCard
                                    key={photo.id}
                                    priority={i < PROFILE_PRIORITY_THUMBS}
                                    onDelete={isOwner ? setPhotoToDelete : undefined}
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
                {/* 年表タブ */}
                {tab === "timeline" && (
                    <div className="pb-8 pt-2">
                        {timeline.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-24 text-white/50 gap-3">
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
                                            <span className="w-3.5 h-3.5 rounded-full bg-white ring-4 ring-bg flex-shrink-0" />
                                            <span className="text-sm font-bold">{g.label}</span>
                                            <span className="text-[11px] text-white/50">{g.photos.length}{locale === "en" ? "" : "枚"}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-1">
                                            {g.photos.map((photo) => (
                                                <PhotoCard key={photo.id} photo={photo} locale={locale} isOwner={isOwner} onTogglePublish={handleTogglePublish} onDelete={isOwner ? setPhotoToDelete : undefined} />
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

            {/* 投稿する（写真／ストーリーの2択）。「＋」と同じ部品 */}
            {postOpen && <PostSheet onClose={closePost} locale={locale} restoreRef={postBtnRef} />}

            {/* プロフィールQRコード */}
            {qrOpen && (
                <div
                    ref={qrRef}
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
                            <img src={qrDataUrl} // ダイアログ名（プロフィールQRコード）と直下の説明で足りるので、
                                // 画像そのものは飾り扱いにする（同じことを二度読ませない）
                                alt="" className="w-full rounded-xl" />
                        ) : (
                            <div className="aspect-square flex items-center justify-center">
                                <div className="w-8 h-8 border-2 border-black/20 border-t-black/60 rounded-full animate-spin" />
                            </div>
                        )}
                        <p className="mt-3 text-sm font-bold text-black truncate">
                            {displayName ?? (locale === "en" ? "Profile" : "プロフィール")}
                        </p>
                        <p className="mt-0.5 text-[11px] text-black/55">
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
            <DeleteConfirmModal
                photo={photoToDelete}
                isOpen={!!photoToDelete}
                onClose={() => setPhotoToDelete(null)}
                onConfirm={handleDeletePhoto}
                locale={locale as "ja" | "en"}
                deleting={deletingPhoto}
            />
        </main>
    );
}
