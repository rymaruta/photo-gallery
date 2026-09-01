import { describe, it, expect, vi } from "vitest";

// DynamoDB は使わない純関数だけを検証する
vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class { send() { return Promise.resolve({}); } },
    GetItemCommand: class {},
    PutItemCommand: class {},
    DeleteItemCommand: class {},
}));

import { normalizeUsername, USERNAME_RE, RESERVED_USERNAMES, getPublicProfile, toPublicProfile, mergeProfile, updateMyProfile } from "../userProfile";
import type { UserProfile } from "../userProfile";

describe("normalizeUsername", () => {
    it("小文字化し、先頭の @ を落とす", () => {
        expect(normalizeUsername("@Ryuhei_Photo").username).toBe("ryuhei_photo");
        expect(normalizeUsername("  ryuhei  ").username).toBe("ryuhei");
    });

    it("空・null はクリア扱い（エラーにしない）", () => {
        expect(normalizeUsername("")).toEqual({});
        expect(normalizeUsername(null)).toEqual({});
        expect(normalizeUsername("   ")).toEqual({});
    });

    it("記号・空白・大文字以外の文字は弾く", () => {
        expect(normalizeUsername("ryu hei").error).toBeTruthy();
        expect(normalizeUsername("ryu-hei").error).toBeTruthy();
        expect(normalizeUsername("日本語").error).toBeTruthy();
        expect(normalizeUsername("a@b").error).toBeTruthy();
    });

    it("長さ制限（3〜20文字）", () => {
        expect(normalizeUsername("ab").error).toBeTruthy();
        expect(normalizeUsername("abc").username).toBe("abc");
        expect(normalizeUsername("a".repeat(20)).username).toBe("a".repeat(20));
        expect(normalizeUsername("a".repeat(21)).error).toBeTruthy();
    });

    it("予約語は使えない（ルート衝突・なりすまし・紛らわしい語）", () => {
        for (const w of ["photo", "tag", "camera", "login", "official", "staff", "support", "null", "guest"]) {
            expect(normalizeUsername(w).error).toBeTruthy();
        }
    });

    it("admin は誰も使えない（予約語）", () => {
        expect(normalizeUsername("admin").error).toBeTruthy();
        expect(normalizeUsername("@Admin").error).toBeTruthy();
    });

    it("通常のユーザー名は通る", () => {
        expect(normalizeUsername("ryuhei").username).toBe("ryuhei");
        expect(normalizeUsername("@Ryuhei_01").username).toBe("ryuhei_01");
    });

    it("文字列以外はエラー", () => {
        expect(normalizeUsername(123).error).toBeTruthy();
        expect(normalizeUsername({}).error).toBeTruthy();
    });
});

describe("USERNAME_RE / RESERVED_USERNAMES", () => {
    it("規則は英小文字・数字・_ の3〜20文字", () => {
        expect(USERNAME_RE.test("ryuhei_01")).toBe(true);
        expect(USERNAME_RE.test("Ryuhei")).toBe(false);
        expect(USERNAME_RE.test("ab")).toBe(false);
    });
    it("主要ルート名が予約されている", () => {
        for (const w of ["users", "photo", "tag", "location", "category", "camera", "lens", "upload", "drafts"]) {
            expect(RESERVED_USERNAMES.has(w)).toBe(true);
        }
    });

    it("なりすまし系も予約されている", () => {
        for (const w of ["official", "staff", "support", "administrator", "journeyphoto"]) {
            expect(RESERVED_USERNAMES.has(w)).toBe(true);
        }
    });

    it("admin も予約されている", () => {
        expect(RESERVED_USERNAMES.has("admin")).toBe(true);
    });
});

// @ハンドル → Cognito の内部ID が引けないことの回帰ガード。
// 予約アイテム（username#<handle>）は ownerId を持つため、
// 公開エンドポイントから引けると内部IDの一覧化に使える。
describe("getPublicProfile: 予約アイテムを引かせない", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invokePublic = (event: unknown) => (getPublicProfile as any)(event) as Promise<{ statusCode: number }>;

    it("username# を含む userId は 404", async () => {
        const res = await invokePublic({ pathParameters: { userId: "username#alice" } });
        expect(res.statusCode).toBe(404);
    });

    it("通常の userId は引ける", async () => {
        const res = await invokePublic({ pathParameters: { userId: "some-user-id" } });
        expect(res.statusCode).toBe(200);
    });
});

