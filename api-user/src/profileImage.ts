/**
 * プロフィールのアイコン・カバーが**いま置かれているか**（#304 のお礼の確かめ・2026-10-18 判断）。
 *
 * アイコンとカバーは users テーブルに項目を持たない——置き場は S3 の決まったキー
 * （`profiles/<uid>`・`profiles/<uid>/cover`・`profile.ts`）だけで、アプリと Web は presigned URL で
 * 直に PUT する。だから「設定されているか」の正はその実体。
 *
 * **S3 は読まない（公開の CDN に HEAD で聞く）。** S3 の HeadObject には `s3:GetObject` が要るが、
 * 共有のロールに `profiles/*` の読みを足すのは止めている（`scripts/__tests__/privateMoveIam.test.ts`
 * ——要らない権限は漏らせない）。`profiles/*` はもともと CDN で誰にでも配っている画像なので、
 * 同じ URL に聞けば権限を増やさずに済む。実体は `no-store` で置かれる（エッジに控えない）。
 *
 * ⚠️ 無いキーの 404 はエッジに約10秒控えられる（`scripts/fix-cdn-error-pages.js` の `ErrorCachingMinTTL`）。
 * 毎回ちがう問い（`?r=`）を付けて控えを避けにいくが、問いを鍵に含めない配り方だと、置いた直後の
 * 10秒の間は「無い」と答えることがある——そのときは印を立てずに返すので、次の呼び出し（起動・保存し直し）で渡せる。
 *
 * **分からないときは「無い」に倒す**（404・ほかの失敗・時間切れも）。配りすぎない向き
 */
export type ProfileImageKind = "avatar" | "cover";

/** 待つ上限（Lambda の時間を食い切らない） */
const HEAD_TIMEOUT_MS = 3000;

export const profileImageKey = (uid: string, kind: ProfileImageKind) =>
    (kind === "cover" ? `profiles/${uid}/cover` : `profiles/${uid}`);

export async function profileImageExists(uid: string, kind: ProfileImageKind): Promise<boolean> {
    // 読み込み時ではなく呼ぶときに読む（トランクのほかの口・テストが CLOUDFRONT_URL 無しで import できるように）
    const base = (process.env.CLOUDFRONT_URL ?? "").replace(/\/$/, "");
    if (!base) {
        console.error("profileImageExists: CLOUDFRONT_URL が設定されていません");
        return false;
    }
    const path = profileImageKey(encodeURIComponent(uid), kind);
    const url = `${base}/${path}?r=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
        const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
        if (res.status !== 200) return false;
        // 空の実体は置かれていないのと同じに扱う（長さが分からなければ在ることにする）
        const len = res.headers.get("content-length");
        // 404 を差し替えるエラーページ（HTML）は 404 のまま返るが、念のため画像でない 200 も「無い」にする
        const type = res.headers.get("content-type") ?? "";
        if (type.startsWith("text/html")) return false;
        return len === null || Number(len) > 0;
    } catch (e) {
        console.error(`profileImageExists(${kind}) failed:`, e);
        return false;
    }
}
