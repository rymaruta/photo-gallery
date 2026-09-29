"use client";

import React from "react";
import Link from "next/link";
import { BookmarkIcon as BookmarkOutline } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid, HeartIcon as HeartSolid } from "@heroicons/react/24/solid";
import { HeartIcon as HeartOutline } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useSavedSpots } from "../../lib/hooks/useSavedSpots";
import { useToast } from "../../lib/hooks/useToast";
import { loginWithNext } from "../../lib/routes";
import { spotSavedKey } from "../../lib/utils/savedSpotKey";

/**
 * 撮影スポットを「行きたい場所」に保存するボタン。
 *
 * **写真の「保存」とは別物。** あちらは写真を、こちらは場所を保存する
 * （サーバーの入れ物も別 ＝ `spots#<uid>`）。
 *
 * ## 保存できるのは2種類（`kind`）
 *
 *  - `location` … 撮影地の集約ページ（`/location/<スラッグ>`）。**これまでの形**
 *  - `spot` … 公式撮影地ガイド（`/spots/<スラッグ>`）。鍵に頭が付く
 *
 * **鍵の作り方はここに書かない**——`lib/utils/savedSpotKey.ts` 1つが持つ
 * （同じ規則が2か所にあると、片方だけ直したときに静かにずれる）。
 * **API は1行も変えていない**：サーバーは「`#` を含まない文字列」を
 * 受けるだけで、種別を知らない。
 *
 * ## 3つの状態を混ぜない
 *
 *  - **まだ分からない**（ログイン確認中・取得中）… 押させない。`false` に
 *    倒すと「行きたい」に見えてから「保存済み」に変わり、その一瞬に押すと
 *    解除ではなく保存が飛ぶ
 *  - **未ログイン** … ボタンではなく**ログインへのリンク**にする。
 *    押してから「ログインしてください」と言われるより短い
 *  - **ログイン済み** … 押せる
 *
 * ## 形は2つ（`variant`）
 *
 *  - `pill` … 撮影地ページ（これまでの形・しおりの印）
 *  - `tile` … 撮影スポットのページ。iOS の `SpotDetailParts.actionLabel` と同じ
 *    **高さ48・角12・ハートの印**、押した状態は白地（2026-09-29）。
 *    **並べる親は `grid grid-cols-3`**（`flex-1` だと、外箱で包んだ側だけ
 *    内側の余白ぶん狭くなる——実測 82 / 96 / 96px）。外箱は作らず、失敗の断りは
 *    行の下に1段ぶち抜きで出す（`col-span-3`・細い列に押し込まない）。
 *    🔴 **断りには `order-last` が要る。** 格子は前の空きへ戻って詰めないので、
 *    「行きたい」の直後に3列ぶんの断りがあると、地図とシェアが3段目へ落ちる
 *    （Chromium 実測: 1段目は「行きたい」だけ）。DOM の順は変えない＝読み上げの順も同じ。
 *    ⚠️ **Tab の順は見た目と逆になる**: 失敗中は「行きたい」が押せないので、行の最初の
 *    止まり先が2段目の「再試行」→ 1段目の地図・シェア。意図した形（断りは対象の直後に
 *    読ませる）。揃えるには失敗の状態を親へ持ち上げて格子の外に出す作り替えが要る
 *    字は iOS と同じ短い文言（`Want to go`）で、読み込み中も字を変えない
 *    （「読み込み中…」は狭い列で溢れる。まだ分からないことは押せない＋`aria-busy` で伝える）
 *
 * ## 大きさは px で書く
 *
 * 640px 未満で root が 14px になるので、`w-11` は 38.5px に縮む
 * （台帳 `96eb86db`）。指で押す的は 44px を保つ。
 */
