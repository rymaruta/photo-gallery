/**
 * 読み上げでページを辿れるか（見出しの階層・ランドマーク）を**実ブラウザで測る**道具。
 *
 *   node scripts/audit-landmarks.mjs        # out/ を配って主要9画面を測る
 *
 * 先に `npm run build`（または `npx next build`）で `out/` を作っておくこと。
 * 画像・タイル・API はモックする（このサンドボックスは外に出られない）。
 *
 * 見るもの: h1 の数／見出しの飛び（h1 → h3）／`main` の数／名前の無い `<nav>`／
 * `<title>`／`lang`。**測れるのはログインしていない状態の画面だけ**——
 * ログイン後の画面（アップロード・設定・管理）は別途その状態を作ること。
 */
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import pw from "/home/user/photo-gallery/node_modules/playwright/index.js";
import sharpMod from "/home/user/photo-gallery/node_modules/sharp/dist/index.cjs";
const sharp = sharpMod.default ?? sharpMod;
const OUT="/home/user/photo-gallery/out", PORT=4280;
const MIME={".html":"text/html; charset=utf-8",".js":"application/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".txt":"text/plain",".ico":"image/x-icon",".webmanifest":"application/manifest+json"};
const server=http.createServer((req,res)=>{const u=decodeURIComponent(new URL(req.url,"http://x").pathname);let f=path.join(OUT,u);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){if(fs.existsSync(f+".html"))f=f+".html";else if(fs.existsSync(path.join(f,"index.html")))f=path.join(f,"index.html");}
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{"Content-Type":MIME[path.extname(f)]??"application/octet-stream"});fs.createReadStream(f).pipe(res);});
await new Promise(r=>server.listen(PORT,r));
const jpg=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#345"/></svg>')).jpeg().toBuffer();
const real=JSON.parse(fs.readFileSync("/home/user/photo-gallery/app/data/photos.json","utf8"));
const browser=await pw.chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});

const AUDIT = () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        return !(cs.display==="none"||cs.visibility==="hidden") && (r.width>0||r.height>0||el.closest(".sr-only")); };
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis)
        .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent||"").trim().slice(0,32), srOnly: !!h.closest(".sr-only") }));
    const landmarks = ["header","nav","main","footer","aside","form[role=search]"].map((sel) => {
        const els = [...document.querySelectorAll(sel)].filter(vis);
        return { sel, count: els.length, labels: els.map((e) => e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || "") };
    });
    // 見出しの飛び（h1 → h3 など）
    const jumps = [];
    let prev = 0;
    for (const h of headings) { if (prev && h.level > prev + 1) jumps.push(`h${prev} → h${h.level}（${h.text}）`); prev = h.level; }
    return {
        title: document.title,
        lang: document.documentElement.lang,
        h1: headings.filter((h)=>h.level===1).map((h)=>h.text),
        outline: headings.map((h)=>`h${h.level}${h.srOnly?"*":""}:${h.text}`),
        jumps,
        landmarks: landmarks.filter((l)=>l.count>0),
        mainCount: landmarks.find((l)=>l.sel==="main").count,
        skipLink: !!document.querySelector('a[href^="#"]'),
        navsUnlabeled: landmarks.find((l)=>l.sel==="nav").labels.filter((x)=>!x).length,
    };
};

for (const [name, url] of [["ホーム","/"],["写真ページ",`/photo/${real[0].id}`],["撮影地マップ","/map"],
    ["集約（カテゴリ）","/category/landscape"],["利用者のページ",`/users/${real[0].userId}`],
    ["ログイン","/login"],["プライバシー","/privacy"],["お気に入り","/favorites"],["利用者を探す","/users/search"]]) {
    const page=await browser.newPage({viewport:{width:390,height:844},locale:"ja-JP"});
    await page.route(/cloudfront\.net|\/uploads\//,r=>r.fulfill({status:200,contentType:"image/jpeg",body:jpg}));
    await page.route(/tile\.openstreetmap\.org/,r=>r.fulfill({status:200,contentType:"image/png",body:jpg}));
    await page.route(/\/api\//,r=>r.fulfill({status:404,contentType:"application/json",body:"{}"}));
    await page.route("**/api/photos",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(real)}));
    await page.goto(`http://localhost:${PORT}${url}`,{waitUntil:"load"});
    await page.waitForTimeout(2200);
    const a = await page.evaluate(AUDIT);
    console.log(`\n== ${name} (${url})`);
    console.log(`  title: ${a.title.slice(0,60)} / lang: ${a.lang}`);
    console.log(`  h1: ${a.h1.length}件 ${JSON.stringify(a.h1)}`);
    console.log(`  main: ${a.mainCount} / nav の無名: ${a.navsUnlabeled} / 飛び: ${a.jumps.join(", ")||"なし"}`);
    console.log(`  見出し: ${a.outline.join(" | ").slice(0,180)}`);
    await page.close();
}
await browser.close(); server.close();
