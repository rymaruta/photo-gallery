import { describe, it, expect } from "vitest";

// Pro の状態の移り方（`supporter.ts`・純関数）と、Pro のメダル（`proBadges.ts`）。

import {
    applySupporterEvent, calendarMonthsBetween, computeMonths, readSupporter, seasonAt, seasonsCovered,
    supporterCounterKey, supporterMonths,
} from "../supporter";
import type { SupporterEvent, SupporterRecord, TransactionFacts } from "../supporter";
import { mergeProBadges, supporterYearTier } from "../proBadges";
import { badgeDisplayNameJa, isBadgeKey, isPro, parseProSeasonKey, publicSupporter, sanitizeBadges } from "../badgeKeys";

const BUNDLE = "com.journeyphoto.JourneyPhoto";
const MONTHLY = `${BUNDLE}.pro.monthly`;
const YEARLY = `${BUNDLE}.pro.yearly`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 日本時間の壁時計 → ms */
const jst = (y: number, mo: number, d: number, h = 12, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);
/** 日本時間で n か月後の同じ日時 */
const plusMonths = (t: number, n: number) => {
    const j = new Date(t + 9 * HOUR);
    return Date.UTC(j.getUTCFullYear(), j.getUTCMonth() + n, j.getUTCDate(), j.getUTCHours() - 9, j.getUTCMinutes());
};

function tx(over: Partial<TransactionFacts> = {}): TransactionFacts {
    const purchaseDate = over.purchaseDate ?? jst(2026, 10, 10);
    return {
        transactionId: "t1",
        originalTransactionId: "o1",
        productId: MONTHLY,
        purchaseDate,
        originalPurchaseDate: purchaseDate,
        expiresDate: plusMonths(purchaseDate, 1),
        environment: "Production",
        signedDate: purchaseDate + 1000,
        ...over,
    };
}

const ev = (kind: string, t: TransactionFacts, over: Partial<SupporterEvent> = {}): SupporterEvent =>
    ({ kind, tx: t, signedAt: t.signedDate, ...over });

/** 月ごとの取引を n 回続けて重ねる（1回目は PURCHASE、以降は DID_RENEW） */
function renewMonthly(start: number, n: number, now: number, base?: SupporterRecord): SupporterRecord {
    let s: unknown = base;
    let t0 = start;
    for (let i = 0; i < n; i++) {
        const t = tx({ transactionId: `t${i}`, purchaseDate: t0, originalPurchaseDate: start, expiresDate: plusMonths(t0, 1), signedDate: t0 + 1000 });
        s = applySupporterEvent(s, ev(i === 0 && !base ? "PURCHASE" : "DID_RENEW", t), Math.max(now, t0 + 2000)).supporter;
        t0 = plusMonths(t0, 1);
    }
    return s as SupporterRecord;
}

describe("購入で有効になる", () => {
    it("初めての購入: 有効・番号が要る・申し込んだ日・期限・商品", () => {
        const t = tx();
        const r = applySupporterEvent(undefined, ev("PURCHASE", t), t.purchaseDate + HOUR);
        expect(r.needsNumber).toBe(true);
        expect(r.supporter).toMatchObject({
            active: true, productId: MONTHLY, originalTransactionId: "o1", environment: "Production",
            since: new Date(t.purchaseDate).toISOString(), expiresAt: new Date(t.expiresDate).toISOString(), months: 0,
        });
        expect(r.supporter.periods).toHaveLength(1);
        expect(r.supporter.linked).toEqual(["o1"]);
    });

    it("同じ取引をもう一度送っても同じ答え（期間は増えない）", () => {
        const t = tx();
        const now = t.purchaseDate + HOUR;
        const a = applySupporterEvent(undefined, ev("PURCHASE", t), now).supporter;
        const b = applySupporterEvent({ ...a, number: 7 }, ev("PURCHASE", t), now);
        expect(b.supporter.periods).toEqual(a.periods);
        expect(b.needsNumber).toBe(false);
        expect(b.supporter.number).toBe(7);
    });

    it("期限の切れた取引だけ送られても有効にしない・番号も振らない", () => {
        const t = tx();
        const r = applySupporterEvent(undefined, ev("PURCHASE", t), t.expiresDate + DAY);
        expect(r.supporter.active).toBe(false);
        expect(r.needsNumber).toBe(false);
    });
});

