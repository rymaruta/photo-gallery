import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto, getPhotoById, overwriteOwnPhoto, listMyMediaItems } from "./ddb-photos";
import type { Photo } from "./types";
import { JSON_HEADERS, getUserId, isAdmin } from "./http";
import { lookupDisplayNameIfSet } from "./notify";
import { sanitizeExif, sanitizeCoords, sanitizeBlurDataURL, sanitizeDate, sanitizeTitle, sanitizeDescription, sanitizeText, sanitizeTags, sanitizeFocalPoint, sanitizeGroupId, sanitizeAudience } from "./sanitize";
import { extForType, uploadPrefix, canonicalUploadUrl, idFromUploadKey, isOwnUploadUrlFromEnv as isOwnUploadUrl } from "./uploadPolicy";
import { sanitizeExtraImages, mergeExtraImages } from "./photoImages";
import { mediaKeys } from "./mediaKeys";
import { requestSiteRebuild } from "./rebuild";
import { photoLimitError } from "./photoLimit";
import { PUBLIC_FEED_KEY, RESTRICTED_FEED_KEY } from "./publicFeed";
import { isAlbumMember, addPhotoToAlbum } from "./albums";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
/**
 * アップロードを許す最大バイト数。
 *
 * **クライアント申告のままでは何の歯止めにもならなかった。** `fileSize` は
 * 任意項目で、省けば判定ごと飛び、嘘を書けばそのまま通る。しかも
 * presigned URL 自体が本文の長さを縛らないので、**50MB の制限は画面の
 * 中にしか無い**（直接叩けば単発 PUT の上限 5GB まで入る）。
 *
 * `ContentLength` を渡すと署名対象に入る（`presignSigning.test.ts` で
 * 本物の SDK に聞いて実測。`X-Amz-SignedHeaders` に `content-length` が出る）。
 * こうすると**申告した長さちょうど**でしか PUT できない——嘘をつけば
 * その嘘の長さに縛られるので、上限が実際に効く。
 *
 * 引き換えに、**クライアントは申告と1バイトも違わない本文を送る必要がある**。
 * 今の3経路（写真本体・サムネ・ストーリー）はどれも「`file.size` を申告して
 * その `file` をそのまま PUT する」形なのでずれようがない。新しい経路を
 * 足すときは、加工してから申告すること（加工前の長さを申告すると 403）。
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";

// 「自分のアップロード領域を指すURLか」の判定は uploadPolicy.ts の
// `isOwnUploadUrlFromEnv` に一本化した（同じ束ね版がここにもあり、
// **同じ規則が2つある**状態だった）。保存された src は削除時にそのまま
// S3 のキーになるので、ここが最後の砦になる。

// 枚数の上限とその判定は `photoLimit.ts` へ切り出した。
// **`upload.ts` から import すると `rebuild.ts` まで引きずられる**ので
// ——`storyKeep.ts` が上限だけ使いたいのに、再ビルドのトークンを配る関数の
// 一覧に載ってしまった（`rebuildTokenScope.test.ts` が止めた）。
// 判定は1か所のまま、依存だけ切る。
export { PHOTO_LIMIT_PER_USER } from "./photoLimit";

export const presignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    // sub が取れないと領域を切れない（uploads// になって全員が同じ場所を共有する）
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    // 100枚制限チェック（adminは除外）
    const limitError = await photoLimitError(userId, isAdmin(event));
    if (limitError) return limitError;

    let body: { fileName?: string; fileType?: string; fileSize?: number };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { fileName, fileType, fileSize } = body;
    if (!fileName || !fileType) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル名とファイルタイプが必要です" }) };
    }
    // **必須にする。** 任意のままだと、省くだけで下の上限判定も
    // `ContentLength` の署名も両方飛ぶ（＝好きなだけ入れられる）。
    // **整数であることまで見る。** `1234.5` を通すと `ContentLength` が
    // `"1234.5"` で署名され、ブラウザは整数しか送れないので**絶対に使えない
    // presign** ができる（叩いた本人しか困らないが、避けられる足元の穴）。
    if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize <= 0) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイルサイズが必要です" }) };
    }
    if (fileSize > MAX_UPLOAD_BYTES) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイルサイズが大きすぎます（最大50MB）" }) };
    }
    // 画像に加えて動画も許可（ストーリー用。mp4 / webm / QuickTime）。
    // 許可リストで判定する（"image/" で始まるかどうかでは svg が通ってしまう）。
    // 拡張子もファイル名からではなく種別から決める。ファイル名由来だと
    // "a.svg" のような名前がそのまま S3 のキーになっていた。
    const ext = extForType(fileType, true);
    if (!ext) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "対応していない形式です（JPEG・PNG・WebP・AVIF・HEIC・GIF、動画は MP4・WebM・MOV）" }) };
    }

    const safeContentType = fileType.split(";")[0].trim().toLowerCase();

    const photoId = uuidv4();
    // 投稿者ごとの領域に置く。URL だけで持ち主が分かるようにして、
    // 他人のファイルを自分の写真として登録・削除できないようにする。
    const key = `${uploadPrefix(userId)}${photoId}.${ext}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: UPLOAD_BUCKET,
            Key: key,
            // クライアントが送ってきた文字列ではなく、許可済みの種別だけを焼き付ける
            // （**署名対象に戻すのは下の `signableHeaders`**。これが無いと
            // 焼き付けたつもりで何も縛れていない）
            ContentType: safeContentType,
            // 申告した長さで縛る（下の `signableHeaders` で署名対象に入る）
            ContentLength: fileSize,
            CacheControl: "max-age=31536000",
        }),
        {
            expiresIn: 900,
            // **`signableHeaders` を渡さないと Content-Type は縛れない。**
            //
            // `@aws-sdk/s3-request-presigner` は presign の前に
            // `unsignableHeaders.add("content-type")` を無条件で実行する
            // （`dist-cjs/index.js` の `prepareRequest`）。つまり既定では
            // **署名対象から外れる**——ここで種別を焼き付けたつもりでも、
            // クライアントは同じ URL に好きな `Content-Type` で PUT できる。
            //
            // これは `uploadPolicy.ts` が SVG を弾く理由として書いている
            // 攻撃がそのまま通るということ: `image/jpeg` で presign を取り
            // （拡張子は `.jpg` に固定される）、`text/html` で PUT すると、
            // CloudFront はサイトと同一オリジンでその HTML を返す
            // ——localStorage の Cognito トークンが読める。
            //
            // `@smithy/signature-v4` の `getCanonicalHeaders` は
            // `signableHeaders` に入っていれば unsignable を**上書きする**
            // ので、明示して署名対象に戻す。
            //
            // なお `cache-control` も既定では署名されないが、**渡せば戻る**
            // （`ALWAYS_UNSIGNABLE_HEADERS` にも上書きは効く。測って確かめた）。
            // ただし戻すと縛りになる——クライアントが同じ値を送らないと 403 に
            // なる。こちらは「クライアントに付けさせたい」だけで、値を強制する
            // 必要は無いので渡さない。
            // `content-length` は既定でも署名対象に入るが、**明示しておく**
            // ——`content-type` を戻すために `signableHeaders` を渡した瞬間に
            // 「ここに書いたものが署名される」と読まれるので、両方書く方が
            // 誤解が無い（実際の既定は presignSigning.test.ts が測っている）
            signableHeaders: new Set(["content-type", "content-length"]),
        },
    );

    const publicUrl = CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/${key}`
        : `https://${UPLOAD_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-northeast-1"}.amazonaws.com/${key}`;

    return {
        statusCode: 200,
        headers: JSON_HEADERS,
        // **署名した種別をそのまま返す。** `content-type` を署名対象に戻したので、
        // クライアントは**同じ文字列**で PUT しないと 403 になる。自分で
        // `file.type` を組み立てさせると、大文字やパラメータ付きの差で落ちる
        body: JSON.stringify({ presignedUrl: presigned, key, publicUrl, photoId, contentType: safeContentType }),
    };
};

/**
 * **静的サイトに載る行か。** 公開中（`published` 未指定は公開）で、公開範囲を
 * 絞っていないもの——`scripts/sync-photos-from-ddb.js` の選別と同じ線。
 */
