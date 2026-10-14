import { describe, it, expect } from "vitest";
// **ブロックの印のキーは書く側（`block.ts` が使う `blockMarkerId`）から作る。**
// 手書きにすると、書く側の形が変わっても sync のふるいと試験がそろって古いまま緑になる
import * as blockCheck from "../../api-user/src/blockCheck";
const { blockMarkerId } = blockCheck;
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

    // `keptFrom` も。載せると、まだ生きているストーリーのIDが静的サイトに焼かれる
    it.each(["srcOriginal", "key", "staticStale", "publicFeed", "keptFrom"])("%s は出さない", (field) => {
        const out = stripPrivateFields({
            id: "p1", src: "https://cdn/x.jpg", title: "あ",
            srcOriginal: "https://cdn/x_orig.jpg", key: "uploads/u/x.jpg", staticStale: true, publicFeed: "1",
            keptFrom: "story-abc",
        });
        expect(out[field], `${field} が公開JSONに載っている`).toBeUndefined();
        expect(PRIVATE_FIELDS).toContain(field);
    });

    // **秘密ではなく、古くなる数。** 定期ビルドを止めている今、ビルド時の
    // コメント数が静的HTMLに焼かれ、以後どれだけ増えてもそのまま出続ける。
    // 読み手（モーダルのキャプション・写真ページのコメント欄）はどちらも
    // 「0 なら描かない」形なので、載せなければ「APIが答えるまで出さない」
    // になる（間違った数を出すよりよい）。
    it("commentCount は出さない（古い数字を焼かない）", () => {
        const out = stripPrivateFields({
            id: "p1", src: "https://cdn/x.jpg", title: "あ", likes: 12, commentCount: 3,
        });
        expect(out.commentCount, "ビルド時の値のまま公開JSONに載っている").toBeUndefined();
        expect(PRIVATE_FIELDS).toContain("commentCount");
    });

    // **`likes` は落とさない。** 同じ理由で一度落としたが、読み手を数え
    // 違えていた——「人気順」（`useGallery`）は `likes` が無いと全部 0 同士に
    // なって**黙って効かなくなり**、`/photos` が落ちた回は永久に戻らない。
    // プロフィールの「いいね」ピルはガード無しなので、静的生成されるHTMLが
    // **全員「いいね 0」と言い切る**。落とすならこの2つを「未取得」と
    // 「0」で分けてから。
    it("likes は落とさない（人気順と、ガードの無いピルが読む）", () => {
        const out = stripPrivateFields({
            id: "p1", src: "https://cdn/x.jpg", title: "あ", likes: 12, commentCount: 3,
        });
        expect(out.likes, "人気順が黙って効かなくなる／HTMLが「いいね 0」と言い切る").toBe(12);
        expect(PRIVATE_FIELDS).not.toContain("likes");
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

// 「この写真を見て撮影」（`inspiredBy`）を photos.json に残してよいか。
// **読み取りを増やさない**——Scan で手にしている写真とブロックの印だけで決める
describe("pruneInspiredBy: 公開JSONの inspiredBy", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pruneInspiredBy, blockMarkerIds } = require("../sync-photos-from-ddb.js");
    const SRC = { id: "src-1", src: "s", userId: "alice" };
    const MINE = { id: "p1", src: "s", userId: "bob", inspiredBy: "src-1" };
    const pick = (rows: Record<string, unknown>[], id: string) => rows.find((r) => r.id === id)!;

    it("元の写真が公開の一覧に居て、ブロックの関係が無ければ残す", () => {
        const out = pruneInspiredBy([MINE, SRC], new Set());
        expect(pick(out, "p1").inspiredBy).toBe("src-1");
    });

    it("元の写真が一覧に居なければ（非公開・削除・絞った）落とす", () => {
        expect("inspiredBy" in pick(pruneInspiredBy([MINE], new Set()), "p1")).toBe(false);
    });

    it.each([
        ["元の作者が付けた人をブロック", blockMarkerId("alice", "bob")],
        ["付けた人が元の作者をブロック", blockMarkerId("bob", "alice")],
    ])("%s していたら落とす（ブロックしたのに相手の写真からのリンクが残らない）", (_label, marker) => {
        const out = pruneInspiredBy([MINE, SRC], new Set([marker]));
        expect("inspiredBy" in pick(out, "p1")).toBe(false);
        expect(MINE.inspiredBy, "渡した行を書き換えている").toBe("src-1");
    });

    it("関係の無い人のブロックでは落とさない", () => {
        const out = pruneInspiredBy([MINE, SRC], new Set([blockMarkerId("alice", "carol"), blockMarkerId("carol", "bob")]));
        expect(pick(out, "p1").inspiredBy).toBe("src-1");
    });

    it("自分の写真を付けたもの（ブロックはありえない）は残す・自分自身を指すものは落とす", () => {
        const own = { ...MINE, userId: "alice" };
        expect(pick(pruneInspiredBy([own, SRC], new Set()), "p1").inspiredBy).toBe("src-1");
        const self = { ...MINE, inspiredBy: "p1" };
        expect("inspiredBy" in pick(pruneInspiredBy([self], new Set()), "p1")).toBe(false);
    });

    it("持ち主は userId が無ければ uploadedBy で見る（古い行）", () => {
        const old = { id: "p1", src: "s", uploadedBy: "bob", inspiredBy: "src-1" };
        expect("inspiredBy" in pick(pruneInspiredBy([old, SRC], new Set([blockMarkerId("alice", "bob")])), "p1")).toBe(false);
    });

    // 関数だけ正しくても、scan() が通していなければ何も落ちない
    it("scan() が公開の一覧とブロックの印で通している（配線）", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "sync-photos-from-ddb.js"), "utf8");
        expect(src).toContain("return pruneInspiredBy(photos, blockMarkerIds(items))");
    });

    it("Scan の行からブロックの印だけを集める", () => {
        // 一覧の行（`blocks#`・`blockedby#`）は印ではない。形は書く側の関数から作る
        const { blocksId, blockedById } = blockCheck;
        const ids = blockMarkerIds([{ id: blockMarkerId("a", "b") }, { id: blocksId("a") }, { id: blockedById("b") }, { id: "p1", src: "s" }, null]);
        expect([...ids]).toEqual([blockMarkerId("a", "b")]);
    });
});
