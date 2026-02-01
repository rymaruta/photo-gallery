#!/usr/bin/env node
/**
 * 開発環境のSecrets ManagerにCOGNITO_USER_POOL_IDを追加するスクリプト
 * 既存の設定を保持しつつ、COGNITO_USER_POOL_IDを追加します
 */

const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretName = 'dev-journey-photo-upload';
const cognitoUserPoolId = 'ap-northeast-1_42eTJcBK7';

async function fixSecrets() {
  try {
    const client = new SecretsManagerClient({ 
      region: process.env.AWS_REGION || 'ap-northeast-1' 
    });
    
    console.log(`🔍 開発用Secrets Managerを確認中: ${secretName}\n`);
    
    // 現在のシークレットを取得
    const getCommand = new GetSecretValueCommand({ SecretId: secretName });
    const getResponse = await client.send(getCommand);
    
    if (!getResponse.SecretString) {
      console.error(`❌ エラー: Secrets Manager のシークレット "${secretName}" が見つかりません`);
      process.exit(1);
    }
    
    const currentSecret = JSON.parse(getResponse.SecretString);
    
    console.log('📋 現在のSecrets Managerの内容:');
    console.log(JSON.stringify(currentSecret, null, 2));
    console.log('');
    
    // COGNITO_USER_POOL_IDが既に設定されているか確認
    if (currentSecret.COGNITO_USER_POOL_ID) {
      if (currentSecret.COGNITO_USER_POOL_ID === cognitoUserPoolId) {
        console.log(`✅ COGNITO_USER_POOL_ID は既に正しく設定されています: ${cognitoUserPoolId}`);
        return;
      } else {
        console.warn(`⚠️  COGNITO_USER_POOL_ID が設定されていますが、値が異なります:`);
        console.warn(`  現在: ${currentSecret.COGNITO_USER_POOL_ID}`);
        console.warn(`  期待: ${cognitoUserPoolId}`);
        console.log('');
      }
    }
    
    // COGNITO_USER_POOL_IDを追加（既存の設定を保持）
    const updatedSecret = {
      ...currentSecret,
      COGNITO_USER_POOL_ID: cognitoUserPoolId,
    };
    
    console.log('📝 更新後のSecrets Managerの内容:');
    console.log(JSON.stringify(updatedSecret, null, 2));
    console.log('');
    
    // シークレットを更新
    const putCommand = new PutSecretValueCommand({
      SecretId: secretName,
      SecretString: JSON.stringify(updatedSecret, null, 2),
    });
    
    await client.send(putCommand);
    
    console.log(`✅ Secrets Manager を更新しました: ${secretName}`);
    console.log(`   COGNITO_USER_POOL_ID: ${cognitoUserPoolId}`);
    console.log('');
    console.log('🎉 これでアップロード機能が動作するはずです！');
    console.log('   アップロードページを再読み込みして試してください。');
    
  } catch (error) {
    console.error(`❌ エラー: Secrets Managerの更新に失敗しました: ${error.message}`);
    console.error('');
    console.error('確認事項:');
    console.error(`  1. Secrets Manager に "${secretName}" という名前のシークレットが存在するか`);
    console.error('  2. AWS の認証情報（~/.aws/credentials など）が正しく設定されているか');
    console.error('  3. IAM 権限で Secrets Manager への読み取り・書き込み権限があるか');
    process.exit(1);
  }
}

fixSecrets();