function onStaticSite(p: { published?: unknown; audience?: unknown }): boolean {
    return p.published !== false && !p.audience;
}

/**
 * 写真を1枚 公開したら、静的サイトを作り直してもらう。
 *
 * **これが無いと、投稿しても世に出ない。** このサイトは静的エクスポートで、
 * 写真ページも sitemap もビルド時のHTMLとして S3 に置かれる。書き込みは
 * DynamoDB に入るが、ページは**次の定期ビルド（週1・日曜 03:00 JST）まで
 * 生まれない**——最大7日、本人が投稿のリンクを誰にも共有できない。
 * 消す側（削除・非公開・退会）は最初から頼んでいたのに、**作る側だけが
 * 抜けていた**。
 *
 * **`coalesce` を付ける。** 最初これを外したが、逆向きに倒していた——
 * `photoUpdate.ts` が**まったく同じ判断を一度して戻している**（そちらの
 * コメントを読まずに隣で繰り返した）。クールダウンは畳み込みの仕掛けである
 * と同時に、**月次予算（`claimMonthlyBudget`）を減らす速度の唯一の歯止め**
 * でもある。予算は `coalesce` の有無に関わらず1加算されるので、素通しだと
 * 1人が100枚公開しただけで既定の 200本 の半分を使い切る。使い切ったら
 * その月いっぱい**写真削除・退会の掃除まで全部落ちる**——「出るのが遅れる」を
 * 直して「消したのに検索から見える」を月単位で作る取り引きになっていた。
 *
 * 畳まれても、たいていは落ちない: 畳まれた＝直近10分に誰かが頼んだ＝
 * **ビルドがもう走っている**ということで、その1本は**ビルド時に DynamoDB を
 * 読み直す**。取りこぼす窓は「そのビルドがテーブルを読んだ後 〜
 * `clearRebuildLock` が走るまで」——`sync-photos-from-ddb.js` の `main()` の
 * **最後**なので、scan のあとに表示名の突き合わせ（投稿者ごとに GetItem）と
 * 書き出しが挟まります（投稿者が増えるほど伸びる）。
 * **窓は短いが、そこに落ちた1枚は次に誰かが依頼を出すまで＝最悪7日**。
 * 旧コメントの「2枚目以降が丸ごと7日」は誇張だったが、7日が消えたのでは
 * なく確率が下がっただけ。
 *
 * **この変更で1つ失うもの**: 投稿がロックを取るので、**投稿直後の10分間は
 * `/user/edit` の編集依頼（`photoUpdate.ts` の `coalesce`）が畳まれます**
 * ——「投稿してすぐ、説明文に書いてしまった個人情報を消す」が、走っている
 * ビルドの scan 位置次第で次の依頼まで載らない。あちらは隠す操作のときしか
 * `staticStale` を立てないので、メタの消し忘れは行にも画面にも残りません。
 * ロックは `api` と `api-user` で同じ `rebuild#lock` を使う1つのものです。
 *
 * **下書きは頼まない。** 静的ページを持たないので作り直す理由が無い。
 *
 * 失敗しても投稿は成功で返す（写真はもう保存されている）。ログが手がかり。
 * なお `REBUILD_DISPATCH_TOKEN` が未設定の本番では、ここは警告1行を出して
 * 何もしない——**この関数が効くのは owner がトークンを登録してから**。
 */
