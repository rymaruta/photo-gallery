import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListPhotos = vi.hoisted(() => vi.fn());
const mockListPhotosByUser = vi.hoisted(() => vi.fn());

vi.mock("../ddb-photos", () => ({
    listPhotos: mockListPhotos,
    listPhotosByUser: mockListPhotosByUser,
    getPhotoById: vi.fn(),
    listAllPhotosForAdmin: vi.fn(),
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { getPhotos, resetPhotosCache } = await import("../photos");

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<Result> => (getPhotos as any)(event);

beforeEach(() => {
    resetPhotosCache();
    mockListPhotos.mockReset().mockResolvedValue([{ id: "p1", src: "https://cdn/p1.jpg" }]);
    mockListPhotosByUser.mockReset().mockResolvedValue([{ id: "p2", src: "https://cdn/p2.jpg" }]);
});

// この口は未ログインでも叩けて、1回ごとにテーブル全体を読む。
// しかもテーブルには写真だけでなく、いいね・フォローのマーカーや
// コメント・通知の文書も同居していて、絞り込みは読んだ**あと**に効く
// ——つまり全部の読み取り費用を払っている。マーカーは退会しても
// 消えないので、増えるほど1回が重くなる。
// s-maxage=60 を付けているが、API の手前に共有キャッシュは無いので効かない
// （クライアントは execute-api を直接叩く）。見つからないクエリ文字列を
// 足すだけで何度でも叩ける。
describe("getPhotos: 読み取りの使い回し", () => {
    it("短時間に何度叩いてもテーブルは1回しか読まない", async () => {
        for (let i = 0; i < 5; i++) await invoke({});
        expect(mockListPhotos).toHaveBeenCalledTimes(1);
    });

    it("クエリ文字列を変えても読み直さない（キャッシュ回避を許さない）", async () => {
        await invoke({ queryStringParameters: { cb: "1" } });
        await invoke({ queryStringParameters: { cb: "2" } });
        await invoke({ queryStringParameters: { cb: "3" } });
        expect(mockListPhotos).toHaveBeenCalledTimes(1);
    });

    it("返す中身は変わらない", async () => {
        const first = await invoke({});
        const second = await invoke({});
        expect(first.statusCode).toBe(200);
        expect(second.body).toBe(first.body);
        expect(JSON.parse(second.body)).toEqual([{ id: "p1", src: "https://cdn/p1.jpg" }]);
    });

    it("特定の人の分は使い回さない（GSI の Query でその人の枚数に収まる）", async () => {
        await invoke({ queryStringParameters: { userId: "u1" } });
        await invoke({ queryStringParameters: { userId: "u2" } });
        expect(mockListPhotosByUser).toHaveBeenCalledTimes(2);
        expect(mockListPhotos).not.toHaveBeenCalled();
    });

    it("読み取りが失敗したら 500（失敗をキャッシュしない）", async () => {
        mockListPhotos.mockRejectedValue(new Error("ddb down"));
        expect((await invoke({})).statusCode).toBe(500);
        // 次の呼び出しでちゃんと読み直す
        mockListPhotos.mockResolvedValue([{ id: "p1" }]);
        expect((await invoke({})).statusCode).toBe(200);
    });
});
