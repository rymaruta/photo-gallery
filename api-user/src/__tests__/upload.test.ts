import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPutPhoto = vi.hoisted(() => vi.fn());
const mockCountUserPhotos = vi.hoisted(() => vi.fn());
const mockCheckGoFulfillment = vi.hoisted(() => vi.fn());

vi.mock("../ddb-photos", () => ({
    putPhoto: mockPutPhoto,
    countUserPhotos: mockCountUserPhotos,
}));
vi.mock("../go", () => ({
    checkGoFulfillment: mockCheckGoFulfillment,
}));

import { savePhoto } from "../upload";
import type { Photo } from "../types";

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (savePhoto as any)(event);

function event(sub: string, body: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

const BASE = { key: "uploads/p1.webp", publicUrl: "https://cdn.example.com/uploads/p1.webp" };

function savedPhoto(): Photo {
    return mockPutPhoto.mock.calls[0][0] as Photo;
}

beforeEach(() => {
    mockPutPhoto.mockReset().mockResolvedValue(undefined);
    mockCountUserPhotos.mockReset().mockResolvedValue(0);
    mockCheckGoFulfillment.mockReset().mockResolvedValue(0);
});

describe("savePhoto: thumbUrl（一覧グリッド用サムネイル）", () => {
    it("https の thumbUrl は thumbSrc として保存される", async () => {
        const thumbUrl = "https://cdn.example.com/uploads/t1.webp";
        const res = await invoke(event("u1", { ...BASE, thumbUrl }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().thumbSrc).toBe(thumbUrl);
    });

    it("thumbUrl なしでも保存できる（thumbSrc は付かない）", async () => {
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("http:// の thumbUrl は破棄される", async () => {
        const res = await invoke(event("u1", { ...BASE, thumbUrl: "http://evil.example.com/x.webp" }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("500文字を超える thumbUrl は破棄される", async () => {
        const thumbUrl = `https://cdn.example.com/${"a".repeat(500)}.webp`;
        const res = await invoke(event("u1", { ...BASE, thumbUrl }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });

    it("文字列以外の thumbUrl は破棄される", async () => {
        const res = await invoke(event("u1", { ...BASE, thumbUrl: 123 }));
        expect(res.statusCode).toBe(200);
        expect("thumbSrc" in savedPhoto()).toBe(false);
    });
});

describe("savePhoto: 基本バリデーション", () => {
    it("key / publicUrl がなければ 400", async () => {
        const res = await invoke(event("u1", { thumbUrl: "https://x.example.com/t.webp" }));
        expect(res.statusCode).toBe(400);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("不正な JSON は 400", async () => {
        const res = await invoke(event("u1", "{broken"));
        expect(res.statusCode).toBe(400);
    });

    it("100枚上限に達していたら 403", async () => {
        mockCountUserPhotos.mockResolvedValueOnce(100);
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(403);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });
});

describe("savePhoto: blurDataURL（ぼかしプレビュー）", () => {
    const blur = "data:image/webp;base64,UklGRAAAAABXRUJQ";
    it("有効な画像 data URI は blurDataURL として保存される", async () => {
        const res = await invoke(event("u1", { ...BASE, blurDataURL: blur }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().blurDataURL).toBe(blur);
    });
    it("data URI でない文字列は破棄される", async () => {
        const res = await invoke(event("u1", { ...BASE, blurDataURL: "https://evil.example.com/x.webp" }));
        expect(res.statusCode).toBe(200);
        expect("blurDataURL" in savedPhoto()).toBe(false);
    });
    it("4000文字を超えるものは破棄される", async () => {
        const big = "data:image/webp;base64," + "A".repeat(4100);
        const res = await invoke(event("u1", { ...BASE, blurDataURL: big }));
        expect(res.statusCode).toBe(200);
        expect("blurDataURL" in savedPhoto()).toBe(false);
    });
});

describe("savePhoto: 下書き（published フラグ）", () => {
    it("既定（published 未指定）は公開で保存し、go成立判定を実行する", async () => {
        const res = await invoke(event("u1", { ...BASE }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().published).toBe(true);
        expect(mockCheckGoFulfillment).toHaveBeenCalledTimes(1);
    });

    it("published:false は下書き（非公開）で保存し、go成立判定=通知を出さない", async () => {
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().published).toBe(false);
        expect(mockCheckGoFulfillment).not.toHaveBeenCalled();
    });

    it("published:true を明示した場合も公開で保存する", async () => {
        const res = await invoke(event("u1", { ...BASE, published: true }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().published).toBe(true);
        expect(mockCheckGoFulfillment).toHaveBeenCalledTimes(1);
    });

    it("下書きは必須項目なしでも保存できる（title 未指定は既定の無題）", async () => {
        const res = await invoke(event("u1", { ...BASE, published: false }));
        expect(res.statusCode).toBe(200);
        expect(savedPhoto().title).toEqual({ ja: "無題", en: "Untitled" });
    });
});

describe("savePhoto: exif（撮影情報）のサニタイズ", () => {
    it("既知のフィールドだけが保存される（GPSや未知キーは落ちる）", async () => {
        const res = await invoke(event("u1", {
            ...BASE,
            exif: {
                camera: "SONY ILCE-7M3", lens: "FE 24-70mm", aperture: "f/4",
                exposure: "1/640s", iso: 100, focalLength: "70mm",
                whiteBalance: "Manual", imageSize: "6000x4000",
                dateTimeOriginal: "2026-01-20T07:32:00.000Z",
                GPSLatitude: 35.0, evil: "<script>",
            },
        }));
        expect(res.statusCode).toBe(200);
        const exif = savedPhoto().exif as Record<string, unknown>;
        expect(exif.camera).toBe("SONY ILCE-7M3");
        expect(exif.iso).toBe(100);
        expect(exif.dateTimeOriginal).toBe("2026-01-20T07:32:00.000Z");
        expect("GPSLatitude" in exif).toBe(false);
        expect("evil" in exif).toBe(false);
    });

    it("文字列は100文字に切り詰められる", async () => {
        const res = await invoke(event("u1", { ...BASE, exif: { camera: "x".repeat(300) } }));
        expect(res.statusCode).toBe(200);
        expect((savedPhoto().exif as { camera: string }).camera.length).toBe(100);
    });

    it("空・不正な exif は保存されない", async () => {
        const res = await invoke(event("u1", { ...BASE, exif: { iso: -5, camera: "  " } }));
        expect(res.statusCode).toBe(200);
        expect("exif" in savedPhoto()).toBe(false);
    });
});