describe("知らせの状態の移り方", () => {
    const t = tx();
    const now = t.purchaseDate + 2 * DAY;
    const active = { ...applySupporterEvent(undefined, ev("PURCHASE", t), now).supporter, number: 3 };

    it("EXPIRED: 終わる。番号・申し込んだ日は残る", () => {
        const r = applySupporterEvent(active, ev("EXPIRED", t, { signedAt: t.expiresDate + 1 }), t.expiresDate + 2);
        expect(r.supporter.active).toBe(false);
        expect(r.supporter.number).toBe(3);
        expect(r.supporter.since).toBe(active.since);
    });

    it("GRACE_PERIOD_EXPIRED も終わる", () => {
        const r = applySupporterEvent(active, ev("GRACE_PERIOD_EXPIRED", t, { signedAt: now + 1 }), now + 2);
        expect(r.supporter.active).toBe(false);
    });

    it("DID_FAIL_TO_RENEW: 猶予期間の間は Pro、猶予が無ければ終わり", () => {
        const after = t.expiresDate + HOUR;
        const grace = applySupporterEvent(active, ev("DID_FAIL_TO_RENEW", t, {
            subtype: "GRACE_PERIOD", signedAt: after, renewal: { gracePeriodExpiresDate: t.expiresDate + 6 * DAY },
        }), after);
        expect(grace.supporter.active).toBe(true);
        expect(grace.supporter.expiresAt).toBe(new Date(t.expiresDate + 6 * DAY).toISOString());
        const none = applySupporterEvent(active, ev("DID_FAIL_TO_RENEW", t, { signedAt: after }), after);
        expect(none.supporter.active).toBe(false);
    });

    it("猶予期間の中にアプリが同じ取引を送ってきても Pro を外さない（アプリの取引には猶予の終わりが無い）", () => {
        const after = t.expiresDate + HOUR;
        const graceEnd = t.expiresDate + 6 * DAY;
        const grace = applySupporterEvent(active, ev("DID_FAIL_TO_RENEW", t, {
            subtype: "GRACE_PERIOD", signedAt: after, renewal: { gracePeriodExpiresDate: graceEnd },
        }), after).supporter;
        // 端末が猶予の中で取り直した取引（署名は知らせより新しい・期限は過ぎている）
        const r = applySupporterEvent(grace, ev("PURCHASE", t, { signedAt: after + DAY }), after + DAY);
        expect(r.supporter.active).toBe(true);
        expect(r.supporter.expiresAt).toBe(new Date(graceEnd).toISOString());
        expect(isPro({ supporter: r.supporter }, after + DAY)).toBe(true);
        expect(r.ignored).toMatch(/猶予/);
        // 猶予が切れたら期限で外れる
        expect(isPro({ supporter: r.supporter }, graceEnd + 1)).toBe(false);
        // 取り消された取引は通す
        const revoked = applySupporterEvent(grace, ev("PURCHASE", { ...t, revocationDate: after + DAY }, { signedAt: after + DAY }), after + DAY + 1);
        expect(revoked.supporter.active).toBe(false);
    });

    it("DID_CHANGE_RENEWAL_STATUS（自動更新を切った）: 期限までは Pro のまま", () => {
        const r = applySupporterEvent(active, ev("DID_CHANGE_RENEWAL_STATUS", t, {
            subtype: "AUTO_RENEW_DISABLED", signedAt: now + 1, renewal: { autoRenewStatus: 0 },
        }), now + 2);
        expect(r.supporter.active).toBe(true);
        expect(r.supporter.autoRenew).toBe(false);
    });

    it("REFUND（今の期間）: 終わり、期間は返金の時刻で切る", () => {
        const refundAt = t.purchaseDate + 3 * DAY;
        const r = applySupporterEvent(active, ev("REFUND", { ...t, revocationDate: refundAt }, { signedAt: refundAt }), refundAt + 1);
        expect(r.supporter.active).toBe(false);
        expect(r.supporter.expiresAt).toBe(new Date(refundAt).toISOString());
        expect(r.supporter.periods[0].end).toBe(new Date(refundAt).toISOString());
        expect(r.supporter.number).toBe(3);
    });

    it("REFUND（過ぎた期間の返金）: 今の Pro は止めない", () => {
        const s2 = renewMonthly(jst(2026, 10, 10), 3, jst(2026, 12, 20));
        expect(s2.active).toBe(true);
        const old = tx({ transactionId: "t0", purchaseDate: jst(2026, 10, 10), expiresDate: jst(2026, 11, 10), revocationDate: jst(2026, 12, 20) });
        const r = applySupporterEvent(s2, ev("REFUND", old, { signedAt: jst(2026, 12, 20) }), jst(2026, 12, 20, 13));
        expect(r.supporter.active).toBe(true);
        expect(r.supporter.periods.find((p) => p.id === "t0")?.end).toBe(new Date(jst(2026, 11, 10)).toISOString());
    });

    it("REVOKE（ファミリー共有の取り消しなど）も終わる", () => {
        const r = applySupporterEvent(active, ev("REVOKE", { ...t, revocationDate: now }, { signedAt: now }), now + 1);
        expect(r.supporter.active).toBe(false);
    });

    it("古い知らせ（署名が前）は状態を巻き戻さない（期間だけ記録）", () => {
        const expired = applySupporterEvent(active, ev("EXPIRED", t, { signedAt: t.expiresDate + 10 }), t.expiresDate + 20).supporter;
        const late = applySupporterEvent(expired, ev("DID_RENEW", t, { signedAt: t.signedDate }), t.expiresDate + 30);
        expect(late.supporter.active).toBe(false);
        expect(late.ignored).toMatch(/古い知らせ/);
    });

    it("返金のあとに、それより前に署名された同じ取引の知らせが来ても、返金で切った期間を延ばさない", () => {
        // Apple の送り直し・届く順の入れ替わり: REFUND（新しい）→ DID_RENEW（古い・revocationDate なし）
        const refundAt = t.purchaseDate + 3 * DAY;
        const refunded = applySupporterEvent(active, ev("REFUND", { ...t, revocationDate: refundAt }, { signedAt: refundAt }), refundAt + 1).supporter;
        const late = applySupporterEvent(refunded, ev("DID_RENEW", t, { signedAt: t.signedDate }), t.expiresDate + 10 * DAY);
        expect(late.ignored).toMatch(/古い知らせ/);
        expect(late.supporter.active).toBe(false);
        expect(late.supporter.periods.find((p) => p.id === t.transactionId)?.end).toBe(new Date(refundAt).toISOString());
        // 端末に残っていた返金前の取引（PURCHASE）でも同じ
        const app = applySupporterEvent(refunded, ev("PURCHASE", t, { signedAt: t.signedDate }), t.expiresDate + 10 * DAY);
        expect(app.supporter.periods.find((p) => p.id === t.transactionId)?.end).toBe(new Date(refundAt).toISOString());
    });

    it("返金の取り消し（REFUND_REVERSED・新しい署名）は期間を元の期限に戻す", () => {
        const refundAt = t.purchaseDate + 3 * DAY;
        const refunded = applySupporterEvent(active, ev("REFUND", { ...t, revocationDate: refundAt }, { signedAt: refundAt }), refundAt + 1).supporter;
        const r = applySupporterEvent(refunded, ev("REFUND_REVERSED", t, { signedAt: refundAt + DAY }), refundAt + DAY + 1);
        expect(r.supporter.active).toBe(true);
        expect(r.supporter.periods.find((p) => p.id === t.transactionId)?.end).toBe(new Date(t.expiresDate).toISOString());
    });

    it("先月の取引を載せた新しい知らせ（返金を断った REFUND_DECLINED など）で、今月分の Pro を消さない", () => {
        const s = renewMonthly(jst(2026, 10, 10), 3, jst(2026, 12, 20));
        expect(s.active).toBe(true);
        const old = tx({ transactionId: "t1", purchaseDate: jst(2026, 11, 10), expiresDate: jst(2026, 12, 10), signedDate: jst(2026, 12, 20, 13) });
        for (const kind of ["REFUND_DECLINED", "CONSUMPTION_REQUEST", "EXPIRED", "DID_CHANGE_RENEWAL_STATUS"]) {
            const r = applySupporterEvent(s, ev(kind, old), jst(2026, 12, 20, 14));
            expect(r.supporter.active, kind).toBe(true);
            expect(r.supporter.expiresAt, kind).toBe(s.expiresAt);
            expect(r.ignored, kind).toMatch(/記録済みより前/);
        }
    });

    it("アプリから古い取引を送り直されても Pro は消えない", () => {
        const s = renewMonthly(jst(2026, 10, 10), 3, jst(2026, 12, 20));
        const old = tx({ transactionId: "t0", purchaseDate: jst(2026, 10, 10), expiresDate: jst(2026, 11, 10), signedDate: jst(2026, 12, 20, 13) });
        const r = applySupporterEvent(s, ev("PURCHASE", old), jst(2026, 12, 20, 14));
        expect(r.supporter.active).toBe(true);
        expect(r.ignored).toMatch(/記録済みより前/);
    });
});

