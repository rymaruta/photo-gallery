// アップロードで「何を受け付けるか」と「どのURLを自分のものと認めるか」。
//
// 写真・ストーリー・プロフィール画像の3経路が同じ判断を必要とするのに、
// これまで各ファイルに別々の緩い判定が書かれていて穴が空いていた。
// ここが唯一の定義。

import { v5 as uuidv5 } from "uuid";

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
 *
 * **ただし、この許可リストだけでは塞げていなかった。** presigner は既定で
 * `content-type` を署名対象から外すので、`image/jpeg` で presign を取って
 * `text/html` で PUT できた（拡張子は `.jpg` のまま、中身は HTML）。
 * 署名対象に戻す指定が要る。**presign は3か所ある**ので、全部に入れること:
 *   - `api-user/src/upload.ts`（写真・ストーリー）
 *   - `api-user/src/profile.ts`（アイコン・カバー）
 *   - `api/src/upload.ts`（管理API。今はクライアントから呼ばれていない）
 * 1か所でも抜けると、そこ経由で同じ攻撃が通る。
 * 実際に何が署名されるかは `api-user/src/__tests__/presignSigning.test.ts`
 * が本物の SDK で測っている。
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
/**
 * 上の判定を、環境の `CLOUDFRONT_URL` で束ねた版。
 *
 * **ここに置くのは、呼び出す側の import の輪を小さく保つため。**
 * 以前はこの束ね版が `upload.ts` にあり、`stories.ts` がそれだけのために
 * `upload.ts` を import していた。`upload.ts` が再ビルド依頼（`rebuild.ts`）を
 * 使い始めた途端、**ストーリーの6関数まで「再ビルドのトークンが要る関数」に
 * 見えるようになる**（`scripts/__tests__/rebuildTokenScope.test.ts` は
 * ファイル単位で辿るため）。書き込みトークンを配る先は狭いほどよい（IAM-2）。
 */
export function isOwnUploadUrlFromEnv(raw: unknown, userId?: string): boolean {
    return isOwnUploadUrl(raw, process.env.CLOUDFRONT_URL ?? "", userId);
}

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

/**
 * 保存する URL を正規化する。
 *
 * 検証はデコードしてから行うので `https://cdn/up%6Coads/<uid>/x.jpg` も通る。
 * これをそのまま保存すると、あとから見る側（削除・派生生成）と
 * 表記が食い違い、対象から漏れる余地が残る。
 * 「検証したときに見ていた形」で保存して、以降は迷わないようにする。
 */
export function canonicalUploadUrl(raw: string, cloudfrontUrl: string): string {
    const key = keyFromUploadUrl(raw);
    if (!key) return raw;
    return `${cloudfrontUrl.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * アップロードの鍵から写真IDを**導出**する（`uploads/<uid>/<name>` から）。
 *
 * なぜ導出か: 保存の再送で同じ写真が2枚できるのを止めるには、同じ鍵に
 * 必ず同じIDが要る。ところが**鍵に書いてある UUID をそのまま採る作りは
 * 危ない**——`key` の検証は `uploadPrefix(userId)` で始まることだけで、
 * **presign した鍵かどうかは誰も確かめていない**（鍵は保存もされず、
 * S3 に実体があるかも見ない）。つまり `uploads/<自分のsub>/<好きなUUID>.webp`
 * と書くだけで、写真IDを選び放題になる:
 *
 *   - 削除済み写真のIDを取り直せる。`/photo/<id>` は公開URLで、
 *     サイトマップや検索結果に残っているので、その場所が別人の写真になる
 *   - `like#<photoId>#<uid>` は写真を消しても残る（api/src/ddb-photos.ts に
 *     明記）ので、復活させたIDには他人のマーカーが付いたまま
 *   - 200（作れた）と 409（既にある）で、任意のIDの生死が分かる
 *
 * v5（名前空間つきハッシュ）にすると、同じ鍵は必ず同じIDになる一方、
 * **狙ったIDを作る鍵は作れない**。AWS への問い合わせも増えない。
 *
 * 名前空間は固定値。変えると既存の鍵から出るIDが全部変わり、再送の
 * 見分けが効かなくなる（＝重複が復活する）ので、動かさないこと。
 */
const UPLOAD_ID_NAMESPACE = "6f9c0b2e-3a1d-4c58-9e7b-2d4a8f1c5b30";

export function idFromUploadKey(key: string): string {
    return uuidv5(key, UPLOAD_ID_NAMESPACE);
}
