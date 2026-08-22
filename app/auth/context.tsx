"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signIn, signOut, getCurrentSession, deleteAccount as cognitoDeleteAccount } from "../../lib/auth/cognito";
import { cognitoConfig } from "../../lib/auth/config";
import { userFetch } from "../../lib/utils/api";
import { log } from "../../lib/utils/log";
import { resetFollowingCache } from "../../lib/hooks/useFollow";

type AuthContextType = {
    isAuthenticated: boolean;
    isAdminUser: boolean;
    isGeneralUser: boolean;
    userId: string | null;
    loading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string; needsVerification?: boolean; userId?: string }>;
    logout: () => void;
    deleteAccount: () => Promise<{ success: boolean; error?: string }>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [authState, setAuthState] = useState<{
        isAuthenticated: boolean;
        isAdminUser: boolean;
        isGeneralUser: boolean;
        userId: string | null;
        loading: boolean;
    }>({
        isAuthenticated: false,
        isAdminUser: false,
        isGeneralUser: false,
        userId: null,
        loading: true,
    });
    const router = useRouter();
    const pathname = usePathname();

    // 認証状態をチェック
    const checkAuth = useCallback(async () => {
        try {
            // 設定が解決できない場合は認証機能を無効化
            // （config.ts が検証済みフォールバックを持つため、通常は常に有効）
            const hasCognitoConfig = cognitoConfig.userPoolId && cognitoConfig.clientId;

            if (!hasCognitoConfig) {
                setAuthState({
                    isAuthenticated: false,
                    isAdminUser: false,
                    isGeneralUser: false,
                    userId: null,
                    loading: false,
                });
                return { authenticated: false, admin: false };
            }

            const session = await getCurrentSession();
            const authenticated = session !== null;
            const payload = authenticated ? session!.getIdToken().payload : {};
            const groups: string[] = Array.isArray(payload["cognito:groups"])
                ? payload["cognito:groups"] as string[]
                : [];
            const admin = groups.includes("admin");
            const general = !admin && groups.includes("user");
            const sub = typeof payload["sub"] === "string" ? payload["sub"] : null;

            setAuthState({
                isAuthenticated: authenticated,
                isAdminUser: admin,
                isGeneralUser: general,
                userId: sub,
                loading: false,
            });

            return { authenticated, admin };
        } catch (error) {
            log.warn("Auth check error (non-blocking):", error);
            setAuthState({
                isAuthenticated: false,
                isAdminUser: false,
                isGeneralUser: false,
                userId: null,
                loading: false,
            });
            return { authenticated: false, admin: false };
        }
    }, []);

    // 初回ロードおよびパス変更時に認証状態をチェック
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void checkAuth();
    }, [pathname, checkAuth]);

    // ログイン
    const login = useCallback(async (username: string, password: string) => {
        setAuthState((prev) => ({ ...prev, loading: true }));

        try {
            log.info("AuthContext: ログイン開始", { usernameLength: username.length });
            const result = await signIn(username, password);
            log.info("AuthContext: ログイン結果", { 
                success: result.success, 
                hasSession: !!result.session,
                groups: result.groups,
                error: result.error 
            });

            if (result.success && result.session) {
                const admin = result.groups?.includes("admin") || false;
                const general = !admin && (result.groups?.includes("user") || false);
                const sub = result.session.getIdToken().payload["sub"] as string | undefined;
                log.info("AuthContext: 認証成功", { admin, general, groups: result.groups });

                // 前の人のフォロー一覧を持ち越さない。ログアウト・退会側でも
                // 捨てているが、セッション失効など「明示ログアウトを通らずに
                // 切れた」場合はそちらが走らない。どの経路で切れていても、
                // **新しいログインは白紙から始める**のが確実。
                resetFollowingCache();
                setAuthState({
                    isAuthenticated: true,
                    isAdminUser: admin,
                    isGeneralUser: general,
                    userId: sub ?? null,
                    loading: false,
                });

                return { success: true, userId: sub };
            } else {
                log.error("AuthContext: ログイン失敗", result.error);
                setAuthState((prev) => ({ ...prev, loading: false }));
                return { success: false, error: result.error || "ログインに失敗しました", needsVerification: result.needsVerification };
            }
        } catch (error: unknown) {
            log.error("AuthContext: ログイン例外", error);
            setAuthState((prev) => ({ ...prev, loading: false }));
            const errorMessage = error instanceof Error ? error.message : "ログインに失敗しました";
            return { success: false, error: errorMessage };
        }
    }, []);

    // ログアウト
    const logout = useCallback(() => {
        signOut();
        // フォロー中の一覧はモジュール変数に持っている。ログアウトは
        // クライアント遷移でモジュール状態が残るため、明示的に捨てないと
        // 同じタブで別の人がログインしたときに前の人の一覧が使われる。
        resetFollowingCache();
        setAuthState({
            isAuthenticated: false,
            isAdminUser: false,
            isGeneralUser: false,
            userId: null,
            loading: false,
        });
        router.push("/");
    }, [router]);

    // 退会（アカウント削除）。順序:
    //   0. **先に Cognito のセッションが使えるかを確かめる**
    //   1. サーバー側の自分のデータを削除（失敗したら Cognito 削除に進まない）
    //   2. Cognito アカウントを削除（不可逆）
    //   3. ローカルのサインアウト + 状態リセット + トップへ
    //
    // 0 が無かった頃、**利用者に何も知らせないまま矛盾した状態**が作れた:
    //   ログインしたままタブを放置してリフレッシュトークンが古くなる
    //   → 退会を押す → DELETE は 200（写真も S3 もプロフィールも全部消える）
    //   → cognitoDeleteAccount が「セッションが無効です」で失敗
    //   → 画面には「退会処理に失敗しました」とだけ出てモーダルが開き直る
    // 利用者はログインしたままで、ギャラリーだけが空になる。しかも
    // 「失敗した」と言われているので、消えたことに気づく手がかりが無い。
    //
    // 不可逆な削除の前に、後段が通ることを先に確かめる。
    const deleteAccount = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
        try {
            const session = await getCurrentSession();
            if (!session || !session.isValid()) {
                return {
                    success: false,
                    error: "ログインの有効期限が切れています。一度ログインし直してからお試しください",
                };
            }

            const res = await userFetch("/user/account", { method: "DELETE" });
            if (!res.ok) {
                return { success: false, error: "退会処理に失敗しました。時間をおいて再度お試しください" };
            }
            const del = await cognitoDeleteAccount();
            if (!del.success) {
                // ここに来た時点で**サーバー側のデータはもう消えている**。
                // 「失敗しました」とだけ返すと、何も起きなかったように読める。
                log.error("AuthContext: データ削除後に Cognito 削除が失敗", del.error);
                return {
                    success: false,
                    error: "写真とプロフィールは削除されました。アカウント自体の削除だけが残っています。"
                        + "お手数ですが、もう一度ログインしてから退会をお試しください",
                };
            }
            signOut();
            // ログアウトと同じ掃除（useFollow.ts の doc「ログアウト時に必ず
            // 呼ぶこと」）。退会経路だけ抜けていて、同じタブで次に登録した
            // 人に前の人のフォロー一覧が使われる形が残っていた。
            resetFollowingCache();
            setAuthState({
                isAuthenticated: false,
                isAdminUser: false,
                isGeneralUser: false,
                userId: null,
                loading: false,
            });
            router.push("/");
            return { success: true };
        } catch (error) {
            log.error("AuthContext: 退会処理例外", error);
            return { success: false, error: error instanceof Error ? error.message : "退会処理中にエラーが発生しました" };
        }
    }, [router]);

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated: authState.isAuthenticated,
                isAdminUser: authState.isAdminUser,
                isGeneralUser: authState.isGeneralUser,
                userId: authState.userId,
                loading: authState.loading,
                login,
                logout,
                deleteAccount,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
