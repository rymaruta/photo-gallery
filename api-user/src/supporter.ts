/**
 * Pro（自動更新のサブスクリプション「Journey Photo Pro」）の**状態の持ち方と移り方**。純関数だけ。
 * 読み書きは `supporterStore.ts`、Apple の署名の確かめは `appStore.ts`。
 *
 * ## プロフィールの行に置く形（`supporter`）
 *
 *     {
 *       number?: number              サポーター番号（初めて有効になった順・二度と出さない）
 *       since?: string(ISO)          初めて申し込んだ日（Apple の originalPurchaseDate）
 *       months: number               続けた月数（下の数え方。**下げない**）
 *       active: boolean              今 Pro か（期限は expiresAt で別に見る＝`isPro`）
 *       productId?: string           今の商品（<bundleId>.pro.monthly / .pro.yearly）
 *       originalTransactionId?: string
 *       expiresAt?: string(ISO)      今の期限（猶予期間があればその終わり）
 *       environment?: "Production" | "Sandbox"
 *       autoRenew?: boolean
 *       lastEventAt?: string(ISO)    状態を決めた知らせの署名時刻（古い知らせで巻き戻さない）
 *       periods: { id, start, end, product }[]   有効だった期間（取引ごと）
 *       linked: string[]             この人に結び付けた originalTransactionId（退会で掃除する）
 *     }
 *
 * **公開するのは `number`・`since`・`months` だけ**（`badgeKeys.ts` の `publicSupporter`）。
 * 取引の番号・商品・期限・期間は本人の応答にも出さない。
 *
 * ## 決めたこと
 *
 * - 番号は**有効になった最初の時**に振る（無料体験の開始も「申し込み」に数える。
 *   サポーター証の板の「番号は申し込んだ順」）。やめても番号は残り、再開しても同じ番号
 * - **本番の行に Sandbox（TestFlight・審査）の取引が来たら**: 別の番号の列
 *   （`counter#supporter#sandbox`）から振る。本物の No.1 を審査の人に取らせないため。
 *   本物（Production）の記録を持つ人に Sandbox が来ても**無視**する。
 *   Sandbox の記録しか無い人に Production が来たら、Sandbox の番号・期間・月数を捨てて
 *   本物の番号を振り直す（取ったメダルは残る）
 * - **月数**: 有効だった期間を日本時間の暦で数える（1月15日→2月15日で1か月）。続いた期間は
 *   つないでから数え、途切れた期間は別々に数えて足す（再開すると続きから数える）。
 *   Sandbox は1か月が数分に縮むので、**終わった取引の数**で数える（月ごと 1・年ごと 12）
 * - 同じ取引は何度来ても同じ答え（期間は取引の番号で置き換える）
 */

export type AppStoreEnvironment = "Production" | "Sandbox";

export type SupporterPeriod = { id: string; start: string; end: string; product: string };

export type SupporterRecord = {
    number?: number;
    since?: string;
    months: number;
    active: boolean;
    productId?: string;
    originalTransactionId?: string;
    expiresAt?: string;
    environment?: AppStoreEnvironment;
    autoRenew?: boolean;
    lastEventAt?: string;
    periods: SupporterPeriod[];
    linked: string[];
};

/** Apple の取引（`JWSTransactionDecodedPayload`）から使う分だけ。日時は ms */
export type TransactionFacts = {
    transactionId: string;
    originalTransactionId: string;
    productId: string;
    purchaseDate: number;
    originalPurchaseDate?: number;
    expiresDate: number;
    revocationDate?: number;
    environment: AppStoreEnvironment;
    signedDate: number;
};

/** 更新の情報（`JWSRenewalInfoDecodedPayload`）から使う分だけ */
export type RenewalFacts = { autoRenewStatus?: number; gracePeriodExpiresDate?: number };

export type SupporterEvent = {
    /** `"PURCHASE"`（アプリから送られた取引）か、App Store Server Notifications の notificationType */
    kind: string;
    subtype?: string;
    tx: TransactionFacts;
    renewal?: RenewalFacts;
    /** 状態の新しさを比べる時刻（知らせ・取引の署名時刻） */
    signedAt: number;
};

