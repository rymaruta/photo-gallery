"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    HomeIcon, MagnifyingGlassIcon, MapIcon, UserIcon,
} from "@heroicons/react/24/outline";
import {
    HomeIcon as HomeSolid, MagnifyingGlassIcon as SearchSolid,
    MapIcon as MapSolid, UserIcon as UserSolid,
} from "@heroicons/react/24/solid";
import { ROUTES } from "../../lib/routes";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { useBottomBarHeight } from "../../lib/hooks/useBottomBarHeight";
import PostSheet from "./PostSheet";

/**
 * 画面下の5つのタブ（ホーム／探す／投稿／マップ／マイページ）。
 *
 * **文言は iOS の `L("…")` に揃える**（「探す」・英語の「My Page」。2026-09-28）。
 * ページの題や見出しの「さがす」は SEO の題に響くので、画面ごとの段で直す。
 *
 * owner が出した新デザインのモック**17枚すべて**に居る。それまでの入口は
 * ヘッダーのハンバーガーだけで、**投稿の入口はマイページの中にしか無かった**。
 *
 * **全ページ・全幅に出す。** 幅で出し分けない——PC だけ「投稿」の入口が
 * 消えることになる（ハンバーガーは マップ／いいねした写真／マイページ／
 * アルバム／管理 で、投稿を持っていない）。カプセルは端末の幅ほど
 * （`max-w-[480px]`）で止めて中央に置くので、広い画面で間延びしない。
 *
 * **寸法と字は px で固定する。** このサイトは 640px 未満で root を 14px に
 * 落とすので、rem の指定（`w-6`・`text-xs`）は端末で 21px・10.5px に縮む
 * （`96eb86db` で踏んだ）。押せる面は 44px 以上（カプセルの内寸 54px）。
 *
 * **高さは `--bottom-bar-h` に出す**（`useBottomBarHeight`）。`MiniPlayer` が
 * それを読んで上に逃げる。**下の隙間と safe-area のぶんも含めた実寸**
 * （`nav` の高さ＝カプセル62＋下の隙間）を出すので、
 * 読み手は safe-area を自分で足してはいけない（足すと notch 端末で
 * 34px 浮く）。`app/globals.css` の `body` は、JS が測るまでの間だけ
 * 同じ形の見積もりを使う。
 *
 * **形は「浮いたカプセル」**（owner の決定 2026-09-27・iOS の `Main.dc.html`
 * ＝案B。`docs/ios-alignment-2026-09-27.md` §7）。画面の端から左右16・下22
 * 離した高さ62・角丸31のすりガラスの帯で、選んでいるタブは白16%の丸い面。
 * **帯の外側（左右と下の隙間）は押せないようにする**（`pointer-events-none`）
 * ——`nav` は下端いっぱいに敷くので、そのままだと隙間に見えている写真や
 * リンクが押せなくなる。押せるのはカプセルの中だけ。
 *
 * **全画面のものより後ろに置く**（z-40）。ギャラリーの拡大表示は z-50、
 * ストーリーは z-[90] なので、どちらもこのバーを覆う。`MiniPlayer` と
 * 同じ z-40 だが、あちらが `--bottom-bar-h` のぶん持ち上がるので重ならない。
 */

/** どのタブを光らせるか。「投稿」は行き先ではないので持たない */
type TabKey = "home" | "search" | "map" | "me";

/**
 * パスからタブを決める。**行き先が1つとは限らない**——マイページは
 * `/users/<id>`（静的）と `/users?id=`（クエリ版）の2形があり、
 * プロフィール設定や下書きも「自分のところ」に見える。
 *
 * 綴りではなく `ROUTES` の値と前置きで見る（直書きの `href` を増やさない）。
 */
export function activeTab(pathname: string): TabKey | null {
    if (pathname === ROUTES.HOME) return "home";
    if (pathname === ROUTES.SEARCH) return "search";
    if (pathname === ROUTES.MAP) return "map";
    if (pathname === "/users" || pathname.startsWith("/users/")) return "me";
    if (pathname.startsWith("/user/")) return "me";
    return null;
}

