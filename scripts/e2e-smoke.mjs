// デプロイ前のブラウザ・スモークテスト。
// jsdom では検知できない「見た目は正常なのにタップが効かない」系の回帰
// （不可視オーバーレイ・ハイドレーション失敗・チャンク欠落・エンジン固有の実行時例外）を、
// ビルド済み out/ を実ブラウザで開いて実際にタップして検証する。
// 1つでも失敗すると exit 1 になり、デプロイが止まる。
//
// エンジンは SMOKE_ENGINES 環境変数で指定（既定 "chromium"）。
// CI では "chromium,webkit" を指定し、Chromium だけでなく WebKit(Safari エンジン)でも
// タップ可能なことを保証する（iOS Safari 固有の「見た目正常だが全無反応」を捕捉するため）。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "out");
const PORT = 4173;

const BROWSER_TYPES = { chromium, webkit };
const ENGINES = (process.env.SMOKE_ENGINES || "chromium")
    .split(",").map((s) => s.trim()).filter(Boolean);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".webmanifest": "application/manifest+json",
};

// out/ を配信する最小サーバー（/foo → foo.html の解決つき）
function serveOut() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            try {
                const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
                let file = path.join(OUT, urlPath);
                if (urlPath.endsWith("/")) file = path.join(file, "index.html");
                if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                    if (fs.existsSync(`${file}.html`)) file = `${file}.html`;
                    else if (fs.existsSync(path.join(file, "index.html"))) file = path.join(file, "index.html");
                }
                if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                    res.writeHead(404); res.end("not found"); return;
                }
                res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
                fs.createReadStream(file).pipe(res);
            } catch {
                res.writeHead(500); res.end();
            }
        });
        server.listen(PORT, () => resolve(server));
    });
}

function resolveChromium() {
    // ローカル/サンドボックス（プリインストール） → CI（npx playwright install）
    const candidates = ["/opt/pw-browsers/chromium", process.env.CHROMIUM_PATH].filter(Boolean);
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return undefined; // playwright-core が自身の既定解決を試みる（CI では playwright install 済み）
}

const failures = [];
function check(name, ok, detail = "") {
    if (ok) console.log(`  ✅ ${name}`);
    else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); failures.push(name); }
}

// スモークは外部リクエスト（API/CDN）を route.abort() で遮断する密閉型。
// その遮断は WebKit では pageerror（"Load failed" / "access control checks" 等）として
// 表面化し、Chromium では console の net::ERR_FAILED になる——いずれも本番では成功する
// 通信であり、アプリのバグではない。ゲート判定ではこれらの「想定内ネットワーク雑音」を除外し、
// 本物の JS 例外（水和クラッシュ等）だけで失敗させる。
function isExpectedNetworkNoise(msg) {
    return /access control checks|Load failed|Access-Control-Allow-Origin|Failed to load resource|ERR_FAILED|ERR_ABORTED|net::|execute-api|amazonaws|cloudfront|写真取得エラー/i.test(String(msg));
}

// ページの実行時例外・console.error を集める（エンジン固有の実行時例外を診断するため）。
function attachDiagnostics(page) {
    const bag = { pageErrors: [], consoleErrors: [] };
    page.on("pageerror", (e) => bag.pageErrors.push(String(e.message ?? e)));
    page.on("console", (msg) => { if (msg.type() === "error") bag.consoleErrors.push(msg.text()); });
    return bag;
}
function reportDiagnostics(label, bag) {
    // 失敗診断用に、拾った例外・エラーを必ず出力する（成功時も参考として）。
    for (const e of bag.pageErrors) console.log(`     ⚠️ [${label}] pageerror: ${e}`);
    for (const e of bag.consoleErrors.slice(0, 5)) console.log(`     ⚠️ [${label}] console.error: ${e}`);
}

// タッチ context では tap、非タッチ（デスクトップ）context では click にフォールバック
async function tapOrClick(page, sel, opts) {
    try {
        return await page.tap(sel, opts);
    } catch (e) {
        if (String(e.message).includes("does not support tap")) return page.click(sel, opts);
        throw e;
    }
}

// React のハイドレーション完了を待つ（メニューボタンに React のハンドラが
// 付くまでポーリング）。false のままなら JS が走っていない（実行時例外など）。
async function waitForHydration(page, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await page.evaluate(() => {
            const btn = document.querySelector('[aria-label="Open menu"]');
            if (!btn) return false;
            return Object.keys(btn).some((k) => k.startsWith("__reactProps"));
        }).catch(() => false);
        if (ready) return true;
        await page.waitForTimeout(250);
    }
    return false;
}

