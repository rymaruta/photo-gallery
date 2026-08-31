"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Photo, Locale } from "@/lib/data/photos";
import { getLocalized, getLocalizedParagraphs, getPreferredMapLink, makeGoogleSearch } from "@/lib/data/photos";
import { useSwipe } from "../../../lib/hooks/useSwipe";
import { usePhotoLikes } from "../../../lib/hooks/usePhotoLikes";
import { useAuth } from "../../auth/context";
import { useToast } from "../../../lib/hooks/useToast";
import { useImagePreloader } from "../../../lib/hooks/useImagePreloader";
import { copyToClipboard, shareUrl } from "../../../lib/utils/share";
import { siteConfig } from "../../../lib/utils/seo";
import { ROUTES } from "../../../lib/routes";
import { log } from "../../../lib/utils/log";
import { lockBodyScroll, unlockBodyScroll } from "./scrollLock";
import { hapticTap } from "../../../lib/utils/haptics";
import { HeartIcon } from "@heroicons/react/24/solid";
import ModalImage from "./ModalImage";
import ModalControls from "./ModalControls";
import ModalCaption from "./ModalCaption";
import ModalKeyboardHelp from "./ModalKeyboardHelp";
import { useFocusTrap } from "../../../lib/hooks/useFocusTrap";

type Props = {
    photos: Photo[];
    currentIndex: number;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    locale: Locale;
    categoryDisplayMap?: Record<string, string>;
    mapLabel?: { ja: string; en: string };
};

