"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { publicImageUrl } from "@/lib/utils/seo";

const CLOUDFRONT_URL = process.env.NEXT_PUBLIC_CLOUDFRONT_URL ?? "";

/** 板どおりの帯の高さ（MyPage 05c・UserProfile 31・iOS の `ProfileCover.height`） */
export const COVER_HEIGHT_PX = 180;
/** 帯の下端へアイコンを引き上げる量（板 50px・iOS の `avatarOverlap`） */
export const COVER_AVATAR_OVERLAP_PX = 50;

/**
 * カバー写真の置き場（`profiles/<uid>/cover`・`api-user/src/profile.ts`）。**固定キーで中身が
 * 差し替わる**のでサーバーもアップロードも `no-store`（`public/sw.js` も控えない）。
 * サイトのドメインで組み立てる（`publicImageUrl`・アイコンの `UserAvatar` と同じ）
 */
export function profileCoverUrl(userId: string, cacheBust?: string | number): string {
    if (!CLOUDFRONT_URL || !userId) return "";
    return publicImageUrl(`${CLOUDFRONT_URL}/profiles/${encodeURIComponent(userId)}/cover${cacheBust !== undefined ? `?v=${cacheBust}` : ""}`);
}

/**
 * プロフィールの上に敷くカバー写真（板 05c・31・iOS の `ProfileCover`・2026-10-11 owner）。
 *
 * 2026-09-22 に一度外した（最終版モックに無かった）。iOS で板（05c・05d・31）に入ったので戻す。
 *
 * **設定していない人には帯を出さない**（板 05d・MyPageNoCover）。`profiles/<uid>/cover` は
 * 無ければ読み込みに失敗するので、**出せたときだけ**帯を広げる。灰色の空き地や壊れた写真の記号は
 * 写真が主役の画面で場所を取るだけになる。読み込み中も高さ 0（無い人で見出しが跳ねない）。
 *
 * 出せたかどうかは `onLoaded` で返す（見出しを帯の下端に重ねるため）。
 *
 * ⚠️ **カバーが無い人のページは、開くたびに `profiles/<uid>/cover` へ1本要求して 4xx を受ける。**
 * 有無はプロフィールの応答に載っていないので、聞いてみるしかない（iOS も同じ）。直すには
 * サーバーが「カバーあり」の印を返す必要がある＝今回はやらない（2026-10-11 判断）。
 *
 * **React より先に失敗が終わっていた画像は `onError` が拾えない**（`UserAvatar` の注記と同じ）。
 * 静的HTMLに焼かれるページでは、付いた時点の `complete` も見る。
 */
export default function ProfileCover({ userId, onLoaded, className = "" }: {
    userId: string;
    onLoaded?: (loaded: boolean) => void;
    className?: string;
}) {
    const [state, setState] = useState<"loading" | "loaded" | "none">("loading");
    const url = profileCoverUrl(userId);

    // 親が毎回新しい関数を渡しても、画像の ref を張り直さない（張り直すたびに知らせが飛ぶ）
    const onLoadedRef = useRef(onLoaded);
    useEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);
    const settle = useCallback((ok: boolean) => {
        setState(ok ? "loaded" : "none");
        onLoadedRef.current?.(ok);
    }, []);

    const attach = useCallback((img: HTMLImageElement | null) => {
        if (!img || !img.complete) return;
        settle(img.naturalWidth > 0);
    }, [settle]);

    if (!url || state === "none") return null;
    return (
        <div
            aria-hidden="true"
            data-testid="profile-cover"
            data-state={state}
            className={`absolute inset-x-0 top-0 overflow-hidden pointer-events-none ${className}`}
            style={{ height: state === "loaded" ? `${COVER_HEIGHT_PX}px` : 0 }}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                ref={attach}
                src={url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                onLoad={() => settle(true)}
                onError={() => settle(false)}
            />
            {/* 下の 110px を黒へ溶かす（アイコンと名前が乗る側） */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg to-transparent" style={{ height: "110px" }} />
        </div>
    );
}

/**
 * カバーが**無いと確かめられた**か（#304・2026-10-18 見直し）。絵を読めなかっただけでは決めない——HEAD が
 * 404（無い。S3 の OAC が返す 403 は CDN が 404 のページに振り替える）を返したときだけ true。
 * 403 などそれ以外・圏外は「分からない」で false（額縁を出さない）。403 は配り方の変化かもしれないので警告に残す
 * （iOS の `ProfileImageFromPhoto.existence` と同じ読み方）
 */
export async function coverIsMissing(url: string): Promise<boolean> {
    if (!url) return false;
    try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (res.status === 404) return true;
        if (res.status >= 300) console.warn(`coverIsMissing: HEAD ${res.status}`);
        return false;
    } catch {
        return false;
    }
}

/**
 * カバーが無いときの**自分のページだけ**の額縁（#304・板 52 MyPageCoverFrame・2026-10-18）。
 *
 * 帯の場所に真鍮の細い縁（黒地の上なので真鍮）と「ここにあなたの1枚」。灰色の塗りは置かない・責める言い方をしない。
 * 押すとプロフィールの編集のカバーの候補へ。**ほかの人のページには出さない**（黒のまま・板 31）——
 * 出すかどうかは呼び出し側（本人で、カバーが無いと分かったとき）が決める
 */
export function CoverFrame({ href, locale }: { href: string; locale: string }) {
    const en = locale === "en";
    return (
        <Link
            href={href}
            prefetch={false}
            data-testid="cover-frame"
            aria-label={en ? "Choose a cover. Your photo goes here" : "カバーを選ぶ。ここにあなたの1枚"}
            className="absolute inset-x-3 top-3 flex flex-col items-center gap-2 rounded-xl border border-accent/80 pt-[30px] text-accent"
            style={{ height: `${COVER_HEIGHT_PX - 30}px` }}
        >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 8" />
            </svg>
            <span className="font-serif text-[17px] font-bold">{en ? "Your photo goes here" : "ここにあなたの1枚"}</span>
            <span className="text-xs text-white/60">{en ? "Tap to choose from your photos" : "押すと、あなたの写真から選べます"}</span>
        </Link>
    );
}