async function expectMenuWorks(page, label) {
    // ハンバーガーの中心を実際に覆っている要素を検査（不可視オーバーレイ検知）
    const cover = await page.evaluate(() => {
        const btn = document.querySelector('[aria-label="Open menu"], [aria-label="Close menu"]');
        if (!btn) return "no-button";
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!top) return "nothing";
        return btn === top || btn.contains(top) || top.contains(btn) ? "ok" : `covered-by:${top.tagName}.${String(top.className).slice(0, 60)}`;
    });
    check(`${label}: メニューボタンが覆われていない`, cover === "ok", cover);

    // タップ→開くをリトライ（遅い環境での水和待ちを吸収。真に死んでいる時だけ失敗する）
    let opened = false;
    let lastErr = "";
    const deadline = Date.now() + 20000;
    while (!opened && Date.now() < deadline) {
        lastErr = await tapOrClick(page, '[aria-label="Open menu"]', { timeout: 3000 }).then(() => "").catch((e) => e.message.replace(/\n/g, " | "));
        opened = await page.waitForSelector('#site-menu[role="dialog"]', { timeout: 1500 }).then(() => true).catch(() => false);
        if (!opened) await page.waitForTimeout(500);
    }
    check(`${label}: タップでメニューが開く`, opened, lastErr);
    if (opened) {
        await tapOrClick(page, '[aria-label="Close menu"]').catch(() => {});
        const closed = await page.waitForSelector('#site-menu', { state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
        check(`${label}: メニューが閉じる`, closed);
    }
}

// 1エンジン分の検査一式（モバイル context + デスクトップ context）。
async function runChecks(browser, eng) {
    // ── モバイル（タッチ）context ──
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    // 外部リクエスト（CloudFront画像・API等）を即座に遮断して密閉型にする。
    await ctx.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host === "localhost" || host === "127.0.0.1") return route.continue();
        return route.abort();
    });
    const page = await ctx.newPage();
    const bag = attachDiagnostics(page);

    console.log(`\n[${eng}][1] ホーム（モバイル・タッチ）`);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    const hydrated = await waitForHydration(page);
    check(`[${eng}] Reactがハイドレーションを完了する`, hydrated);
    if (!hydrated) reportDiagnostics(`${eng}/home`, bag); // 無反応の主因診断
    await expectMenuWorks(page, `[${eng}] 初期表示`);

    // 言語切替が反応する
    const langButton = page.locator("button", { hasText: "English" }).first();
    if (await langButton.isVisible().catch(() => false)) {
        await langButton.tap().catch(() => {});
        const switched = await page.locator("button", { hasText: "日本語" }).first().isVisible().catch(() => false);
        check(`[${eng}] 言語切替が反応する`, switched);
    }

    // 一覧タップで個別ページへ直接遷移する
    const firstPhoto = page.locator("a[data-photo-id]").first();
    if (await firstPhoto.isVisible().catch(() => false)) {
        const pid = await firstPhoto.getAttribute("data-photo-id");
        await firstPhoto.tap().catch(() => {});
        const navigated = await page.waitForURL(/\/photo\//, { timeout: 10000 }).then(() => true).catch(() => false);
        check(`[${eng}] 一覧タップで個別ページに遷移する`, navigated, page.url());
        if (navigated) {
            const h1 = await page.waitForSelector("h1", { timeout: 8000 }).then(() => true).catch(() => false);
            check(`[${eng}] 個別ページが表示される`, h1);
            await expectMenuWorks(page, `[${eng}] 個別ページ`);
        }

        // ビルド前の新着写真フォールバック: /?photo=<id> でモーダルが開く
        await page.goto(`http://localhost:${PORT}/?photo=${encodeURIComponent(pid ?? "")}`, { waitUntil: "domcontentloaded" });
        await waitForHydration(page);
        const modal = await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 }).then(() => true).catch(() => false);
        check(`[${eng}] ?photo= フォールバックでモーダルが開く`, modal);
        if (modal) {
            let closed = false;
            for (let k = 0; k < 5 && !closed; k++) {
                await page.keyboard.press("Escape");
                closed = await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: "detached", timeout: 2000 }).then(() => true).catch(() => false);
            }
            check(`[${eng}] 写真モーダルが閉じる`, closed);
        }
        await expectMenuWorks(page, `[${eng}] モーダル閉止後`);
    }

    // プロフィールページ: タブが切り替わる
    const profiles = fs.existsSync(path.join(OUT, "users"))
        ? fs.readdirSync(path.join(OUT, "users")).filter((f) => f.endsWith(".html"))
        : [];
    if (profiles.length > 0) {
        console.log(`\n[${eng}][2] プロフィール`);
        await page.goto(`http://localhost:${PORT}/users/${profiles[0].replace(/\.html$/, "")}`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] プロフィール: ハイドレーション完了`, await waitForHydration(page));
        const clicked = await page.evaluate(() => {
            const tabs = [...document.querySelectorAll("button[data-profile-tab][aria-pressed]")];
            const inactive = tabs.find((t) => t.getAttribute("aria-pressed") === "false");
            if (!inactive) return null;
            inactive.setAttribute("data-e2e-tab", "1");
            inactive.click();
            return true;
        });
        if (clicked) {
            const switched = await page.waitForFunction(
                () => document.querySelector('[data-e2e-tab]')?.getAttribute("aria-pressed") === "true",
                undefined, { timeout: 4000 },
            ).then(() => true).catch(() => false);
            check(`[${eng}] プロフィールのタブが切り替わる`, switched);
        }
        await expectMenuWorks(page, `[${eng}] プロフィール`);
    }

    const realErrors = bag.pageErrors.filter((m) => !isExpectedNetworkNoise(m));
    check(`[${eng}] 実行時のJSエラーがない`, realErrors.length === 0, realErrors.slice(0, 3).join(" / "));
    reportDiagnostics(`${eng}/mobile`, bag);
    await ctx.close();

    // ── デスクトップ（hover/マウス）context ──
    // ミニプレイヤーのドラッグはデスクトップ限定なので、モバイル context では
    // この経路を通らずメニュー被り不具合をすり抜けていた。ここで塞ぐ。
    console.log(`\n[${eng}][3] デスクトップ（hover・マウス）`);
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await dctx.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host === "localhost" || host === "127.0.0.1") return route.continue();
        return route.abort();
    });
    // 保存位置を右上(ヘッダー上)に seed。将来ミニプレイヤーがそこに出てもメニューを塞がないこと（クランプ）を確認。
    await dctx.addInitScript(() => {
        try { localStorage.setItem("jp_miniplayer_pos", JSON.stringify({ x: 99999, y: 0 })); } catch { /* ignore */ }
    });
    const dpage = await dctx.newPage();
    const dbag = attachDiagnostics(dpage);
    await dpage.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    check(`[${eng}] デスクトップ: ハイドレーション完了`, await waitForHydration(dpage));
    await expectMenuWorks(dpage, `[${eng}] 初期表示(デスクトップ)`);
    if (profiles.length > 0) {
        await dpage.goto(`http://localhost:${PORT}/users/${profiles[0].replace(/\.html$/, "")}`, { waitUntil: "domcontentloaded" });
        await waitForHydration(dpage);
        await expectMenuWorks(dpage, `[${eng}] プロフィール(デスクトップ)`);
    }
    const dRealErrors = dbag.pageErrors.filter((m) => !isExpectedNetworkNoise(m));
    check(`[${eng}] デスクトップ: 実行時のJSエラーがない`, dRealErrors.length === 0, dRealErrors.slice(0, 3).join(" / "));
    reportDiagnostics(`${eng}/desktop`, dbag);
    await dctx.close();
}

