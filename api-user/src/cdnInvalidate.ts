/**
 * 消した実体を **CloudFront のエッジからも消す**（LEFT-4）。
 *
 * アップロードは `max-age=31536000`（1年）で配っている。S3 から消しても
 * **エッジに残っているぶんは URL を知っていれば取れ続ける**——削除・退会・
 * 期限切れストーリーのどれも、消したつもりで消えていない時間が最大1年
 * あった（本番の配信設定を CI から読んで確認: 既定1日・最大1年の
 * マネージドポリシー `CachingOptimized`）。GPS 入りの原本も同じ扱い。
 *
 * **失敗しても削除そのものは成功として扱う。** ここで投げると
 * 「S3 からは消えたのに API はエラー」になり、利用者は消えていないと
 * 思ってもう一度押す（そして今度は行が無いので 404）。消し残しは
 * 次のデプロイの無効化か TTL で最終的に消える。
 *
 * 配信IDが未設定なら**何もしない**（警告だけ）。requireEnv にしないのは、
 * 設定漏れで削除そのものを止めたくないため——この関数の目的は
 * 「消えるのを早める」ことであって、削除の前提条件ではない。
 *
 * **`@aws-sdk/client-cloudfront` は関数の中で読む。**
 * serverless の esbuild は `@aws-sdk/*` をバンドルから外す設定なので、
 * この import が解決できるかは**Lambda ランタイムが何を積んでいるか**
 * 次第になる。トップレベルの import にすると、無かったときに
 * モジュール読み込みの時点で落ち、**この関数を import しているだけの
 * 削除・退会・ストーリー掃除まで丸ごと失敗する**——「失敗しても削除は
 * 成功として扱う」と上に書いた約束を、読み込みの段で破っていた。
 * 中に入れておけば、無ければ警告1行で済む（`s3DeleteMany` は
 * この戻り値を握って先へ進む）。
 */
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID ?? "";

// 読めたクライアントは使い回す（他の口と同じ扱い）。読めなかったことは
// 覚えない——一時的な失敗で永久に諦めるより、次の削除でもう一度試す方がよい
let cached: { send: (cmd: unknown) => Promise<unknown> } | null = null;

export async function invalidateUploads(keys: readonly string[], logPrefix = "invalidateUploads"): Promise<boolean> {
    if (keys.length === 0) return true;
    if (!DIST_ID) {
        console.warn(`${logPrefix}: CLOUDFRONT_DISTRIBUTION_ID が未設定のため、エッジの掃除を飛ばします（実体は削除済み）`);
        return false;
    }
    // 先頭の `/` を1つだけ付けた形にする（`uploads/x.jpg` → `/uploads/x.jpg`）。
    // 重複は畳む——同じパスを2回数えると、無効化の**課金対象パス**が増える
    const paths = [...new Set(keys.map((k) => `/${String(k).replace(/^\/+/, "")}`))];
    try {
        const { CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
        cached ??= new CloudFrontClient({}) as unknown as typeof cached;
        await cached!.send(new CreateInvalidationCommand({
            DistributionId: DIST_ID,
            InvalidationBatch: {
                // **毎回ちがう値**。以前ここには「内容から作るので再送しても
                // 二重に走らない」と書いてあったが、`Date.now()` は内容と
                // 何の関係も無い——コメントだけがそう言っていた。
                // 内容から作る形にはしない: CloudFront は同じ
                // CallerReference に**同じ**バッチが来たら過去の無効化を
                // そのまま返すので、いつか同じキーを消し直したときに
                // 「完了済み」を返されて**エッジが掃除されない**方に倒れる。
                // 二重に走る側の損は、無効化1本ぶんの課金だけ。
                CallerReference: `del-${Date.now()}-${paths.length}`,
                Paths: { Quantity: paths.length, Items: paths },
            },
        }));
        return true;
    } catch (e) {
        console.error(`${logPrefix}: エッジの掃除に失敗しました（実体は削除済み）:`, e);
        return false;
    }
}
