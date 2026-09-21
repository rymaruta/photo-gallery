"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArchiveBoxIcon, PlayIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { log } from "../../../lib/utils/log";
import { ROUTES, loginWithNext } from "../../../lib/routes";
import { usableRows } from "../../../lib/utils/apiRows";
import { publicImageUrl } from "@/lib/utils/seo";
import { formatStoredDateTime } from "@/lib/utils/photoDate";
import type { Story } from "@/lib/stories";
import StoryViewer from "../../components/stories/StoryViewer";

/**
 * ストーリーのアーカイブ（24時間で消えたあと、本人だけが見る）。
 *
 * 中身は `GET /stories/archive` が返す**ストーリーの行そのもの**——
 * 「アーカイブに自動保存」を入にして投稿し、期限が切れたもの。新しい
 * 置き場は無く、見せ方も `StoryViewer` をそのまま使う（自分のストーリー
 * として開くので、閲覧者は 0 人・返信は無し・削除はできる・「残す」は
 * 出ない）。
 *
 * **入口はまだ無い。** マイページの輪（アーカイブ／ハイライト）は ⑦ で置く
 * ——`UserProfileClient` は ⑦ に入るまで触らない約束。それまでは URL で来る。
 *
 * 一覧は3列の正方形（アーカイブの見せ方として一番素直な形。モックには
 * アーカイブ単体の画面が無いので、足すのは最小限——押すと開く、だけ）。
 */

/** 行の形が読めるものだけ（`groupStories` と同じ条件） */
const isUsable = (s: Partial<Story>): s is Story =>
    typeof s.id === "string" && !!s.id
    && typeof s.src === "string" && !!s.src
    && typeof s.userId === "string" && !!s.userId
    && typeof s.createdAt === "string" && !!s.createdAt
    && typeof s.expiresAt === "string" && Number.isFinite(Date.parse(s.expiresAt));

