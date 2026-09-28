"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    HomeIcon, MagnifyingGlassIcon, MapIcon, UserIcon, PlusIcon,
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
 * 画面下の5つのタブ（ホーム／さがす／投稿／マップ／マイページ）。
 *
 * owner が出した新デザインのモック**17枚すべて**に居る。それまでの入口は
 * ヘッダーのハンバーガーだけで、**投稿の入口はマイページの中にしか無かった**。
 *
 * **全ページ・全幅に出す。** 幅で出し分けない——PC だけ「投稿」の入口が
 * 消えることになる（ハンバーガーは マップ／いいねした写真／マイページ／
 * アルバム／管理 で、投稿を持っていない）。中身はヘッダーと同じ
 * `max-w-5xl` に寄せるので、広い画面で間延びしない。
 *
 * **寸法と字は px で固定する。** このサイトは 640px 未満で root を 14px に
 * 落とすので、rem の指定（`w-6`・`text-xs`）は端末で 21px・10.5px に縮む
 * （`96eb86db` で踏んだ）。押せる面は 56px 以上。
 *
 * **高さは `--bottom-bar-h` に出す**（`useBottomBarHeight`）。`MiniPlayer` が
 * それを読んで上に逃げる。**safe-area のぶんも含めた実寸**を出すので、
 * 読み手は safe-area を自分で足してはいけない（足すと notch 端末で
 * 34px 浮く）。`app/globals.css` の `body` は、JS が測るまでの間だけ
 * 同じ形の見積もりを使う。
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
        { key: "search", href: ROUTES.SEARCH, label: locale === "en" ? "Search" : "さがす", Outline: MagnifyingGlassIcon, Solid: SearchSolid },
        { key: "map", href: ROUTES.MAP, label: locale === "en" ? "Map" : "マップ", Outline: MapIcon, Solid: MapSolid },
        { key: "me", href: me, label: locale === "en" ? "You" : "マイページ", Outline: UserIcon, Solid: UserSolid },
    ];

    const cell = "flex flex-col items-center justify-center gap-[3px] min-h-[56px]";
    const labelStyle: React.CSSProperties = { fontSize: "11px", lineHeight: "13px" };
    const iconStyle: React.CSSProperties = { width: "24px", height: "24px" };

    return (
        <>
            <nav
                ref={barRef}
                aria-label={locale === "en" ? "Main" : "メインメニュー"}
                className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/80 backdrop-blur-md"
                style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            >
                <div className="max-w-5xl mx-auto grid grid-cols-5">
                    {items.slice(0, 2).map((it) => (
                        <Tab key={it.key} item={it} active={current === it.key} cell={cell} labelStyle={labelStyle} iconStyle={iconStyle} />
                    ))}

                    {/* 「投稿」は行き先ではなく2択のシートを開く（`PostSheet`）。
                        真ん中に枠を持つのはモックどおり */}
                    <button
                        ref={postBtnRef}
                        type="button"
                        onClick={openPost}
                        aria-haspopup="dialog"
                        aria-expanded={sheetOpen}
                        className={`${cell} text-white/60 hover:text-white transition-colors`}
                        style={{ touchAction: "manipulation" }}
                    >
                        <span className="flex items-center justify-center rounded-[10px] ring-1 ring-white/20 bg-white/5"
                              style={{ width: "40px", height: "28px" }}>
                            <PlusIcon aria-hidden="true" style={iconStyle} />
                        </span>
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
            // **選択中は白**（デザインシステム「黒塗りの真鍮」: 下部ナビのアイコンは白。
            // 真鍮は合図の色で、選択は担わない）。塗りつぶしのアイコンで形も変わる
            className={`${cell} transition-colors ${active ? "text-white" : "text-white/60 hover:text-white"}`}
            style={{ touchAction: "manipulation" }}
        >
            <Icon aria-hidden="true" style={iconStyle} />
            {/* 選択中は太字（案B「浮いたカプセル」の選択中＝600）。白と形だけだと、
                PC でカーソルを載せたタブと見分けにくい */}
            <span style={active ? { ...labelStyle, fontWeight: 600 } : labelStyle}>{item.label}</span>
        </Link>
    );
}
