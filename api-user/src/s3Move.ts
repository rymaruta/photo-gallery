import { S3Client, CopyObjectCommand } from "@aws-sdk/client-s3";
import { requireEnv } from "./env";
import { s3DeleteMany } from "./s3Delete";
import type { Move } from "./privateMove";

/**
 * 実体を別のキーへ**移す**（コピーしてから、元を消す）。
 *
 * ## 順番に意味がある
 *
 * **コピー → （呼び出し側が行を書き換える）→ 最後に元を消す。**
 * 逆だと、途中で落ちたときに**行が存在しない実体を指す**（写真が割れる）。
 * この順なら最悪でも S3 に孤児が残るだけで、画面は正しく出る
 * ——`photoUpdate.ts` の差し替えが同じ理由で同じ順序を採っている。
 *
 * だから**1つの関数にまとめない**。`copyAll` と `dropOld` に分け、
 * あいだに行の書き換えを挟めるようにする。
 *
 * ## 1つでもコピーに失敗したら、**何も消さない**
 *
 * 半分だけ移すと、行が指す先と実体がちぐはぐになる。**全部そろって
 * 初めて元を消す**——揃わなければコピーぶんが孤児として残るが、
 * それは画面に出ない（`docs/restricted-image-delivery.md`）。
 */

const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");
const s3 = new S3Client({});

/**
 * まとめてコピーする。**1つでも失敗したら false**（呼び出し側は
 * 行を書き換えず、元も消さない＝何も起きなかったことにする）。
 */
export async function copyAll(moves: Move[], logPrefix = "s3Move"): Promise<boolean> {
    // 空のときの早期 return は置かない（到達しない守りを作らない
    // ——`s3Delete.ts` が同じ注記を持っている）
    const results = await Promise.all(moves.map(async (m) => {
        try {
            await s3.send(new CopyObjectCommand({
                Bucket: UPLOAD_BUCKET,
                // **`CopySource` はバケット名込みで、URL エンコードが要る。**
                // 日本語や `+` を含むキーがそのままだと別のキーを指す
                CopySource: encodeURI(`${UPLOAD_BUCKET}/${m.from}`),
                Key: m.to,
                // **配信の設定（`Cache-Control` など）は引き継ぐ。**
                // `MetadataDirective` を省くと COPY 扱いで元の値が残る
            }));
            return true;
        } catch (e) {
            console.error(`${logPrefix}: コピーできませんでした ${m.from} → ${m.to}:`, e);
            return false;
        }
    }));
    return results.every(Boolean);
}

/**
 * 元を消す。**行を書き換えたあとに呼ぶ。**
 *
 * `s3DeleteMany` を通すので、**エッジ（CloudFront）の無効化まで**面倒を
 * 見る。これが要る——アップロードは `max-age=31536000`（1年）で配って
 * いるので、消しただけでは**古い URL がエッジから取れ続ける**。
 * それは「絞ったのに取り続けられる」そのもので、この作業の目的に反する。
 */
export async function dropOld(moves: Move[], logPrefix = "s3Move"): Promise<number> {
    return s3DeleteMany(moves.map((m) => m.from), logPrefix);
}
