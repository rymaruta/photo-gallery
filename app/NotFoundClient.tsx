"use client";

import { useEffect } from "react";
import Link from "next/link";
import { resolveNotFoundRedirect } from "../lib/utils/notFoundRedirect";

// 404 の中身（クライアント）。**殻は `app/not-found.tsx`**——あちらは
// サーバー側で `metadata` を出すために分けてある（下記）。
// 静的エクスポートの 404 ページ（out/404.html）。
// ビルド後にアップロードされた写真の /photo/<id> や新規ユーザーの /users/<id> は
// まだ静的ページが存在しないためここに落ちる。その場合はクエリパラメータ版の
// URL へ自動リダイレクトして表示を救済する。
// ※ CloudFront 側で 403/404 エラーを /404.html にフォールバックさせる設定が必要。
export default function NotFoundClient() {
    useEffect(() => {
        const target = resolveNotFoundRedirect(window.location.pathname);
        if (target) window.location.replace(target);
    }, []);

    return (
        <main className="min-h-screen bg-black text-white flex items-center justify-center px-4">
            <div className="text-center space-y-6">
                <p className="text-white/50 text-xs tracking-widest uppercase">404</p>
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
