#!/usr/bin/env node
/**
 * 開発環境のSecrets Manager設定を確認するスクリプト
 * Lambda APIが正しく動作するために必要な設定を確認します
 */

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretName = 'dev-journey-photo-upload';
const expectedCognitoUserPoolId = 'ap-northeast-1_42eTJcBK7';

async function checkSecrets() {
  try {
    const client = new SecretsManagerClient({ 
      region: process.env.AWS_REGION || 'ap-northeast-1' 
    });
    
    console.log(`🔍 開発用Secrets Managerを確認中: ${secretName}\n`);
    
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    
    if (!response.SecretString) {
      console.error(`❌ エラー: Secrets Manager のシークレット "${secretName}" が見つかりません`);
      process.exit(1);
    }
    
    const secret = JSON.parse(response.SecretString);
    
    console.log('📋 Secrets Managerの内容:');
    console.log(JSON.stringify(secret, null, 2));
    console.log('');
    
    // COGNITO_USER_POOL_IDの確認
    if (!secret.COGNITO_USER_POOL_ID || secret.COGNITO_USER_POOL_ID.trim() === '') {
      console.error(`❌ エラー: Secrets Manager のシークレット "${secretName}" に COGNITO_USER_POOL_ID が含まれていません`);
      console.error('');
      console.error('修正方法:');
      console.error(`  aws secretsmanager put-secret-value --secret-id ${secretName} --secret-string '{"COGNITO_USER_POOL_ID":"${expectedCognitoUserPoolId}",...}'`);
      process.exit(1);
    }
    
    console.log(`✅ COGNITO_USER_POOL_ID が見つかりました: ${secret.COGNITO_USER_POOL_ID}`);
    
    // .env.localの値と一致しているか確認
    if (secret.COGNITO_USER_POOL_ID !== expectedCognitoUserPoolId) {
      console.warn('');
      console.warn('⚠️  警告: Secrets ManagerのCOGNITO_USER_POOL_IDが.env.localの値と一致していません');
      console.warn(`  Secrets Manager: ${secret.COGNITO_USER_POOL_ID}`);
      console.warn(`  .env.local:      ${expectedCognitoUserPoolId}`);
      console.warn('');
      console.warn('修正方法:');
      console.warn(`  aws secretsmanager put-secret-value --secret-id ${secretName} --secret-string '{"COGNITO_USER_POOL_ID":"${expectedCognitoUserPoolId}",...}'`);
    } else {
      console.log('✅ .env.localの値と一致しています');
    }
    
    console.log('');
    console.log('📝 その他の必要な設定:');
    console.log(`  - AWS_S3_BUCKET_NAME: ${secret.AWS_S3_BUCKET_NAME || '❌ 未設定'}`);
    console.log(`  - AWS_S3_SITE_BUCKET_NAME: ${secret.AWS_S3_SITE_BUCKET_NAME || '❌ 未設定'}`);
    console.log(`  - AWS_REGION: ${secret.AWS_REGION || '❌ 未設定'}`);
    console.log(`  - CLOUDFRONT_URL: ${secret.CLOUDFRONT_URL || '❌ 未設定（オプション）'}`);
    
  } catch (error) {
    console.error(`❌ エラー: Secrets Managerからシークレットを取得できませんでした: ${error.message}`);
    console.error('');
    console.error('確認事項:');
    console.error(`  1. Secrets Manager に "${secretName}" という名前のシークレットが存在するか`);
    console.error('  2. AWS の認証情報（~/.aws/credentials など）が正しく設定されているか');
    console.error('  3. IAM 権限で Secrets Manager への読み取り権限があるか');
    process.exit(1);
  }
}

checkSecrets();
