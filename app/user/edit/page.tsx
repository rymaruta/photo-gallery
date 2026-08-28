"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import type { Photo, LocalizedParagraphs } from "@/lib/data/photos";
import { log } from "../../../lib/utils/log";
import { ROUTES } from "../../../lib/routes";
import { toDateInputValue, mergeDate } from "../../../lib/utils/dateInput";
import { formatStoredDateTime } from "../../../lib/utils/photoDate";
import { changedFields } from "../../../lib/utils/changedFields";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { collectOwnValues, appendTag, type OwnValues } from "../../../lib/utils/ownValues";

const inputCls = "w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/[0.08] transition-colors";
const labelCls = "block text-sm text-white/60 mb-1";

// title/description は string か {ja,en}/{ja:[],en:[]} の両対応。
// 編集欄は日本語だけを扱うが、保存時に英語側を残す（消すと JSON-LD と
// sr-only の英語併記まで失われるため）。
function titleToText(t: Photo["title"]): string {
    if (!t) return "";
    if (typeof t === "string") return t;
    const o = t as Record<string, string>;
    return o.ja || o.en || "";
}
function descToText(d: Photo["description"]): string {
    if (!d) return "";
    if (typeof d === "string") return d;
    const o = d as LocalizedParagraphs;
    const arr = o.ja && o.ja.length ? o.ja : o.en;
    return Array.isArray(arr) ? arr.join("\n") : "";
}

/** 日本語だけ差し替え、英語側は元のまま残す */
export function mergeLocalizedTitle(original: Photo["title"], ja: string): Photo["title"] {
    const en = original && typeof original === "object" ? (original as Record<string, string>).en : undefined;
    if (!en) return ja;
    return { ...(ja ? { ja } : {}), en };
}

/** 説明も同様に、英語側の段落を残す */
export function mergeLocalizedDescription(original: Photo["description"], ja: string): Photo["description"] {
    const lines = ja.split("\n").map((l) => l.trim()).filter(Boolean);
    const en = original && typeof original === "object" && !Array.isArray(original)
        ? (original as LocalizedParagraphs).en
        : undefined;
    if (!en || en.length === 0) return ja;
    return { ...(lines.length ? { ja: lines } : {}), en };
}