export type ApplyResult = {
    supporter: SupporterRecord;
    /** 番号が要る（有効になったのに番号が無い） */
    needsNumber: boolean;
    /** 何も変えなかった理由（記録用） */
    ignored?: string;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const JST_MS = 9 * HOUR_MS;
/** 期間を何件まで持つか（月ごとで20年分）。超えたら古い順に落とす（月数は下げないので失わない） */
export const MAX_PERIODS = 240;
/** 結び付けた originalTransactionId を何件まで持つか */
export const MAX_LINKED = 10;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | undefined) => (typeof s === "string" ? Date.parse(s) : NaN);

function isEnv(v: unknown): v is AppStoreEnvironment {
    return v === "Production" || v === "Sandbox";
}

/** 行に入っている `supporter` を、扱える形に整える（壊れた値は落とす） */
export function readSupporter(raw: unknown): SupporterRecord | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const periods = Array.isArray(r.periods)
        ? r.periods.filter((p): p is SupporterPeriod => !!p && typeof p === "object"
            && typeof (p as SupporterPeriod).id === "string"
            && Number.isFinite(ms((p as SupporterPeriod).start)) && Number.isFinite(ms((p as SupporterPeriod).end)))
            .map((p) => ({ id: p.id, start: p.start, end: p.end, product: typeof p.product === "string" ? p.product : "" }))
        : [];
    const out: SupporterRecord = {
        months: typeof r.months === "number" && Number.isFinite(r.months) && r.months > 0 ? Math.floor(r.months) : 0,
        active: r.active === true,
        periods,
        linked: Array.isArray(r.linked) ? r.linked.filter((x): x is string => typeof x === "string" && x !== "") : [],
    };
    if (typeof r.number === "number" && Number.isInteger(r.number) && r.number > 0) out.number = r.number;
    for (const k of ["since", "productId", "originalTransactionId", "expiresAt", "lastEventAt"] as const) {
        const v = str(r[k]);
        if (v) out[k] = v;
    }
    if (isEnv(r.environment)) out.environment = r.environment;
    if (typeof r.autoRenew === "boolean") out.autoRenew = r.autoRenew;
    return out;
}

// ─── 日本時間の暦 ───────────────────────────────────────────

function jstParts(t: number): { y: number; mo: number; d: number; msOfDay: number } {
    const j = new Date(t + JST_MS);
    return {
        y: j.getUTCFullYear(),
        mo: j.getUTCMonth() + 1,
        d: j.getUTCDate(),
        msOfDay: ((t + JST_MS) % DAY_MS + DAY_MS) % DAY_MS,
    };
}

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** 日本時間のその日の 0 時（ms） */
const jstMidnight = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d) - JST_MS;

/**
 * a から b までの**満の月数**（日本時間の暦）。1月15日10:00 → 2月15日10:00 で 1。
 * 月末の始まりは短い月の末日にそろえる（1月31日 → 2月28日 で 1）。
 * 期限の時刻が数秒ずれても落とさないよう、1時間の幅を持たせる
 */
export function calendarMonthsBetween(a: number, b: number): number {
    if (!(b > a)) return 0;
    const A = jstParts(a);
    const B = jstParts(b + HOUR_MS);
    let m = (B.y - A.y) * 12 + (B.mo - A.mo);
    const anchor = Math.min(A.d, daysInMonth(B.y, B.mo));
    if (B.d < anchor || (B.d === anchor && B.msOfDay < A.msOfDay)) m--;
    return Math.max(0, m);
}

/** 期間を [始まり, min(終わり, 今)] にして、つながっている（1日以内の隙間）ものをつなぐ */
function activeIntervals(periods: readonly SupporterPeriod[], now: number): [number, number][] {
    const list = periods
        .map((p) => [ms(p.start), Math.min(ms(p.end), now)] as [number, number])
        .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
        .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of list) {
        const last = merged[merged.length - 1];
        if (last && s <= last[1] + DAY_MS) last[1] = Math.max(last[1], e);
        else merged.push([s, e]);
    }
    return merged;
}

