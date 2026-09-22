import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * **「自分の一覧をサーバーから引く」処理を4つ目に写させない見張り。**
 *
 * サーバーは `likes#<uid>` / `saves#<uid>` / `spots#<uid>` を**同じ形の1行**
 * （新しい順のリスト＋`rev`）で持ち、書き込みの規則も
 * `api-user/src/userList.ts` 1つに寄せてある。引く側だけ増やすと、
 * 「まだ／聞けなかった／0件」の扱いが1つだけ直って静かにずれる。
 *
 * それを避けて `useMyPhotoIdList` を切り出したのに、**同じ回に書かれた
 * `useSavedSpots` が3つ目の写しとして残っていた**（切り出しに間に合わなかった）。
 * 人の目では見つからなかったので、見張りを置く。
 *
 * ## 最初に書いた形は、何も検証していなかった
 *
 * 「`useMyPhotoIdList` という綴りがファイルにあるか」で見ていたので、
 * **説明のコメントに2回書いてあるだけで緑**になった（import と呼び出しを
 * 丸ごと消しても通る）。`linkPrefetch.test.ts` が
 * 「理由を書くほど、綴りで見る判定は自分の説明に当たる」と書いて
 * `stripComments` を先に通しているのと、同じ穴を踏んだ。
 *
 * だから今は:
 *
 *  - **コメントを落としてから見る**（`stripComments`）
 *  - **`import` 文の形**で見る（`from "./useMyPhotoIdList"`）
 *  - **判定器そのものを検査する**（合成ソースで陽性・陰性を確かめる）
 *  - **免除は「実在して、いま実際に一致する」ものだけ**——一致しなくなった
 *    項目を残すと、あとから同じ名前で足された写しをそこが黙って吸収する
 *  - **`lib/hooks/**` を再帰で歩く**（サブフォルダに置かれた写しも見る）
 */

const HOOKS_DIR = join(process.cwd(), "lib/hooks");

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * 「自分で取得の仕掛けを持っている」の判定。
 *
 * **`userFetch` を呼び、中断の後始末（`AbortController` か `aborted`）を
 * 自分でしている**もの。「`AbortController` ＋ `userFetch`」の AND だけで
 * 見ていた頃は、中断を素のフラグだけで済ませた写しが素通りした
 * （`usePhotos` は `AbortController` だけ・`useFollow` は `userFetch` だけ、
 *  という実例がこのフォルダに既に2つある）。
 */
export function fetchesOwnList(raw: string): boolean {
    const src = stripComments(raw);
    if (!/\buserFetch\s*\(/.test(src)) return false;
    return /new AbortController\s*\(/.test(src) || /\baborted\b/.test(src);
}

/** `lib/hooks/**` を再帰で歩く（サブフォルダの写しも見る・`__tests__` は除く） */
function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "__tests__" || name === "node_modules") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(name)) out.push(relative(HOOKS_DIR, full));
    }
    return out;
}

/**
 * 免除。**「自分の一覧」ではない取得**は共通部に寄せられない。
 *
 * ⚠️ **ここに載せてよいのは、いま実際に判定に一致するファイルだけ。**
 * 一致しなくなった項目は下のテストが落とす——残しておくと、あとから
 * 同じ名前で足された写しをそこが黙って吸収する（`linkPrefetch.test.ts`
 * が同じ理由で同じテストを持っている）。
 */
const EXEMPT: Array<[string, string]> = [
    ["useMyPhotoIdList.ts", "共通部そのもの"],
    ["useComments.ts", "写真ごとのコメント（他人のものも入る・ページ送りがある）"],
    ["usePhotoLikes.ts", "1枚に対する押す口（一覧ではない）"],
    ["usePhotoSave.ts", "1枚に対する押す口（一覧ではない）"],
    ["useFollow.ts", "フォローの状態（一覧ではなく1件の真偽）"],
];

describe("自分の一覧を引く処理は1つだけ", () => {
    const files = walk(HOOKS_DIR);
    const exemptNames = new Set(EXEMPT.map(([f]) => f));

    it("見張りが本物のファイルを読めている（空振りで緑にならない）", () => {
        expect(files.length).toBeGreaterThan(10);
        expect(files).toContain("useMyPhotoIdList.ts");
        expect(files).toContain("useSavedSpots.ts");
    });

    // **判定器そのものを検査する。** 語彙（`userFetch` など）が古びて
    // どのファイルにも一致しなくなると、見張りは黙って緑になる
    it("判定器が、写しを捕まえて・包みを見逃す", () => {
        const copy = `
            const controller = new AbortController();
            const res = await userFetch("/user/spots", { signal: controller.signal });
        `;
        const copyWithoutAbortController = `
            let aborted = false;
            const res = await userFetch("/user/spots");
        `;
        const wrapper = `
            import { useMyPhotoIdList } from "./useMyPhotoIdList";
            return useMyPhotoIdList("/user/saves", "保存した写真の一覧", a, b);
        `;
        const onlyInAComment = `
            // userFetch を new AbortController() で中断する処理は持たない
            return useMyPhotoIdList("/user/spots", "行きたい場所の一覧", a, b, "slugs");
        `;
        expect(fetchesOwnList(copy), "写しを見逃している").toBe(true);
        expect(fetchesOwnList(copyWithoutAbortController),
            "中断をフラグだけで書いた写しを見逃している").toBe(true);
        expect(fetchesOwnList(wrapper), "包みを写し扱いしている").toBe(false);
        expect(fetchesOwnList(onlyInAComment),
            "コメントの文字で判定している").toBe(false);
    });

    it("`useMyPhotoIdList` 以外は取得の仕掛けを持たない", () => {
        const offenders = files.filter((f) =>
            !exemptNames.has(f) && fetchesOwnList(readFileSync(join(HOOKS_DIR, f), "utf-8")));
        expect(offenders,
            "自分の一覧を引く処理を写している。`useMyPhotoIdList` の包みにするか、"
            + "寄せられない理由を EXEMPT に書いて足すこと").toEqual([]);
    });

    // **免除が古くなったら落とす。** 一致しなくなった項目を残しておくと、
    // あとから同じ名前で足された写しをそこが黙って吸収する
    it("免除の項目は全部いま実在して、実際に判定に一致する", () => {
        const stale = EXEMPT
            .filter(([f]) => !files.includes(f)
                || !fetchesOwnList(readFileSync(join(HOOKS_DIR, f), "utf-8")))
            .map(([f]) => f);
        expect(stale,
            "免除に、もう取得の仕掛けを持たない（または存在しない）ファイルが残っている")
            .toEqual([]);
    });

    it("行きたい場所・保存・いいねは共通部の包み", () => {
        for (const f of ["useSavedSpots.ts", "useMySaves.ts", "useMyServerLikes.ts"]) {
            const src = stripComments(readFileSync(join(HOOKS_DIR, f), "utf-8"));
            // **綴りではなく import 文で見る**（説明のコメントで緑にならない）
            expect(src, `${f} が共通部を import していない`)
                .toMatch(/import\s*\{[^}]*\buseMyPhotoIdList\b[^}]*\}\s*from\s*["']\.\/useMyPhotoIdList["']/);
            expect(src, `${f} が共通部を呼んでいない`).toMatch(/\buseMyPhotoIdList\s*\(/);
        }
    });
});
