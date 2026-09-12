import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **診断の数え方を自分で狭くして「0件」と報告する**のは、この台帳が
// 一度戒めた形（そのときも同じスクリプト）。今回は
// `REBUILD_FNS` に5つだけ手で並べていて、実際に配線されている8つのうち
// **3つを見落としていた**——トークンを登録して5つにだけ届いた状態でも
// `!!` が消え、「済んだ」と読めてしまう。`savePhoto` は公開時に再ビルドを
// 頼む当のものなので、そこが黙って外れるのがいちばん困る。
const ROOT = join(__dirname, "..", "..");

// **本物を呼ぶ。** 一度ここに同じ読み取りを写して検証していたが、
// それでは**写しが正しいこと**しか確かめられない——本体の
// `part.includes("REBUILD_DISPATCH_TOKEN")` を壊しても3本とも緑だった
// （実測）。壊れると `!!` が1つも出ず、トークンが無いことに気づけなくなる。
// **「複製した規則は静かにずれる」を防ぐために書いたテストの中で、
// まさにそれをやっていた。**
// `requireEnv` は `main()` の中なので、require の副作用は無い。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rebuildFnsFromServerless, reportFunctions, REBUILD_FNS,
    publicFnsFromServerless, PUBLIC_FNS, qualify } = require("../diagnose-aws.js");
const wiredFns = (): string[] => rebuildFnsFromServerless();