/** 年ごとの商品か（`<bundleId>.pro.yearly`） */
export const isYearlyProduct = (productId: string) => productId.endsWith(".pro.yearly");

/**
 * 続けた月数（記録した期間から数える）。
 *
 * - Production: 有効だった期間を日本時間の暦で数える（`calendarMonthsBetween`）
 * - Sandbox: **終わった取引の数**（月ごと 1・年ごと 12）。Sandbox は1か月が数分なので
 */
export function computeMonths(periods: readonly SupporterPeriod[], environment: AppStoreEnvironment | undefined, now: number): number {
    if (environment === "Sandbox") {
        let n = 0;
        for (const p of periods) {
            const end = ms(p.end);
            if (Number.isFinite(end) && end <= now && end > ms(p.start)) n += isYearlyProduct(p.product) ? 12 : 1;
        }
        return n;
    }
    return activeIntervals(periods, now).reduce((sum, [s, e]) => sum + calendarMonthsBetween(s, e), 0);
}

/** 公開する月数。保存した値と、今数え直した値の大きい方（`badgeKeys.ts` の `publicSupporter`） */
export function supporterMonths(raw: unknown, now: number = Date.now()): number {
    const s = readSupporter(raw);
    if (!s) return 0;
    return Math.max(s.months, computeMonths(s.periods, s.environment, now));
}

// ─── 季節（日本の暦の月で分ける） ───────────────────────────

export type SeasonName = "Spring" | "Summer" | "Autumn" | "Winter";

/**
 * その瞬間の季節と、その季節の年（日本時間）。
 * 3〜5月 春・6〜8月 夏・9〜11月 秋・12〜2月 冬。**冬の年は12月の年**（2027年1月は 2026年の冬）。
 * 南半球でも同じ（Pro の季節の章は「日本の暦のその季節を Pro で過ごした」の印）
 */
export function seasonAt(t: number): { season: SeasonName; year: number } {
    const { y, mo } = jstParts(t);
    if (mo >= 3 && mo <= 5) return { season: "Spring", year: y };
    if (mo >= 6 && mo <= 8) return { season: "Summer", year: y };
    if (mo >= 9 && mo <= 11) return { season: "Autumn", year: y };
    return { season: "Winter", year: mo === 12 ? y : y - 1 };
}

/** その季節の次の季節が始まる瞬間（日本時間の 0 時） */
function nextSeasonStart(season: SeasonName, year: number): number {
    switch (season) {
        case "Spring": return jstMidnight(year, 6, 1);
        case "Summer": return jstMidnight(year, 9, 1);
        case "Autumn": return jstMidnight(year, 12, 1);
        default: return jstMidnight(year + 1, 3, 1);
    }
}

/**
 * Pro が有効だった時間が**少しでも**かかった季節（古い順・重複なし）。
 * 今より先は数えない（年ごとの人が10月に買っても、冬の章は12月になってから）
 */
export function seasonsCovered(periods: readonly SupporterPeriod[], now: number): { season: SeasonName; year: number }[] {
    const seen = new Set<string>();
    const out: { season: SeasonName; year: number }[] = [];
    for (const [s, e] of activeIntervals(periods, now)) {
        let cur = s;
        for (let guard = 0; guard < 400 && cur < e; guard++) {
            const se = seasonAt(cur);
            const key = `${se.season}${se.year}`;
            if (!seen.has(key)) { seen.add(key); out.push(se); }
            cur = nextSeasonStart(se.season, se.year);
        }
    }
    const order: SeasonName[] = ["Spring", "Summer", "Autumn", "Winter"];
    return out.sort((a, b) => a.year - b.year || order.indexOf(a.season) - order.indexOf(b.season));
}

// ─── 移り方 ─────────────────────────────────────────────────

