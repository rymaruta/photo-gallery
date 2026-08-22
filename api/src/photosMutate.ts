import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getPhotoById, updatePhotoFields, deletePhotoById } from "./ddb-photos";
import { isAdmin, getCallerUserId } from "./auth";
import { requestSiteRebuild } from "./rebuild";
import { requireEnv } from "./env";
import {
    sanitizeExif, sanitizeText, sanitizeDate, sanitizeTags,
    sanitizeTitle, sanitizeDescription, sameStoredValue,
} from "./sanitize";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
// **未設定なら起動時に止める。** `?? ""` / `!` にしていた頃は、環境変数が
// 空でも S3 の削除を**黙って飛ばして** DynamoDB の行だけ消し、成功を返していた。
// GPS 入りの原本（srcOriginal）を含む実体が公開URLに残り、項目が消えている
// ので**どの削除経路からも二度と辿れない**。
// 取り返しのつかない削除なので「分からないなら止める」に倒す
// （profile.ts と同じ扱い。CLAUDE.md の方針）。
const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * body から書き換えてよい項目だけを取り出し、**値も整える**（undefined は「触らない」）。
 *
 * 通すのは「編集画面で触れるもの」だけ。素性（id / userId / src 系）・
 * 集計値（likes / commentCount）・種別（story / expiresAt）は受け付けない。
 * 以前はリクエストの中身をそのまま SET していたので、自分の写真に
 * {"userId": "他人のsub"} を送るだけで、その写真を他人のギャラリーへ
 * 移せた（userId は GSI のハッシュキー）。
 *
 * キー名だけ見て値を素通ししていた頃は、この経路だけがサニタイズを通らず、
 * ユーザーAPI側（api-user/src/photoUpdate.ts）と保存されるものが違っていた。
 * どちらのホストもクライアントのバンドルに入っているので、利用者はどちらでも
 * 叩ける——つまり「緩い方」が実際の仕様になっていた。具体的には:
 *   - exif に gpsLatitude / gpsLongitude を入れると、そのまま保存され
 *     公開の GET /photos で配られ、静的HTMLにも焼き込まれた
 *     （sanitizeExif は既知のキーだけを通し、GPS を明示的に落とす）
 *   - tags を数千件、title を深くネストしたオブジェクト、なども通った
 */
export function pickEditableFields(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
        // キーが body にあるときだけ触る。値が空になった場合も
        // 「その項目を空にする」意図なので、undefined のまま入れる
        if (key in body && body[key] !== undefined) out[key] = value;
    };
    put("title", sanitizeTitle(body.title));
    put("description", sanitizeDescription(body.description));
    put("location", sanitizeText(body.location, 200));
    put("category", sanitizeText(body.category, 100));
    put("date", sanitizeDate(body.date));
    // 空配列は「そのタグを外す」指定。undefined にしておくと
    // updatePhotoFields が REMOVE を組み立てる（ユーザーAPI側と同じ姿になる）。
    // SET tags = [] にしていた頃は、同じ写真でも叩いたAPIによって
    // 「属性が空配列」と「属性が無い」に分かれ、再ビルドの判定が食い違った。
    const tags = sanitizeTags(body.tags);
    put("tags", Array.isArray(tags) && tags.length === 0 ? undefined : tags);
    put("exif", sanitizeExif(body.exif));
    // 公開状態は真偽値だけ。文字列の "false" などを通さない
    if (typeof body.published === "boolean") out.published = body.published;
    return out;
}

