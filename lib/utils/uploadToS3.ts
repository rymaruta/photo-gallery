import { userFetch, readApiError } from "./api";

/**
 * **presign を取って S3 へ PUT する。** アップロードと差し替えの両方が使う。
 *
 * 切り出したのは、**同じものを二度作らない**ため。ここには「書いた理由が
 * 残っている決まりごと」が3つあり、写すと片方だけ古くなる:
 *
 * 1. **サーバーが署名した種別で送る。** `content-type` は署名対象なので、
 *    違う文字列だと S3 が 403 にする
 * 2. **PUT の前に鍵を控える。** 控えていなかった頃は、`fetch` が reject した
 *    とき（本文は上がりきったが応答が返らない——モバイル回線でよくある）に
 *    鍵がどこにも残らず、再試行が**別の鍵**へ上げ直していた。前の実体は
 *    DynamoDB に行が無いので、写真削除・退会・discard の**どの経路からも
 *    辿れない**。再試行のたびに1つずつ増える
 * 3. **番号だけの文字列を投げない。** catch は `e.message` をそのまま画面に
 *    出すので、利用者に「S3 403」が見えていた
 */
export type PutResult = { key: string; publicUrl: string; contentType?: string };

export async function presignAndPut(file: File, opts: {
    signal?: AbortSignal;
    /** 失敗の文言（呼ぶ側の言語で作る） */
    startFailed: string;
    putFailed: string;
    /** **PUT の前に**呼ぶ。呼ぶ側はここで鍵を控える（上の2） */
    onKeyReserved?: (key: string) => void;
    /** 上がったことが確認できたら呼ぶ（控えを下ろす） */
    onUploaded?: () => void;
}): Promise<PutResult> {
    const presignedResponse = await userFetch("/upload/presigned-url", {
        method: "POST",
        signal: opts.signal,
        body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size }),
    });
    if (!presignedResponse.ok) {
        // サーバーは日本語の理由を返す（例: アップロード上限に達しています）。
        // 生の JSON を切って出すと、肝心の一文が途中で切れて見える
        throw new Error(await readApiError(presignedResponse, opts.startFailed));
    }
    const presigned = await presignedResponse.json() as {
        presignedUrl: string; publicUrl: string; key: string; contentType?: string;
    };
    // 返ってこない古い API 相手でも動くよう、無ければファイルの種別
    const putType = presigned.contentType ?? file.type;
    opts.onKeyReserved?.(presigned.key);

    const uploadResponse = await fetch(presigned.presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": putType, "Cache-Control": "max-age=31536000" },
        signal: opts.signal,
    });
    if (!uploadResponse.ok) throw new Error(opts.putFailed);
    opts.onUploaded?.();
    return { key: presigned.key, publicUrl: presigned.publicUrl, contentType: presigned.contentType };
}
