/**
 * 必須の環境変数を読む。未設定なら投げる。
 *
 * 以前は `process.env.X ?? "prod-..."` と本番値をフォールバックにしていた。
 * これだと環境変数を入れ忘れたステージングの Lambda が、エラーも出さずに
 * 本番のテーブルへ読み書きしてしまう。設定ミスは「本番を向く」ではなく
 * 「動かない」に倒す。
 *
 * モジュール読み込み時に評価されるので、間違った設定でデプロイすると
 * 最初の呼び出しで初期化に失敗し、CloudWatch に理由が残る。
 */
export function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
        throw new Error(
            `環境変数 ${name} が設定されていません。` +
            "デプロイ時のパラメータ（serverless.yml の param）を確認してください。",
        );
    }
    return v;
}