async function requestRebuildForNewPhoto(id: string, isPublished: boolean): Promise<void> {
    if (!isPublished) return;
    // 投げさせない。**呼び出し元では `putPhoto` が既に成功している**ので、
    // ここで例外が上がると保存済みの写真について 500「保存に失敗しました」を
    // 返す（画面は実体を捨てにいく）。いまの rebuild.ts は全経路を包んでいて
    // 実際には投げないが、投げた瞬間に一番悪い形になる1行なので塞いでおく。
    await requestSiteRebuild(`photo published: ${id}`, { coalesce: true })
        // **黙って握らない。** `rebuild.ts` は失敗のたびに必ずログを出す作りで、
        // その終端に無言の catch を置くと方針が逆になる（今は投げないので
        // これは将来のための保険だが、発動したときに手がかりが無くなる）。
        .catch((e) => {
            console.error(`requestRebuildForNewPhoto: 想定外の例外（写真は保存済み・${id}）:`, e);
            return false;
        });
}

export const savePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: {
        key?: string;
        publicUrl?: string;
        photoId?: string;
        title?: Photo["title"];
        description?: Photo["description"];
        location?: string;
        category?: string;
        tags?: string[];
        exif?: Photo["exif"];
        coords?: unknown;
        dominantColor?: string;
        thumbUrl?: string;
        /** 一覧で写真のどこを中心に切り抜くか（0〜1）。未指定なら中央 */
        focalPoint?: unknown;
        published?: boolean;
        blurDataURL?: string;
        date?: unknown;
        /** 共同アルバムに入れる場合の行き先（案C）。メンバーでなければ断る */
        albumId?: unknown;
        /** 同じ投稿としてまとめる印。行は1枚ずつのまま */
        groupId?: unknown;
        /** 公開範囲。絞ると静的サイトには出ない（下の注記） */
        audience?: unknown;
        /** 2枚目以降（1投稿に複数枚）。表紙は `publicUrl`。信用しない */
        extraImages?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, title, description, location, category, tags, exif, coords, dominantColor, thumbUrl, blurDataURL } = body;
    // **共同アルバムに入れるなら、メンバーかどうかをここで確かめる。**
    // ここを通さずに `albumId` を保存できると、**誰でも他人のアルバムに
    // 写真を差し込める**（アルバムの ID は招待を受けた人なら知っている）。
    const albumId = typeof body.albumId === "string" && body.albumId ? body.albumId : undefined;
    if (albumId && !await isAlbumMember(albumId, userId)) {
        // **403 ではなく 404。** そのアルバムが実在することを教えない
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "アルバムが見つかりません" }) };
    }
    // 下書き保存: published === false のときだけ非公開。既定（未指定/true）は従来通り公開。
    const isPublished = body.published !== false;
    if (!key || !publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル情報が必要です" }) };
    }
    // 「自分のアップロード領域」を指すURLだけを受け付ける。
    //
    // uploads/ 配下かどうかしか見ていなかった頃は、他人の写真の公開URLを
    // 自分の写真の src として登録でき、そのままその写真を削除すると
    // 相手の実ファイルが S3 から消えた（削除は src のパスをそのまま
    // キーとして使うため。元に戻せない）。投稿者ごとの接頭辞まで確かめる。
    if (!isOwnUploadUrl(publicUrl, userId)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }
    // `..` を弾くのは discardUpload と揃えるため（あちらは最初から弾いている）。
    // 接頭辞だけ見ていると `uploads/<自分>/../<他人>/x.webp` が通り、
    // 「自分の領域の鍵」という前提が崩れる。
    if (!String(key).startsWith(uploadPrefix(userId)) || String(key).includes("..")) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なキーです" }) };
    }

    // 100枚制限の二重チェック（adminは除外）
    const limitError = await photoLimitError(userId, isAdmin(event));
    if (limitError) return limitError;

    // 表示名は**サーバーで引く**。本文の値を信用してはいけない。
    //
    // 保存された displayName は静的HTMLと JSON-LD の author に焼き込まれる
    // （lib/utils/seo.ts:131・PhotoPageClient:618）ので、受け取ると
    // 「運営」や他人の名前を写真ごとに名乗れる。
    // 同じことをストーリーでは既に禁じている——stories.ts:155 に
    // 「displayName は受け取らない（なりすまし防止のためサーバーで引く）」
    // と書かれていて、写真だけが例外だった。
    const resolvedDisplayName = await lookupDisplayNameIfSet(userId);
    const safeCoords = sanitizeCoords(coords);
    // 代表色: グリッドのプレースホルダー用。#rrggbb 形式のみ受け付ける
    const safeDominantColor = typeof dominantColor === "string" && /^#[0-9a-fA-F]{6}$/.test(dominantColor)
        ? dominantColor.toLowerCase()
        : undefined;
    // サムネイルURL: 一覧グリッド配信用の軽量版。
    // 「https で始まる」しか見ていなかったので、外部の任意URLを入れて
    // ギャラリーを見た人全員の IP を集めることができたし、他人の
    // uploads/ を指すこともできた（退会時にその実ファイルが消える）。
    // publicUrl とまったく同じ判定にする。
    const safeThumbSrc = isOwnUploadUrl(thumbUrl, userId) && String(thumbUrl).length <= 500
        ? canonicalUploadUrl(String(thumbUrl), CLOUDFRONT_URL)
        : undefined;
    // ぼかしプレビュー（data:image/webp;base64,...）: 画像 data URI のみ許可
    const safeBlurDataURL = sanitizeBlurDataURL(blurDataURL);
    // 撮影日（EXIF 由来）。年表を「撮った順」で並べるために保存する。
    const safeDate = sanitizeDate(body.date);
    // 検証したときに見ていた形で保存する（デコード済みのパスで組み直す）。
    // 生のまま保存すると、削除や派生生成で見る側と表記が食い違い、
    // 対象から漏れる余地が残る。**2枚目以降の重複判定にも使う。**
    const safeSrc = canonicalUploadUrl(publicUrl, CLOUDFRONT_URL);

    const photo: Photo = {
        // **IDは鍵から導出する（uuid v5）。** ここで毎回採番し直していたので、
        // 保存の再送が**同じ写真をもう1枚**作っていた: 「公開」を押す →
        // サーバーには届いたが応答が失われる（モバイル回線・API Gateway の
        // 29 秒）→ 画面は error になる → 押し直すと、S3 に上げた分は使い回す
        // のに save だけもう一度飛び、新しいIDで2枚目の行ができる。
        // 100枚の枠を2つ食い、片方を消すと共有している S3 の実体が消えて
        // **もう片方が割れた画像になる**。comments.ts は同じ形の再送を
        // 「前回の追記が通っていたら、もう足さない」で既に塞いでいる。
        //
        // **鍵に書いてある UUID をそのまま採ってはいけない**（一度そう書いた）。
        // 鍵は presign したものか誰も確かめていないので、それだと写真IDを
        // 選び放題になる。理由は idFromUploadKey の docstring に書いた。
        id: idFromUploadKey(String(key)),
        // 検証したときに見ていた形で保存する（デコード済みのパスで組み直す）。
        // 生のまま保存すると、削除や派生生成で見る側と表記が食い違い、
        // 対象から漏れる余地が残る。
        src: safeSrc,
        // **2枚目以降。** 表紙とまったく同じ厳しさで確かめる
        // （`photoImages.ts`）。ここを緩めると、他人の写真の公開URLを
        // 自分の投稿の2枚目に入れられ、自分の投稿を消したときに相手の
        // 実ファイルが S3 から消える——表紙で一度踏んだ穴。
        ...(() => {
            const e = sanitizeExtraImages(body.extraImages, userId, CLOUDFRONT_URL, safeSrc);
            return e ? { extraImages: e } : {};
        })(),
        // 保存時にもサニタイズを通す。photoUpdate.ts は通しているのにここだけ
        // 素通しで、任意の長さ・任意の構造の値が静的HTMLまで届いていた。
        // **題が無いなら属性ごと持たない。** 以前ここは「無題」を入れていたが、
        // それは**利用者が名付けた語ではない**のに一覧にも読み上げにも出ていた
        // （owner:「タイトルなくてもいいよ」）。編集の経路（`photoUpdate.ts`）は
        // 前から空を REMOVE に倒しているので、保存形もそちらに揃う
        ...(() => { const t = sanitizeTitle(title); return t ? { title: t } : {}; })(),
        ...(() => { const d = sanitizeDescription(description); return d ? { description: d } : {}; })(),
        ...(() => { const l = sanitizeText(location, 200); return l ? { location: l } : {}; })(),
        ...(() => { const c = sanitizeText(category, 100); return c ? { category: c } : {}; })(),
        // **タグ無しは「属性を持たない」に揃える。** ここだけ `tags: []` を
        // 必ず書いていたので、「タグ無し」の保存形が2通りあった。
        // photoUpdate.ts は空配列を REMOVE に倒すので、そちらとずれる。
        // 実害: この経路で上げた写真を /user/edit で初めて保存すると、
        // sameStoredValue(undefined, []) が false になって「変わった」と
        // 判定され、**中身を1文字も変えていないのに静的サイトの作り直しが
        // 走る**（Actions の枠を1枚につき1回無駄に使う）。
        ...(() => { const t = sanitizeTags(tags); return t && t.length > 0 ? { tags: t } : {}; })(),
        ...(() => { const safeExif = sanitizeExif(exif); return safeExif ? { exif: safeExif } : {}; })(),
        ...(safeCoords ? { coords: safeCoords } : {}),
        // **使えない値は属性ごと書かない**（`coords` と同じ）。中央のままに
        // 落ちるので、今までの写真と見え方が変わらない
        ...(() => { const f = sanitizeFocalPoint(body.focalPoint); return f ? { focalPoint: f } : {}; })(),
        ...(safeDominantColor ? { dominantColor: safeDominantColor } : {}),
        ...(safeThumbSrc ? { thumbSrc: safeThumbSrc } : {}),
        ...(safeBlurDataURL ? { blurDataURL: safeBlurDataURL } : {}),
        ...(safeDate ? { date: safeDate } : {}),
        // **同じ投稿としてまとめる印。** 行は1枚ずつのまま
        // （個別ページもサイトマップもこれまでどおり）で、アプリだけが
        // まとめて1つのカードに出す。まとめないときは属性を書かない
        ...(() => { const g = sanitizeGroupId(body.groupId); return g ? { groupId: g } : {}; })(),
        ...(resolvedDisplayName ? { displayName: resolvedDisplayName } : {}),
        userId,
        uploadedBy: userId,
        published: isPublished,
        ...(albumId ? { albumId } : {}),
        // 公開範囲。**絞った写真は静的サイトに出さない**
        // （`scripts/sync-photos-from-ddb.js` が落とす）。
        // 出すのは実行時の口（`GET /feed/restricted`）だけ
        ...(() => { const a = sanitizeAudience(body.audience); return a ? { audience: a } : {}; })(),
        // 公開一覧用 GSI（publicFeed-createdAt-index）のパーティションキー。
        // **公開中の写真にだけ入れる**——下書きに入れると一覧に出る。
        // 非公開にするときは photoUpdate.ts が REMOVE する。
        //
        // **公開範囲を絞ったものは別の仕切りへ。** 同じ索引の中で
        // 仕切りを分けるだけなので、索引を足さずに
        // 「`GET /photos` には出ない・絞ったぶんだけ引ける」が両立する
        ...(isPublished
            ? { publicFeed: sanitizeAudience(body.audience) ? RESTRICTED_FEED_KEY : PUBLIC_FEED_KEY }
            : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        await putPhoto(photo);
        // **写真を書いてからアルバムに足す。** 逆にすると、保存に失敗した
        // ときにアルバムへ「存在しない写真の ID」が残る。
        // 足せなくても投稿は成功で返す（写真はもう保存されている）。
        // **公開したときだけアルバムに入れる。** 下書きを入れると、
        // 招待リンク（未認証で開ける）から読めてしまう。読む側でも
        // 落としているが、そもそも入れない（多層で守る）。
        if (albumId && isPublished) {
            await addPhotoToAlbum(albumId, photo.id).catch((e) => {
                console.error(`savePhoto: アルバムに足せませんでした（写真は保存済み・${photo.id}）:`, e);
            });
        }
        // **公開範囲を絞った写真は頼まない。** 静的サイトには載らない
        // （`scripts/sync-photos-from-ddb.js` が落とす）ので、作り直しても
        // ページは変わらない——月の予算と Actions の枠を1本ずつ食うだけ。
        // ⚠️ 代わりに失うもの: ビルドの中の `generate-thumbnails.js` は絞った
        // 写真も処理する（`audience` を見ない）ので、寸法・AVIF などの派生は
        // **次のビルド（定期は週1）まで付かない**。画面は派生が無くても
        // `src` で出る（下書きから公開した写真と同じ扱い）ので、それを許容する
        await requestRebuildForNewPhoto(photo.id, onStaticSite(photo));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo }) };
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            // 既にその ID がある。**前回の保存が通っていた再送なら成功を返す。**
            // 中身まで見るのは、他人のIDとぶつかった場合に「成功しました」と
            // 返さないため（存在を教えることにもなる）。
            const existing = await getPhotoById(photo.id);
            if (!existing || (existing.userId ?? existing.uploadedBy) !== userId || existing.src !== photo.src) {
                return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "この画像はすでに登録されています" }) };
            }
            // **保存済みの行をそのまま返してはいけない。** 再送は「下書き保存で
            // 落ちたあと公開を押す」ことがあり、その回の published とメタデータが
            // 今回の意図になるので、今回の内容で書き直す。
            //
            // **`updatedAt = :ua` は「誰も触っていない」を見ていない。**
            // `stored` はこの要求の中で読んだ `existing` の値なので、条件が
            // 止められるのは **Get と Put の間に入った書き込みだけ**。
            // 「/user/edit で後から直した内容を巻き戻さない」と以前ここに
            // 書いていたが、そういう守りにはなっていない（半年前に直した行
            // でも条件は成立する。実際に走らせて確認した）。開きっぱなしの
            // アップロードタブで押し直すと、後から直したタイトル・説明は
            // 今回の本文で上書きされる——**塞ぐには「作られてから一度も
            // 更新されていない」を見る形が要る**が、`putPhoto` は
            // `createdAt` と `updatedAt` を別々の `new Date()` で書くので
            // ミリ秒でずれうる。倒し方を決める話なので、ここでは直さない。
            const stored = existing.updatedAt ?? existing.createdAt ?? "";
            // **サーバー側で書かれた項目は引き継ぐ。**
            //
            // 書き直しは `PutCommand`（全置換）で、`photo` は今回の本文から
            // 組み立てたものなので、**利用者が送らない項目はすべて消える**:
            //
            //   - いいね数・コメント数（`likes.ts` / `comments.ts` が加算する）
            //   - 寸法・ぼかし・AVIF などの派生（`generate-thumbnails.js` が
            //     ビルド時に書く。あれは `updatedAt` を意図的に触らない）
            //   - 写真に付けた曲（`photoUpdate.ts:163` が `song` /
            //     `songYoutubeUrl` を書く。写真ページから公開後に付ける）
            //   - 地名から補った座標（`scripts/geocode-locations.js:227` が
            //     `coords` と `geoApprox` を書く。**手動実行なので、消えると
            //     定期ビルドでも戻らない**）
            //
            // `srcOriginal`（GPS 入りの原本の在りか）は**今どの保存経路も
            // 書かない**（`scripts/generate-thumbnails.js:98` が同じことを
            // 書いている。代入は grep で0件）。原本を残す判断に戻したときの
            // 保険として一覧に入れておくだけで、いま消えるものではない
            // ——`c789624e` のコミットメッセージはこれを実在する書き手と
            // 同列に並べていた。**訂正**。
            //
            // いいね数が消えるのがいちばん重い。`like#<photoId>#<uid>` の
            // マーカーは残るので、いいねした人が押し直しても「既にいいね済み」
            // で +1 されず、解除しても `likes > :z` が外れて空振り
            // ——**誰にも戻せない**。
            //
            // **一覧は明示的に持つ。** 「知らない項目は全部引き継ぐ」にすると、
            // 下書きに戻す再送で `publicFeed`（公開一覧の索引キー）や
            // `albumId` まで残り、**非公開にしたのに一覧に出続ける**。
            // **今回の本文にある項目は今回が勝つ**（サムネ・代表色・ぼかしは
            // クライアントも送る）。
            const SERVER_OWNED_FIELDS = [
                "likes", "commentCount", "staticStale",
                "width", "height", "aspectRatio", "dominantColor", "blurDataURL",
                "thumbSrc", "thumbAvif", "thumbSm", "thumbSmAvif", "srcAvif", "src256", "srcOriginal",
                "song", "songYoutubeUrl",
            ] as const;
            const serverOwned: Record<string, unknown> = {};
            for (const k of SERVER_OWNED_FIELDS) {
                if (existing[k] !== undefined && photo[k] === undefined) serverOwned[k] = existing[k];
            }
            // **座標は一覧に並べない。** `geoApprox`（おおよその位置という印）
            // だけ引き継ぐと、GPS を切って送り直した回に「正確な座標に
            // 『おおよそ』の印が付いた行」ができる——`photoUpdate.ts:214` と
            // `api/src/photosMutate.ts:126` が対で塞いでいる形そのもの。
            // **印が立っているとき（＝地名から補った値）だけ、対で引き継ぐ。**
            // 利用者の GPS 由来の座標は引き継がない（切ったのに戻る、を作らない）。
            //
            // **地名を直した回は引き継がない。** 補った座標は地名に付随する
            // ので、撮影地を「パリ」→「ロンドン」に直して送り直すと
            // 「ロンドン（おおよそ）」のピンがパリに立つ
            // ——`photoUpdate.ts:223` が「地名が変わったら座標ごと捨てる」で
            // 塞いでいる形を、こちらに作り直すことになる。
            const sameLocation = (photo.location ?? "") === (existing.location ?? "");
            if (photo.coords === undefined && sameLocation
                && existing.geoApprox === true && existing.coords !== undefined) {
                serverOwned.coords = existing.coords;
                serverOwned.geoApprox = true;
            }
            // **2枚目以降の派生も落とさない。** `SERVER_OWNED_FIELDS` は
            // 行の属性を見るが、`extraImages` の派生は**配列の要素の中**に
            // ある。利用者が送り直すのは `src`（とクライアントが作れる
            // サムネ・代表色）だけなので、そのまま書くと `srcAvif` などが
            // 消える。同じ `src` の既存要素から引き継ぐ（今回の本文にある
            // 項目は今回が勝つ、は上位と同じ規則）。
            const mergedExtra = mergeExtraImages(photo.extraImages, existing.extraImages);
            const rewritten = {
                ...photo, ...serverOwned,
                ...(mergedExtra ? { extraImages: mergedExtra } : {}),
                createdAt: existing.createdAt ?? photo.createdAt,
            };
            if (stored && await overwriteOwnPhoto(rewritten, stored)) {
                // **再送でもアルバムに足す。** 1回目の `addPhotoToAlbum` が
                // 落ちた（スロットル・500枚上限）あとに押し直す場面で、
                // ここを呼ばないと**直ってほしい操作で直らない**。
                // `addPhotoToAlbum` は冪等（既に入っていれば条件で落ちる）
                if (albumId && isPublished) {
                    await addPhotoToAlbum(albumId, photo.id).catch(() => undefined);
                }
                // 再送で「下書き → 公開」に変わることがある（公開で落ちて
                // 下書き保存し、そのあと公開を押し直す形）。最初の保存の
                // ときは下書きで頼まなかったので、ここでもう一度見る。
                //
                // **既に公開済みだったなら頼まない。** 再送は「モバイル回線で
                // 応答だけが失われた」ときに起きるので、ただの二重送信でも
                // ここに来る。そのたびに頼むと月の予算を1本ずつ食う
                // （最初の保存で既に頼んである）。
                // **`!== false` で見る。** このリポジトリは「未指定は公開」で
                // 揃っていて（`upload.ts:260` の `isPublished` 自身がそう。
                // ほか photoUpdate・account・userProfile・sync スクリプト）、
                // `=== true` はここだけだった＝対の乖離。`published` を持たない
                // 古い行では「下書きだった」と読み、二重送信のたびに予算を食う。
                // **「静的サイトに載っていたか」で比べる。** 公開範囲を絞った行は
                // 公開でも載らないので、絞った → 全体に公開 の再送は頼む側、
                // 絞ったままの公開は頼まない側に入る
                const wasOnStaticSite = onStaticSite(existing);
                // **`staticStale` を下ろす対がここには作れない。**
                // `photoUpdate.ts:353` は「依頼が届いたら REMOVE」を持って
                // いるが、`requestRebuildForNewPhoto` は `Promise<void>` で
                // 成否を返さないので、**そもそも判断する材料がここに無い**
                // （下ろすなら戻り値を通すところから）。倒す先としては
                // 「余分に頼む」側が安全ではある——印を落として実際には
                // 届いていなければ、古い静的ページを誰も覚えていない。
                await requestRebuildForNewPhoto(photo.id, onStaticSite(photo) && !wasOnStaticSite);
                console.log(`savePhoto: 同じ写真の再送を受け取り、今回の内容で書き直しました（${photo.id}）`);
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: rewritten }) };
            }
            console.log(`savePhoto: 同じ写真の再送を受け取りました（${photo.id}）`);
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: existing }) };
        }
        console.error("savePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "保存に失敗しました" }) };
    }
};

