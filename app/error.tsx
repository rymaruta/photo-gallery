"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

const messages = {
  ja: {
    title: "問題が発生しました",
    description: "申し訳ありません。ページの読み込み中にエラーが起きました。もう一度お試しください。",
    retry: "再試行",
    backToTop: "トップへ戻る",
  },
  en: {
    title: "Something went wrong",
    description: "Sorry, an error occurred while loading the page. Please try again.",
    retry: "Retry",
    backToTop: "Back to top",
  },
};

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Context に依存しない（エラー直後は LocaleProvider が使えない場合があるため）
  const [locale] = useState<"ja" | "en">(() => {
    if (typeof window === "undefined") return "ja";
    try {
      const stored = localStorage.getItem("locale");
      return stored === "en" || stored === "ja" ? stored : "ja";
    } catch {
      return "ja";
    }
  });
  const t = messages[locale] ?? messages.ja;

  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-6">
          <svg
            className="w-16 h-16 mx-auto text-white/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold mb-2">{t.title}</h1>
        <p className="text-sm text-white/70 mb-6">{t.description}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          {t.retry}
        </button>
        <p className="mt-6 text-xs text-white/50">
          <Link href="/" className="underline hover:text-white/70">
            {t.backToTop}
          </Link>
        </p>
      </div>
    </main>
  );
}
