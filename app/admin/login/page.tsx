"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../auth/context";
import { useToast } from "../../../lib/hooks/useToast";
import { LockClosedIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

type Step = "login" | "forgot";

export default function AdminLoginPage() {
    const router = useRouter();
    const { login, isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const { showToast } = useToast();

    const [step, setStep] = useState<Step>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // 通せなかった／もう用の無い画面は履歴に残さない（replace）。
    // push にすると、送り先から戻ったときにこの画面へ着地し、ここが
    // また送り返すので**戻るで抜けられなくなる**。
    useEffect(() => {
        if (!loading && isAuthenticated && isAdminUser) {
            router.replace("/admin");
        }
        if (!loading && isAuthenticated && isGeneralUser) {
            router.replace("/");
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const result = await login(username, password);
            if (result.success) {
                showToast("ログインしました", "success");
                // useEffect handles redirect based on isAdminUser / isGeneralUser state
            } else {
                setError(result.error || "ログインに失敗しました");
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-bg flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">ログイン</h1>
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-bg flex items-center justify-center px-4">
            <div className="w-full max-w-sm">

                <div className="mb-10 text-center">
                    <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                        <ShieldCheckIcon className="w-5 h-5 text-white/60" />
                    </div>
                    <p className="text-white/50 text-xs tracking-widest uppercase mb-2">Journey Photo</p>
                    <h1 className="text-xl font-bold text-white">ログイン</h1>
                </div>

                {step === "login" && (
                    <>
                        {error && (
                            <div role="alert" className="mb-6 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="admin-email" className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                                <input
                                    id="admin-email"
                                    type="email"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    autoComplete="email"
                                    placeholder="admin@example.com"
                                    disabled={submitting}
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-base placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                                />
                            </div>
                            <div>
                                <label htmlFor="admin-password" className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード</label>
                                <input
                                    id="admin-password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    placeholder="••••••••"
                                    disabled={submitting}
                                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-base placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submitting || !username || !password}
                                className="w-full py-3 bg-accent-fill text-ink text-sm font-semibold rounded-lg hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
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
                                onClick={() => { setStep("forgot"); setError(""); }}
                                className="w-full text-center text-xs text-white/50 hover:text-white/60 transition-colors py-2"
                            >
                                パスワードをお忘れですか？
                            </button>
                        </form>
                    </>
                )}

                {step === "forgot" && (
                    <div className="text-center space-y-6">
                        <div className="px-4 py-5 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70 leading-relaxed">
                            <p className="mb-2 font-medium text-white/90">パスワードのリセットについて</p>
                            <p>管理者アカウントのパスワードリセットは、セキュリティ上の理由からセルフサービスでは行えません。</p>
                            <p className="mt-2">システム管理者にお問い合わせください。</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setStep("login")}
                            className="w-full text-center text-xs text-white/50 hover:text-white/60 transition-colors py-2"
                        >
                            ← ログインに戻る
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
