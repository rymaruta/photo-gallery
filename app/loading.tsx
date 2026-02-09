/**
 * ルート読み込み中の表示（枠は出さずテキストのみ）。
 */
export default function Loading() {
  return (
    <main className="p-4 sm:p-6 md:p-8 min-h-screen text-white bg-black max-w-5xl mx-auto w-full flex items-center justify-center" aria-busy="true">
      <p className="text-center text-white/50 text-sm py-8" role="status" aria-label="読み込み中">
        読み込み中…
      </p>
    </main>
  );
}
