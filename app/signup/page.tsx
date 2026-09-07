"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { signUp, confirmSignUp, resendConfirmationCode } from "../../lib/auth/cognito";
import { pendingNameKey, pendingVerifyKey } from "../../lib/utils/pendingName";
import { EnvelopeIcon, LockClosedIcon, CheckCircleIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";

type Step = "register" | "verify" | "done";

const inputCls = "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-colors disabled:opacity-50";

const PENDING_TTL = 24 * 60 * 60 * 1000;

function savePending(em: string, username: string) {
    try { localStorage.setItem(pendingVerifyKey(em), JSON.stringify({ username, t: Date.now() })); } catch { /* ignore */ }
}
function loadPending(em: string): string | null {
    try {
        const raw = localStorage.getItem(pendingVerifyKey(em));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const { username, t } = parsed as Record<string, unknown>;
        if (typeof username !== "string" || typeof t !== "number") return null;
        if (Date.now() - t > PENDING_TTL) { localStorage.removeItem(pendingVerifyKey(em)); return null; }
        return username;
    } catch { return null; }
}
function clearPending(em: string) {
    try { localStorage.removeItem(pendingVerifyKey(em)); } catch { /* ignore */ }
}

export default function SignupPage() {
    const router = useRouter();
    const { isAuthenticated, loading } = useAuth();
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("register");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [code, setCode] = useState("");
    const [cognitoUsername, setCognitoUsername] = useState(""); // signUp が返す UUID
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);

    // ログイン済みならトップへ
    useEffect(() => {
        if (!loading && isAuthenticated) router.replace("/");   // 済んだ画面は履歴に残さない
    }, [isAuthenticated, loading, router]);

    // URLパラメータ or localStorage から verify ステップを復元
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const emailParam = params.get("email");
        if (!emailParam) return;
        const savedUsername = loadPending(emailParam);
        if (savedUsername) {
            setEmail(emailParam);
            setCognitoUsername(savedUsername);
            setStep("verify");
        } else {
            setEmail(emailParam);
        }
    }, []);

    // 再送クールダウンタイマー
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const t = setTimeout(() => setResendCooldown((v) => v - 1), 1000);
        return () => clearTimeout(t);
    }, [resendCooldown]);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError("パスワードが一致しません");
            return;
        }
        if (password.length < 8) {
            setError("パスワードは8文字以上で入力してください");
            return;
        }

        setSubmitting(true);
        try {
            const result = await signUp(email, password);
            if (result.success && result.username) {
                savePending(email, result.username);
                if (displayName.trim()) {
                    // メールアドレスで区切る。
                    // 以前はグローバルな1キーだったので、登録を途中でやめた人の
                    // 表示名がそのまま残り、**次にその端末でログインした別人**の
                    // プロフィールに付いていた（共有のiPadなどで起きる）。
                    // 本人にはどこから来た名前なのか分からない。
                    try {
                        localStorage.setItem(pendingNameKey(email), displayName.trim());
                    } catch { /* ignore */ }
                }
                setCognitoUsername(result.username);
                setStep("verify");
                setResendCooldown(60);
            } else if (result.aliasExists) {
                // 登録済みだが未確認の場合、localStorage から UUID を復元して verify へ
                const savedUsername = loadPending(email);
                if (savedUsername) {
                    const resendResult = await resendConfirmationCode(savedUsername);
                    if (resendResult.success) {
                        setCognitoUsername(savedUsername);
                        setStep("verify");
                        showToast("確認コードを再送しました", "success");
                        setResendCooldown(60);
                    } else {
                        setError("このメールアドレスはすでに登録されています。ログインするか、パスワードリセットをお試しください。");
                    }
                } else {
                    setError("このメールアドレスはすでに登録されています。ログインするか、パスワードリセットをお試しください。");
                }
            } else {
                setError(result.error ?? "登録に失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const result = await confirmSignUp(cognitoUsername, code.trim());
            if (result.success) {
                clearPending(email);
                setStep("done");
            } else {
                setError(result.error ?? "確認に失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleResend = async () => {
        if (resendCooldown > 0 || resending) return;
        setResending(true);
        try {
            const result = await resendConfirmationCode(cognitoUsername);
            if (result.success) {
                showToast("確認コードを再送しました", "success");
                setResendCooldown(60);
            } else {
                setError(result.error ?? "再送に失敗しました");
            }
        } finally {
            setResending(false);
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

                {/* ヘッダー */}
                <div className="mb-10 text-center">
                    <p className="text-white/50 text-xs tracking-widest uppercase mb-3">Journey Photo</p>
                    <h1 className="text-2xl font-bold text-white">
                        {step === "register" && "アカウント作成"}
                        {step === "verify" && "メールを確認"}
                        {step === "done" && "登録完了"}
                    </h1>
                    <p className="text-white/50 text-sm mt-2">
                        {step === "register" && "写真のアップロードができるようになります"}
                        {step === "verify" && `${email} に確認コードを送信しました`}
                        {step === "done" && "アカウントが有効になりました"}
                    </p>
                </div>

                {/* エラー */}
                {error && (
                    <div role="alert" className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* ステップ1: 登録フォーム */}
                {step === "register" && (
                    <form onSubmit={handleRegister} className="space-y-4">
                        <div>
                            <label htmlFor="signup-display-name" className="block text-xs text-white/50 mb-1.5 tracking-wide">表示名</label>
                            <input
                                id="signup-display-name"
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                autoComplete="nickname"
                                placeholder="あなたの名前（後で変更できます）"
                                maxLength={50}
                                disabled={submitting}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label htmlFor="signup-email" className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                            <input
                                id="signup-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                                placeholder="example@email.com"
                                disabled={submitting}
                                className={inputCls}
                            />
                        </div>
                        <div>
                            <label htmlFor="signup-password" className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード</label>
                            <input
                                id="signup-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                placeholder="8文字以上"
                                disabled={submitting}
                                className={inputCls}
                            />
                            <p className="text-xs text-white/50 mt-1.5">英大文字・小文字・数字・記号（!@#$など）をそれぞれ1文字以上含めてください</p>
                        </div>
                        <div>
                            <label htmlFor="signup-password-confirm" className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード（確認）</label>
                            <input
                                id="signup-password-confirm"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                placeholder="••••••••"
                                disabled={submitting}
                                className={inputCls}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !email || !password || !confirmPassword}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                        >
                            {submitting ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <EnvelopeIcon className="w-4 h-4" />
                            )}
                            {submitting ? "送信中..." : "確認コードを送信"}
                        </button>

                        <p className="text-center text-xs text-white/50 pt-2">
                            すでにアカウントをお持ちの方は{" "}
                            <Link href="/login" className="text-white/60 hover:text-white underline transition-colors">
                                ログイン
                            </Link>
                        </p>
                    </form>
                )}

                {/* ステップ2: 確認コード入力 */}
                {step === "verify" && (
                    <form onSubmit={handleVerify} className="space-y-4">
                        <div>
                            <label htmlFor="signup-code" className="block text-xs text-white/50 mb-1.5 tracking-wide">確認コード</label>
                            <input
                                id="signup-code"
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                required
                                inputMode="numeric"
                                placeholder="メールに届いた6桁のコード"
                                disabled={submitting}
                                className={inputCls + " tracking-[0.3em] text-center text-lg"}
                                maxLength={6}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || code.trim().length < 6}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <LockClosedIcon className="w-4 h-4" />
                            )}
                            {submitting ? "確認中..." : "登録を確定する"}
                        </button>

                        <div className="flex items-center justify-between pt-1">
                            <button
                                type="button"
                                onClick={() => { setStep("register"); setError(""); setCode(""); setResendCooldown(0); }}
                                className="text-xs text-white/50 hover:text-white/60 transition-colors flex items-center gap-1"
                            >
                                <ArrowLeftIcon className="w-3 h-3" /> 戻る
                            </button>
                            <button
                                type="button"
                                onClick={handleResend}
                                disabled={resendCooldown > 0 || resending}
                                className="text-xs text-white/50 hover:text-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {resendCooldown > 0
                                    ? `再送（${resendCooldown}秒後）`
                                    : resending ? "送信中..." : "コードを再送する"}
                            </button>
                        </div>
                    </form>
                )}

                {/* ステップ3: 完了 */}
                {step === "done" && (
                    <div className="text-center space-y-6">
                        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                            <CheckCircleIcon className="w-8 h-8 text-white" />
                        </div>
                        <p className="text-white/60 text-sm leading-relaxed">
                            登録が完了しました。<br />
                            ログインして写真のアップロードをお楽しみください。
                        </p>
                        <Link
                            href="/login"
                            className="block w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition text-center"
                        >
                            ログインする
                        </Link>
                    </div>
                )}
            </div>
        </main>
    );
}
