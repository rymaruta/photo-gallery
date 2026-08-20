// アップロードで「何を受け付けるか」と「どのURLを自分のものと認めるか」。
//
// 写真・ストーリー・プロフィール画像の3経路が同じ判断を必要とするのに、
// これまで各ファイルに別々の緩い判定が書かれていて穴が空いていた。
// ここが唯一の定義。

/**
 * 受け付ける画像の MIME タイプ。
 *
 * 以前は `startsWith("image/")` だったが、これは `image/svg+xml` も通す。
 * SVG は <script> を書ける「実行可能な文書」で、presigned PUT が
 * Content-Type をそのままオブジェクトに焼き付け、CloudFront は
 * 同じディストリビューション（＝サイトと同一オリジン）で返す。
 * つまり誰でもサイト上で任意のスクリプトを実行でき、
 * localStorage の Cognito トークンを盗める（amazon-cognito-identity-js は
 * そこに保存する）。拡張子ではなく許可リストで塞ぐ。
 */
export const ALLOWED_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
    ["image/gif", "gif"],
    ["image/heic", "heic"],
    ["image/heif", "heif"],
]);

/** ストーリー用の動画。画像と違いブラウザは文書として実行しない */
export const ALLOWED_VIDEO_TYPES: ReadonlyMap<string, string> = new Map([
    ["video/mp4", "mp4"],
    ["video/webm", "webm"],
    ["video/quicktime", "mov"],
]);

/** 許可された種別なら拡張子を返す。許可外は undefined */
export function extForType(fileType: unknown, allowVideo: boolean): string | undefined {
    if (typeof fileType !== "string") return undefined;
    const type = fileType.split(";")[0].trim().toLowerCase();
    return ALLOWED_IMAGE_TYPES.get(type) ?? (allowVideo ? ALLOWED_VIDEO_TYPES.get(type) : undefined);
}

/**
 * 自分のアップロード領域のキー接頭辞。
 *
 * 以前は全員が `uploads/<uuid>.<ext>` というひとつの平場を共有していた。
 * 保存時の検証が「uploads/ 配下か」しか見ていなかったので、
 * 他人の公開URLを自分の写真の src として登録し、その写真を削除すると
 * 相手の実ファイルが S3 から消えた（元に戻せない）。
 * 投稿者ごとに掘り下げて、URL だけで持ち主が分かるようにする。
 */
export function uploadPrefix(userId: string): string {
    return `uploads/${userId}/`;
}

/**
 * 自分のアップロード領域を指すURLかどうか。
 *
 * `userId` を渡すと「その人の領域か」まで確かめる。保存・作成のように
 * 新しくキーを結び付ける場面では必ず渡すこと。渡さない場合は
 * uploads/ 配下という緩い判定にしかならない。
 *
 * `cloudfrontUrl` が未設定なら常に false（検証できないものは通さない）。
 */
export function isOwnUploadUrl(raw: unknown, cloudfrontUrl: string, userId?: string): boolean {
    if (typeof raw !== "string" || !raw) return false;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== "https:") return false;
    try {
        if (u.host !== new URL(cloudfrontUrl).host) return false;
    } catch {
        return false;
    }
    // %2F などでの偽装を防ぐため、デコード後のパスで判定する
    let pathname: string;
    try {
        pathname = decodeURIComponent(u.pathname);
    } catch {
        return false;
    }
    if (pathname.includes("..")) return false;
    const required = userId ? `/${uploadPrefix(userId)}` : "/uploads/";
    if (!pathname.startsWith(required)) return false;
    // 接頭辞の先に実体が要る（"/uploads/<uid>/" だけ、は不可）
    return pathname.length > required.length;
}

/** URL から uploads/ 配下のキーを取り出す（自分のものと確認済みの前提） */
export function keyFromUploadUrl(raw: string): string {
    try {
        return decodeURIComponent(new URL(raw).pathname).replace(/^\//, "");
    } catch {
        return "";
    }
}
