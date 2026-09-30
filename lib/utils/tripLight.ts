// lib/utils/tripLight.ts
//
// **旅行プランの当日モード**（`/trips`）: 前日から最終日まで、今日か明日に予定した撮影スポットの
// 光の時刻と季節の案内を出す（owner・2026-09-30「旅行プランで当日と前後の日になったらでいい」）。
// アプリの `TripLight.swift` と同じ決まり。
//
// ## 決まりごと
//
//   - 今日の日に撮影スポットがあれば今日、無ければ明日。前日は「明日（1日目）」。それ以外の日は出さない
//   - 日付は `planDayDate`（その日の日付 → 無ければ出発日から数える・帰着日を越えない）。推測はしない。
//     アプリの `TripPlanText.dayDate` と同じ
//   - スポットは台帳の撮影スポット（`kind: "spot"`）だけ。座標と時刻帯は本文（`/app/data/spots/<slug>.json`）から
//   - 時刻は**旅先の時計**、言い分けは撮影の光の表と同じ（`dayLightCells`）。天気は含まない

import type { TripPlan, TripDay } from "../hooks/useTripPlans";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 実在する日付か（2月30日を繰り上げない） */
function realDay(ymd: string | undefined | null): number | null {
    const m = ymd ? YMD.exec(ymd) : null;
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(ms);
    return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : null;
}

const toYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** その日の日付（"YYYY-MM-DD"）。決められなければ null（アプリの `TripPlanText.dayDate` と同じ） */
export function planDayDate(index: number, day: TripDay, start?: string, end?: string): string | null {
    if (day.date && realDay(day.date) !== null) return day.date;
    const first = realDay(start);
    if (first === null) return null;
    const shifted = first + index * 86_400_000;
    const last = realDay(end);
    if (last !== null && shifted > last) return null;
    return toYmd(shifted);
}

export type TripLightCandidate = {
    ymd: string;
    isTomorrow: boolean;
    /** 1から（出発日が1日目） */
    dayNumber: number;
    /** その日の撮影スポット（予定の順） */
    spotIds: string[];
};

/**
 * 今日と明日の候補（今日が先）。撮影スポットの無い日は入れない。
 * 呼ぶ側が先頭から順に本文を読み、光の時刻が出せた最初の1件を出す
 */
export function tripLightCandidates(plan: TripPlan, todayYmd: string): TripLightCandidate[] {
    const today = realDay(todayYmd);
    if (today === null) return [];
    const tomorrow = toYmd(today + 86_400_000);
    const out: TripLightCandidate[] = [];
    for (const [wanted, isTomorrow] of [[todayYmd, false], [tomorrow, true]] as const) {
        plan.days.forEach((day, index) => {
            if (planDayDate(index, day, plan.startDate, plan.endDate) !== wanted) return;
            const spotIds = day.items.flatMap((it) => (it.kind === "spot" ? [it.spotId] : []));
            if (spotIds.length > 0) out.push({ ymd: wanted, isTomorrow, dayNumber: index + 1, spotIds });
        });
    }
    return out;
}
