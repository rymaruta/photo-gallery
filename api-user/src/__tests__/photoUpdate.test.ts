import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));

import { updatePhotoVisibility, isValidYouTubeUrl } from "../photoUpdate";

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (updatePhotoVisibility as any)(event);

function event(sub: string, id: string | undefined, body: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id ? { id } : undefined,
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

beforeEach(() => { mockDdbSend.mockReset(); mockRebuild.mockReset().mockResolvedValue(true); });

describe("updatePhotoVisibility", () => {
    it("id なしは 400", async () => {
        const res = await invoke(event("u1", undefined, { published: true }));
        expect(res.statusCode).toBe(400);
    });

    it("不正な JSON は 400", async () => {
        const res = await invoke(event("u1", "p1", "{broken"));
        expect(res.statusCode).toBe(400);
    });

    it("published が boolean でなければ 400", async () => {
        const res = await invoke(event("u1", "p1", { published: "yes" }));
        expect(res.statusCode).toBe(400);
    });

    it("写真が存在しなければ 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(404);
    });

    it("所有者以外は 403（他人の写真は非公開化できない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner" } });
        const res = await invoke(event("attacker", "p1", { published: false }));
        expect(res.statusCode).toBe(403);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Update は実行されない
    });

    it("自分のストーリーでも 404（写真として公開させない）", async () => {
        // ストーリーに published:true を書き込むと永久の写真ページになり、
        // 24時間後の期限切れ掃除が実体だけ消して壊れたページが残った。
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", userId: "u1", story: true } });
        const res = await invoke(event("u1", "story-1", { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Update は実行されない
    });

    it("userId が無い写真は uploadedBy で所有権を判定する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", uploadedBy: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);
    });

    it("所有者は published を更新できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.UpdateExpression).toContain("published");
        expect(update.ExpressionAttributeValues[":p"]).toBe(false);
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(500);
    });

    it("有効な YouTube URL は songYoutubeUrl に保存される", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { songYoutubeUrl: "https://youtu.be/dQw4w9WgXcQ" }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.UpdateExpression).toContain("songYoutubeUrl");
        expect(update.ExpressionAttributeValues[":yt"]).toBe("https://youtu.be/dQw4w9WgXcQ");
    });

    it("不正な YouTube URL は 400", async () => {
        const res = await invoke(event("u1", "p1", { songYoutubeUrl: "https://evil.example.com/x" }));
        expect(res.statusCode).toBe(400);
    });

    it("空文字の songYoutubeUrl は REMOVE になる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { songYoutubeUrl: "" }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string } }).input;
        expect(update.UpdateExpression).toContain("REMOVE songYoutubeUrl");
    });
});

type UpdateInput = {
    UpdateExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
    ExpressionAttributeNames?: Record<string, string>;
};
const lastUpdate = (): UpdateInput => (mockDdbSend.mock.calls[1][0] as { input: UpdateInput }).input;

describe("updatePhotoVisibility: 下書きのメタデータ編集", () => {
    it("メタ項目が何も無ければ 400（更新項目なし）", async () => {
        const res = await invoke(event("u1", "p1", { foo: "bar" }));
        expect(res.statusCode).toBe(400);
    });

    it("所有者は title/location/category/tags を更新でき、#名前で SET される", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", {
            title: "夕焼けの湖", location: "山中湖", category: "風景", tags: ["夕焼け", "湖"], date: "2026-01-20",
        }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.ExpressionAttributeNames?.["#title"]).toBe("title");
        expect(u.ExpressionAttributeNames?.["#location"]).toBe("location");
        expect(u.ExpressionAttributeValues[":title"]).toBe("夕焼けの湖");
        expect(u.ExpressionAttributeValues[":location"]).toBe("山中湖");
        expect(u.ExpressionAttributeValues[":category"]).toBe("風景");
        expect(u.ExpressionAttributeValues[":tags"]).toEqual(["夕焼け", "湖"]);
        // 撮影日は upload.ts と同じ検証（sanitizeDate）を通す。
        // 日付だけの値は日付のまま（0時を捏造しない）
        expect(u.ExpressionAttributeValues[":date"]).toBe("2026-01-20");
    });

    it("メタ編集と公開を同時に行える（下書き→公開）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", published: false } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { title: "タイトル", published: true }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.ExpressionAttributeValues[":p"]).toBe(true);
        expect(u.ExpressionAttributeValues[":title"]).toBe("タイトル");
    });

    it("空文字/空配列のメタは REMOVE でクリアされる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { title: "  ", tags: [] }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.UpdateExpression).toContain("REMOVE");
        expect(u.UpdateExpression).toContain("#title");
        expect(u.UpdateExpression).toContain("#tags");
    });

    it("メタ編集も所有権チェックされる（他人の写真は 403）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner" } });
        const res = await invoke(event("attacker", "p1", { title: "乗っ取り" }));
        expect(res.statusCode).toBe(403);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("tags は文字列以外を除去し30件・各50文字に制限", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { tags: ["ok", 123, "  ", "x".repeat(80)] }));
        expect(res.statusCode).toBe(200);
        const tags = lastUpdate().ExpressionAttributeValues[":tags"] as string[];
        expect(tags).toContain("ok");
        expect(tags).not.toContain(123);
        expect(tags.every((t) => t.length <= 50)).toBe(true);
    });
});

