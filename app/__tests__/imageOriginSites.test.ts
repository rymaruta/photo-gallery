import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");

/**
 * **画面に描く画像URLの入口を数える。**
 *
 * `publicImageUrl`（`lib/utils/seo.ts`）は「出すURLをサイトのドメインに
 * 揃える」規則だが、**通し忘れても画面は正しく出る**（どちらのホストでも
 * 同じ写真が返る）ので、抜けても誰も気づかない。実際、og:image・
 * 画像サイトマップ・JSON-LD には通してあったのに、**画面に描く `<img>` は
 * 30枚中11枚が CloudFront の既定ドメインのまま**だった。
 *
 * だから**綴りで「通してあるか」を探すのをやめ、逆にする**——
 * `<img>` / `<source>` / `<video>` に渡す `src`・`srcSet` と `.src =` の
 * 代入を**全部数え上げ**、`publicImageUrl` を通していないものは
 * **下の一覧に理由付きで載っていなければ落とす**。
 * （台帳の型「判定は『禁止』ではなく『許可』へ反転する」。コントラストの
 *   監査と同じ形で、**一覧の項目が実在することも見る**——消えた行が
 *   一覧に残り続けると、次に足された入口をそこが吸収してしまう）
 */

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
export const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

type Sink = { file: string; expr: string };

/**
 * 開きタグを**最後まで**切り出す。
 *
 * **「最初の `>` まで」では足りない。** `onError={(e) => …}` の `=>` に
 * `>` が入っているので、`src` がその後ろにあるタグを**丸ごと見落とす**
 * （レビューが実演: `<img onError={…} src={p.thumbSrc || p.src}>` を
 *  生に戻しても全部緑だった）。このリポジトリの `<img>` は `onError` を
 * 持つものが多く、**属性を並べ替えるだけで守りが消える**形だった。
 * 波括弧の深さと引用符を見て、外側の `>` で切る。
 */
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

/** `{` から対応する `}` までの中身（引用符の中の括弧は数えない） */
function braced(src: string, open: number): string | null {
    let depth = 0, quote = "";
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    return null;
}

/**
 * そのソースの中で、画像URLが実際にDOMへ渡る場所を全部拾う。
 * `<Image>`（next/image）も数える——大文字のタグだけ外すと、そこが穴になる。
 */
