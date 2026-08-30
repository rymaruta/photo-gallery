import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkWriteSafety } = require("../sync-photos-from-ddb.js");

// photos.json を上書きすると、次のビルドで生成されるページがそのまま変わる。
// 減った分のページは deploy-static-site.js が S3 から削除する（HTML は猶予なし）。
// つまり「取得できた件数が急に減った」を通すと、公開中のページが消える。
describe("checkWriteSafety", () => {
    it("0件の書き込みは拒否する（テーブル違い・権限欠けの典型）", () => {
        expect(checkWriteSafety(0, 30).ok).toBe(false);
    });

    it("既存が無ければ（初回）通す", () => {
        expect(checkWriteSafety(30, null).ok).toBe(true);
        expect(checkWriteSafety(30, 0).ok).toBe(true);
    });

    it("半分未満に減る書き込みは拒否する", () => {
        expect(checkWriteSafety(14, 30).ok).toBe(false);
        expect(checkWriteSafety(1, 30).ok).toBe(false);
    });

    it("半分ちょうどは通す（境界）", () => {
        expect(checkWriteSafety(15, 30).ok).toBe(true);
    });

    it("増える・同じ・少し減るは通す", () => {
        expect(checkWriteSafety(31, 30).ok).toBe(true);
        expect(checkWriteSafety(30, 30).ok).toBe(true);
        expect(checkWriteSafety(25, 30).ok).toBe(true);
    });

    it("拒否したときは理由を返す（ログで原因が分かるように）", () => {
        expect(checkWriteSafety(0, 30).reason).toContain("0件");
        expect(checkWriteSafety(2, 30).reason).toContain("30件");
    });
});

// 新しく作った環境（staging）はテーブルが空。リポジトリにコミットされている
// photos.json は本番の写真なので、0件を拒否すると staging が本番の写真を並べる。
// 「空でよい」と明示された環境だけ通す。本番では絶対に通さない。
describe("checkWriteSafety: 空の環境を許すかどうか", () => {
    it("allowEmpty なら0件でも通す（作りたての環境）", () => {
        expect(checkWriteSafety(0, 30, { allowEmpty: true }).ok).toBe(true);
    });

    it("allowEmpty なら大幅減も通す", () => {
        expect(checkWriteSafety(1, 30, { allowEmpty: true }).ok).toBe(true);
    });

    it("既定（本番）では0件を拒否する", () => {
        expect(checkWriteSafety(0, 30, { allowEmpty: false }).ok).toBe(false);
    });

    it("既定（本番）では大幅減を拒否する", () => {
        expect(checkWriteSafety(2, 30, { allowEmpty: false }).ok).toBe(false);
    });

    it("通した理由が分かる（ログで追えるように）", () => {
        expect(checkWriteSafety(0, 30, { allowEmpty: true }).reason).toContain("ALLOW_EMPTY_PHOTOS");
    });
});

// 「急に減った」の比較先が、git にコミットされている photos.json だった。
// CI はこのファイルを毎回作り直すがコミットはしないので、**比較先は
// 最後に手でコミットした30件のまま固定**。本番が120枚に育ったあと50件しか
// 取れなくても `50 >= 30 * 0.5` で通る。「半分にはできない」と読めて、
// 実際は「15件を下回れない」でしかなかった。
// 前回うまくいった件数をテーブルに控えて、それと比べる。
describe("前回の同期件数を比較先にする", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readLastSyncedCount, writeLastSyncedCount, SYNC_STATS_ID } = require("../sync-photos-from-ddb.js");

    const ddbWith = (item: unknown) => ({ send: async () => ({ Item: item }) });

    it("控えた件数を読む", async () => {
        expect(await readLastSyncedCount(ddbWith({ id: SYNC_STATS_ID, count: 120 }))).toBe(120);
    });

    it("控えが無ければ null（呼び出し側がファイルの件数に落とす）", async () => {
        expect(await readLastSyncedCount(ddbWith(undefined))).toBeNull();
    });

    it("数でない値は信用しない", async () => {
        for (const bad of ["120", null, -1, Number.NaN, Infinity, {}]) {
            expect(await readLastSyncedCount(ddbWith({ count: bad }))).toBeNull();
        }
    });

    it("読めなくても止めない（権限の無い環境で守りが強くなりすぎない）", async () => {
        const failing = { send: async () => { throw new Error("AccessDenied"); } };
        expect(await readLastSyncedCount(failing)).toBeNull();
    });

    it("控えの更新に失敗しても本体は成功扱い", async () => {
        const failing = { send: async () => { throw new Error("AccessDenied"); } };
        await expect(writeLastSyncedCount(failing, 120)).resolves.toBeUndefined();
    });

    it("控える文書のIDは他の管理用文書と同じ形（photos.json には出ない）", () => {
        // src を持たないので、写真の絞り込み（item.src && ...）で落ちる
        expect(SYNC_STATS_ID).toBe("syncstats#photos");
        expect(SYNC_STATS_ID).toContain("#");
    });
});

