#!/usr/bin/env node
/**
 * Lambda デプロイ前の検証スクリプト
 * Secrets Manager に COGNITO_USER_POOL_ID が含まれているか確認
 * 
 * 注意: COGNITO_USER_POOL_ID は環境変数ではなく、Secrets Manager から取得します
 */

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const stage = process.argv[2] || process.env.STAGE || 'dev';
const secretName = `${stage}-journey-photo-upload`;

async function validateSecret() {
  try {
    const client = new SecretsManagerClient({ 
      region: process.env.AWS_REGION || 'ap-northeast-1' 
    });
    
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    
    if (!response.SecretString) {
      console.error(`❌ エラー: Secrets Manager のシークレット "${secretName}" が見つかりません`);
      process.exit(1);
    }
    
    const secret = JSON.parse(response.SecretString);
    
    if (!secret.COGNITO_USER_POOL_ID || secret.COGNITO_USER_POOL_ID.trim() === '') {
      console.error(`❌ エラー: Secrets Manager のシークレット "${secretName}" に COGNITO_USER_POOL_ID が含まれていません`);
      console.error('');
      console.error('Secrets Manager に COGNITO_USER_POOL_ID を追加してください:');
      console.error(`  aws secretsmanager put-secret-value --secret-id ${secretName} --secret-string '{"COGNITO_USER_POOL_ID":"ap-northeast-1_XXXXXXXX",...}'`);
      process.exit(1);
    }
    
    // 形式チェック（ap-northeast-1_XXXXXXXX 形式）
    if (!/^ap-northeast-1_[A-Za-z0-9]+$/.test(secret.COGNITO_USER_POOL_ID)) {
      console.warn('⚠️  警告: COGNITO_USER_POOL_ID の形式が正しくない可能性があります');
      console.warn(`  現在の値: ${secret.COGNITO_USER_POOL_ID}`);
      console.warn('  期待される形式: ap-northeast-1_XXXXXXXX');
    }
    
    console.log(`✅ Secrets Manager のシークレット "${secretName}" に COGNITO_USER_POOL_ID が含まれています (stage: ${stage})`);
    console.log(`   User Pool ID: ${secret.COGNITO_USER_POOL_ID.substring(0, 20)}...`);
  } catch (error) {
    console.error(`❌ エラー: Secrets Manager からシークレットを取得できませんでした: ${error.message}`);
    console.error('');
    console.error('確認事項:');
    console.error(`  1. Secrets Manager に "${secretName}" という名前のシークレットが存在するか`);
    console.error('  2. AWS の認証情報（~/.aws/credentials など）が正しく設定されているか');
    console.error('  3. IAM 権限で Secrets Manager への読み取り権限があるか');
    process.exit(1);
  }
}

validateSecret();