/** 期限で終わる知らせ（もう Pro ではない） */
const ENDING_KINDS = new Set(["EXPIRED", "GRACE_PERIOD_EXPIRED"]);
/** 返金・取り消し（その取引が今の期間なら終わり。過去の期間なら状態は触らない） */
const REVOKING_KINDS = new Set(["REFUND", "REVOKE"]);

/**
 * 取引の期間を置き換える。
 *
 * @param noExtend **古い知らせ（`lastEventAt` より前の署名）のとき true。** 同じ取引の期間を
 *   **縮めることはあっても延ばさない**。返金（REFUND）で切ったあとに、それより前に署名された
 *   同じ取引の知らせ（Apple の送り直し・届く順の入れ替わり・端末に残っていた古い取引）が来ると、
 *   返金の印（revocationDate）を持たないので期間が元の期限まで戻り、**返金した期間が続けた月数と
 *   季節の章に数えられていた**。取引の期限そのものは後から変わらず、後から縮めるのは取り消しだけ
 *   なので、古い方は短い側に合わせれば足りる（返金の取り消し REFUND_REVERSED は新しい署名で来る）
 */
function upsertPeriod(periods: SupporterPeriod[], tx: TransactionFacts, noExtend = false): SupporterPeriod[] {
    const rest = periods.filter((p) => p.id !== tx.transactionId);
    let end = tx.revocationDate !== undefined ? Math.min(tx.expiresDate, tx.revocationDate) : tx.expiresDate;
    const known = noExtend ? periods.find((p) => p.id === tx.transactionId) : undefined;
    if (known && Number.isFinite(ms(known.end))) end = Math.min(end, ms(known.end));
    if (!(end > tx.purchaseDate)) return rest;   // 始まる前に取り消された＝期間なし
    const next = [...rest, { id: tx.transactionId, start: iso(tx.purchaseDate), end: iso(end), product: tx.productId }];
    next.sort((a, b) => ms(a.start) - ms(b.start));
    return next.length > MAX_PERIODS ? next.slice(next.length - MAX_PERIODS) : next;
}

/**
 * 1つの出来事（アプリから送られた取引・App Store の知らせ）を重ねる。
 *
 * - 期間はいつでも記録する（取引の番号で置き換えるので何度来ても同じ）
 * - **状態**（active・期限・商品）は、それより新しい知らせで決めたあとなら触らない
 *   （`lastEventAt` より古い `signedAt`）。記録済みより**期限が前の取引**の出来事も状態を
 *   触らない（アプリの送り直し・先月の取引を載せた REFUND_DECLINED などで Pro が消えないように）
 */
