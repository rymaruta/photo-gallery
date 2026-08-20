// 静的サイトの再ビルドを頼む。
//
// なぜ要るか:
//   このサイトは静的エクスポートで、写真ページもプロフィールページも
//   ビルド時のHTMLとして S3 に置かれている。退会・写真削除・非公開に
//   しても、DynamoDB と S3 の実体が消えるだけで、**既に配ってある
//   HTML はそのまま残る**。写真ページには本文・撮影地・EXIF・
//   表示名入りの JSON-LD まで焼き込まれているので、「消したのに
//   検索から見える」状態が続く。しかも定期ビルドは Actions の枠の
//   都合で止めてあるので、誰かが main に push するまで直らない。
//
// やり方:
//   GitHub の repository_dispatch を1回叩く。ワークフロー側は
//   concurrency でまとめられるので、連続削除でも枠を食い潰さない。
//
// 設定が無ければ何もしない:
//   トークン未設定の環境（staging・ローカル・テスト）で失敗させたくない。
//   削除そのものは成功しているので、ここで例外を投げるのは筋が悪い。
//   代わりに警告を1行出す。

const REBUILD_REPO = process.env.REBUILD_REPO ?? "";
const REBUILD_TOKEN = process.env.REBUILD_DISPATCH_TOKEN ?? "";

/** 呼び出し元を止めない。成否だけ返す（ログ用） */
export async function requestSiteRebuild(reason: string): Promise<boolean> {
    if (!REBUILD_REPO || !REBUILD_TOKEN) {
        console.warn(`requestSiteRebuild: 未設定のため再ビルドを頼めません（${reason}）。` +
            "REBUILD_REPO と REBUILD_DISPATCH_TOKEN を設定すると、削除後に静的ページも消えます。");
        return false;
    }
    try {
        const res = await fetch(`https://api.github.com/repos/${REBUILD_REPO}/dispatches`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${REBUILD_TOKEN}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "photo-gallery-api",
            },
            body: JSON.stringify({ event_type: "site-rebuild", client_payload: { reason } }),
        });
        if (!res.ok) {
            console.error(`requestSiteRebuild: ${res.status} ${await res.text().catch(() => "")}`);
            return false;
        }
        console.log(`requestSiteRebuild: 再ビルドを依頼しました（${reason}）`);
        return true;
    } catch (e) {
        console.error("requestSiteRebuild error:", e);
        return false;
    }
}
