"use client";

import React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import Thumb from "../components/Thumb";
import { shortPlace } from "../../lib/utils/editorialLayout";
import {
    coverOf, tripBookPath, tripLine, tripTitle, tripDays, daysLabel, photoCountLabel, type Trip,
} from "../../lib/utils/tripBook";

/**
 * **旅の棚**（iOS の `Features/Trips/TripShelf.swift`・板 Trips / UserProfile F33・2026-10-21 に Web へ）。
 *
 * - いちばん新しい一冊は**大きな表紙の札**（高さ 190・角 16）。写真の上に下から黒 72% の溶け、
 *   明朝の題と「期間 · 日数 · 枚数」。**写真の上なので字は白だけ**（真鍮は置かない）
 * - 2冊目からは**写真つきの行**（高さ 72・左に 72×56 の写真・明朝の題・等幅数字の1行・下に髪線）
 * - 下に、どうやって旅になるかの説明を**旅があっても**出す（1冊できた途端に「なぜこの写真は
 *   旅になっていないのか」が分からなくならないように）
 *
 * 題は画面に出す短い形（「蔵王キツネ村, …, 日本」→「蔵王キツネ村」・`shortPlace`）。
 * iOS は `LocationMatch.display`（県と市を括弧に添える）で、Web にはその読み方がまだ無い。
 * 束ね方・比べ方は元の文字のまま（`lib/utils/tripBook.ts`）。
 */

const display = (s: string) => shortPlace(s) || s;

/** 持ち主が選んだ見せたい位置（`CropFramePicker`・`HomeMosaic` と同じ読み方） */
export function focalPosition(p: { focalPoint?: { x: number; y: number } }): string | undefined {
    return p.focalPoint ? `${Math.round(p.focalPoint.x * 100)}% ${Math.round(p.focalPoint.y * 100)}%` : undefined;
}

export function tripName(trip: Trip, isJa: boolean): string {
    return tripTitle(trip, isJa, display);
}

/** 説明の文（人に見える棚は公開写真だけで作る） */
export function shelfExplanation(isJa: boolean): string {
    return isJa
        ? "同じころに撮った公開写真が2枚たまると、ひとつの旅にまとまります"
        : "Two or more public photos taken around the same time become a trip";
}

function CoverCard({ trip, userId, isJa }: { trip: Trip; userId: string; isJa: boolean }) {
    const cover = coverOf(trip);
    const title = tripName(trip, isJa);
    const line = tripLine(trip, isJa);
    return (
        <Link
            href={tripBookPath(userId, trip)}
            prefetch={false}
            data-testid="trip-shelf-cover"
            aria-label={`${title}、${line}`}
            className="relative block overflow-hidden rounded-2xl ring-1 ring-inset ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ height: "190px", touchAction: "manipulation" }}
        >
            {cover && (
                <Thumb photo={cover} alt="" sizes="(max-width:640px) 100vw, 640px" cellAspect={2}
                       objectPosition={focalPosition(cover)} />
            )}
            {/* 下の黒 72% から、高さの 65% の所で 0 に（読める地を敷く。全面に膜は掛けない） */}
            <span aria-hidden="true" className="absolute inset-0"
                  style={{ background: "linear-gradient(to top, rgb(0 0 0 / 0.72) 0%, rgb(0 0 0 / 0) 65%)" }} />
            <span className="absolute left-4 right-4 bottom-[14px] flex flex-col gap-0.5">
                <span className="font-serif font-bold text-white line-clamp-2" style={{ fontSize: "24px", lineHeight: 1.25 }}>{title}</span>
                <span className="tabular-nums truncate" style={{ fontSize: "13px", color: "rgb(255 255 255 / 0.78)" }}>{line}</span>
            </span>
        </Link>
    );
}

function Row({ trip, userId, isJa }: { trip: Trip; userId: string; isJa: boolean }) {
    const cover = coverOf(trip);
    const title = tripName(trip, isJa);
    const line = tripLine(trip, isJa);
    return (
        <Link
            href={tripBookPath(userId, trip)}
            prefetch={false}
            data-testid="trip-shelf-row"
            aria-label={`${title}、${line}`}
            className="flex items-center gap-[14px] py-2 border-b border-line focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ minHeight: "72px", touchAction: "manipulation" }}
        >
            <span className="relative flex-shrink-0 overflow-hidden rounded-[10px] bg-surface" style={{ width: "72px", height: "56px" }}>
                {cover && <Thumb photo={cover} alt="" sizes="72px" cellAspect={72 / 56} />}
            </span>
            <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                <span className="font-serif font-bold text-white line-clamp-2" style={{ fontSize: "18px", lineHeight: 1.3 }}>{title}</span>
                <span className="text-text-3 tabular-nums truncate" style={{ fontSize: "12px" }}>{line}</span>
            </span>
        </Link>
    );
}

