"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signIn, signOut, getCurrentSession, deleteAccount as cognitoDeleteAccount } from "../../lib/auth/cognito";
import { cognitoConfig } from "../../lib/auth/config";
import { userFetch } from "../../lib/utils/api";
import { log } from "../../lib/utils/log";

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
        setAuthState({
            isAuthenticated: false,
            isAdminUser: false,
            isGeneralUser: false,
            userId: null,
            loading: false,
        });
        router.push("/");
    }, [router]);

    // 退会（アカウント削除）。慎重な削除順序:
    //   1. サーバー側の自分のデータを削除（失敗したら Cognito 削除に進まない）
    //   2. Cognito アカウントを削除（不可逆）
    //   3. ローカルのサインアウト + 状態リセット + トップへ
    const deleteAccount = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
        try {
            const res = await userFetch("/user/account", { method: "DELETE" });
            if (!res.ok) {
                return { success: false, error: "退会処理に失敗しました。時間をおいて再度お試しください" };
            }
            const del = await cognitoDeleteAccount();
            if (!del.success) {
                return { success: false, error: del.error || "アカウントの削除に失敗しました" };
            }
            signOut();
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
