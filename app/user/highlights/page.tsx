"use client";

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageBarHeight } from "../../../lib/hooks/useBottomBarHeight";
import { ArrowLeftIcon, CheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { log } from "../../../lib/utils/log";
import { ROUTES, loginWithNext } from "../../../lib/routes";
import { useStoryArchive } from "../../../lib/hooks/useStoryArchive";
import { groupStories, storyDayLabel, type Story } from "@/lib/stories";
import { HIGHLIGHT_TITLE_MAX, STORIES_PER_HIGHLIGHT, highlightRejection, type HighlightDetail } from "@/lib/highlights";
import StoryTile from "../../components/stories/StoryTile";
import StoryThumb from "../../components/stories/StoryThumb";
import { RING_SEEN } from "../../components/stories/ring";

/**
 * ハイライトを作る・直す（⑦）。モックの作成画面＝**題・表紙・チェック付きの
 * グリッド**。
 *
 * - グリッドはアーカイブ（`GET /stories/archive`）そのもの。タイルは
 *   `/user/archive` と同じ `StoryTile`
 * - 🔴 **ハイライトは本人とフォロワーだけが見る**（ストーリーと同じ相手。
 *   2026-09-22・owner の判断）。**公開範囲では断らない**——以前は
 *   「フォロワーのみ」の1枚を押せなくしていたが、見せる相手が同じに
 *   なったので理由が無い。残る理由は「アーカイブの印が無い」だけで、
 *   そういう行は `GET /stories/archive` が返さない＝**画面では普通出ない**。
 *   それでも判定を置くのは、行が別の種類に差し替わった回に押してから
 *   断られるボタンを置かないため（`highlightRejection`）
 * - 表紙は選んだ中から。選んだ順に関わらず、保存は投稿順（古い→新しい）
 *   ——ビューアが送る順で、その日の束と同じ向き
 * - `?id=` があれば既存のものを直す（`GET /highlights/{uid}/{id}` で今の
 *   選択を読む）。消すのもここ（マイページの輪から鉛筆で来る）
 */

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-white/50 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors";

function HighlightEditor({ editingId }: { editingId: string | null }) {
    const { isAuthenticated, loading, userId } = useAuth();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const router = useRouter();
    const isJa = locale === "ja";

    // 一覧の読み方は `/user/archive` と同じ（`useStoryArchive`）
    const { items: archive, loadError, load: loadArchive } = useStoryArchive(isAuthenticated);
    const [title, setTitle] = useState("");
    /** 下の帯の高さを `--page-bar-h` に出す（`body` がそのぶん下を空ける） */
    const pageBarRef = usePageBarHeight();
    /** 選んだ ID（押した順。保存時に投稿順へ並べ直す） */
    const [selected, setSelected] = useState<string[]>([]);
    const [cover, setCover] = useState<string | null>(null);
    /** 直すとき: 今の中身を読み終えたか（読む前に保存させない） */
    const [existingLoaded, setExistingLoaded] = useState(!editingId);
    /** 直すとき: 今の中身を読めなかった（404 以外）。再試行の口を出す */
    const [existingError, setExistingError] = useState(false);
    const [existingRetry, setExistingRetry] = useState(0);
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!loading && !isAuthenticated) router.replace(loginWithNext(ROUTES.HIGHLIGHT_EDITOR(editingId ?? undefined)));
    }, [loading, isAuthenticated, router, editingId]);

    /**
     * 直すとき: 今の題・中身・表紙。**同じ id で読むのは1回。**
     * 依存（`router`・`showToast`）が作り直されて効果が走り直しても、
     * 選び直した途中の選択を読み直しで上書きしない（テストの `useRouter` は
     * 毎回新しいオブジェクトを返し、実際に上書きが起きた）
     */
    const loadedForRef = useRef<string | null>(null);
    useEffect(() => {
        if (!isAuthenticated || !userId || !editingId) return;
        if (loadedForRef.current === editingId) return;
        let alive = true;
        setExistingError(false);
        void (async () => {
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch(`/highlights/${encodeURIComponent(userId)}/${encodeURIComponent(editingId)}`);
                if (!alive) return;
                // **戻すのは「無い」ときだけ。** 500 や通信断まで「見つかりません」に
                // 潰すと、在るものを消えたと思わせる（再試行の口も無くなる）
                if (res.status === 404) {
                    showToast(isJa ? "ハイライトが見つかりません" : "Highlight not found", "error");
                    router.replace(ROUTES.USER_PROFILE(userId));
                    return;
                }
                if (!res.ok) throw new Error(`status ${res.status}`);
                const data = (await res.json()) as HighlightDetail;
                if (!alive) return;
                const ids = (Array.isArray(data.items) ? data.items : []).map((s) => s.id).filter((v): v is string => typeof v === "string");
                loadedForRef.current = editingId;
                setTitle(typeof data.title === "string" ? data.title : "");
                setSelected(ids);
                setCover(typeof data.coverStoryId === "string" && ids.includes(data.coverStoryId) ? data.coverStoryId : ids[0] ?? null);
                setExistingLoaded(true);
            } catch (e) {
                if (!alive) return;
                log.error("highlight load error:", e);
                setExistingError(true);
            }
        })();
        return () => { alive = false; };
    }, [isAuthenticated, userId, editingId, router, showToast, isJa, existingRetry]);

    /** 読める行だけ・新しい順（`groupStories` の規則をそのまま使う） */
    const stories = useMemo(() => {
        const group = archive && userId ? groupStories(archive, userId)[0] : null;
        return [...(group?.items ?? [])].reverse();
    }, [archive, userId]);
    /** 選んだ中で、いまアーカイブに在るもの（投稿順）。数える・表紙・保存はすべてこれが母集団 */
    const chosen = useMemo(() => stories.filter((s) => selected.includes(s.id)).reverse(), [stories, selected]);
    /** 直すとき: 既存の中身のうち、アーカイブから消えていた数（本人に1行で知らせる） */
    const missing = archive && existingLoaded ? selected.length - chosen.length : 0;

    const toggle = useCallback((s: Story) => {
        if (selected.includes(s.id)) {
            const next = selected.filter((v) => v !== s.id);
            setSelected(next);
            if (cover === s.id) setCover(chosen.find((x) => x.id !== s.id)?.id ?? null);
            return;
        }
        if (chosen.length >= STORIES_PER_HIGHLIGHT) {
            showToast(isJa ? `1つのハイライトに入れられるのは${STORIES_PER_HIGHLIGHT}件までです` : `A highlight holds up to ${STORIES_PER_HIGHLIGHT} stories`, "error");
            return;
        }
        setSelected([...selected, s.id]);
        if (!cover || !chosen.some((x) => x.id === cover)) setCover(s.id);
    }, [selected, chosen, cover, showToast, isJa]);

    const save = useCallback(async () => {
        if (!userId || saving) return;
        const name = title.trim();
        const ids = chosen.map((s) => s.id);
        if (!name) { showToast(isJa ? "ハイライトの名前を入れてください" : "Give the highlight a name", "error"); return; }
        if (ids.length === 0) { showToast(isJa ? "ストーリーを1つ以上選んでください" : "Pick at least one story", "error"); return; }
        setSaving(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const body = JSON.stringify({ title: name, storyIds: ids, coverStoryId: cover && ids.includes(cover) ? cover : ids[0] });
            const res = editingId
                ? await userFetch(`/highlights/${encodeURIComponent(editingId)}`, { method: "PUT", body })
                : await userFetch("/highlights", { method: "POST", body });
            if (!res.ok) throw new Error(await readApiError(res, isJa ? "保存に失敗しました" : "Failed to save"));
            showToast(isJa ? (editingId ? "ハイライトを更新しました" : "ハイライトを作りました") : (editingId ? "Highlight updated" : "Highlight created"), "success");
            router.push(ROUTES.USER_PROFILE(userId));
        } catch (e) {
            log.error("highlight save error:", e);
            const { userFacingError } = await import("../../../lib/utils/errorText");
            showToast(userFacingError(e, isJa ? "保存に失敗しました" : "Failed to save"), "error");
            setSaving(false);
        }
    }, [userId, saving, title, chosen, cover, editingId, isJa, showToast, router]);

    const remove = useCallback(async () => {
        if (!userId || !editingId || deleting) return;
        setDeleting(true);
        try {
            const { userFetch, isGoneResponse, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/highlights/${encodeURIComponent(editingId)}`, { method: "DELETE" });
            // 404 は「もう無い」＝目的は達している
            if (!res.ok && !await isGoneResponse(res)) throw new Error(await readApiError(res, isJa ? "削除に失敗しました" : "Failed to delete"));
            showToast(isJa ? "ハイライトを削除しました（ストーリーはアーカイブに残ります）" : "Highlight deleted (stories stay in your archive)", "success");
            router.push(ROUTES.USER_PROFILE(userId));
        } catch (e) {
            log.error("highlight delete error:", e);
            const { userFacingError } = await import("../../../lib/utils/errorText");
            showToast(userFacingError(e, isJa ? "削除に失敗しました" : "Failed to delete"), "error");
            setDeleting(false);
            setConfirmDelete(false);
        }
    }, [userId, editingId, deleting, isJa, showToast, router]);

    if (loading || !isAuthenticated || !userId) {
        return (
            <main className="min-h-screen bg-bg flex items-center justify-center">
                <h1 className="sr-only">{isJa ? "ハイライト" : "Highlight"}</h1>
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </main>
        );
    }

    const dayLabel = (s: Story) => storyDayLabel(s.createdAt, isJa ? "ja" : "en");
    const canSave = existingLoaded && !saving && title.trim() !== "" && chosen.length > 0;

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="max-w-3xl mx-auto px-4 py-8 pb-32">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={ROUTES.USER_PROFILE(userId)} prefetch={false} className="text-white/60 hover:text-white transition-colors" aria-label={isJa ? "戻る" : "Back"}>
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {editingId ? (isJa ? "ハイライトを編集" : "Edit highlight") : (isJa ? "ハイライトを作る" : "New highlight")}
                    </h1>
                </div>

                <p className="text-sm text-white/50 mb-6">
                    {isJa
                        ? "アーカイブのストーリーを束ねて、マイページに輪として置きます。ハイライトはフォロワーだけに表示されます。"
                        : "Bundle archived stories into a ring on your profile. Only your followers can see them."}
                </p>

                {existingError && (
                    <p className="text-sm text-white/70 mb-6 rounded-lg bg-white/5 ring-1 ring-white/10 px-3 py-2">
                        {isJa ? "いまの中身を読み込めませんでした。" : "Couldn't load this highlight. "}
                        <button type="button" onClick={() => setExistingRetry((n) => n + 1)} className="underline text-white/90 hover:text-white ml-1">
                            {isJa ? "再試行" : "Retry"}
                        </button>
                    </p>
                )}

                <label className="block text-sm text-white/60 mb-1" htmlFor="highlight-title">{isJa ? "名前" : "Name"}</label>
                <input
                    id="highlight-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, HIGHLIGHT_TITLE_MAX))}
                    maxLength={HIGHLIGHT_TITLE_MAX}
                    placeholder={isJa ? "例: 北海道 2026" : "e.g. Hokkaido 2026"}
                    className={inputCls}
                    style={{ minHeight: "44px" }}
                />
                <p className="text-xs text-white/50 mt-1 mb-6 tabular-nums">{title.length}/{HIGHLIGHT_TITLE_MAX}</p>

                {missing > 0 && (
                    <p className="text-xs text-white/60 mb-3">
                        {isJa ? `${missing}件はアーカイブから消えているため、保存すると外れます` : `${missing} ${missing === 1 ? "story is" : "stories are"} no longer in your archive and will be dropped on save`}
                    </p>
                )}

                {chosen.length > 0 && (
                    <div className="mb-6">
                        <p className="text-sm text-white/60 mb-2">{isJa ? "表紙（選んだ中から）" : "Cover (from your selection)"}</p>
                        <ul className="flex gap-3 overflow-x-auto no-scrollbar list-none p-0 m-0 py-1" aria-label={isJa ? "表紙を選ぶ" : "Choose a cover"}>
                            {chosen.map((s) => {
                                const isCover = cover === s.id;
                                return (
                                    <li key={s.id} className="flex-shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setCover(s.id)}
                                            aria-pressed={isCover}
                                            aria-label={isJa ? `${dayLabel(s)} のストーリーを表紙にする` : `Use story from ${dayLabel(s)} as cover`}
                                            className="rounded-full p-[2.5px] active:scale-95 transition-transform"
                                            style={{ background: isCover ? "#ffffff" : RING_SEEN, touchAction: "manipulation" }}
                                        >
                                            <span className="block rounded-full p-[2.5px] bg-black">
                                                <span className="relative block rounded-full overflow-hidden bg-white/10" style={{ width: "48px", height: "48px" }}>
                                                    <StoryThumb src={s.src} mediaType={s.mediaType} />
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                <div className="flex items-baseline justify-between mb-2">
                    <p className="text-sm text-white/60">
                        {isJa ? "ストーリーを選ぶ" : "Pick stories"}
                        <span className="ml-2 text-xs text-white/50 tabular-nums">{chosen.length}/{STORIES_PER_HIGHLIGHT}</span>
                    </p>
                    <Link href={ROUTES.STORY_ARCHIVE} prefetch={false} className="text-xs text-white/60 hover:text-white transition-colors">
                        {isJa ? "アーカイブを見る →" : "View archive →"}
                    </Link>
                </div>

                {archive === null && !loadError ? (
                    <div className="py-16 flex justify-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    </div>
                ) : loadError ? (
                    <div className="py-16 text-center text-white/50">
                        <p className="text-sm mb-4">{isJa ? "アーカイブを読み込めませんでした" : "Could not load your archive"}</p>
                        <button
                            onClick={() => void loadArchive()}
                            className="inline-block px-4 py-2.5 text-sm bg-accent-fill text-ink font-semibold rounded-full hover:brightness-110 transition-colors"
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {isJa ? "再試行" : "Retry"}
                        </button>
                    </div>
                ) : stories.length === 0 ? (
                    <div className="py-16 text-center text-white/50">
                        <p className="text-sm">{isJa ? "アーカイブはまだありません" : "Nothing archived yet"}</p>
                        <p className="text-xs mt-2 text-white/50">
                            {isJa ? "投稿するときに「アーカイブに自動保存」を入にすると、24時間のあとにここから選べます"
                                : "Turn on “Save to archive” when posting a story; after 24 hours it appears here."}
                        </p>
                    </div>
                ) : (
                    <ul className="grid grid-cols-3 list-none p-0 m-0" style={{ gap: "2px" }}>
                        {stories.map((s) => {
                            const label = dayLabel(s);
                            const reason = highlightRejection(s, isJa);
                            const isSelected = selected.includes(s.id);
                            return (
                                <StoryTile
                                    key={s.id}
                                    story={s}
                                    label={label}
                                    ariaLabel={reason
                                        ? `${label}: ${reason}`
                                        : (isJa ? `${label} のストーリーを${isSelected ? "外す" : "選ぶ"}` : `${isSelected ? "Remove" : "Add"} story from ${label}`)}
                                    onClick={() => toggle(s)}
                                    disabled={reason !== null}
                                    pressed={reason ? undefined : isSelected}
                                >
                                    {reason ? (
                                        <span className="absolute inset-0 flex items-center justify-center" title={reason}>
                                            <LockClosedIcon className="w-6 h-6 text-white/90 drop-shadow" aria-hidden="true" />
                                        </span>
                                    ) : (
                                        <span
                                            className={`absolute right-1 top-1 w-[22px] h-[22px] rounded-full flex items-center justify-center ring-2 ring-white ${isSelected ? "bg-primary text-ink" : "bg-black/40"}`}
                                            aria-hidden="true"
                                        >
                                            {isSelected && <CheckIcon className="w-3.5 h-3.5" strokeWidth={3} />}
                                        </span>
                                    )}
                                    {isSelected && cover === s.id && (
                                        <span className="absolute left-1 top-1 px-1.5 py-0.5 rounded bg-primary text-ink font-semibold" style={{ fontSize: "10px" }}>
                                            {isJa ? "表紙" : "Cover"}
                                        </span>
                                    )}
                                </StoryTile>
                            );
                        })}
                    </ul>
                )}

                {stories.some((s) => highlightRejection(s, isJa)) && (
                    <p className="text-xs text-white/50 mt-3">
                        {isJa ? "鍵のついた投稿は「アーカイブに自動保存」が入っていないので、ハイライトには入れられません。"
                            : "Locked stories weren’t saved to your archive, so they can’t go into a highlight."}
                    </p>
                )}
            </div>

            {/* 🔴 **下部タブバー（`BottomNav`・z-40）の上へ逃がす。**
                `bottom-0` に固定していたので、**この帯がタブバーの裏に入り、
                「保存」も「キャンセル」も押せなかった**（実測: 保存の座標を
                クリックすると書き込みは1件も飛ばず、タブバーの「マイページ」に
                当たって遷移した。390px と 1280px の両方）。

                **`z-50` で覆い返すだけにはしない。** 隠れたタブの5つのボタンが
                **フォーカスだけ受け取れる**状態になる（WCAG 2.4.11）。
                `app/user/upload/page.tsx` が同じ不具合を先に直していて、
                その理由まで書いてある——**同じ形に揃える**。

                高さはタブバー自身が `--bottom-bar-h` に実測値（safe-area 込み）を
                出しているので、それを読む。**この画面からは書かない**。
                落とし先の `env(safe-area-inset-bottom)` はタブバーが無い状況の受け皿。
                safe-area は変数に含まれるので、`paddingBottom` で二重に空けない。 */}
            <div ref={pageBarRef} className="fixed inset-x-0 z-50 bg-black/90 backdrop-blur-md border-t border-white/10 px-4 py-3"
                style={{ bottom: "var(--bottom-bar-h, env(safe-area-inset-bottom, 0px))" }}>
                <div className="max-w-3xl mx-auto flex items-center gap-3">
                    {editingId && (
                        confirmDelete ? (
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-white/70">{isJa ? "削除しますか？" : "Delete?"}</span>
                                <button
                                    type="button"
                                    onClick={() => void remove()}
                                    disabled={deleting}
                                    className="px-3 py-2 rounded-full bg-danger-fill text-white text-sm font-semibold disabled:opacity-50"
                                    style={{ touchAction: "manipulation", minHeight: "44px" }}
                                >
                                    {deleting ? (isJa ? "削除中…" : "Deleting…") : (isJa ? "削除する" : "Delete")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDelete(false)}
                                    disabled={deleting}
                                    className="px-3 py-2 rounded-full text-white/70 text-sm"
                                    style={{ touchAction: "manipulation", minHeight: "44px" }}
                                >
                                    {isJa ? "やめる" : "Cancel"}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setConfirmDelete(true)}
                                className="px-3 py-2 text-sm text-danger hover:text-danger"
                                style={{ touchAction: "manipulation", minHeight: "44px" }}
                            >
                                {isJa ? "このハイライトを削除" : "Delete this highlight"}
                            </button>
                        )
                    )}
                    <button
                        type="button"
                        onClick={() => void save()}
                        disabled={!canSave}
                        className="ml-auto px-6 py-2.5 bg-accent-fill text-ink text-sm font-semibold rounded-full hover:brightness-110 transition-colors disabled:opacity-50"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {saving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "保存" : "Save")}
                    </button>
                </div>
            </div>
        </main>
    );
}

/** `?id=` ごとに作り直す——id が消えた／変わったときに前の題と選択を持ち越さない（A の複製を POST しない） */
function KeyedEditor() {
    const searchParams = useSearchParams();
    const id = searchParams.get("id");
    return <HighlightEditor key={id ?? ""} editingId={id} />;
}

export default function HighlightEditorPage() {
    return (
        <Suspense fallback={
            <main className="min-h-screen bg-bg flex items-center justify-center">
                {/* 事前描画で焼かれるのはこの fallback。見出しを持たせる */}
                <h1 className="sr-only">ハイライト</h1>
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </main>
        }>
            <KeyedEditor />
        </Suspense>
    );
}