/** 旅のタブの中身（表紙の札＋行＋説明）。0冊なら説明だけ */
export function TripShelfList({ trips, userId, isJa }: { trips: Trip[]; userId: string; isJa: boolean }) {
    return (
        <div className="flex flex-col gap-2.5" data-testid="trip-shelf">
            {trips.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                    <p className="m-0 font-serif font-bold text-white" style={{ fontSize: "20px" }}>{isJa ? "まだ旅はありません" : "No trips yet"}</p>
                    <p className="m-0 text-text-2" style={{ fontSize: "15px", lineHeight: 1.6 }}>{shelfExplanation(isJa)}</p>
                </div>
            ) : (
                <>
                    <CoverCard trip={trips[0]} userId={userId} isJa={isJa} />
                    {trips.length > 1 && (
                        <div className="flex flex-col">
                            {trips.slice(1).map((t) => <Row key={t.id} trip={t} userId={userId} isJa={isJa} />)}
                        </div>
                    )}
                    <p className="m-0 mt-1 text-text-3" style={{ fontSize: "12px", lineHeight: 1.6 }}>{shelfExplanation(isJa)}</p>
                </>
            )}
        </div>
    );
}

/**
 * プロフィールの見出しの「旅」の行（iOS の `ProfileTripsLine`・板 UserProfile F33: 数 → 旅）。
 * いちばん新しい一冊の小さな札と、2冊以上なら「すべての旅 · N冊」（押すと旅のタブへ）
 */
export function ProfileTripsLine({ trips, userId, isJa, onShowAll }: {
    trips: Trip[]; userId: string; isJa: boolean; onShowAll: () => void;
}) {
    const latest = trips[0];
    if (!latest) return null;
    const cover = coverOf(latest);
    const title = tripName(latest, isJa);
    const facts = `${daysLabel(tripDays(latest), isJa)} · ${photoCountLabel(latest.photos.length, isJa)}`;
    return (
        <section aria-labelledby="profile-trips-heading" className="mb-4" data-testid="profile-trips">
            <h2 id="profile-trips-heading" className="eyebrow eyebrow-line text-accent">{isJa ? "旅の一冊" : "TRIP BOOKS"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3">
                <Link
                    href={tripBookPath(userId, latest)}
                    prefetch={false}
                    data-testid="profile-trip"
                    aria-label={isJa ? `旅 ${title}、${facts}` : `Trip ${title}, ${facts}`}
                    className="inline-flex items-center gap-2.5 max-w-full rounded-xl bg-chip ring-1 ring-inset ring-line overflow-hidden pr-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    style={{ height: "44px", touchAction: "manipulation" }}
                >
                    <span className="relative flex-shrink-0 overflow-hidden bg-surface" style={{ width: "44px", height: "44px" }}>
                        {cover && <Thumb photo={cover} alt="" sizes="44px" cellAspect={1} />}
                    </span>
                    <span className="min-w-0 truncate font-semibold text-white" style={{ fontSize: "14px" }}>{title}</span>
                    <span className="flex-shrink-0 text-text-3 tabular-nums" style={{ fontSize: "12px" }}>{facts}</span>
                </Link>
                {trips.length > 1 && (
                    <button
                        type="button"
                        onClick={onShowAll}
                        data-testid="profile-trips-all"
                        className="inline-flex items-center gap-1 text-text-2 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                        style={{ minHeight: "44px", fontSize: "13px", touchAction: "manipulation" }}
                    >
                        <span className="tabular-nums">{isJa ? `すべての旅 · ${trips.length}冊` : `All trips · ${trips.length}`}</span>
                        <ChevronRightIcon aria-hidden="true" className="text-text-3" style={{ width: "12px", height: "12px" }} />
                    </button>
                )}
            </div>
        </section>
    );
}
