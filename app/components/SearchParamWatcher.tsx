"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// クエリ文字列の1項目だけを見張って、変わったら知らせる。
//
// なぜ小さく切り出すのか: useSearchParams() を含む部分木は
// output: "export" では静的HTMLに焼けず、いちばん近い Suspense の
// フォールバックに差し替わってクライアント描画に落ちる。
// ギャラリー本体を巻き込むとトップページのHTMLが空になり、
// 検索流入という一番大事な導線を潰してしまう。
// 何も描画しないこの部品だけを Suspense で包んで隔離する。

function Watcher({ name, onChange }: { name: string; onChange: (value: string | null) => void }) {
    const params = useSearchParams();
    const value = params.get(name);
    React.useEffect(() => {
        onChange(value);
    }, [value, onChange]);
    return null;
}

export default function SearchParamWatcher(props: { name: string; onChange: (value: string | null) => void }) {
    return (
        <Suspense fallback={null}>
            <Watcher {...props} />
        </Suspense>
    );
}