describe("環境（本番の行に来る Sandbox）", () => {
    it("番号の列を分ける", () => {
        expect(supporterCounterKey("Production")).toBe("counter#supporter");
        expect(supporterCounterKey("Sandbox")).toBe("counter#supporter#sandbox");
    });

    it("本物の記録を持つ人に Sandbox の取引が来たら無視する", () => {
        const t = tx();
        const prod = { ...applySupporterEvent(undefined, ev("PURCHASE", t), t.purchaseDate + 1).supporter, number: 5 };
        const sb = tx({ transactionId: "s1", originalTransactionId: "so1", environment: "Sandbox", signedDate: t.signedDate + 10 });
        const r = applySupporterEvent(prod, ev("PURCHASE", sb), t.purchaseDate + 20);
        expect(r.ignored).toMatch(/Sandbox/);
        expect(r.supporter).toEqual(prod);
    });

    it("Sandbox だけの人が本物を買ったら、番号を振り直す（Sandbox の期間は捨てる）", () => {
        const sb = tx({ environment: "Sandbox", transactionId: "s1", originalTransactionId: "so1" });
        const s = { ...applySupporterEvent(undefined, ev("PURCHASE", sb), sb.purchaseDate + 1).supporter, number: 2 };
        const prod = tx({ transactionId: "p1", originalTransactionId: "po1", purchaseDate: sb.purchaseDate + DAY, signedDate: sb.purchaseDate + DAY + 1 });
        const r = applySupporterEvent(s, ev("PURCHASE", prod), prod.purchaseDate + 2);
        expect(r.needsNumber).toBe(true);
        expect(r.supporter.number).toBeUndefined();
        expect(r.supporter.environment).toBe("Production");
        expect(r.supporter.periods.map((p) => p.id)).toEqual(["p1"]);
    });
});