// 120枚まで育ったあとに50件しか取れない、を止められること。
describe("比較先が新しくなると、半減の判定が実際に効く", () => {
    it("前回120件なら、50件の書き込みは止まる", () => {
        expect(checkWriteSafety(50, 120).ok).toBe(false);
    });

    it("git の30件と比べていた頃は、同じ50件が通っていた", () => {
        // 直したのは「比較先」であって、判定式ではない、ということの記録
        expect(checkWriteSafety(50, 30).ok).toBe(true);
    });
});

// 「半減したら止める」の比較先は syncstats#photos の控え。その控えを書く
// UpdateItem が予約語 `at` を裸で使っていたため、**毎回 ValidationException で
// 拒否され、行が一度も作られていなかった**。失敗は warn で握るのでビルドは
// 緑のまま通り、比較先はコミット済み photos.json（30件）に固定されていた
// ——このファイルのコメントが「直した」と書いている状態そのもの。
describe("writeLastSyncedCount: 予約語を裸で使わない", () => {
    it("count と at の両方を ExpressionAttributeNames で逃がす", async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { writeLastSyncedCount } = require("../sync-photos-from-ddb.js");
        const sent: { input: Record<string, unknown> }[] = [];
        const ddb = { send: async (cmd: { input: Record<string, unknown> }) => { sent.push(cmd); return {}; } };

        await writeLastSyncedCount(ddb, 42);

        const input = sent[0].input as {
            UpdateExpression: string;
            ExpressionAttributeNames: Record<string, string>;
            ExpressionAttributeValues: Record<string, unknown>;
        };
        // 式に裸の属性名が残っていない（`#` で始まる名前と値だけ）
        expect(input.UpdateExpression).toBe("SET #c = :c, #at = :at");
        expect(input.ExpressionAttributeNames).toEqual({ "#c": "count", "#at": "at" });
        expect(input.ExpressionAttributeValues[":c"]).toBe(42);
        expect(typeof input.ExpressionAttributeValues[":at"]).toBe("string");
    });
});

// **公開する JSON に内部の事情を出さない。**
//
// `photos.json` はビルドでそのまま配信される。GPS 入り原本の URL
// （`srcOriginal`）と S3 の生キー（`key`）を落とすためのふるいが元からあるが、
// **名簿に足し忘れても誰も落ちなかった**（変異させても全件緑）。
// `staticStale`（静的ページの掃除が届いていないという内部の印）を
// 足したので、ここで固定する。
describe("公開JSONから落とす項目", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stripPrivateFields, PRIVATE_FIELDS } = require("../sync-photos-from-ddb.js");

    it.each(["srcOriginal", "key", "staticStale"])("%s は出さない", (field) => {
        const out = stripPrivateFields({
            id: "p1", src: "https://cdn/x.jpg", title: "あ",
            srcOriginal: "https://cdn/x_orig.jpg", key: "uploads/u/x.jpg", staticStale: true,
        });
        expect(out[field], `${field} が公開JSONに載っている`).toBeUndefined();
        expect(PRIVATE_FIELDS).toContain(field);
    });

    it("表に出す項目は落とさない", () => {
        const out = stripPrivateFields({ id: "p1", src: "https://cdn/x.jpg", title: "あ", tags: ["海"] });
        expect(out).toEqual({ id: "p1", src: "https://cdn/x.jpg", title: "あ", tags: ["海"] });
    });

    it("元の項目を書き換えない（コピーを返す）", () => {
        const item = { id: "p1", srcOriginal: "https://cdn/x_orig.jpg" };
        stripPrivateFields(item);
        expect(item.srcOriginal, "呼び出し元の項目を壊している").toBe("https://cdn/x_orig.jpg");
    });
});
