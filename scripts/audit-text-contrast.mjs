/**
 * 黒地の文字が読める濃さか（WCAG AA）を、**実ブラウザで測る**道具。
 *
 *   node scripts/audit-text-contrast.mjs            # out/ を配って主要な画面を測る
 *
 * 先に `npm run build`（または `npx next build`）で `out/` を作っておくこと。
 * 画像・タイル・API はモックする（このサンドボックスは外に出られない）。
 *
 * **`getComputedStyle().color` を正規表現で読んではいけない。** Tailwind v4 は
 * `color-mix(in oklab, …)` を出すので、`rgb()` にしか当たらない実装は
 * **半透明の文字を全部飛ばし、「全ページ合格」という嘘の結果**を返す
 * （実際にそれで一度出した）。ここでは既知の下地2色（黒・白）に塗って
 * 読み戻し、alpha と素の色を解く。書式に依存しない。
 *
 * 判定: 普通の文字 4.5:1 / 大きい文字（24px 以上、または 18.66px 以上の太字）3:1。
 * **測れるのは「そのとき描かれている状態」だけ**——ログイン後の画面や、
 * コメントがある写真ページなどは別途その状態を作って測ること。
 */
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import pw from "/home/user/photo-gallery/node_modules/playwright/index.js";
import sharpMod from "/home/user/photo-gallery/node_modules/sharp/dist/index.cjs";
const sharp = sharpMod.default ?? sharpMod;
const OUT="/home/user/photo-gallery/out", PORT=4267;
const MIME={".html":"text/html; charset=utf-8",".js":"application/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".txt":"text/plain",".ico":"image/x-icon",".webmanifest":"application/manifest+json"};
const server=http.createServer((req,res)=>{const u=decodeURIComponent(new URL(req.url,"http://x").pathname);let f=path.join(OUT,u);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){if(fs.existsSync(f+".html"))f=f+".html";else if(fs.existsSync(path.join(f,"index.html")))f=path.join(f,"index.html");}
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{"Content-Type":MIME[path.extname(f)]??"application/octet-stream"});fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(PORT,r));
const jpg=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#334155"/></svg>')).jpeg({quality:60}).toBuffer();
const real = JSON.parse(fs.readFileSync("/home/user/photo-gallery/app/data/photos.json","utf8"));
const browser=await pw.chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});

const AUDIT = () => {
    // **`rgb()` の正規表現では読めない。** Tailwind v4 は `oklab(… / 0.4)` を出す
    // ——最初これで半透明の文字を全部飛ばし、「全部合格」という嘘の結果を出した。
    // 既知の下地2色（黒・白）に塗って読み戻し、alpha と素の色を解く
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const paint = (color, under) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = under; ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
    };
    const parse = (c) => {
        if (!c || c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
        let onBlack, onWhite;
        try { onBlack = paint(c, "#000"); onWhite = paint(c, "#fff"); } catch { return null; }
        // 白地と黒地の差が 255*(1-a)
        const diff = (onWhite[0] - onBlack[0] + onWhite[1] - onBlack[1] + onWhite[2] - onBlack[2]) / 3;
        const a = Math.max(0, Math.min(1, 1 - diff / 255));
        if (a <= 0.001) return { r: 0, g: 0, b: 0, a: 0 };
        return { r: onBlack[0] / a, g: onBlack[1] / a, b: onBlack[2] / a, a };
    };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
    /** 祖先をたどって実際の下地を作る（半透明を重ねる） */
    const bgOf = (el) => {
        let cur = el, stack = [];
        while (cur) { const c = parse(getComputedStyle(cur).backgroundColor); if (c && c.a > 0) stack.push(c); cur = cur.parentElement; }
        let base = { r: 0, g: 0, b: 0, a: 1 };   // 最終的な地は body の黒
        for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
        return base;
    };
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
        // 直接の文字を持つ要素だけ
        const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
        if (!text) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
        if (el.closest(".sr-only, [aria-hidden='true']")) continue;
        const fg = parse(cs.color); if (!fg) continue;
        const bg = bgOf(el);
        const eff = over(fg, bg);
        const c = ratio(eff, bg);
        const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
        // WCAG: 18.66px以上の太字 or 24px以上は「大きい文字」＝3.0、それ以外 4.5
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3.0 : 4.5;
        if (c >= need) continue;
        const key = `${cs.color}|${Math.round(size)}|${text.slice(0, 18)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text: text.slice(0, 24), ratio: Math.round(c * 100) / 100, need, size: Math.round(size), weight, color: cs.color, cls: (el.className || "").toString().slice(0, 60) });
    }
    return out.sort((a, b) => a.ratio - b.ratio);
};

for (const [name, url, prep] of [
    ["ホーム", "/", null],
    ["ログイン", "/login", null],
    ["新規登録", "/signup", null],
    ["写真ページ", `/photo/${real[0].id}`, null],
    ["撮影地マップ", "/map", null],
    ["集約（カテゴリ）", "/category/landscape", null],
    ["プライバシー", "/privacy", null],
]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ja-JP" });
    await page.route(/cloudfront\.net|\/uploads\//, r => r.fulfill({ status:200, contentType:"image/jpeg", body: jpg }));
    await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status:200, contentType:"image/png", body: jpg }));
    await page.route(/\/api\//, r => r.fulfill({ status:404, contentType:"application/json", body:"{}" }));
    await page.route("**/api/photos", r => r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify(real) }));
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    if (prep) await prep(page);
    const bad = await page.evaluate(AUDIT);
    console.log(`\n== ${name} (${url}) == 基準未満 ${bad.length}件`);
    for (const b of bad.slice(0, 12)) console.log(`  ${String(b.ratio).padStart(5)}:1 (要 ${b.need}) ${b.size}px w${b.weight} ${b.color}  「${b.text}」  ${b.cls}`);
    await page.close();
}
await browser.close(); server.close();
