"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useStoryArchive } from "../../../lib/hooks/useStoryArchive";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArchiveBoxIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { log } from "../../../lib/utils/log";
import { ROUTES, loginWithNext } from "../../../lib/routes";
import { groupStories, storyDayLabel, type Story } from "@/lib/stories";
import StoryViewer from "../../components/stories/StoryViewer";
import StoryTile from "../../components/stories/StoryTile";

/**
 * ストーリーのアーカイブ（24時間で消えたあと、本人だけが見る）。
 *
 * 中身は `GET /stories/archive` が返す**ストーリーの行そのもの**——
 * 「アーカイブに自動保存」を入にして投稿し、期限が切れたもの。新しい
 * 置き場は無く、見せ方も `StoryViewer` をそのまま使う（自分のストーリー
 * として開くので、削除はできる・「残す」は出ない・閲覧者と返信は出ない）。
 *
 * **開くのは「その日のぶん」。** 束をアーカイブ全体にすると、進捗の線が
 * 1枚1本なので数百枚で線が消える（`StoriesBar` の束は1日20本が上限で、
 * 線はそれを前提にしている）。日ごとに束ねれば同じ上限に収まり、
 * 押した1枚から始めてその日の残りを送れる。
 *
 * **入口はマイページの「アーカイブ →」（本人だけ・下書きの隣）**と、
 * ハイライトの作成画面（`/user/highlights` の「アーカイブを見る」）。
 * マイページの輪はハイライト（⑦）で、アーカイブそのものは輪にしない
 * （本人だけのものを、誰でも見る場所に並べない）。
 *
 * 一覧は3列・縦長（9:16）のタイル（`StoryTile`。ハイライトの作成画面と
 * 同じ絵）。ストーリーは縦長なので、下書きの正方形ではなく実物の形で
 * 並べる。モックにはアーカイブ単体の画面が無いので、足すのは最小限
 * ——押すと開く、だけ。
 */

/** その日の鍵（見ている人の時計で。UTC の日付で切ると深夜の投稿が翌日に寄る） */
const dayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export default function StoryArchivePage() {
    // **`useMemberGate` は使わない。** あれは投稿の権限（グループ）の門で、
    // ストーリーはログインだけで投稿できる（`StoriesBar` も `isAuthenticated`
    // だけで出す）。グループの無い人のアーカイブを「権限が無い」で
    // 送り返してはいけない
    const { isAuthenticated, loading, userId } = useAuth();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const router = useRouter();
    const isJa = locale === "ja";

    // 一覧の読み方はハイライトの作成画面と同じ（`useStoryArchive`）
    const { items, setItems, loadError, load } = useStoryArchive(isAuthenticated);
    /** 開いている束（その日のぶん）と、その中の1枚 */
    const [open, setOpen] = useState<{ items: Story[]; index: number } | null>(null);
    /**
     * ビューアの中で消した1枚。**閉じてから一覧から外す**——開いている間に
     * 束を差し替えると添字がずれて隣の1枚が映る（`StoriesBar` の `onClose`
     * が同じ理由で「閉じてから取り直す」）
     */
    const removedRef = useRef<Set<string>>(new Set());

    // 未ログインはログインへ（戻り先付き）。下書きの一覧は回り続ける作りだが、
    // ここは URL で来る画面なので、行き止まりにしない
    useEffect(() => {
        if (!loading && !isAuthenticated) router.replace(loginWithNext(ROUTES.STORY_ARCHIVE));
    }, [loading, isAuthenticated, router]);

    /**
     * 自分の束（古い→新しい）。形の壊れた行を落とすのも、並べるのも、
     * 表示名を選ぶのも `groupStories` に任せる（バーと同じ規則。写さない）
     */
    const group = useMemo(() => (items && userId ? groupStories(items, userId)[0] ?? null : null), [items, userId]);
    /** 日ごとの束（古い日→新しい日・中は古い→新しい） */
    const days = useMemo(() => {
        const map = new Map<string, Story[]>();
        for (const s of group?.items ?? []) {
            const k = dayKey(s.createdAt);
            const list = map.get(k) ?? [];
            list.push(s);
            map.set(k, list);
        }
        return [...map.values()];
    }, [group]);
    /** グリッドは新しい順 */
    const descending = useMemo(() => [...(group?.items ?? [])].reverse(), [group]);

    const openStory = useCallback((s: Story) => {
        const bucket = days.find((b) => b.some((x) => x.id === s.id));
        if (!bucket) return;
        setOpen({ items: bucket, index: bucket.findIndex((x) => x.id === s.id) });
    }, [days]);

    const closeViewer = useCallback(() => {
        setOpen(null);
        if (removedRef.current.size === 0) return;
        const gone = removedRef.current;
        removedRef.current = new Set();
        setItems((prev) => (prev ? prev.filter((s) => !gone.has(s.id)) : prev));
    }, [setItems]);

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
            removedRef.current.add(storyId);
            showToast(isJa ? "アーカイブから削除しました" : "Removed from archive", "success");
            return true;   // ビューアが閉じる → `closeViewer` が一覧から外す
        } catch (e) {
            log.error("story archive delete error:", e);
            const { userFacingError } = await import("../../../lib/utils/errorText");
            showToast(userFacingError(e, isJa ? "削除に失敗しました" : "Failed to delete"), "error");
            return false;
        }
    }, [isJa, showToast]);

    if (loading || !isAuthenticated) {
        return (
            <main className="min-h-screen bg-bg flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">{isJa ? "アーカイブ" : "Archive"}</h1>
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </main>
        );
    }

    const lc = isJa ? "ja" as const : "en" as const;
    const dayLabel = (s: Story) => storyDayLabel(s.createdAt, lc);

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={ROUTES.HOME} className="text-white/60 hover:text-white transition-colors" aria-label={isJa ? "戻る" : "Back"}>
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isJa ? "アーカイブ" : "Archive"}
                        {descending.length > 0 && <span className="ml-2 text-sm text-white/50">{descending.length}</span>}
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
                            className="inline-block px-4 py-2.5 text-sm bg-accent-fill text-white font-semibold rounded-full hover:brightness-110 transition-colors"
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
                    <ul className="grid grid-cols-3 list-none p-0 m-0" style={{ gap: "2px" }}>
                        {descending.map((s) => {
                            const label = dayLabel(s);
                            return (
                                <StoryTile
                                    key={s.id}
                                    story={s}
                                    label={label}
                                    ariaLabel={isJa ? `${label} のストーリーを開く` : `Open story from ${label}`}
                                    onClick={() => openStory(s)}
                                />
                            );
                        })}
                    </ul>
                )}
            </div>

            {open && group && userId && (
                <StoryViewer
                    groups={[{ userId, displayName: group.displayName, items: open.items }]}
                    initialGroupIndex={0}
                    initialItemIndex={open.index}
                    locale={lc}
                    ownUserId={userId}
                    isAuthenticated
                    onSeen={() => { /* 自分のアーカイブ。既読は要らない */ }}
                    onDelete={handleDelete}
                    onClose={closeViewer}
                />
            )}
        </main>
    );
}
