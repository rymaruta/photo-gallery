/**
 * **署名つき画像 URL の期限を読む**（2026-10-18 判断・札 rymaruta/journey.photo-ios#294）。
 *
 * 公開範囲を絞った写真の画像は、API が CloudFront の署名つき URL（期限は10〜15分・
 * `api-user/src/signedUrl.ts`）で返す。`/private/*` が署名必須になると、
 * **期限を過ぎた URL は 403** で割れる——一覧を開いたまま15分置いてから
 * スクロールした・タブを戻した、で起きる。
 *
 * `<img>` の失敗からは HTTP の状態（403 か）が読めないので、**「署名つきで、
 * 期限を過ぎている URL が失敗した」を 403 とみなす**。期限内の失敗（回線など）は
 * 取り直しても直らないので、ここでは拾わない（取り直しが空回りし続けないように）。
 */

/** 署名つき URL の期限（epoch 秒）。署名つきでなければ null */
export function signedUrlExpiry(url: string): number | null {
    let params: URLSearchParams;
    try {
        params = new URL(url).searchParams;
    } catch {
        return null;
    }
    if (!params.has("Signature") || !params.has("Key-Pair-Id")) return null;
    const expires = Number(params.get("Expires"));
    return Number.isFinite(expires) && expires > 0 ? expires : null;
}

/**
 * 期限を過ぎた（またはすぐ過ぎる）署名つき URL か。
 *
 * `skewSec` だけ手前から「過ぎた」に数える——端末の時計のずれと、読み込みに
 * かかる時間のぶん。
 */
export function isExpiredSignedUrl(url: string, nowMs: number, skewSec = 30): boolean {
    const expires = signedUrlExpiry(url);
    return expires !== null && expires * 1000 <= nowMs + skewSec * 1000;
}