export function imageSinks(raw: string, file: string): Sink[] {
    const src = stripComments(raw);
    const out: Sink[] = [];
    for (const m of src.matchAll(/<(?:img|source|video|Image)\b/g)) {
        const chunk = tagChunk(src, m.index ?? 0);
        // `src={…}` の中身は**波括弧の対応で切る**。「最初の `}` まで」だと
        // `` {`${CLOUDFRONT_URL}/profiles/${id}`} `` で途中で切れ、逆に
        // 後ろの形（`/>`・改行・次の属性）を要求すると、真偽値の属性
        // （`<Image src={…} fill />`）の前で見落とす
        for (const a of chunk.matchAll(/\b(?:src|srcSet)=\{/g)) {
            const expr = braced(chunk, (a.index ?? 0) + a[0].length - 1);
            if (expr !== null) out.push({ file, expr: expr.trim().replace(/\s+/g, " ") });
        }
        for (const a of chunk.matchAll(/\b(?:src|srcSet)="([^"]*)"/g))
            out.push({ file, expr: `"${a[1]}"` });
    }
    // `img.src = …` の代入。**`===` を拾わない**（`typeof s.src === "string"` が
    // 「代入」に見えていた）
    for (const a of src.matchAll(/\.src\s*=(?!=)\s*([^\n;]+)/g))
        out.push({ file, expr: a[1].trim() });
    // 配信URLを自分で組み立てているところ（アバター・カバー）。
    // 変数に入れてから `<img>` に渡すので、上の3つでは追えない
    for (const a of src.matchAll(/^.*\$\{CLOUDFRONT_URL\}.*$/gm))
        out.push({ file, expr: a[0].trim().replace(/\s+/g, " ") });
    return out;
}

/**
 * `publicImageUrl` を通さなくてよいもの。**[ファイル, 式, 理由]**。
 *
 * 分かれるのは3種類:
 *   (a) **自分の配信ではない**——曲のアートワークや試聴（別のところから来る。
 *       揃えにいくと壊れる。あちらには許可リストという別の守りがある）
 *   (b) **端末の中にしか無い**——`data:` / `blob:`（選んだ直後のプレビュー）
 *   (c) **同じ部品の中で既に通している**——変数に入れてから渡している形。
 *       ここは綴りでは追えないので、**描画で見るテスト**が対になっている
 *       （`app/components/__tests__/imageOrigin.test.tsx`）
 */
const EXEMPT: Array<[string, string, string]> = [
    // (a) 自分の配信ではない
    ["app/components/MiniPlayer.tsx", "artwork", "曲のアートワーク（`safeSongArtworkUrl` を通した別オリジン）"],
    ["app/components/MusicCard.tsx", "artwork", "曲のアートワーク（MiniPlayer と同じ値）"],
    ["app/components/SongArtwork.tsx", "safe", "曲のアートワーク専用の部品（許可リストを通した値）"],
    ["app/components/stories/StoriesBar.tsx", "song.previewUrl", "曲の試聴（iTunes の音源）"],
    ["app/user/profile/page.tsx", "song.previewUrl", "曲の試聴（iTunes の音源・プロフィールの一覧）"],

    // (b) 端末の中にしか無い
    ["app/components/Thumb.tsx", "photo.blurDataURL", "ぼかしは data: URI"],
    ["app/photo/[id]/PhotoPageClient.tsx", "blurDataURL", "ぼかしは data: URI"],
    ["app/components/stories/StoriesBar.tsx", "draft.previewUrl", "下書きの blob: URL（まだ上げていない）"],
    ["app/components/stories/StoriesBar.tsx", "url", "長さを測るための blob: URL"],
    ["app/user/profile/page.tsx", "coverPreview", "選んだ直後の data: URL"],
    ["app/user/profile/page.tsx", "avatarPreview", "選んだ直後の data: URL"],
    ["app/user/upload/page.tsx", "avatarPreview", "選んだ直後の data: URL"],
    ["app/user/upload/page.tsx", "src", "切り抜きプレビュー（blob: URL を受け取る部品）"],
    ["app/users/UserProfileClient.tsx", "qrDataUrl", "QRコードは data: URL"],
    ["lib/utils/image.ts", "url", "圧縮の前に読む `URL.createObjectURL(file)`（端末の中だけ）"],

    // (c) 同じ部品の中で既に通している（描画で見るテストが対）
    ["app/components/Thumb.tsx", "fallback", "`publicImageUrl(photo.thumbSrc || photo.src)` を入れた変数"],
    ["app/components/Thumb.tsx", "avifSet", "`buildSrcSet` が1本ずつ通している"],
    ["app/components/Thumb.tsx", "webpSet", "`buildSrcSet` が1本ずつ通している"],
    ["app/components/UserAvatar.tsx", "url", "組み立てるところで通している"],
    ["app/user/profile/page.tsx", "currentCoverUrl", "組み立てるところで通している"],
    ["app/user/profile/page.tsx", "currentAvatarUrl", "組み立てるところで通している"],
    ["app/users/UserProfileClient.tsx", "coverUrl", "組み立てるところで通している"],
    ["lib/hooks/useImagePreloader.ts", "url", "`preloadImage` の入口で通している（`useImagePreloader.test.ts` が描画側で見る）"],
];

const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of nodeFs.readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const p = nodePath.join(dir, name);
        if (nodeFs.statSync(p).isDirectory()) out.push(...walk(p));
        else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
};

/**
 * **`lib/` も走査する。** 最初は `app/` だけ見ていて、
 * `lib/hooks/useImagePreloader.ts` の `img.src = src`（先読み）を
 * 取りこぼした——画面に出す側だけ揃えた結果、**同じ写真を2つのURLで
 * 落とす**状態を作っていた（レビューが実測）。入口は部品の外にもある。
 */
const ROOTS = ["app", "lib"];

const allSinks = (): Sink[] => {
    const out: Sink[] = [];
    for (const f of ROOTS.flatMap((r) => walk(nodePath.join(process.cwd(), r)))) {
        const rel = nodePath.relative(process.cwd(), f).split(nodePath.sep).join("/");
        out.push(...imageSinks(nodeFs.readFileSync(f, "utf8"), rel));
    }
    return out;
};