export function applySupporterEvent(prevRaw: unknown, ev: SupporterEvent, now: number): ApplyResult {
    let prev = readSupporter(prevRaw);
    const { tx } = ev;

    if (prev?.environment === "Production" && tx.environment === "Sandbox") {
        return { supporter: prev, needsNumber: false, ignored: "本物の記録を持つ人に Sandbox の取引が来た" };
    }
    if (prev?.environment === "Sandbox" && tx.environment === "Production") {
        // Sandbox の番号・期間・月数は捨てる（本物の番号を振り直す）。状態の順番も新しく始める
        prev = { months: 0, active: false, periods: [], linked: prev.linked };
    }

    const s: SupporterRecord = prev
        ? { ...prev, periods: [...prev.periods], linked: [...prev.linked] }
        : { months: 0, active: false, periods: [], linked: [] };
    const latestEndBefore = s.periods.reduce((m, p) => Math.max(m, ms(p.end)), -Infinity);
    const lastAt = ms(s.lastEventAt);
    const stale = Number.isFinite(lastAt) && ev.signedAt < lastAt;
    s.environment = tx.environment;
    s.periods = upsertPeriod(s.periods, tx, stale);
    if (!s.linked.includes(tx.originalTransactionId)) {
        s.linked = [...s.linked, tx.originalTransactionId].slice(-MAX_LINKED);
    }

    // 記録済みより**期限が前の取引**の出来事は、状態（active・期限・商品）を触らない。
    // アプリが古い取引を送り直したとき（PURCHASE）だけでなく、**知らせでも起きる**:
    // 先月分の返金を頼んで断られると、REFUND_DECLINED（・CONSUMPTION_REQUEST）が**先月の取引**を
    // 載せて新しい署名で届く。これを重ねると「期限 < 今」で、今月分を払っている人の Pro が消えていた。
    // 期限で終わる知らせ（EXPIRED など）も、新しい取引を記録したあとなら過去の話なので同じ扱い
    const olderPurchase = tx.expiresDate < latestEndBefore;
    const pastRevocation = REVOKING_KINDS.has(ev.kind) && !(tx.expiresDate > now);
    // 猶予期間（DID_FAIL_TO_RENEW/GRACE_PERIOD で `expiresAt` を猶予の終わりまで延ばした）の中に、
    // アプリが**同じ取引**を送ってきた。アプリの取引には更新の情報（猶予の終わり）が無いので、
    // 重ねると「期限 < 今」で Pro が消える（猶予期間は Apple が使ってよいと言っている期間）。
    // 取引の中身は同じなので状態は触らない。猶予が切れたら `isPro` が `expiresAt` で外し、
    // GRACE_PERIOD_EXPIRED・DID_RENEW（請求が通った）は知らせで来る。取り消し（revocationDate）は通す
    const inGrace = ev.kind === "PURCHASE" && prev?.active === true
        && prev.originalTransactionId === tx.originalTransactionId && tx.revocationDate === undefined
        && tx.expiresDate <= now && ms(prev.expiresAt) > Math.max(tx.expiresDate, now);

    if (!stale && !olderPurchase && !pastRevocation && !inGrace) {
        const grace = ev.renewal?.gracePeriodExpiresDate ?? 0;
        let active: boolean;
        let expires = Math.max(tx.expiresDate, grace);
        if (ENDING_KINDS.has(ev.kind)) {
            active = false;
        } else if (REVOKING_KINDS.has(ev.kind)) {
            active = false;
            if (tx.revocationDate !== undefined) expires = Math.min(expires, tx.revocationDate);
        } else if (ev.kind === "DID_FAIL_TO_RENEW") {
            // 猶予期間があればその終わりまで Pro。無ければ終わり（請求の再試行中）
            active = grace > now;
            expires = grace > 0 ? grace : tx.expiresDate;
        } else {
            active = tx.revocationDate === undefined && expires > now;
        }
        s.active = active;
        s.expiresAt = iso(expires);
        s.productId = tx.productId;
        s.originalTransactionId = tx.originalTransactionId;
        if (ev.renewal?.autoRenewStatus === 0 || ev.renewal?.autoRenewStatus === 1) s.autoRenew = ev.renewal.autoRenewStatus === 1;
        if (ev.kind === "DID_CHANGE_RENEWAL_STATUS") {
            if (ev.subtype === "AUTO_RENEW_DISABLED") s.autoRenew = false;
            if (ev.subtype === "AUTO_RENEW_ENABLED") s.autoRenew = true;
        }
        s.lastEventAt = iso(ev.signedAt);
    }

    const needsNumber = s.active && s.number === undefined;
    if (s.active && !s.since) s.since = iso(tx.originalPurchaseDate ?? tx.purchaseDate);
    s.months = Math.max(s.months, computeMonths(s.periods, s.environment, now));
    return {
        supporter: s,
        needsNumber,
        ...(stale ? { ignored: "古い知らせ（期間だけ記録）" } : olderPurchase ? { ignored: "記録済みより前の取引（期間だけ記録）" }
            : inGrace ? { ignored: "猶予期間の中に届いた同じ取引（状態は猶予のまま）" } : {}),
    };
}

/** 番号の列（Production と Sandbox で分ける） */
export function supporterCounterKey(environment: AppStoreEnvironment): string {
    return environment === "Production" ? "counter#supporter" : "counter#supporter#sandbox";
}
