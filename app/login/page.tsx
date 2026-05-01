"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { forgotPassword, confirmForgotPassword } from "../../lib/auth/cognito";
import { LockClosedIcon, EnvelopeIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";

type Step = "login" | "forgot-send" | "forgot-confirm" | "forgot-done";

export default function LoginPage() {
    const router = useRouter();
    const { login, isAuthenticated, loading } = useAuth();
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [resetCode, setResetCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [needsVerification, setNeedsVerification] = useState(false);

    useEffect(() => {
        if (!loading && isAuthenticated) router.push("/");
    }, [isAuthenticated, loading, router]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setNeedsVerification(false);
        setSubmitting(true);
        try {
            const result = await login(username, password);
            if (result.success) {
                showToast("ログインしました", "success");
                router.push("/");
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
            const result = await forgotPassword(username);
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
        setSubmitting(true);
        try {
            const result = await confirmForgotPassword(username, resetCode, newPassword);
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
                    <p className="text-white/40 text-xs tracking-widest uppercase mb-3">Journey Photo</p>
                    <h1 className="text-2xl font-bold text-white">
                        {step === "login" && "ログイン"}
                        {step === "forgot-send" && "パスワードをリセット"}
                        {step === "forgot-confirm" && "コードを確認"}
                        {step === "forgot-done" && "リセット完了"}
                    </h1>
                    {step === "login" && (
                        <p className="text-white/40 text-sm mt-2">写真をアップロードするにはログインが必要です</p>
                    )}
                    {step === "forgot-send" && (
                        <p className="text-white/40 text-sm mt-2">登録したメールアドレスに確認コードを送信します</p>
                    )}
                    {step === "forgot-confirm" && (
                        <p className="text-white/40 text-sm mt-2">{username} に送信されたコードを入力してください</p>
                    )}
                </div>

                {/* エラー */}
                {error && (
                    <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
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
                            <label className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                            <input
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
                            <label className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード</label>
                            <input
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
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
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
                            className="w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors py-2"
                        >
                            パスワードをお忘れですか？
                        </button>

                        <p className="text-center text-xs text-white/40 pt-1">
                            アカウントをお持ちでない方は{" "}
                            <Link href="/signup" className="text-white/60 hover:text-white underline transition-colors">
                                新規登録
                            </Link>
                        </p>
                    </form>
                )}

                {/* パスワードリセット: メール送信 */}
                {step === "forgot-send" && (
                    <form onSubmit={handleForgotSend} className="space-y-4">
                        <div>
                            <label className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                            <input
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
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <EnvelopeIcon className="w-4 h-4" />
                            )}
                            {submitting ? "送信中..." : "確認コードを送信"}
                        </button>
                        <button type="button" onClick={() => { setStep("login"); setError(""); }}
                            className="w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors py-2 flex items-center justify-center gap-1">
                            <ArrowLeftIcon className="w-3 h-3" /> ログインに戻る
                        </button>
                    </form>
                )}

                {/* パスワードリセット: コード入力 */}
                {step === "forgot-confirm" && (
                    <form onSubmit={handleForgotConfirm} className="space-y-4">
                        <div>
                            <label className="block text-xs text-white/50 mb-1.5 tracking-wide">確認コード</label>
                            <input
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
                            <label className="block text-xs text-white/50 mb-1.5 tracking-wide">新しいパスワード</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                placeholder="8文字以上、英大文字・小文字・数字を含む"
                                disabled={submitting}
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={submitting || !resetCode || !newPassword}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors"
                        >
                            ログインする
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
