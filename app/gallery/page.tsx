"use client";

import React from "react";

export default function GalleryPage() {
    return (
        <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24 }}>
            <div style={{ maxWidth: 720, textAlign: "center", color: "rgba(255,255,255,0.95)" }}>
                <h1 style={{ fontSize: 30, marginBottom: 12 }}>ギャラリー公開準備中</h1>

                <p style={{ fontSize: 16, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", marginBottom: 18 }}>
                    掲載する作品と表示品質を慎重に確認しています。皆さまに安全かつ快適にご覧いただける状態になり次第、公開いたします。
                </p>

                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 22 }}>
                    ご不便をおかけしますが、今しばらくお待ちください。
                </p>

                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                    <a
                        href="/"
                        style={{
                            padding: "8px 14px",
                            borderRadius: 8,
                            border: "1px solid rgba(255,255,255,0.12)",
                            background: "transparent",
                            color: "white",
                            textDecoration: "none",
                        }}
                    >
                        トップへ戻る
                    </a>

                    <button
                        type="button"
                        onClick={() => alert("公開通知機能は準備中です。")}
                        style={{
                            padding: "8px 14px",
                            borderRadius: 8,
                            border: "none",
                            background: "white",
                            color: "#07090a",
                            cursor: "pointer",
                        }}
                    >
                        公開通知を希望する
                    </button>
                </div>
            </div>
        </main>
    );
}
