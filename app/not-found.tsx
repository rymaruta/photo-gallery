import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <p className="text-6xl font-bold text-white/20 mb-4" aria-hidden>
          404
        </p>
        <h1 className="text-xl font-bold mb-2">
          ページが見つかりません
        </h1>
        <p className="text-sm text-white/70 mb-8">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
        <nav className="flex flex-col sm:flex-row gap-3 justify-center items-center" aria-label="ナビゲーション">
          <Link
            href="/"
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            トップへ
          </Link>
          <Link
            href="/gallery"
            className="px-6 py-3 text-white/70 hover:text-white underline transition-colors"
          >
            ギャラリー
          </Link>
          <Link
            href="/about"
            className="px-6 py-3 text-white/70 hover:text-white underline transition-colors"
          >
            制作について
          </Link>
        </nav>
      </div>
    </main>
  );
}
