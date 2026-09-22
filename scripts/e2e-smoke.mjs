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
        const detail = await page.evaluate((photoId) => ({
            h1: document.querySelector("h1")?.textContent?.trim() ?? "",
            imgs: document.querySelectorAll("img").length,
            // **主役の1枚を名指しで数える。** ただの `img > 0` では、
            // アバターや「ほかにこんな写真も」のサムネが残るので
            // **主役を消しても緑のまま**だった（変異で確認）
            hero: [...document.querySelectorAll("img")]
                .filter((i) => (i.getAttribute("src") ?? "").includes(photoId)).length,
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
        }), id);
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
