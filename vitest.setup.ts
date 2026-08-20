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