describe("画面に描く画像URLは、サイトのドメインに揃える", () => {
    const exempt = new Set(EXEMPT.map(([f, e]) => `${f}::${e}`));

    it("`publicImageUrl` を通していない入口は、一覧に載っているものだけ", () => {
        const stray = allSinks()
            .filter((s) => !s.expr.includes("publicImageUrl"))
            .filter((s) => !exempt.has(`${s.file}::${s.expr}`))
            .map((s) => `${s.file}  ${s.expr}`);
        expect(stray, "画像URLを生のまま描いている場所がある（通すか、理由を付けて一覧へ）").toEqual([]);
    });

    // **一覧が古くなったら落とす。** 消えた行を一覧に残しておくと、
    // あとから同じ式で足された入口をそこが黙って吸収する
    it("一覧の項目は全部いま実在する", () => {
        const present = new Set(allSinks().map((s) => `${s.file}::${s.expr}`));
        const gone = EXEMPT.filter(([f, e]) => !present.has(`${f}::${e}`)).map(([f, e]) => `${f}  ${e}`);
        expect(gone, "一覧に、もう無い場所が残っている").toEqual([]);
    });

    it("理由が書いてある", () => {
        expect(EXEMPT.filter(([, , why]) => why.trim().length < 5)).toEqual([]);
    });

    // 判定そのものが効くか。0件の状態では、壊れた検出器と正しい検出器が
    // 同じ答えを返す（台帳の型・コントラスト監査が同じ自己確認を持っている）
    describe("判定の自己確認", () => {
        it("生のまま渡している形を見つける", () => {
            const bad = `<img src={photo.thumbSrc || photo.src} alt="" />`;
            expect(imageSinks(bad, "x.tsx").map((s) => s.expr)).toEqual(["photo.thumbSrc || photo.src"]);
        });

        it("通してある形は挙げない", () => {
            const good = `<img src={publicImageUrl(photo.src)} alt="" />`;
            expect(imageSinks(good, "x.tsx").filter((s) => !s.expr.includes("publicImageUrl"))).toEqual([]);
        });

        it("`<source srcset>` と `img.src =` の代入も数える", () => {
            const src = `<source type="image/avif" srcSet={p.srcAvif} />\nconst img = new Image();\nimg.src = next.src;`;
            expect(imageSinks(src, "x.tsx").map((s) => s.expr).sort()).toEqual(["next.src", "p.srcAvif"]);
        });

        it("コメントの中の `<img src={x}>` では発火しない", () => {
            const commented = `{/* 以前は <img src={photo.src} /> と書いていた */}\n// <img src={photo.src} />\n<img src={publicImageUrl(photo.src)} alt="" />`;
            expect(imageSinks(commented, "x.tsx").filter((s) => !s.expr.includes("publicImageUrl"))).toEqual([]);
        });

        it("配信URLの組み立ても数える（変数に入れてから渡す形）", () => {
            const build = 'const u = CLOUDFRONT_URL ? `${CLOUDFRONT_URL}/profiles/${id}` : "";';
            expect(imageSinks(build, "x.tsx").map((s) => s.expr)).toEqual([build]);
            const wrapped = 'const u = publicImageUrl(`${CLOUDFRONT_URL}/profiles/${id}`);';
            expect(imageSinks(wrapped, "x.tsx").filter((s) => !s.expr.includes("publicImageUrl"))).toEqual([]);
        });

        // **`=>` の `>` でタグを切らない。** ここが「最初の `>` まで」だった間、
        // `onError` を先に書いた `<img>` が**丸ごと見落とされていた**
        // （このリポジトリの `<img>` はほとんどが `onError` を持つ）
        it("`onError={(e) => …}` の後ろにある src も数える", () => {
            const src = `<img\n  onError={(e) => { e.currentTarget.style.opacity = "0"; }}\n  src={p.thumbSrc || p.src}\n/>`;
            expect(imageSinks(src, "x.tsx").map((s) => s.expr)).toEqual(["p.thumbSrc || p.src"]);
        });

        it("next/image の `<Image>` も数える", () => {
            const src = `<Image src={photo.thumbSrc ?? photo.src} fill />`;
            expect(imageSinks(src, "x.tsx").map((s) => s.expr)).toEqual(["photo.thumbSrc ?? photo.src"]);
        });

        // `typeof s.src === "string"` を「代入」と読んでいた（`lib/` を
        // 走査対象に足した日に、実在しない入口として1件出た）
        it("`.src ===` の比較は代入と読まない", () => {
            const src = `if (typeof s.src === "string" && s.src) return s.src;`;
            expect(imageSinks(src, "x.tsx")).toEqual([]);
        });

        // 中身は**波括弧の対応**で切る（「最初の `}`」だと途中で切れる）
        it("入れ子の波括弧・テンプレートリテラルでも、式を最後まで取る", () => {
            const nested = `<img src={makeUrl({ id: 1 })} alt="" />`;
            expect(imageSinks(nested, "x.tsx").map((s) => s.expr)).toEqual(["makeUrl({ id: 1 })"]);
            const tpl = "<img src={`${CLOUDFRONT_URL}/profiles/${id}`} alt=\"\" />";
            expect(imageSinks(tpl, "x.tsx").map((s) => s.expr)).toContain("`${CLOUDFRONT_URL}/profiles/${id}`");
        });

        it("`https://` の `//` をコメントと読み違えない", () => {
            const withUrl = `const u = "https://example.com/a.jpg";\n<img src={u} alt="" />`;
            expect(imageSinks(withUrl, "x.tsx").map((s) => s.expr)).toEqual(["u"]);
        });
    });
});
