/**
 * 必須の環境変数を読む。未設定なら止める。
 *
 * 以前は各スクリプトが `process.env.X ?? "prod-..."` と本番値を既定にしていた。
 * その結果、環境を渡し忘れたステージング用の実行が、警告も出さずに
 * 本番のテーブル・バケット・ディストリビューションを操作してしまう状態だった
 * （generate-thumbnails.js は実際に DynamoDB と S3 へ書く）。
 *
 * 設定ミスは「本番を触る」ではなく「動かない」に倒す。
 */
function requireEnv(name, hint) {
    const v = process.env[name];
    if (!v) {
        console.error(`\n[env] 環境変数 ${name} が設定されていません。`);
        if (hint) console.error(`[env] ${hint}`);
        console.error("[env] どの環境に対して実行するのかを明示してください。\n");
        process.exit(1);
    }
    return v;
}

module.exports = { requireEnv };
