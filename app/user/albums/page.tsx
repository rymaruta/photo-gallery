"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { useMemberGate } from "../../../lib/hooks/useMemberGate";
import MemberOnlyNotice from "../../components/MemberOnlyNotice";
import { userFetch, readApiError, sessionErrorMessage } from "../../../lib/utils/api";
import { ROUTES } from "../../../lib/routes";

/**
 * 共同アルバム（案C）の管理。作る・招待リンクを配る・取り消す。
 *
 * **招待リンクはアルバムに1本。** 発行し直すと前のリンクは取り消される
 * （サーバー側でそうしている）。ここではその事実を画面にも書く——
 * 「もう一度発行したら前のが切れる」ことが分からないと、配ったリンクが
 * 黙って死ぬ。
 */

type Album = {
    id: string;
    title: string;
    memberCount: number;
    inviteToken?: string;
    inviteExpiresAt?: string;
};

/** 招待リンクの絶対URL。**この形（`/j?t=`）はサーバーと画面で対** */
const inviteUrl = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/j?t=${encodeURIComponent(token)}`;

export default function AlbumsPage() {
    const { locale } = useLocale();
    const { showToast } = useToast();
    const gate = useMemberGate();

    const [albums, setAlbums] = useState<Album[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await userFetch("/albums");
            if (!res.ok) {
                setLoadError(await readApiError(res, "アルバムを読み込めませんでした"));
                setAlbums([]);
                return;
            }
            const data = await res.json() as { albums?: Album[] };
            setAlbums(Array.isArray(data.albums) ? data.albums : []);
            setLoadError("");
        } catch (e) {
            // 圏外とセッション切れを混ぜない
            setLoadError(sessionErrorMessage(e) ?? "アルバムを読み込めませんでした");
            setAlbums([]);
        }
    }, []);

    useEffect(() => { if (gate === "ok") void load(); }, [gate, load]);

    const create = useCallback(async () => {
        const name = title.trim();
        if (!name || busy) return;
        setBusy(true);
        try {
            const res = await userFetch("/albums", { method: "POST", body: JSON.stringify({ title: name }) });
            if (!res.ok) {
                showToast(await readApiError(res, "アルバムを作れませんでした"), "error");
                return;
            }
            setTitle("");
            await load();
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "アルバムを作れませんでした", "error");
        } finally {
            setBusy(false);
        }
    }, [title, busy, load, showToast]);

    const issue = useCallback(async (albumId: string) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(albumId)}/invite`, { method: "POST" });
            if (!res.ok) {
                showToast(await readApiError(res, "招待リンクを作れませんでした"), "error");
                return;
            }
            await load();
            showToast("招待リンクを作りました。前のリンクは使えなくなります", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "招待リンクを作れませんでした", "error");
        } finally {
            setBusy(false);
        }
    }, [busy, load, showToast]);

    const revoke = useCallback(async (albumId: string) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(albumId)}/invite`, { method: "DELETE" });
            if (!res.ok) {
                showToast(await readApiError(res, "取り消せませんでした"), "error");
                return;
            }
            await load();
            showToast("招待リンクを取り消しました", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "取り消せませんでした", "error");
        } finally {
            setBusy(false);
        }
    }, [busy, load, showToast]);

    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    if (gate !== "ok") {
        return (
            <main className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white px-4 py-8">
            <div className="max-w-2xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <Link href={ROUTES.HOME} aria-label="戻る" className="text-white/70">
                        <ArrowLeftIcon className="w-5 h-5" aria-hidden="true" />
                    </Link>
                    <h1 className="text-lg">共同アルバム</h1>
                </div>

                <p className="text-xs text-white/60 mb-6">
                    旅の同行者に招待リンクを配ると、同じアルバムに写真を足してもらえます。
                    リンクを開くだけならログインは要りません。
                </p>

                <div className="flex gap-2 mb-8">
                    <label htmlFor="album-title" className="sr-only">アルバムの名前</label>
                    <input
                        id="album-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={60}
                        placeholder="例: 北欧の冬"
                        className="flex-1 bg-white/5 rounded-lg px-3 py-2 text-sm ring-1 ring-white/10"
                    />
                    <button
                        type="button"
                        onClick={create}
                        aria-disabled={busy || !title.trim()}
                        className="rounded-lg bg-white text-black text-sm px-4"
                        style={{ minHeight: 44 }}
                    >
                        作る
                    </button>
                </div>

                {loadError && <p role="alert" className="text-sm text-white/85 mb-4">{loadError}</p>}

                {albums === null ? (
                    <p className="text-sm text-white/60" aria-live="polite">読み込み中…</p>
                ) : albums.length === 0 ? (
                    <p className="text-sm text-white/60">まだアルバムがありません。</p>
                ) : (
                    <ul className="space-y-4">
                        {albums.map((a) => (
                            <li key={a.id} className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
                                <p className="text-sm">{a.title}</p>
                                <p className="text-xs text-white/60 mt-0.5">{a.memberCount}人が参加</p>

                                {a.inviteToken ? (
                                    <div className="mt-3">
                                        <p className="text-[11px] text-white/50">招待リンク</p>
                                        <p className="text-xs break-all text-white/85 mt-0.5">{inviteUrl(a.inviteToken)}</p>
                                        {a.inviteExpiresAt && (
                                            <p className="text-[11px] text-white/50 mt-1">
                                                {new Date(a.inviteExpiresAt).toLocaleDateString("ja-JP")}まで
                                            </p>
                                        )}
                                        <div className="flex gap-3 mt-2">
                                            <button type="button" onClick={() => issue(a.id)} aria-disabled={busy}
                                                className="text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                                作り直す
                                            </button>
                                            <button type="button" onClick={() => revoke(a.id)} aria-disabled={busy}
                                                className="text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                                取り消す
                                            </button>
                                        </div>
                                        {/* **前のリンクが死ぬことを書く。** 書かないと、配ったリンクが黙って切れる */}
                                        <p className="text-[11px] text-white/50 mt-1">作り直すと、前のリンクは使えなくなります。</p>
                                    </div>
                                ) : (
                                    <button type="button" onClick={() => issue(a.id)} aria-disabled={busy}
                                        className="mt-3 text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                        招待リンクを作る
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </main>
    );
}
