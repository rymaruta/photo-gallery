import { createSign } from "node:crypto";

/**
 * **絞った写真の画像 URL に、期限を付ける。**
 *
 * ## なぜ要るのか
 *
 * 公開範囲（`audience`）を守っているのは API だけで、
 * **`/uploads/**` の画像そのものには権限の判定がありません**。
 * つまり:
 *
 *  - 一度 URL を手に入れた人は、**フォローを外されてもブロックされても**
 *    CloudFront から取り続けられる
 *  - 公開 →「フォロワーのみ」に変えても、**画像の実体は動かない**
 *    （再ビルドが作り直すのは HTML だけ）
 *
 * `restrictedFeed.ts` が誰に見せるかを正しく判定しても、**そこで配った
 * URL が永久に有効**なら、判定は「初回だけ」効いていることになります。
 *
 * ## 仕組み（CloudFront の署名付き URL・canned policy）
 *
 * 期限を書いた小さな JSON に RSA-SHA1 で署名し、`Expires` `Signature`
 * `Key-Pair-Id` を問い合わせに足すだけ。CloudFront 側は**鍵グループ**を
 * 設定した振る舞いで検証します。
 *
 * ## ⚠️ **本番にはまだ効きません**
 *
 * 効かせるには本番の CloudFront に**鍵グループと「署名必須」の振る舞い**を
 * 足す必要があり、それは**本番の設定変更**です（owner の承認事項）。
 * この実装は承認前に進めてよい範囲——**設計・ローカル実装・作り物での
 * テスト**——に留めてあります。
 *
 * **鍵が無い環境では何もしません**（URL を素のまま返す）。ここで
 * 止めてしまうと、鍵を入れるまで「フォロワーのみ」の写真が
 * **1枚も出ない**——owner が設定する前に機能を壊す方が悪い。
 * 代わりに `isConfigured()` を用意して、**効いているかどうかを
 * 診断から読めるように**します。
 */

/** 署名の有効時間。**短くする**——長いと「外したのに見える」窓が伸びる */
export const DEFAULT_TTL_SEC = 10 * 60;

export type SignerConfig = {
    keyPairId: string;
    /** PEM（`-----BEGIN RSA PRIVATE KEY-----` …）。改行は `\n` でも実改行でもよい */
    privateKey: string;
};

/**
 * 設定を環境変数から読む。**無ければ undefined**（例外にしない）。
 *
 * 本番値のフォールバックは置かない（`CLAUDE.md` の方針）。
 */
export function signerFromEnv(env: NodeJS.ProcessEnv = process.env): SignerConfig | undefined {
    const keyPairId = (env.CLOUDFRONT_KEY_PAIR_ID ?? "").trim();
    // 秘密鍵は Secrets から環境変数に入る。`\n` が literal で来る形も受ける
    const privateKey = (env.CLOUDFRONT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
    if (!keyPairId || !privateKey) return undefined;
    return { keyPairId, privateKey };
}

/** 効いているか（診断用。**「設定してあるつもり」を目で確かめられるように**） */
export function isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return signerFromEnv(env) !== undefined;
}

/** CloudFront は base64 の 3文字を置き換える（URL に載せるため） */
function toCloudFrontBase64(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/=/g, "_").replace(/\//g, "~");
}

/** canned policy。**この URL だけ**に効く（前方一致にしない） */
export function cannedPolicy(url: string, expiresEpochSec: number): string {
    return JSON.stringify({
        Statement: [{ Resource: url, Condition: { DateLessThan: { "AWS:EpochTime": expiresEpochSec } } }],
    });
}

/**
 * 署名付き URL を作る。
 *
 * - **鍵が無ければ、渡された URL をそのまま返す**（上の理由）
 * - **https 以外は署名しない**（`data:` や相対パスが混ざっても壊さない）
 * - 既に問い合わせが付いていても壊さない（`&` で足す）
 */
export function signUrl(
    url: string,
    opts: { now?: number; ttlSec?: number; signer?: SignerConfig } = {},
): string {
    const signer = opts.signer ?? signerFromEnv();
    if (!signer) return url;
    if (!/^https:\/\//.test(url)) return url;

    const now = opts.now ?? Date.now();
    const ttl = opts.ttlSec ?? DEFAULT_TTL_SEC;
    const expires = Math.floor(now / 1000) + ttl;

    const policy = cannedPolicy(url, expires);
    let signature: string;
    try {
        const sign = createSign("RSA-SHA1");
        sign.update(policy);
        signature = toCloudFrontBase64(sign.sign(signer.privateKey));
    } catch (e) {
        // **署名できなければ素の URL を返す。** 落とすと一覧が丸ごと 500 になり、
        // 「鍵の書き間違い」が「写真が1枚も出ない」として現れる
        console.error("signUrl: 署名できませんでした:", e);
        return url;
    }
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}Expires=${expires}`
        + `&Signature=${signature}`
        + `&Key-Pair-Id=${encodeURIComponent(signer.keyPairId)}`;
}

/**
 * 写真1枚の中の**画像の URL を全部**署名する。
 *
 * **`src` だけでは足りない。** 画面は派生（AVIF/WebP・サムネ）を
 * `<picture>` や `srcset` で出すので、そこが素のままだと**同じ写真が
 * 期限なしで取れる**——鍵をかけた玄関の横に窓が開いている形。
 */
export const IMAGE_FIELDS = [
    "src", "thumbSrc", "src256", "thumbAvif", "thumbSm", "thumbSmAvif", "srcAvif",
] as const;

export function signPhotoImages<T extends Record<string, unknown>>(
    photo: T,
    opts: { now?: number; ttlSec?: number; signer?: SignerConfig } = {},
): T {
    const signer = opts.signer ?? signerFromEnv();
    if (!signer) return photo;
    const out = { ...photo };
    for (const field of IMAGE_FIELDS) {
        const value = out[field];
        if (typeof value === "string" && value) {
            (out as Record<string, unknown>)[field] = signUrl(value, { ...opts, signer });
        }
    }
    return out;
}