describe("続けた月数", () => {
    it("暦で数える（1月15日→2月15日で1・月末は短い月の末日にそろえる）", () => {
        expect(calendarMonthsBetween(jst(2026, 1, 15), jst(2026, 2, 15))).toBe(1);
        expect(calendarMonthsBetween(jst(2026, 1, 15), jst(2026, 2, 14))).toBe(0);
        expect(calendarMonthsBetween(jst(2026, 1, 31), jst(2026, 2, 28))).toBe(1);
        expect(calendarMonthsBetween(jst(2026, 10, 10), jst(2027, 10, 10))).toBe(12);
        // 期限が数秒前にずれていても落とさない
        expect(calendarMonthsBetween(jst(2026, 10, 10), jst(2027, 10, 10) - 5000)).toBe(12);
    });

    it("月ごとを12回続けると12か月（うるう年をまたいでも）", () => {
        for (const start of [jst(2026, 10, 10), jst(2027, 3, 1), jst(2027, 1, 31)]) {
            const end = plusMonths(start, 12);
            const s = renewMonthly(start, 12, end + HOUR);
            expect(computeMonths(s.periods, "Production", end + HOUR), new Date(start).toISOString()).toBe(12);
            expect(s.months).toBeGreaterThanOrEqual(11);
        }
    });

    it("途中でやめて再開すると続きから数える", () => {
        const a = renewMonthly(jst(2026, 10, 10), 5, jst(2027, 3, 11));   // 10/10〜3/10 の5か月
        const expired = applySupporterEvent(a, ev("EXPIRED", tx({ transactionId: "t4", purchaseDate: jst(2027, 2, 10), expiresDate: jst(2027, 3, 10) }),
            { signedAt: jst(2027, 3, 10, 13) }), jst(2027, 3, 11)).supporter;
        expect(expired.active).toBe(false);
        expect(expired.months).toBe(5);
        // 半年あけて再開、7か月続ける
        let s: SupporterRecord = expired;
        let t0 = jst(2027, 9, 1);
        for (let i = 0; i < 7; i++) {
            const t = tx({ transactionId: `r${i}`, purchaseDate: t0, expiresDate: plusMonths(t0, 1), signedDate: t0 + 1000 });
            s = applySupporterEvent(s, ev(i === 0 ? "SUBSCRIBED" : "DID_RENEW", t), t0 + 2000).supporter;
            t0 = plusMonths(t0, 1);
        }
        const now = t0 + HOUR;
        expect(computeMonths(s.periods, "Production", now)).toBe(12);
        expect(supporterYearTier(supporterMonths(s, now))).toBe(1);
    });

    it("年ごと: 買った日には0か月、1年たつと12か月（先の期間は数えない）", () => {
        const t = tx({ productId: YEARLY, expiresDate: plusMonths(jst(2026, 10, 10), 12) });
        const s = applySupporterEvent(undefined, ev("PURCHASE", t), t.purchaseDate + HOUR).supporter;
        expect(s.months).toBe(0);
        expect(computeMonths(s.periods, "Production", jst(2027, 4, 10, 13))).toBe(6);
        expect(computeMonths(s.periods, "Production", t.expiresDate + HOUR)).toBe(12);
    });

    it("Sandbox は終わった取引の数で数える（月ごと1・年ごと12）", () => {
        const base = Date.UTC(2026, 9, 10);
        const periods = [
            { id: "a", start: new Date(base).toISOString(), end: new Date(base + 5 * 60_000).toISOString(), product: MONTHLY },
            { id: "b", start: new Date(base + 5 * 60_000).toISOString(), end: new Date(base + 10 * 60_000).toISOString(), product: MONTHLY },
            { id: "c", start: new Date(base + 10 * 60_000).toISOString(), end: new Date(base + 70 * 60_000).toISOString(), product: YEARLY },
        ];
        expect(computeMonths(periods, "Sandbox", base + 11 * 60_000)).toBe(2);
        expect(computeMonths(periods, "Sandbox", base + 71 * 60_000)).toBe(14);
    });

    it("月数は下げない（保存した値と数え直した値の大きい方）", () => {
        expect(supporterMonths({ months: 20, periods: [] }, Date.now())).toBe(20);
    });
});

