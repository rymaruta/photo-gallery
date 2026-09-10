import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "../ErrorBoundary";

// **カードから出る道が無かった。**
//
// 「再試行」は `hasError` を下ろすだけなので、原因が決定的
// （読めない行が混ざった応答など。`usePhotos.ts` のコメントが
// 「100件中1件が `null` なだけでページ全体がこのカードになった」と
// 実測を記録している）なら、押した瞬間に同じカードへ戻る。
//
// しかもこのカードは **`app/layout.tsx` でアプリ全体（ヘッダーも
// フッターも）を包んでいる**ので、リンクが1本も無いと画面に出口が無い。
// `manifest.webmanifest` は `display: standalone` ＝ホーム画面から
// 起動した人には**アドレスバーもリロードボタンも無い**。

function Boom(): React.ReactElement {
    throw new Error("boom");
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    // React は境界で捕まえた例外も console.error に出す（テストの出力を汚さない）
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* noop */ });
});
afterEach(() => { errorSpy.mockRestore(); });

describe("ErrorBoundary", () => {
    it("落ちたらカードを出す", () => {
        render(<ErrorBoundary><Boom /></ErrorBoundary>);
        expect(screen.getByText("予期しないエラーが発生しました")).toBeInTheDocument();
    });

    // **出口があること。** 「再試行」だけだと、決定的な失敗では押しても
    // 同じカードに戻り、standalone では他に押す場所が無い
    it("カードから出る道がある", () => {
        render(<ErrorBoundary><Boom /></ErrorBoundary>);
        const home = screen.getByRole("link", { name: "ホームへ" });
        // **クライアント遷移では `hasError` が下りない**ので、素の `href` で
        // React の外へ出る必要がある（`next/link` にしない）
        expect(home.getAttribute("href"), "React の外へ出られない").toBe("/");
    });

    it("再試行も残っている", () => {
        render(<ErrorBoundary><Boom /></ErrorBoundary>);
        expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
    });

    // 落ちていないときは中身をそのまま出す（カードを常時かぶせない）
    it("落ちていなければ中身を出す", () => {
        render(<ErrorBoundary><p>ふつうの画面</p></ErrorBoundary>);
        expect(screen.getByText("ふつうの画面")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "ホームへ" })).toBeNull();
    });

    // 呼び出し側が独自の画面を渡したときは、そちらを優先する
    it("fallback を渡されたら、そちらを出す", () => {
        render(<ErrorBoundary fallback={<p>専用の画面</p>}><Boom /></ErrorBoundary>);
        expect(screen.getByText("専用の画面")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "ホームへ" })).toBeNull();
    });
});
