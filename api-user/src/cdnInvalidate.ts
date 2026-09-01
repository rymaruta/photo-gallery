import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

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
 */
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID ?? "";
const cf = new CloudFrontClient({});

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
        await cf.send(new CreateInvalidationCommand({
            DistributionId: DIST_ID,
            InvalidationBatch: {
                // 同じ削除を再送しても無効化が二重に走らないよう、内容から作る
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
