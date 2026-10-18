/**
 * 画像のバイト列を取り直す。**まず同一オリジンで。**
 *
 * 使うのはストーリーの「残す」のサムネと、プロフィールのカバーを自分の投稿から選ぶとき（#304）。
 * 2026-10-18 に `StoryViewer.tsx` の中からここへ出した（中身は変えていない）
 *
 * `item.src` は CloudFront の既定ドメイン（`CLOUDFRONT_URL`）を指すので、
 * `journey-photo.com` から見ると**別オリジン**。`fetch` の既定は
 * `mode: "cors"` なので `Access-Control-Allow-Origin` が要るが、
 * **`/uploads/*` は CORS を返していない**——キャッシュポリシーが `Origin`
 * を転送しないので S3 のバケット CORS まで届かない
 * （`public/sw.js` の `isStorablePhoto` が同じことを書いている。
 *  `PhotoPageClient` の EXIF 取得が best-effort なのも同じ理由）。
 * つまり素で `fetch(src)` すると **必ず TypeError** で、呼び出し側の
 * `.catch` が飲んで「サムネ無しで成功」になる＝直したつもりで何も
 * 変わらない、というこのリポジトリが繰り返している形。
 *
 * `/uploads/*` は**サイトと同じディストリビューションのビヘイビア**なので、
 * パスだけにすれば同一オリジンとして取れる（CORS が要らない）。
 * 取れなければ元の URL でもう一度試す——CORS が入った環境や、
 * サイト側に `/uploads/*` が無い置き方でも動くように。
 */
export async function fetchImageBytes(src: string): Promise<Blob> {
    let sameOrigin = "";
    try {
        const u = new URL(src, location.href);
        if (u.origin !== location.origin && u.pathname.startsWith("/uploads/")) sameOrigin = u.pathname;
    } catch { /* URL でなければそのまま */ }
    if (sameOrigin) {
        const res = await fetch(sameOrigin).catch(() => null);
        if (res?.ok) return await res.blob();
    }
    const res = await fetch(src);
    if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
    return await res.blob();
}

