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

    // 正常系。ここが空白だった。
    //
    // 「弾かれた理由」を分けるヒューリスティクスは全部この上に乗っているのに、
    // 有効な曲を送って保存されることを確かめるテストが1本も無かった。
    // 実際、形チェックの関数をコメントどおり（ホストまで見る）に直すと
    // 保存が全ユーザーで無言の no-op になるのに、1,023件すべて通っていた。
    it("有効な曲は保存される", async () => {
        const sent = [
            { title: "Song A", artist: "A", previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a" },
            { title: "Song B", previewUrl: "https://audio-ssl.itunes.apple.com/b.m4a" },
        ];
        const res = await runSave([], sent);
        expect(res.statusCode).toBe(200);
        const songs = JSON.parse(res.body).songs as { title: string; previewUrl: string }[];
        expect(songs.map((s) => s.title)).toEqual(["Song A", "Song B"]);
        expect(songs[0].previewUrl).toBe("https://audio-ssl.itunes.apple.com/a.m4a");
    });

    it("既存の曲を有効な曲で置き換えられる", async () => {
        const res = await runSave(legacy(3), [
            { title: "New", previewUrl: "https://audio-ssl.itunes.apple.com/new.m4a" },
        ]);
        expect(JSON.parse(res.body).songs.map((s: { title: string }) => s.title)).toEqual(["New"]);
    });

    it("有効な曲と旧ホストが混ざって送られたら、有効な方だけ残す", async () => {
        const res = await runSave([], [
            ...legacy(1),
            { title: "Apple", previewUrl: "https://audio-ssl.itunes.apple.com/a.m4a" },
        ]);
        expect(JSON.parse(res.body).songs.map((s: { title: string }) => s.title)).toEqual(["Apple"]);
    });

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

    it("有効な曲と旧ホストが混ざっていても、減らせば消せる", async () => {
        // 保存済み = [Apple 1件, 旧ホスト2件]。画面から Apple の曲だけ消して
        // 保存すると、送られるのは旧ホスト2件で全部弾かれる。
        // 「保存済みに有効な曲がある」を条件にしていた頃は触らない判断になり、
        // 200 を返しながら3件とも残っていた（保存しましたと出るのに元どおり）。
        const mixed = [
            { title: "Apple", previewUrl: "https://audio-ssl.itunes.apple.com/0.m4a" },
            ...legacy(2),
        ];
        const res = await runSave(mixed, legacy(2));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).songs).toEqual([]);
    });

    it("URL として壊れた音源は「旧データ」に数えない（有効な曲を守る）", async () => {
        // previewUrl が "undefined" という文字列だったり http:// だったりする
        // のはクライアントの不具合。件数の比較に混ぜると、有効な曲を持つ人の
        // プレイリストが黙って全部消える（{songs:[null,null]} と同じ症状）。
        const valid = Array.from({ length: 3 }, (_, i) => ({
            title: `曲${i}`, previewUrl: `https://audio-ssl.itunes.apple.com/${i}.m4a`,
        }));
        for (const broken of ["undefined", "http://audio-ssl.itunes.apple.com/x.m4a", "   "]) {
            const res = await runSave(valid, [{ title: "A", previewUrl: broken }, { title: "B", previewUrl: broken }]);
            expect(JSON.parse(res.body).songs).toHaveLength(3);
        }
    });

    it("空配列で送れば消す", async () => {
        const res = await runSave(legacy(3), []);
        expect(JSON.parse(res.body).songs).toEqual([]);
    });
});

// 旅アルバムのBGM。songs と同じ穴が隣に開いていた。
//
// 画面は既存の tripSongs をそのまま送り返すので、旧ホストの曲を設定して
// いる人が自己紹介文だけ直して保存すると、全部弾かれて「消す」と読まれ、
// 旅アルバムのBGMが黙って全部消えていた。
describe("updateMyProfile: 旅アルバムのBGM", () => {
    const legacySong = { title: "旧", previewUrl: "https://tracker.example.com/1.m4a" };

    const runTripSave = async (stored: unknown, sent: unknown) => {
        vi.resetModules();
        vi.stubEnv("USERS_TABLE", "users-test");
        const { marshall } = await import("@aws-sdk/util-dynamodb");
        vi.doMock("@aws-sdk/client-dynamodb", () => ({
            DynamoDBClient: class {
                send(cmd: { constructor: { name: string } }) {
                    if (cmd.constructor.name === "GetItemCommand") {
                        return Promise.resolve({ Item: marshall({ userId: "u1", tripSongs: stored }) });
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
            body: JSON.stringify({ tripSongs: sent }),
        });
    };

    it("そのまま送り返しただけなら消さない", async () => {
        const stored = { "trip-1": legacySong };
        const res = await runTripSave(stored, stored);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).tripSongs).toBeTruthy();
    });

    it("空で送れば消す", async () => {
        const res = await runTripSave({ "trip-1": legacySong }, {});
        expect(JSON.parse(res.body).tripSongs).toEqual({});
    });

    it("有効な曲は今までどおり保存する", async () => {
        const res = await runTripSave({}, {
            "trip-1": { title: "Apple", previewUrl: "https://audio-ssl.itunes.apple.com/1.m4a" },
        });
        expect(Object.keys(JSON.parse(res.body).tripSongs)).toEqual(["trip-1"]);
    });
});
