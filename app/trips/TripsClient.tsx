"use client";

import React from "react";
import Link from "next/link";
import { MapIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { usePhotos } from "../../lib/hooks/usePhotos";
import { useSavedSpots } from "../../lib/hooks/useSavedSpots";
import { useTripPlans, type TripPlan, type TripItem } from "../../lib/hooks/useTripPlans";
import { ROUTES, loginWithNext } from "../../lib/routes";
import { collectEntries } from "../../lib/utils/collections";
import { parseSavedKey, dedupeSavedKeys } from "../../lib/utils/savedSpotKey";
import type { SpotRef } from "../../lib/data/spotLink";
import { formatStoredDateTime } from "../../lib/utils/photoDate";

/**
 * 旅行プラン——**行きたい場所を「いつ・どの順で回るか」に並べる**画面。
 *
 * ## 何を作らないか（計画書 第13章）
 *
 * 移動時間・費用・経路最適化・AI 生成・予約は**作らない**。
 * 計算していない数字を出さない、が理由。ここが出すのは
 * **本人が置いた順番**だけ。
 *
 * ## 材料は「行きたい場所」から採る
 *
 * 項目を増やす口は**保存済みの行きたい場所から選ぶ**形にした。
 * 自由入力にすると、綴りの違う地名が増えて `/location/*` と噛み合わなく
 * なる（タグで同じことが起きて、固定の選択肢に直した経緯がある）。
 *
 * ## 「まだ」「聞けなかった」「0件」を混ぜない
 *
 * 混ぜると、通信に失敗しただけの人に「まだプランはありません」と
 * 言い切ることになる（`/saved-spots` と同じ判断）。
 *
 * ## 🔴 台帳はここから読まない
 *
 * `content/spots.json` を `"use client"` のここから読むと**全文がこの
 * ページのチャンクに載る**（`lib/data/spotLink.ts` の実測）。
 * **受け取るのは `name` と `slug` だけ**（`SpotRef`）——解くのは `page.tsx`。
 * 解いた `SpotLink` をそのまま渡すのも駄目で、props は HTML に乗る。
 */
export default function TripsClient({ spots }: { spots: Record<string, SpotRef> }) {
    const { locale } = useLocale();
    const en = locale === "en";
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { plans, pending, failed, retry, busy, create, update, remove, error } = useTripPlans(isAuthenticated, authLoading);
    const [openId, setOpenId] = React.useState<string | null>(null);
    const [newTitle, setNewTitle] = React.useState("");

    if (!authLoading && !isAuthenticated) {
        return (
            <Shell en={en} count={null}>
                <Empty
                    text={en ? "Sign in to plan a trip." : "旅行プランを作るにはログインしてください。"}
                    action={
                        <Link
                            href={loginWithNext(ROUTES.TRIPS)}
                            prefetch={false}
                            className="text-link hover:text-white underline underline-offset-4"
                        >
                            {en ? "Sign in" : "ログイン"}
                        </Link>
                    }
                />
            </Shell>
        );
    }

    const onCreate = async () => {
        const title = newTitle.trim();
        if (!title) return;
        const made = await create(title);
        if (made) { setNewTitle(""); setOpenId(made.planId); }
    };

    return (
        // **数を出すのは、聞けたときだけ**（失敗した回に「0件」と言い切らない）
        <Shell en={en} count={pending || failed ? null : plans.length}>
            {failed && (
                <p role="alert" className="mb-4 text-sm text-danger">
                    {en ? "Couldn't load your trips. " : "旅行プランを読み込めませんでした。"}
                    <button onClick={retry} className="underline text-white/80 hover:text-white">
                        {en ? "Retry" : "再試行"}
                    </button>
                </p>
            )}
            {/* **サーバーの言い分をそのまま出す。** 上限（403）と混雑（503）を
                「保存に失敗しました」に潰すと、何をすれば直るか分からない */}
            {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}

            {/* 作る口は、取れていなくても出す——**新しく作るのに一覧は要らない** */}
            <div className="mb-4 flex gap-2">
                <label htmlFor="new-trip-title" className="sr-only">
                    {en ? "Trip title" : "旅行プランのタイトル"}
                </label>
                <input
                    id="new-trip-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    maxLength={100}
                    placeholder={en ? "e.g. Finland in winter" : "例: 冬のフィンランド"}
                    className="flex-1 min-w-0 rounded-full bg-white/5 ring-1 ring-white/15 px-4 text-sm text-white placeholder:text-white/40"
                    style={{ minHeight: 44 }}
                />
                <button
                    type="button"
                    onClick={() => void onCreate()}
                    disabled={busy !== null || !newTitle.trim()}
                    className="shrink-0 rounded-full bg-accent-fill text-ink px-4 text-sm font-semibold ring-1 ring-accent hover:brightness-110 disabled:opacity-60 transition inline-flex items-center gap-1"
                    style={{ touchAction: "manipulation", minHeight: 44 }}
                >
                    <PlusIcon className="w-4 h-4" aria-hidden />
                    {en ? "New" : "作る"}
                </button>
            </div>

            {pending ? (
                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex items-center justify-center" aria-busy>
                    <p className="text-white/60 text-sm">{en ? "Loading…" : "読み込み中…"}</p>
                </div>
            ) : failed ? (
                // 上の `role="alert"` が事情と再試行を出しているので、ここは黙る
                null
            ) : plans.length === 0 ? (
                <Empty
                    text={en ? "No trips yet." : "旅行プランはまだありません。"}
                    action={
                        <span className="text-white/60 text-xs">
                            {en
                                ? "Name a trip above, then add spots you saved."
                                : "上でタイトルを付けて作ると、行きたい場所を並べられます。"}
                        </span>
                    }
                />
            ) : (
                <ul className="flex flex-col gap-3">
                    {plans.map((plan) => (
                        <PlanCard
                            key={plan.planId}
                            en={en}
                            plan={plan}
                            spots={spots}
                            open={openId === plan.planId}
                            busy={busy !== null}
                            onToggle={() => setOpenId((id) => (id === plan.planId ? null : plan.planId))}
                            onUpdate={update}
                            onRemove={remove}
                        />
                    ))}
                </ul>
            )}
        </Shell>
    );
}

/** 何か所ぶん置いてあるか（日をまたいで数える） */
function countItems(plan: TripPlan): number {
    return plan.days.reduce((n, d) => n + d.items.length, 0);
}

function PlanCard({ en, plan, spots, open, busy, onToggle, onUpdate, onRemove }: {
    en: boolean;
    plan: TripPlan;
    spots: Record<string, SpotRef>;
    open: boolean;
    busy: boolean;
    onUpdate: ReturnType<typeof useTripPlans>["update"];
    onRemove: ReturnType<typeof useTripPlans>["remove"];
    onToggle: () => void;
}) {
    const [confirming, setConfirming] = React.useState(false);
    const count = countItems(plan);

    return (
        <li className="rounded-2xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
                <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={open}
                    className="flex-1 min-w-0 text-left"
                    style={{ touchAction: "manipulation", minHeight: 44 }}
                >
                    <span className="block truncate text-sm font-semibold">{plan.title}</span>
                    <span className="block text-xs text-white/60" style={{ marginTop: "2px" }}>
                        {[period(plan, en ? "en" : "ja"), en ? `${count} place${count !== 1 ? "s" : ""}` : `${count} か所`]
                            .filter(Boolean)
                            .join(" ・ ")}
                    </span>
                </button>
                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                    aria-label={en ? `Delete ${plan.title}` : `「${plan.title}」を削除`}
                    className="shrink-0 rounded-full px-3 text-xs bg-white/5 ring-1 ring-white/15 text-white/70 hover:bg-white/15 hover:text-white disabled:opacity-60 transition inline-flex items-center"
                    style={{ touchAction: "manipulation", minHeight: 44 }}
                >
                    <TrashIcon className="w-4 h-4" aria-hidden />
                </button>
            </div>

            {/* **消す前に一度聞く。** 日程ごと消えるうえ、戻す手が無い */}
            {confirming && (
                <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-white/80">
                        {en ? "Delete this trip?" : "この旅行プランを削除しますか？"}
                    </span>
                    <button
                        type="button"
                        onClick={() => { setConfirming(false); void onRemove(plan.planId); }}
                        disabled={busy}
                        className="rounded-full px-3 text-xs ring-1 ring-danger/50 text-danger hover:bg-danger/10 disabled:opacity-60 transition"
                        style={{ touchAction: "manipulation", minHeight: 44 }}
                    >
                        {en ? "Delete" : "削除する"}
                    </button>
                    <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        className="rounded-full px-3 text-xs bg-white/5 ring-1 ring-white/15 text-white/70 hover:bg-white/15 transition"
                        style={{ touchAction: "manipulation", minHeight: 44 }}
                    >
                        {en ? "Cancel" : "やめる"}
                    </button>
                </div>
            )}

            {open && <PlanEditor en={en} plan={plan} spots={spots} busy={busy} onUpdate={onUpdate} />}
        </li>
    );
}

/**
 * 「2026年12月24日 〜 2026年12月28日」。片方しか無ければその1つ。
 * **無ければ空文字**（作り話をしない）。
 *
 * 🔴 **サイトの他の画面と同じ形で出す。** 最初は保存されている
 * `2026-12-24` をそのまま出していたが、**画面に見える日付はサイト全体で
 * `2026年12月24日` に統一されている**（`YYYY-MM-DD` が出るのは JSON-LD と
 * meta＝機械向けの経路だけ）。ここだけ生の値を出すと、同じ「日付」が
 * 2つの見え方を持つ——台帳の切り口「同じ概念に複数の語を使っている」。
 *
 * 整形は `photoDate.ts` を使い回す。**`toLocaleString` を使わない**理由
 * （水和の不一致・閲覧者のゾーンで1日ずれる）があちらに書いてあり、
 * 旅の日付にもそのまま当てはまる——「12月24日に出発する」は
 * 閲覧者のゾーンに変換すべき値ではない。
 */
function period(plan: TripPlan, locale: "ja" | "en"): string {
    // 読めない値は**出さない**（`formatStoredDateTime` が null を返す）
    const s = formatStoredDateTime(plan.startDate, locale) ?? "";
    const e = formatStoredDateTime(plan.endDate, locale) ?? "";
    if (s && e) return `${s} 〜 ${e}`;
    return s || e;
}

/** 日程の編集。**保存は明示的**（打つたびにサーバーへ送らない） */
function PlanEditor({ en, plan, spots, busy, onUpdate }: {
    en: boolean;
    plan: TripPlan;
    spots: Record<string, SpotRef>;
    busy: boolean;
    onUpdate: ReturnType<typeof useTripPlans>["update"];
}) {
    const { photos } = usePhotos();
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { slugs } = useSavedSpots(isAuthenticated, authLoading);
    const [days, setDays] = React.useState(plan.days);
    const [start, setStart] = React.useState(plan.startDate ?? "");
    const [end, setEnd] = React.useState(plan.endDate ?? "");

    /**
     * **開き直したら、サーバーの姿に戻す。**
     *
     * 持ち越すと、別のタブで直したぶんを打ち消す形で保存できてしまう
     * （`/user/edit` が同じ理由で「変えた項目だけ送る」にしている）。
     */
    React.useEffect(() => {
        setDays(plan.days);
        setStart(plan.startDate ?? "");
        setEnd(plan.endDate ?? "");
    }, [plan]);

    /** 「行きたい場所」から選べる候補（公式スポットと撮影地の両方） */
    const choices = React.useMemo(() => {
        const bySlug = new Map(collectEntries(photos, "location").map((e) => [e.slug, e]));
        const out: { value: string; label: string }[] = [];
        for (const key of dedupeSavedKeys(slugs)) {
            const parsed = parseSavedKey(key);
            if (parsed.kind === "spot") {
                // **台帳は `slug` で引けない。** プランに入るのは `spotId` なので、
                // 候補もそちらで持つ（`page.tsx` が `spotId` で引ける形を渡す）
                const hit = Object.entries(spots).find(([, sp]) => sp.slug === parsed.slug);
                if (hit) out.push({ value: `spot:${hit[0]}`, label: hit[1].name });
                continue;
            }
            const entry = bySlug.get(parsed.slug);
            if (entry) out.push({ value: `location:${parsed.slug}`, label: entry.label });
        }
        return out;
    }, [slugs, spots, photos]);

    const dirty = JSON.stringify({ days, start, end })
        !== JSON.stringify({ days: plan.days, start: plan.startDate ?? "", end: plan.endDate ?? "" });

    const addItem = (dayIndex: number, value: string) => {
        const [kind, id] = splitChoice(value);
        if (!kind) return;
        setDays((prev) => prev.map((d, i) => (i !== dayIndex ? d : {
            ...d,
            items: [...d.items, kind === "spot" ? { kind, spotId: id } : { kind, slug: id }],
        })));
    };

    return (
        <div className="border-t border-white/10 px-4 py-3 flex flex-col gap-3">
            <div className="flex gap-2 flex-wrap">
                <DateField en={en} planId={plan.planId} which="start" value={start} onChange={setStart} />
                <DateField en={en} planId={plan.planId} which="end" value={end} onChange={setEnd} />
            </div>

            {days.length === 0 ? (
                <p className="text-xs text-white/60">
                    {en ? "No days yet. Add one below." : "まだ日程がありません。下から追加してください。"}
                </p>
            ) : (
                <ol className="flex flex-col gap-3">
                    {days.map((day, di) => (
                        <li key={di} className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                            <div className="flex items-center justify-between gap-2 mb-2">
                                <span className="text-xs font-semibold text-white/80">
                                    {en ? `Day ${di + 1}` : `${di + 1} 日目`}
                                    {/* 日付もサイトの形で（上の `period` と同じ理由） */}
                                    {formatStoredDateTime(day.date, en ? "en" : "ja")
                                        ? `・${formatStoredDateTime(day.date, en ? "en" : "ja")}`
                                        : ""}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setDays((prev) => prev.filter((_, i) => i !== di))}
                                    aria-label={en ? `Remove day ${di + 1}` : `${di + 1} 日目を削除`}
                                    className="rounded-full px-2 text-xs bg-white/5 ring-1 ring-white/15 text-white/70 hover:bg-white/15 transition inline-flex items-center"
                                    style={{ touchAction: "manipulation", minHeight: 44 }}
                                >
                                    <TrashIcon className="w-4 h-4" aria-hidden />
                                </button>
                            </div>
                            {day.items.length === 0 ? (
                                <p className="text-xs text-white/50 mb-2">
                                    {en ? "Nothing planned." : "まだ何も入っていません。"}
                                </p>
                            ) : (
                                <ul className="flex flex-col gap-1 mb-2">
                                    {day.items.map((item, ii) => (
                                        <li key={ii} className="flex items-center gap-2">
                                            <span className="flex-1 min-w-0 truncate text-sm">{itemLabel(item, spots)}</span>
                                            <button
                                                type="button"
                                                onClick={() => setDays((prev) => prev.map((d, i) => (i !== di ? d : { ...d, items: d.items.filter((_, k) => k !== ii) })))}
                                                aria-label={en ? `Remove ${itemLabel(item, spots)}` : `「${itemLabel(item, spots)}」を外す`}
                                                className="shrink-0 rounded-full px-2 text-xs bg-white/5 ring-1 ring-white/15 text-white/70 hover:bg-white/15 transition inline-flex items-center"
                                                style={{ touchAction: "manipulation", minHeight: 44 }}
                                            >
                                                <TrashIcon className="w-4 h-4" aria-hidden />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {/* **自由入力にしない。** 保存済みの行きたい場所から選ぶ
                                ——綴りの違う地名を増やすと `/location/*` と噛み合わなくなる */}
                            <label htmlFor={`add-${plan.planId}-${di}`} className="sr-only">
                                {en ? "Add a saved place" : "行きたい場所から追加"}
                            </label>
                            <select
                                id={`add-${plan.planId}-${di}`}
                                value=""
                                onChange={(e) => { addItem(di, e.target.value); e.currentTarget.value = ""; }}
                                disabled={choices.length === 0}
                                className="w-full rounded-full bg-white/5 ring-1 ring-white/15 px-3 text-sm text-white disabled:opacity-60"
                                style={{ minHeight: 44 }}
                            >
                                <option value="">
                                    {choices.length === 0
                                        ? (en ? "Save places first" : "先に「行きたい場所」に保存してください")
                                        : (en ? "Add a saved place…" : "行きたい場所から追加…")}
                                </option>
                                {choices.map((c) => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                        </li>
                    ))}
                </ol>
            )}

            <div className="flex gap-2 flex-wrap">
                <button
                    type="button"
                    onClick={() => setDays((prev) => [...prev, { items: [] }])}
                    className="rounded-full px-3 text-xs bg-white/5 ring-1 ring-white/15 text-white/80 hover:bg-white/15 transition inline-flex items-center gap-1"
                    style={{ touchAction: "manipulation", minHeight: 44 }}
                >
                    <PlusIcon className="w-4 h-4" aria-hidden />
                    {en ? "Add a day" : "日を追加"}
                </button>
                <button
                    type="button"
                    onClick={() => void onUpdate(plan.planId, { days, startDate: start, endDate: end })}
                    // **変えていなければ押させない**（無駄な往復と、他のタブの編集の打ち消しを避ける）
                    disabled={busy || !dirty}
                    className="rounded-full bg-accent-fill text-ink px-4 text-xs font-semibold ring-1 ring-accent hover:brightness-110 disabled:opacity-60 transition"
                    style={{ touchAction: "manipulation", minHeight: 44 }}
                >
                    {en ? "Save" : "保存"}
                </button>
            </div>
        </div>
    );
}

/** `spot:sp_xxx` / `location:パリ` を種別と ID に割る */
export function splitChoice(value: string): ["spot" | "location" | null, string] {
    const i = value.indexOf(":");
    if (i < 0) return [null, ""];
    const kind = value.slice(0, i);
    const id = value.slice(i + 1);
    if (!id) return [null, ""];
    return kind === "spot" || kind === "location" ? [kind, id] : [null, ""];
}

/**
 * 項目に出す名前。**引けないときは ID をそのまま出す**
 * ——「不明な場所」のような、こちらで作った言葉を置かない
 * （`/saved-spots` と同じ判断）。
 */
export function itemLabel(item: TripItem, spots: Record<string, SpotRef>): string {
    if (item.kind === "spot") return spots[item.spotId]?.name || item.spotId;
    try {
        return decodeURIComponent(item.slug);
    } catch {
        return item.slug;
    }
}

function DateField({ en, planId, which, value, onChange }: {
    en: boolean; planId: string; which: "start" | "end"; value: string; onChange: (v: string) => void;
}) {
    const id = `${which}-${planId}`;
    return (
        <span className="flex items-center gap-2">
            <label htmlFor={id} className="text-xs text-white/70">
                {which === "start" ? (en ? "From" : "出発") : (en ? "To" : "帰着")}
            </label>
            <input
                id={id}
                type="date"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="rounded-full bg-white/5 ring-1 ring-white/15 px-3 text-sm text-white"
                style={{ minHeight: 44 }}
            />
        </span>
    );
}

function Shell({ en, count, children }: { en: boolean; count?: number | null; children: React.ReactNode }) {
    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-bg max-w-5xl mx-auto w-full pb-28">
            <div className="mb-4 sm:mb-6">
                <h1 className="text-2xl sm:text-3xl font-bold">{en ? "Trip plans" : "旅行プラン"}</h1>
                <p className="text-sm text-white/60 mt-1">
                    {count === null || count === undefined
                        ? (en ? "Plan where to go, and when." : "行きたい場所を、いつ・どの順で回るかに並べる。")
                        : en
                            ? `${count} trip${count !== 1 ? "s" : ""}`
                            : `旅行プラン ${count} 件`}
                </p>
            </div>
            {children}
        </main>
    );
}

function Empty({ text, action }: { text: string; action: React.ReactNode }) {
    return (
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 py-16 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                <MapIcon className="w-8 h-8 text-white/60" />
            </div>
            <p className="text-white/70 text-sm">{text}</p>
            {action}
        </div>
    );
}
