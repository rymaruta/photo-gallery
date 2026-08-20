import { describe, it, expect, vi, afterEach } from "vitest";
import { requireEnv } from "../env";

afterEach(() => { vi.unstubAllEnvs(); });

// 以前は各所が `process.env.X ?? "prod-..."` と本番値を既定にしていた。
// 環境変数を渡し忘れたステージングの Lambda が、エラーも出さずに
// 本番のテーブルへ読み書きしてしまう状態だった。
describe("requireEnv", () => {
    it("設定されていれば値を返す", () => {
        vi.stubEnv("SOME_TABLE", "staging-photo-gallery-photos");
        expect(requireEnv("SOME_TABLE")).toBe("staging-photo-gallery-photos");
    });

    it("未設定なら投げる（本番へフォールバックしない）", () => {
        vi.stubEnv("SOME_TABLE", "");
        expect(() => requireEnv("SOME_TABLE")).toThrow(/SOME_TABLE/);
    });

    it("空文字も未設定として扱う", () => {
        vi.stubEnv("EMPTY_ONE", "");
        expect(() => requireEnv("EMPTY_ONE")).toThrow();
    });

    it("エラーメッセージに変数名が入る（原因が分かるように）", () => {
        expect(() => requireEnv("PHOTOS_TABLE_MISSING")).toThrow(/PHOTOS_TABLE_MISSING/);
    });
});
