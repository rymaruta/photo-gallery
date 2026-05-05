"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signIn, signOut, isAuthenticated, isAdmin, isGeneralUser } from "../../lib/auth/cognito";
import { log } from "../../lib/utils/log";

type AuthContextType = {
    isAuthenticated: boolean;
    isAdminUser: boolean;
    isGeneralUser: boolean;
    loading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string; needsVerification?: boolean }>;
    logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [authState, setAuthState] = useState({
        isAuthenticated: false,
        isAdminUser: false,
        isGeneralUser: false,
        loading: true,
    });
    const router = useRouter();
    const pathname = usePathname();

    // 認証状態をチェック
    const checkAuth = useCallback(async () => {
        try {
            // 環境変数が設定されていない場合は認証機能を無効化
            const hasCognitoConfig = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID && 
                                    process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

            if (!hasCognitoConfig) {
                setAuthState({
                    isAuthenticated: false,
                    isAdminUser: false,
                    isGeneralUser: false,
                    loading: false,
                });
                return { authenticated: false, admin: false };
            }

            const authenticated = await isAuthenticated();
            const admin = authenticated ? await isAdmin() : false;
            const general = authenticated && !admin ? await isGeneralUser() : false;

            setAuthState({
                isAuthenticated: authenticated,
                isAdminUser: admin,
                isGeneralUser: general,
                loading: false,
            });

            return { authenticated, admin };
        } catch (error) {
            log.warn("Auth check error (non-blocking):", error);
            setAuthState({
                isAuthenticated: false,
                isAdminUser: false,
                isGeneralUser: false,
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
                log.info("AuthContext: 認証成功", { admin, general, groups: result.groups });

                setAuthState({
                    isAuthenticated: true,
                    isAdminUser: admin,
                    isGeneralUser: general,
                    loading: false,
                });

                return { success: true };
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
            loading: false,
        });
        router.push("/");
    }, [router]);

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated: authState.isAuthenticated,
                isAdminUser: authState.isAdminUser,
                isGeneralUser: authState.isGeneralUser,
                loading: authState.loading,
                login,
                logout,
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
