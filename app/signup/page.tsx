"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "../../lib/auth/cognito";
import { createUser } from "../../lib/utils/userApi";
import { ROUTES } from "../../lib/routes";
import { UserIcon, EnvelopeIcon, LockClosedIcon } from "@heroicons/react/24/outline";

type Step = "form" | "done";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const RESERVED = new Set(["admin", "root", "api", "users", "user", "login", "logout", "signup", "me", "about", "help", "support", "terms", "privacy"]);

export default function SignupPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>("form");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const validate = (): string | null => {
        if (!email || !password || !username || !displayName) return "すべての項目を入力してください";
        if (password !== passwordConfirm) return "パスワードが一致しません";
        if (password.length < 8) return "パスワードは8文字以上必要です";
        if (!USERNAME_RE.test(username)) return "ユーザー名は3〜20文字の半角英数字・アンダースコアのみ使用できます";
        if (RESERVED.has(username.toLowerCase())) return `「${username}」は使用できないユーザー名です`;
        if (displayName.length > 50) return "表示名は50文字以内で入力してください";
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        const validationError = validate();
        if (validationError) { setError(validationError); return; }

        setSubmitting(true);
        try {
            // Step 1: Cognito sign up
            const signUpResult = await signUp(email, password);
            if (!signUpResult.success) {
                setError(signUpResult.error ?? "登録に失敗しました");
                return;
            }

            // Step 2: Create user profile in DynamoDB (requires JWT - sign in first)
            // Profile creation is deferred to after email confirmation + first login
            // Store pending profile data in sessionStorage
            sessionStorage.setItem("pendingProfile", JSON.stringify({ username, displayName }));
            sessionStorage.setItem("pendingEmail", email);

            setStep("done");
        } finally {
            setSubmitting(false);
        }
    };

    if (step === "done") {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center px-4">
                <div className="w-full max-w-sm space-y-8">
                    <div className="text-center">
                        <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                            <EnvelopeIcon className="w-7 h-7 text-white" />
                        </div>
                        <h1 className="text-xl font-semibold text-white mb-2">確認メールを送信しました</h1>
                        <p className="text-white/50 text-sm leading-relaxed">
                            {email} に確認コードを送信しました。<br />
                            メールを確認してコードを入力してください。
                        </p>
                    </div>
                    <button
                        onClick={() => router.push(`${ROUTES.SIGNUP_CONFIRM}?email=${encodeURIComponent(email)}`)}
                        className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors"
                    >
                        確認コードを入力する
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black flex items-center justify-center px-4">
            <div className="w-full max-w-sm space-y-8">
                <div className="text-center">
                    <h1 className="text-2xl font-semibold text-white tracking-tight">アカウント作成</h1>
                    <p className="text-white/40 text-sm mt-1">Journey Photo Gallery</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                        <div className="relative">
                            <EnvelopeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                                placeholder="example@email.com"
                                disabled={submitting}
                                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">ユーザー名 <span className="text-white/30">（@username、後から変更不可）</span></label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">@</span>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                                required
                                autoComplete="username"
                                placeholder="ryuhei"
                                disabled={submitting}
                                pattern="[a-zA-Z0-9_]{3,20}"
                                className="w-full pl-8 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                        <p className="text-xs text-white/30 mt-1">3〜20文字、半角英数字・アンダースコアのみ</p>
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">表示名</label>
                        <div className="relative">
                            <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                            <input
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                required
                                autoComplete="name"
                                placeholder="丸田 竜平"
                                disabled={submitting}
                                maxLength={50}
                                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード</label>
                        <div className="relative">
                            <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="new-password"
                                placeholder="8文字以上"
                                disabled={submitting}
                                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">パスワード（確認）</label>
                        <div className="relative">
                            <LockClosedIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                            <input
                                type="password"
                                value={passwordConfirm}
                                onChange={(e) => setPasswordConfirm(e.target.value)}
                                required
                                autoComplete="new-password"
                                placeholder="パスワードを再入力"
                                disabled={submitting}
                                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={submitting || !email || !password || !username || !displayName}
                        className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                    >
                        {submitting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                        {submitting ? "登録中..." : "アカウントを作成"}
                    </button>
                </form>

                <p className="text-center text-xs text-white/40">
                    すでにアカウントをお持ちの方は{" "}
                    <Link href={ROUTES.LOGIN} className="text-white/60 hover:text-white underline transition-colors">
                        ログイン
                    </Link>
                </p>
            </div>
        </main>
    );
}