export default function BottomNav() {
    const pathname = usePathname() || "/";
    const router = useRouter();
    const { isAuthenticated, userId } = useAuth();
    const { locale } = useLocale();
    const barRef = React.useRef<HTMLElement | null>(null);
    const postBtnRef = React.useRef<HTMLButtonElement | null>(null);
    const [sheetOpen, setSheetOpen] = React.useState(false);

    useBottomBarHeight(barRef);

    // **画面が変わったら閉じる。** `PostSheet` は「常駐する場所に置く日が
    // 来たら、そちら側でパスを見比べること」と自分で書いている。ここが
    // その常駐する場所——ページの中の呼び手と違い、遷移では外れない。
    //
    // **形は `HeaderNav` から借りる**（あちらが同じ場面を先に解いている）。
    // とくに、あちらのコメントが名指しで戒めている形をやらないこと:
    // `開いている = (開いたパス === 今のパス)` と書くと「画面が変わったら
    // 閉じる」ではなく「**そのパスに居る間ずっと開いている**」になり、
    // 閉じずに離れて戻ると**触っていないのに開き直す**
    // （最初そう書いて、変異テストで見つけた）。
    const [seenPath, setSeenPath] = React.useState(pathname);
    if (seenPath !== pathname) {
        // 描画のときに1回だけ閉じる（React が「props が変わったら state を
        // 調整する」形として挙げているやり方。effect で setState すると連鎖描画）
        setSeenPath(pathname);
        if (sheetOpen) setSheetOpen(false);
    }

    // **クエリだけ変わる移動（`/users?id=A` → `?id=B`）は、ここでは聞かない。**
    // `PostSheet` が開いている間だけ自分で `popstate` を聞いて閉じる
    // （`PostSheet.tsx:67`）。ここにも置くと二重になり、片方を壊しても
    // 観測できなくなる（`bf3df612`「二重の守りは1本にする」）。
    // 一度書いて、変異テストで素通りして気づいた。

    const openPost = React.useCallback(() => {
        // **投稿できない人はログインへ。** タブは5つとも出したまま——
        // 中央が欠けるとバーの形が崩れる。権限が無い人の事情は
        // `useMemberGate` が投稿画面で出す（同じ文言を2か所に書かない）
        if (!isAuthenticated) {
            router.push(`${ROUTES.LOGIN}?next=${encodeURIComponent(ROUTES.UPLOAD)}`);
            return;
        }
        setSheetOpen(true);
    }, [isAuthenticated, router]);

    const closePost = React.useCallback(() => setSheetOpen(false), []);

    const current = activeTab(pathname);
    const me = isAuthenticated && userId ? ROUTES.USER_PROFILE(userId) : ROUTES.LOGIN;

    const items: Array<{
        key: TabKey; href: string; label: string;
        Outline: typeof HomeIcon; Solid: typeof HomeSolid;
    }> = [
        { key: "home", href: ROUTES.HOME, label: locale === "en" ? "Home" : "ホーム", Outline: HomeIcon, Solid: HomeSolid },
        { key: "search", href: ROUTES.SEARCH, label: locale === "en" ? "Search" : "探す", Outline: MagnifyingGlassIcon, Solid: SearchSolid },
        { key: "map", href: ROUTES.MAP, label: locale === "en" ? "Map" : "マップ", Outline: MapIcon, Solid: MapSolid },
        { key: "me", href: me, label: locale === "en" ? "My Page" : "マイページ", Outline: UserIcon, Solid: UserSolid },
    ];

    // カプセルの中の1マス。選んでいるマスは白16%の丸い面（`Tab`）
    const cell = "flex flex-col items-center justify-center gap-[2px] rounded-full min-h-[44px]";
    const labelStyle: React.CSSProperties = { fontSize: "10px", lineHeight: "12px", letterSpacing: "0.02em" };
    const iconStyle: React.CSSProperties = { width: "22px", height: "22px" };

    return (
        <>
            <nav
                ref={barRef}
                aria-label={locale === "en" ? "Main" : "メインメニュー"}
                // 帯そのものは透明で押せない。**下の隙間は safe-area と大きい方**
                // （ホーム画面から起動した iPhone ではホームインジケーターの上に乗る）
                className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
                style={{
                    paddingBottom: "max(22px, env(safe-area-inset-bottom, 0px))",
                    paddingLeft: "calc(16px + env(safe-area-inset-left, 0px))",
                    paddingRight: "calc(16px + env(safe-area-inset-right, 0px))",
                }}
            >
                <div
                    // 広い画面で間延びしないよう、端末の幅ほどで止める
                    className="tabbar-capsule pointer-events-auto mx-auto grid max-w-[480px] grid-cols-5 rounded-full ring-1 ring-white/14 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
                    style={{ height: "62px", padding: "4px" }}
                >
                    {items.slice(0, 2).map((it) => (
                        <Tab key={it.key} item={it} active={current === it.key} cell={cell} labelStyle={labelStyle} iconStyle={iconStyle} />
                    ))}

                    {/* 「投稿」は行き先ではなく2択のシートを開く（`PostSheet`）。
                        アイコンは iOS と同じ「角丸の四角に＋」 */}
                    <button
                        ref={postBtnRef}
                        type="button"
                        onClick={openPost}
                        aria-haspopup="dialog"
                        aria-expanded={sheetOpen}
                        className={`${cell} text-white/72 hover:text-white transition-colors`}
                        style={{ touchAction: "manipulation" }}
                    >
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
                            <rect x="3" y="3" width="18" height="18" rx="5" />
                            <path d="M12 8v8M8 12h8" />
                        </svg>
                        <span style={labelStyle}>{locale === "en" ? "Post" : "投稿"}</span>
                    </button>

                    {items.slice(2).map((it) => (
                        <Tab key={it.key} item={it} active={current === it.key} cell={cell} labelStyle={labelStyle} iconStyle={iconStyle} />
                    ))}
                </div>
            </nav>

            {sheetOpen && <PostSheet onClose={closePost} locale={locale} restoreRef={postBtnRef} />}
        </>
    );
}