// 公開プロフィールから項目を落とすと、その項目は「消える」。
// UserProfileClient はこの戻り値を編集元として PUT に丸ごと送り返し、
// PUT は全置換なので、返さなかった項目は DynamoDB から削除される。
// 一度 tripTitles/tripCovers/tripSongs/statusText を落として、
// ピン留めするだけで旅アルバムとひとことが消える事故を起こしている。
describe("toPublicProfile: 画面に出る項目を落とさない", () => {
    const full = {
        userId: "u1",
        username: "ryuhei",
        displayName: "旅人",
        bio: "こんにちは",
        instagram: "ig",
        website: "https://example.com",
        themeColor: "#123456",
        songUrl: "https://youtu.be/x",
        songStart: 10,
        songEnd: 40,
        songTitle: "曲",
        songArtist: "人",
        songArtwork: "https://cdn/a.jpg",
        songPreviewUrl: "https://audio-ssl.itunes.apple.com/p.m4a",
        songTrackUrl: "https://music/x",
        songs: [],
        pinnedPhotoIds: ["p1"],
        updatedAt: "2026-08-19T00:00:00.000Z",
        tripTitles: { "trip-1": "北海道" },
        tripCovers: { "trip-1": "p1" },
        tripSongs: { "trip-1": { title: "曲", previewUrl: "https://audio-ssl.itunes.apple.com/p.m4a" } },
        statusText: "旅に出ています",
    } as unknown as UserProfile;

    it.each([
        "tripTitles", "tripCovers", "tripSongs", "statusText",
        "pinnedPhotoIds", "songs", "themeColor", "displayName", "username", "bio",
    ])("%s を返す（保存時の往復で消えないこと）", (field) => {
        const pub = toPublicProfile(full) as Record<string, unknown>;
        expect(pub[field]).toEqual((full as unknown as Record<string, unknown>)[field]);
    });

    it("許可していない項目は返さない", () => {
        const withSecret = { ...full, internalNote: "みせない", email: "a@example.com" } as unknown as UserProfile;
        const pub = toPublicProfile(withSecret) as Record<string, unknown>;
        expect(pub).not.toHaveProperty("internalNote");
        expect(pub).not.toHaveProperty("email");
    });
});

