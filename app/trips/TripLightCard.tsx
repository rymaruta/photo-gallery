"use client";

import React from "react";
import Link from "next/link";
import type { TripPlan } from "../../lib/hooks/useTripPlans";
import type { SpotRef } from "../../lib/data/spotLink";
import { spotBodyUrl } from "../../lib/utils/spotUpload";
import { timeZoneForCountry, todayIn } from "../../lib/utils/sunTimes";
import { dayLightCells, lightCellText, type DayLight } from "../../lib/utils/lightCalendar";
import { parseTripSpotBody, seasonOfMonth, tripLightCandidates } from "../../lib/utils/tripLight";

/**
 * 旅行プランの**当日モード**（前日から最終日まで・`lib/utils/tripLight.ts`）。
 * 今日か明日に予定した撮影スポットの、旅先の時計での光の時刻と、その季節の案内を出す。
 *
 *  - 本文（`/app/data/spots/<slug>.json`）は**当たった候補だけ**読む（索引の 865KB は読まない）
 *  - 読めない・当たらない間は**何も出さない**（おまけの札なので、断りで画面を埋めない）
 *  - 言い分け（白夜・終日・翌…）は撮影の光の表と同じ（`dayLightCells`）。天気は含まないと書く
 */
type Shown = {
    planId: string;
    slug: string;
    name: string;
    ymd: string;
    isTomorrow: boolean;
    dayNumber: number;
    cells: DayLight;
    guide: { season: string; text: string } | null;
};

const SEASON: Record<string, [string, string]> = {
    spring: ["春", "Spring"], summer: ["夏", "Summer"], autumn: ["秋", "Autumn"], winter: ["冬", "Winter"],
};

/** 端末の暦の今日（旅先で開けばその土地の今日） */
function localToday(): string | null {
    try {
        return todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
        return null;
    }
}

export default function TripLightCard({ plans, spots, en }: { plans: readonly TripPlan[]; spots: Record<string, SpotRef>; en: boolean }) {
    const [shown, setShown] = React.useState<Shown | null>(null);
    // 変わったときだけ読み直す（プランの中身を文字にして比べる）
    const key = JSON.stringify(plans.map((p) => [p.planId, p.startDate, p.endDate, p.days]));

    React.useEffect(() => {
        const today = localToday();
        let alive = true;
        (async () => {
            if (!today) return;
            for (const plan of plans) {
                for (const cand of tripLightCandidates(plan, today)) {
                    for (const spotId of cand.spotIds) {
                        const slug = spots[spotId]?.slug;
                        if (!slug) continue;
                        try {
                            const res = await fetch(spotBodyUrl(slug));
                            if (!alive) return;
                            if (!res.ok) continue;
                            const body = parseTripSpotBody(await res.json(), slug);
                            if (!alive) return;
                            const zone = body ? timeZoneForCountry(body.country) : null;
                            const cells = body && zone ? dayLightCells(cand.ymd, body.coords, zone) : null;
                            if (!body || !cells) continue;
                            const season = seasonOfMonth(Number(cand.ymd.slice(5, 7)));
                            setShown({
                                planId: plan.planId, slug, name: body.name, ymd: cand.ymd,
                                isTomorrow: cand.isTomorrow, dayNumber: cand.dayNumber, cells,
                                guide: body.seasonalGuide.find((g) => g.season === season) ?? null,
                            });
                            return;
                        } catch {
                            if (!alive) return;
                        }
                    }
                }
            }
            if (alive) setShown(null);
        })();
        return () => {
            alive = false;
        };
        // `key` がプランの中身を表す（plans の参照が毎回変わっても読み直さない）
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, spots]);

    if (!shown) return null;
    const [m, d] = [Number(shown.ymd.slice(5, 7)), Number(shown.ymd.slice(8, 10))];
    const when = shown.isTomorrow ? (en ? "Tomorrow" : "明日") : (en ? "Today" : "今日");
    const rows: [string, string][] = [
        [en ? "Sunrise" : "日の出", lightCellText(shown.cells.sunrise, !en)],
        [en ? "Evening golden hour" : "夕方のマジックアワー", lightCellText(shown.cells.eveningGolden, !en)],
        [en ? "Sunset" : "日の入り", lightCellText(shown.cells.sunset, !en)],
    ];
    return (
        <section className="mb-4 rounded-2xl bg-surface p-4" aria-labelledby="trip-light-title" data-testid="trip-light">
            <p className="m-0 font-mono font-medium uppercase text-accent" style={{ fontSize: "11px", letterSpacing: "1.5px" }}>
                {en ? `${when} · Day ${shown.dayNumber} · ${m}/${d}` : `${when} · ${shown.dayNumber}日目 · ${m}/${d}`}
            </p>
            <h2 id="trip-light-title" className="m-0 mt-1 font-serif font-bold text-white" style={{ fontSize: "18px", lineHeight: "24px" }}>
                <Link href={`/spots/${shown.slug}`} prefetch={false} className="hover:underline underline-offset-4">{shown.name}</Link>
            </h2>
            <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5" style={{ fontSize: "14px", lineHeight: "20px" }}>
                {rows.map(([label, value]) => (
                    <React.Fragment key={label}>
                        <dt className="text-white/60">{label}</dt>
                        <dd className="m-0 font-mono tabular-nums text-white/90">{value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            {shown.guide && (
                <p className="m-0 mt-3 text-white/85" style={{ fontSize: "14px", lineHeight: "22px" }}>
                    <span className="text-white/60">{(SEASON[shown.guide.season] ?? SEASON.winter)[en ? 1 : 0]}: </span>
                    {shown.guide.text}
                </p>
            )}
            <p className="m-0 mt-2 text-white/60" style={{ fontSize: "12px", lineHeight: "18px" }}>
                {en ? "Calculated in local time. Weather and shadows from terrain are not included."
                    : "現地時刻の計算値。天気や山・建物の影は含みません。"}
            </p>
        </section>
    );
}
