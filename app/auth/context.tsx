"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
// **認証 SDK は「使うとき」に読み込む。** `AuthProvider` はルートレイアウトに
// あるので、ここが静的に `auth/cognito` を掴んでいると
// `amazon-cognito-identity-js`（SRP の BigInteger と SHA-256。実測で
// gzip 28KB）が**全ページ**に載る。検索から写真ページに着地する人の
// ほとんどはログインしていないので、その 28KB は丸ごと無駄になる。
// 読むのは「セッションを引く（端末に痕跡があるときだけ）」
// 「ログインする」「ログアウトする」「退会する」の4つの瞬間だけ。
import { lookupSession } from "../../lib/auth/session";
import { cognitoConfig } from "../../lib/auth/config";
import { userFetch, NETWORK_UNREACHABLE_MESSAGE } from "../../lib/utils/api";
import { log } from "../../lib/utils/log";
import { resetFollowingCache } from "../../lib/hooks/useFollow";
import { clearSharedPayload } from "../../lib/utils/shareStore";
import { clearSeenStories, setSeenStoriesUser, removeSeenStoriesUserData } from "../../lib/stories";
import { setFavoritesUser, removeFavoritesUserData } from "../../lib/hooks/useFavorites";

/**
 * アカウントを離れるとき（ログアウト・退会）に、端末に残る
 * 「前の人のデータ」を捨てる。ログイン成功では呼ばない——
 * 共有シート → ログイン → 取り込み、という本流のペイロードを
 * 消してしまうため（resetFollowingCache だけはログインでも呼ぶ。
 * それぞれの呼び出し箇所を参照）。
 */