export default function SaveSpotButton({
    slug,
    name,
    locale,
    kind = "location",
    variant = "pill",
}: {
    slug: string;
    name: string;
    locale: "ja" | "en";
    /** 既定は撮影地（これまでの形）。公式ガイドのスポットは `"spot"` */
    kind?: "location" | "spot";
    /** 見た目。既定は撮影地ページの丸い札（上の注記） */
    variant?: "pill" | "tile";
}) {
    const en = locale === "en";
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { isSaved, toggle, busy, failed, retry } = useSavedSpots(isAuthenticated, authLoading);
    const { showToast } = useToast();

    // **保存の鍵。** 撮影地はスラッグそのまま、公式スポットは頭を付ける
    const key = kind === "spot" ? spotSavedKey(slug) : slug;
    const saved = isSaved(key);
    const working = busy === key;
    const tile = variant === "tile";
    const base = tile ? TILE : BTN;
    // 印: 札はしおり、スポットのタイルはハート（iOS と同じ）
    const IconOff = tile ? HeartOutline : BookmarkOutline;
    const IconOn = tile ? HeartSolid : BookmarkSolid;
    // タイルの印は縮ませない（狭い列で字に押されて幅0まで潰れた・英語の 320px）
    const iconClass = tile ? `${TILE_ICON}` : "w-5 h-5";
    const wantLabel = tile ? (en ? "Want to go" : "行きたい") : (en ? "Save to want-to-go" : "行きたい");

    // 未ログインはログインへ。**戻り先は今のページ**（押した場所に返す）
    if (!authLoading && !isAuthenticated) {
        return (
            <Link
                href={loginWithNext(typeof window === "undefined" ? null : window.location.pathname)}
                prefetch={false}
                className={tile ? `${base} min-w-0 ${TILE_OFF}` : base}
                style={{ touchAction: "manipulation", minHeight: tile ? 48 : 44 }}
            >
                <IconOff className={iconClass} aria-hidden />
                {tile ? <span className={TILE_TEXT}>{wantLabel}</span> : wantLabel}
            </Link>
        );
    }

    const onClick = async () => {
        const ok = await toggle(key);
        if (!ok) {
            showToast(en ? "Couldn't update. Please try again." : "更新できませんでした。もう一度お試しください。", "error");
            return;
        }
        showToast(
            saved
                ? (en ? `Removed ${name}` : `「${name}」を行きたい場所から外しました`)
                : (en ? `Saved ${name}` : `「${name}」を行きたい場所に保存しました`),
            "success",
        );
    };

    const button = (
            <button
                type="button"
                onClick={onClick}
                // **まだ分からない間と書き込み中は押させない**
                disabled={saved === undefined || working}
                // `aria-pressed` は**真偽が決まっているときだけ**。
                // 分からない間に `false` を渡すと「押されていない」と読み上げる
                aria-pressed={saved === undefined ? undefined : saved}
                aria-busy={saved === undefined || working}
                className={tile
                    ? `${base} min-w-0 ${saved ? TILE_ON : TILE_OFF} disabled:opacity-60`
                    : `${base} ${saved ? "bg-primary ring-primary text-ink hover:brightness-110" : "bg-white/10 ring-white/20 text-white hover:bg-white/20"} disabled:opacity-60`}
                style={{ touchAction: "manipulation", minHeight: tile ? 48 : 44 }}
            >
                {saved
                    ? <IconOn className={iconClass} aria-hidden />
                    : <IconOff className={iconClass} aria-hidden />}
                {tile ? (
                    <span className={TILE_TEXT}>{saved ? (en ? "Saved" : "保存済み") : wantLabel}</span>
                ) : saved === undefined
                    ? (en ? "Loading…" : "読み込み中…")
                    : saved
                        ? (en ? "Saved" : "保存済み")
                        : wantLabel}
            </button>
    );

    /* 取りに行って失敗した回は、黙って「行きたい」と出さない
       （押すと既に保存済みのものをもう一度保存することになる）。
       `/favorites` が同じ場面で同じ断りを出している */
    const alert = failed ? (
        <p role="alert" className={tile ? "col-span-3 order-last m-0 text-xs text-danger" : "text-xs text-danger"}>
            {en ? "Couldn't load your saved spots. " : "保存した場所を読み込めませんでした。"}
            <button onClick={retry}
                    className={tile ? "underline text-white/80 hover:text-white min-h-[44px] px-1" : "underline text-white/80 hover:text-white"}>
                {en ? "Retry" : "再試行"}
            </button>
        </p>
    ) : null;

    // タイルは親の格子に直接並ぶ（外箱で包むと等分が崩れる・上の注記）
    if (tile) return <>{button}{alert}</>;
    return (
        <div className="flex flex-col items-start gap-1">
            {button}
            {alert}
        </div>
    );
}

const BTN =
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold " +
    // **面と枠は状態ごとに付ける。** ここに `bg-white/10 ring-white/20` を置くと、
    // Tailwind v4 は同じプロパティの utility を候補名の順で並べるので
    // `bg-primary` より `bg-white/10` が後ろに来て**保存済みの塗りが一度も出ない**
    // （レビューが生成 CSS で確認。白塗りの頃から同じ順で負けていた）
    "ring-1 active:scale-95 transition";

/**
 * スポットのページのタイル（iOS の `actionLabel`: 高さ48・角12・横に等分）。
 * 面は状態ごとに付ける（上の `BTN` と同じ理由）。**高さは px**（root 14px で縮まない）
 */
export const TILE =
    // **390px 未満は印を字の上に積む**（3等分の列が約90px。横に並べると「地図で見る」が
    // 「地図で見|る」と折れる）。字は折らない（`TILE_TEXT`）
    "inline-flex flex-col min-[390px]:flex-row items-center justify-center gap-0.5 min-[390px]:gap-1.5 " +
    "rounded-[12px] px-1.5 font-semibold " +
    "focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent active:scale-95 transition";
/** タイルの字（**px で書く**＝root 14px で縮まない。積むときは 12px） */
export const TILE_TEXT = "whitespace-nowrap text-[12px] min-[390px]:text-[14px] leading-4";
/** タイルの印（縮ませない） */
export const TILE_ICON = "w-[18px] h-[18px] flex-shrink-0";
/** 押していない: 面（`surface`）に白い字 */
export const TILE_OFF = "bg-surface text-white hover:bg-surface-2";
/** 押した: 白地に墨の字（iOS の `filled`） */
export const TILE_ON = "bg-primary text-ink hover:brightness-110";
