import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseTarget, describeRow } = require("../set-verified.js");

/**
 * 認証の印を運営が付ける道具の、書きにいく前の判定。
 * 通信する部分（DynamoDB）は試さない。
 */
describe("対象の指定", () => {
    it("@ユーザー名・ユーザー名・userId を見分ける", () => {
        expect(parseTarget("@rymaruta")).toEqual({ kind: "username", value: "rymaruta" });
        expect(parseTarget(" RyMaruta ")).toEqual({ kind: "username", value: "rymaruta" });
        expect(parseTarget("67d49a68-80f1-7083-b0e0-c767886ef868"))
            .toEqual({ kind: "userId", value: "67d49a68-80f1-7083-b0e0-c767886ef868" });
    });
    it("🔴 分からない形は null（書きにいかない）", () => {
        expect(parseTarget("")).toBeNull();
        expect(parseTarget(undefined)).toBeNull();
        expect(parseTarget("丸田竜平")).toBeNull();
        expect(parseTarget("username#rymaruta")).toBeNull();
        expect(parseTarget("ab")).toBeNull();
    });
});

describe("書いてよい行か", () => {
    it("生きている行だけ書く", () => {
        expect(describeRow({ userId: "u", displayName: "丸田 竜平" }).ok).toBe(true);
    });
    it("🔴 行が無い・退会済み（墓石）の行には書かない", () => {
        expect(describeRow(undefined).ok).toBe(false);
        expect(describeRow({ userId: "u", deletedAt: "2026-09-26T00:00:00Z" }).ok).toBe(false);
    });
});
