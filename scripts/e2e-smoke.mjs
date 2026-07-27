// デプロイ前のブラウザ・スモークテスト。
// jsdom では検知できない「見た目は正常なのにタップが効かない」系の回帰
// （不可視オーバーレイ・ハイドレーション失敗・チャンク欠落）を、
// ビルド済み out/ を実ブラウザで開いて実際にタップして検証する。
// 1つでも失敗すると exit 1 になり、デプロイが止まる。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "out");
const PORT = 4173;

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

// React のハイドレーション完了を待つ（メニューボタンに React のハンドラが
// 付くまでポーリング）。固定スリープだと遅い環境で誤検知するため。
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
        lastErr = await page.tap('[aria-label="Open menu"]', { timeout: 3000 }).then(() => "").catch((e) => e.message.replace(/\n/g, " | "));
        opened = await page.waitForSelector('#site-menu[role="dialog"]', { timeout: 1500 }).then(() => true).catch(() => false);
        if (!opened) await page.waitForTimeout(500);
    }
    check(`${label}: タップでメニューが開く`, opened, lastErr);
    if (opened) {
        await page.tap('[aria-label="Close menu"]').catch(() => {});
        const closed = await page.waitForSelector('#site-menu', { state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
        check(`${label}: メニューが閉じる`, closed);
    }
}

async function main() {
    if (!fs.existsSync(path.join(OUT, "index.html"))) {
        console.error("out/index.html がありません。先に npm run build を実行してください。");
        process.exit(1);
    }
    const server = await serveOut();
    const browser = await chromium.launch({ executablePath: resolveChromium(), args: ["--no-sandbox"] });

    try {
        const ctx = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
        });
        // 外部リクエスト（CloudFront画像・API等）を即座に遮断して密閉型にする。
        // ネットワーク状態に依存せず、どの環境でも同じ結果になる。
        await ctx.route("**/*", (route) => {
            const host = new URL(route.request().url()).hostname;
            if (host === "localhost" || host === "127.0.0.1") return route.continue();
            return route.abort();
        });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        // 1) ホーム: 初期状態でメニューが動く
        console.log("\n[1] ホーム（モバイル・タッチ）");
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
        const hydrated = await waitForHydration(page);
        check("Reactがハイドレーションを完了する", hydrated);
        await expectMenuWorks(page, "初期表示");

        // 2) 言語切替が反応する
        const langButton = page.locator("button", { hasText: "English" }).first();
        const langVisible = await langButton.isVisible().catch(() => false);
        if (langVisible) {
            await langButton.tap().catch(() => {});
            const switched = await page.locator("button", { hasText: "日本語" }).first().isVisible().catch(() => false);
            check("言語切替が反応する", switched);
        }

        // 3) 一覧タップで個別ページへ直接遷移する
        const firstPhoto = page.locator("a[data-photo-id]").first();
        if (await firstPhoto.isVisible().catch(() => false)) {
            const pid = await firstPhoto.getAttribute("data-photo-id");
            await firstPhoto.tap().catch(() => {});
            const navigated = await page.waitForURL(/\/photo\//, { timeout: 10000 }).then(() => true).catch(() => false);
            check("一覧タップで個別ページに遷移する", navigated, page.url());
            if (navigated) {
                const h1 = await page.waitForSelector("h1", { timeout: 8000 }).then(() => true).catch(() => false);
                check("個別ページが表示される", h1);
                await expectMenuWorks(page, "個別ページ");
            }

            // 4) ビルド前の新着写真フォールバック: /?photo=<id> でモーダルが開く
            await page.goto(`http://localhost:${PORT}/?photo=${encodeURIComponent(pid ?? "")}`, { waitUntil: "domcontentloaded" });
            await waitForHydration(page);
            const modal = await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 }).then(() => true).catch(() => false);
            check("?photo= フォールバックでモーダルが開く", modal);
            if (modal) {
                // Escape で閉じ、確実に消えるまで待つ（後続チェックを汚染しない）
                let closed = false;
                for (let k = 0; k < 5 && !closed; k++) {
                    await page.keyboard.press("Escape");
                    closed = await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: "detached", timeout: 2000 }).then(() => true).catch(() => false);
                }
                check("写真モーダルが閉じる", closed);
            }
            await expectMenuWorks(page, "モーダル閉止後");
        }

        // 4) プロフィールページ: タブが切り替わる
        const profiles = fs.existsSync(path.join(OUT, "users"))
            ? fs.readdirSync(path.join(OUT, "users")).filter((f) => f.endsWith(".html"))
            : [];
        if (profiles.length > 0) {
            console.log("\n[2] プロフィール");
            await page.goto(`http://localhost:${PORT}/users/${profiles[0].replace(/\.html$/, "")}`, { waitUntil: "domcontentloaded" });
            check("プロフィール: ハイドレーション完了", await waitForHydration(page));
            const clicked = await page.evaluate(() => {
                // プロフィールのタブに限定（フォローボタン等の aria-pressed と混ざらないように）
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
                    undefined,
                    { timeout: 4000 },
                ).then(() => true).catch(() => false);
                check("プロフィールのタブが切り替わる", switched);
            }
            await expectMenuWorks(page, "プロフィール");
        }

        // 5) ページ全体のJSエラー
        check("実行時のJSエラーがない", pageErrors.length === 0, pageErrors.slice(0, 3).join(" / "));
    } finally {
        await browser.close();
        server.close();
    }

    if (failures.length > 0) {
        console.error(`\n💥 スモークテスト失敗: ${failures.length}件 — デプロイを中止します`);
        process.exit(1);
    }
    console.log("\n🎉 ブラウザ・スモークテスト全パス");
}

main().catch((e) => { console.error(e); process.exit(1); });
