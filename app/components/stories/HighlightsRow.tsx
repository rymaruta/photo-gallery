"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PlusIcon, PencilIcon, PhotoIcon } from "@heroicons/react/24/outline";
import { userPublicFetch } from "../../../lib/utils/api";
import { useToast } from "../../../lib/hooks/useToast";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";
import { groupStories } from "@/lib/stories";
import type { HighlightSummary, HighlightDetail } from "@/lib/highlights";
import { RING_SEEN } from "./ring";
import StoryThumb from "./StoryThumb";

/**
 * マイページのハイライトの輪（⑦）。誰のページでも、誰にでも出る。
 *
 * - 中身は `GET /highlights/{userId}`（未認証で読める口）。表紙の丸と題だけ
 * - 押すと `GET /highlights/{userId}/{id}` で中身を引き、`StoryViewer` で
 *   開く（トップの輪と同じ見せ方。返信の帯・閲覧者・「残す」はサーバーが
 *   返す形（`allowReplies: false`・`archivedAt`・`archive: true`）で消える）
 * - 本人には先頭に「新規」の輪と、各輪の右下に編集の印。作る・直すのは
 *   `/user/highlights`
 * - 0件のときは、本人以外には**何も描かない**（訪問者に空の段を見せない）
 *
 * **`StoryViewer` は遅延読み込み。** マイページは誰でも開く静的ページで、
 * ビューアは曲・動画・返信まで引き連れる重い部品。押されるまで読まない
 * （`UserProfileClient` が `StoriesBar` にしているのと同じ）。
 */
const StoryViewer = dynamic(() => import("./StoryViewer"), { ssr: false });

/** 輪の大きさ（トップの `StoriesBar` と同じ 64px） */
const RING_PX = 64;

