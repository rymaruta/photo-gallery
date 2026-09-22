import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");

/**
 * 🔴 **絵だけの操作に、読み上げ用の名前が付いていること。**
 *
 * 中身がアイコン1つだけのリンク・ボタンは、`aria-label` が無いと
 * **名前が空のまま**になる（`<svg>` は読み上げの木に名前を出さない）。
 * 画面は正しく出るので気づけない。実ブラウザで数えて見つけた
 * （`/user/drafts` と `/admin/edit` の「戻る」）。
 *
 * ここは**ソースを読む**側の見張り。描いて測る側は
 * `UserProfileClient.photoName.test.tsx`（サムネが落ちて名前が消える形）で、
 * あちらは「中身が `alt` 任せ」を見る。**別の壊れ方なので両方要る。**
 */

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** 開きタグを最後まで切り出す（`onClick={(e) => …}` の `>` で切らない） */
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

/** 中身がアイコンだけで、名前を持たない操作 */
export function namelessIconControls(raw: string, file: string): string[] {
    const src = stripComments(raw);
    const out: string[] = [];
    for (const m of src.matchAll(/<(Link|button|a)\b/g)) {
        const tag = m[1];
        const chunk = tagChunk(src, m.index ?? 0);
        if (chunk.endsWith("/>")) continue;                       // 中身が無い
        if (/\baria-label[=\s]/.test(chunk) || /\btitle=/.test(chunk)) continue;
        const close = src.indexOf(`</${tag}>`, (m.index ?? 0) + chunk.length);
        if (close < 0) continue;
        const inner = src.slice((m.index ?? 0) + chunk.length, close);
        if (inner.length > 200) continue;                         // 大きい塊は別物
        if (!/<\w*Icon\b|<svg\b/.test(inner)) continue;            // 絵が無い
        /**
         * **中身が「アイコンのタグだけ」のときにだけ挙げる。**
         *
         * 最初 `{…}` の式も落として数えたら、`{locale === "en" ? "Back" : "戻る"}`
         * のように**式の中に文字がある**ものまで13件挙げた（全部が誤報）。
         * 式の中身はここでは解けないので、**何か残っていれば名前が在る側に倒す**
         * ——取りこぼす代わりに誤報を出さない（誤報を出す見張りは、いずれ
         * 一覧で黙らされて何も検証しなくなる）。
         */
        const rest = inner.replace(/<[^>]*>/g, "").trim();
        if (rest.length > 0) continue;
        out.push(`${file}  <${tag}> ${inner.replace(/\s+/g, " ").trim().slice(0, 60)}`);
    }
    return out;
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

const ROOT = process.cwd();
const all = (): string[] =>
    walk(nodePath.join(ROOT, "app")).flatMap((f) =>
        namelessIconControls(nodeFs.readFileSync(f, "utf8"), nodePath.relative(ROOT, f).split(nodePath.sep).join("/")));

describe("絵だけの操作には名前を付ける", () => {
    it("名前の無い絵だけの操作が無い", () => {
        expect(all(), "`aria-label` の無い、アイコンだけのリンク／ボタンがある").toEqual([]);
    });

    // 判定の自己確認（0件の状態では、壊れた検出器と正しい検出器が同じ答えを返す）
    describe("判定の自己確認", () => {
        it("名前の無いものを見つける", () => {
            const bad = `<Link href="/" className="x"><ArrowLeftIcon className="w-5 h-5" /></Link>`;
            expect(namelessIconControls(bad, "x.tsx")).toHaveLength(1);
        });
        it("`aria-label` があれば挙げない", () => {
            const ok = `<Link href="/" aria-label="戻る" className="x"><ArrowLeftIcon className="w-5 h-5" /></Link>`;
            expect(namelessIconControls(ok, "x.tsx")).toEqual([]);
        });
        it("文字が付いていれば挙げない", () => {
            const ok = `<button className="x"><HeartIcon className="w-4 h-4" />いいね</button>`;
            expect(namelessIconControls(ok, "x.tsx")).toEqual([]);
        });
        // 🔴 **式の中の文字も名前**（ここを落として13件の誤報を出した）
        it("式の中に文字があれば挙げない", () => {
            const ok = `<Link href="/" className="x"><ArrowLeftIcon className="w-4 h-4" />{locale === "en" ? "Back" : "戻る"}</Link>`;
            expect(namelessIconControls(ok, "x.tsx")).toEqual([]);
        });
        it("入れ子の span の中身も名前", () => {
            const ok = `<Link href="/" className="x"><Icon aria-hidden="true" /><span style={s}>{label}</span></Link>`;
            expect(namelessIconControls(ok, "x.tsx")).toEqual([]);
        });
        it("絵が無いものは挙げない", () => {
            expect(namelessIconControls(`<button className="x">{n}</button>`, "x.tsx")).toEqual([]);
        });
    });
});
