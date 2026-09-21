"use client";

import React, { useEffect, useRef, useState } from "react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/utils/scrollLock";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { XMarkIcon, Bars3Icon } from "@heroicons/react/24/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { log } from "../../lib/utils/log";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";
import NotificationsBell from "./NotificationsBell";
import { useFavorites } from "../../lib/hooks/useFavorites";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";

export default function HeaderNav({ className = "" }: { className?: string }) {
    const router = useRouter();
    const { isAuthenticated, isAdminUser, isGeneralUser, userId, logout, loading } = useAuth();
    const { locale, labels } = useLocale();
    const { favorites } = useFavorites();

    useEffect(() => {
        log.info("HeaderNav: 認証状態", { isAuthenticated, isAdminUser, loading });
    }, [isAuthenticated, isAdminUser, loading]);

    const navLabels = labels.navigation || {};
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const subtleInset = "inset 0 1px 0 rgba(255,255,255,0.02)";
    const subtleShadow = "0 1px 8px rgba(0,0,0,0.65)";

    // **「開いた画面」ごと覚える。**
    //
    // このヘッダーはルートレイアウトにあるのでクライアント遷移では
    // 再マウントされず、閉じるのは「メニューのリンクを押す」「Escape」
    // 「× を押す」の3つだけだった。**ブラウザの戻る・進む**では背後の
    // ページだけが変わり、オーバーレイは出したまま、`body` の
    // スクロールロックも残る（× か Escape でしか抜けられない）。
    // スマホの「戻る＝閉じる」という期待とは逆に、遷移だけが起きていた。
    //
    // エフェクトで閉じるのではなく、**描画のときに見比べる**
    // （エフェクトの中で setState すると連鎖描画になる）。
    // パスはメニューを開いても変わらないので、閉じるのは
    // 「実際に画面が変わったとき」だけ。`useGallery` の `?photo=` は
    // クエリなのでここには効かない。
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [seenPath, setSeenPath] = useState(pathname);
    if (seenPath !== pathname) {
        // **描画のときに1回だけ閉じる**（React が公式に「props が変わったら
        // state を調整する」形として挙げているやり方）。エフェクトの中で
        // setState すると連鎖描画になるので、そちらは使わない。
        //
        // **`open = (開いたパス === 今のパス)` にしてはいけない。** それは
        // 「画面が変わったら閉じる」ではなく「**そのパスに居る間ずっと
        // 開いている**」という意味で、閉じる操作を経ずに離れると、戻って
        // きた瞬間に**触っていないのに開き直す**（一度そう書いて回帰にした）。
        setSeenPath(pathname);
        if (open) setOpen(false);
    }
    const panelRef = useRef<HTMLDivElement | null>(null);

    // **クエリだけ変わる移動でも閉じる。**
    //
    // 上の調整は `usePathname` が変わったときにしか効かない。`/users?id=A`
    // → `?id=B`（プロフィールの行き来）や `/user/edit?id=` はパスが同じ
    // なので、戻る・進むでメニューも `body` のスクロールロックも残ったまま、
    // 背後だけが別の人に変わる（スマホの「戻る＝閉じる」と逆）。
    //
    // `useSearchParams` は使わない——ルートレイアウトに置くと静的書き出し
    // 全体に響く。ここで要るのは「履歴を動いた」ことだけなので `popstate` で足りる。
    // 開いている間だけ聞く（閉じているときに開く方へ倒す経路を作らない）。
    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        window.addEventListener("popstate", close);
        return () => window.removeEventListener("popstate", close);
    }, [open]);

    const handleNavigation = (href: string) => {
        setOpen(false);
        router.push(href);
    };


    // Close on Escape key
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    // **開いたらメニューの中へフォーカスを移し、Tab を閉じ込める。**
    //
    // パネルは `createPortal(..., document.body)` で body の末尾に出るので、
    // DOM 順は**ページの一番最後**。開いてから Tab を押すと、フォーカスは
    // メニューではなくその下の本文（写真グリッドの全リンク）へ進み、
    // トップページなら数十個のリンクとフッターを通り抜けないと
    // 「マイページ」「ログアウト」に届かなかった（＝開いても入れない）。
    //
    // 最初はここに手書きで14行置いたが、同じことをする `useFocusTrap` を
    // 別で作ったので寄せた（そちらは Shift+Tab で裏へ抜ける穴も塞ぐ。
    // `aria-modal="true"` なので、抜けた先は読み上げでは「存在しない」場所）。
    const toggleRef = useRef<HTMLButtonElement | null>(null);
    useFocusTrap(open, panelRef, toggleRef);

    // 背景スクロールロック。**共通の実装に寄せた**（`lib/utils/scrollLock.ts`）。
    // ここは `overflow` + `paddingRight` だけの自前実装で、解除は無条件に
    // `""` を書いていた——数を数えているモーダル側と同時に開くと、
    // こちらを閉じただけで向こうのロックまで外れる。
    useEffect(() => {
        if (!open) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [open]);

    const linkBase = "block px-4 py-3.5 whitespace-nowrap text-base transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/10";
    const inactiveClasses = "text-white/90 bg-transparent hover:bg-white/10 hover:text-white";
    const btnStyle: React.CSSProperties = {
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        minHeight: "44px",
        display: "block",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
    };

    return (
        <nav aria-label={locale === "en" ? "Site header" : "ヘッダー"}
             className={`site-header__nav flex items-center gap-2 flex-shrink-0 ${className}`}>
            {/* ユーザーを探す。知り合いを見つけてフォローする導線をどのページからも1タップに */}
            <button
                onClick={() => handleNavigation(ROUTES.USER_SEARCH)}
                aria-label={locale === "en" ? "Find people" : "ユーザーを探す"}
                title={locale === "en" ? "Find people" : "ユーザーを探す"}
                className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", minHeight: "44px", minWidth: "44px" }}
            >
                <MagnifyingGlassIcon className="h-6 w-6" />
            </button>
            {/* 通知ベル: 「あなたの写真が誰かを旅立たせました」が届く */}
            {isAuthenticated && <NotificationsBell />}
            {/* ログイン中は自分のアバターを表示 → ワンタップでマイページ */}
            {isAuthenticated && userId && (
                <button
                    onClick={() => handleNavigation(ROUTES.USER_PROFILE(userId))}
                    aria-label={navLabels.mypage || "My Page"}
                    title={navLabels.mypage || "My Page"}
                    className="rounded-full p-[2px] bg-gradient-to-tr from-fuchsia-500 via-rose-500 to-amber-400 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/30 transition-opacity"
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                    <span className="block rounded-full p-[2px] bg-black">
                        <UserAvatar userId={userId} className="w-8 h-8" iconClassName="w-5 h-5" />
                    </span>
                </button>
            )}
            <button
                ref={toggleRef}
                aria-expanded={open}
                // **開いている間だけ指す。** メニュー本体（`id="site-menu"`）は
                // `open` のときしか描かれない（body へポータルする）ので、
                // 無条件に書くと**閉じている全ページで存在しない id を指す**
                // ——実ビルドの141ページ全部がその状態だった。ARIA は
                // IDREF の指す先が在ることを求める。
                // **状態は `aria-expanded` が伝える**ので、閉じている間に
                // `aria-controls` を落としても読み上げは痩せない。
                aria-controls={open ? "site-menu" : undefined}
                aria-label={open ? "メニューを閉じる" : "メニューを開く"}
                // **E2E はこの目印で引く。** 表示ラベルで引いていたので、
                // 文言を日本語に直した回に `scripts/e2e-smoke.mjs` が
                // 追随できず、**本番デプロイだけが落ちる**形になっていた
                // （スモークは prod のステップにしか無いので staging は緑）。
                // 目印と文言を分けておけば、次に文言を直す人が壊せない。
                data-e2e="menu-toggle"
                onClick={() => setOpen(!open)}
                style={{
                    backgroundColor: bg,
                    border: `2px solid ${outerBorder}`,
                    boxShadow: `${subtleShadow}, ${subtleInset}`,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                    minWidth: "44px",
                    minHeight: "44px",
                }}
                className="inline-flex items-center justify-center w-11 h-11 rounded-md hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
            >
                {open ? <XMarkIcon className="h-6 w-6 text-white" /> : <Bars3Icon className="h-6 w-6 text-white" />}
            </button>

            {/* メニューは body へポータルする。ヘッダーは backdrop-blur を持ち、
                backdrop-filter は CSS 仕様で position:fixed の包含ブロックになるため、
                ヘッダー内に置くと「高さ0の不可視ダイアログ」に潰れる（実害のあった不具合）。 */}
            {open && createPortal(
                <div
                    id="site-menu"
                    role="dialog"
                    aria-modal="true"
                    aria-label={locale === "en" ? "Menu" : "メニュー"}
                    ref={panelRef}
                    className="fixed left-0 right-0 bottom-0 top-[64px] md:top-[72px] z-50"
                >
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={() => setOpen(false)}
                        aria-hidden="true"
                    />

                    {/* Menu panel */}
                    <div
                        className="absolute top-2 right-4 md:right-8 w-[52%] max-w-[220px] rounded-2xl ring-1 ring-white/10 shadow-2xl overflow-hidden story-media-in"
                        style={{ backgroundColor: "#16181c", zIndex: 10 }}
                    >
                        <nav aria-label="メインメニュー">
                            <ul className="flex flex-col m-0 p-0 divide-y divide-white/5" style={{ listStyle: "none" }}>
                                {/* 撮影地マップ: 公開の入口なので誰にでも出す */}
                                <li style={{ margin: 0, padding: 0 }}>
                                    <button onClick={() => handleNavigation(ROUTES.MAP)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.map || "Map"}
                                    </button>
                                </li>
                                {/* いいねした写真: 未ログインの初回訪問者には出さない（空ページになるため）。
                                    ログイン中、または実際にお気に入りがある人にだけ表示する。 */}
                                {(isAuthenticated || favorites.length > 0) && (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.FAVORITES)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.favorites || "Favorites"}
                                        </button>
                                    </li>
                                )}
                                {isAuthenticated && (
                                    <li style={{ margin: 0, padding: "10px 12px 4px" }}>
                                        <span className="text-[10px] tracking-widest uppercase text-white/50">
                                            {navLabels.account || "Account"}
                                        </span>
                                    </li>
                                )}
                                {isAuthenticated && userId && (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.USER_PROFILE(userId))} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.mypage || "My Page"}
                                        </button>
                                    </li>
                                )}
                                {/* 共同アルバム（案C）。**ログイン中だけ**——招待リンクを
                                    配る側の画面で、未ログインには行き先が無い。
                                    文言は他の項目と同じく `navLabels` から取る
                                    （直書きにすると英語UIでここだけ日本語になる） */}
                                {/* **画面と同じ条件で出す。** 行き先は
                                    `useMemberGate`（グループが要る）で守られて
                                    いるので、`isAuthenticated` だけで出すと
                                    グループ未所属の人には**押した先が会員限定の
                                    案内**になる（行き先の無い項目）。
                                    この項目はメニューで唯一の会員限定の行き先 */}
                                {isAuthenticated && (isAdminUser || isGeneralUser) && (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.ALBUMS)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.albums || "Shared Albums"}
                                        </button>
                                    </li>
                                )}
                                {/* 設定（アカウント・プライバシー・サポート）。
                                    **`isAuthenticated` だけで出す**——共同アルバムと
                                    違ってグループ（投稿権限）を見ない。パスワードの
                                    変更と退会は、権限が付かなかった人にこそ要る
                                    （`/user/settings` の門も同じ判断） */}
                                {isAuthenticated && (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.SETTINGS)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.settings || "Settings"}
                                        </button>
                                    </li>
                                )}
                                {isAdminUser && (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.ADMIN)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.admin || "Manage"}
                                        </button>
                                    </li>
                                )}
                                {/* **判定中は出し分けない。** `loading` を受け取っているのに
                                    使っておらず、Cognito のセッション確認が終わる前は
                                    isAuthenticated が false なので、ログイン済みの人にも
                                    一瞬「ログイン / 新規登録」が並んでいた。押すと
                                    ログイン済みのままログイン画面に飛ぶ。
                                    分かるまでは、この行だけ何も出さない。 */}
                                {loading ? (
                                    <li aria-hidden style={{ margin: 0, padding: 0 }}>
                                        <span className={`${linkBase} block opacity-0`} style={{ minHeight: "44px" }}>&nbsp;</span>
                                    </li>
                                ) : isAuthenticated ? (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => { setOpen(false); logout(); }} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.logout || "Logout"}
                                        </button>
                                    </li>
                                ) : (
                                    <>
                                        <li style={{ margin: 0, padding: 0 }}>
                                            <button onClick={() => handleNavigation(ROUTES.LOGIN)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                                {navLabels.login || "Login"}
                                            </button>
                                        </li>
                                        <li style={{ margin: 0, padding: 0 }}>
                                            <button onClick={() => handleNavigation(ROUTES.SIGNUP)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                                {navLabels.signup || "Sign up"}
                                            </button>
                                        </li>
                                    </>
                                )}
                            </ul>
                        </nav>
                    </div>
                </div>,
                document.body,
            )}
        </nav>
    );
}
