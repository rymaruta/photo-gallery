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

    // 画面は「変えた項目だけ」を送るようになった（7232340 / 9df0ec2）。
    // 公開ボタンだけ押した回は body が `{ published }` になり、メタ項目は
    // どれも指定されない＝**何も消してはいけない**。
    // ここを固定しないと、applyMeta を「常に addressed」に直した瞬間に
    // タイトル・説明・撮影地・タグが REMOVE で吹き飛ぶ（それでも
    // 「公開できる」テストは全部通ってしまう）。
    it("公開状態だけの保存では、何も REMOVE しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({
                Item: {
                    id: "p1", userId: "u1", published: false,
                    title: "夕焼けの湖", description: "湖畔から", location: "山中湖",
                    category: "風景", tags: ["夕焼け"], date: "2026-01-20",
                },
            })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);

        const u = lastUpdate();
        expect(u.UpdateExpression).not.toContain("REMOVE");
        // 触るのは published と updatedAt だけ
        expect(u.UpdateExpression).toContain("published");
        // 属性は #名前 で参照される（updatedAt に "date" が含まれるので、
        // 素の文字列で探すと "date" が誤ってヒットする）
        for (const col of ["title", "description", "location", "category", "tags", "date"]) {
            expect(u.UpdateExpression).not.toContain(`#${col}`);
            expect(u.ExpressionAttributeNames ?? {}).not.toHaveProperty(`#${col}`);
        }
    });

    // 逆向きの正常系: 指定された項目を空で送れば今までどおり消せる
    // （「何も REMOVE しない」を REMOVE 自体の削除で通してしまわないため）
    it("空で指定された項目は今までどおり REMOVE する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", location: "山中湖" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { location: "" }));
        expect(res.statusCode).toBe(200);
        expect(lastUpdate().UpdateExpression).toContain("REMOVE #location");
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


// 通知・コメント・フォロー・いいねの文書も同じキー空間にいる。
// 読み側（getPhoto）・削除側（deleteMyPhoto）・管理API は全部 `#` を弾くのに、
// **更新側だけ無かった**。
//
// 今は別の一枚で塞がっている——内部文書は所有者を `uid` という別名で持ち
// `userId` を持たないので `!ownerId` で 403 になる。つまり「`uid` と
// `userId` を使い分ける」という**暗黙の約束1本**で持っていた。
// 次に誰かが内部文書に `userId` を書いた瞬間に開く。
describe("updatePhotoVisibility: 写真以外は触らせない", () => {
    it.each([
        "notifs#me",
        "comments#p1",
        "following#me",
        "followstats#me",
    ])("%s は 404（DDB を触らない）", async (id) => {
        const res = await invoke(event("u1", id, { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // `userId` を持つ内部文書が現れても、入口で止まること
    it("内部文書が userId を持っていても届かない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "notifs#u1", userId: "u1" } });
        const res = await invoke(event("u1", "notifs#u1", { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

// **隠す操作は、畳んではいけない。**
//
// 畳まれた依頼は後から実行されない（定期ビルドも止めてある）ので、
// 非公開にしたのに `/photo/<id>` の静的HTML が本文・撮影地・EXIF・
// 表示名入りの JSON-LD ごと出たままになる。本文の編集なら「古い文が残る」で
// 済むが、隠す操作でそれは**隠せていない**ということ。
describe("非公開にするときの再ビルド依頼", () => {
    const stored2 = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true };

    // **一度ここを素通しにして、逆向きに倒した。**
    // クールダウンは `coalesce` を指定したときしか効かないのに、月次予算は
    // 指定の有無に関わらず1加算される。つまりクールダウンは
    // 「予算を減らす速度の唯一の歯止め」でもあった——素通しにすると
    // トグル200回で月の予算を使い切れ、その月いっぱい**削除・退会の掃除が
    // 全部落ちる**。「隠すのが遅れる」を直して「消したのに残る」を月単位で
    // 作る取り引きだった。畳んだうえで、届かなかったことを下の印で残す。
    it("隠すときも畳む（予算を減らす速度の歯止めを外さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
    });

    it("公開する側は今までどおり畳む（遅れて出るのは privacy の失敗ではない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { ...stored2, published: false } })
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: true }));
        expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
    });

    // **頼めなかったことを行に残す。** 削除側は「非公開だった写真には
    // 静的ページが無い」と決め打ちして掃除を省くので、その前提が崩れたことを
    // 伝えないと、非公開 →（依頼が届かない）→ 削除 で誰にも消されない
    it("頼めなかったら staticStale を立てる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);   // 予算切れ・設定漏れ・dispatch 失敗
        const res = await invoke(event("owner", "p1", { published: false }));
        expect(res.statusCode).toBe(200);   // 非公開そのものは成立している

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("staticStale")), "頼めなかったのに印を残していない").toBe(true);
    });

    // 残したままだと、再公開 → もう一度隠す（成功）のあとも
    // 「掃除が届いていない」ことになり、削除のたびに要らないビルドが1本
    it("頼めたら、立っていた印を下ろす", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { ...stored2, staticStale: true } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("REMOVE staticStale")), "印が立ったまま残る").toBe(true);
    });

    it("頼めたときは印を立てない（余計な書き込みをしない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("staticStale"))).toBe(false);
    });
});

