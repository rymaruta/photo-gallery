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
import { stubImageFor } from "./lib/smokeStubImages.mjs";
import { heroKeys } from "./lib/smokeHero.mjs";

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

/**
 * 🔴 **Service Worker の資産キャッシュに、2デプロイぶんが収まるか。**
 *
 * `public/sw.js` は `_next/static/**` を**キャッシュ優先**で控えるが、
 * `MAX_ASSET_ENTRIES` を超えると古い順に捨てる。`CACHE_VERSION` は固定で
 * `activate` が消すのは別のキャッシュ名だけなので、デプロイをまたぐと
 * **旧版と新版が同居する**——収まらないと**同じ版の資産どうしで
 * 追い出し合って**キャッシュがほとんど効かなくなる（毎回の再訪で JS を
 * 落とし直す）。**例外にはならないので、誰も気づかない。**
 *
 * 実測（2026-09-22・本番と同じ環境変数のビルド）: 公開ページだけで 30本、
 * ログインが要る10画面まで入れて **48本**。上限 150 に対して
 * 2デプロイ＝96、3デプロイ＝144。
 *
 * ここでは**スモークが回ったページ**の異なりを数え、**上限の半分**を
 * 超えたら落とす（＝2デプロイぶんが収まらなくなる手前）。
 * スモークは全画面を回らないので、実際の数はこれより多い——だから
 * 「半分」という余裕のある線で見る。
 */
function maxAssetEntriesFromSw() {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "public", "sw.js"), "utf8");
    const m = /const\s+MAX_ASSET_ENTRIES\s*=\s*(\d+)/.exec(src);
    return m ? Number(m[1]) : 0;
}
/** このエンジンで要求された `/_next/static/**` の異なり */
const staticAssets = new Set();
function watchStaticAssets(ctx) {
    ctx.on("request", (req) => {
        try {
            const u = new URL(req.url());
            if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname.startsWith("/_next/static/")) {
                staticAssets.add(u.pathname);
            }
        } catch { /* 相対でない URL は無視 */ }
    });
}

const failures = [];
function check(name, ok, detail = "") {
    if (ok) console.log(`  ✅ ${name}`);
    else { console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); failures.push(name); }
}

async function sealContext(ctx) {
    // **Service Worker を登録させない。**
    //
    // 登録されると2ページ目以降の画像要求を SW が仲介し、**その fetch は
    // Playwright の route を通らない**ので密閉を破って実ネットワークへ出る
    // （そして失敗する）。実測でこれが「集約ページ: 写真が並ぶ」を落として
    // いた。
    //
    // **`serviceWorkers: "block"` だけに頼らない。** あちらは
    // playwright-core の中でプロトコルの検証にしか現れず、**エンジンごとに
    // 効くかを確かめられない**（この環境に WebKit が無い）。本番は
    // chromium と webkit の両方を回すので、**どのエンジンでも同じになる
    // 形**——登録の口そのものを塞ぐ——を主にする。
    await ctx.addInitScript(() => {
        try {
            const sw = navigator.serviceWorker;
            if (sw) {
                Object.defineProperty(sw, "register", {
                    configurable: true,
                    value: () => Promise.reject(new Error("smoke: service worker disabled")),
                });
            }
        } catch { /* 触れない環境ならそのまま */ }
    });
    return ctx.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host === "localhost" || host === "127.0.0.1") return route.continue();
        if (route.request().resourceType() === "image") {
            return route.fulfill({ status: 200, ...stubImageFor(route.request().url()) });
        }
        return route.abort();
    });
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
            const btn = document.querySelector('[data-e2e="menu-toggle"]');
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
        const btn = document.querySelector('[data-e2e="menu-toggle"]');
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
        lastErr = await tapOrClick(page, '[data-e2e="menu-toggle"]', { timeout: 3000 }).then(() => "").catch((e) => e.message.replace(/\n/g, " | "));
        opened = await page.waitForSelector('#site-menu[role="dialog"]', { timeout: 1500 }).then(() => true).catch(() => false);
        if (!opened) await page.waitForTimeout(500);
    }
    check(`${label}: タップでメニューが開く`, opened, lastErr);
    if (opened) {
        await tapOrClick(page, '[data-e2e="menu-toggle"]').catch(() => {});
        const closed = await page.waitForSelector('#site-menu', { state: "detached", timeout: 5000 }).then(() => true).catch(() => false);
        check(`${label}: メニューが閉じる`, closed);
    }
}

