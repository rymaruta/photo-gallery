"use client";

/**
 * 光と天気の知らせ（Pro・デザインの板 LightAlert）。「行きたい場所の光（今週）」の一覧。
 * iOS の `LightForecastView`（2026-10-09）を Web に持ってきた（2026-10-11 owner）。
 *
 * 入口は設定の Pro の節（`app/user/settings/LightAlertSettings.tsx`）だけ。**Pro でない人には
 * 入口を出さない**が、URL を直に開かれることはあるので、403 は「Pro の方の機能です」と言うだけにする
 * ——**Web では何も売らない**ので、購入の案内へは繋がない。
 *
 * 板のとおり:
 * - 眉ラベル「行きたい場所の光（今週）」（真鍮・黒地の上の合図）
 * - 場所ごとの札（地 `bg-surface`＝#0E0E0F・角 14）: 左に色の四角 56px、名前（14 太字）といつ（12・白65%）、
 *   右に天気（13 太字）と見込み（12・白60%）。見込み「高」のいちばん早い1枚だけ真鍮 1.5px の縁
 * - 注記（12・板の文言）
 *
 * 板に無くて足したもの（iOS と同じ）:
 * - **Apple Weather の出典**（Apple が表示を求めている）。注記の下に、応答の出典のリンク（真鍮・外へ出るリンク）
 * - 札を押すと、その場所の7日（朝焼け・夕焼け・夜景）を札の中に開く
 * - 読み込み中・読めなかった（403 / 503 / ログイン切れ / その他）・0件を分ける
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { userFetch } from "../../../lib/utils/api";
import { useLoginRedirect } from "../../../lib/hooks/useLoginRedirect";
import { ROUTES } from "../../../lib/routes";
import {
    parseLightForecast, parseWeatherLogo, attributionJsonUrl, failureOf, failureText, lightCards, weekLines, noteFor, TONE_COLOR,
    type LightFailure, type LightForecast, type LightLocale, type WeatherLogo,
} from "../../../lib/utils/lightForecast";
import { BTN_LINE } from "../../components/buttonStyles";

type Phase =
    | { kind: "loading" }
    | { kind: "loaded"; forecast: LightForecast; at: Date }
    | { kind: "failed"; failure: LightFailure };

/** 一覧を読んで、画面の段階にする（状態は持たない。403 / 503 / 401 を分ける） */
async function fetchPhase(): Promise<Phase> {
    try {
        const res = await userFetch("/user/light-forecast");
        if (!res.ok) return { kind: "failed", failure: failureOf(res.status) };
        const forecast = parseLightForecast(await res.json().catch(() => null));
        return forecast ? { kind: "loaded", forecast, at: new Date() } : { kind: "failed", failure: "other" };
    } catch {
        return { kind: "failed", failure: "other" };
    }
}

/** Apple Weather のロゴ（`lib/utils/lightForecast.ts` の注記）。読めなければ null（文字の表記に倒す） */
async function fetchWeatherLogo(locale: LightLocale): Promise<WeatherLogo | null> {
    try {
        const res = await fetch(attributionJsonUrl(locale), { credentials: "omit" });
        if (!res.ok) return null;
        return parseWeatherLogo(await res.json().catch(() => null));
    } catch {
        return null;
    }
}

