import { describe, it, expect, vi, afterEach } from "vitest";

// 取り返しのつかない削除をする経路は、環境変数が欠けたら**起動時に止まる**。
//
// `?? ""` / `!` にしていた頃は、UPLOAD_BUCKET が空でも S3 の削除を
// 黙って飛ばして DynamoDB の行だけ消し、成功を返していた。GPS 入りの原本
// （srcOriginal）を含む実体が公開URLに残り、項目が消えているので
// **どの削除経路からも二度と辿れない**。
// CLAUDE.md の「設定ミスは『本番を触る』ではなく『動かない』に倒す」。

vi.mock("../dynamodb", () => ({ ddb: { send: vi.fn() }, PHOTOS_TABLE: "t", USER_INDEX: "i" }));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = vi.fn(); },
    DeleteObjectCommand: class {},
    DeleteObjectsCommand: class {},
    PutObjectCommand: class {},
}));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

const MODULES = [
    ["削除を伴うストーリー", () => import("../stories")],
    ["退会", () => import("../account")],
    ["プロフィール画像", () => import("../profile")],
] as const;

describe("UPLOAD_BUCKET が無ければ起動しない", () => {
    it.each(MODULES)("%s は読み込み時に止まる", async (_name, load) => {
        vi.resetModules();
        vi.stubEnv("UPLOAD_BUCKET", "");
        await expect(load()).rejects.toThrow(/UPLOAD_BUCKET/);
    });

    it.each(MODULES)("%s は設定されていれば読み込める（壊していない）", async (_name, load) => {
        vi.resetModules();
        vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
        await expect(load()).resolves.toBeTruthy();
    });
});
