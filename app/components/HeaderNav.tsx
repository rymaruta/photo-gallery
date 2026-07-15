"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { XMarkIcon, Bars3Icon } from "@heroicons/react/24/solid";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { log } from "../../lib/utils/log";
import { ROUTES } from "../../lib/routes";
import UserAvatar from "./UserAvatar";
import NotificationsBell from "./NotificationsBell";

export default function HeaderNav({ className = "" }: { className?: string }) {
    const router = useRouter();
    const { isAuthenticated, isAdminUser, userId, logout, loading } = useAuth();
    const { labels } = useLocale();

    useEffect(() => {
        log.info("HeaderNav: 認証状態", { isAuthenticated, isAdminUser, loading });
    }, [isAuthenticated, isAdminUser, loading]);

    const navLabels = labels.navigation || {};
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const subtleInset = "inset 0 1px 0 rgba(255,255,255,0.02)";
    const subtleShadow = "0 1px 8px rgba(0,0,0,0.65)";

    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);

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

    // Scroll lock when open
    useEffect(() => {
        const body = document.body;
        if (!body) return;
        if (open) {
            const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
            if (scrollBarWidth > 0) body.style.paddingRight = `${scrollBarWidth}px`;
            body.style.overflow = "hidden";
        } else {
            body.style.overflow = "";
            body.style.paddingRight = "";
        }
        return () => {
            body.style.overflow = "";
            body.style.paddingRight = "";
        };
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
        <nav className={`site-header__nav flex items-center gap-2 ${className}`}>
            {/* PC(md以上): 主要リンクをインライン表示。モバイルはメニュー内に集約 */}
            <div className="hidden md:flex items-center gap-0.5 mr-1">
                {[
                    { href: ROUTES.HOME, label: navLabels.works || "Works" },
                    { href: ROUTES.MAP, label: navLabels.map || "Map" },
                    { href: ROUTES.ABOUT, label: navLabels.about || "About" },
                ].map(({ href, label }) => (
                    <button
                        key={href}
                        onClick={() => handleNavigation(href)}
                        className="px-3 py-2 rounded-full text-sm text-white/65 hover:text-white hover:bg-white/10 transition-colors"
                        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                    >
                        {label}
                    </button>
                ))}
            </div>
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
                aria-expanded={open}
                aria-controls="site-menu"
                aria-label={open ? "Close menu" : "Open menu"}
                onClick={() => setOpen((v) => !v)}
                style={{
                    backgroundColor: bg,
                    border: `2px solid ${outerBorder}`,
                    boxShadow: `${subtleShadow}, ${subtleInset}`,
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                    minWidth: "44px",
                    minHeight: "44px",
                }}
                className="inline-flex items-center justify-center w-11 h-11 rounded-md hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-white/20"
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
                        <nav aria-label="Mobile menu">
                            <ul className="flex flex-col m-0 p-0 divide-y divide-white/5" style={{ listStyle: "none" }}>
                                <li style={{ margin: 0, padding: 0 }}>
                                    <button onClick={() => handleNavigation(ROUTES.HOME)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.works || "Works"}
                                    </button>
                                </li>
                                <li style={{ margin: 0, padding: 0 }}>
                                    <button onClick={() => handleNavigation(ROUTES.MAP)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.map || "Map"}
                                    </button>
                                </li>
                                <li style={{ margin: 0, padding: 0 }}>
                                    <button onClick={() => handleNavigation(ROUTES.FAVORITES)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.favorites || "Favorites"}
                                    </button>
                                </li>
                                <li style={{ margin: 0, padding: 0 }}>
                                    <button onClick={() => handleNavigation(ROUTES.ABOUT)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.about || "About"}
                                    </button>
                                </li>
                                {isAuthenticated && (
                                    <li style={{ margin: 0, padding: "10px 12px 4px" }}>
                                        <span className="text-[10px] tracking-widest uppercase text-white/35">
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
                                {isAuthenticated && (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.WISHLIST)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.wishlist || "Travel List"}
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
                                {isAuthenticated ? (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => { setOpen(false); logout(); }} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.logout || "Logout"}
                                        </button>
                                    </li>
                                ) : (
                                    <li style={{ margin: 0, padding: 0 }}>
                                        <button onClick={() => handleNavigation(ROUTES.LOGIN)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.login || "Login"}
                                        </button>
                                    </li>
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
