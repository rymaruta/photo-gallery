"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// 静的エクスポートの 404 ページ（out/404.html）。
// ビルド後にアップロードされた写真の /photo/<id> リンクはまだ静的ページが
// 存在しないためここに落ちる。その場合はトップページのモーダル表示
// （/?photo=<id>）へ自動リダイレクトして写真を表示する。
// ※ CloudFront 側で 403/404 エラーを /404.html にフォールバックさせる設定が必要。
export default function NotFound() {
    const [redirecting, setRedirecting] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const m = window.location.pathname.match(/^\/photo\/([^/]+?)(?:\.html)?\/?$/);
        if (m && m[1]) {
            setRedirecting(true);
            window.location.replace(`/?photo=${encodeURIComponent(m[1])}`);
        }
    }, []);

    if (redirecting) {
        return (
            <main className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
            <div className="text-center space-y-6">
                <p className="text-white/40 text-xs tracking-widest uppercase">404</p>
                <h1 className="text-2xl font-bold">ページが見つかりません</h1>
                <p className="text-white/50 text-sm">
                    お探しのページは移動または削除された可能性があります。
                </p>
                <Link
                    href="/"
                    className="inline-block px-6 py-3 bg-white text-black text-sm font-semibold rounded-lg hover:bg-white/90 transition-colors"
                >
                    ギャラリーに戻る
                </Link>
            </div>
        </main>
    );
}