export const updatePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // このテーブルには写真以外（通知 notifs#... / コメント comments#... /
    // フォロー関係 following#... など）も同じキー空間に入っている。
    // 読み側（api/src/photos.ts の getPhoto）は同じ理由で弾いているのに、
    // 書き側だけ素通りだった。所有権の判定は `!isAdmin && ownerId !== callerId`
    // なので、**管理者だけ**が `PUT /photos/notifs%23<sub>` で他人の通知文書に
    // title を生やしたり、`DELETE` で丸ごと消したりできた（元に戻せない）。
    if (id.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const photo = await getPhotoById(id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const callerId = getCallerUserId(event);
        const ownerId = (photo.userId ?? photo.uploadedBy) as string | undefined;
        if (!isAdmin(event) && ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "編集権限がありません" }) };
        }
        // ストーリーはこのAPIの対象外。published:true を書き込むと
        // 永久の写真ページになり、24時間後の期限切れ掃除が実体だけ消して
        // 壊れたページとサイトマップの項目が残る。しかもストーリーは動画も
        // 許しているので、写真ギャラリーに動画を差し込む経路にもなる。
        // ユーザーAPI側（api-user/src/photoUpdate.ts）と同じ扱いにする。
        if (photo.story === true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const fields = pickEditableFields(body);
        const updates = { ...fields, updatedAt: new Date().toISOString() };
        const updated = await updatePhotoFields(id, updates);

        // 静的ページに焼かれる内容が変わったら作り直しを頼む。
        // 「公開状態が変わったときだけ」では狭い——本文や撮影地を消しても
        // 静的HTMLに残ってしまう。連打は coalesce で畳む
        // （ユーザーAPI側 api-user/src/photoUpdate.ts と同じ扱い）。
        //
        // 「キーが fields にあるか」で見ていた時期があるが、それは
        // 「毎回」と同じだった——/admin/edit は保存のたびに全項目
        // （exif を含む）を送るので、何も変えずに保存を押すだけで
        // ビルドが走る（1本8分・月2,000分）。値そのものを突き合わせる。
        const visibilityChanged = "published" in fields && fields.published !== (photo.published !== false);
        // 比べるのは**書いたあとの姿**。pickEditableFields が空を undefined に
        // 揃えてあり、updatePhotoFields はそれを REMOVE にする。
        const metaChanged = ["title", "description", "location", "category", "date", "tags", "exif"]
            .some((k) => k in fields && !sameStoredValue(fields[k], (photo as Record<string, unknown>)[k]));
        if (visibilityChanged || metaChanged) {
            await requestSiteRebuild(`photo updated: ${id}`, { coalesce: true });
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: updated }) };
    } catch (e) {
        // 条件が外れた＝Get と Update の間に写真が消えた。
        // 対の api-user/src/photoUpdate.ts と同じく 404 で返す
        // （500 のままだと利用者は「失敗したので再試行」と読んで押し直す）。
        // 条件（attribute_exists(id)）は揃えてあったのに、エラーの
        // 読み替えだけ揃っていなかった（調査ラウンド2の指摘）。
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        console.error("updatePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

export const deletePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // このテーブルには写真以外（通知 notifs#... / コメント comments#... /
    // フォロー関係 following#... など）も同じキー空間に入っている。
    // 読み側（api/src/photos.ts の getPhoto）は同じ理由で弾いているのに、
    // 書き側だけ素通りだった。所有権の判定は `!isAdmin && ownerId !== callerId`
    // なので、**管理者だけ**が `PUT /photos/notifs%23<sub>` で他人の通知文書に
    // title を生やしたり、`DELETE` で丸ごと消したりできた（元に戻せない）。
    if (id.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }

    try {
        const photo = await getPhotoById(id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const callerId = getCallerUserId(event);
        const ownerId = (photo.userId ?? photo.uploadedBy) as string | undefined;
        if (!isAdmin(event) && ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除権限がありません" }) };
        }

        // S3 から画像ファイルを削除（失敗してもDynamoDBレコードは削除する）。
        // 本体だけでなく派生画像も消す。特に srcOriginal は EXIF を落とす前の原本で
        // GPS が入ったままなので、消し残すと削除後も公開URLで取得できてしまう。
        // api-user/src/mediaKeys.ts の MEDIA_FIELDS と**対**。派生を足すときは
        // 両方を直すこと（片方だけ直すと admin 削除だけ消し残す）。
        // "key" と生キー（"uploads/..."）も受けるのはあちらと同じ理由。
        const mediaFields = [
            "key", "src", "srcOriginal", "srcAvif", "src256",
            "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif",
        ] as const;
        const keys = new Set<string>();
        for (const field of mediaFields) {
            const v = (photo as Record<string, unknown>)[field];
            if (typeof v !== "string" || !v) continue;
            if (v.startsWith("uploads/")) {
                let raw = v;
                try { raw = decodeURIComponent(v); } catch { /* 不正な % はそのまま */ }
                if (!raw.includes("..")) keys.add(raw);
                continue;
            }
            if (!v.startsWith("http")) continue;
            try {
                // パスはデコードしてから見る。生のままだと、保存時の検証
                // （デコードして判定している）と食い違い、
                // https://cdn/up%6Coads/... のようなURLが「保存はできるが
                // 削除では対象外」になる。CloudFront は %6C をデコードして
                // 解決するので、実体だけが公開URLに残り続ける。
                let key = new URL(v).pathname.substring(1);
                try { key = decodeURIComponent(key); } catch { /* 不正な % はそのまま */ }
                // 消してよいのはアップロード領域だけ。src は過去に検証なしで保存された
                // ものがあり、そのままキーにすると他人のアイコン（profiles/...）まで
                // 消せてしまう。
                if (key.startsWith("uploads/") && !key.includes("..")) keys.add(key);
                else console.warn(`deletePhoto: skip S3 delete for unexpected key ${key}`);
            } catch { /* URL でなければ無視 */ }
        }
        for (const key of keys) {
            try {
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (s3Err) {
                console.error("S3 delete error (non-fatal):", s3Err);
            }
        }

        await deletePhotoById(id);

        // 静的ページの掃除を頼む。実体を消しても、既に配ってある
        // /photo/<id> の HTML はそのまま残る（本文・撮影地・EXIF・
        // 表示名入りの JSON-LD まで焼き込まれている）。定期ビルドは
        // 止めてあるので、頼まないと誰かが push するまで消えない。
        await requestSiteRebuild(`photo deleted: ${id}`);

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deletePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
};
