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
 * 「自分でサーバーを叩いている」の判定。**`userFetch` を呼ぶかどうかだけ。**
 *
 * ⚠️ **中断の後始末（`AbortController` / `aborted`）を条件に足してはいけない。**
 * 最初は「`userFetch` ＋ `AbortController`」の AND で見ていた。レビューで
 * 「中断をフラグだけで書いた写しが素通りする」と出たので `aborted` を
 * 足したが、**それでも取りこぼした**——develop に入った
 * `useStoryArchive` は競合の番人を**1つも持たない**ので、どちらにも当たらない。
 *
 * だから条件を「自分で `userFetch` を呼ぶ」1つに削った。当たる数は少なく
 * （このフォルダで7件）、**全部に理由を書ける**。取得する新しいフックは
 * 必ずここに当たるので、**免除に理由を書く手が止められる**＝そのとき
 * 「共通部に寄せられないか」を考えることになる。
 */
export function fetchesOwnList(raw: string): boolean {
    return /\buserFetch\s*\(/.test(stripComments(raw));
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
    // **読む側は共通部の包み。** ここに残る `userFetch` は書く側
    // （`toggle` の POST / DELETE）で、一覧の取得はしていない。
    // 写しに戻されたら下の「共通部の包み」のテストが落ちる
    ["useSavedSpots.ts", "読むのは共通部の包み。残る userFetch は書く側だけ"],
    // **ID の一覧ではない。** 返るのは `Story[]`（行そのもの）で、
    // サーバーも `{photoIds: [...]}` ではなく**素の配列**を返す。
    // `useMyPhotoIdList` は「文字列のIDの一覧」を前提にしているので、
    // 包みにするなら共通部の形から変える話になる。
    // **`app/components/stories/**` は別の担当の範囲**でもある
    ["useStoryArchive.ts", "Story の行の一覧（IDの一覧ではない）・素の配列が返る"],
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
        // **中断の番人を1つも持たない写しも捕まえる。** develop の
        // `useStoryArchive` がこの形で、AND の条件では取りこぼしていた
        const copyWithoutAnyGuard = `
            const res = await userFetch("/stories/archive");
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
        expect(fetchesOwnList(copyWithoutAnyGuard),
            "中断の番人を持たない写しを見逃している").toBe(true);
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
