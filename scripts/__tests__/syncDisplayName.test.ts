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

    it("USERS_TABLE が無ければ何も引かない", async () => {
        vi.stubEnv("USERS_TABLE", "");
        const input = [photo("p1", "u1", "旧い名前")];
        const out = await freshDisplayNames(ddb, input);
        expect(mockSend).not.toHaveBeenCalled();
        expect(out).toEqual(input);
        vi.stubEnv("USERS_TABLE", "users-test");
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
