# トラブルシューティング（アップロード・Lambda）

開発環境でアップロードがエラーになる場合、および Lambda API で考えられる問題の診断と解決方法です。

---

## 📋 目次

1. [アップロードエラー](#アップロードエラー)
2. [Lambda 側の確認](#lambda-側の確認)
3. [よくあるエラーと解決方法](#よくあるエラーと解決方法)
4. [確認チェックリスト](#確認チェックリスト)
5. [参照](#参照)

---

## アップロードエラー

### 診断手順

**ステップ1: Secrets Manager の設定を確認**

```bash
npm run check:dev-secrets
```

- `dev-journey-photo-upload` に `COGNITO_USER_POOL_ID` が設定されているか
- `.env.local` の `NEXT_PUBLIC_COGNITO_USER_POOL_ID` と一致しているか

**ステップ2: ログイン状態の確認**

1. `/login` で開発用 Cognito User Pool にログイン
2. **admin グループに属しているユーザー**でログインしているか確認
3. ログイン後、アップロードページ (`/upload`) を再読み込み

**ステップ3: Lambda 側のログを確認**

```bash
# Windows（Git Bash）: MSYS_NO_PATHCONV=1 を付けるか、PowerShell で実行
aws logs tail '/aws/lambda/photo-gallery-api-dev-api' --follow
```

アップロードを試行して、エラーログを確認する。

---

## Lambda 側の確認

### 確認ポイント

1. **Lambda 関数がデプロイされているか**  
   `npm run api:info:dev` でエンドポイントと環境変数を確認。

2. **環境変数 `AWS_SECRET_NAME`**  
   Lambda の環境変数で `AWS_SECRET_NAME=dev-journey-photo-upload` になっているか。

3. **Secrets Manager への権限**  
   Lambda の IAM ロールに `dev-journey-photo-upload` の `secretsmanager:GetSecretValue` があるか。

4. **Secrets Manager に `COGNITO_USER_POOL_ID` があるか**  
   Lambda ログで `COGNITO_USER_POOL_ID not found` が出ていないか。`Config loaded from Secrets Manager` が出ているか。

5. **JWT 検証・admin グループ**  
   ログで `JWT token verified`、`User is not in admin group` の有無を確認。

6. **再デプロイ**  
   コード変更後は `npm run api:deploy:dev` で再デプロイ。

### Lambda 側の診断手順（詳細）

**ステップ1: Lambda 関数の情報を確認**

```bash
npm run api:info:dev
```

- エンドポイント URL が `.env.local` の `NEXT_PUBLIC_API_BASE_URL` と一致しているか
- 環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload` になっているか

**ステップ2: Lambda のログを確認**

- **Windows（Git Bash）**: `/aws/lambda/...` がパスとして解釈されるため、`MSYS_NO_PATHCONV=1` を付けるか **PowerShell** で実行する。
  ```bash
  # PowerShell で実行（推奨）
  aws logs tail '/aws/lambda/photo-gallery-api-dev-api' --follow
  ```
- **Linux/Mac**:
  ```bash
  aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow
  ```

確認するログ: `Request received` / `Config loaded from Secrets Manager` / `COGNITO_USER_POOL_ID not found` / `JWT token verified` / `JWT token verification failed` / `User is not in admin group`

**ステップ3: 再デプロイ（必要に応じて）**

```bash
npm run api:deploy:dev
```

---

## よくあるエラーと解決方法

| エラー・症状 | 原因 | 解決方法 |
|--------------|------|----------|
| **認証が必要です** | 未ログイン or JWT が取れていない | `/login` でログイン。localStorage の Cognito セッションを確認。 |
| **認証に失敗しました（401）** | Secrets Manager の `COGNITO_USER_POOL_ID` が .env.local と不一致 | `npm run check:dev-secrets`。不一致なら `npm run fix:dev-secrets` または Secrets Manager を手動更新。 |
| **管理者権限が必要です（403）** | ログインユーザーが admin グループにない | Cognito でユーザーを `admin` グループに追加。ログアウトして再ログイン。 |
| **COGNITO_USER_POOL_ID not found** | Secrets Manager にキーがない or `AWS_SECRET_NAME` が違う | `npm run fix:dev-secrets`。Lambda の `AWS_SECRET_NAME` を確認。 |
| **JWT token verification failed** | User Pool ID の不一致 or トークン期限切れ | Secrets Manager と .env.local の一致を確認。ブラウザで再ログイン。 |
| **User is not in admin group** | ユーザーが admin グループに属していない | Cognito で admin グループに追加。再ログイン。 |

### その他の対処

- **Lambda を再デプロイ**: `npm run api:deploy:dev`
- **ブラウザキャッシュ**: Application → Local Storage をクリアし、再読み込み
- **環境変数**: `.env.local` が読み込まれているか確認。`npm run dev` を再起動

---

## 確認チェックリスト

- [ ] `.env.local` の `NEXT_PUBLIC_COGNITO_USER_POOL_ID` が設定されている
- [ ] Secrets Manager（`dev-journey-photo-upload`）に `COGNITO_USER_POOL_ID` が設定されている
- [ ] 上記 2 つが一致している
- [ ] ログインしている
- [ ] ログインユーザーが admin グループに属している
- [ ] Lambda API（`photo-gallery-api-dev-api`）がデプロイされている
- [ ] Lambda の環境変数 `AWS_SECRET_NAME` が `dev-journey-photo-upload`
- [ ] Lambda の IAM ロールに Secrets Manager の読み取り権限がある

---

## 参照

- **[環境設定の整理](./ENVIRONMENT_CONFIG.md)**
- **[セットアップ](./SETUP.md)** — ローカル・認証・アップロードの設定
- **[本番デプロイ](./DEPLOY.md)** — 本番のトラブルシューティング
