import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **改名しても、写真に焼かれた表示名が永久に古いままだった。**
//
// `upload.ts` は投稿時に表示名を写真の行へ焼く。改名は users テーブルの1行
// しか触らず、写真の行を書き換える経路はどこにも無い。**このスクリプトも
// users を見ていなかった**ので、何度ビルドしても旧名が焼き直されていた。
//
// **Lambda 側で直すのはやめた。** 一度 `updateMyProfile` から写真の行を
// 書き直す形にして、レビュー2周で回帰を8件出している（6秒のタイムアウトは
// try/catch で捕まえられない／ページングのカーソル／ストーリーまで書き換える／
// 「同じ名前で保存し直せばやり直せる」は画面が差分ゼロで API を呼ばないので
// 不可能、など）。ここには書き込み経路が無く、冪等で、失敗しても同期は続く。

const mockSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class { } }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    ScanCommand: class { constructor(public input: unknown) { } },
    UpdateCommand: class { constructor(public input: unknown) { } },
    GetCommand: class { constructor(public input: unknown) { } },
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("USERS_TABLE", "users-test");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod: any = await import("../sync-photos-from-ddb.js");
const freshDisplayNames = mod.freshDisplayNames ?? mod.default?.freshDisplayNames;

const ddb = { send: mockSend };
const photo = (id: string, userId: string, displayName?: string) =>
    ({ id, userId, src: `https://cdn/${id}.jpg`, ...(displayName ? { displayName } : {}) });

beforeEach(() => { mockSend.mockReset(); });

describe("ビルド時に、写真の表示名を users テーブルの今の値へ揃える", () => {
    it("改名後の名前に置き換える", async () => {
        mockSend.mockResolvedValue({ Item: { displayName: "新しい名前" } });
        const out = await freshDisplayNames(ddb, [photo("p1", "u1", "旧い名前")]);
        expect(out[0].displayName, "古い名前のまま焼いている").toBe("新しい名前");
    });

    // **投稿者ごとに1回だけ引く。** 写真の枚数ぶん引くと、30枚で30回になる
    it("投稿者ごとに1回だけ引く", async () => {
        mockSend.mockResolvedValue({ Item: { displayName: "名前" } });
        await freshDisplayNames(ddb, [photo("p1", "u1"), photo("p2", "u1"), photo("p3", "u2")]);
        expect(mockSend, "写真の枚数ぶん引いている").toHaveBeenCalledTimes(2);
    });

    it("名前を消した人は、写真からも属性ごと外す", async () => {
        mockSend.mockResolvedValue({ Item: {} });
        const out = await freshDisplayNames(ddb, [photo("p1", "u1", "旧い名前")]);
        expect(out[0], "空文字を焼くと『名前を持っている人』として扱われる")
            .not.toHaveProperty("displayName");
    });

    // 退会した人の名前は入れ直さない（消す判断は退会処理と読み出し側が持つ）
    it("退会した人の行は触らない", async () => {
        mockSend.mockResolvedValue({ Item: { displayName: "x", deletedAt: "2026-01-01" } });
        const out = await freshDisplayNames(ddb, [photo("p1", "u1", "そのまま")]);
        expect(out[0].displayName).toBe("そのまま");
    });

    // **モックは何を渡しても同じ Item を返す。** だから「退会した人は触らない」
    // のような分岐のテストは、その分岐に値を供給する取得が正しいかを
    // 一切見ていない（実測: TableName を写真テーブルに、Key を別名に、
    // 射影から deletedAt を落とす——3つとも変異させて全部緑だった）。
    // 本番では ValidationException か、静かに守りが消えるかになる。
    it("引く先が users テーブル・キーは userId・射影に deletedAt を含む", async () => {
        mockSend.mockResolvedValue({ Item: { displayName: "名前" } });
        await freshDisplayNames(ddb, [photo("p1", "u1")]);
        const input = mockSend.mock.calls[0][0].input;
        expect(input.TableName, "写真テーブルを引いている（ValidationException になる）")
            .toBe("users-test");
        expect(input.Key, "キー名が違うと黙って何も起きない").toEqual({ userId: "u1" });
        expect(input.ProjectionExpression, "deletedAt を射影に載せないと、実 DynamoDB では返らない＝退会した人の守りが消える")
            .toContain("deletedAt");
        expect(input.ProjectionExpression, "displayName を射影に載せていない")
            .toContain("displayName");
    });

    it("users に行が無ければ触らない", async () => {
        mockSend.mockResolvedValue({});
        const out = await freshDisplayNames(ddb, [photo("p1", "u1", "そのまま")]);
        expect(out[0].displayName).toBe("そのまま");
    });

    // **写真の同期そのものは止めない。** ここで落とすとビルドごと止まり、
    // 消した写真のページが残る方に倒れる
    it("引けなくても写真はそのまま返す", async () => {
        mockSend.mockRejectedValue(new Error("throughput exceeded"));
        const input = [photo("p1", "u1", "旧い名前")];
        const out = await freshDisplayNames(ddb, input);
        expect(out).toEqual(input);
    });

    it("USERS_TABLE が無ければ何も引かない（ローカル）", async () => {
        vi.stubEnv("USERS_TABLE", "");
        vi.stubEnv("CI", "");
        const input = [photo("p1", "u1", "旧い名前")];
        const out = await freshDisplayNames(ddb, input);
        expect(mockSend).not.toHaveBeenCalled();
        expect(out).toEqual(input);
        vi.stubEnv("USERS_TABLE", "users-test");
    });

    // **CI では止める。** ワークフローの env に足し忘れても、警告1行で
    // 素通りしてビルドは緑になり、旧名が焼き直される（実際にこの形で
    // 1周落とした）。設定ミスは「静かに効かない」ではなく「動かない」へ。
    it("USERS_TABLE が無いまま CI で走ったら止める", async () => {
        vi.stubEnv("USERS_TABLE", "");
        vi.stubEnv("CI", "1");
        const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        try {
            await freshDisplayNames(ddb, [photo("p1", "u1", "旧い名前")]);
            expect(exit, "警告だけで素通りしている（渡し忘れに気づけない）")
                .toHaveBeenCalledWith(1);
        } finally {
            exit.mockRestore();
            vi.stubEnv("USERS_TABLE", "users-test");
            vi.stubEnv("CI", "");
        }
    });

    it("投稿者が居ない（写真0件）でも壊れない", async () => {
        expect(await freshDisplayNames(ddb, [])).toEqual([]);
        expect(mockSend).not.toHaveBeenCalled();
    });
});

