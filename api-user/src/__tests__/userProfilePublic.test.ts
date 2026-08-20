import { describe, it, expect, vi } from "vitest";

// プロフィールを**返すとき**の曲URLの確認。
//
// ホストの許可リストは書き込み側に後から足したので、それ以前に保存された
// 外部URLはデータにそのまま残っている。プロフィールは未認証でも読めて、
// 音源は <audio preload="auto"> で先読みされ、アートワークは <img> で
// 読み込まれる。入口だけ塞いでも、既存データは訪問者の IP・User-Agent・
// Referer を集め続ける。だから読む側でも落とす。
//
// api-user/src/userProfile.ts はモジュール読み込み時に requireEnv するので、
// 先に環境変数を置いてから import する。

vi.stubEnv("USERS_TABLE", "users-test");
const { toPublicProfile } = await import("../userProfile");

const base = { userId: "u1", displayName: "旅人" };

describe("toPublicProfile: 曲まわりのURL", () => {
    it("Apple 以外のホストの音源・アートワーク・リンクは返さない", async () => {
        const out = toPublicProfile({
            ...base,
            songPreviewUrl: "https://tracker.example.com/beacon.m4a",
            songArtwork: "https://tracker.example.com/art.jpg",
            songTrackUrl: "https://tracker.example.com/song",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(out.songPreviewUrl).toBeUndefined();
        expect(out.songArtwork).toBeUndefined();
        expect(out.songTrackUrl).toBeUndefined();
    });

    it("Apple のホストならそのまま返す", async () => {
        const out = toPublicProfile({
            ...base,
            songPreviewUrl: "https://audio-ssl.itunes.apple.com/x.m4a",
            songArtwork: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
            songTrackUrl: "https://music.apple.com/jp/album/1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(out.songPreviewUrl).toBe("https://audio-ssl.itunes.apple.com/x.m4a");
        expect(out.songArtwork).toBe("https://is1-ssl.mzstatic.com/image/100x100bb.jpg");
        expect(out.songTrackUrl).toBe("https://music.apple.com/jp/album/1");
    });

    it("プレイリストは、外れる曲だけ落として残りは返す", async () => {
        const out = toPublicProfile({
            ...base,
            songs: [
                { title: "外部", previewUrl: "https://tracker.example.com/1.m4a" },
                { title: "Apple", previewUrl: "https://audio-ssl.itunes.apple.com/2.m4a" },
            ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(out.songs?.map((s) => s.title)).toEqual(["Apple"]);
    });

    it("曲の中のアートワークとリンクも用途ごとに確かめる", async () => {
        // 音源が正しくても、アートワークの欄に別ホストを入れれば
        // <img> で読み込ませられる。曲単位でも同じ判定を通す。
        const out = toPublicProfile({
            ...base,
            songs: [{
                title: "Apple",
                previewUrl: "https://audio-ssl.itunes.apple.com/2.m4a",
                artwork: "https://tracker.example.com/art.jpg",
                trackUrl: "https://tracker.example.com/song",
            }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(out.songs?.[0]?.artwork).toBeUndefined();
        expect(out.songs?.[0]?.trackUrl).toBeUndefined();
        expect(out.songs?.[0]?.previewUrl).toBe("https://audio-ssl.itunes.apple.com/2.m4a");
    });

    it("旅アルバムのBGMも同じ判定を通す", async () => {
        const out = toPublicProfile({
            ...base,
            tripSongs: {
                "trip-1": { title: "外部", previewUrl: "https://tracker.example.com/1.m4a" },
                "trip-2": { title: "Apple", previewUrl: "https://audio-ssl.itunes.apple.com/2.m4a" },
            },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(Object.keys(out.tripSongs ?? {})).toEqual(["trip-2"]);
    });

    it("曲を持たないプロフィールでも壊れない", async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out = toPublicProfile({ ...base, bio: "こんにちは" } as any);
        expect(out.displayName).toBe("旅人");
        expect(out.bio).toBe("こんにちは");
        expect(out.songs).toBeUndefined();
    });
});

// 保存側: 旧ルール時代の（許可ホストでない）曲だけが残っている人の
// 「曲を減らして保存」。
//
// 「全部弾かれたら触らない」だけにすると、消したはずの曲が残り続ける
// ——画面は「保存しました」と出すのに、開き直すと元どおり。
// かといって常に反映すると、自己紹介文だけ直した保存でプレイリストが
// 丸ごと消える（画面は既存の曲をそのまま送り返すため）。
// 送られてきた件数が保存済みより少ないかどうかで分ける。
describe("updateMyProfile: 旧ホストの曲が残っている人の保存", () => {
    const legacy = (n: number) => Array.from({ length: n }, (_, i) => ({
        title: `曲${i}`, previewUrl: `https://tracker.example.com/${i}.m4a`,
    }));

    const runSave = async (stored: unknown[], sent: unknown[]) => {
        vi.resetModules();
        vi.stubEnv("USERS_TABLE", "users-test");
        const { marshall } = await import("@aws-sdk/util-dynamodb");
        vi.doMock("@aws-sdk/client-dynamodb", () => ({
            DynamoDBClient: class {
                send(cmd: { constructor: { name: string } }) {
                    if (cmd.constructor.name === "GetItemCommand") {
                        return Promise.resolve({ Item: marshall({ userId: "u1", songs: stored }) });
                    }
                    return Promise.resolve({});
                }
            },
            GetItemCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
            PutItemCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
            DeleteItemCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
        }));
        const { updateMyProfile } = await import("../userProfile");
        return (updateMyProfile as unknown as (e: unknown) => Promise<{ statusCode: number; body: string }>)({
            requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
            body: JSON.stringify({ songs: sent }),
        });
    };

    it("減らして送ったら、消したい意思として扱う", async () => {
        const res = await runSave(legacy(3), legacy(1));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).songs).toEqual([]);
    });

    it("そのまま送り返しただけなら触らない（丸ごと消さない）", async () => {
        const res = await runSave(legacy(3), legacy(3));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).songs).toHaveLength(3);
    });

    it("保存済みが有効なら、壊れた payload で消さない", async () => {
        // 件数だけで「消したい意思」と判断していた頃は、有効な曲を3件持つ人に
        // {songs:[null,null]} を送るだけで（クライアントのマッピング不具合や
        // 古いバージョンで起こりうる）3件とも消えて 200 が返った。
        const valid = Array.from({ length: 3 }, (_, i) => ({
            title: `曲${i}`, previewUrl: `https://audio-ssl.itunes.apple.com/${i}.m4a`,
        }));
        const res = await runSave(valid, [null, null]);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).songs).toHaveLength(3);
    });

    it("保存済みが有効なら、題名の無い曲を送っても消さない", async () => {
        const valid = Array.from({ length: 3 }, (_, i) => ({
            title: `曲${i}`, previewUrl: `https://audio-ssl.itunes.apple.com/${i}.m4a`,
        }));
        const res = await runSave(valid, [{ previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a" }]);
        expect(JSON.parse(res.body).songs).toHaveLength(3);
    });

    it("空配列で送れば消す", async () => {
        const res = await runSave(legacy(3), []);
        expect(JSON.parse(res.body).songs).toEqual([]);
    });
});