export default function StoryArchivePage() {
    const { isAuthenticated, loading, userId } = useAuth();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const router = useRouter();
    const isJa = locale === "ja";

    const [items, setItems] = useState<Story[] | null>(null);
    // 取得の失敗を「0件」に混ぜない（下書きの一覧と同じ判断——消えたように見える）
    const [loadError, setLoadError] = useState(false);
    /** 開いている1枚。**古い順の添字**（ビューアは古い→新しいに送る） */
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    // 未ログインはログインへ（戻り先付き）。下書きの一覧は回り続ける作りだが、
    // ここは URL で来る画面なので、行き止まりにしない
    useEffect(() => {
        if (!loading && !isAuthenticated) router.replace(loginWithNext(ROUTES.STORY_ARCHIVE));
    }, [loading, isAuthenticated, router]);

    const load = useCallback(async () => {
        setLoadError(false);
        try {
            const { userFetch } = await import("../../../lib/utils/api");
            const res = await userFetch("/stories/archive");
            if (!res.ok) {
                log.error("story archive fetch failed", { status: res.status });
                setLoadError(true);
                return;
            }
            // 読めない行は落とす（1件の巻き添えで全部消えないように）。
            // 配列でない応答は「0件」ではなく失敗
            const rows = usableRows<Partial<Story>>(await res.json(), "GET /stories/archive");
            if (!rows) {
                log.error("story archive response is not an array");
                setLoadError(true);
                return;
            }
            setItems(rows.filter(isUsable));
        } catch (e) {
            log.error("story archive load error:", e);
            setLoadError(true);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated) void load();
    }, [isAuthenticated, load]);

    /** ビューアに渡す束（古い→新しい）。サーバーは新しい順で返す */
    const ascending = useMemo(
        () => (items ? [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []),
        [items],
    );
    /** グリッドは新しい順 */
    const descending = useMemo(() => [...ascending].reverse(), [ascending]);

    // 削除は `StoriesBar` の `handleDeleteStory` と同じ形（404 は成功・
    // サーバーの理由をそのまま出す・技術文字列は出さない）
    const handleDelete = useCallback(async (storyId: string) => {
        try {
            const { userFetch, isGoneResponse, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
            if (!res.ok && !await isGoneResponse(res)) {
                // **棚へ移った行は掃除が来ない**（`deleteStory` の注記）ので、
                // 実体を消したあと行の削除が転ぶと、押し直しだけが道。理由を
                // そのまま出して押し直しを促す
                throw new Error(await readApiError(res, isJa ? "削除に失敗しました" : "Failed to delete"));
            }
            setItems((prev) => (prev ? prev.filter((s) => s.id !== storyId) : prev));
            showToast(isJa ? "アーカイブから削除しました" : "Removed from archive", "success");
            return true;
        } catch (e) {
            log.error("story archive delete error:", e);
            const { userFacingError } = await import("../../../lib/utils/errorText");
            showToast(userFacingError(e, isJa ? "削除に失敗しました" : "Failed to delete"), "error");
            return false;
        }
    }, [isJa, showToast]);

    if (loading || !isAuthenticated) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">{isJa ? "アーカイブ" : "Archive"}</h1>
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </main>
        );
    }

    const lc = isJa ? "ja" as const : "en" as const;

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={ROUTES.HOME} className="text-white/60 hover:text-white transition-colors" aria-label={isJa ? "戻る" : "Back"}>
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isJa ? "アーカイブ" : "Archive"}
                        {items && items.length > 0 && <span className="ml-2 text-sm text-white/50">{items.length}</span>}
                    </h1>
                </div>

                <p className="text-sm text-white/50 mb-6">
                    {isJa
                        ? "「アーカイブに自動保存」を入にして投稿したストーリーが、24時間のあともここに残ります。見られるのはあなただけです。"
                        : "Stories you posted with “Save to archive” stay here after 24 hours. Only you can see them."}
                </p>

                {items === null && !loadError ? (
                    <div className="py-16 flex justify-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    </div>
                ) : loadError ? (
                    <div className="py-16 text-center text-white/50">
                        <p className="text-sm mb-1">{isJa ? "アーカイブを読み込めませんでした" : "Could not load your archive"}</p>
                        <p className="text-xs mb-4">
                            {isJa ? "消えたわけではありません。通信を確かめてもう一度お試しください。"
                                : "Nothing was lost. Check your connection and try again."}
                        </p>
                        <button
                            onClick={() => void load()}
                            className="inline-block px-4 py-2.5 text-sm bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-colors"
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {isJa ? "再試行" : "Retry"}
                        </button>
                    </div>
                ) : descending.length === 0 ? (
                    <div className="py-16 text-center text-white/50">
                        <ArchiveBoxIcon className="w-12 h-12 mx-auto mb-3 text-white/50" />
                        <p className="text-sm">{isJa ? "アーカイブはまだありません" : "Nothing archived yet"}</p>
                        <p className="text-xs mt-2 text-white/50">
                            {isJa ? "投稿するときに「アーカイブに自動保存」を入にすると、ここに残ります"
                                : "Turn on “Save to archive” when posting a story to keep it here."}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3" style={{ gap: "2px" }} role="list">
                        {descending.map((s, gi) => {
                            const dateText = formatStoredDateTime(s.archivedAt ?? s.expiresAt, lc) ?? "";
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    role="listitem"
                                    // 古い順の添字へ写す（ビューアはその束を古い→新しいに送る）
                                    onClick={() => setOpenIndex(ascending.length - 1 - gi)}
                                    aria-label={isJa ? `ストーリーを開く（${dateText || "日付不明"}）` : `Open story (${dateText || "unknown date"})`}
                                    className="relative block aspect-[9/16] w-full overflow-hidden bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    {s.mediaType === "video" ? (
                                        <>
                                            {/* 最初のフレームを出す（metadata だけ引く）。音は出さない */}
                                            <video
                                                src={publicImageUrl(s.src)}
                                                muted
                                                playsInline
                                                preload="metadata"
                                                className="absolute inset-0 w-full h-full object-cover"
                                            />
                                            <PlayIcon className="absolute right-1 top-1 w-4 h-4 text-white drop-shadow" aria-hidden="true" />
                                        </>
                                    ) : (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={publicImageUrl(s.src)}
                                            alt=""
                                            loading="lazy"
                                            className="absolute inset-0 w-full h-full object-cover"
                                        />
                                    )}
                                    {dateText && (
                                        <span
                                            className="absolute left-1 bottom-1 px-1.5 py-0.5 rounded bg-black/60 text-white/90"
                                            style={{ fontSize: "10px" }}
                                        >
                                            {dateText}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {openIndex !== null && ascending.length > 0 && userId && (
                <StoryViewer
                    groups={[{
                        userId,
                        displayName: ascending.find((s) => s.displayName)?.displayName ?? (isJa ? "あなた" : "You"),
                        items: ascending,
                    }]}
                    initialGroupIndex={0}
                    initialItemIndex={Math.min(openIndex, ascending.length - 1)}
                    locale={lc}
                    ownUserId={userId}
                    isAuthenticated
                    onSeen={() => { /* 自分のアーカイブ。既読は要らない */ }}
                    onDelete={handleDelete}
                    onClose={() => setOpenIndex(null)}
                />
            )}
        </main>
    );
}