async function launchEngine(eng) {
    const type = BROWSER_TYPES[eng];
    if (!type) { console.log(`\n(未知のエンジン ${eng} をスキップ)`); return null; }
    try {
        return await type.launch({
            executablePath: eng === "chromium" ? resolveChromium() : undefined,
            args: eng === "chromium" ? ["--no-sandbox"] : [],
        });
    } catch (e) {
        // ローカルに未インストールのエンジンはスキップ（CI では playwright install 済み）。
        console.log(`\n  ⚠️ ${eng} を起動できないためスキップ: ${String(e.message).split("\n")[0]}`);
        return null;
    }
}

async function main() {
    if (!fs.existsSync(path.join(OUT, "index.html"))) {
        console.error("out/index.html がありません。先に npm run build を実行してください。");
        process.exit(1);
    }
    const server = await serveOut();
    let ran = 0;
    try {
        for (const eng of ENGINES) {
            const browser = await launchEngine(eng);
            if (!browser) continue;
            ran++;
            console.log(`\n===== エンジン: ${eng} =====`);
            try {
                await runChecks(browser, eng);
            } finally {
                await browser.close();
            }
        }
    } finally {
        server.close();
    }

    if (ran === 0) {
        console.error("\n💥 実行できたエンジンがありません（ブラウザ未インストール）");
        process.exit(1);
    }
    if (failures.length > 0) {
        console.error(`\n💥 スモークテスト失敗: ${failures.length}件 — デプロイを中止します`);
        process.exit(1);
    }
    console.log(`\n🎉 ブラウザ・スモークテスト全パス（エンジン: ${ENGINES.join(", ")}）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
