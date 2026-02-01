/**
 * 開発用 API (API Gateway + Lambda) へ接続できるか試す
 * 使い方: node scripts/test-dev-api.js
 *         API_URL=https://xxx.execute-api.ap-northeast-1.amazonaws.com node scripts/test-dev-api.js
 */
const API_URL =
  process.env.API_URL ||
  "https://vr9sellzx4.execute-api.ap-northeast-1.amazonaws.com";

async function test(name, fn) {
  try {
    const res = await fn();
    console.log(`  ✅ ${name}: HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`\n開発用 API 接続テスト: ${API_URL}\n`);

  let ok = 0;
  ok += (await test("GET /photos", () => fetch(`${API_URL}/photos`))) ? 1 : 0;

  const allOk = ok === 1;
  console.log(allOk ? "\n✅ 開発用 API に接続できました\n" : "\n❌ 接続に失敗しました\n");
  process.exit(allOk ? 0 : 1);
}

main();
