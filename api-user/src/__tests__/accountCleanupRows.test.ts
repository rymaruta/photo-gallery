import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * **「利用者ごとの1行」を足したら、退会の掃除にも足す。**
 *
 * このテーブルにソートキーは無いので、利用者ごとの一覧は
 * `xxx#<uid>` という**決定的キーの1行**に持つ（`userList.ts` の判断）。
 * 退会（`account.ts`）はそれを1つずつ名指しで消すが、**その一覧は手書き**で、
 * 新しい入れ物を足したときに誰も突き合わせていなかった。
 *
 * 実際に2つ落ちていた（2026-09-24 に走査して発見）:
 *
 *     trips#<uid>         旅行プラン。**足した当日に置いてきた**
 *                         （題・日付・場所ごとのひとこと＝本人が書いた文章）
 *     closefriends#<uid>  親しい友達。**入れた日から一度も消されていなかった**
 *                         （誰を親しいと決めたか＝`spots#` と同じ行動履歴）
 *
 * どちらも**本人しか読めない行**で、掃除役は居ない——退会したのに
 * テーブルに残り続ける。`follownotify#` を「誰も消さないゴミ」として
 * 消した判断がそのまま当てはまる。
 *
 * ## 数え方
 *
 * **綴りで「消しているか」を探さない。** 消し方は3通りある:
 *
 *   1. `ddbDelete(PHOTOS_TABLE, { id: `xxx#${uid}` })` … 素直な形
 *   2. 鍵を作る関数を通す（`albumsOfUserKey` / `highlightsOfUserKey`）
 *   3. 別のモジュールに任せる（`purgeBlocksFor` が `blocks#` と `blockedby#`）
 *
 * だから**接頭辞の集合**で突き合わせ、2と3は理由つきの免除に置く。
 * 免除は**実在も確かめる**（消えた項目を残すと、同じ名前で足された
 * 新しい行をそこが黙って吸収する——`linkPrefetch.test.ts` と同じ理由）。
 */

const SRC = path.join(__dirname, "..");
const read = (f: string) => readFileSync(path.join(SRC, f), "utf8");

/** コメントを先に落とす。**理由を書くほど綴りが自分の説明に一致する**（台帳の型） */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** `xxx#${uid}` の形で行を作っている接頭辞を、api-user の全ソースから集める */
function rowPrefixesInSource(): Set<string> {
    const out = new Set<string>();
    for (const f of readdirSync(SRC)) {
        if (!f.endsWith(".ts")) continue;
        const code = stripComments(read(f));
        // `trips#${uid}` / `spots#${userId}` / `closefriends#${uid}` …
        //
        // ⚠️ **閉じるバッククォートまで見る。** 見ないと `follow#${target}#${uid}`
        // のような**2段の印**まで拾う——あれは「関係ごと」の行で、掃除の仕方も
        // 別（相手ごとに1つずつ消す）。最初これで2件の誤検知を出した
        for (const m of code.matchAll(/`([a-z][a-z0-9]*)#\$\{\s*(?:uid|userId|ownerId|owner|target)\s*\}`/gi)) {
            out.add(m[1].toLowerCase());
        }
    }
    return out;
}

/** `account.ts` が名指しで消している接頭辞 */
function prefixesDeletedInAccount(): Set<string> {
    const code = stripComments(read("account.ts"));
    const out = new Set<string>();
    for (const m of code.matchAll(/id:\s*`([a-z][a-z0-9]*)#\$\{\s*uid\s*\}`/gi)) out.add(m[1].toLowerCase());
    return out;
}

/**
 * **消しているが、この走査では見えない**もの。理由と、どこで消しているか。
 * 免除に置いた関数が `account.ts` から実際に呼ばれていることも下で見る。
 */
const EXEMPT: Array<[prefix: string, reason: string, calledInAccount: string]> = [
    ["albums", "鍵を作る関数を通す（自分のアルバムを1つずつ消してから一覧も消す）", "albumsOfUserKey"],
    ["highlights", "同上（ハイライト本体を辿ってから一覧も消す）", "highlightsOfUserKey"],
    ["blocks", "`block.ts` の `purgeBlocksFor` が消す（印・一覧の両方）", "purgeBlocksFor"],
    ["blockedby", "同上", "purgeBlocksFor"],
];

/**
 * **消さないと決めたもの。** 消すと他人側と食い違う・掃除役が別に居る、など。
 * ここに置くのは「消し忘れ」ではなく「消さない判断」だけ。
 */
const KEPT: Array<[prefix: string, reason: string]> = [
    ["following", "片付け切れなかった回に残して次に託す（`account.ts` が条件つきで消す）"],
    ["followstats", "`account.ts` が無条件で消している（走査で見えるので免除ではない）"],
];

/**
 * **突き合わせそのもの。** 実ファイルから離して、合成の入力で確かめられる形に。
 *
 * ⚠️ これを関数に出す前は、`exemptNames.has()` を**常に真**にする変異が
 * 素通りした（免除が何でも通る＝見張りが骨抜き）。実データでは
 * `missing` がいま空なので、**壊れた判定と正しい判定が同じ答えを返す**
 * ——`68134035` と同じ立場。だから合成の入力で自己確認する。
 */
export function missingPrefixes(
    inSource: Iterable<string>,
    deleted: ReadonlySet<string>,
    exempt: ReadonlySet<string>,
): string[] {
    return [...inSource].filter((p) => !deleted.has(p) && !exempt.has(p)).sort();
}