// **印を下ろすのは、実際に依頼を出して届いたときだけ。**
//
// `dispatched` の初期値を `true` にして「依頼したかどうか」を見ていなかった
// ので、**何も変えずに『保存』を押しただけ**で（依頼は1本も出ていないのに）
// 印が下りていた。画面は `published` を毎回同梱するので、値が同じなら
// `visibilityChanged` も `metaChanged` も false になる——そのあと削除しても
// 掃除を頼まず、塞いだはずの穴が**印を消す側から**戻ってくる。
describe("何も変わっていない保存では、印を触らない", () => {
    const hidden = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: false, staticStale: true };

    it("依頼を出していないなら、印は下ろさない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: hidden }).mockResolvedValueOnce({});
        mockRebuild.mockClear();
        // 非公開のまま、値も変えずに保存（画面は published を毎回送る）
        await invoke(event("owner", "p1", { published: false }));

        expect(mockRebuild, "何も変わっていないのに依頼を出している").not.toHaveBeenCalled();
        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("REMOVE staticStale")), "依頼していないのに印を下ろした").toBe(false);
    });

    it("BGM だけ変えた保存でも下ろさない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: hidden }).mockResolvedValueOnce({});
        mockRebuild.mockClear();
        await invoke(event("owner", "p1", { song: null }));

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("REMOVE staticStale"))).toBe(false);
    });
});

// Get → Update の2段なので、その間に写真が消えると `staticStale` だけを
// 持つ**幽霊行**ができる（一覧・GSI・詳細のどれからも辿れず、本人にも
// 消せない）。本体の更新は同じ理由で条件を付けてある。印の2本も同じ。
describe("印の書き込みも幽霊行を作らない", () => {
    it("staticStale の Update には attribute_exists(id) が付く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);   // 届かない → 印を立てる
        await invoke(event("owner", "p1", { published: false }));

        const marks = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand")
            .filter((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression).includes("staticStale"));
        expect(marks).toHaveLength(1);
        expect((marks[0] as { input: { ConditionExpression?: string } }).input.ConditionExpression,
            "幽霊行を作りうる書き込みに条件が無い").toBe("attribute_exists(id)");
    });

    it("印を下ろす Update にも付く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, staticStale: true } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));

        const marks = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand")
            .filter((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression).includes("REMOVE staticStale"));
        expect(marks).toHaveLength(1);
        expect((marks[0] as { input: { ConditionExpression?: string } }).input.ConditionExpression).toBe("attribute_exists(id)");
    });
});
