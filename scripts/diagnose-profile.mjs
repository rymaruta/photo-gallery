// 一時診断: 本番のマイページ（プロフィール）を WebKit / Chromium で実際に開き、
// 実データ時の pageerror / console / 水和有無 / メニュー開閉を採取する。
// iOS Safari でのみ全無反応になる不具合の再現用。原因特定後に削除する。

import { chromium, webkit } from "playwright-core";

const URL = process.env.DIAG_URL || "https://journey-photo.com/users/67d49a68-80f1-7083-b0e0-c767886ef868";
const ENGINES = (process.env.DIAG_ENGINES || "webkit,chromium").split(",").map((s) => s.trim()).filter(Boolean);
const TYPES = { chromium, webkit };

for (const eng of ENGINES) {
    const type = TYPES[eng];
    if (!type) { console.log(`(skip ${eng})`); continue; }
    console.log(`\n===== ${eng} : ${URL} =====`);
    const browser = await type.launch({ args: eng === "chromium" ? ["--no-sandbox"] : [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errs = [];
    const cons = [];
    page.on("pageerror", (e) => errs.push(String(e.stack || e.message || e)));
    page.on("console", (m) => { const t = m.type(); if (t === "error" || t === "warning") cons.push(`${t}: ${m.text()}`); });

    try {
        await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 40000 });
    } catch (e) {
        console.log("GOTO ERR:", e.message.split("\n")[0]);
    }
    // 実データのフェッチ・水和・（もしあれば）ハングの時間を与える
    await page.waitForTimeout(10000);

    const hydrated = await page.evaluate(() => {
        const b = document.querySelector('[aria-label="Open menu"]');
        return b ? Object.keys(b).some((k) => k.startsWith("__reactProps")) : "no-button";
    }).catch((e) => `eval-failed:${e.message}`);

    let opened = false;
    try {
        await page.tap('[aria-label="Open menu"]', { timeout: 3000 });
        opened = await page.waitForSelector('#site-menu', { timeout: 2500 }).then(() => true).catch(() => false);
    } catch (e) {
        console.log("TAP ERR:", e.message.split("\n")[0]);
    }

    console.log(`HYDRATED: ${hydrated} | MENU_OPENED: ${opened}`);
    console.log(`PAGEERRORS (${errs.length}):`);
    errs.slice(0, 12).forEach((e) => console.log("  - " + e.split("\n").slice(0, 6).join(" | ")));
    console.log(`CONSOLE err/warn (${cons.length}):`);
    cons.slice(0, 25).forEach((c) => console.log("  - " + c.slice(0, 400)));

    await browser.close();
}
console.log("\n[diagnose-profile] done");