export default function HighlightsRow({ userId, displayName, isOwner, isAuthenticated, ownUserId, locale }: {
    userId: string;
    displayName: string;
    isOwner: boolean;
    isAuthenticated: boolean;
    ownUserId?: string | null;
    locale: "ja" | "en";
}) {
    const isJa = locale === "ja";
    const { showToast } = useToast();
    const [highlights, setHighlights] = useState<HighlightSummary[] | null>(null);
    // 取得の失敗を「0件」に混ぜない（`StoriesBar` と同じ判断）
    const [loadError, setLoadError] = useState(false);
    /** 中身を引いている輪 */
    const [opening, setOpening] = useState<string | null>(null);
    const [open, setOpen] = useState<HighlightDetail | null>(null);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const res = await userPublicFetch(`/highlights/${encodeURIComponent(userId)}`);
            if (!res.ok) {
                log.warn("highlights fetch failed", { status: res.status });
                setLoadError(true);
                return;
            }
            const data = (await res.json()) as { highlights?: unknown };
            const rows = Array.isArray(data.highlights) ? data.highlights : null;
            if (!rows) {
                setLoadError(true);
                return;
            }
            // 読めない行は落として、残りは出す
            setHighlights(rows.filter((h): h is HighlightSummary =>
                !!h && typeof h === "object" && typeof (h as HighlightSummary).id === "string" && (h as HighlightSummary).id !== ""));
        } catch (e) {
            log.warn("highlights load error:", e);
            setLoadError(true);
        }
    }, [userId]);

    useEffect(() => { void load(); }, [load]);

    const openHighlight = useCallback(async (h: HighlightSummary) => {
        if (opening) return;
        setOpening(h.id);
        try {
            const res = await userPublicFetch(`/highlights/${encodeURIComponent(userId)}/${encodeURIComponent(h.id)}`);
            if (!res.ok) {
                // 消えていたら輪も外す（本人が別の端末で消した直後など）
                if (res.status === 404) setHighlights((prev) => prev?.filter((x) => x.id !== h.id) ?? prev);
                throw new Error(`status ${res.status}`);
            }
            const data = (await res.json()) as HighlightDetail;
            // 形の壊れた行を落とすのは `groupStories`（バーと同じ規則）。
            // **並びは保存した順のまま**（`groupStories` は投稿順に並べ替えるので、
            // 落とすためだけに通して、順は元の配列から取り直す）
            const raw = Array.isArray(data.items) ? data.items : [];
            const ok = new Set((groupStories(raw, userId)[0]?.items ?? []).map((s) => s.id));
            const items = raw.filter((s) => !!s && typeof s === "object" && ok.has(s.id));
            if (items.length === 0) {
                showToast(isJa ? "このハイライトのストーリーはもうありません" : "This highlight has no stories left", "error");
                return;
            }
            setOpen({ id: data.id, title: typeof data.title === "string" ? data.title : h.title, items });
        } catch (e) {
            log.warn("highlight open error:", e);
            showToast(isJa ? "ハイライトを開けませんでした" : "Couldn't open the highlight", "error");
        } finally {
            setOpening(null);
        }
    }, [opening, userId, isJa, showToast]);

    // 0件は本人以外に何も出さない。失敗は本人以外にも出す（黙って0件に見せない）
    const rows = highlights ?? [];
    if (!isOwner && !loadError && rows.length === 0) return null;

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 pb-3" data-testid="highlights-row">
            {loadError && rows.length === 0 && (
                <p className="text-[11px] text-white/50 px-1 pb-1">
                    {isJa ? "ハイライトを読み込めませんでした。" : "Couldn't load highlights. "}
                    <button onClick={() => void load()} className="underline text-white/70 hover:text-white">
                        {isJa ? "再試行" : "Retry"}
                    </button>
                </p>
            )}
            <ul className="flex gap-4 overflow-x-auto no-scrollbar -mx-1 px-1 py-1 list-none m-0" aria-label={isJa ? "ハイライト" : "Highlights"}>
                {isOwner && (
                    <li className="flex flex-col items-center gap-1.5 flex-shrink-0">
                        <Link
                            href={ROUTES.HIGHLIGHT_EDITOR()}
                            prefetch={false}
                            aria-label={isJa ? "ハイライトを作る" : "New highlight"}
                            className="rounded-full p-[2.5px] active:scale-95 transition-transform"
                            style={{ background: "rgba(255,255,255,0.1)", touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
                            <span
                                className="rounded-full bg-black flex items-center justify-center"
                                style={{ width: `${RING_PX + 5}px`, height: `${RING_PX + 5}px` }}
                            >
                                <PlusIcon className="w-7 h-7 text-white/90" strokeWidth={2} />
                            </span>
                        </Link>
                        <span className="text-[11px] text-white/70 leading-none">{isJa ? "新規" : "New"}</span>
                    </li>
                )}
                {rows.map((h) => (
                    <li key={h.id} className="relative flex flex-col items-center gap-1.5 flex-shrink-0">
                        <button
                            type="button"
                            onClick={() => void openHighlight(h)}
                            disabled={opening !== null}
                            aria-label={isJa ? `ハイライト「${h.title}」を見る` : `View highlight “${h.title}”`}
                            aria-busy={opening === h.id}
                            className="group disabled:opacity-60"
                            style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                        >
                            <span
                                className="block rounded-full p-[2.5px] group-active:scale-95 transition-transform"
                                style={{ background: RING_SEEN }}
                            >
                                <span className="block rounded-full p-[2.5px] bg-black">
                                    <span
                                        className="relative block rounded-full overflow-hidden bg-white/10"
                                        style={{ width: `${RING_PX}px`, height: `${RING_PX}px` }}
                                    >
                                        {h.cover ? (
                                            <StoryThumb src={h.cover.src} mediaType={h.cover.mediaType === "video" ? "video" : "image"} />
                                        ) : (
                                            <PhotoIcon className="absolute inset-0 m-auto w-7 h-7 text-white/50" aria-hidden="true" />
                                        )}
                                        {opening === h.id && (
                                            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                                                <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                            </span>
                                        )}
                                    </span>
                                </span>
                            </span>
                        </button>
                        {isOwner && (
                            <Link
                                href={ROUTES.HIGHLIGHT_EDITOR(h.id)}
                                prefetch={false}
                                aria-label={isJa ? `ハイライト「${h.title}」を編集` : `Edit highlight “${h.title}”`}
                                className="absolute top-[50px] right-0 w-[22px] h-[22px] rounded-full ring-[3px] ring-bg bg-accent-fill text-white flex items-center justify-center active:scale-90 transition"
                                style={{ touchAction: "manipulation" }}
                            >
                                <PencilIcon className="w-3 h-3" strokeWidth={2.5} />
                            </Link>
                        )}
                        <span className="text-[11px] max-w-[68px] truncate leading-none text-white/90">{h.title}</span>
                    </li>
                ))}
            </ul>

            {open && (
                <StoryViewer
                    groups={[{ userId, displayName, items: open.items }]}
                    initialGroupIndex={0}
                    locale={locale}
                    ownUserId={ownUserId}
                    isAuthenticated={isAuthenticated}
                    onSeen={() => { /* ハイライトに既読は無い */ }}
                    onClose={() => setOpen(null)}
                />
            )}
        </div>
    );
}
