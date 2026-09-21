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
/**
 * **一覧を持たない。** 「公開ページの一覧」を手で書いていたが、
 * **その一覧を空にすると全部素通り**した（変異で発覚）。逆にする——
 * `app/**` の `<Link>` を**全部**数え、切っていないものは
 * **下の免除に理由付きで載っていなければ落とす**。
 *
 * 免除するのは**ログインした人しか描かれない画面**だけ。人数が少なく、先読みの代償より
 * 遷移の速さが効く（公開ページは検索から来た人が1枚も開かずに帰ることが
 * あるので、逆）。
 */
const EXEMPT: Array<[string, string]> = [
    ["app/admin/page.tsx", "管理画面（ログインと管理権限が要る）"],
    ["app/admin/edit/page.tsx", "管理の編集画面"],
    ["app/user/albums/page.tsx", "自分のアルバム"],
    ["app/user/drafts/page.tsx", "自分の下書き"],
    ["app/user/archive/page.tsx", "自分のストーリーのアーカイブ（本人だけ）"],
    ["app/user/edit/page.tsx", "自分の写真の編集"],
    ["app/user/profile/page.tsx", "自分のプロフィール設定"],
    ["app/user/settings/page.tsx", "設定（ログインした本人だけが描かれる）"],
    ["app/components/FollowingSheet.tsx", "フォロー一覧のシート（開くのはログイン後）"],
    ["app/components/MemberOnlyNotice.tsx", "投稿権限が無い人への案内"],
    ["app/components/NotificationsBell.tsx", "通知（ログイン中だけ出る）"],
    ["app/components/ProfileSetupBanner.tsx", "プロフィール未設定の案内（ログイン中だけ）"],
    ["app/components/stories/StoryViewer.tsx", "ストーリー（投稿者本人の導線）"],
];

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** `<Link` から、対応する `>` までを切り出す（`=>` の `>` で切らない） */
/**
 * 開きタグと、**引用符の中を潰した写し**を返す。
 *
 * 判定を素の文字列でやっていた間、**自分が踏んだ壊し方をこの見張りが
 * 見逃していた**——機械的な挿入で
 * `` href={`${ROUTES.MAP} prefetch={false}${mapHash}`} `` という形を作り、
 * リンク先が壊れているのに `includes("prefetch={false}")` は真だった
 * （捕まえたのは地図の導線を見る別のテスト）。
 */
export function linkTags(raw: string): Array<{ tag: string; bare: string }> {
    const src = stripComments(raw);
    const out: Array<{ tag: string; bare: string }> = [];
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
        const tag = src.slice(start, end);
        // 引用符・テンプレートリテラルの中身を空白に潰す（属性の値の中に
        // 紛れた `prefetch={false}` を「付いている」と数えないため）
        let bare = "", q = "";
        for (let i = 0; i < tag.length; i++) {
            const c = tag[i];
            if (q) { bare += c === q && tag[i - 1] !== "\\" ? (q = "", c) : " "; continue; }
            if (c === '"' || c === "'" || c === "`") { q = c; bare += c; continue; }
            bare += c;
        }
        out.push({ tag, bare });
    }
    return out;
};

/**
 * 先読みを切っていないリンクか。**判定はこの1つ**——走査側と自己確認側で
 * 別々に書いていた間、走査側だけ引用符を見ない形に戻しても緑のままだった
 * （変異で発覚。`bf3df612`「二重の守りは1本にする」と同じ筋）。
 */
export const missesPrefetch = (t: { bare: string }): boolean => !t.bare.includes("prefetch={false}");

describe("公開ページのリンクは先読みしない", () => {
    const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const name of nodeFs.readdirSync(dir)) {
            if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
            const p = nodePath.join(dir, name);
            if (nodeFs.statSync(p).isDirectory()) out.push(...walk(p));
            else if (/\.tsx$/.test(name)) out.push(p);
        }
        return out;
    };
    const rel = (f: string) => nodePath.relative(process.cwd(), f).split(nodePath.sep).join("/");
    const withLinks = () =>
        walk(nodePath.join(process.cwd(), "app"))
            .map((f: string) => [rel(f), linkTags(nodeFs.readFileSync(f, "utf8"))] as const)
            .filter(([, tags]) => tags.length > 0);

    it("免除に無いファイルの `<Link>` は全部 `prefetch={false}`", () => {
        const exempt = new Set(EXEMPT.map(([f]) => f));
        const stray: string[] = [];
        for (const [f, tags] of withLinks()) {
            if (exempt.has(f)) continue;
            for (const t of tags) {
                if (missesPrefetch(t)) stray.push(`${f}  ${t.tag.replace(/\s+/g, " ").slice(0, 60)}`);
            }
        }
        expect(stray, "画面に入るたびに行き先を丸ごと落とし直す").toEqual([]);
        // 空回りしていないこと（走査が何も拾えていないと、上は必ず通る）
        expect(withLinks().length, "`<Link>` を持つファイルを1つも見つけられていない").toBeGreaterThan(20);
    });

    // **免除が古くなったら落とす。** 消えたファイルを残しておくと、
    // あとから同じ名前で足された画面をそこが黙って吸収する
    it("免除の項目は全部いま実在して、`<Link>` を持っている", () => {
        const present = new Map(withLinks());
        const gone = EXEMPT.filter(([f]) => !present.has(f)).map(([f]) => f);
        expect(gone, "免除に、もう `<Link>` を持たないファイルが残っている").toEqual([]);
        expect(EXEMPT.filter(([, why]) => why.trim().length < 5)).toEqual([]);
    });

    // 判定そのものが効くか（0件の状態では、壊れた検出器と正しい検出器が同じ答えを返す）
    describe("判定の自己確認", () => {
        it("先読みを切っていないリンクを見つける", () => {
            expect(linkTags('<Link href="/x">a</Link>').some(missesPrefetch)).toBe(true);
            expect(linkTags('<Link href="/x" prefetch={false}>a</Link>').some(missesPrefetch)).toBe(false);
        });

        it("`=>` の `>` でタグを切らない", () => {
            const src = `<Link\n  onClick={(e) => e.preventDefault()}\n  href="/x"\n>a</Link>`;
            expect(linkTags(src)[0].tag, "属性の途中で切れている").toContain('href="/x"');
        });

        // **自分が踏んだ壊し方。** 属性の値の中に紛れた `prefetch={false}` を
        // 「付いている」と数えてはいけない
        it("href の中に紛れた `prefetch={false}` は数えない", () => {
            const broken = "<Link href={`${ROUTES.MAP} prefetch={false}${mapHash}`} className=\"x\">a</Link>";
            expect(linkTags(broken).some(missesPrefetch),
                "リンク先が壊れているのに「付いている」と読んでいる").toBe(true);
        });

        it("コメントの中の `<Link>` では発火しない", () => {
            expect(linkTags('{/* 以前は <Link href="/x"> と書いていた */}')).toEqual([]);
        });
    });
});
