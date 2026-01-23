"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/context";
import { useToast } from "../../lib/hooks/useToast";
import { LockClosedIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { log } from "../../lib/utils/log";

export default function LoginPage() {
    const router = useRouter();
    const { login, isAuthenticated, loading } = useAuth();
    const { showToast } = useToast();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    // 既にログイン済みの場合はホームにリダイレクト
    useEffect(() => {
        if (!loading && isAuthenticated) {
            router.push("/");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, loading]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess(false);
        setSubmitting(true);

        try {
            log.info("ログイン試行:", { username: username.substring(0, 3) + "***" });
            const result = await login(username, password);
            log.info("ログイン結果:", result);

            if (result.success) {
                setSuccess(true);
                showToast("ログインに成功しました", "success");
                
                // 認証状態の更新を待つ
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // ホームにリダイレクト
                setTimeout(() => {
                    router.push("/");
                }, 500);
            } else {
                const errorMessage = result.error || "ログインに失敗しました";
                console.error("ログインエラー:", errorMessage);
                setError(errorMessage);
                showToast(errorMessage, "error");
            }
        } catch (err: unknown) {
            console.error("ログイン例外:", err);
            const errorMessage = err instanceof Error ? err.message : "ログインに失敗しました";
            setError(errorMessage);
            showToast(errorMessage, "error");
        } finally {
            setSubmitting(false);
        }
    };

    // ローディング中
    if (loading) {
        return (
            <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-md mx-auto w-full flex items-center justify-center">
                <div className="w-12 h-12 border-3 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-md mx-auto w-full flex items-center justify-center">
            <div className="w-full">
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold mb-2">管理者ログイン</h1>
                    <p className="text-white/60 text-sm">アップロード機能を使用するにはログインが必要です</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* 成功メッセージ */}
                    {success && (
                        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-md text-green-400 text-sm flex items-center gap-2">
                            <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
                            <div>
                                <div className="font-bold mb-1">ログイン成功</div>
                                <div>ホームページに移動します...</div>
                            </div>
                        </div>
                    )}

                    {/* エラーメッセージ */}
                    {error && (
                        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-md text-red-400 text-sm">
                            <div className="font-bold mb-1">エラー:</div>
                            <div>{error}</div>
                        </div>
                    )}

                    {/* メールアドレス */}
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-2">
                            メールアドレス
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            autoComplete="email"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                            placeholder="メールアドレスを入力"
                            disabled={submitting}
                        />
                    </div>

                    {/* パスワード */}
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-white/70 mb-2">
                            パスワード
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/30"
                            placeholder="パスワードを入力"
                            disabled={submitting}
                        />
                    </div>

                    {/* ログインボタン */}
                    <button
                        type="submit"
                        disabled={submitting || !username || !password}
                        className="w-full px-6 py-3 bg-white text-black rounded-md font-medium hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        style={{
                            touchAction: "manipulation",
                            minHeight: "44px",
                        }}
                    >
                        {submitting ? (
                            <>
                                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                <span>ログイン中...</span>
                            </>
                        ) : (
                            <>
                                <LockClosedIcon className="w-5 h-5" />
                                <span>ログイン</span>
                            </>
                        )}
                    </button>
                </form>
            </div>
        </main>
    );
}