describe("診断が見る「トークンを配ってあるべき関数」", () => {
    const src = readFileSync(join(ROOT, "scripts", "diagnose-aws.js"), "utf8");

    // **手で並べない。** 並べると、配線を増やしたときに診断だけが古くなる
    it("一覧を手で書いていない（serverless.yml から読む）", () => {
        expect(src, "手で並べた一覧に戻っている")
            .not.toMatch(/const REBUILD_FNS = \[\s*"/);
        expect(src).toContain("rebuildFnsFromServerless()");
    });

    // **0件を静かに素通ししない。** 読み取りが壊れると `wantToken` が
    // 全関数 false になり、`!!` が1つも出ない＝「全部揃っている」と
    // 同じ絵になる
    it("読み取りが壊れたら 0件になる（＝壊れたことが分かる形）", () => {
        expect(wiredFns().length, "1つも読めていない").toBeGreaterThan(5);
    });

    // **ソースの綴りではなく、出た行を見る。**
    //
    // ここは以前 `expect(src).toContain("再ビルドのトークンを持つ関数")` と
    // 書いていた。文字列が在るかしか見ていないので、**数え方を
    // `REBUILD_FNS.length`（＝全部揃っていると嘘をつく）に変えても
    // 509件すべて緑**だった（レビューが変異で実証）。分母を出した目的は
    // 「0件が『問題なし』なのか『見ていない』なのかを読めるように」なので、
    // 嘘の数が出せる状態では目的を果たしていない。
    // **一覧は `パッケージ:名前`**（`api:presignedUrl` /
    // `api-user:presignedUrl`）。本番で流したら、短い名前で突き合わせて
    // いたせいで**管理API側の同名関数に `!!` が誤爆**していた
    // （`api/serverless.yml` はあの2つにトークンを渡さないのが正しい）。
    // ここも本物の関数名の形に組み立てる
    const fn = (key: string, hasToken: boolean) => {
        const [pkg, short] = key.split(":");
        return {
            FunctionName: pkg === "api"
                ? `photo-gallery-api-prod-${short}`
                : `photo-gallery-user-api-prod-${short}`,
            Role: "arn:aws:iam::1:role/shared",
            Environment: { Variables: hasToken ? { REBUILD_DISPATCH_TOKEN: "x" } : {} },
        };
    };

    it("トークンを持つ関数の数を、実際に数えて出す", () => {
        const wired = wiredFns();
        const lines = reportFunctions([fn(wired[0], true), fn(wired[1], false)]).join("\n");
        expect(lines, "数えずに分母をそのまま出している（全部揃っていると嘘をつく）")
            .toContain(`再ビルドのトークンを持つ関数 1/${REBUILD_FNS.length}`);
        // トークンが無い方には理由付きの `!!` が出る
        expect(lines).toContain("再ビルドのトークンが無い");
    });

    it("1つも持っていなければ 0 と出す", () => {
        const wired = wiredFns();
        const lines = reportFunctions([fn(wired[0], false)]).join("\n");
        expect(lines).toContain(`再ビルドのトークンを持つ関数 0/${REBUILD_FNS.length}`);
    });

    // **配る対象が0件のときは、それ自体を `!!` で言う。**
    //
    // ここは2周続けて綴りを見ていた（`toContain("REBUILD_FNS.length === 0")`
    // → `toMatch(/if \(…\)/)`）。どちらも**分岐の中身を空にすると緑**で、
    // 題名の言う「診断が壊れていると言う」を一度も確かめていなかった。
    // `reportFunctions` が `wanted` を受け取るようにして、実際に0件で呼ぶ
    it("配る対象を1つも読み取れなければ、診断が壊れていると言う", () => {
        const lines = reportFunctions([fn("savePhoto", true)], []).join("\n");
        expect(lines, "0件なのに黙っている").toContain("1つも読み取れなかった");
        expect(lines).toContain("再ビルドのトークンを持つ関数 0/0");
    });

    it("読み取れているときは、その警告を出さない", () => {
        expect(REBUILD_FNS.length, "一覧が空になっている").toBeGreaterThan(5);
        expect(reportFunctions([fn(wiredFns()[0], true)]).join("\n"))
            .not.toContain("1つも読み取れなかった");
    });

    // 読み取りの実装がここと同じ結果を出すこと（両方が同じ規則で読む）
    it("配線されている関数を全部拾う", () => {
        const wired = wiredFns();
        expect(wired.length, "1つも拾えていない（正規表現が壊れている）").toBeGreaterThan(5);
        // 契約（rebuildTokenScope.test.ts）と同じ集合であること
        const contract = readFileSync(join(ROOT, "scripts", "__tests__", "rebuildTokenScope.test.ts"), "utf8");
        for (const key of wired) {
            // 契約は短い名前で書いてある（あちらはパッケージごとの節に分かれる）
            const short = key.split(":")[1];
            expect(contract, `${key} が契約の一覧に無い`).toContain(`"${short}"`);
        }
    });

    // **同じ名前でもパッケージが違えば別の関数。**
    // `api:presignedUrl` はトークンを持たないのが正しく、
    // `api-user:presignedUrl` は持つのが正しい
    it("同名でもパッケージで区別する（管理API側に誤爆しない）", () => {
        const wired = wiredFns();
        expect(wired, "api-user 側が入っていない").toContain("api-user:presignedUrl");
        expect(wired, "管理API側にトークンを期待している（誤爆の元）").not.toContain("api:presignedUrl");
        const lines = reportFunctions([
            { FunctionName: "photo-gallery-api-prod-presignedUrl", Role: "r/shared", Environment: { Variables: {} } },
            { FunctionName: "photo-gallery-user-api-prod-presignedUrl", Role: "r/shared", Environment: { Variables: { REBUILD_DISPATCH_TOKEN: "x" } } },
        ]).join("\n");
        expect(lines, "管理API側に誤爆している").not.toContain("api:presignedUrl                   role=r/shared  !!");
        expect(lines, "行がどちらの関数か読めない").toContain("api:presignedUrl");
        expect(lines).toContain("api-user:presignedUrl");
        expect(lines.split("\n").filter((l: string) => l.includes("!!")), "誤爆している").toEqual([]);
    });

    // **`savePhoto` は落とせない。** 公開したときに静的ページを作って
    // もらう当のもので、トークンが無いと最大7日 世に出ない
    it("savePhoto と presignedUrl / discardUpload を含む", () => {
        const wired = wiredFns();
        for (const fn of ["api-user:savePhoto", "api-user:presignedUrl", "api-user:discardUpload",
            "api:updatePhoto", "api:deletePhoto"]) {
            expect(wired, `${fn} を診断が見ていない`).toContain(fn);
        }
    });
});

/**
 * **読み取り専用ロールの一覧も、手で並べない。**
 *
 * 2026-09-12 に本番で流したら `getInvite` に
 * `!! 読み取り専用ロールが付いている` と出た——**誤報**。
 * `api-user/serverless.yml` はあの関数に正しく `role: PublicReadRole` を
 * 付けている。手書きの7個に、あとから足した1つが入っていなかっただけ。
 * しかも要約は `7/7` と出るので、**「!! が出ているのに問題なし」**という
 * 読めない報告になっていた。
 *
 * **同じスクリプトが一度「手で並べない」と直した隣に、手書きが残っていた**
 * ——台帳の型「片方の入口だけ直して、もう片方を置いてくる」。
 */
describe("診断が見る「読み取り専用ロールの関数」", () => {
    const src = readFileSync(join(ROOT, "scripts", "diagnose-aws.js"), "utf8");

    it("一覧を手で書いていない（serverless.yml から読む）", () => {
        expect(src, "手で並べた一覧に戻っている").not.toMatch(/const PUBLIC_FNS = \[\s*"/);
        expect(src).toContain("publicFnsFromServerless()");
    });

    it("`role: PublicReadRole` を書いた関数を全部拾う", () => {
        const pub = publicFnsFromServerless() as string[];
        expect(pub.length, "1つも拾えていない（正規表現が壊れている）").toBeGreaterThan(5);
        // 本番で誤報の元になった1つ
        expect(pub, "getInvite を見ていない（正しい設定に !! を出す）").toContain("api-user:getInvite");
        // 共有ロールの関数は入らない
        expect(pub, "共有ロールの関数まで拾っている").not.toContain("api-user:likePhoto");
    });

    it("正しく付いている関数に `!!` を出さない", () => {
        const lines = (reportFunctions(
            (PUBLIC_FNS as string[]).map((key: string) => {
                const [pkg, short] = key.split(":");
                return {
                    FunctionName: pkg === "api" ? `photo-gallery-api-prod-${short}` : `photo-gallery-user-api-prod-${short}`,
                    Role: "arn:aws:iam::1:role/x-publicRead",
                    Environment: { Variables: {} },
                };
            }),
        ) as string[]).join("\n");
        expect(lines.split("\n").filter((l: string) => l.includes("!!")), "正しい設定に !! を出している").toEqual([]);
        expect(lines).toContain(`読み取り専用ロールの関数 ${(PUBLIC_FNS as string[]).length}/${(PUBLIC_FNS as string[]).length}`);
    });

    it("共有ロールのままなら `!!` を出す", () => {
        const key = (PUBLIC_FNS as string[])[0];
        const [pkg, short] = key.split(":");
        const lines = (reportFunctions([{
            // **パッケージを取り違えない**（`api:getPhotos` を
            // `api-user` 側の名前で作ると、期待に当たらず何も出ない）
            FunctionName: pkg === "api" ? `photo-gallery-api-prod-${short}` : `photo-gallery-user-api-prod-${short}`,
            Role: "arn:aws:iam::1:role/x-lambdaRole",
            Environment: { Variables: {} },
        }]) as string[]).join("\n");
        expect(lines).toContain("共有ロールのまま");
    });

    // **読み取り専用の側も、パッケージで区別する。**
    // いまは同名の衝突が無いので短い名前で突き合わせても同じ結果になるが、
    // **それはデータがたまたまそうなだけ**——トークン側は
    // `presignedUrl` / `savePhoto` の衝突で実際に誤爆した。
    // 衝突を作って、区別していることを縛る
    it("同名でもパッケージが違えば別（読み取り専用の側）", () => {
        const pub = publicFnsFromServerless() as string[];
        expect(pub, "前提が変わった（api-user:getInvite が無い）").toContain("api-user:getInvite");
        expect(pub, "管理API側にも期待している").not.toContain("api:getInvite");
        const lines = (reportFunctions([{
            // 管理API側の同名関数。共有ロールのままで**正しい**
            FunctionName: "photo-gallery-api-prod-getInvite",
            Role: "arn:aws:iam::1:role/x-lambdaRole",
            Environment: { Variables: {} },
        }], [], pub) as string[]).join("\n");
        expect(lines, "管理API側に「共有ロールのまま」を誤爆している").not.toContain("共有ロールのまま");
        expect(lines).toContain("api:getInvite");
    });

    // **0件を静かに素通ししない**（トークン側と同じ守り）
    it("1つも読めなければ、それ自体を `!!` で言う", () => {
        const lines = (reportFunctions([], [], []) as string[]).join("\n");
        expect(lines).toContain("読み取り専用ロールの関数を1つも読み取れなかった");
    });

    it("関数名からパッケージを切り出す", () => {
        expect(qualify("photo-gallery-user-api-prod-presignedUrl").key).toBe("api-user:presignedUrl");
        expect(qualify("photo-gallery-api-prod-presignedUrl").key).toBe("api:presignedUrl");
        // 形が違うものは触らない（CloudFormation のカスタムリソース等）
        expect(qualify("custom-resource-existing-cup").key).toBe("custom-resource-existing-cup");
    });
});
