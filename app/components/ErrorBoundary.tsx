"use client";

import React, { Component, ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

type Props = {
    children: ReactNode;
    fallback?: ReactNode;
};

type State = {
    hasError: boolean;
    error?: Error;
};

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Log to console in dev; replace with error reporting service in prod
        console.error("[ErrorBoundary]", error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? (
                <div className="min-h-screen bg-black flex items-center justify-center px-4">
                    <div className="w-full max-w-sm rounded-3xl bg-[#16181c] ring-1 ring-white/10 shadow-2xl p-8 text-center">
                        <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
                            <ExclamationTriangleIcon className="w-6 h-6 text-amber-400" />
                        </div>
                        <p className="text-white text-[15px] font-semibold mb-1.5">
                            予期しないエラーが発生しました
                        </p>
                        <p className="text-white/50 text-xs mb-6 leading-relaxed">
                            お手数ですが、もう一度お試しください。直らないときは、
                            ホームから開き直してください。
                        </p>
                        <button
                            onClick={() => this.setState({ hasError: false })}
                            className="w-full py-3 bg-white text-black text-sm font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition"
                        >
                            再試行
                        </button>
                        {/* **出口を置く。**
                            「再試行」は `hasError` を下ろすだけなので、原因が
                            決定的（読めない行が混ざった応答など）なら押した
                            瞬間に同じカードへ戻る。このカードは
                            **アプリ全体（ヘッダーもフッターも）を包んでいる**
                            ので、リンクが1本も無いと画面に出口が無い。
                            しかも `manifest.webmanifest` は
                            `display: standalone` ＝ホーム画面から起動した人には
                            **アドレスバーもリロードボタンも無い**。
                            `<a href>` にするのは、ここが React の外へ出る
                            唯一の確実な手段だから（クライアント遷移では
                            `hasError` が下りない）*/}
                        {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                            **`<Link>` にすると直らない。** この境界は
                            `app/layout.tsx` でルーターより外側にあり、
                            `hasError` を下ろす場所は上のボタンしかない
                            （`componentDidUpdate` も `getDerivedStateFromProps`
                             も無い）。クライアント遷移では children が
                            描き直されるだけで**カードが残る**。
                            素の `href` で React ごと積み直すのが目的 */}
                        <a
                            href="/"
                            className="mt-3 block w-full py-3 text-white/70 text-sm rounded-full ring-1 ring-white/15 hover:bg-white/5 transition"
                        >
                            ホームへ
                        </a>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
