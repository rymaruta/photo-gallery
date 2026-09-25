import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");

/**
 * 🔴 **画面下に固定したバーが、下部タブバー（`BottomNav`）の裏に入っていないこと。**
 *
 * `BottomNav` は `fixed inset-x-0 bottom-0 z-40`。同じところへ `bottom-0` で
 * 帯を置くと、**あとから描かれたタブバーが覆いかぶさって操作が押せなくなる**。
 * 画面は正しく出るので気づけない——実測（Chromium・`out/` を配信）:
 *
 *     /user/highlights の「保存」の座標をクリック
 *       → 書き込みは1件も飛ばず、タブバーの「マイページ」へ遷移
 *     /user/edit の「削除」の座標をクリック
 *       → 390px では `/`、1280px では `/search` へ遷移
 *
 * **`z-50` で覆い返す形にはしない。** 隠れたタブの5つのボタンが
 * **フォーカスだけ受け取れる**状態になる（WCAG 2.4.11）。
 * `app/user/upload/page.tsx` が同じ不具合を先に直していて、理由まで書いてある:
 * **`--bottom-bar-h` のぶん上へ逃がす**（タブバー自身が実測値を出す）。
 *
 * jsdom は CSS を見ないので、**描いて測る形では捕まえられない**。
 * だから「そう書いてあるか」をソースで見る（`linkPrefetch.test.ts` と同じ形）。
 */

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** 開きタグを最後まで切り出す（`onError={(e) => …}` の `>` で切らない） */
function tagChunk(src: string, start: number): string {
    let depth = 0, quote = "";
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
}

const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of nodeFs.readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const p = nodePath.join(dir, name);
        if (nodeFs.statSync(p).isDirectory()) out.push(...walk(p));
        else if (name.endsWith(".tsx")) out.push(p);
    }
    return out;
};

type Bar = { file: string; chunk: string };

/**
 * 「画面下に固定した帯」を数える。
 *
 * **全画面の板は数えない**——`inset-0` や `top-…` を持つものは画面いっぱいを
 * 覆う板で、タブバーより前（`z-50`）に出すのが正しい姿（`HeaderNav` の
 * メニュー・通知のシート・ビューア）。ここで見たいのは**下に貼る帯**だけ。
 */
export function bottomBars(raw: string, file: string): Bar[] {
    const src = stripComments(raw);
    const out: Bar[] = [];
    for (const m of src.matchAll(/<[a-zA-Z][\w.]*\b/g)) {
        const chunk = tagChunk(src, m.index ?? 0);
        if (!/\bfixed\b/.test(chunk)) continue;
        if (/\binset-0\b/.test(chunk) || /\btop-/.test(chunk)) continue;   // 全画面の板
        const anchored = /\bbottom-0\b/.test(chunk) || /bottom\s*:/.test(chunk);
        if (!anchored) continue;
        out.push({ file, chunk });
    }
    return out;
}

/**
 * タブバーの裏に入らないと分かっているもの。**[ファイル, 理由]**。
 * 理由を書けないものが出たら、それは本当に埋もれている帯。
 */
const EXEMPT: Array<[string, string]> = [
    ["app/components/BottomNav.tsx", "タブバー自身（`--bottom-bar-h` に高さを出す側）"],
    // **一瞬だけ出る板で、タブバーより前（`z-[100]`）。** 入れ物は
    // `pointer-events-none` なので、重なっている間もタブバーは押せる
    // （押せなくなるのはトースト本体の矩形だけ）。**位置は変えない**
    // ——上へ逃がすと、出るたびに下の帯が跳ねて見える
    ["app/components/Toast.tsx", "一瞬だけ出る板・`z-[100]` でタブバーより前・入れ物は pointer-events-none"],
];

const ROOT = process.cwd();
const allBars = (): Bar[] =>
    walk(nodePath.join(ROOT, "app")).flatMap((f) =>
        bottomBars(nodeFs.readFileSync(f, "utf8"), nodePath.relative(ROOT, f).split(nodePath.sep).join("/")));

