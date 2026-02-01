#!/usr/bin/env node
/**
 * 開発環境のLambda関数の設定を確認するスクリプト
 */

const { LambdaClient, GetFunctionConfigurationCommand } = require('@aws-sdk/client-lambda');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const functionName = 'photo-gallery-api-dev-api';
const secretName = 'dev-journey-photo-upload';
const expectedSecretName = 'dev-journey-photo-upload';
const expectedCognitoUserPoolId = 'ap-northeast-1_42eTJcBK7';

async function checkLambda() {
  try {
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    const lambdaClient = new LambdaClient({ region });
    const secretsClient = new SecretsManagerClient({ region });
    
    console.log('🔍 開発環境のLambda関数を確認中...\n');
    console.log(`Function Name: ${functionName}`);
    console.log(`Region: ${region}\n`);
    
    // Lambda関数の設定を取得
    try {
      const getConfigCommand = new GetFunctionConfigurationCommand({
        FunctionName: functionName,
      });
      const lambdaConfig = await lambdaClient.send(getConfigCommand);
      
      console.log('✅ Lambda関数が見つかりました\n');
      console.log('📋 Lambda関数の設定:');
      console.log(`  Function Name: ${lambdaConfig.FunctionName}`);
      console.log(`  Runtime: ${lambdaConfig.Runtime}`);
      console.log(`  Last Modified: ${lambdaConfig.LastModified}`);
      console.log(`  State: ${lambdaConfig.State}`);
      console.log(`  StateReason: ${lambdaConfig.StateReason || '(なし)'}`);
      console.log('');
      
      // 環境変数を確認
      console.log('📋 環境変数:');
      if (lambdaConfig.Environment && lambdaConfig.Environment.Variables) {
        const envVars = lambdaConfig.Environment.Variables;
        const awsSecretName = envVars.AWS_SECRET_NAME;
        
        console.log(`  AWS_SECRET_NAME: ${awsSecretName || '❌ 未設定'}`);
        
        if (awsSecretName !== expectedSecretName) {
          console.warn('');
          console.warn(`⚠️  警告: AWS_SECRET_NAME が期待値と異なります`);
          console.warn(`  現在: ${awsSecretName}`);
          console.warn(`  期待: ${expectedSecretName}`);
          console.warn('');
          console.warn('修正方法:');
          console.warn('  npm run api:deploy:dev');
        } else {
          console.log('  ✅ AWS_SECRET_NAME が正しく設定されています');
        }
      } else {
        console.warn('  ⚠️  環境変数が設定されていません');
      }
      
      console.log('');
      
      // IAMロールを確認
      if (lambdaConfig.Role) {
        const roleName = lambdaConfig.Role.split('/').pop();
        console.log(`📋 IAMロール: ${roleName}`);
        console.log(`  ARN: ${lambdaConfig.Role}`);
        console.log('  (詳細な権限は AWS コンソールで確認してください)');
        console.log('');
      }
      
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        console.error(`❌ エラー: Lambda関数 "${functionName}" が見つかりません`);
        console.error('');
        console.error('解決方法:');
        console.error('  npm run api:deploy:dev');
        process.exit(1);
      } else {
        throw error;
      }
    }
    
    // Secrets Managerの設定を確認
    console.log('🔍 Secrets Managerの設定を確認中...\n');
    try {
      const getSecretCommand = new GetSecretValueCommand({ SecretId: secretName });
      const secretResponse = await secretsClient.send(getSecretCommand);
      
      if (!secretResponse.SecretString) {
        console.error(`❌ エラー: Secrets Manager のシークレット "${secretName}" が見つかりません`);
        process.exit(1);
      }
      
      const secret = JSON.parse(secretResponse.SecretString);
      
      console.log('✅ Secrets Managerの設定を確認しました\n');
      console.log('📋 Secrets Managerの内容:');
      console.log(`  COGNITO_USER_POOL_ID: ${secret.COGNITO_USER_POOL_ID || '❌ 未設定'}`);
      console.log(`  AWS_REGION: ${secret.AWS_REGION || '❌ 未設定'}`);
      console.log(`  AWS_S3_BUCKET_NAME: ${secret.AWS_S3_BUCKET_NAME || '❌ 未設定'}`);
      console.log(`  AWS_S3_SITE_BUCKET_NAME: ${secret.AWS_S3_SITE_BUCKET_NAME || '❌ 未設定'}`);
      console.log('');
      
      if (!secret.COGNITO_USER_POOL_ID) {
        console.error('❌ エラー: COGNITO_USER_POOL_ID が設定されていません');
        console.error('');
        console.error('解決方法:');
        console.error('  npm run fix:dev-secrets');
        process.exit(1);
      }
      
      if (secret.COGNITO_USER_POOL_ID !== expectedCognitoUserPoolId) {
        console.warn('⚠️  警告: COGNITO_USER_POOL_ID が期待値と異なります');
        console.warn(`  現在: ${secret.COGNITO_USER_POOL_ID}`);
        console.warn(`  期待: ${expectedCognitoUserPoolId}`);
        console.warn('');
        console.warn('解決方法:');
        console.warn('  npm run fix:dev-secrets');
      } else {
        console.log('✅ COGNITO_USER_POOL_ID が正しく設定されています');
      }
      
    } catch (error) {
      console.error(`❌ エラー: Secrets Managerからシークレットを取得できませんでした: ${error.message}`);
      console.error('');
      console.error('確認事項:');
      console.error(`  1. Secrets Manager に "${secretName}" という名前のシークレットが存在するか`);
      console.error('  2. AWS の認証情報が正しく設定されているか');
      console.error('  3. IAM 権限で Secrets Manager への読み取り権限があるか');
      process.exit(1);
    }
    
    console.log('');
    console.log('🎉 すべての設定が正しく見えます！');
    console.log('');
    console.log('次のステップ:');
    console.log('  1. ブラウザでログインしているか確認');
    console.log('  2. adminグループに属しているか確認');
    console.log('  3. アップロードを試行してエラーメッセージを確認');
    console.log('  4. Lambda側のログを確認:');
    console.log('     # Windows環境（Git Bash）の場合:');
    console.log('     MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow');
    console.log('     # Windows環境（PowerShell）の場合:');
    console.log('     aws logs tail \'/aws/lambda/photo-gallery-api-dev-api\' --follow');
    console.log('     # Linux/Mac環境の場合:');
    console.log('     aws logs tail /aws/lambda/photo-gallery-api-dev-api --follow');
    
  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

checkLambda();
