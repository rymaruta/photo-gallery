// app/components/HeaderNav.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { XMarkIcon, Bars3Icon } from "@heroicons/react/24/solid";

export default function HeaderNav({ className = "" }: { className?: string }) {
    const bg = "#07090a";
    const outerBorder = "rgba(255,255,255,0.26)";
    const innerLine = "rgba(255,255,255,0.12)";
    const subtleInset = "inset 0 1px 0 rgba(255,255,255,0.02)";
    const subtleShadow = "0 1px 8px rgba(0,0,0,0.65)";

    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const prevBodyOverflowRef = useRef<string>("");
    const prevBodyPaddingRightRef = useRef<string>("");

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
                    style={{
                        backgroundColor: bg,
                        border: `2px solid ${outerBorder}`,
                        boxShadow: `${subtleShadow}, ${subtleInset}`,
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
                    <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-hidden="true" />

                    <div className="relative w-full max-w-screen-lg mx-auto h-full px-6 md:px-8">
                        <div className="flex h-full items-start justify-end">
                            <div
                                className="relative w-[48%] max-w-[200px]"
                                style={{
                                    backgroundColor: bg,
                                    border: `2px solid ${outerBorder}`,
                                    boxShadow: `${subtleShadow}, ${subtleInset}`,
                                    borderRadius: 12,
                                    overflow: "hidden",
                                }}
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
                                            <Link href="/" onClick={() => setOpen(false)} className={`${linkBase} ${inactiveClasses}`}>
                                                Works
                                            </Link>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <Link href="/gallery" onClick={() => setOpen(false)} className={`${linkBase} ${inactiveClasses}`}>
                                                Gallery
                                            </Link>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <Link href="/about" onClick={() => setOpen(false)} className={`${linkBase} ${inactiveClasses}`}>
                                                About
                                            </Link>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <Link href="/favorites" onClick={() => setOpen(false)} className={`${linkBase} ${inactiveClasses}`}>
                                                Favorites
                                            </Link>
                                        </li>

                                        <li style={{ margin: 0, padding: 0, borderBottom: `${dividerThickness}px solid ${innerLine}` }}>
                                            <Link href="/history" onClick={() => setOpen(false)} className={`${linkBase} ${inactiveClasses}`}>
                                                History
                                            </Link>
                                        </li>
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
