#!/usr/bin/env node
/**
 * Serverless Framework用のデプロイバケットを作成するスクリプト
 */

const { S3Client, CreateBucketCommand, PutBucketVersioningCommand } = require('@aws-sdk/client-s3');

const stage = process.argv[2] || 'dev';
const region = process.env.AWS_REGION || 'ap-northeast-1';

// Account IDを取得する必要があるため、STSを使用
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

async function createDeploymentBucket() {
  try {
    const stsClient = new STSClient({ region });
    const identityResponse = await stsClient.send(new GetCallerIdentityCommand({}));
    const accountId = identityResponse.Account;
    
    // プロジェクトの命名規則（journey-photo-*）に合わせて統一
    const bucketName = `journey-photo-api-deploy-${stage}-${accountId}`;
    
    console.log(`🔍 デプロイバケットを作成中...\n`);
    console.log(`  Bucket Name: ${bucketName}`);
    console.log(`  Region: ${region}\n`);
    
    const s3Client = new S3Client({ region });
    
    try {
      // バケットを作成
      await s3Client.send(new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration: {
          LocationConstraint: region === 'us-east-1' ? undefined : region,
        },
      }));
      
      console.log(`✅ バケットを作成しました: ${bucketName}\n`);
      
      // バージョニングを有効化（Serverless Frameworkの推奨設定）
      try {
        await s3Client.send(new PutBucketVersioningCommand({
          Bucket: bucketName,
          VersioningConfiguration: {
            Status: 'Enabled',
          },
        }));
        console.log(`✅ バージョニングを有効化しました\n`);
      } catch (versioningError) {
        console.warn(`⚠️  バージョニングの設定に失敗しました（無視して続行）: ${versioningError.message}\n`);
      }
      
      console.log(`🎉 デプロイバケットの準備が完了しました！`);
      if (stage === 'prod') {
        console.log(`   次に、npm run api:deploy:prod を実行してください。\n`);
      } else {
        console.log(`   次に、npm run api:deploy:dev を実行してください。\n`);
      }
      
    } catch (error) {
      if (error.name === 'BucketAlreadyExists' || error.name === 'BucketAlreadyOwnedByYou') {
        console.log(`ℹ️  バケットは既に存在します: ${bucketName}\n`);
        console.log(`   デプロイを続行できます。\n`);
      } else if (error.name === 'BucketAlreadyOwnedByYou') {
        console.log(`ℹ️  バケットは既にあなたが所有しています: ${bucketName}\n`);
        console.log(`   デプロイを続行できます。\n`);
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
    console.error('');
    console.error('確認事項:');
    console.error('  1. AWS の認証情報が正しく設定されているか');
    console.error('  2. IAM 権限で S3 への作成権限があるか');
    console.error('  3. バケット名がグローバルに一意か（既に他のアカウントで使用されている可能性）');
    process.exit(1);
  }
}

createDeploymentBucket();
