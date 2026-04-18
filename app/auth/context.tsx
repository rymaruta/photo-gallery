"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signIn, signOut, isAuthenticated, isAdmin } from "../../lib/auth/cognito";
import { log } from "../../lib/utils/log";

type AuthContextType = {
    isAuthenticated: boolean;
    isAdminUser: boolean;
    loading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [authState, setAuthState] = useState({
        isAuthenticated: false,
        isAdminUser: false,
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
                // 環境変数が設定されていない場合は認証なしとして扱う
                setAuthState({
                    isAuthenticated: false,
                    isAdminUser: false,
                    loading: false,
                });
                return { authenticated: false, admin: false };
            }

            const authenticated = await isAuthenticated();
            const admin = authenticated ? await isAdmin() : false;

            setAuthState({
                isAuthenticated: authenticated,
                isAdminUser: admin,
                loading: false,
            });

            return { authenticated, admin };
        } catch (error) {
            // 認証チェックでエラーが発生した場合は認証なしとして扱う
            log.warn("Auth check error (non-blocking):", error);
            setAuthState({
                isAuthenticated: false,
                isAdminUser: false,
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
                log.info("AuthContext: 認証成功", { admin, groups: result.groups });
                
                // 認証状態を即座に更新
                setAuthState({
                    isAuthenticated: true,
                    isAdminUser: admin,
                    loading: false,
                });

                // 認証状態の更新を確実にするため、少し待つ
                await new Promise(resolve => setTimeout(resolve, 200));

                // 認証状態を再確認
                const authenticated = await isAuthenticated();
                const adminCheck = authenticated ? await isAdmin() : false;
                
                log.info("AuthContext: 認証状態再確認", { authenticated, adminCheck });
                
                // 再確認した状態で更新
                setAuthState({
                    isAuthenticated: authenticated,
                    isAdminUser: adminCheck,
                    loading: false,
                });

                return { success: true };
            } else {
                console.error("AuthContext: ログイン失敗", result.error);
                setAuthState((prev) => ({ ...prev, loading: false }));
                return { success: false, error: result.error || "ログインに失敗しました" };
            }
        } catch (error: unknown) {
            console.error("AuthContext: ログイン例外", error);
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
            loading: false,
        });
        router.push("/");
    }, [router]);

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated: authState.isAuthenticated,
                isAdminUser: authState.isAdminUser,
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