function clearAccountLocalState(): void {
    // PWA 共有シートのペイロード（写真の実体）。残すと1時間以内に
    // ログインした**別の人**のアップロード画面へ自動取り込みされる
    void clearSharedPayload();
    // 未ログインで付いた既読記録（共有キー）だけ掃除する。
    // **ログイン中のぶんは消さない**——鍵が利用者ごとに分かれたので
    // 前の人の既読が次の人に見えることはもう無く、消していたせいで
    // 同じ人がログインし直すと一度見たストーリーが新着に戻っていた
    clearSeenStories();
}

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

    /**
     * 最後に**確かめられた**認証状態。通信が届かなかった回に前の答えを
     * 保つためだけに使う（`lookupSession` の `unreachable`）。
     */
    const resolvedRef = useRef<{ authenticated: boolean; admin: boolean } | null>(null);
    /**
     * 直前の判定が「確かめられなかった」で終わったか。
     *
     * **確かめ直す契機を増やすのは、この状態のときだけ。** どの画面でも
     * 復帰のたびに確かめ直すと、本当に失効していた人が**編集中に
     * 画面ごと追い出される**機会を増やすことになる（`useMemberGate` の
     * replace は未保存の確認を通らない）。増やしてよいのは
     * 「そもそも答えを持っていない」場合だけ。
     */
    const unresolvedRef = useRef(false);

    /**
     * 「確かめた」を記録する。`checkAuth` を通らない経路
     * （ログイン・ログアウト・退会）からも呼ぶ——呼ばないと、旗が立った
     * ままになって復帰のたびに余計に確かめ直し、`resolvedRef` には
     * 古い答えが残る。
     */
    const markResolved = useCallback((authenticated: boolean, admin: boolean) => {
        unresolvedRef.current = false;
        resolvedRef.current = { authenticated, admin };
    }, []);

    // 認証状態をチェック
    /**
     * 認証状態を確かめ直す。
     *
     * **確かめられなかった回は `null` を返す**（通信が届かず、前の状態を
     * 保った回）。`{authenticated:false}` を返すと「確かめたら未ログイン
     * だった」と区別できず、画面が保っている状態と戻り値が食い違う
     * ——いまの呼び出しは2か所ともこれを読んでいないが、次に読む人が
     * 静かに踏む。`null` にしておけば `tsc` が読む側に扱いを迫る。
     */
    const checkAuth = useCallback(async (): Promise<{ authenticated: boolean; admin: boolean } | null> => {
        try {
            // 設定が解決できない場合は認証機能を無効化
            // （config.ts が検証済みフォールバックを持つため、通常は常に有効）
            const hasCognitoConfig = cognitoConfig.userPoolId && cognitoConfig.clientId;

            if (!hasCognitoConfig) {
                setFavoritesUser(null);
                setSeenStoriesUser(null);
                setAuthState({
                    isAuthenticated: false,
                    isAdminUser: false,
                    isGeneralUser: false,
                    userId: null,
                    loading: false,
                });
                return { authenticated: false, admin: false };
            }

            const { session, unreachable } = await lookupSession();
            if (!session && unreachable) {
                // **「確かめられなかった」を「ログアウトした」にしない。**
                // 電波が届かないだけの回で未ログインに倒すと、`useMemberGate`
                // が `/login` へ replace し、**編集中の文章ごと画面が
                // 入れ替わる**（未保存の確認も通らない）。電波が戻れば
                // 何もせず直るので、本人には理由が分からない。
                // 一度でも確かめられていれば、その状態を保つ。
                // **最初から確かめられない場合は保てない**（前の状態が無い）
                // ので、そのときは今までどおり未ログインで始める
                // ——まだ何も打っていないので失うものが無い。
                // **答えを持っていないことを覚える。** 前の状態が無くて
                // 保てない回（開いた最初から圏外）でも旗は立てる——
                // 立てないと、電波が戻っても確かめ直す契機が来ない
                unresolvedRef.current = true;
                if (resolvedRef.current) {
                    setAuthState((prev) => ({ ...prev, loading: false }));
                    return null;   // 確かめられていない（前の状態を保った）
                }
            }
            const authenticated = session !== null;
            const payload = authenticated ? session!.getIdToken().payload : {};
            const groups: string[] = Array.isArray(payload["cognito:groups"])
                ? payload["cognito:groups"] as string[]
                : [];
            const admin = groups.includes("admin");
            const general = !admin && groups.includes("user");
            const sub = typeof payload["sub"] === "string" ? payload["sub"] : null;

            // お気に入りをこのアカウントのキーに向ける（未ログインなら共有キー）。
            // **setAuthState より先に呼ぶ。** loading が false になった瞬間に
            // usePhotoLikes のフォールバック（serverLiked ?? isFavorite）が
            // 読むキーを確定させておくため（順序に意味がある）。
            // **確かめられた回だけ記録する。** 圏外で保てず未ログインとして
            // 始めた回にこれを書くと、「確かめた答え」として扱われて
            // 旗が下り、電波が戻っても確かめ直さない
            if (!unreachable) {
                unresolvedRef.current = false;
                resolvedRef.current = { authenticated, admin };
            }
            setFavoritesUser(authenticated ? sub : null);
            setSeenStoriesUser(authenticated ? sub : null);
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
            // 成功経路（setFavoritesUser(authenticated ? sub : null)）と対称に、
            // 判定できなかったときも前のユーザーのキーを向いたままにしない
            setFavoritesUser(null);
            setSeenStoriesUser(null);
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
    //
    // **`eslint-disable react-hooks/set-state-in-effect` を外した。**
    // セッションを引く口を `lib/auth/session.ts`（動的 import）に替えたら、
    // 規則が「この effect は state を同期に触らない」と読めるようになり、
    // 抑制が**未使用の指示**として警告に出た（eslint が数える）。
    // 振る舞いは変わっていない——前から `checkAuth` は非同期だった。
    useEffect(() => {
        void checkAuth();
    }, [pathname, checkAuth]);

    /**
     * **別のタブでログアウト・退会したら、こちらのタブも合わせる。**
     *
     * 判定はパス変更のときだけだったので、同じページに留まっている限り
     * このタブは「ログイン中の顔」のまま操作を受け付けていた。トークンは
     * もう無いので、いいね・フォロー・コメントは全部失敗する——しかも
     * 「ログインしてください」ではなく通信エラー扱いに見えるものがあり、
     * 何度も押し直すことになる。退会したあとのタブなら、消えた自分の
     * プロフィールを編集しようとし続ける。
     *
     * amazon-cognito-identity-js はトークンを localStorage の
     * `CognitoIdentityServiceProvider.<clientId>.<user>.*` に置くので、
     * 他タブの signOut は必ず storage イベントとして届く（同じタブの
     * 書き込みでは発火しないので、自分のログアウトと二重にはならない）。
     * lib/hooks/useFavorites.ts が同じ仕掛けでキーを追い直している。
     *
     * ※ 明示ログアウトを通らない失効（リフレッシュトークンの期限切れ）は
     *   ここでは拾えない。書き込みが起きないため storage イベントが無い。
     */
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            // key が null は clear()。関係あるキーの変更だけ拾う
            if (e.key !== null && !e.key.startsWith("CognitoIdentityServiceProvider.")) return;
            void checkAuth();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, [checkAuth]);

    /**
     * **確かめられなかったまま留まらない。**
     *
     * 通信が届かなかった回は前の状態を保つ（`lookupSession` の
     * `unreachable`）が、確かめ直す契機はパス変更と storage イベントしか
     * 無かった。同じページに留まっていると、電波が戻っても・ホテルの
     * Wi-Fi の認証を済ませても**答えを持たないまま**で、本当に失効して
     * いた場合は「ログイン中の顔のまま、押すたびに『ログインして
     * ください』と言われるのに、ログイン画面への導線が無い」になる。
     *
     * **増やすのは「確かめられていない」ときだけ**（`unresolvedRef`）。
     * 常に確かめ直すと、答えを持っている人まで復帰のたびに判定にかけ、
     * 編集中に追い出される機会を増やす。
     */
    useEffect(() => {
        // **二重に走らせない。** 「タブに戻った瞬間に電波も戻った」は
        // いちばん起きやすい復帰の形で、`online` と `visibilitychange` が
        // ほぼ同時に来る。旗を下ろすのは判定が終わってからなので、
        // 札が無いと Cognito のリフレッシュが2本同時に飛ぶ
        let running = false;
        const recheck = () => {
            if (running) return;
            if (!unresolvedRef.current) return;
            if (document.visibilityState === "hidden") return;
            running = true;
            void checkAuth().finally(() => { running = false; });
        };
        window.addEventListener("online", recheck);
        document.addEventListener("visibilitychange", recheck);
        return () => {
            window.removeEventListener("online", recheck);
            document.removeEventListener("visibilitychange", recheck);
        };
    }, [checkAuth]);

    // ログイン
    const login = useCallback(async (username: string, password: string) => {
        setAuthState((prev) => ({ ...prev, loading: true }));

        try {
            log.info("AuthContext: ログイン開始", { usernameLength: username.length });
            const { signIn } = await import("../../lib/auth/cognito");
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
                setFavoritesUser(sub ?? null);
                setSeenStoriesUser(sub ?? null);
                // **ここも「確かめた」。** `checkAuth` を通らない経路なので、
                // 揃えないと旗が立ちっぱなしになり、復帰のたびに余計に
                // 確かめ直す（`resolvedRef` の方は古い答えが残る）
                markResolved(true, admin);
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
    }, [markResolved]);

    // ログアウト
    //
    // **`signOut` を待ってから片付ける。** 先に画面の状態だけ落とすと、
    // 同時に走っている `checkAuth` が「まだ有効なセッション」を見て
    // ログイン中に戻しうる。順序は SDK を静的に読んでいた頃と同じ
    // （`signOut` → 手元の掃除 → 画面 → 遷移）。
    // 呼び手（`HeaderNav`）は戻り値を見ないので、async にしても影響しない
    const logout = useCallback(async () => {
        const { signOut } = await import("../../lib/auth/cognito");
        signOut();
        // フォロー中の一覧はモジュール変数に持っている。ログアウトは
        // クライアント遷移でモジュール状態が残るため、明示的に捨てないと
        // 同じタブで別の人がログインしたときに前の人の一覧が使われる。
        resetFollowingCache();
        clearAccountLocalState();
        setFavoritesUser(null);
        setSeenStoriesUser(null);
        markResolved(false, false);
        setAuthState({
            isAuthenticated: false,
            isAdminUser: false,
            isGeneralUser: false,
            userId: null,
            loading: false,
        });
        router.push("/");
    }, [router, markResolved]);

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
            // **止めること自体は変えない**（不可逆な削除の前に後段が通ることを
            // 確かめる）。分けるのは**理由**だけ——確かめられなかっただけの回に
            // 「ログインし直して」と言うのは嘘で、しかもその通信も通らない。
            // `userFetch` から取り除いた同じ嘘が、ここだけ残っていた
            const { session, unreachable } = await lookupSession();
            if (!session || !session.isValid()) {
                return {
                    success: false,
                    error: unreachable
                        ? NETWORK_UNREACHABLE_MESSAGE
                        : "ログインの有効期限が切れています。一度ログインし直してからお試しください",
                };
            }

            // **打ち切りを伸ばす。** サーバーは残り6秒になるまで使い切る設計で
            // 最長23秒かかる（`api-user/serverless.yml` の timeout: 29 と
            // `account.ts` の CLEANUP_RESERVE_MS）。既定の20秒で降りると、
            // サーバーは走り続けて写真を消すのにこちらは Cognito の削除へ
            // 進まない＝上のコメントが名指しで避けている「写真だけ消えて
            // アカウントが残る」になる
            const res = await userFetch("/user/account", { method: "DELETE", timeoutMs: 35_000 });
            if (!res.ok) {
                // サーバーの文言を捨てない。写真の削除に失敗した 500 は
                // 「アカウントはまだ削除されていません…」と状況まで言って
                // くれる（api-user/src/account.ts）。固定文だけだと、
                // アカウントが残っているのか消えたのか読み取れない。
                let serverError = "";
                try {
                    const data = await res.json() as { error?: unknown };
                    if (typeof data.error === "string") serverError = data.error;
                } catch { /* JSON でなければ既定文 */ }
                return { success: false, error: serverError || "退会処理に失敗しました。時間をおいて再度お試しください" };
            }
            const { deleteAccount: cognitoDeleteAccount, signOut } = await import("../../lib/auth/cognito");
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
            // useCallback の deps は [router] のままにする（authState を読むと
            // stale closure になる）。userId は手元の session から取る
            const subClaim = (session.getIdToken() as { payload?: Record<string, unknown> } | undefined)?.payload?.["sub"];
            const deletedUserId = typeof subClaim === "string" ? subClaim : null;
            signOut();
            // ログアウトと同じ掃除（useFollow.ts の doc「ログアウト時に必ず
            // 呼ぶこと」）。退会経路だけ抜けていて、同じタブで次に登録した
            // 人に前の人のフォロー一覧が使われる形が残っていた。
            resetFollowingCache();
            clearAccountLocalState();
            setFavoritesUser(null);
            setSeenStoriesUser(null);
            // 同じ userId では二度とログインできない。読めない鍵付きの
            // ハート一覧を端末に残さない
            if (deletedUserId) removeFavoritesUserData(deletedUserId);
            if (deletedUserId) removeSeenStoriesUserData(deletedUserId);
            markResolved(false, false);
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
    }, [router, markResolved]);

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
