// app/components/HeaderNav.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XMarkIcon, Bars3Icon } from "@heroicons/react/24/solid";
import { useAuth } from "../auth/context";

export default function HeaderNav({ className = "" }: { className?: string }) {
    const router = useRouter();
    const { isAuthenticated, isAdminUser, logout } = useAuth();
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const innerLine = "rgba(255,255,255,0.12)";
    const subtleInset = "inset 0 1px 0 rgba(255,255,255,0.02)";
    const subtleShadow = "0 1px 8px rgba(0,0,0,0.65)";

    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const prevBodyOverflowRef = useRef<string>("");
    const prevBodyPaddingRightRef = useRef<string>("");

    const handleNavigation = (href: string) => {
        setOpen(false);
        router.push(href);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    useEffect(() => {
        const body = document.body;
        if (!body) return;

        if (prevBodyOverflowRef.current === "") prevBodyOverflowRef.current = body.style.overflow || "";
        if (prevBodyPaddingRightRef.current === "") prevBodyPaddingRightRef.current = body.style.paddingRight || "";

        if (open) {
            const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
            if (scrollBarWidth > 0) body.style.paddingRight = `${scrollBarWidth}px`;
            body.style.overflow = "hidden";
            // 自動フォーカスは行わない（マウスで開いたときに即アクティブ表示にならないように）
        } else {
            body.style.overflow = prevBodyOverflowRef.current;
            body.style.paddingRight = prevBodyPaddingRightRef.current;
        }

        return () => {
            body.style.overflow = prevBodyOverflowRef.current;
            body.style.paddingRight = prevBodyPaddingRightRef.current;
        };
    }, [open]);

    const dividerThickness = 2; // px

    const linkBase =
        "block px-3 py-4 whitespace-nowrap text-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/10";
    const inactiveClasses = "text-white bg-transparent hover:bg-white hover:text-black";
    const activeClasses = "text-black bg-white";

    return (
        <nav className={`site-header__nav flex items-center ${className}`}>
            <div>
                <button
                    aria-expanded={open}
                    aria-controls="site-menu"
                    aria-label={open ? "Close menu" : "Open menu"}
                    onClick={() => setOpen((v) => !v)}
                    onTouchStart={(e) => {
                        e.stopPropagation();
                    }}
                    onTouchEnd={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setOpen((v) => !v);
                    }}
                    style={{
                        backgroundColor: bg,
                        border: `2px solid ${outerBorder}`,
                        boxShadow: `${subtleShadow}, ${subtleInset}`,
                        touchAction: "manipulation",
                        WebkitTapHighlightColor: "transparent",
                        minWidth: "44px",
                        minHeight: "44px"
                    }}
                    className="inline-flex items-center justify-center w-11 h-11 rounded-md hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                    {open ? <XMarkIcon className="h-6 w-6 text-white" /> : <Bars3Icon className="h-6 w-6 text-white" />}
                </button>
            </div>

            {open && (
                <div
                    id="site-menu"
                    role="dialog"
                    aria-modal="true"
                    ref={panelRef}
                    className="fixed left-0 right-0 bottom-0 top-[72px] md:top-[88px] z-50"
                >
                    <div 
                        className="absolute inset-0 bg-black/70" 
                        onClick={() => setOpen(false)} 
                        onTouchStart={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                        }}
                        aria-hidden="true" 
                    />

                    <div className="relative w-full max-w-screen-lg mx-auto h-full px-6 md:px-8 pointer-events-none">
                        <div className="flex h-full items-start justify-end">
                            <div
                                className="relative w-[48%] max-w-[200px] pointer-events-auto"
                                style={{
                                    backgroundColor: bg,
                                    border: `2px solid ${outerBorder}`,
                                    boxShadow: `${subtleShadow}, ${subtleInset}`,
                                    borderRadius: 12,
                                    overflow: "hidden",
                                    zIndex: 10
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <nav aria-label="Mobile menu">
                                    <ul
                                        className="flex flex-col m-0 p-0"
                                        style={{
                                            borderTop: `${dividerThickness}px solid ${innerLine}`,
                                            listStyle: "none",
                                        }}
                                    >
                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleNavigation("/");
                                                }}
                                                onTouchStart={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onTouchEnd={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleNavigation("/");
                                                }}
                                                className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                style={{ 
                                                    touchAction: "manipulation",
                                                    WebkitTapHighlightColor: "transparent",
                                                    minHeight: "44px",
                                                    display: "block",
                                                    position: "relative",
                                                    zIndex: 10,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                Works
                                            </button>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleNavigation("/gallery");
                                                }}
                                                onTouchStart={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onTouchEnd={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleNavigation("/gallery");
                                                }}
                                                className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                style={{ 
                                                    touchAction: "manipulation",
                                                    WebkitTapHighlightColor: "transparent",
                                                    minHeight: "44px",
                                                    display: "block",
                                                    position: "relative",
                                                    zIndex: 10,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                Gallery
                                            </button>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleNavigation("/about");
                                                }}
                                                onTouchStart={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onTouchEnd={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleNavigation("/about");
                                                }}
                                                className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                style={{ 
                                                    touchAction: "manipulation",
                                                    WebkitTapHighlightColor: "transparent",
                                                    minHeight: "44px",
                                                    display: "block",
                                                    position: "relative",
                                                    zIndex: 10,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                About
                                            </button>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleNavigation("/favorites");
                                                }}
                                                onTouchStart={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onTouchEnd={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleNavigation("/favorites");
                                                }}
                                                className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                style={{ 
                                                    touchAction: "manipulation",
                                                    WebkitTapHighlightColor: "transparent",
                                                    minHeight: "44px",
                                                    display: "block",
                                                    position: "relative",
                                                    zIndex: 10,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                Favorites
                                            </button>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleNavigation("/history");
                                                }}
                                                onTouchStart={(e) => {
                                                    e.stopPropagation();
                                                }}
                                                onTouchEnd={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleNavigation("/history");
                                                }}
                                                className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                style={{ 
                                                    touchAction: "manipulation",
                                                    WebkitTapHighlightColor: "transparent",
                                                    minHeight: "44px",
                                                    display: "block",
                                                    position: "relative",
                                                    zIndex: 10,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                History
                                            </button>
                                        </li>

                                        {/* アップロードリンクは管理者のみに表示 */}
                                        {isAdminUser && (
                                            <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleNavigation("/upload");
                                                    }}
                                                    onTouchStart={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onTouchEnd={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        handleNavigation("/upload");
                                                    }}
                                                    className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                    style={{ 
                                                        touchAction: "manipulation",
                                                        WebkitTapHighlightColor: "transparent",
                                                        minHeight: "44px",
                                                        display: "block",
                                                        position: "relative",
                                                        zIndex: 10,
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    Upload
                                                </button>
                                            </li>
                                        )}

                                        {/* 認証状態に応じたリンク */}
                                        {isAuthenticated ? (
                                            <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        logout();
                                                    }}
                                                    onTouchStart={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onTouchEnd={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        logout();
                                                    }}
                                                    className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                    style={{ 
                                                        touchAction: "manipulation",
                                                        WebkitTapHighlightColor: "transparent",
                                                        minHeight: "44px",
                                                        display: "block",
                                                        position: "relative",
                                                        zIndex: 10,
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    Logout
                                                </button>
                                            </li>
                                        ) : (
                                            <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleNavigation("/login");
                                                    }}
                                                    onTouchStart={(e) => {
                                                        e.stopPropagation();
                                                    }}
                                                    onTouchEnd={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        handleNavigation("/login");
                                                    }}
                                                    className={`${linkBase} ${inactiveClasses} w-full text-left`}
                                                    style={{ 
                                                        touchAction: "manipulation",
                                                        WebkitTapHighlightColor: "transparent",
                                                        minHeight: "44px",
                                                        display: "block",
                                                        position: "relative",
                                                        zIndex: 10,
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    Login
                                                </button>
                                            </li>
                                        )}
                                    </ul>
                                </nav>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
}