export default function GalleryModal({
    photos, currentIndex, onClose, onNext, onPrev, locale,
    categoryDisplayMap = {},
    mapLabel = { ja: "地図で見る", en: "View on map" },
}: Props) {
    const p = photos[currentIndex];

    // --- All hooks must be called unconditionally before any early return ---

    const modalRef = useRef<HTMLDivElement | null>(null);
    const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

    const [helpOpen, setHelpOpen] = useState(false);
    const helpOpenRef = useRef(false);
    useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);


    const { handlers: swipeHandlers } = useSwipe({
        onSwipeLeft: onNext, onSwipeRight: onPrev, onSwipeDown: onClose,
        threshold: 50, velocityThreshold: 0.3,
    });
    // いいねはサーバーにも届ける。
    // 以前ここだけ useFavorites を直接使っていたため、モーダルで押した
    // いいねは端末ローカルに溜まるだけで、公開の件数も投稿者への通知も
    // 動かなかった（個別ページでは動く）。新着写真はモーダルでしか
    // 見られないので、その写真へのいいねは必ず失われていた。
    const { isAuthenticated, loading: authLoading } = useAuth();
    const { liked, toggle: toggleLike } = usePhotoLikes(p?.id ?? "", p?.likes ?? 0, isAuthenticated, authLoading);
    // キーボードハンドラ用。toggle は liked が変わるたびに新しい関数になるので、
    // 直接 deps に入れるとキー購読を張り直し続けることになる（フォーカストラップも巻き添え）。
    const likedRef = useRef(liked);
    useEffect(() => { likedRef.current = liked; }, [liked]);
    const toggleLikeRef = useRef(toggleLike);
    useEffect(() => { toggleLikeRef.current = toggleLike; }, [toggleLike]);
    const { showToast } = useToast();
    // いいねの失敗を伝える（SW-b4）。ダブルタップ・キーボード（h）からも
    // 呼ぶので、参照を ref に持って購読の張り直しを避ける
    const notifyIfLikeFailed = useCallback((ok: boolean) => {
        if (!ok) showToast(locale === "en"
            ? "Couldn't save your like. Please try again."
            : "いいねを保存できませんでした。もう一度お試しください", "error");
    }, [showToast, locale]);
    const notifyIfLikeFailedRef = useRef(notifyIfLikeFailed);
    useEffect(() => { notifyIfLikeFailedRef.current = notifyIfLikeFailed; }, [notifyIfLikeFailed]);
    const { preload } = useImagePreloader();

    // ダブルタップいいね（Instagram風）。連続タップ350ms以内で発火し、
    // ハートが弾ける。いいね済みでも解除はしない（演出のみ）。
    const lastTapRef = useRef(0);
    const [heartBurstKey, setHeartBurstKey] = useState(0);
    const handleImageTap = () => {
        const now = Date.now();
        if (now - lastTapRef.current < 350) {
            lastTapRef.current = 0;
            // いいね済みなら解除しない（ダブルタップは演出のみ）
            if (!likedRef.current) void toggleLike().then(notifyIfLikeFailed);
            hapticTap();
            setHeartBurstKey(now);
        } else {
            lastTapRef.current = now;
        }
    };

    // 前後の画像をプリロード
    useEffect(() => {
        if (!p?.src) return;
        preload(p.src);
        if (photos.length < 2) return;
        const nextIdx = (currentIndex + 1) % photos.length;
        const prevIdx = (currentIndex - 1 + photos.length) % photos.length;
        if (photos[nextIdx]?.src) preload(photos[nextIdx].src);
        if (photos[prevIdx]?.src) preload(photos[prevIdx].src);
    }, [currentIndex, photos, p?.src, preload]);

    // フォーカストラップと初期フォーカス・復帰は useFocusTrap に寄せた。
    // ここに同じものを自前で持っていて、他の4つのモーダルと**二重**だった。
    // 移す前に今の挙動を写し取るテストを書いてある
    // （app/components/__tests__/GalleryModalFocus.test.tsx）——
    // 「前へ」ボタンを指名すること、閉じたら元へ戻すこと、Tab が外へ
    // 出ないこと。それが通ることを確かめてから置き換えた。
    //
    // **100ms 待つのはやめた。** 待っていた理由はコードにもコメントにも
    // 無く、レフはエフェクトの時点で既に張られている（フックに目印を仕込んで
    // フルスイートを通し、8か所すべてで容器がある状態でエフェクトが走ることを
    // 確かめた）。待つ間だけフォーカスが body に落ちている方が困る
    // （その隙の Tab が裏へ抜ける）。
    useFocusTrap(true, modalRef, undefined, firstFocusableRef);

    // キーボード操作 + body scroll lock
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") { e.preventDefault(); onNext(); return; }
            if (e.key === "ArrowLeft")  { e.preventDefault(); onPrev(); return; }
            if (e.key === "Escape") {
                e.preventDefault();
                if (helpOpenRef.current) { setHelpOpen(false); return; }
                onClose();
                return;
            }
            if (e.key === "?") { e.preventDefault(); setHelpOpen((v) => !v); return; }
            if (e.key === "h" || e.key === "H") { e.preventDefault(); void toggleLikeRef.current().then(notifyIfLikeFailedRef.current); return; }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose, onNext, onPrev]);

    // **ロックの寿命は「開いている間」で、コールバックの同一性とは無関係。**
    //
    // 上のエフェクトに同居させていたので、`onClose` の参照が変わるたびに
    // 全解除→取り直しが走っていた（`GalleryPageClient` の `handleClose` は
    // `openPhotoId` に依存するので、**写真を送るたびに変わる**）。
    // 解除は `position: fixed` を外して `window.scrollTo` を撃つところまで
    // やるので、送るたびにスクロール位置を控え直すことになる——高さが
    // 変わっていれば `scrollTo` はクランプされ、控えが少しずつずれて
    // 「閉じたら違う場所に戻る」に化ける。開いている間は触らない。
    useEffect(() => {
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, []);

    // --- Now safe to do the null guard ---
    if (!p) return null;

    const titleText = getLocalized(p.title, locale) || (typeof p.title === "string" ? p.title : "");
    const altText = getLocalized(p.alt, locale) || titleText || "";
    const locationText = typeof p.location === "string" ? p.location : "";
    const mapText = locale === "ja" ? mapLabel.ja : mapLabel.en;
    const paragraphs = getLocalizedParagraphs(p.description, locale);
    const preferred = getPreferredMapLink(p);
    const mapHref = preferred?.href ?? (p.coords ? makeGoogleSearch(p.coords.lat, p.coords.lng) : undefined);

    const currentUrl = typeof window !== "undefined"
        ? `${window.location.origin}${ROUTES.PHOTO(p.id)}`
        : `${siteConfig.url}${ROUTES.PHOTO(p.id)}`;
    const shareText = titleText || "Photo";

    const handleShare = async () => {
        const result = await shareUrl(currentUrl, shareText, paragraphs.join(" "));
        // cancelled（利用者が閉じた）と shared は何も出さない
        if (result === "copied") {
            showToast(locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
        } else if (result === "failed") {
            showToast(locale === "en" ? "Could not share" : "共有できませんでした", "error");
        }
    };

    const handleCopyLink = async () => {
        if (await copyToClipboard(currentUrl)) {
            showToast(locale === "en" ? "Link copied to clipboard!" : "リンクをクリップボードにコピーしました", "success");
        } else {
            log.error("Failed to copy link");
            showToast(locale === "en" ? "Failed to copy link" : "リンクのコピーに失敗しました", "error");
        }
    };

    const handleOverlayClick = () => {
        onClose();
    };

    return (
        <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={titleText || "写真"}
            onClick={handleOverlayClick}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full h-full sm:h-auto sm:max-h-[95vh] flex flex-col sm:mx-4 sm:rounded-2xl overflow-hidden bg-black sm:ring-1 sm:ring-white/10"
                style={{ maxWidth: "980px" }}
            >
                {/* 画像エリア */}
                <div
                    className="relative w-full flex-shrink-0 bg-black sm:bg-transparent"
                    style={{ height: "60vh", minHeight: "300px", fontSize: 0, lineHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                    <div className="relative w-full h-full" {...swipeHandlers} onClick={handleImageTap}>
                        <ModalImage key={p.id} src={p.src} srcAvif={p.srcAvif} alt={altText} focalPoint={p.focalPoint} />
                        {/* ダブルタップいいねのハート */}
                        {heartBurstKey > 0 && (
                            <div
                                key={heartBurstKey}
                                className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                                aria-hidden="true"
                            >
                                <HeartIcon
                                    className="w-24 h-24 text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] heart-burst"
                                    onAnimationEnd={() => setHeartBurstKey(0)}
                                />
                            </div>
                        )}
                    </div>

                    <ModalControls
                        onPrev={onPrev}
                        onNext={onNext}
                        onClose={onClose}
                        isFav={liked}
                        onToggleFavorite={() => { hapticTap(); void toggleLike().then(notifyIfLikeFailed); }}
                        firstFocusableRef={firstFocusableRef}
                    />
                </div>

                {/* キャプションエリア */}
                <ModalCaption
                    photo={p}
                    locale={locale}
                    titleText={titleText}
                    paragraphs={paragraphs}
                    locationText={locationText}
                    mapHref={mapHref}
                    mapText={mapText}
                    categoryDisplayMap={categoryDisplayMap}
                    currentUrl={currentUrl}
                    shareText={shareText}
                    onShare={handleShare}
                    onCopyLink={handleCopyLink}
                />
            </div>

            {helpOpen && (
                <ModalKeyboardHelp locale={locale} onClose={() => setHelpOpen(false)} />
            )}
        </div>
    );
}
