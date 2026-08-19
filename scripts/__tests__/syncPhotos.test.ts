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