// **関数を書いただけでは効かない。** `main()` から呼んでいなければ
// `photos.json` は今までどおり古い名前のまま——単体テストは全部緑になる
// （実際、呼び出しを消す変異が緑のまま通った）。配線そのものを見る。
describe("同期の本体から呼ばれている", () => {
    const src = readFileSync(join(__dirname, "..", "sync-photos-from-ddb.js"), "utf8")
        .replace(/^\s*\/\/.*$/gm, "");

    it("main() が突き合わせを呼ぶ", () => {
        const main = src.slice(src.indexOf("async function main()"));
        expect(main, "main から呼んでいない（写真は古い名前のまま書かれる）")
            .toMatch(/photos\s*=\s*await freshDisplayNames\(/);
    });

    // **書き出しより前**でなければ意味が無い（件数の安全確認も、
    // 置き換えたあとの姿で通す）
    it("ファイルに書く前に呼ぶ", () => {
        const main = src.slice(src.indexOf("async function main()"));
        const at = main.indexOf("await freshDisplayNames(");
        const write = main.search(/writeFileSync|checkWriteSafety\(/);
        expect(at, "呼び出しが無い").toBeGreaterThan(-1);
        expect(write, "書き出しが見つからない").toBeGreaterThan(-1);
        expect(at, "書き出したあとに置き換えている").toBeLessThan(write);
    });
});

// **ここが実際に切れていた。** 関数も配線も単体では緑なのに、
// `Deploy Site` のワークフローが `USERS_TABLE` を渡していなかったので、
// 本番・staging のビルドでは1行も効いていなかった（スクリプトは警告1行で
// 素通りし、ビルドは緑、旧名が焼き直される）。台帳の「関数は書いたが
// 配線していない」の5回目。**ワークフロー側の配線も固定する。**
describe("Deploy Site が users テーブル名をビルドへ渡す", () => {
    const wf = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "deploy.yml"), "utf8");

    it("config が usersTable を出力する", () => {
        const outputs = wf.slice(wf.indexOf("    outputs:"), wf.indexOf("    steps:"));
        expect(outputs, "config の outputs に usersTable が無い").toMatch(/usersTable:\s*\$\{\{\s*steps\.pick\.outputs\.usersTable\s*\}\}/);
    });

    it.each([
        ["main", "prod-photo-gallery-users"],
        ["develop", "staging-photo-gallery-users"],
    ])("%s の環境で %s を選ぶ", (_branch, table) => {
        expect(wf, `${table} を選んでいない`).toContain(`usersTable=${table}`);
    });

    // 空のまま進むと、下の Build には空文字が渡る。config で止める側にも要る
    it("空なら config で止める", () => {
        const loop = /for k in ([^;]+); do/.exec(wf.slice(wf.indexOf("  config:")));
        expect(loop, "必須の一覧が読めない").not.toBeNull();
        expect(loop![1], "usersTable が必須の一覧に無い（空のままビルドへ渡る）")
            .toContain("usersTable");
    });

    it("Build ステップの env に USERS_TABLE がある", () => {
        const build = wf.slice(wf.indexOf("      - name: Build"));
        const step = build.slice(0, build.indexOf("\n      - name:", 1));
        expect(step, "Build に USERS_TABLE を渡していない（表示名の更新が丸ごと飛ぶ）")
            .toMatch(/USERS_TABLE:\s*\$\{\{\s*needs\.config\.outputs\.usersTable\s*\}\}/);
    });
});