describe("季節（日本の暦の月）", () => {
    it("月で分ける。冬は12月の年（1・2月は前の年の冬）", () => {
        expect(seasonAt(jst(2026, 3, 1))).toEqual({ season: "Spring", year: 2026 });
        expect(seasonAt(jst(2026, 8, 31))).toEqual({ season: "Summer", year: 2026 });
        expect(seasonAt(jst(2026, 11, 30))).toEqual({ season: "Autumn", year: 2026 });
        expect(seasonAt(jst(2026, 12, 1))).toEqual({ season: "Winter", year: 2026 });
        expect(seasonAt(jst(2027, 2, 28))).toEqual({ season: "Winter", year: 2026 });
    });

    it("境目は日本時間の 0 時（UTC では前の日の 15 時）", () => {
        expect(seasonAt(Date.UTC(2026, 10, 30, 14, 59))).toEqual({ season: "Autumn", year: 2026 });
        expect(seasonAt(Date.UTC(2026, 10, 30, 15, 0))).toEqual({ season: "Winter", year: 2026 });
    });

    it("南半球かどうかは見ない（季節の章は日本の暦の印。場所の情報を持たない）", () => {
        // 同じ瞬間なら誰でも同じ季節（引数に場所が無い）
        expect(seasonAt.length).toBe(1);
        expect(seasonsCovered.length).toBe(2);
    });

    it("期間が少しでもかかった季節を全部・古い順。今より先は数えない", () => {
        const periods = [{ id: "y", start: new Date(jst(2026, 10, 10)).toISOString(), end: new Date(jst(2027, 10, 10)).toISOString(), product: YEARLY }];
        expect(seasonsCovered(periods, jst(2026, 11, 1))).toEqual([{ season: "Autumn", year: 2026 }]);
        expect(seasonsCovered(periods, jst(2027, 3, 1, 0, 30))).toEqual([
            { season: "Autumn", year: 2026 }, { season: "Winter", year: 2026 }, { season: "Spring", year: 2027 },
        ]);
        expect(seasonsCovered(periods, jst(2030, 1, 1)).map((s) => `${s.season}${s.year}`)).toEqual([
            "Autumn2026", "Winter2026", "Spring2027", "Summer2027", "Autumn2027",
        ]);
    });

    it("やめていた季節は取れない（後から取れない）", () => {
        const periods = [
            { id: "a", start: new Date(jst(2026, 10, 1)).toISOString(), end: new Date(jst(2026, 11, 1)).toISOString(), product: MONTHLY },
            { id: "b", start: new Date(jst(2027, 4, 1)).toISOString(), end: new Date(jst(2027, 5, 1)).toISOString(), product: MONTHLY },
        ];
        expect(seasonsCovered(periods, jst(2028, 1, 1)).map((s) => `${s.season}${s.year}`)).toEqual(["Autumn2026", "Spring2027"]);
    });
});

