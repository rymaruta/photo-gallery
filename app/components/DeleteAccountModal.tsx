"use client";

import React, { useState, useRef, useEffect } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { Locale } from "@/lib/data/photos";
import { useEscapeKey } from "../../lib/hooks/useEscapeKey";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";

type Props = {
    isOpen: boolean;
    /**
     * 閉じたときにフォーカスを戻す先（退会ボタン）。
     *
     * **省略可能にしない。** 既定（開いた瞬間の activeElement）だと、
     * React が autoFocus をエフェクトより前に当てるせいで、控えられるのが
     * このモーダル自身の入力欄になる——閉じるとフォーカスが body に落ちる。
     * 省略できるままだと、次に足した呼び出し元が黙ってその状態に戻る。
     */
    openerRef: React.RefObject<HTMLButtonElement | null>;
    onClose: () => void;
    onConfirm: () => void;
    locale: Locale;
    deleting: boolean;
};

// 退会（アカウント削除）の確認モーダル。
// 不可逆な破壊操作なので、確認語句の type-to-confirm を必須にして誤操作を防ぐ。
// 開くたびに入力を空から始めたいので、中身は別コンポーネントにして開閉で再マウントする。
export default function DeleteAccountModal({ isOpen, ...rest }: Props) {
    if (!isOpen) return null;
    return <DeleteAccountModalInner {...rest} />;
}

function DeleteAccountModalInner({ onClose, onConfirm, locale, deleting, openerRef }: Omit<Props, "isOpen">) {
    const CONFIRM_WORD = locale === "en" ? "DELETE" : "退会";
    const [typed, setTyped] = useState("");

    // 退会処理中は閉じさせない（オーバーレイのクリックと同じ扱い）。
    // Inner は isOpen が真のときだけ描かれるので、ここは無条件でよい
    useEscapeKey(!deleting, onClose);
    // 裏側はプロフィール編集フォーム（保存ボタンがある）
    const dialogRef = useRef<HTMLDivElement | null>(null);
    // **戻り先は親から受け取る。** 既定（開いた瞬間の activeElement）だと、
    // React は autoFocus をエフェクトより前に当てるので、控えられるのは
    // **このモーダルの中の入力欄**。閉じるとその要素ごと消えてフォーカスが
    // body に落ちる——docstring が「戻さないと body に落ちる」と書いている
    // 状態が、戻しているつもりで起きていた。
    useFocusTrap(true, dialogRef, openerRef);
    // 背景を止める（`DeleteConfirmModal` と同じ理由）。Inner は開いている
    // ときだけ描かれるので、マウントと同時に掛けてよい
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    const canDelete = typed.trim() === CONFIRM_WORD && !deleting;

    return (
        <div
            ref={dialogRef}
            // **入り切らないときはスクロールできるようにする。** 横向きの iPhone
            // （高さ 390px）では本体が 432px あり、中央寄せのまま上下が切れて
            // スクロールもできなかった（実測）。キーボードが出るとさらに狭くなる。
            // 本体の `my-auto` で、入るときは今までどおり真ん中に置く
            // （`items-center` だとはみ出した上側がスクロールでも戻らない）。
            className="fixed inset-0 z-50 flex justify-center p-4 overflow-y-auto overscroll-contain"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "en" ? "Delete your account?" : "本当に退会しますか？"}
        >
            {/* オーバーレイ */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                onClick={deleting ? undefined : onClose}
                aria-hidden="true"
            />

            {/* モーダル本体 */}
            <div className="relative z-10 my-auto w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#1c1f25] to-[#141619] ring-1 ring-white/10 shadow-2xl shadow-black/60 p-6 pt-7 story-media-in">
                <div className="relative w-14 h-14 rounded-full bg-red-500/12 ring-1 ring-red-500/25 flex items-center justify-center mx-auto mb-4">
                    <div className="absolute inset-0 rounded-full bg-red-500/20 blur-xl" aria-hidden="true" />
                    <ExclamationTriangleIcon className="relative w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-base font-bold tracking-tight text-white mb-1.5 text-center">
                    {locale === "en" ? "Delete your account?" : "本当に退会しますか？"}
                </h2>
                <p className="text-white/50 text-[13px] mb-5 leading-relaxed text-center">
                    {locale === "en"
                        ? "Your photos, stories, profile, and account will be permanently deleted. This can't be undone."
                        : "あなたの写真・ストーリー・プロフィール・アカウントがすべて完全に削除されます。この操作は取り消せません。"}
                </p>

                {/* type-to-confirm */}
                {/* **結んでいない `<label>` は読み上げに何も渡さない。**
                    ここは「`退会` と打たないと押せない」という、この画面で
                    唯一の進み方を書いた行なのに、入力欄には別の
                    `aria-label`（「確認テキスト」）が付いていた——
                    aria-label が勝つので、**読み上げでは何を打てばいいか
                    一度も言われない**（取り消せない操作の唯一の関門で）。
                    `htmlFor` で結び、見えている文がそのまま名前になるように
                    `aria-label` は外す */}
                <label className="block text-xs text-white/50 mb-1.5" htmlFor="delete-account-confirm">
                    {locale === "en"
                        ? <>Type <span className="font-semibold text-white/80">{CONFIRM_WORD}</span> to confirm</>
                        : <>確認のため <span className="font-semibold text-white/80">{CONFIRM_WORD}</span> と入力してください</>}
                </label>
                <input
                    id="delete-account-confirm"
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    disabled={deleting}
                    autoFocus
                    autoComplete="off"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-red-500/50 transition-colors mb-6"
                    placeholder={CONFIRM_WORD}
                />

                <div className="flex flex-col gap-2.5">
                    <button
                        onClick={onConfirm}
                        disabled={!canDelete}
                        className="w-full py-3 rounded-2xl bg-gradient-to-b from-[#ff4d4d] to-[#e5322f] text-white font-semibold text-[15px] shadow-lg shadow-red-900/40 ring-1 ring-inset ring-white/15 hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                        style={{ touchAction: "manipulation" }}
                    >
                        {deleting && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                        {deleting
                            ? (locale === "en" ? "Deleting..." : "退会処理中...")
                            : (locale === "en" ? "Delete account" : "退会する")}
                    </button>
                    <button
                        onClick={onClose}
                        disabled={deleting}
                        className="w-full py-3 rounded-2xl text-white/60 hover:bg-white/[0.06] hover:text-white/80 active:scale-[0.98] transition text-[15px] font-medium disabled:opacity-50"
                        style={{ touchAction: "manipulation" }}
                    >
                        {locale === "en" ? "Cancel" : "キャンセル"}
                    </button>
                </div>
            </div>
        </div>
    );
}
