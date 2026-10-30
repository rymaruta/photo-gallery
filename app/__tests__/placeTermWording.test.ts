import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * **場所の呼び名をそろえる**（2026-10-11 owner 承認・iOS の `PlaceTermWordingTests` と同じ決まり）。
 *
 * - 公式の頁・一覧（`/spots`）→「撮影スポット」（狭いチップ・タブだけ「スポット」）
 * - 写真が撮られた所・写真から導く頁（`/location`）→「撮影地」
 * - 保存の機能 →「行きたい場所」
 *
 * 「撮影地ガイド」「注目スポット」「この場所」「ガイドを見る」「このスポット」は画面の言葉に使わない。
 * 2026-10-30（束 0a）: マップの PC の一覧に「公式撮影地ガイド」と出ていた。
 *
 * 注記（コメント）は見ない。免除は検索の説明文（`spotPageMeta.ts`）だけ——
 * 画面ではなく検索結果に出る文で、「撮影地ガイド」は検索語として残す（「撮りどき」と同じ扱い・2026-10-22 owner）
 */
const ROOT = process.cwd();
const REMOVED = ["撮影地ガイド", "注目スポット", "この場所", "ガイドを見る", "このスポット", "スポットのガイド"];
const EXEMPT_FILES = new Set(["lib/data/spotPageMeta.ts"]);

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
}

/** 注記を空白に置き換える（行の番号は保つ）。`https://` の `//` は文字列の中なので、`:` の直後は注記と見ない */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("場所の呼び名（画面の言葉）", () => {
    it("使わないと決めた呼び名が画面の言葉に無い", () => {
        const bad: string[] = [];
        for (const abs of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
            const rel = relative(ROOT, abs).split("\\").join("/");
            if (EXEMPT_FILES.has(rel)) continue;
            stripComments(readFileSync(abs, "utf8")).split("\n").forEach((line, i) => {
                const hit = REMOVED.find((w) => line.includes(w));
                if (hit) bad.push(`${rel}:${i + 1} 「${hit}」 ${line.trim().slice(0, 80)}`);
            });
        }
        expect(bad).toEqual([]);
    });

    it("マップの一覧・地図の札・クイズは公式の頁を「撮影スポット」と呼ぶ", () => {
        expect(readFileSync(join(ROOT, "app/map/MapSpotList.tsx"), "utf8")).toContain('"撮影スポット"');
        for (const f of ["app/map/MapSpotSheet.tsx", "app/q/DailyQuizClient.tsx", "app/components/SpotLinkCard.tsx"]) {
            expect(readFileSync(join(ROOT, f), "utf8")).toContain('"撮影スポットを見る"');
        }
    });

    it("写真から導く頁（/location）は「撮影地」と呼ぶ", () => {
        const src = readFileSync(join(ROOT, "app/components/SpotPageClient.tsx"), "utf8");
        expect(src).toContain('"この撮影地の写真"');
        expect(readFileSync(join(ROOT, "app/map/MapPhotoSheet.tsx"), "utf8")).toContain('"撮影地を見る"');
    });

    it("免除の文書が実在する（古くなった免除を残さない）", () => {
        for (const f of EXEMPT_FILES) expect(readFileSync(join(ROOT, f), "utf8")).toContain("撮影地ガイド");
    });
});