export default function LightForecastPage() {
    const { isAuthenticated, loading } = useAuth();
    const { locale: rawLocale } = useLocale();
    const locale: LightLocale = rawLocale === "en" ? "en" : "ja";
    const en = locale === "en";
    useLoginRedirect(!loading && !isAuthenticated);

    const [phase, setPhase] = useState<Phase>({ kind: "loading" });
    const [open, setOpen] = useState<Set<string>>(() => new Set());
    const [logo, setLogo] = useState<WeatherLogo | null>(null);

    // 商標のロゴは Apple の配る画像をそのまま使う（認証なし・30日控えてよい応答）
    useEffect(() => {
        let live = true;
        void fetchWeatherLogo(locale).then((l) => { if (live) setLogo(l); });
        return () => { live = false; };
    }, [locale]);

    useEffect(() => {
        if (!isAuthenticated) return;
        let live = true;
        void fetchPhase().then((p) => { if (live) setPhase(p); });
        return () => { live = false; };
    }, [isAuthenticated]);

    const retry = () => {
        setPhase({ kind: "loading" });
        void fetchPhase().then(setPhase);
    };

    const toggle = (key: string) => setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="max-w-sm mx-auto px-4 pt-12 pb-16">
                <Link
                    href={ROUTES.SETTINGS}
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/60 transition-colors mb-10"
                    style={{ minHeight: "44px" }}
                >
                    <ArrowLeftIcon className="w-3 h-3" />
                    {en ? "Settings" : "設定"}
                </Link>

                <h1 className="text-xl font-bold mb-6">{en ? "Light & weather alerts" : "光と天気の知らせ"}</h1>

                {/* 眉ラベル（真鍮は黒地の上の合図） */}
                <p className="eyebrow eyebrow-line text-accent mb-4">
                    {en ? "Light at your wishlist places (this week)" : "行きたい場所の光（今週）"}
                </p>

                {phase.kind === "loading" && (
                    <div role="status" aria-label={en ? "Loading" : "読み込み中"} className="flex justify-center py-10">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    </div>
                )}

                {phase.kind === "failed" && (() => {
                    const t = failureText(phase.failure, locale);
                    return (
                        <div className="text-center py-8" data-testid={`light-failed-${phase.failure}`}>
                            <p className="text-base font-semibold text-white">{t.title}</p>
                            <p className="mt-2 text-sm text-white/60 leading-relaxed">{t.body}</p>
                            {/* 403 は直らないので「もう一度」を出さない（購入の案内も出さない） */}
                            {(phase.failure === "unavailable" || phase.failure === "other") && (
                                <button
                                    type="button"
                                    onClick={retry}
                                    className={`${BTN_LINE} mt-5 inline-flex items-center justify-center hover:bg-white/5 transition`}
                                    style={{ minHeight: "44px", touchAction: "manipulation" }}
                                >
                                    {en ? "Try again" : "もう一度読み込む"}
                                </button>
                            )}
                        </div>
                    );
                })()}

                {phase.kind === "loaded" && (() => {
                    const { forecast, at } = phase;
                    const cards = lightCards(forecast, at, locale);
                    const byKey = new Map(forecast.places.map((p) => [p.key, p]));
                    return (
                        <>
                            {cards.length === 0 ? (
                                <div className="text-center py-8">
                                    <p className="text-base font-semibold text-white">
                                        {en ? "No photo spots on your wishlist yet" : "行きたい撮影スポットがまだありません"}
                                    </p>
                                    <p className="mt-2 text-sm text-white/60 leading-relaxed">
                                        {en
                                            ? "Save a photo spot with “Want to go”, and this week's light and weather will appear here. Places saved by name have no fixed location, so they can't be forecast."
                                            : "撮影スポットの画面で「行きたい」を押すと、ここに今週の光と天気が並びます。地名で入れた「行きたい」は決まった位置が無いので、光を出せません。"}
                                    </p>
                                </div>
                            ) : (
                                <ul className="flex flex-col gap-4">
                                    {cards.map((card) => {
                                        const place = byKey.get(card.key);
                                        const week = place ? weekLines(place, at, locale) : [];
                                        const isOpen = open.has(card.key);
                                        return (
                                            <li
                                                key={card.key}
                                                data-testid="light-card"
                                                data-best={card.isBest ? "true" : undefined}
                                                className="rounded-xl bg-surface p-[14px]"
                                                style={{ border: card.isBest ? "1.5px solid var(--color-accent)" : "1px solid #222222" }}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => { if (week.length > 0) toggle(card.key); }}
                                                    aria-expanded={week.length > 0 ? isOpen : undefined}
                                                    className="w-full flex items-center gap-3 text-left"
                                                    style={{ minHeight: "56px", touchAction: "manipulation" }}
                                                >
                                                    <span aria-hidden="true" className="w-14 h-14 rounded-lg flex-shrink-0" style={{ background: TONE_COLOR[card.tone] }} />
                                                    <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
                                                        {/* 縁の色だけで「いちばん」を伝えない */}
                                                        {card.isBest && <span className="sr-only">{en ? "Best this week: " : "今週いちばんの見込み："}</span>}
                                                        <span className="text-sm font-bold text-white line-clamp-2">{card.name}</span>
                                                        <span className="text-xs text-white/65 tabular-nums">{card.when}</span>
                                                    </span>
                                                    <span className="flex flex-col items-end gap-0.5 text-right">
                                                        <span className="text-[13px] font-bold text-white">{card.weather}</span>
                                                        {card.kind && <span className="text-xs text-white/60">{card.kind}</span>}
                                                    </span>
                                                </button>
                                                {isOpen && (
                                                    <div className="mt-3 pt-3 border-t border-white/[0.08] flex flex-col gap-3">
                                                        {week.map((day) => (
                                                            <div key={day.date} className="flex flex-col gap-1">
                                                                <p className="text-xs font-semibold text-white/70">{day.title}</p>
                                                                {day.items.map((item, i) => (
                                                                    <p key={i} className="flex gap-2 text-xs">
                                                                        <span className="text-white/60 tabular-nums" style={{ minWidth: "110px" }}>{item.event}</span>
                                                                        <span className={item.chance === "high" ? "text-white font-semibold" : "text-white/70"}>{item.outlook}</span>
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                            <div className="mt-4">
                                <p className="text-xs leading-relaxed text-white/55">{noteFor(forecast, locale)}</p>
                                {/* **Apple Weather の出典は必ず出す**（Apple の求め・0件でも出す）。
                                    黒地の上の外へ出るリンクは真鍮（iOS と同じ） */}
                                <a
                                    href={forecast.attribution.legalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    data-testid="light-attribution"
                                    className="inline-flex items-center text-xs text-accent underline hover:text-accent-strong"
                                    style={{ minHeight: "44px" }}
                                >
                                    {logo ? (
                                        <>
                                            {/* 商標（ Weather）。黒地なので dark。高さは配られる @1x の 14px */}
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={logo.x1}
                                                srcSet={`${logo.x1} 1x, ${logo.x2} 2x, ${logo.x3} 3x`}
                                                alt={forecast.attribution.serviceName}
                                                data-testid="light-attribution-logo"
                                                className="inline-block mr-1.5"
                                                style={{ height: "14px", width: "auto" }}
                                            />
                                            {en ? "· Other data sources" : "· ほかのデータの出典"}
                                        </>
                                    ) : en
                                        ? `Weather: ${forecast.attribution.serviceName} · Data sources`
                                        : `天気: ${forecast.attribution.serviceName} · データの出典`}
                                </a>
                            </div>
                        </>
                    );
                })()}
            </div>
        </main>
    );
}