/**
 * DELETE /user/uploads — 保存に至らなかった自分のアップロードを消す。
 *
 * 投稿の流れは「S3 に上げる → DynamoDB に書く」の2段。保存に失敗した項目は
 * 画面上 `error` になるが、そこで捨てる（× を押す／タブを閉じる）と
 * **実体だけが S3 に残る**。どの削除経路も DynamoDB の項目からキーを引くので、
 * 項目の無いオブジェクトには誰も手が届かない——退会しても、写真を消しても
 * 残り続ける（原本 srcOriginal は GPS 入りのまま公開URLで取れる）。
 *
 * 消してよいのは「自分の領域にあって、まだどの写真にも使われていない」キーだけ。
 * 使用中かどうかを確かめるのが要点で、これが無いと利用者は自分の**保存済みの**
 * 写真の実体だけを消せてしまう（DynamoDB には行が残るので、一覧に
 * 割れた画像が並び、本人にも直せない）。
 */
export const discardUpload: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { key?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const key = typeof body.key === "string" ? body.key : "";
    // 自分の領域のキーだけ。".." は扱わない（S3 のキーとしては正当だが、
    // 別の場所を指す形になっていないかを確かめる術が無い）。
    // 前置きの判定は uploadPolicy.uploadPrefix に寄せる（保存側と同じ根拠）。
    if (!key || !key.startsWith(uploadPrefix(userId)) || key.includes("..")) {
        return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "このファイルは削除できません" }) };
    }

    // 保存済みの写真**とストーリー**が使っているキーは消さない。
    // listMyPhotos（ストーリー除外）で判定していた頃は、自分の生きている
    // ストーリーの実体を消せた——item は残るので、全員のトレイに壊れた
    // 画像が最大24時間出続ける。
    // 数えられなかったら**消さない**（photoLimitError と同じ考え方——
    // 分からないなら止める。ここで通すと、取り返しのつかない削除になる）。
    let mine: Photo[];
    try {
        mine = await listMyMediaItems(userId);
    } catch (e) {
        console.error("discardUpload: listMyMediaItems failed:", e);
        return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "確認できませんでした。時間をおいてもう一度お試しください" }) };
    }
    const inUse = mine.some((p) => mediaKeys(p as unknown as Record<string, unknown>).includes(key));
    if (inUse) {
        return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "この画像は保存済みの写真で使われています" }) };
    }

    try {
        await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
    } catch (e) {
        console.error("discardUpload: S3 delete failed:", e);
        return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
};
