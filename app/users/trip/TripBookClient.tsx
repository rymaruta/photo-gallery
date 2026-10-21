"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowUpOnSquareIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../../i18n/context";
import { useAuth } from "../../auth/context";
import { useToast } from "../../../lib/hooks/useToast";
import { publicFetch, userFetch } from "../../../lib/utils/api";
import { usablePhotoRows } from "../../../lib/utils/apiRows";
import { publicImageUrl } from "../../../lib/utils/seo";
import { photoOwnTitle } from "../../../lib/utils/photoTitle";
import { getLocalizedParagraphs } from "../../../lib/data/photos";
import { ROUTES } from "../../../lib/routes";
import { shareUrl } from "../../../lib/utils/share";
import { EmptyState, LoadingState } from "../../components/StateViews";
import { BTN_FILL } from "../../components/buttonStyles";
import { focalPosition, tripName } from "../TripShelf";
import { shortPlace } from "../../../lib/utils/editorialLayout";
import PHOTOS_JSON from "../../data/photos.json";
import {
    coverOf, dateRange, daysLabel, daysOf, distanceText, findTrip, monthDay, placeCount, profileTripPhotos,
    routeStops, sampledStops, shareText, shelfTrips, tripDays, tripDistanceKm, type RouteStop, type Trip, type TripPhoto,
} from "../../../lib/utils/tripBook";

/**
 * **旅の一冊**（iOS の `Features/Trips/TripBookView.swift`・板 TripBook・2026-10-21 に Web へ）。
 *
 * 表紙 → 数字 → たどった場所 → 日ごとのページの順に、下へ流れる1本の読み物。
 * 写真を「並べる」のではなく「読ませる」——ここが一覧との違い。
 *
 * - **その人の公開写真だけ**から、プロフィールの棚と同じ規則でまとめる（`profileTripPhotos`・
 *   `shelfTrips`）。一冊は URL の `p`（写真の id）を含む一冊。写真が増えても同じ一冊に着く
 * - サーバーは変えていない。読むのは静的 JSON と公開の口（`GET /photos?userId=`）だけ
 * - **ブロックの関係なら出さない**（見ている人がこの人をブロックしている。プロフィールと同じ一覧で見る）
 * - 色: 表紙は写真の上なので**白だけ**（眉ラベルも白・iOS と同じ）。黒地の上の眉ラベル
 *   （「たどった場所」「DAY 1」）と足取りの線は真鍮。数字は白の等幅数字
 * - 「この一冊を送る」は写真のある画面の主ボタン＝白。共有シート（無ければ URL をコピー）
 */

const display = (s: string) => shortPlace(s) || s;

function staticPhotos(userId: string): TripPhoto[] {
    return (PHOTOS_JSON as TripPhoto[]).filter((p) => p.userId === userId);
}

export default function TripBookClient({ userId, photoId }: { userId: string; photoId: string }) {
    const { locale } = useLocale();
    const isJa = locale !== "en";
    const { showToast } = useToast();
    const { isAuthenticated, userId: viewerId } = useAuth();
    const [photos, setPhotos] = useState<TripPhoto[]>(() => staticPhotos(userId));
    const [resolved, setResolved] = useState(false);
    const [blocked, setBlocked] = useState(false);

    // 公開の口から最新を読む（ビルド後の写真も一冊に入る）。読めなければ静的のまま
    useEffect(() => {
        if (!userId) { setResolved(true); return; }
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await publicFetch(`/photos?userId=${encodeURIComponent(userId)}`, { signal: controller.signal, cache: "no-store" });
                if (res.ok) {
                    const rows = usablePhotoRows<TripPhoto>(await res.json(), "GET /photos?userId=");
                    if (rows) setPhotos(rows);
                }
            } catch {
                // 回線断: 静的のまま（静的に無い人は「見つかりません」になる）
            }
            if (!controller.signal.aborted) setResolved(true);
        })();
        return () => controller.abort();
    }, [userId]);

    // ブロックの関係なら出さない（プロフィールと同じ `GET /user/blocks`）。取れなければ出す
    useEffect(() => {
        if (!isAuthenticated || !userId || viewerId === userId) return;
        let cancelled = false;
        void userFetch("/user/blocks")
            .then((res) => (res.ok ? res.json().catch(() => null) : null))
            .then((body: { blockedIds?: unknown } | null) => {
                const ids = body?.blockedIds;
                if (!cancelled && Array.isArray(ids) && ids.includes(userId)) setBlocked(true);
            })
            .catch(() => { /* 取れなければ出す */ });
        return () => { cancelled = true; };
    }, [isAuthenticated, viewerId, userId]);

    const trip = useMemo(
        () => findTrip(shelfTrips(profileTripPhotos(photos, blocked)), photoId),
        [photos, blocked, photoId],
    );
    const ownerName = useMemo(() => {
        const p = photos.find((x) => x.displayName || x.uploaderDisplayName);
        return p?.displayName || p?.uploaderDisplayName || "";
    }, [photos]);
    const profileHref = userId ? ROUTES.USER_PROFILE(userId) : ROUTES.HOME;

    if (!trip) {
        return (
            <main className="min-h-screen text-white bg-bg max-w-2xl mx-auto w-full px-4">
                <h1 className="sr-only">{isJa ? "旅の一冊" : "Trip book"}</h1>
                {!resolved ? (
                    <LoadingState kind="rows" locale={isJa ? "ja" : "en"} className="py-16" testId="trip-book-loading" />
                ) : (
                    <EmptyState
                        className="py-24"
                        title={isJa ? "この旅は見つかりませんでした" : "This trip wasn't found"}
                        message={isJa ? "写真が非公開になったか、削除された可能性があります。" : "Its photos may have been made private or deleted."}
                        action={{ label: isJa ? "プロフィールへ" : "Go to profile", href: profileHref }}
                        testId="trip-book-missing"
                    />
                )}
            </main>
        );
    }

    return <Book trip={trip} isJa={isJa} ownerName={ownerName} profileHref={profileHref} showToast={showToast} />;
}