function Tab({ item, active, cell, labelStyle, iconStyle }: {
    item: { key: TabKey; href: string; label: string; Outline: typeof HomeIcon; Solid: typeof HomeSolid };
    active: boolean;
    cell: string;
    labelStyle: React.CSSProperties;
    iconStyle: React.CSSProperties;
}) {
    const Icon = active ? item.Solid : item.Outline;
    return (
        <Link
            href={item.href}
            // **公開ページに常駐するので先読みしない**（`d8884430`）。
            // 静的書き出しなので先読みが引くのは行き先の HTML と `.txt` で、
            // どちらも `no-store` で配る＝画面に出入りするたび落とし直す
            prefetch={false}
            aria-current={active ? "page" : undefined}
            // **選んでいないタブは白72%**（デザインシステムの非選択 `#B8B8B8`）。
            // カプセルは写真が透けるので、白60%だと明るい写真の上で 2.6:1 まで
            // 落ちる（`.tabbar-capsule` の brightness と合わせて 4.5:1 を保つ）。
            // **選択中は白＋白16%の丸い面**（デザインシステム「黒塗りの真鍮」: 下部ナビの
            // アイコンは白。真鍮は合図の色で、選択は担わない）。塗りつぶしのアイコンで形も変わる
            className={`${cell} transition-colors ${active ? "bg-white/16 text-white" : "text-white/72 hover:text-white"}`}
            style={{ touchAction: "manipulation" }}
        >
            <Icon aria-hidden="true" style={iconStyle} />
            {/* 選択中は太字（案B「浮いたカプセル」の選択中＝600）。白と形だけだと、
                PC でカーソルを載せたタブと見分けにくい */}
            <span style={active ? { ...labelStyle, fontWeight: 600 } : labelStyle}>{item.label}</span>
        </Link>
    );
}
