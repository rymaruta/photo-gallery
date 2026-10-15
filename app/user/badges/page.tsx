"use client";

/**
 * **自分のメダルの棚**と**名前の横の設定**（デザインの板 `Shelf.dc.html`・`BadgePicker.dc.html`。
 * iOS で先に入れたものを Web に足す・2026-10-11 owner の決定）。
 *
 * - 上: 「名前の横に飾る」——今のメダル。押すと名前の横の設定（`NameSideSheet`）
 * - 下: 「獲得したメダル」——持っているもの（「あと◯で次」）→ まだのもの（灰色）
 *
 * 読むのは2本。`GET /user/profile`（名前の横の初期値。**生の値**から読む——`readNameSide` の注記）と
 * `GET /user/badges`（棚。開くたびにサーバーが数え直す）。**片方が落ちても、もう片方は出す**。
 *
 * 入口: 自分のページの「メダル →」、設定の「メダルと名前の横」、
 * 自分の名前の横のメダルから開く一覧の下。
 *
 * 門は `/user/settings` と同じ（ログインだけ見る。グループ＝投稿権限は見ない）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { useLoginRedirect } from "../../../lib/hooks/useLoginRedirect";
import { userFetch } from "../../../lib/utils/api";
import { badgeImage, badgeLabel, sanitizeBadgeMap, type BadgeMap } from "../../../lib/data/badges";
import {
    ownShelf, readBadgeProgress, readNameSide,
    type BadgeProgressMap, type NameSideProfile,
} from "../../../lib/data/badgeShelf";
import MedalShelf from "../../components/MedalShelf";
import NameSideSheet from "./NameSideSheet";

type Load<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; value: T };

const EYEBROW = "eyebrow eyebrow-line text-accent";

export default function BadgesPage() {
    const { isAuthenticated, loading } = useAuth();
    const { locale: rawLocale } = useLocale();
    const locale = rawLocale === "en" ? "en" : "ja";
    const en = locale === "en";
    const router = useRouter();
    const { showToast } = useToast();
    useLoginRedirect(!loading && !isAuthenticated);

    const [profile, setProfile] = useState<Load<NameSideProfile>>({ state: "loading" });
    const [shelf, setShelf] = useState<Load<{ badges?: BadgeMap; progress: BadgeProgressMap }>>({ state: "loading" });
    const [sheetOpen, setSheetOpen] = useState(false);
    const openerRef = useRef<HTMLButtonElement | null>(null);

    // 「読み込み中」に戻すのは押し直したときだけ（初回は初期値が読み込み中）。
    // 効果の中で同期に setState しない（react-hooks/set-state-in-effect）
    const loadProfile = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await userFetch("/user/profile", signal ? { signal } : undefined);
            const v = res.ok ? readNameSide(await res.json()) : null;
            if (signal?.aborted) return;
            setProfile(v ? { state: "ready", value: v } : { state: "failed" });
        } catch {
            if (!signal?.aborted) setProfile({ state: "failed" });
        }
    }, []);
    const loadShelf = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await userFetch("/user/badges", signal ? { signal } : undefined);
            const raw = res.ok ? await res.json() as { badges?: unknown; progress?: unknown } | null : null;
            if (signal?.aborted) return;
            if (!raw || typeof raw !== "object") { setShelf({ state: "failed" }); return; }
            setShelf({ state: "ready", value: { badges: sanitizeBadgeMap(raw.badges), progress: readBadgeProgress(raw.progress) } });
        } catch {
            if (!signal?.aborted) setShelf({ state: "failed" });
        }
    }, []);

    useEffect(() => {
        if (loading || !isAuthenticated) return;
        const ac = new AbortController();
        void (async () => { await Promise.all([loadProfile(ac.signal), loadShelf(ac.signal)]); })();
        return () => ac.abort();
    }, [loading, isAuthenticated, loadProfile, loadShelf]);

    if (loading || !isAuthenticated) {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center">
                <h1 className="sr-only">メダル</h1>
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    // 名前の横で選べるのは、棚の答え（開いたときに数え直した分）があればそちら。
    // プロフィールの行は数え直しの保存より先に読まれることがある
    const pickerProfile: NameSideProfile | null = profile.state === "ready"
        ? (shelf.state === "ready" && shelf.value.badges
            ? { ...profile.value, badges: shelf.value.badges }
            : profile.value)
        : null;
    const current = pickerProfile?.displayBadge ? pickerProfile.badges?.[pickerProfile.displayBadge] : undefined;
    const currentSrc = pickerProfile?.displayBadge && current ? badgeImage(pickerProfile.displayBadge, current.tier, true) : null;

    const items = shelf.state === "ready" ? ownShelf(shelf.value.badges, shelf.value.progress, locale) : [];
    const ownedCount = items.filter((i) => i.owned).length;
    // 分母は「棚に並べた数」＝持っているもの＋まだの数えるメダル（`ownShelf`）。
    // 数えるメダルは8種で固定だが、初期ユーザー・Pro のメダルは持っている人にだけ並ぶので、
    // 分母もその分だけ増える（持っていないものを分母に入れると、Web では取れないものを数えることになる）

    const retryButton = (onRetry: () => void) => (
        <button
            type="button"
            onClick={onRetry}
            className="ml-2 text-accent hover:text-accent-strong underline-offset-2 hover:underline"
            style={{ minHeight: 44, touchAction: "manipulation" }}
        >
            {en ? "Retry" : "もう一度"}
        </button>
    );

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="max-w-md mx-auto px-4 pt-10 pb-16">
                <div className="flex items-center gap-1 -ml-3 mb-6">
                    <button
                        type="button"
                        // 直に開いた（戻る先が無い）ときはトップへ
                        onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
                        aria-label={en ? "Back" : "戻る"}
                        className="inline-flex items-center justify-center rounded-full text-white/80 hover:text-white"
                        style={{ width: 44, height: 44 }}
                    >
                        <ArrowLeftIcon className="w-5 h-5" />
                    </button>
                    <h1 className="text-xl font-bold">{en ? "Medals" : "メダル"}</h1>
                </div>

                {/* ── 名前の横に飾る ── */}
                <section aria-labelledby="badges-name-side">
                    <div className="flex items-center justify-between mb-2.5">
                        <h2 id="badges-name-side" className={EYEBROW}>{en ? "Next to your name" : "名前の横に飾る"}</h2>
                        <span className="text-[12px] text-white/60">{en ? "One (even with Pro)" : "1つ（Pro でも1つ）"}</span>
                    </div>
                    {profile.state === "loading" ? (
                        <p className="text-[13px] text-white/60" role="status">{en ? "Loading…" : "読み込み中…"}</p>
                    ) : profile.state === "failed" || !pickerProfile ? (
                        <p className="text-[13px] text-danger" role="alert">
                            {en ? "Couldn't load your profile." : "プロフィールを読み込めませんでした。"}
                            {retryButton(() => { setProfile({ state: "loading" }); void loadProfile(); })}
                        </p>
                    ) : (
                        <button
                            ref={openerRef}
                            type="button"
                            onClick={() => setSheetOpen(true)}
                            aria-haspopup="dialog"
                            aria-expanded={sheetOpen}
                            className="w-full flex items-center gap-2.5 rounded-[14px] bg-[#0E0E0E] ring-1 ring-inset ring-[#3A3220] px-3 py-2 text-left hover:bg-white/[0.04] transition"
                            style={{ minHeight: 64, touchAction: "manipulation" }}
                            data-testid="name-side-open"
                        >
                            {currentSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={currentSrc} alt="" width={40} height={40} className="shrink-0" style={{ width: 40, height: 40 }} />
                            ) : (
                                <span aria-hidden="true" className="shrink-0 rounded-full border border-dashed border-white/30" style={{ width: 40, height: 40 }} />
                            )}
                            <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <span className="text-[13px] font-semibold text-white truncate">
                                    {pickerProfile.displayBadge && current
                                        ? badgeLabel(pickerProfile.displayBadge, current.tier, locale)
                                        : (en ? "No medal chosen" : "メダルを選んでいません")}
                                </span>
                                <span className="text-[12px] text-accent">
                                    {pickerProfile.displayBadge && current
                                        ? (en ? "Shown next to your name" : "名前の横に出ています")
                                        : (en ? "Choose one, and the Pro and official marks" : "選ぶ・Pro と公式の印を変える")}
                                </span>
                            </span>
                            <span aria-hidden="true" className="text-white/50">›</span>
                        </button>
                    )}
                </section>

                {/* ── 獲得したメダル ── */}
                <section aria-labelledby="badges-shelf" className="mt-8">
                    <div className="flex items-center justify-between mb-3">
                        <h2 id="badges-shelf" className={EYEBROW}>{en ? "Medals earned" : "獲得したメダル"}</h2>
                        {shelf.state === "ready" && items.length > 0 && (
                            <span className="text-[12px] text-white/60 tabular-nums" data-testid="badges-count">
                                <span className="text-white">{ownedCount}</span> / {items.length}
                            </span>
                        )}
                    </div>
                    {shelf.state === "loading" ? (
                        <p className="text-[13px] text-white/60" role="status">{en ? "Loading…" : "読み込み中…"}</p>
                    ) : shelf.state === "failed" ? (
                        <p className="text-[13px] text-danger" role="alert">
                            {en ? "Couldn't load your medals." : "メダルを読み込めませんでした。"}
                            {retryButton(() => { setShelf({ state: "loading" }); void loadShelf(); })}
                        </p>
                    ) : (
                        <>
                            {ownedCount === 0 && (
                                <p className="mb-3 text-[13px] text-white/60" data-testid="badges-none">
                                    {en ? "No medals yet. Post photos to earn them." : "まだメダルはありません。写真を載せると手に入ります。"}
                                </p>
                            )}
                            <MedalShelf items={items} locale={locale} />
                        </>
                    )}
                </section>
            </div>

            {sheetOpen && pickerProfile && (
                <NameSideSheet
                    profile={pickerProfile}
                    locale={locale}
                    restoreRef={openerRef}
                    onClose={() => setSheetOpen(false)}
                    onSaved={(next) => setProfile({ state: "ready", value: next })}
                    showToast={(m, k) => showToast(m, k)}
                />
            )}
        </main>
    );
}
