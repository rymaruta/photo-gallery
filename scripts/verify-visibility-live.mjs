#!/usr/bin/env node
/**
 * **本番の API に実際に聞いて、公開範囲が守られているかを確かめる。**
 *
 * この確認だけは、手元の環境からは**できない**——開発環境は
 * `journey-photo.com` にも API Gateway にも出られない（実測で遮断）。
 * だから「確かめていない」と書き続けるのではなく、**owner が1コマンドで
 * 確かめられる形**にして置く。
 *
 *     PHOTO_ID=<絞った写真のid> node scripts/verify-visibility-live.mjs
 *
 * `PHOTO_ID` は「フォロワーのみ」か「親しい友達」に設定した写真の id。
 * 管理画面か DynamoDB のコンソールで1つ拾ってくる。
 *
 * **認証情報は要らない。** この確認の趣旨が「**未認証で読めないこと**」
 * なので、鍵を渡してしまうと確かめたいものが確かめられない。
 *
 * 落ちたら、その写真は**誰にでも読める**。
 */

const API = process.env.USER_API
    ?? "https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com";
const PUBLIC_API = process.env.PUBLIC_API
    ?? "https://ionr4ik01e.execute-api.ap-northeast-1.amazonaws.com";

/**
 * 応答を判定する。**ここに通信を入れない**——入れると手元で試せない
 * （この環境は本番へ出られないので、判定そのものが一度も走らないまま
 * 「用意した」と言うことになる）。
 *
 * @param {{ status: number, body: string }} one  個別取得の応答
 * @param {{ status: number, body: string }} list 一覧の応答
 * @param {string} photoId
 */
export function evaluate(one, list, photoId) {
    const problems = [];

    // **404 であること。** 403 だと「在るが見せない」＝存在が漏れる
    if (one.status !== 404) {
        problems.push(`個別取得が ${one.status}（404 のはず）`);
    }
    // 念のため中身も見る。200 以外でも本文に混ざっていないこと
    if (one.body.includes(photoId) && one.status === 200) {
        problems.push("個別取得の本文に、その写真が入っている");
    }
    if (list.status !== 200) {
        problems.push(`一覧が ${list.status}（200 のはず）`);
    } else {
        let items;
        try {
            items = JSON.parse(list.body);
        } catch {
            problems.push("一覧の本文が JSON として読めない");
            return problems;
        }
        if (!Array.isArray(items)) {
            problems.push("一覧が配列ではない");
            return problems;
        }
        if (items.some((p) => p && p.id === photoId)) {
            problems.push("一覧に、絞ったはずの写真が混ざっている");
        }
        // **他人の絞った写真が1枚でも混ざっていないか**（id を知らなくても分かる）
        const restricted = items.filter((p) => p && p.audience);
        if (restricted.length > 0) {
            problems.push(`一覧に audience 付きが ${restricted.length} 枚混ざっている`);
        }
    }
    return problems;
}

async function get(url) {
    const res = await fetch(url, { redirect: "manual" });
    return { status: res.status, body: await res.text() };
}

async function main() {
    const photoId = process.env.PHOTO_ID;
    if (!photoId) {
        console.error("PHOTO_ID が要ります（「フォロワーのみ」等に設定した写真の id）");
        console.error("  例: PHOTO_ID=abc123 node scripts/verify-visibility-live.mjs");
        process.exit(2);
    }
    console.log(`本番に聞きます（未認証）: ${photoId}`);
    const [one, list] = await Promise.all([
        get(`${PUBLIC_API}/photos/${encodeURIComponent(photoId)}`),
        get(`${PUBLIC_API}/photos`),
    ]);
    console.log(`  個別取得: ${one.status}`);
    console.log(`  一覧    : ${list.status}`);

    const problems = evaluate(one, list, photoId);
    if (problems.length === 0) {
        console.log("\n✅ 未認証では読めません（個別取得 404・一覧に混ざらない）");
        console.log(`   ※ ${API} の /feed/restricted は認証が要るので、ここでは試していません`);
        return;
    }
    console.error("\n🔴 公開範囲が守られていません:");
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
}

// 直に実行されたときだけ走る（テストからは `evaluate` だけを読む）
if (process.argv[1] && process.argv[1].endsWith("verify-visibility-live.mjs")) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
