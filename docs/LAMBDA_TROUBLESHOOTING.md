# Lambda側のトラブルシューティング

開発環境のLambda APIで考えられる問題点と確認方法です。

## 🔍 Lambda側で怪しい点

### 1. **Lambda関数が正しくデプロイされているか**

**確認方法:**
```bash
npm run api:info:dev
```

**確認ポイント:**
- Lambda関数が存在するか
- API Gatewayのエンドポイントが正しいか
- 環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload` に設定されているか

### 2. **環境変数 `AWS_SECRET_NAME` が正しく設定されているか**

Lambda関数の環境変数で `AWS_SECRET_NAME=dev-journey-photo-upload` が設定されている必要があります。

**確認方法:**
```bash
npm run api:info:dev
# または
aws lambda get-function-configuration --function-name photo-gallery-api-dev-api
```

### 3. **Secrets Managerへのアクセス権限があるか**

Lambda関数のIAMロールに、`dev-journey-photo-upload` への読み取り権限が必要です。

**確認方法:**
```bash
# Lambda関数のIAMロールを確認
aws lambda get-function-configuration --function-name photo-gallery-api-dev-api --query Role

# IAMロールのポリシーを確認
aws iam list-attached-role-policies --role-name <ロール名>
```

**期待される権限:**
```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:ap-northeast-1:*:secret:dev-journey-photo-upload*"
}
```

### 4. **Secrets Managerから `COGNITO_USER_POOL_ID` が取得できているか**

Lambda関数がSecrets Managerから正しく設定を取得できているか確認します。

**確認方法:**
Lambda側のログを確認：
```bash
# Windows環境（Git Bash）の場合
aws logs tail "/aws/lambda/photo-gallery-api-dev-api" --follow

# Linux/Mac環境の場合
aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow
```

**確認ポイント:**
- `COGNITO_USER_POOL_ID not found in Secrets Manager` というエラーが出ていないか
- `Config loaded from Secrets Manager` というログが出ているか

### 5. **JWTトークンの検証が正しく動作しているか**

**確認方法:**
Lambda側のログで以下を確認：
- `JWT token verified` というログが出ているか
- `JWT token verification failed` というエラーが出ていないか

**考えられる原因:**
- Cognito User Pool IDが間違っている
- JWTトークンのissuerが一致していない
- トークンの有効期限が切れている

### 6. **adminグループのチェックが正しく動作しているか**

**確認方法:**
Lambda側のログで以下を確認：
- `User is not in admin group` という警告が出ていないか
- `groups` に `admin` が含まれているか

### 7. **Lambda関数が最新のコードでデプロイされているか**

**確認方法:**
```bash
# Lambda関数を再デプロイ
npm run api:deploy:dev
```

## 🛠️ 診断手順

### ステップ1: Lambda関数の情報を確認

```bash
npm run api:info:dev
```

**確認ポイント:**
- エンドポイントURLが `.env.local` の `NEXT_PUBLIC_API_BASE_URL` と一致しているか
- 環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload` になっているか

### ステップ2: Lambda側のログを確認

**Windows環境（Git Bash）の場合:**
```bash
# 方法1: MSYS_NO_PATHCONV環境変数を設定
MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow

# 方法2: PowerShellを使用（推奨）
# PowerShellで実行:
aws logs tail '/aws/lambda/photo-gallery-api-dev-api' --follow
```

**Linux/Mac環境の場合:**
```bash
aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow
```

**注意:** Git Bashでは `/aws/lambda/...` が `C:/Program Files/Git/aws/lambda/...` として解釈されるため、`MSYS_NO_PATHCONV=1` を設定するか、PowerShellを使用してください。

アップロードを試行して、以下のログを確認：
- `Request received` - リクエストが到達しているか
- `Config loaded from Secrets Manager` - Secrets Managerから設定を取得できているか
- `COGNITO_USER_POOL_ID not found` - COGNITO_USER_POOL_IDが見つからないエラー
- `JWT token verified` - JWTトークンの検証が成功しているか
- `JWT token verification failed` - JWTトークンの検証が失敗しているか
- `User is not in admin group` - adminグループに属していないエラー

### ステップ3: Lambda関数を再デプロイ（必要に応じて）

```bash
npm run api:deploy:dev
```

## ❌ よくある問題と解決方法

### 問題1: `COGNITO_USER_POOL_ID not found in Secrets Manager`

**原因:**
- Secrets Managerに `COGNITO_USER_POOL_ID` が設定されていない
- Lambda関数の環境変数 `AWS_SECRET_NAME` が間違っている

**解決方法:**
```bash
# Secrets Managerを確認
npm run check:dev-secrets

# 設定されていない場合は修正
npm run fix:dev-secrets
```

### 問題2: `JWT token verification failed`

**原因:**
- Cognito User Pool IDが間違っている
- JWTトークンのissuerが一致していない
- トークンの有効期限が切れている

**解決方法:**
1. Secrets Managerの `COGNITO_USER_POOL_ID` が `.env.local` と一致しているか確認
2. ブラウザで再ログインしてトークンを更新

### 問題3: `User is not in admin group`

**原因:**
- ログインユーザーがadminグループに属していない

**解決方法:**
1. AWS Cognitoコンソールでユーザーを確認
2. ユーザーを `admin` グループに追加
3. ログアウトして再ログイン

### 問題4: Lambda関数が最新のコードでデプロイされていない

**原因:**
- コードを変更したが、Lambda関数を再デプロイしていない

**解決方法:**
```bash
npm run api:deploy:dev
```

## 🔧 確認チェックリスト

- [ ] Lambda関数が存在する（`npm run api:info:dev` で確認）
- [ ] 環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload` に設定されている
- [ ] IAMロールにSecrets Managerへの読み取り権限がある
- [ ] Secrets Manager (`dev-journey-photo-upload`) に `COGNITO_USER_POOL_ID` が設定されている
- [ ] Lambda側のログでエラーが出ていない
- [ ] Lambda関数が最新のコードでデプロイされている

## 関連ドキュメント

- [環境構成の整理](ENVIRONMENT_CONFIG.md)
- [トラブルシューティング](TROUBLESHOOTING.md)（アップロード・Lambda 統合）
- [API ドキュメント](API.md)（API Gateway + Lambda のデプロイ含む）