// 1エンジン分の検査一式（モバイル context + デスクトップ context）。
async function runChecks(browser, eng) {
    // ── モバイル（タッチ）context ──
    // **Service Worker は止める。** 登録されると2ページ目以降の画像要求を
    // SW が仲介し、**その fetch は Playwright の route を通らない**ので
    // 密閉を破って実ネットワークへ出る（そして失敗する）。実測でこれが
    // 「集約ページ: 写真が並ぶ」を落としていた。SW 自体は
    // `public/sw.js` のテストが別に見ている
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
    // 外部リクエストを遮断して密閉型にする（画像だけは 1x1 PNG で返す）。
    await sealContext(ctx);
    watchStaticAssets(ctx);
    const page = await ctx.newPage();
    const bag = attachDiagnostics(page);

    console.log(`\n[${eng}][1] ホーム（モバイル・タッチ）`);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
    const hydrated = await waitForHydration(page);
    check(`[${eng}] Reactがハイドレーションを完了する`, hydrated);
    if (!hydrated) reportDiagnostics(`${eng}/home`, bag); // 無反応の主因診断

    // **Service Worker が止まっていることを、ここで名指しで確かめる。**
    //
    // 止まっていないと、SW が2ページ目以降の画像要求を仲介して**密閉を破り**、
    // 集約ページ・写真ページの「写真が並ぶ」が `img=0` で落ちる
    // ——原因が画像に見えて、実は SW という分かりにくい形になる（実際に踏んだ）。
    // **止め方が効かないエンジンがあっても、ここで名指しで落ちる**ので
    // 次に読む人が迷わない（WebKit は手元に無く、確かめられていない）。
    const swCount = await page.evaluate(async () => {
        try {
            if (!navigator.serviceWorker?.getRegistrations) return 0;
            return (await navigator.serviceWorker.getRegistrations()).length;
        } catch { return 0; }
    });
    check(`[${eng}] Service Worker が登録されていない（密閉が破れていない）`, swCount === 0, `登録=${swCount}`);
    await expectMenuWorks(page, `[${eng}] 初期表示`);

    // 言語切替のチェックは置かない。切替UI（LocaleToggle）は R-1 で削除済みで、
    // 「見えたら押す」形の旧チェックは一度も走らない死んだ分岐になっていた。

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
            // 開いている間は URL に残っていること。消えていると、再読込・
            // ブックマーク・アドレスバーのコピーのどれでも写真に戻れない。
            await page.waitForTimeout(500);
            check(`[${eng}] モーダル表示中は URL に ?photo= が残る`,
                page.url().includes(`photo=${encodeURIComponent(pid ?? "")}`));

            // **ビューアの中の画像を見る。** ここは**原寸（`src` / `srcAvif`＝`_lg`）を
            // 要求する、このサイトで唯一の場所**で、ほかの画面は全部サムネ
            // （`thumbSrc` / `thumbAvif`）しか出さない。つまり原寸の経路だけが
            // 壊れる回帰——ビューアへ渡す props から `src` が落ちる、
            // `publicImageUrl` を通し忘れる、`<picture>` の組み方を崩す——は
            // **この判定が無い限りスモークを素通りする**。実際このブロックは
            // 「モーダルが開く・URL が残る・閉じる」しか見ておらず、
            // **中身が「画像を読み込めません」でも全部緑**だった（変異で確認）。
            //
            // 見るのは2つだけ:
            //   (a) `ModalImage` の失敗表示（`imageError`）が出ていないこと
            //   (b) 主役の1枚が**水和後に実際に復号できている**こと
            //       （`complete && naturalWidth > 0`）
            //
            // **`img > 0` では見たことにならない。** ビューアにはアバターと
            // 次の写真のサムネも居るので、`data-e2e="viewer-image"` で名指しする。
            //
            // **AVIF が選ばれたかは見ない。** 派生を持たないビルド
            // （コミット済みの `photos.json`）では `<source>` がそもそも出ず、
            // エンジンによって候補の選び方も違う。どちらでも成り立つ
            // 「1枚が復号できている」だけを縛る。
            const viewer = await page.evaluate(async () => {
                const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
                if (!dlg) return { dialog: false };
                // 復号は非同期なので、決着（complete）まで少し待つ
                const deadline = Date.now() + 8000;
                let img = null;
                while (Date.now() < deadline) {
                    img = dlg.querySelector('[data-e2e="viewer-image"]');
                    if (img?.complete) break;
                    if ((dlg.textContent ?? "").includes("画像を読み込めません")) break;
                    await new Promise((r) => setTimeout(r, 150));
                }
                return {
                    dialog: true,
                    errorShown: (dlg.textContent ?? "").includes("画像を読み込めません"),
                    found: !!img,
                    complete: img?.complete ?? false,
                    naturalWidth: img?.naturalWidth ?? 0,
                    currentSrc: img?.currentSrc ?? "",
                };
            });
            check(`[${eng}] ビューア: 「画像を読み込めません」が出ていない`,
                !viewer.errorShown, viewer.currentSrc);
            check(`[${eng}] ビューア: 原寸の写真が出る`,
                viewer.found && viewer.complete && viewer.naturalWidth > 0,
                `found=${viewer.found} complete=${viewer.complete} naturalWidth=${viewer.naturalWidth} src=${viewer.currentSrc}`);

            let closed = false;
            for (let k = 0; k < 5 && !closed; k++) {
                await page.keyboard.press("Escape");
                closed = await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: "detached", timeout: 2000 }).then(() => true).catch(() => false);
            }
            check(`[${eng}] 写真モーダルが閉じる`, closed);
            if (closed) {
                await page.waitForTimeout(400);
                check(`[${eng}] 閉じると URL から ?photo= が消える`, !page.url().includes("photo="));

                // 同じ写真をもう一度開けること。
                // 「閉じた覚え」を解除し忘れると、2回目が無反応になる
                // （静的ページの無い新着写真にとっては唯一の閲覧手段）。
                await page.goto(`http://localhost:${PORT}/?photo=${encodeURIComponent(pid ?? "")}`, { waitUntil: "domcontentloaded" });
                await waitForHydration(page);
                const reopened = await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 }).then(() => true).catch(() => false);
                check(`[${eng}] 同じ写真をもう一度開ける`, reopened);
                if (reopened) {
                    for (let k = 0; k < 5; k++) {
                        await page.keyboard.press("Escape");
                        if (await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: "detached", timeout: 1500 }).then(() => true).catch(() => false)) break;
                    }
                }
            }
        }
        await expectMenuWorks(page, `[${eng}] モーダル閉止後`);
    }

    // プロフィールページ: タブが切り替わる
    const profiles = fs.existsSync(path.join(OUT, "users"))
        // "_none.html" はユーザー0人のビルドを通すための空枠
        // （lib/server/staticParams.ts の EMPTY_PARAM_PLACEHOLDER）。
        // 実在ページとして開くとタブ検査が空振りするので除く。
        ? fs.readdirSync(path.join(OUT, "users")).filter((f) => f.endsWith(".html") && f !== "_none.html")
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

    // 撮影地マップ（`/map`）。**このスモークが一度も開いていなかった**のに、
    // 台帳には実在の不具合が記録されている画面——`2922526f` で
    // 「**地図が固定ヘッダーを覆い、メニューボタンが見えないまま押せた**」を
    // 直している（Leaflet のペインがページ全体の重なり順に出ていた）。
    // `expectMenuWorks` は覆いを `elementFromPoint` で見るので、まさに
    // その形を捕まえる。
    //
    // **ピンの有無は見ない。** 座標を持つ写真はビルドのデータ次第で
    // （手元は0件・本番は16件）、どちらでも成り立つことだけ見る。
    if (fs.existsSync(path.join(OUT, "map.html"))) {
        console.log(`\n[${eng}][3] 撮影地マップ`);
        await page.goto(`http://localhost:${PORT}/map`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] 地図: ハイドレーション完了`, await waitForHydration(page));
        const m = await page.evaluate(() => ({
            h1: document.querySelector("h1")?.textContent?.trim() ?? "",
            // 地図の枠（または「まだありません」の案内）が出ていること
            body: (document.querySelector("main")?.textContent ?? "").trim().length,
        }));
        check(`[${eng}] 地図: 見出しが出る`, m.h1.length > 0, m.h1);
        check(`[${eng}] 地図: 本文が出る`, m.body > 0, `文字数=${m.body}`);
        await expectMenuWorks(page, `[${eng}] 地図`);
    }

    // 写真ページ（`/photo/<id>`）。**検索から人が着地する当のページ**なのに、
    // このスモークは `/?photo=<id>`（ホームのモーダル）しか開いていなかった
    // ——別の画面で、渡る props も違う。
    //
    // 見るのは (a) 主役の1枚が水和後も残ること (b) 回遊の導線が出ること。
    // 集約ページで実際に「水和後にサムネが消える」形の判定が効いたので、
    // 同じ穴をこちらにも空けておかない。
    const photoDir = path.join(OUT, "photo");
    const photoPages = fs.existsSync(photoDir)
        // `_none.html` は公開写真0枚のビルドを通すための空枠（`users` と
        // `tag` は前から除いている）。除かないと、その1枚しか無いビルドで
        // `hero=0` になり**デプロイが止まる**
        ? fs.readdirSync(photoDir).filter((f) => f.endsWith(".html") && f !== "_none.html").sort()
        : [];
    if (photoPages.length > 0) {
        console.log(`\n[${eng}][4] 写真ページ`);
        const id = photoPages[0].replace(/\.html$/, "");
        await page.goto(`http://localhost:${PORT}/photo/${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] 写真ページ: ハイドレーション完了`, await waitForHydration(page));
        // 主役の鍵: 写真の id と、画像のファイル名（今の投稿は別の名前・`smokeHero.mjs`）
        const keys = heroKeys(id, JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "data", "photos.json"), "utf8")));
        const detail = await page.evaluate((keys) => ({
            h1: document.querySelector("h1")?.textContent?.trim() ?? "",
            imgs: document.querySelectorAll("img").length,
            // **主役の1枚を名指しで数える。** ただの `img > 0` では、
            // アバターや「ほかにこんな写真も」のサムネが残るので
            // **主役を消しても緑のまま**だった（変異で確認）
            hero: [...document.querySelectorAll("img")]
                .filter((i) => keys.some((k) => (i.getAttribute("src") ?? "").includes(k))).length,
            broken: [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).length,
            // 回遊: 投稿者・集約ページ・ほかの写真のどれかへ出られること
            // **投稿者リンク1本で緑になる `> 0` では何も見ていない**
            // （実測: 30ページとも投稿者・タグ・カテゴリ・写真の4種を持ち、
            //  最小でも13本）。`RelatedPhotos` が消えたことを見たいので、
            //  **ほかの写真への導線**を別に数える
            outLinks: document.querySelectorAll(
                "a[href^='/users/'],a[href^='/tag/'],a[href^='/location/'],a[href^='/category/'],a[href^='/camera/']",
            ).length,
            otherPhotos: document.querySelectorAll("a[href^='/photo/'],a[href^='/?photo=']").length,
        }), keys);
        check(`[${eng}] 写真ページ: 見出しが出る`, detail.h1.length > 0, detail.h1);
        // **水和のあとに数える。** 主役の1枚が消える形はここでしか出ない
        check(`[${eng}] 写真ページ: 主役の写真が出る`, detail.hero > 0, `hero=${detail.hero} / img=${detail.imgs}`);
        check(`[${eng}] 写真ページ: 壊れた画像が無い`, detail.broken === 0, `broken=${detail.broken}`);
        check(`[${eng}] 写真ページ: 回遊の導線がある`, detail.outLinks > 0, `links=${detail.outLinks}`);
        check(`[${eng}] 写真ページ: ほかの写真への導線がある`, detail.otherPhotos > 0, `links=${detail.otherPhotos}`);
        await expectMenuWorks(page, `[${eng}] 写真ページ`);
    }

    // 集約ページ（タグ／カテゴリ／撮影地／機材）。**生成の 86/140 がここ**で、
    // 検索から人が着地する側でもあるのに、このスモークは一度も開いていなかった。
    //
    // **見るのは「写真が並ぶこと」。** 集約ページはサーバーが写真を props で
    // 渡す（`CollectionPage` → `CollectionPageClient` → `GalleryGrid`）ので、
    // 渡す項目を絞りすぎると**静的HTMLは出るのに、水和後にサムネが消える**。
    // 実際 2026-09-12 に props を絞ったが、**それを見る仕組みが無かった**
    // （`GalleryGrid` が読む項目は `lib/utils/__tests__/slimForLinks.test.ts`
    //  が縛るが、あれは単体テスト——配線が壊れても気づけない）。
    const tagDir = path.join(OUT, "tag");
    const tags = fs.existsSync(tagDir)
        ? fs.readdirSync(tagDir).filter((f) => f.endsWith(".html") && f !== "_none.html")
        : [];
    if (tags.length > 0) {
        console.log(`\n[${eng}][5] 集約ページ`);
        const slug = tags[0].replace(/\.html$/, "");
        await page.goto(`http://localhost:${PORT}/tag/${encodeURIComponent(slug)}`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] 集約ページ: ハイドレーション完了`, await waitForHydration(page));
        const grid = await page.evaluate(() => ({
            h1: document.querySelector("h1")?.textContent?.trim() ?? "",
            imgs: document.querySelectorAll("img").length,
            broken: [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).length,
            links: document.querySelectorAll("a[href^='/photo/'],a[href^='/?photo=']").length,
        }));
        check(`[${eng}] 集約ページ: 見出しが出る`, grid.h1.length > 0, grid.h1);
        // **水和のあとに数える。** 静的HTMLだけ見ても「消える」形は捕まらない
        check(`[${eng}] 集約ページ: 写真が並ぶ`, grid.imgs > 0, `img=${grid.imgs}`);
        check(`[${eng}] 集約ページ: 壊れた画像が無い`, grid.broken === 0, `broken=${grid.broken}`);
        check(`[${eng}] 集約ページ: 写真へのリンクがある`, grid.links > 0, `links=${grid.links}`);
        await expectMenuWorks(page, `[${eng}] 集約ページ`);
    }

    /**
     * 🔴 **索引ページ（`/category`）。** 「すべて見る ›」の行き先で、
     * **トップから集約ページへ渡る唯一の1本**（柱の `/search?…` は
     * `robots.txt` で `Disallow`＝行き止まり。実ビルドで 0本 と数えた）。
     *
     * ここが 404 になっても**ホームは今までどおり描かれる**ので、
     * 画面を見ているだけでは気づけない。`/category` と `/category/<slug>` が
     * 同居する形（`out/category.html` と `out/category/*.html`）が
     * 静的書き出しで崩れていないか、実ブラウザで1回通す。
     */
    if (fs.existsSync(path.join(OUT, "category.html"))) {
        console.log(`\n[${eng}][5d] 索引ページ`);
        await page.goto(`http://localhost:${PORT}/category`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] 索引ページ: ハイドレーション完了`, await waitForHydration(page));
        const idx = await page.evaluate(() => ({
            h1: document.querySelector("h1")?.textContent?.trim() ?? "",
            children: new Set([...document.querySelectorAll('a[href^="/category/"]')].map((a) => a.getAttribute("href"))).size,
            home: !!document.querySelector('a[href="/"]'),
        }));
        check(`[${eng}] 索引ページ: 見出しが出る`, idx.h1.length > 0, idx.h1);
        check(`[${eng}] 索引ページ: 集約ページへ並ぶ`, idx.children > 1, `子リンク=${idx.children}`);
        check(`[${eng}] 索引ページ: ホームへ戻れる`, idx.home);

        // **トップから実際に辿れること。** 部品が描いていても、柱が
        // PC でしか出ない・節ごと消えている、で届かなくなる
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
        await waitForHydration(page);
        const fromHome = await page.evaluate(() =>
            ["/category", "/location", "/camera"].filter((h) => !!document.querySelector(`a[href="${h}"]`)));
        check(`[${eng}] トップから索引ページへ行ける`, fromHome.length === 3, `届くのは ${fromHome.join(",") || "0本"}`);
    }

    /**
     * 🔴 **撮影スポット詳細（`/location/*`）。**
     *
     * ここは**検索の着地点**で、2026-09-22 に画面ごと作り直した。それなのに
     * このスモークは一度も開いていなかった——同じ日に出た不具合が
     * **どちらもこの画面**だった:
     *
     *   - その場で拡大したビューアの**キャプションが空**（渡す項目を絞りすぎた）
     *   - **戻るでページごと離脱**（履歴を積んでいなかった＝検索から来た人が
     *     サイトの外へ出る）
     *
     * どちらも例外にならないので、単体テストもビルドも素通りする。
     * **スラッグは全部が非ASCII**（`/location/パリ`）なので、
     * 百分率エンコードの経路もここで一度通る。
     */
    const locDir = path.join(OUT, "location");
    // **`_none.html` を外し、並びを固定する。** 0枚ビルドの置き石が先頭に
    // 来ると 404 → `/search?q=_none` へ流れ、**別のページで偽の緑**が出る
    // （`photo` / `users` / `tag` が同じ理由で除いている）。並べ替えないと
    // 当たるページが環境依存になる
    const locs = fs.existsSync(locDir)
        ? fs.readdirSync(locDir).filter((f) => f.endsWith(".html") && f !== "_none.html").sort()
        : [];
    if (locs.length > 0) {
        console.log(`\n[${eng}][5b] 撮影スポット詳細`);
        const slug = locs[0].replace(/\.html$/, "");
        await page.goto(`http://localhost:${PORT}/location/${encodeURIComponent(slug)}`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] スポット詳細: ハイドレーション完了`, await waitForHydration(page));
        const spot = await page.evaluate(() => ({
            h1: document.querySelector("h1")?.textContent?.trim() ?? "",
            imgs: document.querySelectorAll("img").length,
            links: document.querySelectorAll("a[href^='/photo/']").length,
        }));
        check(`[${eng}] スポット詳細: 見出しが出る`, spot.h1.length > 0, spot.h1);
        check(`[${eng}] スポット詳細: 写真が並ぶ`, spot.imgs > 0, `img=${spot.imgs}`);
        check(`[${eng}] スポット詳細: 写真ページへの内部リンクがある`, spot.links > 0, `links=${spot.links}`);

        // 格子をタップ → **その場で拡大**（遷移しない）
        const beforeUrl = page.url();
        // **2枚目を押す**（1枚目はヒーローと同じ写真）。`page.tap` は nth を
        // 取らないので locator で選ぶ。
        // **投げさせない。** ここで例外が出ると `runChecks` を抜けて
        // `/search` の検査もデスクトップの回も丸ごと走らず、しかも
        // 検査名の付いた ❌ が1つも出ない（生の Playwright のタイムアウトになる）
        const tile = page.locator("a[href^='/photo/']").nth(1);
        let tapped = true;
        try {
            await tile.tap({ timeout: 10000 }).catch(() => tile.click({ timeout: 10000 }));
        } catch (e) {
            tapped = false;
            check(`[${eng}] スポット詳細: 格子の写真を押せる`, false, String(e.message).split("\n")[0]);
        }
        // **固定の待ちにしない。** ビューアは `dynamic(..., { ssr: false })` なので
        // チャンクの取得が伸びると、待ち時間で決め打ちした回だけ3件同時に落ちる
        if (tapped) await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => undefined);
        const viewer = await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            if (!d) return { open: false, text: "", author: 0 };
            return {
                open: true,
                text: (d.textContent ?? "").replace(/\s+/g, " ").trim(),
                // **投稿者への導線**。`userId` と `displayName` の両方が
                // 渡っていないと出ない＝ビューア用の絞りを通った証拠
                author: d.querySelectorAll('a[href^="/users/"]').length,
            };
        });
        check(`[${eng}] スポット詳細: 格子タップでその場で拡大する`, viewer.open && page.url() === beforeUrl, page.url());
        // 🔴 **中身が痩せていないこと。** 渡す項目を絞りすぎると、絵は出るのに
        // 説明文も撮影情報も投稿者も黙って空になる（実際に起きた形）。
        //
        // ⚠️ **文字数だけでは捕まらない。** 格子用の絞り（`slimForGrid`）でも
        // 題と撮影地は残るので、`length > 10` は素通りする（実測）。
        // **ビューア用の絞りを通らないと出ないもの**で見る——投稿者への導線は
        // `userId` と `displayName` の両方が要る。
        check(`[${eng}] スポット詳細: ビューアに投稿者が出る（項目を絞りすぎていない）`,
            viewer.author > 0, `author=${viewer.author} text=${JSON.stringify(viewer.text.slice(0, 60))}`);
        check(`[${eng}] スポット詳細: ビューアに文字が出る`, viewer.text.length > 10, JSON.stringify(viewer.text.slice(0, 60)));
        // 🔴 **端末の「戻る」でビューアだけ閉じ、ページからは離れない。**
        // 積み忘れると、検索から来た人が戻るでサイトの外へ出る
        await page.goBack();
        // 閉じるのを待つ（固定の待ちにしない）
        const closed = await page
            .waitForFunction(() => !document.querySelector('[role="dialog"]'), undefined, { timeout: 10000 })
            .then(() => true).catch(() => false);
        check(`[${eng}] スポット詳細: 戻るでビューアが閉じ、ページに留まる`,
            closed && page.url().includes("/location/"), `closed=${closed} url=${page.url()}`);
    }

    /**
     * 🔴 **「さがす」（`/search`）。** 絞り込みの本拠地なのに一度も開いて
     * いなかった。`useGallery` は URL から絞り込みを読むので、**直接ひらいた
     * ときに効いているか**をここで通す（`<Link>` で飛ぶと落ちる形を
     * `DiscoverSections.test.tsx` が別に見ている）。
     */
    {
        console.log(`\n[${eng}][5c] さがす`);
        await page.goto(`http://localhost:${PORT}/search`, { waitUntil: "domcontentloaded" });
        check(`[${eng}] さがす: ハイドレーション完了`, await waitForHydration(page));
        const all = await page.evaluate(() => document.querySelectorAll("a[href^='/photo/'],a[href^='/?photo=']").length);
        check(`[${eng}] さがす: 写真が並ぶ`, all > 0, `links=${all}`);
        // カテゴリで絞る（URL から読む経路）。**件数が減ること**まで見る
        const cat = await page.evaluate(() => {
            const b = [...document.querySelectorAll("button[aria-pressed]")].find((x) => x.getAttribute("aria-pressed") === "false");
            return b ? (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() : null;
        });
        // **見つからなければ赤にする。** `if (cat)` で包むと、チップの形が
        // 変わった日に**何も検査しないまま全部緑**になる（`LocaleToggle` の
        // 「見えたら押す」を死んだ分岐として消したのと同じ形）
        check(`[${eng}] さがす: 絞り込みのチップがある`, !!cat, `cat=${cat}`);
        if (cat) {
            await tapOrClick(page, `button[aria-pressed="false"]`);
            // 件数が動くまで待つ（固定の待ちにしない）
            const narrowed = await page
                .waitForFunction((n) => document.querySelectorAll("a[href^='/photo/'],a[href^='/?photo=']").length !== n, all, { timeout: 10000 })
                .then(() => page.evaluate(() => document.querySelectorAll("a[href^='/photo/'],a[href^='/?photo=']").length))
                .catch(() => all);
            check(`[${eng}] さがす: 絞り込みが効く（${cat}）`, narrowed > 0 && narrowed < all, `全${all} → ${narrowed}`);
            check(`[${eng}] さがす: 絞り込みが URL に出る`, /[?&](category|tags|q)=/.test(page.url()), page.url());

            /**
             * 🔴 **クエリ付きで「直接ひらく」経路を通す。**
             *
             * ここまでは `/search` を開いてからチップを押していた＝
             * **クライアント側の状態変化**しか見ていない。ところが
             * `/search?…` を**URL ごと開く**と、静的HTML（絞り込み無し）と
             * 最初の描画（絞り込み後）が食い違って**React が水和に失敗して
             * いた**（`#418`。2026-09-22 に実測）。失敗すると焼いた HTML を
             * 捨てて全部描き直すので、検索からの着地・404 の救済・柱からの
             * 遷移が毎回その作り直しを踏む。**例外は握られて画面に出ない。**
             *
             * この経路は実際に人が通る——`robots.txt` は `/search` を
             * 拒んでいるが、404 の救済（`resolveNotFoundRedirect`）と
             * ホームの柱がここへ送る。
             *
             * JS エラーそのものは下の「実行時のJSエラーがない」が拾う。
             * ここでは**絞り込みが効いた状態で描かれること**まで見る
             * （水和をやめて全部描き直せば絵は出るので、件数まで見ないと
             *   「直った」と言えない）。
             */
            const direct = page.url();
            await page.goto(direct, { waitUntil: "domcontentloaded" });
            await waitForHydration(page);
            await page.waitForTimeout(600);
            const reopened = await page.evaluate(() =>
                document.querySelectorAll("a[href^='/photo/'],a[href^='/?photo=']").length);
            check(`[${eng}] さがす: 絞り込み付きの URL を直接ひらいても効く`,
                reopened > 0 && reopened < all, `全${all} → ${reopened}（${direct}）`);
            check(`[${eng}] さがす: 直接ひらいても URL が残る`,
                /[?&](category|tags|q)=/.test(page.url()), page.url());
        }
    }

    /**
     * 🔴 **「探す → ガイド → 投稿」の導線**（2026-09-30 のレビューの受け入れ条件）。
     *
     *   - 「さがす」で「銀山温泉」: 写真が0枚でも撮影スポットの節からガイドへ行ける
     *   - ガイドの「ここで撮った写真を投稿する」: スポットを運ぶ（`?spot=<slug>`）
     *   - 地図（スマホ）: 地図の表示中はスポットの長い一覧を出さない（地図より前に置かない）
     *
     * **台帳次第**（公開済みに銀山温泉が無いビルド）なので、ページが無ければ飛ばす
     */
    if (fs.existsSync(path.join(OUT, "spots", "ginzan-onsen.html"))) {
        console.log(`\n[${eng}][5d] 探す → ガイド → 投稿`);
        await page.goto(`http://localhost:${PORT}/search?q=${encodeURIComponent("銀山温泉")}`, { waitUntil: "domcontentloaded" });
        await waitForHydration(page);
        const spotLink = await page
            .waitForSelector("[data-testid='search-spot-results'] a[href='/spots/ginzan-onsen']", { timeout: 10000 })
            .then(() => true).catch(() => false);
        check(`[${eng}] さがす: 「銀山温泉」で撮影スポットの節からガイドへ行ける`, spotLink);

        await page.goto(`http://localhost:${PORT}/spots/ginzan-onsen`, { waitUntil: "domcontentloaded" });
        await waitForHydration(page);
        const uploadHrefs = await page.evaluate(() =>
            [...document.querySelectorAll("a")].filter((a) => /ここで撮った写真を投稿する/.test(a.textContent ?? "")).map((a) => a.getAttribute("href")));
        check(`[${eng}] ガイド: 投稿のリンクがスポットを運ぶ`,
            uploadHrefs.length > 0 && uploadHrefs.every((h) => h === "/user/upload?spot=ginzan-onsen"), JSON.stringify(uploadHrefs));

        if (fs.existsSync(path.join(OUT, "map.html"))) {
            await page.goto(`http://localhost:${PORT}/map`, { waitUntil: "domcontentloaded" });
            await waitForHydration(page);
            // 地図（Leaflet）は後から読み込まれる
            await page.waitForSelector(".leaflet-container", { timeout: 10000 }).catch(() => {});
            const layout = await page.evaluate(() => {
                const list = document.querySelector("[data-testid='map-spot-list']");
                const map = document.querySelector(".leaflet-container");
                return {
                    listShown: !!list && list.offsetParent !== null,
                    mapTop: map ? Math.round(map.getBoundingClientRect().top + window.scrollY) : -1,
                };
            });
            check(`[${eng}] 地図（スマホ）: 地図の表示中はスポットの一覧を出さない`, !layout.listShown, JSON.stringify(layout));
            check(`[${eng}] 地図（スマホ）: 地図が1画面目に在る`, layout.mapTop >= 0 && layout.mapTop < 400, JSON.stringify(layout));
        }
    }

    /**
     * **今日の一問（`/q`）。** 問題は画面が日付のファイル（`/app/data/quiz/<日本の今日>.json`）
     * から読むので、ビルドが今日の分を書き出していないと「まだありません」になる。
     * 例外にならない壊れ方（日付の食い違い・読み取りの弾きすぎ）はここでしか見えない
     */
    if (fs.existsSync(path.join(OUT, "q.html"))) {
        console.log(`\n[${eng}][5e] 今日の一問`);
        await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
        await waitForHydration(page);
        check(`[${eng}] 今日の一問: トップから入口で行ける`, !!(await page.$("[data-testid='home-quiz-entry'][href='/q']")));
        await page.goto(`http://localhost:${PORT}/q`, { waitUntil: "domcontentloaded" });
        await waitForHydration(page);
        const choices = await page
            .waitForSelector("[role='group'] button", { timeout: 10000 })
            .then(() => page.$$("[role='group'] button")).catch(() => []);
        check(`[${eng}] 今日の一問: 今日の問題が出る（選択肢4つ）`, choices.length === 4, `選択肢=${choices.length}`);
        if (choices.length === 4) {
            await choices[0].click();
            const result = await page.waitForSelector("[data-testid='quiz-result']", { timeout: 5000 }).then(() => true).catch(() => false);
            const guide = await page.evaluate(() =>
                document.querySelector("[data-testid='quiz-result'] a[href^='/spots/']")?.getAttribute("href") ?? "");
            // 形だけでなく、**行き先のページがビルドに在る**こと（404 のガイドへ送らない）
            const built = /^\/spots\/[a-z0-9-]+$/.test(guide) && fs.existsSync(path.join(OUT, `${guide.slice(1)}.html`));
            check(`[${eng}] 今日の一問: 答えると結果とガイドへのリンク（行き先が在る）`, result && built, guide);
        }
    }

    const realErrors = bag.pageErrors.filter((m) => !isExpectedNetworkNoise(m));
    check(`[${eng}] 実行時のJSエラーがない`, realErrors.length === 0, realErrors.slice(0, 3).join(" / "));
    reportDiagnostics(`${eng}/mobile`, bag);
    await ctx.close();

    // ── デスクトップ（hover/マウス）context ──
    // ミニプレイヤーのドラッグはデスクトップ限定なので、モバイル context では
    // この経路を通らずメニュー被り不具合をすり抜けていた。ここで塞ぐ。
    console.log(`\n[${eng}][6] デスクトップ（hover・マウス）`);
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    await sealContext(dctx);
    watchStaticAssets(dctx);
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

    await runSignedInChecks(browser, eng);

    // **資産の異なりが、SW の上限の半分に収まっているか**（上の注記を参照）
    const limit = maxAssetEntriesFromSw();
    check(`[${eng}] SW の資産キャッシュに 2デプロイぶんが収まる`,
        limit > 0 && staticAssets.size > 0 && staticAssets.size * 2 <= limit,
        `異なり=${staticAssets.size} × 2デプロイ = ${staticAssets.size * 2} / 上限 ${limit}`);
}

/* ──────────────────────────────────────────────────────────────────────────
 * ログイン済みの画面を開くための道具
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **この関門は、長いあいだ「ログインできない site」を見ていた。**
 *
 * `scripts/verify-local.sh` の `build_site()` が `NEXT_PUBLIC_COGNITO_CLIENT_ID`
 * を渡していなかったので、建った `out/` では `lib/auth/config.ts` が投げ、
 * `lookupSession` は必ず未ログインを返す。実測（2026-09-22）——
 * `out/user/highlights` を開いた本文は
 *
 *     "ログイン / 写真をアップロードするにはログインが必要です …"
 *
 * つまり `/user/**` の12画面は**1つも中身が描かれていなかった**。
 * 今日いちばん大きかった2件（ハイライトの「保存」が押せない・`/user/edit` の
 * 下バーが全部押せない）が全関門を素通りしたのは、突き詰めるとこれ。
 *
 * **だから偽のトークンで入って、実際に描かれた画面を見る。**
 * 署名は検証していない（クライアントは Cognito の応答を信じる作り）ので、
 * `localStorage` に本物と同じ鍵で置けばログイン済みとして描かれる。
 * API は全部この場で作った JSON で返す（密閉は保ったまま）。
 */
const SIGNED_IN_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** 署名は捨てる（クライアントは検証しない）。形だけ本物に合わせる */
const fakeJwt = (payload) => `${b64url({ alg: "RS256", kid: "smoke" })}.${b64url(payload)}.c21va2U`;

/** API の受け皿。**未知の口は空オブジェクト**（画面は「0件」として描く） */
function signedInApiBody(url, method, photos) {
    const p = new URL(url).pathname;
    if (p === "/user/profile" || p.startsWith("/profile/")) return SIGNED_IN_PROFILE;
    if (p === "/user/photos" || p === "/photos") return photos;
    if (p === "/stories" || p === "/stories/archive") return [];
    if (p.startsWith("/highlights")) return { highlights: [] };
    if (p === "/user/notifications") return { items: [], unread: 0 };
    if (p === "/user/following") return { list: [] };
    if (p === "/user/blocks" || p === "/albums") return { items: [] };
    if (p === "/user/likes" || p === "/user/saves" || p === "/user/spots") return { ids: [] };
    // 旅行プラン。**1件返す**——0件だと空状態しか描かれず、カード（題・期間・
    // 何か所・削除）の名前とタップ領域を一度も測らないことになる
    if (p === "/user/trips") return { plans: [{
        planId: "smoke-trip", title: "スモークの旅", startDate: "2026-12-24", endDate: "2026-12-28",
        days: [{ date: "2026-12-24", items: [{ kind: "location", slug: "パリ" }] }],
        visibility: "private",
    }] };
    if (/^\/users\/[^/]+\/follow$/.test(p)) return { following: false, followers: 0, followingCount: 0 };
    if (/^\/photos\/[^/]+\/comments$/.test(p)) return { items: [], count: 0 };
    if (/^\/photos\/[^/]+\/like$/.test(p)) return { likes: 0 };
    if (p === "/music/search") return { results: [] };
    if (method !== "GET") return { ok: true };
    return {};
}

let SIGNED_IN_PROFILE = null;

/**
 * 画面を「読める状態か」で見る監査。**名前・重なり・見出し・溢れ**を一度に測る。
 *
 * - `checkVisibility` で祖先の `display:none` まで見る（子だけ見ると
 *   閉じたメニューの中身を「見えている」と数えてしまう。実測で誤報した）
 * - `scrollIntoView` は `behavior: 'instant'`。`scroll-behavior: smooth` が
 *   効くと移動が非同期になり、**まだ動いていない座標で当たり判定**をして
 *   48件の誤報を出した（実測）
 * - 包んでいる `<label>` も名前として数える（`for=` だけではない）
 */
const SIGNED_IN_AUDIT = `(() => {
  const name = (el) => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    const ti = el.getAttribute('title'); if (ti && ti.trim()) return ti.trim();
    const txt = (el.textContent ?? '').replace(/\\s+/g, ' ').trim(); if (txt) return txt;
    const img = el.querySelector('img[alt]'); if (img && (img.getAttribute('alt') ?? '').trim()) return img.getAttribute('alt').trim();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const id = el.id;
      if (id) { const l = document.querySelector('label[for="' + CSS.escape(id) + '"]'); if (l && l.textContent.trim()) return l.textContent.trim(); }
      const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      const ph = el.getAttribute('placeholder'); if (ph && ph.trim()) return ph.trim();
    }
    return '';
  };
  const visible = (el) => (el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : !!el.offsetParent);
  const out = { noName: [], covered: [], dupIds: [], focusable: 0, h1: 0, overflow: 0, signedIn: false, text: 0 };
  // ログイン画面そのものの目印で見る。パスワード欄の有無で見ていたら、
  // /user/settings（パスワード変更の欄がある）が
  // 「ログインしていない」と誤報した（実測）。
  // ※この塊はテンプレート文字列の中なので、バッククォートと $ は書けない
  out.signedIn = !document.querySelector('#login-email');
  out.text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length;
  out.overflow = document.documentElement.scrollWidth - window.innerWidth;
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  for (const [id, c] of seen) if (c > 1) out.dupIds.push(id + ' x' + c);
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role="switch"], [role="tab"]')) {
    if (!visible(el)) continue;
    out.focusable++;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (!name(el)) out.noName.push(el.tagName + ': ' + el.outerHTML.slice(0, 80).replace(/\\s+/g, ' '));
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom <= 0 || r.top >= innerHeight) continue;
    const x = Math.min(innerWidth - 1, Math.max(1, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(1, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      out.covered.push(name(el).slice(0, 28) + ' <- ' + hit.tagName + '.' + String(hit.className).slice(0, 40));
    }
  }
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h => Number(h.tagName[1]));
  out.h1 = hs.filter(l => l === 1).length;
  return out;
})()`;

/**
 * ログイン済みの画面をひと通り開いて、**押せない操作が無いこと**を見る。
 *
 * ここで見るのは「絵が正しいか」ではなく「**指が届くか**」——
 * いちばん下まで送った状態で、見えている操作の中心を当たり判定に掛ける。
 * 下に固定した帯がタブバーやフッターを覆っていれば、そこで落ちる。
 */
async function runSignedInChecks(browser, eng) {
    console.log(`\n[${eng}][7] ログイン済みの画面（偽のトークンで入る）`);

    // **値が無ければ落とす。** 黙って飛ばすと、この節を足した理由
    // （ログインできない site を見ていた）がそのまま戻る
    check(`[${eng}] ログイン: Client ID が渡っている`, !!SIGNED_IN_CLIENT_ID,
        "NEXT_PUBLIC_COGNITO_CLIENT_ID が空（verify-local.sh / deploy.yml の env を見る）");
    if (!SIGNED_IN_CLIENT_ID) return;

    // 実在するプロフィール（`/users/<sub>` を本人として開くため）
    const profiles = fs.existsSync(path.join(OUT, "users"))
        ? fs.readdirSync(path.join(OUT, "users")).filter((f) => f.endsWith(".html"))
        : [];
    const sub = (profiles[0] ?? "").replace(/\.html$/, "") || "00000000-0000-4000-8000-000000000000";

    const allPhotos = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "data", "photos.json"), "utf8"));
    const photos = allPhotos.slice(0, 6).map((p) => ({ ...p, userId: sub, published: true }));
    SIGNED_IN_PROFILE = { userId: sub, displayName: "スモークの人", username: "smoke", bio: "", themeColor: "#2080f6", pinnedPhotoIds: [] };

    const now = Math.floor(Date.now() / 1000);
    const common = { sub, exp: now + 3600, iat: now, "cognito:groups": ["user"] };
    const idToken = fakeJwt({ ...common, aud: SIGNED_IN_CLIENT_ID, token_use: "id", "cognito:username": sub, email: "smoke@example.com", email_verified: true });
    const accessToken = fakeJwt({ ...common, client_id: SIGNED_IN_CLIENT_ID, token_use: "access", username: sub, scope: "aws.cognito.signin.user.admin" });

    const screens = [
        ["/user/profile", "自分のプロフィール"],
        ["/user/upload", "投稿作成"],
        ["/user/settings", "設定"],
        ["/user/archive", "アーカイブ"],
        ["/user/highlights", "ハイライト編集"],
        ["/user/drafts", "下書き"],
        ["/user/albums", "アルバム"],
        ["/saves", "保存した写真"],
        ["/saved-spots", "行きたい場所"],
        ["/trips", "旅行プラン"],
        ["/favorites", "いいねした写真"],
        [`/users/${sub}`, "マイページ（本人として）"],
        [`/user/edit?id=${encodeURIComponent(photos[0]?.id ?? "")}`, "写真の編集"],
    ];

    // 幅は2つだけ（画面数 × 幅で時間が伸びる）。**320px を外さない**
    // ——重なりは狭い画面から出る（`MiniPlayer` の 3px 重なりがそうだった）
    for (const [w, h, touch] of [[320, 640, true], [1280, 900, false]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, serviceWorkers: "block" });
        await sealContext(ctx);
        watchStaticAssets(ctx);
        // **`sealContext` の後に登録する**（あとから足した route が先に当たる）。
        // これで API だけ JSON を返し、それ以外の外向きは遮断のまま
        await ctx.route("**://*.execute-api.*.amazonaws.com/**", (route) => route.fulfill({
            status: 200, contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(signedInApiBody(route.request().url(), route.request().method(), photos)),
        }));
        await ctx.addInitScript(({ cid, s, id, at }) => {
            try {
                const k = `CognitoIdentityServiceProvider.${cid}`;
                localStorage.setItem(`${k}.LastAuthUser`, s);
                localStorage.setItem(`${k}.${s}.idToken`, id);
                localStorage.setItem(`${k}.${s}.accessToken`, at);
                localStorage.setItem(`${k}.${s}.refreshToken`, "smoke");
                localStorage.setItem(`${k}.${s}.clockDrift`, "0");
            } catch { /* localStorage が無い環境ならそのまま */ }
        }, { cid: SIGNED_IN_CLIENT_ID, s: sub, id: idToken, at: accessToken });

        // **同意画面（「はじめる前に」）は1回目のページで確かめ、以後は同意済みにする。**
        // ログインした人に全面で出るので、同意済みにしないと下の画面の検査が
        // 全部「押せない操作がある」になる（同意画面が覆っている＝意図どおり）。
        // キーは `lib/utils/legalConsent.ts` の LEGAL_CONSENT_KEY と同じ
        {
            const page = await ctx.newPage();
            const tag = `[${eng}] ${w}px 同意画面`;
            try {
                await page.goto(`http://localhost:${PORT}/user/settings`, { waitUntil: "domcontentloaded" });
                const dialog = page.getByRole("dialog", { name: "はじめる前に" });
                await dialog.waitFor({ state: "visible", timeout: 15000 });
                const button = page.getByRole("button", { name: "同意してはじめる" });
                await button.scrollIntoViewIfNeeded();
                // 押せる（上に何も被っていない）こと
                const box = await button.boundingBox();
                const onTop = box ? await page.evaluate(({ x, y }) => {
                    const el = document.elementFromPoint(x, y);
                    return !!el?.closest("button")?.textContent?.includes("同意してはじめる");
                }, { x: box.x + box.width / 2, y: box.y + box.height / 2 }) : false;
                check(`${tag}: 未同意のログイン済みに出て、ボタンが押せる`, onTop, "同意ボタンが見えない／覆われている");
                await button.click();
                await dialog.waitFor({ state: "detached", timeout: 5000 });
                const stored = await page.evaluate(() => localStorage.getItem("legal.consent.version"));
                check(`${tag}: 同意すると閉じて記録が残る`, stored === "1", `記録=${stored}`);
            } catch (e) {
                check(`${tag}: 出る・閉じる`, false, String(e.message ?? e).split("\n")[0]);
            }
            await page.close();
        }
        await ctx.addInitScript(() => {
            try { localStorage.setItem("legal.consent.version", "1"); } catch { /* ignore */ }
        });

        for (const [url, label] of screens) {
            const page = await ctx.newPage();
            const bag = attachDiagnostics(page);
            const tag = `[${eng}] ${w}px ${label}`;
            let audit = null;
            try {
                await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "domcontentloaded" });
                // 認証の確定 → 取得 → 描画、と段があるので「ログイン画面が
                // 消える」まで待つ（固定の待ちにしない）
                await page.waitForFunction(() => !document.querySelector('#login-email'), null, { timeout: 15000 }).catch(() => {});
                await page.waitForTimeout(800);
                // **いちばん下まで送ってから測る。** 下に固定した帯が
                // フッターを覆う形は、送り切った状態でしか出ない（実測）
                await page.evaluate(() => {
                    document.documentElement.style.scrollBehavior = "auto";
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await page.waitForTimeout(300);
                audit = await page.evaluate(SIGNED_IN_AUDIT);
            } catch (e) {
                check(`${tag}: 開ける`, false, String(e.message ?? e).split("\n")[0]);
                await page.close();
                continue;
            }
            check(`${tag}: ログイン済みとして描かれる`, audit.signedIn && audit.text > 20,
                `signedIn=${audit.signedIn} 本文=${audit.text}字`);
            check(`${tag}: 押せない操作が無い`, audit.covered.length === 0, audit.covered.slice(0, 3).join(" / "));
            check(`${tag}: 名前の無い操作が無い`, audit.noName.length === 0, audit.noName.slice(0, 2).join(" / "));
            check(`${tag}: id が重複していない`, audit.dupIds.length === 0, audit.dupIds.slice(0, 3).join(" / "));
            check(`${tag}: 見出しが1つ`, audit.h1 === 1, `h1=${audit.h1}`);
            check(`${tag}: 横に溢れていない`, audit.overflow <= 1, `はみ出し=${audit.overflow}px`);
            const real = bag.pageErrors.filter((m) => !isExpectedNetworkNoise(m));
            check(`${tag}: 実行時のJSエラーが無い`, real.length === 0, real.slice(0, 2).join(" / "));
            await page.close();
        }
        await ctx.close();
    }
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
    // 「起動できたエンジン」と「頼まれたのに起動できなかったエンジン」を分けて持つ。
    // 以前は最後に ENGINES をそのまま並べて「全パス」と出していたので、
    // CI で WebKit が起動できなくても「chromium, webkit で全パス」と表示され、
    // Safari 側の確認が抜けたまま緑になっていた。
    const ranEngines = [];
    const skipped = [];
    try {
        for (const eng of ENGINES) {
            const browser = await launchEngine(eng);
            if (!browser) { skipped.push(eng); continue; }
            ranEngines.push(eng);
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

    if (ranEngines.length === 0) {
        console.error("\n💥 実行できたエンジンがありません（ブラウザ未インストール）");
        process.exit(1);
    }
    if (skipped.length > 0) {
        // SMOKE_ENGINES を明示している＝CI で意図して指定している。
        // そこで起動できないのは環境の不備なので、黙って通さない。
        // 指定が無い（＝ローカルの既定）ときだけ、未インストールを許す。
        const explicit = !!process.env.SMOKE_ENGINES;
        const msg = `起動できなかったエンジン: ${skipped.join(", ")}`;
        if (explicit) {
            console.error(`\n💥 ${msg} — SMOKE_ENGINES で指定されているため失敗にします`);
            process.exit(1);
        }
        console.warn(`\n⚠️ ${msg}（未指定のためスキップ）`);
    }
    if (failures.length > 0) {
        console.error(`\n💥 スモークテスト失敗: ${failures.length}件 — デプロイを中止します`);
        process.exit(1);
    }
    console.log(`\n🎉 ブラウザ・スモークテスト全パス（エンジン: ${ranEngines.join(", ")}）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
