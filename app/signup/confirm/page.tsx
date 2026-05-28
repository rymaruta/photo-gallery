"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmSignUp, resendConfirmationCode, signIn } from "../../../lib/auth/cognito";
import { createUser } from "../../../lib/utils/userApi";
import { ROUTES } from "../../../lib/routes";
import { EnvelopeIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";

function ConfirmForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const [resent, setResent] = useState(false);

    useEffect(() => {
        const emailParam = searchParams.get("email");
        if (emailParam) setEmail(emailParam);
    }, [searchParams]);

    const handleConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            const result = await confirmSignUp(email, code);
            if (!result.success) {
                setError(result.error ?? "確認に失敗しました");
                return;
            }

            // Try to create user profile using stored pending data
            const pendingEmail = sessionStorage.getItem("pendingEmail");
            const pendingRaw = sessionStorage.getItem("pendingProfile");

            if (pendingEmail === email && pendingRaw) {
                const { username, displayName } = JSON.parse(pendingRaw) as { username: string; displayName: string };
                // We need a JWT to call createUser - prompt user to log in first,
                // then create profile on the login success redirect
                sessionStorage.setItem("postLoginAction", JSON.stringify({ action: "createProfile", username, displayName }));
                sessionStorage.removeItem("pendingProfile");
                sessionStorage.removeItem("pendingEmail");
            }

            // Redirect to login with success message
            router.push(`${ROUTES.LOGIN}?verified=1`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleResend = async () => {
        setResending(true);
        setError("");
        try {
            const result = await resendConfirmationCode(email);
            if (result.success) {
                setResent(true);
                setTimeout(() => setResent(false), 5000);
            } else {
                setError(result.error ?? "再送に失敗しました");
            }
        } finally {
            setResending(false);
        }
    };

    return (
        <main className="min-h-screen bg-black flex items-center justify-center px-4">
            <div className="w-full max-w-sm space-y-8">
                <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                        <EnvelopeIcon className="w-7 h-7 text-white" />
                    </div>
                    <h1 className="text-xl font-semibold text-white mb-2">メールアドレスの確認</h1>
                    <p className="text-white/50 text-sm leading-relaxed">
                        {email
                            ? <>{email} に送信した確認コードを入力してください。</>
                            : "メールに届いた確認コードを入力してください。"
                        }
                    </p>
                </div>

                <form onSubmit={handleConfirm} className="space-y-4">
                    {error && (
                        <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                            {error}
                        </div>
                    )}
                    {resent && (
                        <div className="px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
                            確認コードを再送しました
                        </div>
                    )}

                    {!email && (
                        <div>
                            <label className="block text-xs text-white/50 mb-1.5 tracking-wide">メールアドレス</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                placeholder="example@email.com"
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 tracking-wide">確認コード</label>
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                            required
                            placeholder="6桁のコード"
                            maxLength={6}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            disabled={submitting}
                            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors tracking-widest text-center text-lg"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting || code.length < 6}
                        className="w-full py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {submitting && <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />}
                        {submitting ? "確認中..." : "確認する"}
                    </button>

                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={resending}
                        className="w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors py-2"
                    >
                        {resending ? "再送中..." : "コードを再送する"}
                    </button>

                    <button
                        type="button"
                        onClick={() => router.push(ROUTES.SIGNUP)}
                        className="w-full text-center text-xs text-white/40 hover:text-white/60 transition-colors py-2 flex items-center justify-center gap-1"
                    >
                        <ArrowLeftIcon className="w-3 h-3" /> 登録に戻る
                    </button>
                </form>
            </div>
        </main>
    );
}

export default function SignupConfirmPage() {
    return (
        <Suspense>
            <ConfirmForm />
        </Suspense>
    );
}
