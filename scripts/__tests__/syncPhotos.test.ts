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
