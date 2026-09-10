"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { forgotPassword, confirmForgotPassword, PASSWORD_RULE_MESSAGE } from "../../lib/auth/cognito";
import { userFetch } from "../../lib/utils/api";
import { ROUTES, safeNextPath } from "../../lib/routes";
import { pendingNameKey } from "../../lib/utils/pendingName";
import { LockClosedIcon, EnvelopeIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";

type Step = "login" | "forgot-send" | "forgot-confirm" | "forgot-done";

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const verified = searchParams?.get("verified") === "1";
    // ログイン後の戻り先。**これが無かったので、写真を見ていて「フォローする
    // にはログインしてください」→ ログイン → 必ず自分のプロフィールに着地し、
    // さっき見ていた写真も相手も見失っていた。**
    // 受け取るのはサイト内の絶対パスだけ（safeNextPath がオープン
    // リダイレクトを塞ぐ）。無ければ従来どおり自分のプロフィールへ。
    const nextPath = safeNextPath(searchParams?.get("next"));
    const { login, isAuthenticated, loading, userId } = useAuth();
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [resetCode, setResetCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [needsVerification, setNeedsVerification] = useState(false);

    // **replace で出る。** push にすると、ログイン済みで /login に着地する
    // たびに履歴が伸び、戻るが「/login → next → /login」の往復から
    // 抜けられなくなる（useMemberGate 側と合わせて1つの罠になっていた）。
    useEffect(() => {
        if (!loading && isAuthenticated) {
            router.replace(nextPath ?? (userId ? ROUTES.USER_PROFILE(userId) : "/"));
        }
    }, [isAuthenticated, loading, router, userId, nextPath]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setNeedsVerification(false);
        setSubmitting(true);
        try {
            const result = await login(username.trim(), password);
            if (result.success) {
                // 新規登録時に保存した表示名があれば、プロフィールを作成
                // 登録したときと同じメールアドレスの分だけを使う。
                // グローバルな1キーだった頃は、別人が登録途中で残した名前を
                // 拾ってしまい、こちらのプロフィールに勝手に付いていた。
                const pendingKey = pendingNameKey(username);
                let pendingDisplayName: string | null = null;
                try { pendingDisplayName = localStorage.getItem(pendingKey); } catch { /* ignore */ }
                if (pendingDisplayName) {
                    // **待たない。** ここは API を2本、直列で叩く。
                    // `userFetch` はセッション最大10秒＋要求20秒なので、
                    // **1本あたり最大30秒・2本で最大60秒**「ログイン中...」の
                    // ままになる。しかもこの枝に入るのは
                    // **登録を終えたばかりの初回ログインちょうど**——
                    // 電波の悪い場所でそこを踏んだ人は、トークンはもう手元に
                    // あるのに固まった画面を見て閉じる。
                    //
                    // 落ちても控え（`pendingKey`）は残るので、**次にログイン
                    // したときにここがもう一度走る**。
                    //
                    // **`ProfileSetupBanner` は拾い直さない**（一度そう書いた
                    // が誤り）。あちらは `GET /user/profile` で名前の有無を
                    // 見て「名前を決めましょう」と促すだけで、`pendingKey` も
                    // `localStorage` も読まない。つまり次のログインまでの間、
                    // 登録時に入れた表示名は画面に出てこない。**先に着地させる。**
                    void (async () => {
                        try {
                            // PUT /user/profile は全置換なので、既にプロフィールがある場合は上書きしない
                            const check = await userFetch("/user/profile");
                            const existing = check.ok ? await check.json() as { displayName?: string } : null;
                            if (existing?.displayName) {
                                try { localStorage.removeItem(pendingKey); } catch { /* ignore */ }
                            } else {
                                const res = await userFetch("/user/profile", {
                                    method: "PUT",
                                    body: JSON.stringify({ displayName: pendingDisplayName }),
                                });
                                if (res.ok) {
                                    try { localStorage.removeItem(pendingKey); } catch { /* ignore */ }
                                }
                            }
                        } catch {
                            /* プロフィール作成失敗してもログインは成功させる — /user/profile から再設定できる */
                        }
                    })();
                }
                showToast("ログインしました", "success");
                // インスタ風: ログイン後は自分のプロフィールページへ
                // ログインが済んだ画面に戻れても意味が無い（上のエフェクトが
                // すぐ送り返す）ので replace
                router.replace(nextPath ?? (result.userId ? ROUTES.USER_PROFILE(result.userId) : "/"));
            } else if (result.needsVerification) {
                setNeedsVerification(true);
                setError(result.error || "メールアドレスの確認が完了していません");
            } else {
                setError(result.error || "ログインに失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleForgotSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const result = await forgotPassword(username.trim());
            if (result.success) {
                setStep("forgot-confirm");
            } else {
                setError(result.error ?? "エラーが発生しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleForgotConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        // **送る前に見る。** 登録側（`app/signup`）は長さと一致を見ているのに
        // ここは空でなければ送っていた。3文字でも往復して、しかも戻ってくる
        // のは AWS の `InvalidPasswordException` の文言（記号の話が抜けていた）
        if (newPassword.length < 8) {
            setError(PASSWORD_RULE_MESSAGE);
            return;
        }
        setSubmitting(true);
        try {
            const result = await confirmForgotPassword(username.trim(), resetCode, newPassword);
            if (result.success) {
                setStep("forgot-done");
            } else {
                setError(result.error ?? "エラーが発生しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black flex items-center justify-center px-4">
            <div className="w-full max-w-sm">

                {/* ロゴ */}
                <div className="mb-10 text-center">
                    <p className="text-white/50 text-xs tracking-widest uppercase mb-3">Journey Photo</p>
                    <h1 className="text-2xl font-bold text-white">
                        {step === "login" && "ログイン"}
                        {step === "forgot-send" && "パスワードをリセット"}
                        {step === "forgot-confirm" && "コードを確認"}
                        {step === "forgot-done" && "リセット完了"}
                    </h1>
                    {step === "login" && (
                        <p className="text-white/50 text-sm mt-2">写真をアップロードするにはログインが必要です</p>
                    )}
                    {step === "forgot-send" && (
                        <p className="text-white/50 text-sm mt-2">登録したメールアドレスに確認コードを送信します</p>
                    )}
                    {step === "forgot-confirm" && (
                        <p className="text-white/50 text-sm mt-2">{username} に送信されたコードを入力してください</p>
                    )}
                </div>

                {/* メール認証完了バナー */}
                {verified && step === "login" && (
                    <div className="mb-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                        ✓ メールアドレスの確認が完了しました。ログインしてください。
                    </div>
                )}

                {/* エラー */}
                {error && (
                    <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* 未確認アカウント誘導 */}
                {needsVerification && step === "login" && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm">
                        <p className="text-amber-300/80 mb-2 text-xs">確認コードのメールが届いているか確認してください。</p>
                        <Link
                            href={`/signup?email=${encodeURIComponent(username)}`}
                            className="text-amber-300 hover:text-amber-200 underline text-xs transition-colors"
                        >
                            確認コードを入力・再送する →
                        </Link>
                    </div>
                )}

                {/* ログインフォーム */}
                {step === "login" && (
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label htmlFor="login-email" className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                            <input
                                id="login-email"
                                type="email"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                autoComplete="email"
                                placeholder="example@email.com"
                                disabled={submitting}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-colors"
                            />
                        </div>
                        <div>
                            <label htmlFor="login-password" className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード</label>
                            <input
                                id="login-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                                placeholder="••••••••"
                                disabled={submitting}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-colors"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !username || !password}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                        >
                            {submitting ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <LockClosedIcon className="w-4 h-4" />
                            )}
                            {submitting ? "ログイン中..." : "ログイン"}
                        </button>

                        <button
                            type="button"
                            onClick={() => { setStep("forgot-send"); setError(""); }}
                            className="w-full text-center text-xs text-white/50 hover:text-white/75 transition-colors py-2"
                        >
                            パスワードをお忘れですか？
                        </button>

                        <p className="text-center text-xs text-white/50 pt-1">
                            アカウントをお持ちでない方は{" "}
                            {/* **`next` を渡す。** 渡さないと、招待リンクや
                                共有リンクから来た未登録の人は、ここを押した
                                時点で行き先を失う（登録を終えると自分の空
                                プロフィールに着地する） */}
                            <Link href={nextPath ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup"} className="text-white/60 hover:text-white underline transition-colors">
                                新規登録
                            </Link>
                        </p>
                    </form>
                )}

                {/* パスワードリセット: メール送信 */}
                {step === "forgot-send" && (
                    <form onSubmit={handleForgotSend} className="space-y-4">
                        <div>
                            <label htmlFor="reset-email" className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                            <input
                                id="reset-email"
                                type="email"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                autoComplete="email"
                                placeholder="example@email.com"
                                disabled={submitting}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={submitting || !username}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <EnvelopeIcon className="w-4 h-4" />
                            )}
                            {submitting ? "送信中..." : "確認コードを送信"}
                        </button>
                        <button type="button" onClick={() => { setStep("login"); setError(""); }}
                            className="w-full text-center text-xs text-white/50 hover:text-white/75 transition-colors py-2 flex items-center justify-center gap-1">
                            <ArrowLeftIcon className="w-3 h-3" /> ログインに戻る
                        </button>
                    </form>
                )}

                {/* パスワードリセット: コード入力 */}
                {step === "forgot-confirm" && (
                    <form onSubmit={handleForgotConfirm} className="space-y-4">
                        <div>
                            <label htmlFor="reset-code" className="block text-xs text-white/50 mb-1.5 tracking-wide">確認コード</label>
                            <input
                                id="reset-code"
                                type="text"
                                value={resetCode}
                                onChange={(e) => setResetCode(e.target.value)}
                                required
                                placeholder="メールに届いたコードを入力"
                                disabled={submitting}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors tracking-widest"
                            />
                        </div>
                        <div>
                            <label htmlFor="reset-new-password" className="block text-xs text-white/50 mb-1.5 tracking-wide">新しいパスワード</label>
                            <input
                                id="reset-new-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                placeholder="8文字以上、英大・小文字・数字・記号を含む"
                                disabled={submitting}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={submitting || !resetCode || !newPassword}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : null}
                            {submitting ? "更新中..." : "パスワードを更新"}
                        </button>
                    </form>
                )}

                {/* 完了 */}
                {step === "forgot-done" && (
                    <div className="text-center space-y-6">
                        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                            <LockClosedIcon className="w-6 h-6 text-white" />
                        </div>
                        <p className="text-white/60 text-sm">パスワードが更新されました。</p>
                        <button
                            onClick={() => { setStep("login"); setError(""); setPassword(""); }}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition"
                        >
                            ログインする
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}

export default function LoginPage() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    );
}
