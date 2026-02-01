#!/usr/bin/env node
/**
 * 認証状態を確認するスクリプト（ブラウザのコンソールで実行）
 * このスクリプトはブラウザのコンソールで実行してください
 */

// ブラウザのコンソールで実行するためのコード
const checkAuthStatus = () => {
  console.log('🔍 認証状態を確認中...\n');
  
  // Cognitoのセッション情報を確認
  const cognitoKeys = Object.keys(localStorage).filter(key => 
    key.includes('CognitoIdentityServiceProvider')
  );
  
  if (cognitoKeys.length === 0) {
    console.log('❌ Cognitoのセッション情報が見つかりません');
    console.log('   → /login ページでログインしてください\n');
    return;
  }
  
  console.log('📋 Cognitoのセッション情報:');
  cognitoKeys.forEach(key => {
    const value = localStorage.getItem(key);
    console.log(`  ${key}: ${value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : '(空)'}`);
  });
  
  // LastAuthUserを確認
  const clientId = '4vavr6g8rg6e682ivc58ad0892'; // 開発環境のClient ID
  const lastAuthUser = localStorage.getItem(`CognitoIdentityServiceProvider.${clientId}.LastAuthUser`);
  
  if (lastAuthUser) {
    console.log(`\n✅ ログインユーザー: ${lastAuthUser}`);
    
    // IDトークンを確認
    const idTokenKey = `CognitoIdentityServiceProvider.${clientId}.${lastAuthUser}.idToken`;
    const idToken = localStorage.getItem(idTokenKey);
    
    if (idToken) {
      try {
        // JWTトークンをデコード（ペイロード部分のみ）
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        console.log('\n📋 IDトークンのペイロード:');
        console.log(`  Username: ${payload['cognito:username'] || payload.sub}`);
        console.log(`  Groups: ${payload['cognito:groups'] ? payload['cognito:groups'].join(', ') : '(なし)'}`);
        console.log(`  Admin: ${payload['cognito:groups']?.includes('admin') ? '✅ Yes' : '❌ No'}`);
        
        if (!payload['cognito:groups']?.includes('admin')) {
          console.log('\n⚠️  警告: このユーザーはadminグループに属していません');
          console.log('   → AWS Cognitoコンソールでユーザーをadminグループに追加してください');
        }
      } catch (_e) {
        console.log('  (トークンのデコードに失敗しました)');
      }
    } else {
      console.log('\n❌ IDトークンが見つかりません');
    }
  } else {
    console.log('\n❌ ログインユーザー情報が見つかりません');
    console.log('   → /login ページでログインしてください');
  }
  
  // 環境変数を確認（開発環境のみ）
  console.log('\n📋 環境変数:');
  console.log(`  NEXT_PUBLIC_API_BASE_URL: ${process.env.NEXT_PUBLIC_API_BASE_URL || '(未設定)'}`);
  console.log(`  NEXT_PUBLIC_COGNITO_USER_POOL_ID: ${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '(未設定)'}`);
  console.log(`  NEXT_PUBLIC_USE_LOCAL_API: ${process.env.NEXT_PUBLIC_USE_LOCAL_API || '(未設定)'}`);
};

// ブラウザのコンソールで実行するためのコードを出力
console.log(`
========================================
認証状態確認スクリプト
========================================

ブラウザのコンソール（F12 → Console）で以下のコードを実行してください：

${checkAuthStatus.toString()}

checkAuthStatus();

または、以下のコードを直接コピー＆ペーストしてください：

${checkAuthStatus.toString().replace('const checkAuthStatus = ', '')}

checkAuthStatus();
`);