describe("isValidYouTubeUrl", () => {
    it("youtube.com / youtu.be を許可", () => {
        expect(isValidYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        expect(isValidYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    });

    it("他ホスト・http・非文字列は undefined", () => {
        expect(isValidYouTubeUrl("https://vimeo.com/12345")).toBeUndefined();
        expect(isValidYouTubeUrl("http://youtu.be/dQw4w9WgXcQ")).toBeUndefined();
        expect(isValidYouTubeUrl(123)).toBeUndefined();
        expect(isValidYouTubeUrl("not a url")).toBeUndefined();
    });
});

// 撮影日は年表の並び順の元になる。保存経路によって検証が違うと、
// 編集経由だけ任意の文字列が入って並びが壊れる。
describe("updatePhotoVisibility: 撮影日の検証", () => {
    it("日付でない文字列は保存しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { date: "きのう撮った写真です" }));
        expect(res.statusCode).toBe(200);
        // 不正な値は SET されない（sanitizeDate が弾く）
        expect(lastUpdate().ExpressionAttributeValues?.[":date"]).toBeUndefined();
    });

    // 以前は「保存経路で表記を揃える」として ISO に正規化していたが、
    // "2024-05-01" → "…T00:00:00.000Z" は表示側（photoDate.ts の
    // 「時刻は書かれていれば出す」）に **0時ちょうどという存在しない時刻**を
    // 描かせていた。/user/edit の撮影日入力は日付だけを送る。日付は保つ。
    it("YYYY-MM-DD は日付のまま保存する（0時を捏造しない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { date: "2024-05-01" }));
        expect(lastUpdate().ExpressionAttributeValues[":date"]).toBe("2024-05-01");
    });
});


// 静的ページの作り直しを頼むかどうか。
//
// 「キーが body にあるか」で見ていた時期があるが、それは実質「毎回」
// だった——/user/edit は保存のたびに title/description/location/category/
// date/tags/published を必ず全部送る。何も書き換えずに保存を2回押すだけで
// ビルドが2本走る（1本8分・Actions の枠は月2,000分）。
describe("updatePhotoVisibility: 静的ページの作り直し", () => {
    const stored = {
        id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true,
        title: { ja: "海" }, description: { ja: ["静かだった"] },
        location: "北海道", category: "風景", tags: ["海", "夏"],
    };
    const fullSave = (over: Record<string, unknown> = {}) => ({
        title: { ja: "海" }, description: { ja: ["静かだった"] },
        location: "北海道", category: "風景", tags: ["海", "夏"],
        published: true, ...over,
    });

    it("同じ内容を送り直す保存では頼まない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        expect((await invoke(event("owner", "p1", fullSave()))).statusCode).toBe(200);
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    // タグ未入力の下書きは `tags` 属性そのものを持たない。/user/edit は
    // タグ欄が空でも必ず `tags: []` を送るので、空配列をそのまま比べていた
    // 頃は毎回「変わった」になった。しかも書き込みは REMOVE（＝何も変えない）
    // なので次の保存でも同じ判定になり、**永久に**ビルドが走り続けた。
    it("タグを持たない写真に空のタグを送っても頼まない", async () => {
        const noTags = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, title: { ja: "海" } };
        mockDdbSend.mockResolvedValueOnce({ Item: noTags }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", { title: { ja: "海" }, tags: [], published: true }));
        expect(mockRebuild).not.toHaveBeenCalled();
        // 書き込み自体は今までどおり REMOVE を組み立てる
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string } }).input;
        expect(update.UpdateExpression).toContain("REMOVE #tags");
    });

    it("タグが付いていた写真から全部外したら頼む", async () => {
        const withTags = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, tags: ["海"] };
        mockDdbSend.mockResolvedValueOnce({ Item: withTags }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", { tags: [], published: true }));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    it("説明を消したら頼む（静的HTMLと JSON-LD に残るため）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", fullSave({ description: "" })));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
    });

    it("公開状態を変えたら頼む", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", fullSave({ published: false })));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    it("写真BGMだけ変えても頼まない（静的ページに出ない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", {
            song: { title: "曲", previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a" },
        }));
        expect(mockRebuild).not.toHaveBeenCalled();
    });
});

// DynamoDB の UpdateItem は、キーが無ければ**行を作る**。
// ここは「Get で所有権を確かめる → Update」の2段なので、その間に写真が
// 消えると（別タブで削除・退会の掃除と競合）、`src` も `userId` も持たない
// 行ができる。一覧（attribute_exists(src)）・GSI（userId 無し）・詳細
// （!photo.src で404）のどれからも辿れず、本人には消す手段がない。
//
// 対の api/src/ddb-photos.ts:115 は同じ理由で同じ条件を付けていて、
// テスト（api/src/__tests__/ddbPhotos.test.ts）もある。こちらだけ
// **条件も、それを見るテストも無かった**（付けても外しても25本通った）。
describe("消えた写真を作り直さない", () => {
    it("更新には attribute_exists(id) を付ける", async () => {
        mockDdbSend.mockReset();
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", src: "https://cdn/p1.jpg", published: true } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(200);

        const update = mockDdbSend.mock.calls
            .map((c) => c[0])
            .find((cmd) => cmd?.constructor?.name === "UpdateCommand");
        expect(update.input.ConditionExpression).toBe("attribute_exists(id)");
    });

    it("条件が外れたら 404（500 で「再試行」と読ませない）", async () => {
        // Get は成功、Update だけ条件で落ちる
        mockDdbSend.mockReset();
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", src: "https://cdn/p1.jpg", published: true } })
            .mockImplementationOnce(() => Promise.reject(
                Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" })));
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).toContain("見つかりません");
    });
});
