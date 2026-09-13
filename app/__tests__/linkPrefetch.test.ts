import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");

/**
 * **公開ページのリンクは先読みしない。**
 *
 * Next の `<Link>` は既定で「画面に入ったら先読み」。このサイトは静的書き出しで、
 * `deploy-static-site.js` は HTML も RSC の控え（`.txt`）も
 * **`no-cache, no-store` で配る**（`isHtmlOrTxt`）——**画面に出入りするたびに
 * 行き先を丸ごと落とし直す**。
 *
 * 実測（`out/` を手元に配って1訪問ぶんを数えた。サーバが実際に書いたバイト）:
 *
 *     写真ページ  RSC 50件/117KB ＋ HTML 15件/700KB ＋ JS 25件/1,055KB  → 約1.87MB
 *     同（修正後） RSC **0件**    ＋ HTML  3件/129KB ＋ JS 15件/594KB  → 約0.82MB
 *
 * **検索の着地点で半分以下になる。** 代償は最初のタップが +83ms
 * （`app/components/GalleryGrid.tsx` のコメントに A/B の実測）。
 *
 * ここで見張るのは**公開ページだけ**。管理・編集・下書きなどログインが要る
 * 画面は人数が少なく、先読みの代償より遷移の速さが効くので触っていない。
 */
const PUBLIC_FILES = [
    "app/layout.tsx",
    "app/GalleryPageClient.tsx",
    "app/NotFoundClient.tsx",
    "app/privacy/page.tsx",
    "app/map/page.tsx",
    "app/users/page.tsx",
    "app/users/search/page.tsx",
    "app/users/UserProfileClient.tsx",
    "app/photo/[id]/PhotoPageClient.tsx",
    "app/components/Footer.tsx",
    "app/components/GalleryGrid.tsx",
    "app/components/RelatedPhotos.tsx",
    "app/components/CollectionPageClient.tsx",
    "app/components/ProfileLink.tsx",
    "app/components/CommentSection.tsx",
    "app/components/GalleryModal/ModalCaption.tsx",
];

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** `<Link` から、対応する `>` までを切り出す（`=>` の `>` で切らない） */
export function linkTags(raw: string): string[] {
    const src = stripComments(raw);
    const out: string[] = [];
    for (const m of src.matchAll(/<Link\b/g)) {
        const start = m.index ?? 0;
        let depth = 0, quote = "";
        let end = src.length;
        for (let i = start; i < src.length; i++) {
            const c = src[i];
            if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; continue; }
            if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0) { end = i + 1; break; }
        }
        out.push(src.slice(start, end));
    }
    return out;
};

describe("公開ページのリンクは先読みしない", () => {
    it("対象のファイルは全部 `prefetch={false}`", () => {
        const stray: string[] = [];
        for (const rel of PUBLIC_FILES) {
            const p = nodePath.join(process.cwd(), rel);
            expect(nodeFs.existsSync(p), `一覧のファイルが無い: ${rel}`).toBe(true);
            for (const tag of linkTags(nodeFs.readFileSync(p, "utf8"))) {
                if (!tag.includes("prefetch={false}")) stray.push(`${rel}  ${tag.replace(/\s+/g, " ").slice(0, 60)}`);
            }
        }
        expect(stray, "画面に入るたびに行き先を丸ごと落とし直す").toEqual([]);
    });

    // 判定そのものが効くか（0件の状態では、壊れた検出器と正しい検出器が同じ答えを返す）
    describe("判定の自己確認", () => {
        it("先読みを切っていないリンクを見つける", () => {
            expect(linkTags('<Link href="/x">a</Link>').some((t) => !t.includes("prefetch={false}"))).toBe(true);
            expect(linkTags('<Link href="/x" prefetch={false}>a</Link>').every((t) => t.includes("prefetch={false}"))).toBe(true);
        });

        it("`=>` の `>` でタグを切らない", () => {
            const src = `<Link\n  onClick={(e) => e.preventDefault()}\n  href="/x"\n>a</Link>`;
            expect(linkTags(src)[0], "属性の途中で切れている").toContain('href="/x"');
        });

        it("コメントの中の `<Link>` では発火しない", () => {
            expect(linkTags('{/* 以前は <Link href="/x"> と書いていた */}')).toEqual([]);
        });
    });
});