/**
 * 一覧（EXEMPT / KEPT）に**もう存在しない行**が残っていないか。
 *
 * ⚠️ これも関数に出す。実データでいま stale が0件なので、
 * **見る行を消しても同じ答え（0件）を返す**——`missingPrefixes` と同じ立場。
 */
export function staleEntries(listed: Iterable<string>, inSource: ReadonlySet<string>): string[] {
    return [...listed].filter((p) => !inSource.has(p)).sort();
}

describe("突き合わせの自己確認（合成の入力）", () => {
    const D = (...x: string[]) => new Set(x);
    it("消してもいない・免除にも無い行を報告する", () => {
        expect(missingPrefixes(["spots", "ghost"], D("spots"), D())).toEqual(["ghost"]);
    });
    it("消している行は報告しない", () => {
        expect(missingPrefixes(["spots"], D("spots"), D())).toEqual([]);
    });
    it("免除に在る行は報告しない", () => {
        expect(missingPrefixes(["albums"], D(), D("albums"))).toEqual([]);
    });
    it("一覧に残った幽霊を報告する", () => {
        expect(staleEntries(["albums", "ghost"], D("albums"))).toEqual(["ghost"]);
        expect(staleEntries(["albums"], D("albums")), "実在するものを幽霊と読んでいる").toEqual([]);
    });
    it("免除が広すぎれば、報告すべき行が隠れる（だから下で集合そのものを見る）", () => {
        const everything = { has: () => true } as unknown as ReadonlySet<string>;
        expect(missingPrefixes(["ghost"], D(), everything),
            "免除が何でも通すと、欠けている行が隠れる").toEqual([]);
    });
});

describe("退会の掃除が、利用者ごとの行を全部見ているか", () => {
    const inSource = rowPrefixesInSource();
    const deleted = prefixesDeletedInAccount();
    const exemptNames = new Set(EXEMPT.map(([p]) => p));

    it("走査が本物のソースを読めている（空振りで緑にならない）", () => {
        expect(inSource.size, "利用者ごとの行が1つも見つからない").toBeGreaterThan(8);
        // 実在が分かっているものを名指しで（語彙が古びたら落ちる）
        for (const p of ["spots", "likes", "saves", "trips", "closefriends", "notifs"]) {
            expect(inSource.has(p), `${p}#<uid> を走査が見落としている`).toBe(true);
        }
        expect(deleted.size, "account.ts が1つも消していないと読めている").toBeGreaterThan(5);
    });

    it("🔴 掃除にも免除にも無い行が1つも無い", () => {
        const missing = missingPrefixes(inSource, deleted, exemptNames);
        expect(missing,
            "利用者ごとの行を足したのに、退会の掃除に足していない。"
            + "`account.ts` で消すか、消さない理由を EXEMPT に書くこと").toEqual([]);
    });

    /**
     * 🔴 **免除の集合そのものを見る。** 上の「欠けている行が0」は、
     * 免除が何でも通す形に壊れると**同じ答え（0件）を返す**ので気づけない
     * （実データでいま欠けが0だから）。知らない名前を必ず断ることを直に見る。
     */
    it("🔴 免除は、知らない名前を通さない", () => {
        expect(exemptNames.has("ghost"), "免除が何でも通している（見張りが骨抜き）").toBe(false);
        expect(exemptNames.has("trips"), "掃除で消している行が免除に入っている").toBe(false);
        // 免除に在るものは通す（空の集合に退化していないこと）
        expect(exemptNames.has("albums")).toBe(true);
        expect(exemptNames.size, "免除が空になっている").toBeGreaterThan(0);
    });

    it("免除の理由に書いた関数が、実際に account.ts から呼ばれている", () => {
        const code = stripComments(read("account.ts"));
        for (const [prefix, , fn] of EXEMPT) {
            expect(code.includes(fn), `${prefix}# の免除が指す ${fn} が account.ts に無い`).toBe(true);
        }
    });

    it("免除・据え置きの一覧に、もう存在しない行が残っていない", () => {
        expect(staleEntries(EXEMPT.map(([p]) => p), inSource),
            "免除に、もうソースに無い行が残っている。外すこと").toEqual([]);
        expect(staleEntries(KEPT.map(([p]) => p), inSource),
            "KEPT に、もうソースに無い行が残っている。外すこと").toEqual([]);
    });

    it("判定器の自己確認（見つける・見逃さない）", () => {
        // コメントの中の綴りは数えない（理由を書くほど自分の説明に一致する）
        const onlyComment = "// ここでは `ghost#${uid}` の話をしているだけ\n";
        expect(stripComments(onlyComment).includes("ghost"), "コメントの綴りを数えている").toBe(false);
        // 素の形は数える
        const one = 'const k = `ghost#${uid}`;';
        const RE = /`([a-z][a-z0-9]*)#\$\{\s*(?:uid|userId|ownerId|owner|target)\s*\}`/;
        expect(RE.test(stripComments(one)), "素の1行を見逃している").toBe(true);
        // **2段の印は数えない**（関係ごとの行で、掃除の仕方が別）
        const marker = 'const k = `ghost#${target}#${uid}`;';
        expect(RE.test(stripComments(marker)), "2段の印を1行として数えている").toBe(false);
    });
});
