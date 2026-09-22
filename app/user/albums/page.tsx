"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
    const [albums, setAlbums] = useState<Album[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);
    /** 名前を変えている最中のアルバム（id → 入力中の名前） */
    const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);

    /**
     * 打ちかけがあるか。**送り返す前に見る。**
     *
     * この画面にも打って入れる欄が2つある——新規アルバムの名前と、
     * 改名の欄。どちらもボタンでしか送らないので、別タブでログアウト
     * すると `router.replace` が画面ごと作り直して**打った名前が消える**。
     * `/user/profile` で同じものを直した回に、ここを取りこぼしていた
     * （「横断で探した」と書いておきながら3件目を見落としていた）。
     *
     * 改名は「開いただけ」を打ちかけに数えない——開くときに元の名前を
     * そのまま入れるので、変わっていなければ守るものが無い。
     */
    const hasUnsavedWork = title.trim() !== ""
        || (!!editing && editing.title.trim()
            !== (albums?.find((a) => a.id === editing.id)?.title ?? "").trim());

    const gate = useMemberGate(hasUnsavedWork);

    /**
     * **留めたぶん、保存できないことを伝える。** 送り返さないだけで黙って
     * いると、「作る」を押しても失敗し続ける画面に取り残される。
     * 一度だけ出す（`/user/edit` `/user/upload` `/user/profile` と同じ形）
     */
    // **札そのものは縛れていない。** 消しても落ちるテストが無い
    // （レビューが変異で実証）。ただし**等価だと断定もしていない**——
    // deps（`gate` / `hasUnsavedWork` / `locale` / `showToast`）は全部
    // 値が安定していて（`showToast` は `useCallback([])`）、
    // 打ちかけが false に戻る回は `useMemberGate` が送り返すので、
    // **この画面で2回出る経路を作れなかった**。他3画面と揃える意味で残す。
    // 直前に「等価だから縛らない」と書いて外した判断が誤りだった
    // （`type="url"` は ASCII の空白しか落とさない）ので、
    // **断定は書かない**
    const toldSignedOut = useRef(false);
    useEffect(() => {
        // ログインし直したら札を下ろす（二度目を無言にしない）
        if (gate === "ok") { toldSignedOut.current = false; return; }
        // **ログインしているが権限が無い人に、ログインの話をしない。**
        //
        // `gate !== "ok"` で書いていたので `no-group` と `loading` にも
        // 出ていた。`no-group` の人は**ログインしている**うえ、
        // `useMemberGate` 自身が「グループを入れ直す経路はアプリのどこにも
        // 無い。再ログインでも直らない」と書いている——`MemberOnlyNotice`
        // の上に**絶対に効かない対処法**を重ねることになる。
        // しかも札は `ok` でしか下りないので、1回誤射すると**本物の
        // ログイン切れが無言**になる。
        //
        // `/user/edit:486` が同じ1行を持ち、それを守るテストのコメントに
        // 「この campaign で3回出ている」と書いてある。**4回目をやった。**
        if (gate !== "anonymous" || !hasUnsavedWork || toldSignedOut.current) return;
        toldSignedOut.current = true;
        showToast(locale === "en"
            ? "You are signed out. This can't be saved yet — sign in again in another tab, then try again."
            : "ログインが切れました。この内容は保存できません。別のタブでログインし直してから、もう一度お試しください", "error");
    }, [gate, hasUnsavedWork, locale, showToast]);
    /** 消す前に一度聞く。**押し間違いで消させない**（削除は元に戻せない） */
    const [confirming, setConfirming] = useState<Album | null>(null);

    const load = useCallback(async () => {
        // **失敗を「0件」に潰さない。**
        //
        // `setAlbums([])` していたので、赤いエラーと「まだアルバムが
        // ありません。」が**同時に出て**いた——持っているアルバムが
        // 消えたように読める。同じリポジトリの `FollowingSheet` が
        // 「`[]` に潰すと『0人』と『壊れた応答』が混ざる」と書いていて、
        // `NotificationsBell` も `drafts` も同じ判断をしている。
        // ここだけ逆をやっていた。`null` のままにすれば
        // 「読み込み中…」でも「0件」でもなく、失敗の1行だけが出る
        try {
            const res = await userFetch("/albums");
            if (!res.ok) {
                setLoadError(await readApiError(res, "アルバムを読み込めませんでした"));
                return;
            }
            const data = await res.json() as { albums?: Album[] };
            setAlbums(Array.isArray(data.albums) ? data.albums : []);
            setLoadError("");
        } catch (e) {
            // 圏外とセッション切れを混ぜない
            setLoadError(sessionErrorMessage(e) ?? "アルバムを読み込めませんでした");
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

    const rename = async () => {
        if (!editing || busy) return;
        const name = editing.title.trim();
        if (!name) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(editing.id)}`, {
                method: "PATCH", body: JSON.stringify({ title: name }),
            });
            if (!res.ok) {
                showToast(await readApiError(res, "名前を変えられませんでした"), "error");
                return;
            }
            setEditing(null);
            await load();
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "名前を変えられませんでした", "error");
        } finally {
            setBusy(false);
        }
    };

    const remove = async (a: Album) => {
        if (busy) return;
        setBusy(true);
        try {
            const res = await userFetch(`/albums/${encodeURIComponent(a.id)}`, { method: "DELETE" });
            if (!res.ok) {
                showToast(await readApiError(res, "消せませんでした"), "error");
                return;
            }
            setConfirming(null);
            await load();
            showToast("アルバムを消しました（写真は残ります）", "success");
        } catch (e) {
            showToast(sessionErrorMessage(e) ?? "消せませんでした", "error");
        } finally {
            setBusy(false);
        }
    };

    if (gate === "no-group") return <MemberOnlyNotice locale={locale} />;
    // **送り返さないと決めた回は、画面も出す。**
    //
    // ここでスピナーに落とすと、打ちかけを守るために送り返さなかった意味が
    // 無い——**見えないまま止まるだけ**で、打った名前は state に残っていても
    // 読むことも直すこともできない。`/user/upload:1016` のコメントが
    // この形を名指しで戒めているのに、**その戒めを読まずに同じ形を作った**
    // （借りたのは `useMemberGate` の引数だけで、その引数が前提にしている
    //   「画面も出す」を持ってこなかった）
    if (gate !== "ok" && !hasUnsavedWork) {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">共同アルバム</h1>
                <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-bg text-white px-4 py-8">
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
                    {/* 🔴 **`aria-disabled` だけにしない。** 以前はこれで、
                        名前が空でも**見た目はそのまま押せて、押しても何も
                        起きなかった**（`create` が黙って return する）。
                        知らせも無いので「壊れている」としか見えない。
                        この画面だけが外れていた——`/user/highlights` の保存・
                        `/user/settings` のパスワード変更・`ReportDialog` の
                        送信は、どれも**本物の `disabled` ＋ 薄くする**で、
                        押せないことが目で分かる。そちらに揃える
                        （見張り: `app/user/albums/__tests__/`） */}
                    <button
                        type="button"
                        onClick={create}
                        disabled={busy || !title.trim()}
                        className="rounded-lg bg-accent-fill text-white text-sm px-4 disabled:opacity-50"
                        style={{ minHeight: 44 }}
                    >
                        作る
                    </button>
                </div>

                {/* **再試行の口を出す。** `load()` は `gate` が変わったときしか
                    走らないので、無いとページを開き直すしかなかった
                    （`drafts` は再試行ボタンを持っている） */}
                {loadError && (
                    <div className="mb-4">
                        <p role="alert" className="text-sm text-white/85">{loadError}</p>
                        <button
                            type="button"
                            onClick={() => { setLoadError(""); void load(); }}
                            className="mt-2 px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
                            style={{ touchAction: "manipulation" }}
                        >
                            {locale === "en" ? "Retry" : "もう一度読み込む"}
                        </button>
                    </div>
                )}

                {albums === null ? (
                    // 失敗した回は「読み込み中…」を出さない（上の1行が説明する）
                    loadError ? null : <p className="text-sm text-white/60" aria-live="polite">読み込み中…</p>
                ) : albums.length === 0 ? (
                    <p className="text-sm text-white/60">まだアルバムがありません。</p>
                ) : (
                    <ul className="space-y-4">
                        {albums.map((a) => (
                            <li key={a.id} className="rounded-xl bg-white/5 ring-1 ring-white/10 p-4">
                                {editing?.id === a.id ? (
                                    <div className="flex gap-2">
                                        <label htmlFor={`rename-${a.id}`} className="sr-only">アルバムの新しい名前</label>
                                        <input
                                            id={`rename-${a.id}`}
                                            value={editing.title}
                                            onChange={(e) => setEditing({ id: a.id, title: e.target.value })}
                                            maxLength={60}
                                            className="flex-1 bg-white/5 rounded-lg px-3 py-2 text-sm ring-1 ring-white/10"
                                        />
                                        {/* **空の名前でも押せて無反応**だった
                                            （`rename` は `!name` で黙って return するのに、
                                            ここは `busy` しか見ていなかった）。条件を揃える */}
                                        <button type="button" onClick={rename} disabled={busy || !editing.title.trim()}
                                            className="rounded-lg bg-accent-fill text-white text-sm px-3 disabled:opacity-50" style={{ minHeight: 44 }}>
                                            保存
                                        </button>
                                        <button type="button" onClick={() => setEditing(null)}
                                            className="text-xs text-white/70 px-2" style={{ minHeight: 44 }}>
                                            やめる
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm">{a.title}</p>
                                            <p className="text-xs text-white/60 mt-0.5">{a.memberCount}人が参加</p>
                                        </div>
                                        <div className="flex gap-3 shrink-0">
                                            <button type="button" onClick={() => setEditing({ id: a.id, title: a.title })}
                                                className="text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                                名前を変える
                                            </button>
                                            <button type="button" onClick={() => setConfirming(a)}
                                                className="text-xs underline decoration-white/40 underline-offset-2" style={{ minHeight: 44 }}>
                                                消す
                                            </button>
                                        </div>
                                    </div>
                                )}

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
                                            <button type="button" onClick={() => issue(a.id)} disabled={busy}
                                                className="text-xs underline decoration-white/40 underline-offset-2 disabled:opacity-50" style={{ minHeight: 44 }}>
                                                作り直す
                                            </button>
                                            <button type="button" onClick={() => revoke(a.id)} disabled={busy}
                                                className="text-xs underline decoration-white/40 underline-offset-2 disabled:opacity-50" style={{ minHeight: 44 }}>
                                                取り消す
                                            </button>
                                        </div>
                                        {/* **前のリンクが死ぬことを書く。** 書かないと、配ったリンクが黙って切れる */}
                                        <p className="text-[11px] text-white/50 mt-1">作り直すと、前のリンクは使えなくなります。</p>
                                    </div>
                                ) : (
                                    <button type="button" onClick={() => issue(a.id)} disabled={busy}
                                        className="mt-3 text-xs underline decoration-white/40 underline-offset-2 disabled:opacity-50" style={{ minHeight: 44 }}>
                                        招待リンクを作る
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {/* **消す前に一度聞く。** 削除は元に戻せない。
                    「写真は残る」ことも書く——アルバムは束ねているだけで、
                    写真そのものは投稿した人のもの */}
                {confirming && (
                    <div role="dialog" aria-modal="true" aria-label="アルバムを消す"
                        className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
                        <div className="bg-surface-2 rounded-2xl ring-1 ring-white/10 p-5 max-w-sm w-full">
                            <p className="text-sm">「{confirming.title}」を消しますか？</p>
                            <p className="text-xs text-white/60 mt-2">
                                招待リンクは使えなくなり、参加者はこのアルバムを開けなくなります。
                                <strong className="text-white/85">写真そのものは消えません。</strong>
                            </p>
                            <div className="flex gap-2 justify-end mt-5">
                                <button type="button" onClick={() => setConfirming(null)}
                                    className="text-sm px-4" style={{ minHeight: 44 }}>やめる</button>
                                <button type="button" onClick={() => remove(confirming)} disabled={busy}
                                    className="rounded-lg bg-accent-fill text-white text-sm px-4 disabled:opacity-50" style={{ minHeight: 44 }}>
                                    消す
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
