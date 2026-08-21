import "@testing-library/jest-dom";

// バックエンドのモジュールは読み込み時に requireEnv() で必須の環境変数を確認する
// （未設定なら投げる＝本番へフォールバックしない）。テストでも値が要るので入れておく。
//
// 本番の名前はわざと使わない。もし何かの拍子にモックが外れて実際の AWS を
// 叩いてしまっても、存在しないテーブルに当たって失敗するようにしておく。
process.env.PHOTOS_TABLE ??= "test-photo-gallery-photos";
process.env.USERS_TABLE ??= "test-photo-gallery-users";
process.env.UPLOAD_BUCKET ??= "test-journey-photo-upload";
process.env.CLOUDFRONT_URL ??= "https://test.example.invalid";

// AWS の認証情報はテストから消す。
//
// 上と同じ考え方の続き。認証情報が残っていると、モックし忘れた
// 署名生成（getSignedUrl）が**手元でだけ成功する**。実際それで
// api-user の presign のテストが手元だけ通り、CI で
// CredentialsProviderError になって本番デプロイを止めた（386eeef）。
// 消しておけば、モックの外れたテストはどこでも同じ理由で落ちる。
for (const k of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
]) {
    delete process.env[k];
}
// 署名処理はリージョンが無いと別の理由で落ちるので、これだけは残す
// （リージョンは秘密ではない）。
process.env.AWS_REGION ??= "ap-northeast-1";
