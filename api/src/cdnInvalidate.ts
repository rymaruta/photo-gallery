/**
 * **`api-user/src/cdnInvalidate.ts` の写し。**
 *
 * 管理APIは別サービス（別の Lambda・別の esbuild）なので import できない。
 * **複製した規則は静かにずれる**ので、`scripts/__tests__/cdnInvalidateParity.test.ts`
 * が**2本のコードの一致**（コメントを落とした文字列）で縛る。片方だけ直すと落ちる。
 * 振る舞いで突き合わせる形は採れなかった——両方を1つのテストから import して
 * `@aws-sdk/client-cloudfront` を `vi.mock` すると、`api/node_modules` の有無で
 * 片方しかモックに当たらない。写しが実際に動くことは
 * `api/src/__tests__/cdnInvalidate.test.ts`（同じ場所からモックする）で見る。
 *
 * ここに来た経緯: 管理APIの `deletePhoto` は S3 からは消すのに
 * **エッジの掃除を呼んでいなかった**。`/uploads/*` は maxTTL 31536000秒
 * （365日）・実体は `max-age=31536000` なので（本番実測 2026-09-05）、
 * 管理者が消した写真は最大1年 公開URLで取れる——GPS 入りの原本ごと。
 */
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

/**
 * 1回の `CreateInvalidation` に入れられるパスの上限（CloudFront の制限）。
 *
 * **同じ上限を、片方だけ守っていた。** `scripts/deploy-static-site.js` は
 * `MAX_PATHS_PER_REQUEST = 3000` で分割しているのに、こちらは全部を1回に
 * 入れていた。超えると CloudFront が断るが、この関数は投げずに警告だけ出す
 * 設計なので、**消えたように見えたままエッジの掃除だけが静かに落ちる**
 * ——`951fac8` で「1行ごとに1本」をやめてまとめたぶん、1本が大きくなった。
 *
 * 届くのは期限切れストーリーの掃除（1時間ごと・溜まった回ほど件数が増える）。
 * 退会は写真100枚 × メディア9種 = 最大900なので届かない。
 */
const MAX_PATHS_PER_REQUEST = 3000;

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
    let sent = 0;
    let failed = 0;
    try {
        const { CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront");
        cached ??= new CloudFrontClient({}) as unknown as typeof cached;
        for (let i = 0; i < paths.length; i += MAX_PATHS_PER_REQUEST) {
            const chunk = paths.slice(i, i + MAX_PATHS_PER_REQUEST);
            // **1本落ちても残りは投げる。** `await` を並べただけだと、
            // 最初に断られたチャンクで**残り全部が捨てられる**——しかも
            // ログは1行だけなので、何本通ったのかも後から追えない。
            // 分割した意味は「全部を届ける」ことなので、途中で降りない。
            try {
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
                        CallerReference: `del-${Date.now()}-${i}-${chunk.length}`,
                        Paths: { Quantity: chunk.length, Items: chunk },
                    },
                }));
                sent++;
            } catch (e) {
                failed++;
                console.error(`${logPrefix}: エッジの掃除に失敗（${chunk.length}パス・${i} 件目から）:`, e);
            }
        }
    } catch (e) {
        // モジュールが読めない等、チャンク以前の失敗
        console.error(`${logPrefix}: エッジの掃除に失敗しました（実体は削除済み）:`, e);
        return false;
    }
    if (failed > 0) {
        // **何本通ったかを残す。** 部分的に無効化された状態を後から追えないと、
        // 「どのパスが残っているか」を調べる手がかりがゼロになる
        console.error(`${logPrefix}: ${sent + failed} 本中 ${failed} 本が失敗（実体は削除済み）`);
        return false;
    }
    return true;
}
