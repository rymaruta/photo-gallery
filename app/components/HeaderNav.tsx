"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { XMarkIcon, Bars3Icon } from "@heroicons/react/24/solid";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { log } from "../../lib/utils/log";
import { ROUTES } from "../../lib/routes";

export default function HeaderNav({ className = "" }: { className?: string }) {
    const router = useRouter();
    const { isAuthenticated, isAdminUser, isGeneralUser, logout, loading } = useAuth();
    const { labels } = useLocale();

    useEffect(() => {
        log.info("HeaderNav: 認証状態", { isAuthenticated, isAdminUser, loading });
    }, [isAuthenticated, isAdminUser, loading]);

    const navLabels = labels.navigation || {};
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const innerLine = "rgba(255,255,255,0.12)";
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

    const dividerThickness = 2;
    const linkBase = "block px-3 py-4 whitespace-nowrap text-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/10";
    const inactiveClasses = "text-white bg-transparent hover:bg-white hover:text-black";
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
        <nav className={`site-header__nav flex items-center ${className}`}>
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

            {open && (
                <div
                    id="site-menu"
                    role="dialog"
                    aria-modal="true"
                    ref={panelRef}
                    className="fixed left-0 right-0 bottom-0 top-[64px] md:top-[72px] z-50"
                >
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/70"
                        onClick={() => setOpen(false)}
                        aria-hidden="true"
                    />

                    {/* Menu panel */}
                    <div
                        className="absolute top-0 right-6 md:right-8 w-[48%] max-w-[200px]"
                        style={{
                            backgroundColor: bg,
                            border: `2px solid ${outerBorder}`,
                            boxShadow: `${subtleShadow}, ${subtleInset}`,
                            borderRadius: 12,
                            overflow: "hidden",
                            zIndex: 10,
                        }}
                    >
                        <nav aria-label="Mobile menu">
                            <ul className="flex flex-col m-0 p-0" style={{ borderTop: `${dividerThickness}px solid ${innerLine}`, listStyle: "none" }}>
                                <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                    <button onClick={() => handleNavigation(ROUTES.HOME)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.works || "Works"}
                                    </button>
                                </li>
                                <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                    <button onClick={() => handleNavigation(ROUTES.FAVORITES)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.favorites || "Favorites"}
                                    </button>
                                </li>
                                <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                    <button onClick={() => handleNavigation(ROUTES.HISTORY)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.history || "History"}
                                    </button>
                                </li>
                                <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                    <button onClick={() => handleNavigation(ROUTES.ABOUT)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                        {navLabels.about || "About"}
                                    </button>
                                </li>
                                {(isAdminUser || isGeneralUser) && (
                                    <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                        <button onClick={() => handleNavigation(ROUTES.UPLOAD)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.upload || "Upload"}
                                        </button>
                                    </li>
                                )}
                                {isAdminUser && (
                                    <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                        <button onClick={() => handleNavigation(ROUTES.ADMIN)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.admin || "Manage"}
                                        </button>
                                    </li>
                                )}
                                {isAuthenticated ? (
                                    <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                        <button onClick={() => { setOpen(false); logout(); }} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.logout || "Logout"}
                                        </button>
                                    </li>
                                ) : (
                                    <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                        <button onClick={() => handleNavigation(ROUTES.LOGIN)} className={`${linkBase} ${inactiveClasses} w-full text-left`} style={btnStyle}>
                                            {navLabels.login || "Login"}
                                        </button>
                                    </li>
                                )}
                            </ul>
                        </nav>
                    </div>
                </div>
            )}
        </nav>
    );
}
