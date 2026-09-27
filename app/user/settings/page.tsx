"use client";

/**
 * 設定（⑫・owner の新デザイン 2026-09-21）。
 *
 * **新しく作ったのは「1枚に集めた」ことだけ。** 中身（メールアドレス変更・
 * パスワード変更・全端末ログアウト・退会・ブロックした人）は
 * `app/user/profile/page.tsx` に既にあったものをそのまま移した。
 *
 * **プロフィールの編集は移していない。** 表示名・@名・自己紹介・アバター・
 * カバー・リンク・テーマ色・BGM・ピン留めは「他人に見える自分」を作る作業で、
 * 設定ではない。あちらに残っている。
 *
 * ## 置かなかった節（モックには在るが、実装が無い）
 *
 * owner の指示「デザインだけ完成して操作できない画面は作らない」に従い、
 * **中身の無い枠は並べない**:
 *
 *   広告の設定          Web 版に広告の実装が1行も無い（AdMob は iOS の別指示書）
 *   通知の設定          何を受け取るかを選ぶ実装が無い。作るなら機能から
 *   データとストレージ  操作できる実体が Service Worker の写真キャッシュ
 *                       （`journey-photo-img-v1`）しか無く、それを消す口を
 *                       作るのは新機能
 *   ヘルプ              無い
 *   アプリについて      **中身が作れない**。クライアントにバージョン文字列が
 *                       出ていない（`package.json` は読めず `NEXT_PUBLIC_*`
 *                       にも無い）ので、置くと プライバシーポリシーと利用規約
 *                       へのリンクがもう一度並ぶだけの枠になる
 *
 * ## 門は `useMemberGate` を使わない
 *
 * あれは**グループ（投稿権限）まで見る**。登録直後の
 * `AdminAddUserToGroup` が落ちた人は `no-group` になるが、その人にも
 * パスワードの変更と退会は要る——むしろ**権限が付かなかった人ほど
 * 退会したい**。ここはログインしているかどうかだけ見る。
 *
 * 打ちかけを留める仕掛け（`hasUnsavedWork`）も持たない。プロフィール編集の
 * それは「書いた文章を消さない」ためのものだが、ここの入力欄は
 * **ログインが切れたら完了しようが無い**もの（パスワード・確認コード）で、
 * しかもパスワードは画面に残したくない。素直にログインへ送る。
 */

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useToast } from "../../../lib/hooks/useToast";
import { ROUTES } from "../../../lib/routes";
import { useLoginRedirect } from "../../../lib/hooks/useLoginRedirect";
import { siteConfig } from "../../../lib/utils/seo";
import DeleteAccountModal from "../../components/DeleteAccountModal";
import {
    changePassword,
    PASSWORD_RULE_MESSAGE,
    getCurrentEmail,
    startEmailChange,
    confirmEmailChange,
    signOutEverywhere,
} from "../../../lib/auth/cognito";
import BlockedUsers from "./BlockedUsers";

