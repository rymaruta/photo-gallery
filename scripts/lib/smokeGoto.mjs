/**
 * **前の頁の移動が終わってから次の頁へ行く**（`scripts/e2e-smoke.mjs` の `page.goto` の代わり）。
 *
 * 2026-10-31 の Deploy Site（run 41151967127 の 1回目）が WebKit で落ちた:
 *
 *     [webkit][5d] 索引ページ … page.goto("/")（waitUntil: domcontentloaded）→ 確かめて
 *     [webkit][5b] 撮影スポット詳細 … page.goto("/location/…")
 *       → Navigation to "/location/…" is interrupted by another navigation to "/"
 *
 * スモークの `goto` は `domcontentloaded` で返すので、**前の頁の読み込み（`load` まで）が
 * まだ続いている**ことがある。WebKit はその残りを「進行中の移動」として持ち、次の `goto` と
 * ぶつかったとき後から来た方を「割り込まれた」と言う（Chromium は前の残りを黙って捨てる）。
 * 頁が自分で読み直す場合（`AssetRecovery`・`layout.tsx` の字の読み直し）も同じ形になる。
 *
 * だから秒数で待たず、**順番で**そろえる:
 *   1. 今の頁の `load` を待つ（前の `goto` の残り・頁自身の読み直しが決着する）
 *   2. それから目当ての頁へ行く
 *   3. それでも頁が自分で起こした移動に割り込まれたら、**その移動の `load` を待ってから一度だけ**行き直す
 *      （2回目も割り込まれるなら、頁が読み直しを繰り返している＝本物の不具合なのでそのまま落とす）
 *
 * `page` は Playwright の Page（`waitForLoadState` と `goto` だけ使う）。試験は `smokeGoto.test.ts`
 */
export const INTERRUPTED = /interrupted by another navigation/i;

export async function gotoSettled(page, url, options = { waitUntil: "domcontentloaded" }) {
    await settle(page);
    try {
        return await page.goto(url, options);
    } catch (e) {
        if (!INTERRUPTED.test(String(e?.message ?? e))) throw e;
        await settle(page);
        return await page.goto(url, options);
    }
}

/** 今の頁の読み込みの決着を待つ。about:blank や閉じかけの頁で投げても先へ進む（次の goto が本当の失敗を言う） */
async function settle(page) {
    await page.waitForLoadState("load").catch(() => {});
}