function Book({ trip, isJa, ownerName, profileHref, showToast }: {
    trip: Trip; isJa: boolean; ownerName: string; profileHref: string;
    showToast: ReturnType<typeof useToast>["showToast"];
}) {
    const cover = coverOf(trip);
    const title = tripName(trip, isJa);
    const distance = tripDistanceKm(trip.photos);
    const stops = sampledStops(routeStops(trip));
    const days = daysOf(trip);

    const share = async () => {
        const url = typeof window !== "undefined" ? window.location.href : "";
        const text = `${shareText(trip, isJa, display)}${ownerName ? (isJa ? `\n撮影: ${ownerName}` : `\nPhotos by ${ownerName}`) : ""}`;
        const r = await shareUrl(url, title, text);
        if (r === "copied") showToast(isJa ? "リンクをコピーしました" : "Link copied", "success");
        else if (r === "failed") showToast(isJa ? "共有できませんでした" : "Couldn't share", "error");
    };

    return (
        <main className="min-h-screen text-white bg-bg" data-testid="trip-book">
            {/* 表紙。写真が全面に敷かれる（スマホは端から端まで・3:4）。下だけ暗くして地の黒につなぐ */}
            <header className="relative w-full max-w-3xl mx-auto overflow-hidden aspect-[3/4] sm:aspect-[16/10] sm:rounded-b-2xl">
                {cover && (
                    <picture>
                        {cover.srcAvif && <source type="image/avif" srcSet={publicImageUrl(cover.srcAvif)} />}
                        <img src={publicImageUrl(cover.src)} alt="" fetchPriority="high"
                             className="absolute inset-0 w-full h-full object-cover"
                             style={{ objectPosition: focalPosition(cover) }} />
                    </picture>
                )}
                <span aria-hidden="true" className="absolute inset-0"
                      style={{ background: "linear-gradient(to bottom, rgb(0 0 0 / 0) 50%, #000 100%)" }} />
                <span aria-hidden="true" className="absolute inset-x-0 top-0"
                      style={{ height: "140px", background: "linear-gradient(to bottom, rgb(0 0 0 / 0.5), rgb(0 0 0 / 0))" }} />
                <Link href={profileHref} prefetch={false}
                      aria-label={isJa ? "プロフィールへ戻る" : "Back to profile"}
                      className="absolute top-3 left-3 inline-flex items-center justify-center rounded-full bg-black/40 backdrop-blur text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      style={{ width: "44px", height: "44px", touchAction: "manipulation" }}>
                    <ArrowLeftIcon aria-hidden="true" style={{ width: "20px", height: "20px" }} />
                </Link>
                <div className="absolute left-5 right-5 bottom-[18px] flex flex-col gap-1.5">
                    {/* 眉ラベル。**写真の上なので白**（真鍮は夕日の写真の上で読めない・iOS と同じ） */}
                    {/* 読み上げは「旅の一冊」（「トリップブック」と英語で読ませない）。<p> の aria-label は読まれないので、見た目の字を隠して別に置く */}
                    <p className="m-0 eyebrow" style={{ color: "rgb(255 255 255 / 0.88)" }} data-testid="trip-book-eyebrow">
                        <span aria-hidden="true">{isJa ? "TRIP BOOK · 自動でまとまった旅" : "TRIP BOOK · Put together for you"}</span>
                        <span className="sr-only">{isJa ? "旅の一冊・自動でまとまった旅" : "Trip book, put together for you"}</span>
                    </p>
                    <h1 className="m-0 font-serif font-bold text-white break-words"
                        style={{ fontSize: "32px", lineHeight: 1.2, textShadow: "0 2px 14px rgb(0 0 0 / 0.5)" }}>{title}</h1>
                    <p className="m-0 tabular-nums" style={{ fontSize: "13px", color: "rgb(255 255 255 / 0.78)" }}>
                        {dateRange(trip.start, trip.end)} · {daysLabel(tripDays(trip), isJa)}
                    </p>
                </div>
            </header>

            <div className="max-w-2xl mx-auto w-full px-5">
                {ownerName && (
                    <p className="m-0 mt-3 text-text-3" style={{ fontSize: "12px" }}>
                        {isJa ? "撮影: " : "Photos by "}
                        <Link href={profileHref} prefetch={false} className="text-text-2 underline underline-offset-2 hover:text-white inline-flex items-center" style={{ minHeight: "44px" }}>{ownerName}</Link>
                    </p>
                )}

                {/* 数（枚・撮影地・移動（直線））。距離は写真の座標を直線でつないだ合計で、道のりではない */}
                <dl className="m-0 mt-3 grid grid-cols-3 gap-2" data-testid="trip-book-stats">
                    <Stat value={String(trip.photos.length)} label={isJa ? "枚" : "Photos"} />
                    <Stat value={String(placeCount(trip.photos))} label={isJa ? "撮影地" : "Places"} />
                    <Stat value={distanceText(distance)} unit={distance === null ? undefined : "km"} label={isJa ? "移動（直線）" : "Distance (straight)"} />
                </dl>

                {stops.length > 0 && <Route stops={stops} distance={distance} isJa={isJa} />}

                {/* 日ごとのページ。写真を1枚ずつ大きく（一覧の格子にすると「一冊」にならない） */}
                <div className="mt-10 flex flex-col gap-9">
                    {days.map((d) => (
                        <section key={d.number} aria-labelledby={`trip-day-${d.number}`} className="flex flex-col gap-5" data-testid="trip-book-day">
                            <div className="flex flex-col gap-1.5">
                                <p aria-hidden="true" className="m-0 eyebrow eyebrow-line text-accent">DAY {d.number} · {monthDay(d.day)}</p>
                                <h2 id={`trip-day-${d.number}`} className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: 1.3 }}>
                                    <span className="sr-only">{isJa ? `${d.number}日目 ${monthDay(d.day)} ` : `Day ${d.number}, ${monthDay(d.day)} `}</span>
                                    {d.place ? display(d.place) : <span aria-hidden="true">{monthDay(d.day)}</span>}
                                </h2>
                            </div>
                            {d.photos.map((p) => <Page key={p.id} photo={p} dayPlace={d.place} isJa={isJa} />)}
                        </section>
                    ))}
                </div>
            </div>

            {/* 「この一冊を送る」——下の案内の上に貼る（写真のある画面の主ボタン＝白） */}
            <div className="sticky z-30 mt-10 px-5 pb-3 pt-4 max-w-2xl mx-auto w-full"
                 style={{ bottom: "var(--bottom-bar-h, 84px)", background: "linear-gradient(to bottom, rgb(0 0 0 / 0), #000 16px)" }}>
                <button type="button" onClick={() => void share()} data-testid="trip-book-share"
                        className={`${BTN_FILL} w-full inline-flex items-center justify-center gap-2 bg-primary text-ink hover:brightness-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                        style={{ touchAction: "manipulation" }}>
                    <ArrowUpOnSquareIcon aria-hidden="true" style={{ width: "20px", height: "20px" }} />
                    {isJa ? "この一冊を送る" : "Send this trip book"}
                </button>
            </div>
        </main>
    );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
    return (
        // 見た目は数が上・札が下。dl の決まり（dt が先）に合わせて、並びは逆順に描く
        <div className="flex flex-col-reverse gap-1 min-w-0">
            <dt className="text-text-3 truncate" style={{ fontSize: "12px" }}>{label}</dt>
            <dd className="m-0 whitespace-nowrap">
                <span className="tabular-nums text-white" style={{ fontSize: "28px", fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{value}</span>
                {unit && <span className="text-text-3 tabular-nums" style={{ fontSize: "13px", marginLeft: "3px" }}>{unit}</span>}
            </dd>
        </div>
    );
}

/**
 * たどった場所（iOS の `route`）。番号の丸（20・数字は本文系の最小 12。板は 18）を真鍮の線でつなぐ（終点だけ真鍮の塗りに墨の数字）。
 * 札は2行（DAY n／地名）。**2か所以上のときだけ**（`routeStops`）、4か所まで（`sampledStops`）
 */
function Route({ stops, distance, isJa }: { stops: RouteStop[]; distance: number | null; isJa: boolean }) {
    const spoken = stops.map((s) => (isJa ? `${s.day}日目 ${display(s.place)}` : `Day ${s.day} ${display(s.place)}`)).join(isJa ? "、" : ", ");
    const half = 50 / stops.length;
    return (
        <section aria-labelledby="trip-route-heading" className="mt-8 flex flex-col gap-2.5">
            <h2 id="trip-route-heading" className="m-0 eyebrow eyebrow-line text-accent">{isJa ? "たどった場所" : "WHERE THEY WENT"}</h2>
            <div className="rounded-[14px] px-3.5 pt-2 pb-4" style={{ background: "#0B0C0E" }} data-testid="trip-book-route">
                <p className="m-0 text-text-3 tabular-nums" style={{ fontSize: "12px", letterSpacing: "0.12em" }} aria-hidden="true">
                    ROUTE · {distanceText(distance)}{distance === null ? "" : " km"}
                </p>
                <ol role="img" aria-label={spoken} className="relative m-0 mt-3 p-0 list-none flex">
                    {/* 線は最初の丸の中心から最後の丸の中心まで */}
                    <span aria-hidden="true" className="absolute bg-accent"
                          style={{ top: "9.25px", height: "1.5px", left: `${half}%`, right: `${half}%` }} />
                    {stops.map((s, i) => {
                        const last = i === stops.length - 1;
                        return (
                            <li key={i} aria-hidden="true" className="relative flex-1 min-w-0 flex flex-col items-center text-center gap-1.5">
                                <span className={`inline-flex items-center justify-center rounded-full tabular-nums font-bold ${last ? "bg-accent text-ink" : "bg-black text-accent"}`}
                                      style={{ width: "20px", height: "20px", fontSize: "12px", boxShadow: "inset 0 0 0 1.5px var(--color-accent)" }}>
                                    {i + 1}
                                </span>
                                <span className="text-text-3 tabular-nums" style={{ fontSize: "12px", lineHeight: "16px" }}>DAY {s.day}</span>
                                <span className="text-text-3 truncate max-w-full px-1" style={{ fontSize: "12px", lineHeight: "16px" }}>{display(s.place)}</span>
                            </li>
                        );
                    })}
                </ol>
            </div>
        </section>
    );
}

/** ページ1枚（写真を大きく → 題 → 一言 → 撮影地（段の頭と違うときだけ）） */
function Page({ photo, dayPlace, isJa }: { photo: TripPhoto; dayPlace: string; isJa: boolean }) {
    const title = photoOwnTitle(photo, isJa ? "ja" : "en");
    const first = getLocalizedParagraphs(photo.description, isJa ? "ja" : "en")[0] ?? "";
    const place = (photo.location ?? "").trim();
    const ratio = photo.width && photo.height ? photo.width / photo.height : photo.aspectRatio;
    const alt = title || (place ? display(place) : (isJa ? "旅の写真" : "Trip photo"));
    return (
        <article className="flex flex-col gap-2.5">
            <Link href={ROUTES.PHOTO(photo.id)} prefetch={false}
                  className="block -mx-2 overflow-hidden rounded-xl bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={ratio ? { aspectRatio: String(ratio) } : undefined}>
                <picture>
                    {photo.srcAvif && <source type="image/avif" srcSet={publicImageUrl(photo.srcAvif)} />}
                    <img src={publicImageUrl(photo.src)} alt={alt} loading="lazy" decoding="async"
                         className="block w-full h-full object-cover" />
                </picture>
            </Link>
            {title && <h3 className="m-0 text-white font-semibold" style={{ fontSize: "17px", lineHeight: 1.4 }}>{title}</h3>}
            {first && <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: 1.7 }}>{first}</p>}
            {place && place !== dayPlace.trim() && <p className="m-0 text-text-3" style={{ fontSize: "12px" }}>{display(place)}</p>}
        </article>
    );
}