describe("画面下に固定した帯は、タブバーの上へ逃がす", () => {
    it("見張る対象を拾えている（空回りしていない）", () => {
        expect(allBars().length, "下に貼る帯を1つも拾えていない").toBeGreaterThan(2);
    });

    it("`--bottom-bar-h` を読んでいない帯は、理由を書いた一覧に載っているものだけ", () => {
        const exempt = new Set(EXEMPT.map(([f]) => f));
        const stray = allBars()
            .filter((b) => !b.chunk.includes("--bottom-bar-h"))
            .filter((b) => !exempt.has(b.file))
            .map((b) => `${b.file}  ${b.chunk.replace(/\s+/g, " ").slice(0, 100)}`);
        expect(stray, "タブバーの裏に入る帯がある（`--bottom-bar-h` のぶん上へ逃がすこと）").toEqual([]);
    });

    /**
     * 🔴 **高さを出していない帯は、フッターを覆う。**
     *
     * 帯をタブバーの上へ逃がすと、`body` の下の余白（タブバーのぶん）では
     * 足りず、**フッターの最後の行が帯の裏に入る**（2026-09-22 に実測で
     * 7本とも）。`usePageBarHeight` が `--page-bar-h` に高さを出し、
     * `Footer` がそのぶん空ける。**逃がすのと空けるのは対。**
     */
    it("`--bottom-bar-h` を読む帯は、自分の高さも出している（フッターを覆わない）", () => {
        const exempt = new Set(EXEMPT.map(([f]) => f));
        const files = [...new Set(allBars().filter((b) => !exempt.has(b.file)).map((b) => b.file))];
        expect(files.length, "逃がしている帯を1つも拾えていない").toBeGreaterThan(0);
        /**
         * **地図の上に浮くシートは別物。** ページ幅の帯ではなく、地図の中の
         * カード（`/map`）。しかも**本番では一度も開かない**——座標を持つ
         * 写真が 0/30 なのでピンが出ない（`CLAUDE.md` の実測）。
         * 高さを出させると、開いている間だけフッターが大きく下がる。
         * **座標を持つ写真が本番に出たら、ここは測り直すこと。**
         */
        const SHEETS = new Set([
            "app/map/MapPhotoSheet.tsx",
            // 公式撮影地ガイドのピンを押したときのシート。**同じ性質**
            // （地図の上に浮くカード・ページ幅の帯ではない）。台帳が
            // まだ空なので本番では一度も開かない——スポットを載せたら
            // ここも測り直すこと
            "app/map/MapSpotSheet.tsx",
        ]);
        const silent = files
            .filter((f) => !SHEETS.has(f))
            .filter((f) => !nodeFs.readFileSync(nodePath.join(ROOT, f), "utf8").includes("usePageBarHeight"));
        expect(silent, "高さを出していない帯がある（フッターが覆われる）").toEqual([]);
        // 一覧が古くなったら落とす
        expect([...SHEETS].filter((f) => !files.includes(f)), "シートの一覧に、もう無いものが残っている").toEqual([]);
    });

    // **一覧が古くなったら落とす**（消えた行が、次に足された帯を黙って吸収する）
    it("一覧の項目はいま実在する", () => {
        const present = new Set(allBars().map((b) => b.file));
        expect(EXEMPT.filter(([f]) => !present.has(f)).map(([f]) => f)).toEqual([]);
    });

    it("理由が書いてある", () => {
        expect(EXEMPT.filter(([, why]) => why.trim().length < 5)).toEqual([]);
    });

    // 判定の自己確認（0件の状態では、壊れた検出器と正しい検出器が同じ答えを返す）
    describe("判定の自己確認", () => {
        it("`bottom-0` の帯を見つける", () => {
            const bad = `<div className="fixed inset-x-0 bottom-0 z-40 p-3">x</div>`;
            expect(bottomBars(bad, "x.tsx")).toHaveLength(1);
        });
        it("全画面の板は数えない", () => {
            const panel = `<div className="fixed left-0 right-0 bottom-0 top-[64px] z-50">x</div>`;
            expect(bottomBars(panel, "x.tsx")).toHaveLength(0);
        });
        it("逃がしてある帯は通す", () => {
            const ok = `<div className="fixed inset-x-0 z-50 p-3" style={{ bottom: "var(--bottom-bar-h, env(safe-area-inset-bottom, 0px))" }}>x</div>`;
            const found = bottomBars(ok, "x.tsx");
            expect(found).toHaveLength(1);
            expect(found[0].chunk).toContain("--bottom-bar-h");
        });
    });
});
