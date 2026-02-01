export default function Loading() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center" aria-busy="true">
      <div className="w-12 h-12 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" aria-hidden />
      <p className="mt-4 text-sm text-white/60" role="status" aria-live="polite">
        読み込み中…
      </p>
    </main>
  );
}