// PUT /user/profile は以前「全置換」だった。呼び出し側は毎回すべての項目を
// 送り返す必要があり、1つでも書き漏らすとその項目が黙って消えた。
// 実際に2つの事故（ピン留めで旅アルバムが消える / 保存でひとことが消える）を
// 起こしているので、送られていない項目には触らない。
describe("mergeProfile: 送られていない項目は触らない", () => {
    const prev = {
        userId: "u1",
        username: "ryuhei",
        displayName: "旅人",
        bio: "こんにちは",
        statusText: "旅に出ています",
        tripTitles: { "trip-1": "北海道" },
        pinnedPhotoIds: ["p1"],
        updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as UserProfile;

    it("指定していない項目は残る", () => {
        const out = mergeProfile(prev, "u1", { displayName: "旅人2" }) as Record<string, unknown>;
        expect(out.displayName).toBe("旅人2");
        expect(out.statusText).toBe("旅に出ています");
        expect(out.tripTitles).toEqual({ "trip-1": "北海道" });
        expect(out.pinnedPhotoIds).toEqual(["p1"]);
        expect(out.username).toBe("ryuhei");
        expect(out.bio).toBe("こんにちは");
    });

    it("ピン留めだけ変えても旅アルバムとひとことは消えない（回帰ガード）", () => {
        const out = mergeProfile(prev, "u1", { pinnedPhotoIds: ["p2"] }) as Record<string, unknown>;
        expect(out.pinnedPhotoIds).toEqual(["p2"]);
        expect(out.tripTitles).toEqual({ "trip-1": "北海道" });
        expect(out.statusText).toBe("旅に出ています");
    });

    it("undefined を指定した項目は消す（クリア）", () => {
        const out = mergeProfile(prev, "u1", { bio: undefined }) as Record<string, unknown>;
        expect(out).not.toHaveProperty("bio");
        expect(out.displayName).toBe("旅人"); // 他は残る
    });

    it("既存が無ければ指定した項目だけの新規プロフィールになる", () => {
        const out = mergeProfile(null, "u1", { displayName: "新人" }) as Record<string, unknown>;
        expect(out.userId).toBe("u1");
        expect(out.displayName).toBe("新人");
    });

    it("userId は書き換えさせない", () => {
        const out = mergeProfile(prev, "u1", { userId: "他人のsub" }) as Record<string, unknown>;
        expect(out.userId).toBe("u1");
    });

    it("updatedAt は必ず更新する", () => {
        const out = mergeProfile(prev, "u1", {}) as Record<string, unknown>;
        expect(out.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    });
});

// この API は部分更新なので、username を含まないリクエスト（ピン留めだけ、
// 表示名だけ）が普通に来る。normalizeUsername は null と "" をクリアとして
// 通す一方 undefined は「形式が不正」として弾くため、検証を無条件に呼ぶと
// それらが全部 400 になる。実際にピン留めが本番で全滅した。
describe("updateMyProfile: username を送らないリクエストを弾かない", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoke = (body: unknown) => (updateMyProfile as any)({
        requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
        body: JSON.stringify(body),
    }) as Promise<{ statusCode: number; body: string }>;

    it("ピン留めだけ送っても 200（回帰ガード）", async () => {
        const res = await invoke({ pinnedPhotoIds: ["p1"] });
        expect(res.statusCode).toBe(200);
    });

    it("表示名だけ送っても 200（初回ログインの表示名保存）", async () => {
        const res = await invoke({ displayName: "旅人" });
        expect(res.statusCode).toBe(200);
    });

    it("username を明示的に送れば従来どおり検証する", async () => {
        expect((await invoke({ username: "ryu hei" })).statusCode).toBe(400);
        expect((await invoke({ username: "admin" })).statusCode).toBe(400);
        expect((await invoke({ username: "ryuhei" })).statusCode).toBe(200);
    });

    it("空文字・null はクリア扱いで通す", async () => {
        expect((await invoke({ username: "" })).statusCode).toBe(200);
        expect((await invoke({ username: null })).statusCode).toBe(200);
    });
});

// 部分更新APIなのに、`{ songStart: 30 }` だけ送ると songUrl が無いため
// songStart が undefined に落ち、**保存済みの songStart が消えていた**。
// mergeProfile は「addressed かつ undefined」を削除と読むため。
describe("mergeProfile: songUrl を触らない更新は位置も触らない", () => {
    const prev = {
        userId: "me",
        songUrl: "https://embed.music.apple.com/jp/album/x",
        songStart: 30,
        songEnd: 60,
    } as unknown as UserProfile;

    it("addressed でない項目は undefined でも前の値が残る（契約の記録）", () => {
        // updateMyProfile 側の配線（songTouched で apply を絞る）は
        // profileConcurrency.test.ts がハンドラを実際に呼んで測っている。
        // ここは mergeProfile 側の性質だけを固定する。
        const merged = mergeProfile(prev, "me", {});
        expect((merged as Record<string, unknown>).songStart).toBe(30);
        expect((merged as Record<string, unknown>).songEnd).toBe(60);
    });

    it("addressed かつ undefined は削除（曲を消すと位置も消える）", () => {
        const merged = mergeProfile(prev, "me", { songUrl: undefined, songStart: undefined, songEnd: undefined });
        expect(merged).not.toHaveProperty("songStart");
        expect(merged).not.toHaveProperty("songEnd");
    });

    // E-8: ハンドラの検証は「今回送られてきた songStart」としか比べられない。
    // { songUrl, songEnd: 20 } だけ送ると保存済みの songStart=30 と組んで
    // 終了が開始より前の区間が保存できた。整合はマージ後の姿で見る。
    it("マージ後に end <= start になる songEnd は保存しない", () => {
        const merged = mergeProfile(prev, "me", { songUrl: prev.songUrl, songEnd: 20 });
        expect((merged as Record<string, unknown>).songStart).toBe(30);
        expect(merged).not.toHaveProperty("songEnd");
    });

    it("マージ後も end > start なら songEnd は残る（正常系）", () => {
        const merged = mergeProfile(prev, "me", { songUrl: prev.songUrl, songEnd: 45 });
        expect((merged as Record<string, unknown>).songEnd).toBe(45);
    });

    // **書き込み時の修復（意図した挙動として固定する）。**
    // 検証導入前に保存された不正区間（end <= start）が残っている人は、
    // 曲に触れない更新（ピン留め等）でも songEnd が落ちる。
    // 「送られていない項目は触らない」契約の例外だが、end <= start の
    // 区間はそもそも再生されない死んだ値なので、残す価値が無い。
    it("保存済みの不正区間は、無関係な更新のついでに songEnd を落とす（修復）", () => {
        const broken = { userId: "me", songUrl: prev.songUrl, songStart: 30, songEnd: 30 } as unknown as UserProfile;
        const merged = mergeProfile(broken, "me", { statusText: "旅の途中" });
        expect((merged as Record<string, unknown>).songStart).toBe(30);
        expect(merged).not.toHaveProperty("songEnd");
    });
});
