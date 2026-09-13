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

/** そのソースの中で、画像URLが実際にDOMへ渡る場所を全部拾う */
export function imageSinks(raw: string, file: string): Sink[] {
    const src = stripComments(raw);
    const out: Sink[] = [];
    for (const m of src.matchAll(/<(?:img|source|video)\b/g)) {
        const start = m.index ?? 0;
        const end = src.indexOf(">", start);
        const chunk = src.slice(start, end < 0 ? src.length : end + 1);
        for (const a of chunk.matchAll(/\b(?:src|srcSet)=\{([\s\S]*?)\}\s*(?=\n|\/>|>|[a-zA-Z-]+=)/g))
            out.push({ file, expr: a[1].trim().replace(/\s+/g, " ") });
        for (const a of chunk.matchAll(/\b(?:src|srcSet)="([^"]*)"/g))
            out.push({ file, expr: `"${a[1]}"` });
    }
    for (const a of src.matchAll(/\.src\s*=\s*([^\n;]+)/g))
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

    // (c) 同じ部品の中で既に通している（描画で見るテストが対）
    ["app/components/Thumb.tsx", "fallback", "`publicImageUrl(photo.thumbSrc || photo.src)` を入れた変数"],
    ["app/components/Thumb.tsx", "avifSet", "`buildSrcSet` が1本ずつ通している"],
    ["app/components/Thumb.tsx", "webpSet", "`buildSrcSet` が1本ずつ通している"],
    ["app/components/UserAvatar.tsx", "url", "組み立てるところで通している"],
    ["app/user/profile/page.tsx", "currentCoverUrl", "組み立てるところで通している"],
    ["app/user/profile/page.tsx", "currentAvatarUrl", "組み立てるところで通している"],
    ["app/users/UserProfileClient.tsx", "coverUrl", "組み立てるところで通している"],
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

const allSinks = (): Sink[] => {
    const out: Sink[] = [];
    for (const f of walk(nodePath.join(process.cwd(), "app"))) {
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

        it("`https://` の `//` をコメントと読み違えない", () => {
            const withUrl = `const u = "https://example.com/a.jpg";\n<img src={u} alt="" />`;
            expect(imageSinks(withUrl, "x.tsx").map((s) => s.expr)).toEqual(["u"]);
        });
    });
});
