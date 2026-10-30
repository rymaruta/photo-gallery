"use client";

// 写真ページのコメント欄。公開閲覧、認証ユーザーが投稿でき、
// 投稿者本人または写真オーナーが削除できる。

import { FIELD } from "./fieldStyles";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ChatBubbleOvalLeftIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useComments } from "../../lib/hooks/useComments";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";
import { loginWithNext } from "../../lib/routes";

type Props = {
    photoId: string;
    photoOwnerId?: string;
    locale: "ja" | "en";
    initialCount?: number;
};

function timeAgo(iso: string, locale: "ja" | "en"): string {
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return locale === "en" ? "today" : "今日";
    if (days === 1) return locale === "en" ? "yesterday" : "昨日";
    return locale === "en" ? `${days}d ago` : `${days}日前`;
}

/**
 * @param hideHeading 親がタブ（「コメント (N)」）で見出しを持つときに true。
 * @param onCountChange 件数が変わったら親へ（タブの数字を更新する）
 */
export default function CommentSection({ photoId, photoOwnerId, locale, initialCount = 0, hideHeading = false, onCountChange }: Props & { hideHeading?: boolean; onCountChange?: (n: number) => void }) {
    // ログイン後にこの写真へ戻す（サイト内パスだけを通す safeNextPath 経由）。
    // 戻り先が無いと、コメントしようとしていた写真を見失う。
    const loginHref = typeof window === "undefined"
        ? ROUTES.LOGIN
        : loginWithNext(window.location.pathname + window.location.search);
    // authLoading = ログイン状態がまだ分からない期間。ここを見ないと、
    // ログイン済みの人にも一瞬「ログインするとコメントできます」が出て、
    // その間にリンクを押すとログインページ経由で別の場所へ飛ばされる。
    const { isAuthenticated, userId, loading: authLoading } = useAuth();
    const { showToast } = useToast();
    const { items, count, loading, loadError, reload, pending, add, remove } = useComments(photoId, isAuthenticated, initialCount, authLoading);
    const [text, setText] = useState("");
    useEffect(() => { onCountChange?.(count); }, [count, onCountChange]);

    // **送ったコメントを見せる**（2026-10-21 判断）。並びは iOS と同じ新しい順（先頭）のまま——
    // 入力欄は下に貼ってあるので、送った1件が画面の外（上）に出ることがある。送れたら先頭の1件を
    // 画面内へ送り（`block: "nearest"`＝見えていれば動かさない。動きを減らす設定なら滑らせない）、
    // 読み上げには「送りました」を1回だけ出す
    const listRef = useRef<HTMLUListElement | null>(null);
    const [postedTick, setPostedTick] = useState(0);
    // 読み上げの文は送れた回数から決める。続けて送ったときに同じ文だと読み上げが黙るので、
    // 回ごとに末尾の見えない空白を付け外しする
    const announce = postedTick === 0 ? ""
        : `${locale === "en" ? "Comment posted" : "コメントを送りました"}${postedTick % 2 === 0 ? "\u00A0" : ""}`;
    useEffect(() => {
        if (postedTick === 0) return;
        const first = listRef.current?.firstElementChild as HTMLElement | null | undefined;
        let reduced = false;
        try { reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { /* 動かす */ }
        first?.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }, [postedTick]);

    const submit = async () => {
        const r = await add(text);
        if (r.status === "ok") {
            setText("");
            setPostedTick((n) => n + 1);
        }
        else if (r.status === "auth-required") showToast(locale === "en" ? "Log in to comment" : "コメントするにはログインしてください", "info");
        // 断られた理由はサーバーが日本語で返している
        // （「同じ写真へのコメントは10件までです」など）。
        // 一律「投稿に失敗しました」だと障害だと思って送り直され、
        // そのたびに写真と200件のコメント文書を読み直すことになる。
        //
        // 理由は `add` の**戻り値**から取る。フックの state から読むと、
        // この関数が作られた描画時点の値——つまり1回前の理由——になり、
        // 初回は必ず既定文、2回目に1回目の文言、とずれる。
        else if (r.status === "error") {
            showToast(r.message ?? (locale === "en" ? "Failed to post" : "投稿に失敗しました"), "error");
        }
    };

    return (
        <section className={hideHeading ? "" : "pt-5 border-t border-line"}>
            <div className="flex items-center gap-1.5 mb-3" hidden={hideHeading}>
                <ChatBubbleOvalLeftIcon className="w-4 h-4 text-white/50" />
                <h2 className="text-sm font-semibold text-white/70">
                    {locale === "en" ? "Comments" : "コメント"}
                    {count > 0 && <span className="ml-1.5 text-white/50 tabular-nums">{count}</span>}
                </h2>
            </div>

            {/* 一覧 */}
            {/* 読み込み中・失敗・0件は共通の形（`StateViews`・iOS の `ErrorBanner` と同じ並び） */}
            {loading ? (
                <LoadingState kind="rows" locale={locale} testId="comments-loading" />
            ) : loadError ? (
                // 取得の失敗を「0件」と混ぜない。付いているコメントが
                // 消えたように見える（admin 一覧・下書き一覧と同じ扱い）
                <ErrorState
                    message={locale === "en" ? "Couldn't load comments." : "コメントを読み込めませんでした。"}
                    onRetry={reload}
                    locale={locale}
                    testId="comments-error"
                />
            ) : items.length === 0 ? (
                <EmptyState
                    message={locale === "en" ? "No comments yet. Be the first!" : "まだコメントがありません。最初のひとことを。"}
                    testId="comments-empty"
                />
            ) : (
                <ul ref={listRef} className="space-y-3.5">
                    {items.map((c) => {
                        const canDelete = isAuthenticated && (c.uid === userId || (photoOwnerId && photoOwnerId === userId));
                        return (
                            <li key={c.id} className="flex items-start gap-2.5">
                                {/* 退会した人のプロフィールはもう無い（墓石になり、
                                    公開APIは空を返す）。リンクを出すと「開いても
                                    何も無いページ」へ誘うので、名前とアイコンだけ出す。 */}
                                {c.deleted ? (
                                    <span className="flex-shrink-0 mt-0.5">
                                        <UserAvatar userId="" className="w-7 h-7" iconClassName="w-4 h-4" />
                                    </span>
                                ) : (
                                    <Link href={ROUTES.USER_PROFILE(c.uid)} prefetch={false} className="flex-shrink-0 mt-0.5">
                                        <UserAvatar userId={c.uid} className="w-7 h-7" iconClassName="w-4 h-4" />
                                    </Link>
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        {c.deleted ? (
                                            <span className="text-[13px] font-semibold text-white/50 truncate">
                                                {c.name}
                                            </span>
                                        ) : (
                                            <Link href={ROUTES.USER_PROFILE(c.uid)} prefetch={false} className="text-[13px] font-semibold text-white/85 hover:underline truncate">
                                                {c.name}
                                            </Link>
                                        )}
                                        <span className="text-[12px] text-white/50 flex-shrink-0">{timeAgo(c.t, locale)}</span>
                                        {canDelete && (
                                            <button
                                                onClick={() => void remove(c.id).then((ok) => {
                                                    // 失敗すると楽観削除がロールバックし、
                                                    // コメントが一瞬消えて黙って戻る。投稿は
                                                    // 理由を出すのに削除だけ無言だった（SW-b3）
                                                    if (!ok) showToast(locale === "en"
                                                        ? "Couldn't delete the comment. Please try again."
                                                        : "コメントを削除できませんでした。もう一度お試しください", "error");
                                                })}
                                                aria-label={locale === "en" ? "Delete comment" : "コメントを削除"}
                                                className="ml-auto flex-shrink-0 p-1 text-white/40 hover:text-danger transition"
                                                style={{ touchAction: "manipulation" }}
                                            >
                                                <TrashIcon className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-sm text-white/80 whitespace-pre-wrap break-words leading-snug mt-0.5">{c.text}</p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {/* 入力欄。**画面の下に貼る**（iOS の写真の詳細と同じ・2026-10-21）。一覧の後ろに置き、
                コメントの段が画面に入っている間は下の案内（`BottomNav`・`--bottom-bar-h`）の**すぐ上**に
                留まる——下の案内と重ならない。段を過ぎれば一緒に流れる（`sticky`）。
                **ログインしていない人にも同じ場所に「ログインしてコメント」**（44 の当たり）。
                **再生バー（`MiniPlayer`）が出ている間はそのぶん上がる**（`--mini-player-h`・2026-10-21 判断）。
                同じ所に重なり、入力欄が再生バーの裏に入っていた */}
            <div
                data-testid="comment-composer"
                className="sticky z-30 mt-4 -mx-4 px-4 lg:mx-0 lg:px-0 pt-2.5 pb-2.5 bg-bg/95 backdrop-blur border-t border-line"
                style={{ bottom: "calc(var(--bottom-bar-h, calc(max(22px, env(safe-area-inset-bottom, 0px)) + 62px)) + var(--mini-player-h, 0px))" }}
            >
            {isAuthenticated ? (
                <div className="flex items-end gap-2">
                    {/* **Ctrl/Cmd+Enter に IME のガードは付けない。**
                        変換確定に使われるのは Enter 単体で、修飾キー付きは
                        IME が消費しない。それでも `isComposing` は
                        「そのとき変換が生きているか」だけを見るので、
                        変換の要らない語（「ありがとう」）を打ち終えた直後は
                        true のまま——ガードを付けると**送信が黙って死ぬ**。
                        `onChange` は変換中も発火するので `text` は画面と
                        一致しており、押した時点で見えている文字を送るのが正しい。
                        （一度ガードを付けて、レビューで実測されて外した） */}
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
                        placeholder={locale === "en" ? "Add a comment…" : "コメントを追加…"}
                        rows={1}
                        maxLength={500}
                        aria-label={locale === "en" ? "Comment" : "コメント"}
                        className={`flex-1 min-w-0 px-[14px] py-[9px] resize-none ${FIELD}`}
                        style={{ fontSize: "16px", minHeight: "44px", maxHeight: "120px", lineHeight: "26px" }}
                    />
                    <button
                        onClick={() => void submit()}
                        disabled={pending || !text.trim()}
                        className="flex-shrink-0 px-4 py-2 bg-accent-fill text-ink text-sm font-semibold rounded-full hover:brightness-110 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ touchAction: "manipulation", minHeight: "44px" }}
                    >
                        {pending
                            ? <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            : (locale === "en" ? "Post" : "送信")}
                    </button>
                </div>
            ) : authLoading ? (
                // 判定中は入力欄の高さだけ確保する。ここで「ログインしてください」を
                // 出すと、ログイン済みの人にも一瞬表示されて誤操作を誘う。
                <div className="h-[44px]" aria-hidden={true} />
            ) : (
                // 戻り先を添える。無いとログイン後に自分のプロフィールへ
                // 飛ばされ、コメントしようとしていた写真を見失う。
                // 見た目は入力欄の形（押すとログインへ）。写真のある画面なので真鍮の塗りにしない
                <Link
                    href={loginHref}
                    prefetch={false}
                    data-testid="comment-login"
                    className="flex items-center w-full rounded-full bg-surface-2 ring-1 ring-inset ring-line-strong px-4 text-text-2 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    style={{ minHeight: "44px", fontSize: "15px", touchAction: "manipulation" }}
                >
                    {locale === "en" ? "Log in to comment" : "ログインしてコメント"}
                </Link>
            )}
            </div>
            {/* 送れたことの読み上げ（1回だけ）。見た目は送った1件が先頭に出ることで伝える */}
            <p className="sr-only" role="status" aria-live="polite" data-testid="comment-posted-status">{announce}</p>
        </section>
    );
}
