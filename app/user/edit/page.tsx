"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
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
import { changedFields } from "../../../lib/utils/changedFields";

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

    const [photo, setPhoto] = useState<Photo | null>(null);
    const [loadingPhoto, setLoadingPhoto] = useState(true);
    // 読み込みに失敗したか。トーストは数秒で消えるので、画面にも残す。
    const [loadFailed, setLoadFailed] = useState(false);
    // 読み込んだ元データ。編集欄に出していない項目（英語のタイトル・説明、
    // 撮影日の時刻）を保存時に失わないために持っておく。
    const [original, setOriginal] = useState<Photo | null>(null);
    const [saving, setSaving] = useState(false);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [location, setLocation] = useState("");
    const [category, setCategory] = useState("");
    const [date, setDate] = useState("");
    const [tagsInput, setTagsInput] = useState("");

    // 認証ゲート（一般ユーザー or 管理者）。upload ページと同じ方針。
    useEffect(() => {
        if (!loading && (!isAuthenticated || (!isAdminUser && !isGeneralUser))) {
            router.push(ROUTES.LOGIN);
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

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
                        showToast(isJa ? "写真が見つかりません" : "Photo not found", "error");
                        router.push(ROUTES.DRAFTS);
                    }
                } else {
                    if (aborted) return;
                    showToast(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                    setLoadFailed(true);
                }
            } catch (e) {
                if (aborted) return;
                log.error("edit load error:", e);
                showToast(isJa ? "読み込みに失敗しました" : "Failed to load", "error");
                setLoadFailed(true);
            } finally {
                if (!aborted) setLoadingPhoto(false);
            }
        };
        void load();
        return () => { aborted = true; };
    }, [photoId, isAuthenticated, isAdminUser, isGeneralUser, router, showToast, isJa]);

    const save = useCallback(async (published: boolean) => {
        if (!photoId) return;
        setSaving(true);
        try {
            const { userFetch } = await import("../../../lib/utils/api");
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
                        ? (isJa ? "公開しました" : "Published")
                        : (isJa ? "下書きを保存しました" : "Draft saved"),
                    "success",
                );
                router.push(ROUTES.DRAFTS);
            } else {
                const err = await res.json().catch(() => ({})) as { error?: string };
                showToast(err.error ?? (isJa ? "保存に失敗しました" : "Save failed"), "error");
            }
        } catch (e) {
            log.error("edit save error:", e);
            showToast(isJa ? "保存に失敗しました" : "Save failed", "error");
        } finally {
            setSaving(false);
        }
    }, [photoId, original, title, description, location, category, date, tagsInput, isJa, router, showToast]);

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
    const ex = photo.exif ?? {};
    const exifSummary = [ex.camera, ex.lens, ex.dateTimeOriginal].filter(Boolean).join(" · ");

    return (
        <main className="min-h-screen bg-black text-white">
            <div className="max-w-2xl mx-auto px-4 py-8 pb-28">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={ROUTES.DRAFTS} className="text-white/60 hover:text-white transition-colors">
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
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "任意" : "Optional"} />
                        </div>
                        <div>
                            <label className={labelCls}>{isJa ? "カテゴリ" : "Category"}</label>
                            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                                className={inputCls} style={{ fontSize: "16px" }} placeholder={isJa ? "例: 風景" : "e.g. Landscape"} />
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
                        </div>
                    </div>
                </form>
            </div>

            {/* 固定アクションバー: 下書き保存 / 公開する */}
            <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-white/10 p-4 z-40">
                <div className="max-w-2xl mx-auto flex items-center gap-2 justify-end">
                    <button
                        type="button"
                        onClick={() => void save(false)}
                        disabled={saving}
                        className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-full ring-1 ring-white/15 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {isJa ? "下書き保存" : "Save draft"}
                    </button>
                    <button
                        type="button"
                        onClick={() => void save(true)}
                        disabled={saving}
                        className="px-6 py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 transition-colors disabled:opacity-40"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {saving ? (isJa ? "保存中…" : "Saving…") : (isJa ? "公開する" : "Publish")}
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