describe("Pro のメダル（mergeProBadges）", () => {
    const AT0 = "2026-01-01T00:00:00.000Z";

    it("番号を持つとサポーター章・今の季節の章（年つき）が付く", () => {
        const t = tx();
        const now = t.purchaseDate + HOUR;
        const s = { ...applySupporterEvent(undefined, ev("PURCHASE", t), now).supporter, number: 1 };
        const { badges, upgraded } = mergeProBadges({ first: { tier: 1, at: AT0 } }, s, now);
        const at = new Date(now).toISOString();
        expect(badges).toEqual({
            first: { tier: 1, at: AT0 },
            supporter: { tier: 1, at },
            proAutumn2026: { tier: 1, at, year: 2026 },
        });
        expect(upgraded).toEqual([{ key: "supporter", tier: 1 }, { key: "proAutumn2026", tier: 1 }]);
    });

    it("続けた年: 12 / 24 / 36 か月で 1 / 2 / 3。段は下げない・同じ段は書き直さない", () => {
        expect([0, 11, 12, 23, 24, 35, 36, 100].map(supporterYearTier)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
        const s = { months: 25, active: false, periods: [], linked: [], number: 9 };
        const r = mergeProBadges({ supporterYear: { tier: 3, at: AT0 }, supporter: { tier: 1, at: AT0 } }, s, Date.now());
        expect(r.badges.supporterYear).toEqual({ tier: 3, at: AT0 });
        expect(r.upgraded).toEqual([]);
        const r2 = mergeProBadges({ supporterYear: { tier: 1, at: AT0 } }, s, Date.parse("2028-01-01T00:00:00Z"));
        expect(r2.badges.supporterYear).toEqual({ tier: 2, at: "2028-01-01T00:00:00.000Z" });
    });

    it("やめても取ったメダルは残る（supporter が終わっても消さない）", () => {
        const kept = { proAutumn2026: { tier: 1, at: AT0 }, supporter: { tier: 1, at: AT0 } };
        const r = mergeProBadges(kept, { months: 1, active: false, periods: [], linked: [], number: 4 }, Date.now());
        expect(r.badges).toEqual({ proAutumn2026: { tier: 1, at: AT0, year: 2026 }, supporter: { tier: 1, at: AT0 } });
    });

    it("番号が無い（有効になったことが無い）人には何も付けない", () => {
        expect(mergeProBadges(undefined, { months: 0, active: false, periods: [], linked: [] }, Date.now()).upgraded).toEqual([]);
        expect(mergeProBadges(undefined, undefined, Date.now()).badges).toEqual({});
    });
});

describe("メダルの鍵と公開の形", () => {
    it("季節の章の鍵は年ごと。2026 より前・形の違うものは鍵ではない", () => {
        expect(parseProSeasonKey("proAutumn2026")).toEqual({ season: "Autumn", year: 2026 });
        expect(isBadgeKey("proWinter2031")).toBe(true);
        expect(isBadgeKey("proAutumn")).toBe(false);
        expect(isBadgeKey("proAutumn2025")).toBe(false);
        expect(isBadgeKey("profall2026")).toBe(false);
        expect(isBadgeKey("supporterYear")).toBe(true);
    });

    it("sanitizeBadges は季節の章を残し（年を鍵から入れ直す）、壊れた形を落とす。並びは時間の順", () => {
        const AT = "2026-10-10T00:00:00.000Z";
        const out = sanitizeBadges({
            proSpring2027: { tier: 1, at: AT, year: 1999 },
            proWinter2026: { tier: 1, at: AT },
            proAutumn2026: { tier: 2, at: AT },
            proSummer2026x: { tier: 1, at: AT },
            supporterYear: { tier: 4, at: AT },
            supporter: { tier: 1, at: AT },
        });
        expect(out).toEqual({
            supporter: { tier: 1, at: AT },
            proWinter2026: { tier: 1, at: AT, year: 2026 },
            proSpring2027: { tier: 1, at: AT, year: 2027 },
        });
        expect(Object.keys(out!)).toEqual(["supporter", "proWinter2026", "proSpring2027"]);
    });

    it("通知の名前", () => {
        expect(badgeDisplayNameJa("proAutumn2026", 1)).toBe("秋の章（2026）");
        expect(badgeDisplayNameJa("supporter", 1)).toBe("サポーター章");
        expect(badgeDisplayNameJa("supporterYear", 2)).toBe("続けた年（2年目）");
    });

    it("isPro は active かつ期限前だけ（EXPIRED が届かなくても期限で消える）", () => {
        const now = Date.parse("2026-11-01T00:00:00Z");
        expect(isPro({ supporter: { active: true, expiresAt: "2026-11-02T00:00:00Z" } }, now)).toBe(true);
        expect(isPro({ supporter: { active: true, expiresAt: "2026-10-31T00:00:00Z" } }, now)).toBe(false);
        expect(isPro({ supporter: { active: false, expiresAt: "2026-11-02T00:00:00Z" } }, now)).toBe(false);
        expect(isPro({ supporter: { active: true, expiresAt: "garbage" } }, now)).toBe(false);
    });

    it("公開するサポーターは番号・申し込んだ日・月数だけ（番号が無ければ出さない）", () => {
        const raw = {
            number: 12, since: "2026-10-10T03:00:00.000Z", months: 3, active: true, productId: MONTHLY,
            originalTransactionId: "o1", expiresAt: "2027-01-10T03:00:00.000Z", environment: "Production",
            periods: [], linked: ["o1"], lastEventAt: "2026-12-10T03:00:00.000Z",
        };
        expect(publicSupporter({ supporter: raw })).toEqual({ number: 12, since: "2026-10-10T03:00:00.000Z", months: 3 });
        expect(publicSupporter({ supporter: { ...raw, number: undefined } })).toBeUndefined();
        expect(publicSupporter({ supporter: "x" })).toBeUndefined();
    });

    it("壊れた supporter の行は読める分だけ読む", () => {
        expect(readSupporter({ number: "1", months: -3, active: "yes", periods: [{ id: 1 }], linked: [1, "o"] }))
            .toEqual({ months: 0, active: false, periods: [], linked: ["o"] });
        expect(readSupporter(null)).toBeUndefined();
    });
});
