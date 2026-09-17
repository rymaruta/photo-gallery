import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test", USER_INDEX: "userId-createdAt-index" }));

import { reportPhoto, REPORT_REASONS, isReportReason, reportId, REPORT_NOTE_MAX } from "../report";

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (reportPhoto as any)(event);
const event = (sub: string | undefined, id: string | undefined, body: unknown) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    pathParameters: id ? { id } : undefined,
    body: typeof body === "string" ? body : JSON.stringify(body),
});
const ME = "11111111-2222-4333-8444-555555555555";
const OWNER = "99999999-8888-4777-8666-555555555555";
const PHOTO = { id: "p1", src: "https://cdn/x.webp", userId: OWNER };
const lastPut = () => (mockDdbSend.mock.calls[1][0] as { input: { Item: Record<string, unknown> } }).input.Item;

beforeEach(() => { mockDdbSend.mockReset(); });

describe("通報の理由", () => {
    it("一覧にある理由だけ通す", () => {
        for (const r of REPORT_REASONS) expect(isReportReason(r)).toBe(true);
        expect(isReportReason("なんとなく")).toBe(false);
        expect(isReportReason("")).toBe(false);
        expect(isReportReason(undefined)).toBe(false);
        expect(isReportReason(1)).toBe(false);
    });

    it("著作権とプライバシーは必ず入っている（この2つが実際に使われる）", () => {
        expect(REPORT_REASONS).toContain("copyright");
        expect(REPORT_REASONS).toContain("privacy");
    });
});

describe("通報のキー", () => {
    /** **1人1投稿につき1件。** 押し直しても行が増えない */
    it("同じ人・同じ写真なら同じキー", () => {
        expect(reportId("p1", ME)).toBe(reportId("p1", ME));
        expect(reportId("p1", ME)).not.toBe(reportId("p2", ME));
        expect(reportId("p1", ME)).not.toBe(reportId("p1", OWNER));
    });

    it("写真の行とキーがぶつからない（`#` で分ける）", () => {
        expect(reportId("p1", ME).includes("#"), "写真の id と同じ空間に入る").toBe(true);
    });
});

describe("POST /photos/{id}/report", () => {
    it("理由を選ばないと断る", async () => {
        const res = await invoke(event(ME, "p1", {}));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend, "断ったのに書いている").not.toHaveBeenCalled();
    });

    it("一覧に無い理由も断る", async () => {
        const res = await invoke(event(ME, "p1", { reason: "きらい" }));
        expect(res.statusCode).toBe(400);
    });

    it("壊れた JSON は 400", async () => {
        expect((await invoke(event(ME, "p1", "{broken"))).statusCode).toBe(400);
    });

    /**
     * **写真以外は触らせない。** `#` を含む id は内部の文書
     * （コメント・通知・フォロー）なので、読み側・削除側と同じ扱いにする
     */
    it("`#` を含む id は写真ではない", async () => {
        const res = await invoke(event(ME, "comments#p1", { reason: "spam" }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    /** 見ないと、任意の文字列を写真に見立てて行を作れる */
    it("実在しない写真は断る（行を作らない）", async () => {
        mockDdbSend.mockResolvedValueOnce({});
        const res = await invoke(event(ME, "p1", { reason: "spam" }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend, "**存在しない写真の通報を書いている**").toHaveBeenCalledTimes(1);
    });

    it("自分の投稿は通報できない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...PHOTO, userId: ME } });
        const res = await invoke(event(ME, "p1", { reason: "spam" }));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("受け付けたら、誰が・どの写真を・なぜ を残す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: PHOTO }).mockResolvedValueOnce({});
        const res = await invoke(event(ME, "p1", { reason: "copyright", note: " 自分の写真です " }));
        expect(res.statusCode).toBe(200);
        const item = lastPut();
        expect(item.id).toBe(reportId("p1", ME));
        expect(item.photoId).toBe("p1");
        expect(item.reporterId).toBe(ME);
        expect(item.ownerId, "誰の投稿かを残していない（運営が辿れない）").toBe(OWNER);
        expect(item.reason).toBe("copyright");
        expect(item.note, "前後の空白を落としていない").toBe("自分の写真です");
        expect(item.createdAt, "いつ通報されたか残していない").toBeTruthy();
    });

    it("補足は上限で切る（長い文章を溜めるところではない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: PHOTO }).mockResolvedValueOnce({});
        await invoke(event(ME, "p1", { reason: "other", note: "あ".repeat(REPORT_NOTE_MAX + 50) }));
        expect((lastPut().note as string).length).toBeLessThanOrEqual(REPORT_NOTE_MAX);
    });

    it("補足が無くても受け付ける（属性を持たない形で書く）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: PHOTO }).mockResolvedValueOnce({});
        await invoke(event(ME, "p1", { reason: "spam" }));
        expect("note" in lastPut(), "空の補足を書いている").toBe(false);
    });

    /** 通報したい相手が直後に隠すことがある。非公開でも受け付ける */
    it("非公開の写真も通報できる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...PHOTO, published: false } }).mockResolvedValueOnce({});
        expect((await invoke(event(ME, "p1", { reason: "sexual" }))).statusCode).toBe(200);
    });

    it("ストーリーだと分かるようにする（24時間で消えるので、あとで写真を引けない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...PHOTO, story: true } }).mockResolvedValueOnce({});
        await invoke(event(ME, "p1", { reason: "violence" }));
        expect(lastPut().story).toBe(true);
    });

    it("書き込みが落ちたら 500（受け付けたと嘘をつかない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: PHOTO }).mockRejectedValueOnce(new Error("boom"));
        expect((await invoke(event(ME, "p1", { reason: "spam" }))).statusCode).toBe(500);
    });

    it("ログインしていなければ断る", async () => {
        expect((await invoke(event(undefined, "p1", { reason: "spam" }))).statusCode).toBe(400);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});
