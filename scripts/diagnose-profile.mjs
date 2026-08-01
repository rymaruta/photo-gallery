// 一時診断: 本番の _next/static/chunks/*.js の実ステータス/Content-Type を採取する。
// iOS Safari が「Refused to execute ... not a script MIME type」で拒否 → 水和不全になる
// 原因（S3/CloudFront の Content-Type/503）を特定する。原因特定後に削除する。

import { webkit } from "playwright-core";

const URL = process.env.DIAG_URL || "https://journey-photo.com/users/67d49a68-80f1-7083-b0e0-c767886ef868";

const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();

try { await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 40000 }); } catch (e) { console.log("GOTO ERR:", e.message.split("\n")[0]); }
await page.waitForTimeout(4000);

// ページが参照する _next チャンク URL を収集（script[src] と、事前ロード link）
const urls = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('script[src], link[href]').forEach((el) => {
        const u = el.getAttribute("src") || el.getAttribute("href") || "";
        if (u.includes("/_next/static/")) out.add(u.startsWith("http") ? u : new URL(u, location.href).href);
    });
    return [...out];
});
console.log(`collected ${urls.length} _next asset URLs`);

// それぞれを実 HTTP 取得して status / content-type / nosniff を出す
for (const u of urls.slice(0, 40)) {
    try {
        const res = await ctx.request.get(u, { timeout: 15000 });
        const h = res.headers();
        console.log(`${res.status()} | ct=${h["content-type"] || "-"} | nosniff=${h["x-content-type-options"] || "-"} | ${u.replace("https://journey-photo.com", "")}`);
    } catch (e) {
        console.log(`ERR  | ${u} | ${e.message.split("\n")[0]}`);
    }
}

await browser.close();
console.log("\n[diagnose-profile] done");
