"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CameraIcon, ShieldCheckIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { useFocusTrap } from "../../lib/hooks/useFocusTrap";
import { lockBodyScroll, unlockBodyScroll } from "../../lib/utils/scrollLock";
import { needsLegalConsent, acceptLegalConsent } from "../../lib/utils/legalConsent";
import { ROUTES } from "../../lib/routes";

/**
 * **「はじめる前に」**（iOS の `LegalGateView` と同じ文言・同じ3項目）。
 *
 * ログインした人に、同意の記録（`lib/utils/legalConsent.ts`）が無ければ一度だけ出す。
 * 見るだけの人には出さない（Web はログインしなくても写真を見られる）。
 *
 * **閉じる手段は「同意してはじめる」だけ**（iOS と同じ）。Escape・背景では閉じない。
 * 規約とプライバシーポリシーのページでは出さない——覆うと読めない。
 */
export default function LegalGate() {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const pathname = usePathname();
    const isJa = locale !== "en";
    const [needs, setNeeds] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // 記録は端末にしか無いので、読むのは水和のあと（サーバーの HTML には出さない）
    useEffect(() => {
        setNeeds(!loading && isAuthenticated && needsLegalConsent());
    }, [isAuthenticated, loading]);

    const path = (pathname ?? "").replace(/\/+$/, "");
    const exempt = path === ROUTES.TERMS || path === ROUTES.PRIVACY;
    const open = needs && !exempt;

    useFocusTrap(open, panelRef);
    useEffect(() => {
        if (!open) return;
        lockBodyScroll();
        return () => unlockBodyScroll();
    }, [open]);

    if (!open) return null;

    const agree = () => {
        // 書けなくても閉じる（出られなくなるとサイトが使えない）。次に開いたときにまた出る
        acceptLegalConsent();
        setNeeds(false);
    };

    const items = [
        {
            Icon: CameraIcon,
            ja: "旅の写真を投稿して共有できます。",
            en: "Post and share photos from your travels.",
        },
        {
            Icon: ShieldCheckIcon,
            ja: "いやがらせ・わいせつ・権利を侵す投稿は認めません。見つけたら各写真から通報でき、相手をブロックできます。",
            en: "Harassment, sexual content and posts that infringe rights are not allowed. You can report any photo and block its poster.",
        },
        {
            Icon: LockClosedIcon,
            ja: "撮影情報（EXIF）は端末で取り除いてから送ります。撮影地は約1kmに丸めて保存します。",
            en: "Photo metadata (EXIF) is removed on your device before upload. Locations are stored rounded to about 1 km.",
        },
    ];

    return (
        <div className="fixed inset-0 z-[200] bg-bg overflow-y-auto overscroll-contain pad-safe">
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="legal-gate-title"
                className="mx-auto flex min-h-full max-w-md flex-col px-6 pt-12 pb-8"
            >
                <p className="text-[11px] uppercase tracking-[0.16em] text-accent">
                    {isJa ? "Before you start" : "Before you start"}
                </p>
                <h2 id="legal-gate-title" className="mt-2 text-2xl font-bold text-white">
                    {isJa ? "はじめる前に" : "Before you start"}
                </h2>

                <ul className="mt-8 space-y-5">
                    {items.map(({ Icon, ja, en }) => (
                        <li key={ja} className="flex gap-3 text-sm leading-relaxed text-white/85">
                            <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" aria-hidden="true" />
                            <span>{isJa ? ja : en}</span>
                        </li>
                    ))}
                </ul>

                <div className="mt-auto pt-10">
                    <p className="flex gap-5 text-sm">
                        <Link href={ROUTES.TERMS} prefetch={false} className="text-accent underline underline-offset-4 hover:text-accent-strong">
                            {isJa ? "利用規約" : "Terms of Service"}
                        </Link>
                        <Link href={ROUTES.PRIVACY} prefetch={false} className="text-accent underline underline-offset-4 hover:text-accent-strong">
                            {isJa ? "プライバシーポリシー" : "Privacy Policy"}
                        </Link>
                    </p>
                    <button
                        type="button"
                        onClick={agree}
                        className="mt-5 w-full rounded-full bg-accent-fill py-3.5 text-[15px] font-semibold text-ink hover:brightness-110 active:scale-[0.98] transition"
                        style={{ touchAction: "manipulation" }}
                    >
                        {isJa ? "同意してはじめる" : "Agree and continue"}
                    </button>
                </div>
            </div>
        </div>
    );
}
