// scripts/lib/smokeHero.mjs
//
// **写真ページの「主役の1枚」を見分ける鍵。**（2026-09-26）
//
// スモークは写真ページの `<img>` のうち、src に**写真の id** を含むものを主役と
// 数えていた。昔の写真は `uploads/<写真の id>.jpg` に置かれていたので成り立ったが、
// **今の投稿は `uploads/<投稿者の id>/<ファイルの id>.jpg`** で、ファイル名が写真の
// id と別になる（実測: 写真 1d98af4d… の画像は …/0ada6246….jpg）。その写真が
// 並びの先頭に来たビルドで `hero=0` になり、**本番の再ビルドが止まった**
// （2026-09-26 00:37 の site-rebuild・run 429。画面は正しく写真を出していた）。
//
// 主役の鍵は「写真の id」と「写真データの画像ファイル名（拡張子なし）」の両方。
// 派生（AVIF/WebP・幅違い）もファイル名を引き継ぐので、含むかどうかで見られる。

/**
 * @param {string} photoId
 * @param {Array<{ id: string, src?: string }>} photos `app/data/photos.json`
 * @returns {string[]} src に含まれていれば主役とみなす文字列（重複なし）
 */
export function heroKeys(photoId, photos) {
    const keys = [photoId];
    const row = (photos ?? []).find((p) => p?.id === photoId);
    if (row?.src) {
        try {
            const name = new URL(row.src, "https://example.invalid").pathname.split("/").pop() ?? "";
            const base = decodeURIComponent(name).replace(/\.[^.]+$/, "");
            if (base) keys.push(base);
        } catch {
            // 壊れた URL は写真の id だけで見る
        }
    }
    return [...new Set(keys)];
}