export default function SettingsPage() {
    const { isAuthenticated, loading, deleteAccount } = useAuth();
    const { locale } = useLocale();
    const router = useRouter();
    const { showToast } = useToast();

    // パスワード変更
    const [curPassword, setCurPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);

    // メールアドレス変更。**2段**——新しいアドレスにコードを送り、
    // そのコードで確定する。確定するまで古いアドレスでログインできる
    // （プールの `AttributesRequireVerificationBeforeUpdate` が効いている。
    //  本番に入っていることは `diagnose` で実測した）
    // **「まだ」と「読めなかった」を分ける。** `getCurrentEmail()` は失敗しても
    // `null` を返すので、初期値と同じにすると**「読み込み中」のまま永久に止まる**
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [emailLoad, setEmailLoad] = useState<"loading" | "ok" | "failed">("loading");
    const [newEmail, setNewEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    // コードを送った先。**送ったアドレスを覚えておく**——欄を書き換えられても
    // 「どこに届いたか」を言い続けるため
    const [emailPending, setEmailPending] = useState<string | null>(null);
    const [emailBusy, setEmailBusy] = useState(false);

    // すべての端末からログアウト。**いまの端末も含む**ので、押した人はここも
    // ログインし直しになる（画面でそう言う）
    const [signingOutAll, setSigningOutAll] = useState(false);

    // 退会（アカウント削除）
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    // 退会モーダルを閉じたときの戻り先（モーダル内の autoFocus に奪われるため明示）
    const deleteAccountBtnRef = useRef<HTMLButtonElement | null>(null);
    const [deletingAccount, setDeletingAccount] = useState(false);

    // 送り方は `useLoginRedirect`（`useMemberGate` と `/user/profile` も同じ口）。
    // **条件だけがここの判断**——グループ（投稿権限）は見ない。
    // 打ちかけを留める仕掛けも持たない（理由はファイル冒頭）
    useLoginRedirect(!loading && !isAuthenticated);

    // いま登録されているアドレスを出す（何から何に変えるのかが分からないと押せない）。
    // **変えたあとは読み直さない**——ID トークンは作られた時点の写しで、
    // 次に更新されるまで古い値のまま（`getCurrentEmail` のコメントを見よ）
    useEffect(() => {
        let aborted = false;
        void (async () => {
            const e = await getCurrentEmail();
            if (aborted) return;
            setCurrentEmail(e);
            setEmailLoad(e ? "ok" : "failed");
        })();
        return () => { aborted = true; };
    }, []);

    const handleStartEmailChange = async () => {
        if (emailBusy) return;
        const next = newEmail.trim();
        // 送る前に断れるものだけ断る（形の細かい判定はサーバーに任せる）
        if (!next) return;
        // 読めていない（`currentEmail` が null）ときは、空でない文字列が
        // それと等しくなることは無いので**そのまま素通りする**
        if (next === currentEmail) {
            showToast(locale === "en" ? "That is already your email address." : "いまのメールアドレスと同じです", "error");
            return;
        }
        setEmailBusy(true);
        try {
            const result = await startEmailChange(next);
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to send the code." : "確認コードを送れませんでした"), "error");
                return;
            }
            setEmailPending(next);
            setEmailCode("");
            showToast(locale === "en"
                ? `A confirmation code was sent to ${next}. Your current address still works until you confirm.`
                : `${next} に確認コードを送りました。確定するまでは、いまのアドレスでログインできます`, "success");
        } finally {
            setEmailBusy(false);
        }
    };

    const handleConfirmEmailChange = async () => {
        if (emailBusy || !emailCode.trim()) return;
        setEmailBusy(true);
        try {
            const result = await confirmEmailChange(emailCode);
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to change your email." : "メールアドレスを変更できませんでした"), "error");
                return;
            }
            // **自分が知っている新しい値を出す**（トークンはまだ古い）
            setCurrentEmail(emailPending);
            setEmailLoad("ok");
            setEmailPending(null);
            setNewEmail("");
            setEmailCode("");
            showToast(locale === "en"
                ? "Your email address has been changed. Use it to sign in from now on."
                : "メールアドレスを変更しました。次からはこのアドレスでログインしてください", "success");
        } finally {
            setEmailBusy(false);
        }
    };

    /**
     * **送る前に断るのは、こちらで確かめられる条件だけ。**
     *
     * プールの規則は8文字以上＋英大小・数字・記号（`provision-env.js:410`）だが、
     * **本番のプールが今もその設定かはコードからは確かめられない**——
     * ここで規則を写して厳しく断ると、プールが通すパスワードを画面だけが
     * 拒む側に倒れる。なので長さと空欄と「同じもの」だけ見て、残りは
     * サーバーの `InvalidPasswordException` に言わせる。
     */
    const handleChangePassword = async () => {
        if (changingPassword) return;
        if (!curPassword || !newPassword) return;
        if (newPassword.length < 8) {
            showToast(PASSWORD_RULE_MESSAGE, "error");
            return;
        }
        if (newPassword === curPassword) {
            showToast(locale === "en" ? "The new password is the same as the current one." : "いまのパスワードと同じです", "error");
            return;
        }
        setChangingPassword(true);
        try {
            const result = await changePassword(curPassword, newPassword);
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to change password." : "パスワードを変更できませんでした"), "error");
                return;
            }
            // **打った中身を画面に残さない。** 次に誰かがこの端末を触ったとき、
            // 入力欄に残っていると読める（`type="password"` でも devtools で見える）
            setCurPassword("");
            setNewPassword("");
            // Cognito はパスワードを変えてもいまのトークンを失効させないので、
            // ログインし直す必要は無い。**そう言わないと「他の端末はどうなる？」に
            // 答えられない**ので、そこまで書く
            showToast(locale === "en"
                ? "Password changed. You stay signed in on this device; other devices stay signed in until their session expires."
                : "パスワードを変更しました。この端末はログインしたままです（他の端末は、そのセッションが切れるまでログインしたままになります）", "success");
        } finally {
            setChangingPassword(false);
        }
    };

    /**
     * **パスワードを変えても他の端末は生きたまま**——Cognito はパスワードの
     * 変更で既存のトークンを失効させない。漏れたかもしれない端末を止める
     * 手段がサイトに1つも無かったので、その口。
     */
    const handleSignOutEverywhere = async () => {
        if (signingOutAll) return;
        setSigningOutAll(true);
        try {
            const result = await signOutEverywhere();
            if (!result.success) {
                showToast(result.error || (locale === "en" ? "Failed to sign out." : "ログアウトできませんでした"), "error");
                return;
            }
            showToast(locale === "en"
                ? "Signed out on all devices. Please sign in again."
                : "すべての端末からログアウトしました。もう一度ログインしてください", "success");
            // **ここもログアウトしている**ので、ログイン画面へ送る。
            // 残すと「ログイン中の顔のまま、押すたびに失敗する」状態になる
            router.replace(ROUTES.LOGIN);
        } finally {
            setSigningOutAll(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeletingAccount(true);
        try {
            const result = await deleteAccount();
            if (result.success) {
                // deleteAccount 内でトップへ遷移済み。トーストで結果を伝える。
                showToast(locale === "en" ? "Your account has been deleted." : "退会が完了しました。ご利用ありがとうございました。", "success");
            } else {
                showToast(result.error || (locale === "en" ? "Failed to delete account." : "退会処理に失敗しました。"), "error");
                setShowDeleteModal(false);
            }
        } catch {
            showToast(locale === "en" ? "Failed to delete account." : "退会処理に失敗しました。", "error");
            setShowDeleteModal(false);
        } finally {
            setDeletingAccount(false);
        }
    };

    // **送り返すまでの間も描かない。** `loading` だけ見ていたので、
    // 未ログインで開くと `router.replace` が効くまでの1描画ぶん、
    // メールアドレス・パスワード・退会の並んだ画面が**丸ごと見えていた**
    // （移設元の `/user/profile` は `loading || fetching` で塞いでいた）。
    if (loading || !isAuthenticated) {
        return (
            <main className="min-h-screen bg-bg text-white flex items-center justify-center">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。
                    JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">設定</h1>
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-colors";
    const labelClass = "block text-xs text-white/50 mb-1.5 tracking-wide";
    // **`/50` より薄くしない。** 黒地で `/40` は 3.66:1 で基準（4.5:1）に
    // 届かない——`/50` が届く最小の段階（`textContrast.test.ts` が見張る）
    const sectionLabelClass = "text-[11px] tracking-widest uppercase text-white/50 mb-2";
    const cardClass = "rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-4 space-y-3";
    const subtleButtonClass = "w-full py-2.5 rounded-xl bg-white/5 text-white text-sm font-medium ring-1 ring-inset ring-white/15 hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2";
    // 外の画面へ渡す行。押せる高さ（44px）を保つ
    const rowLinkClass = "flex items-center justify-between rounded-xl px-3 -mx-1 text-sm text-white/90 hover:bg-white/5 transition";

    return (
        <main className="min-h-screen bg-bg text-white">
            <div className="max-w-sm mx-auto px-4 pt-12 pb-16">
                <Link
                    href="/"
                    // **公開ページは先読みしない**……のだが、ここはログイン後の
                    // 画面なので免除側（`linkPrefetch.test.ts` の EXEMPT）
                    className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/60 transition-colors mb-10"
                >
                    <ArrowLeftIcon className="w-3 h-3" />
                    {locale === "en" ? "Back" : "戻る"}
                </Link>

                <h1 className="text-xl font-bold mb-6">
                    {locale === "en" ? "Settings" : "設定"}
                </h1>

                {/* ── アカウント ───────────────────────────────── */}
                <section>
                    <h2 className={sectionLabelClass}>
                        {locale === "en" ? "Account" : "アカウント"}
                    </h2>
                    <div className={cardClass}>
                        {/* メールアドレスの変更。
                            **メールがログインID**（プールの `AliasAttributes` が
                            email）なので、変える手段が無いと「メールを変えた人は
                            アカウントごと失う」——退会して作り直す以外に無く、
                            写真・いいね・フォロワー・共有したURLが全部消えていた。 */}
                        <p className="text-sm font-semibold text-white/90">
                            {locale === "en" ? "Change email address" : "メールアドレスを変更"}
                        </p>
                        <p className="text-xs text-white/50 leading-relaxed">
                            {locale === "en" ? "Sign-in address" : "ログインに使うアドレス"}:{" "}
                            <span className="text-white/80">{currentEmail ?? (emailLoad === "failed"
                                ? (locale === "en" ? "(couldn't read it — you can still change it below)" : "（読み取れませんでした。下から変更はできます）")
                                : (locale === "en" ? "(loading)" : "（読み込み中）"))}</span>
                        </p>
                        {emailPending === null ? (
                            <>
                                <div>
                                    <label className={labelClass} htmlFor="settings-new-email">
                                        {locale === "en" ? "New email address" : "新しいメールアドレス"}
                                    </label>
                                    <input
                                        id="settings-new-email"
                                        type="email"
                                        // **本人の連絡先**なので `email`（パスワード管理を汚さない）
                                        autoComplete="email"
                                        inputMode="email"
                                        aria-describedby="settings-email-note"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        disabled={emailBusy}
                                        className={inputClass}
                                    />
                                    <p id="settings-email-note" className="mt-1.5 text-xs text-white/50 leading-relaxed">
                                        {locale === "en"
                                            ? "We'll send a confirmation code to the new address. Your current address keeps working until you confirm."
                                            : "新しいアドレスに確認コードを送ります。確定するまでは、いまのアドレスでログインできます"}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleStartEmailChange()}
                                    disabled={emailBusy || !newEmail.trim()}
                                    className={subtleButtonClass}
                                    style={{ touchAction: "manipulation", minHeight: "44px" }}
                                >
                                    {emailBusy && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                    {locale === "en" ? "Send confirmation code" : "確認コードを送る"}
                                </button>
                            </>
                        ) : (
                            <>
                                <div>
                                    <label className={labelClass} htmlFor="settings-email-code">
                                        {locale === "en" ? `Code sent to ${emailPending}` : `${emailPending} に送ったコード`}
                                    </label>
                                    <input
                                        id="settings-email-code"
                                        type="text"
                                        // 届いたコードを自動で入れられるようにする
                                        autoComplete="one-time-code"
                                        inputMode="numeric"
                                        value={emailCode}
                                        onChange={(e) => setEmailCode(e.target.value)}
                                        disabled={emailBusy}
                                        className={inputClass}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleConfirmEmailChange()}
                                    disabled={emailBusy || !emailCode.trim()}
                                    className={subtleButtonClass}
                                    style={{ touchAction: "manipulation", minHeight: "44px" }}
                                >
                                    {emailBusy && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                    {locale === "en" ? "Change email address" : "メールアドレスを変更する"}
                                </button>
                                {/* **やめる道を残す。** コードが届かない／打ち間違えた人が
                                    ここで詰まると、設定画面から出るしか無くなる */}
                                <button
                                    type="button"
                                    onClick={() => { setEmailPending(null); setEmailCode(""); }}
                                    disabled={emailBusy}
                                    className="w-full py-2 text-xs text-white/50 hover:text-white/80 transition disabled:opacity-40"
                                    style={{ touchAction: "manipulation" }}
                                >
                                    {locale === "en" ? "Cancel and use a different address" : "やめる（別のアドレスにする）"}
                                </button>
                            </>
                        )}

                        <div className="pt-1 border-t border-white/10" />

                        {/* **パスワードの変更は <form> で送り、ユーザー名の欄も置く。**
                            iOS のパスワード管理（キーチェーン）は、フォームの送信と
                            `autocomplete="username"` の欄を手がかりに「パスワードを
                            更新しますか」と聞く。ボタンの onClick だけで送っていた頃は
                            新しいパスワードを覚えず、次のログインで古い方が入って失敗した。
                            ユーザー名の欄は見せない（`hidden` で支援技術からも外れる。読み取り専用）。 */}
                        <form
                            className="space-y-3"
                            onSubmit={(e) => { e.preventDefault(); void handleChangePassword(); }}
                        >
                        <input
                            type="text"
                            name="username"
                            autoComplete="username"
                            value={currentEmail ?? ""}
                            readOnly
                            hidden
                            aria-label={locale === "en" ? "Username" : "ユーザー名"}
                            tabIndex={-1}
                        />
                        <p className="text-sm font-semibold text-white/90">
                            {locale === "en" ? "Change password" : "パスワードを変更"}
                        </p>
                        <div>
                            <label className={labelClass} htmlFor="settings-current-password">
                                {locale === "en" ? "Current password" : "いまのパスワード"}
                            </label>
                            <input
                                id="settings-current-password"
                                type="password"
                                // ブラウザとパスワード管理に「いまのもの」と伝える。
                                // 付けないと新しい方を保存候補にされる
                                autoComplete="current-password"
                                value={curPassword}
                                onChange={(e) => setCurPassword(e.target.value)}
                                disabled={changingPassword}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass} htmlFor="settings-new-password">
                                {locale === "en" ? "New password" : "新しいパスワード"}
                            </label>
                            <input
                                id="settings-new-password"
                                type="password"
                                autoComplete="new-password"
                                // **満たせないと進めない条件は、読み上げにも渡す**
                                aria-describedby="settings-password-rule"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                disabled={changingPassword}
                                className={inputClass}
                            />
                            <p id="settings-password-rule" className="mt-1.5 text-xs text-white/50 leading-relaxed">
                                {PASSWORD_RULE_MESSAGE}
                            </p>
                        </div>
                        <button
                            type="submit"
                            // **押せるのに必ず失敗する形にしない。** 空欄のうちは
                            // 押しても往復するだけ
                            disabled={changingPassword || !curPassword || !newPassword}
                            className={subtleButtonClass}
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {changingPassword && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                            {changingPassword
                                ? (locale === "en" ? "Changing..." : "変更中...")
                                : (locale === "en" ? "Change password" : "パスワードを変更する")}
                        </button>
                        </form>

                        <div className="pt-1 border-t border-white/10" />

                        {/* すべての端末からログアウト。
                            **パスワードを変えても他の端末は生きたまま**——Cognito は
                            パスワードの変更で既存のトークンを失効させないので、漏れた
                            かもしれない端末を止める手段がサイトに1つも無かった。
                            消す操作ではないので「危険な操作」には置かない。 */}
                        <p className="text-sm font-semibold text-white/90">
                            {locale === "en" ? "Sign out on all devices" : "すべての端末からログアウト"}
                        </p>
                        <p className="text-xs text-white/50 leading-relaxed">
                            {locale === "en"
                                ? "Signs out everywhere, including this device. Use this if you changed your password because you think someone else got in — a password change alone does not sign other devices out."
                                : "この端末を含め、すべての端末からログアウトします。パスワードを変えただけでは他の端末はログインしたままなので、誰かに入られたかもしれないときはこちらも押してください"}
                        </p>
                        <button
                            type="button"
                            onClick={() => void handleSignOutEverywhere()}
                            disabled={signingOutAll}
                            className={subtleButtonClass}
                            style={{ touchAction: "manipulation", minHeight: "44px" }}
                        >
                            {signingOutAll && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                            {signingOutAll
                                ? (locale === "en" ? "Signing out..." : "ログアウト中...")
                                : (locale === "en" ? "Sign out on all devices" : "すべての端末からログアウトする")}
                        </button>
                    </div>
                </section>

                {/* ── プライバシー ─────────────────────────────── */}
                <section className="mt-10 pt-6 border-t border-white/10">
                    <h2 className={sectionLabelClass}>
                        {locale === "en" ? "Privacy" : "プライバシー"}
                    </h2>
                    {/* ブロックした人（1人も居なければ何も描かない）。
                        **解除できる場所がここしか無い**——ストーリーの返信から
                        ブロックできるようにしたぶん、戻す口が要る */}
                    <BlockedUsers locale={locale as "ja" | "en"} />
                    <div className={cardClass}>
                        {/* **在るものだけ並べる。** この2つは実在するページ
                            （`app/privacy` / `app/terms`）。同じ節に「広告の
                            設定」を置きかけたが、Web 版に広告の実装が無いので
                            落とした（ファイル冒頭の一覧を見よ） */}
                        <Link
                            href={ROUTES.PRIVACY}
                            className={rowLinkClass}
                            style={{ minHeight: "44px", touchAction: "manipulation" }}
                        >
                            <span>{locale === "en" ? "Privacy policy" : "プライバシーポリシー"}</span>
                            <span aria-hidden="true" className="text-white/50">›</span>
                        </Link>
                        <Link
                            href={ROUTES.TERMS}
                            className={rowLinkClass}
                            style={{ minHeight: "44px", touchAction: "manipulation" }}
                        >
                            <span>{locale === "en" ? "Terms of use" : "利用規約"}</span>
                            <span aria-hidden="true" className="text-white/50">›</span>
                        </Link>
                    </div>
                </section>

                {/* ── サポート ─────────────────────────────────── */}
                {/* **宛先が空なら節ごと描かない。** `NEXT_PUBLIC_CONTACT_EMAIL`
                    は `deploy.yml` が直書きで渡していて（`publicEnvWiring.test.ts`
                    が空に戻っていないことまで見張る）本番では出るが、それを
                    前提にして空の枠を残さない——`privacy` / `terms` /
                    `MemberOnlyNotice` も同じ形で守っている */}
                {siteConfig.contactEmail && (
                    <section className="mt-10 pt-6 border-t border-white/10">
                        <h2 className={sectionLabelClass}>
                            {locale === "en" ? "Support" : "サポート"}
                        </h2>
                        <div className={cardClass}>
                            <a
                                href={`mailto:${siteConfig.contactEmail}`}
                                className={rowLinkClass}
                                style={{ minHeight: "44px", touchAction: "manipulation" }}
                            >
                                <span>{locale === "en" ? "Contact us" : "お問い合わせ"}</span>
                                <span className="text-xs text-white/50">{siteConfig.contactEmail}</span>
                            </a>
                        </div>
                    </section>
                )}

                {/* ── 危険な操作 ───────────────────────────────── */}
                <section className="mt-10 pt-6 border-t border-white/10">
                    <h2 className="text-[11px] tracking-widest uppercase text-danger/70 mb-2">
                        {locale === "en" ? "Danger zone" : "危険な操作"}
                    </h2>
                    <div className="rounded-2xl bg-danger/[0.05] ring-1 ring-danger/15 p-4">
                        <p className="text-sm font-semibold text-white/90 mb-1">
                            {locale === "en" ? "Delete account" : "退会（アカウント削除）"}
                        </p>
                        <p className="text-xs text-white/50 leading-relaxed mb-3">
                            {locale === "en"
                                ? "Permanently deletes your photos, stories, profile, and account. This can't be undone."
                                : "写真・ストーリー・プロフィール・アカウントをすべて完全に削除します。取り消しはできません。"}
                        </p>
                        <button
                            type="button"
                            ref={deleteAccountBtnRef}
                            onClick={() => setShowDeleteModal(true)}
                            className="w-full py-2.5 rounded-xl bg-transparent text-danger text-sm font-medium ring-1 ring-inset ring-danger/30 hover:bg-danger/10 active:scale-[0.98] transition"
                            style={{ touchAction: "manipulation" }}
                        >
                            {locale === "en" ? "Delete my account" : "退会する"}
                        </button>
                    </div>
                </section>
            </div>

            <DeleteAccountModal
                openerRef={deleteAccountBtnRef}
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={() => void handleDeleteAccount()}
                locale={locale}
                deleting={deletingAccount}
            />
        </main>
    );
}
