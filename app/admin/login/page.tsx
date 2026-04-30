"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../auth/context";
import { useToast } from "../../../lib/hooks/useToast";
import { LockClosedIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

export default function AdminLoginPage() {
    const router = useRouter();
    const { login, isAuthenticated, isAdminUser, isGeneralUser, loading } = useAuth();
    const { showToast } = useToast();

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // 管理者でログイン済み → /admin へ
    useEffect(() => {
        if (!loading && isAuthenticated && isAdminUser) {
            router.push("/admin");
        }
        // 一般ユーザーでログイン済み → / へ（管理ページは見せない）
        if (!loading && isAuthenticated && isGeneralUser) {
            router.push("/");
        }
    }, [isAuthenticated, isAdminUser, isGeneralUser, loading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const result = await login(username, password);
            if (result.success) {
                // ログイン成功後、グループを確認
                // isAdminUser の更新を useEffect で拾うので少し待つ
                await new Promise(r => setTimeout(r, 600));
                // useEffect が処理するが、万が一のため直接確認
                const { isAdmin: checkAdmin } = await import("../../../lib/auth/cognito");
                const admin = await checkAdmin();
                if (admin) {
                    showToast("ログインしました", "success");
                    router.push("/admin");
                } else {
                    showToast("管理者権限が必要です", "error");
                    // ログアウトして一般ページへ
                    const { signOut } = await import("../../../lib/auth/cognito");
                    signOut();
                    router.push("/");
                }
            } else {
                setError(result.error || "ログインに失敗しました");
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

                <div className="mb-10 text-center">
                    <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4">
                        <ShieldCheckIcon className="w-5 h-5 text-white/60" />
                    </div>
                    <p className="text-white/30 text-xs tracking-widest uppercase mb-2">Journey Photo</p>
                    <h1 className="text-xl font-bold text-white">管理者ログイン</h1>
                </div>

                {error && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                        <input
                            type="email"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            autoComplete="email"
                            placeholder="admin@example.com"
                            disabled={submitting}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
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
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
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
                </form>
            </div>
        </main>
    );
}