function EditContent() {
    const { isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { locale } = useLocale();
    const { showToast } = useToast();
    const isJa = locale === "ja";

    const photoId = searchParams.get("id");

    /**
     * 取得の effect が **`router` / `showToast` の同一性に依存しないようにする。**
     *
     * どちらもフックが返す値で、参照が変わりうる（Next の useRouter は
     * 実際には安定だが、それに寄りかかっている状態だった）。deps に入れたまま
     * effect の中で「毎回新しいオブジェクト」を state に入れると、
     * **再描画 → deps が変わる → 再取得 → …** で回り続ける。
     * 入力候補（collectOwnValues）を足したときに実際に踏んだ
     * （既存の staleResponse テストは router を安定なオブジェクトに固定して
     *  いて、それで避けていただけだった）。
     */
    const routerRef = useRef(router);
    const showToastRef = useRef(showToast);
    routerRef.current = router;
    showToastRef.current = showToast;

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    // 読み込みに失敗したか。トーストは数秒で消えるので、画面にも残す。
    const [loadFailed, setLoadFailed] = useState(false);
    // 読み込んだ元データ。編集欄に出していない項目（英語のタイトル・説明、
    // 撮影日の時刻）を保存時に失わないために持っておく。
    const [original, setOriginal] = useState<Photo | null>(null);
    const [saving, setSaving] = useState(false);
    // 自分がこれまでに使った撮影地・カテゴリ・タグ（入力候補）
    const [ownValues, setOwnValues] = useState<OwnValues>({ locations: [], categories: [], tags: [] });
    // 削除は取り消せないので、確認を1枚挟む（ストーリー削除と同じ形）
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [date, setDate] = useState("");
    const [tagsInput, setTagsInput] = useState("");

    // 認証ゲート（一般ユーザー or 管理者）。upload ページと同じ方針。
    const gate = useMemberGate();

    // 対象写真の取得: 公開 /photos/{id} は下書きを404にするため、認証済み /user/photos から探す
    useEffect(() => {
        // ?id が無いまま開かれたら、待っても何も来ない。
        // 以前はここで return するだけだったので loadingPhoto が true のまま
        // スピナーが永久に回り、戻る導線も出なかった。
        if (!photoId) { setLoadingPhoto(false); return; }
        if (!isAuthenticated || (!isAdminUser && !isGeneralUser)) return;
        // 中断ガード。取得は非同期なので、遅い回線で下書き A を開いて戻り B を
        // 開くと、A の応答が後から届く。無かった頃はフォームが A の内容で埋まり、
        // save() は現在の photoId（= B）を送るので、**B の写真に A のタイトル・
        // 説明・タグ・撮影日が上書き保存された**。
        // 同じ形を /admin/edit に入れてある（app/admin/edit/page.tsx）。
        let aborted = false;
        const load = async () => {
            setLoadingPhoto(true);
            try {
                const { userFetch } = await import("../../../lib/utils/api");
                const res = await userFetch("/user/photos");
                if (res.ok) {
                    const all = await res.json() as Photo[];
                    if (aborted) return;
                    // 同じ取得から入力候補も作る（追加の往復はしない）。
                    // 候補が無いせいで同じ場所が別々の名前に散っていた。
                    setOwnValues(collectOwnValues(all));
                    const found = Array.isArray(all) ? all.find((p) => p.id === photoId) ?? null : null;
                    if (found) {
                        setPhoto(found);
                        setOriginal(found);
                        setTitle(titleToText(found.title));
                        setDescription(descToText(found.description));
                        setLocation(found.location ?? "");
                        setCategory(found.category ?? "");
                        // <input type="date"> は YYYY-MM-DD しか受け付けない。
                        // 保存値は ISO 文字列なので、そのまま入れると空欄になる。
                        setDate(toDateInputValue(found.date));
                        setTagsInput(Array.isArray(found.tags) ? found.tags.join(", ") : "");
                    } else {
                        showToastRef.current(isJa ? "写真が見つかりません" : "Photo not found", "error");
                        routerRef.current.push(ROUTES.DRAFTS);
                    }
                } else {
                    if (aborted) return;
                    showToastRef.current(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                    setLoadFailed(true);
                }
            } catch (e) {
                if (aborted) return;
                log.error("edit load error:", e);
                showToastRef.current(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                setLoadFailed(true);
            } finally {
                if (!aborted) setLoadingPhoto(false);
            }
        };
        void load();
        return () => { aborted = true; };
    }, [photoId, isAuthenticated, isAdminUser, isGeneralUser, isJa]);

    /**
     * 写真を消す。**これまで一般ユーザーには消す手段が無かった**——
     * できるのは非公開にすることだけで、S3 の実体（GPS 入りの原本を含む）は
     * 残っていた。サーバー側は DELETE /photos/{id}（api-user）。
     */
    const handleDelete = useCallback(async () => {
        if (!photoId) return;
        setDeleting(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const res = await userFetch(`/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
            if (!res.ok) {
                // サーバーは理由を返す（「画像の削除を完了できませんでした」など）。
                // 押し直せば続きから消えるので、そう読める文言のまま出す。
                showToast(await readApiError(res, isJa ? "削除に失敗しました" : "Failed to delete"), "error");
                return;
            }
            showToast(isJa ? "写真を削除しました" : "Photo deleted", "success");
            router.push(ROUTES.DRAFTS);
        } catch {
            showToast(isJa ? "通信に失敗しました" : "Network error", "error");
        } finally {
            setDeleting(false);
            // **失敗しても閉じない。** サーバーは「押し直せば続きから消える」と
            // 読める理由を返すのに、閉じてしまうとトーストが数秒で消えたあと
            // 最初からやり直すことになる。閉じるのは成功したときだけ
            // （成功時はこの行に来る前に遷移している）。
        }
    }, [photoId, isJa, showToast, router]);

    const save = useCallback(async (published: boolean) => {
        if (!photoId) return;
        setSaving(true);
        try {
            const { userFetch, readApiError } = await import("../../../lib/utils/api");
            const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
            // **実際に変えた項目だけ送る。**
            // 開いた時点の値を毎回全部送っていたので、同じ写真を2タブで開いて
            // 片方で直したあと、もう片方で保存すると**先の編集が黙って消えた**
            // （サーバーは部分更新だが、こちらが全項目を送れば同じこと）。
            // published はボタンの選択そのものなので常に送る。
            const nextFields: Record<string, unknown> = {
                // 英語側が入っていれば残したまま日本語だけ差し替える
                title: mergeLocalizedTitle(original?.title, title),
                description: mergeLocalizedDescription(original?.description, description),
                location,
                category,
                // 日付だけを編集させているので、元の時刻を保つ
                date: mergeDate(original?.date, date),
                tags,
            };
            const originalFields: Record<string, unknown> = {
                title: original?.title,
                description: original?.description,
                location: original?.location ?? "",
                category: original?.category ?? "",
                date: original?.date ?? "",
                tags: Array.isArray(original?.tags) ? original.tags : [],
            };
            const body = { published, ...changedFields(nextFields, originalFields) };

            const res = await userFetch(`/photos/${photoId}`, {
                method: "PUT",
                body: JSON.stringify(body),
            });
            if (res.ok) {
                showToast(
                    published
                        ? (isJa ? "保存しました" : "Saved")
                        : (isJa ? "非公開にしました" : "Unpublished"),
                    "success",
                );
                // 公開したままの保存は写真ページへ戻す。下書き一覧へ落とすと、
                // 直したものを確かめられない（そこには公開写真が出ない）。
                router.push(published && photoId ? ROUTES.PHOTO(photoId) : ROUTES.DRAFTS);
            } else {
                // readApiError に寄せる。自前で本文を読むと、API Gateway の
                // {"message":"Unauthorized"} を拾えず「保存に失敗しました」になる
                showToast(await readApiError(res, isJa ? "保存に失敗しました" : "Save failed"), "error");
            }
        } catch (e) {
            log.error("edit save error:", e);
            const { AUTH_REQUIRED_MESSAGE } = await import("../../../lib/utils/api");
            const authMissing = e instanceof Error && e.message === AUTH_REQUIRED_MESSAGE;
            showToast(authMissing ? AUTH_REQUIRED_MESSAGE : (isJa ? "保存に失敗しました" : "Save failed"), "error");
        } finally {
            setSaving(false);
        }
    }, [photoId, original, title, description, location, category, date, tagsInput, isJa, router, showToast]);

    // 権限が無い人はログイン画面へ送り返さない（/login が押し返して往復する）
    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    if (loading || loadingPhoto) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        );
    }
    // 写真が無いまま何も描かないと、真っ白な画面だけが残る
    // （トーストは消えるので、何が起きたのかも分からない）。
    if (!photo) {
        const message = !photoId
            ? (isJa ? "編集する写真が指定されていません。" : "No photo was specified.")
            : loadFailed
                ? (isJa ? "写真を読み込めませんでした。" : "Could not load this photo.")
                : (isJa ? "写真が見つかりません。" : "Photo not found.");
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
                <div className="text-center">
                    <p className="text-sm text-white/70 mb-4">{message}</p>
                    <Link
                        href={ROUTES.DRAFTS}
                        className="inline-block px-4 py-2.5 text-sm bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-colors"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isJa ? "下書き一覧へ" : "Back to drafts"}
                    </Link>
                </div>
            </main>
        );
    }

    const isDraft = photo.published === false;
    // **公開済みの写真は下書き一覧に戻さない。** この画面は下書き一覧から
    // しか来ない前提で作られていたが、写真ページからも来るようになった。
    // 公開写真を編集したあと「（空かもしれない）下書き一覧」に落とされると、
    // 直したものを確かめられない。
    const backHref = isDraft ? ROUTES.DRAFTS : ROUTES.PHOTO(photo.id);
    const ex = photo.exif ?? {};
    // 撮影日時は生の保存値ではなく整形して出す（他の3か所と同じ）。
    // ここだけ抜けていて "2024-11-01T07:30:00" がそのまま並んでいた。
    const exifSummary = [ex.camera, ex.lens,
        formatStoredDateTime(ex.dateTimeOriginal, locale === "en" ? "en" : "ja")]
        .filter(Boolean).join(" · ");

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8 pb-28">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={backHref} className="text-white/60 hover:text-white transition-colors">
                        <ArrowLeftIcon className="w-5 h-5" />
                    </Link>
                    <h1 className="text-xl font-semibold">
                        {isDraft ? (isJa ? "下書きを編集" : "Edit draft") : (isJa ? "写真を編集" : "Edit photo")}
                    </h1>
                </div>

                {photo.src && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={photo.thumbSrc || photo.src}
                        alt=""
                        className="w-full max-h-64 object-contain rounded-lg mb-3 bg-white/5"
                    />
                )}
                {exifSummary && (
                    <p className="text-xs text-white/40 mb-6">{isJa ? "撮影情報（自動）: " : "EXIF (auto): "}{exifSummary}</p>
                )}

                <form onSubmit={(e) => { e.preventDefault(); void save(true); }} className="space-y-5">
                    <div>
                        <label className={labelCls}>{isJa ? "タイトル" : "Title"}</label>
                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                            className={inputCls} style={{ fontSize: "16px" }}
                            placeholder={isJa ? "任意" : "Optional"} />
                    </div>

                    <div>
                        <label className={labelCls}>{isJa ? "説明" : "Description"}</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                            rows={5} className={inputCls + " resize-y"} style={{ fontSize: "16px" }}
                            placeholder={isJa ? "任意（改行で段落）" : "Optional (newline = paragraph)"} />
                    </div>

                    <div className="grid grid-cols-2 gap-4 [&>div]:min-w-0">
                        <div>
                            <label className={labelCls}>{isJa ? "場所" : "Location"}</label>
                            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                                list="own-locations"
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "任意" : "Optional"} />
                            {/* 前に使った値を候補に出す（選ばずに自由入力もできる） */}
                            <datalist id="own-locations">
                                {ownValues.locations.map((v) => <option key={v} value={v} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "カテゴリ" : "Category"}</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                                list="own-categories"
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "例: 風景" : "e.g. Landscape"} />
                            <datalist id="own-categories">
                                {ownValues.categories.map((v) => <option key={v} value={v} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "撮影日" : "Date"}</label>
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "タグ（カンマ区切り）" : "Tags (comma separated)"}</label>
                            <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "自然, 山" : "nature, mountain"} />
                            {/* タグはカンマ区切りなので datalist が効かない（欄全体を
                                置き換えてしまう）。押して足せるチップにする。 */}
                            {ownValues.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {ownValues.tags.slice(0, 12).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTagsInput((cur) => appendTag(cur, t))}
                                            className="px-2 py-0.5 rounded-full bg-white/5 ring-1 ring-white/10 text-xs text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
                                            style={{ touchAction: "manipulation" }}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </form>
            </div>

            {/* 削除確認。取り消せない操作なので、装飾を減らして文字で選ばせる
                （app/components/stories/StoryViewer.tsx と同じ形） */}
            {confirmDelete && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-3 pb-3 sm:pb-0"
                    onClick={() => !deleting && setConfirmDelete(false)}
                    role="dialog"
                    aria-modal="true"
                >
                    <div className="w-full max-w-[340px] space-y-2" onClick={(e) => e.stopPropagation()}>
                        <div className="rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl overflow-hidden">
                            <p className="px-4 py-3.5 text-center text-[13px] text-white/55 leading-snug">
                                {isJa
                                    ? "この写真を削除します。画像とコメントも消え、この操作は取り消せません。"
                                    : "This photo will be deleted along with its image, comments and likes. This can't be undone."}
                            </p>
                            <button
                                type="button"
                                onClick={() => void handleDelete()}
                                disabled={deleting}
                                className="w-full py-3.5 border-t border-white/10 text-[#ff453a] text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ touchAction: "manipulation" }}
                            >
                                {deleting && <div className="w-3.5 h-3.5 border-2 border-[#ff453a]/40 border-t-[#ff453a] rounded-full animate-spin" />}
                                {isJa ? "削除" : "Delete"}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            disabled={deleting}
                            className="w-full py-3.5 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white text-[17px] font-semibold hover:bg-white/5 active:bg-white/10 transition disabled:opacity-50"
                            style={{ touchAction: "manipulation" }}
                        >
                            {isJa ? "キャンセル" : "Cancel"}
                        </button>
                    </div>
                </div>
            )}

            {/* 固定アクションバー: 削除 / 下書き保存 / 公開する */}
            <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40">
                <div className="max-w-2xl mx-auto flex items-center gap-2">
                    {/* 削除は左端に離して置く。保存系と並べると押し間違える */}
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        disabled={saving || deleting}
                        className="px-4 py-3 text-[#ff453a] text-sm font-semibold rounded-full ring-1 ring-[#ff453a]/30 hover:bg-[#ff453a]/10 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isJa ? "削除" : "Delete"}
                    </button>
                    <div className="flex-1" />
                    {/* **公開済みの写真に「下書き保存」を出さない。**
                        一番「保存」に見えるボタンが published:false を送るので、
                        押すと**公開中の写真が黙って非公開になり検索から消える**
                        （作り直しまで走る）。下書きのときだけ出す。 */}
                    <button
                        type="button"
                        onClick={() => void save(false)}
                        disabled={saving}
                        className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-full ring-1 ring-white/15 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isDraft ? (isJa ? "下書き保存" : "Save draft") : (isJa ? "非公開にする" : "Unpublish")}
                    </button>
                    <button
                        type="button"
                        onClick={() => void save(true)}
                        disabled={saving}
                        className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {saving
                            ? (isJa ? "保存中…" : "Saving…")
                            : isDraft ? (isJa ? "公開する" : "Publish") : (isJa ? "保存する" : "Save")}
                    </button>
                </div>
            </div>
        </main>
    );
}

export default function UserEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
        }>
            <EditContent />
        </Suspense>
    );
}
