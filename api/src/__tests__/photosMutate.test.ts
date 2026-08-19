import { describe, it, expect } from "vitest";
import { pickEditableFields } from "../photosMutate";

// PUT /photos/{id} は以前リクエストの中身をそのまま DynamoDB に SET していた。
// 自分の写真に {"userId":"他人のsub"} を送るだけで、その写真を他人の
// ギャラリーへ移せた（userId は GSI のハッシュキー）。同じ経路で src の
// 差し替え、いいね数の捏造、story:true でストーリー欄への差し込みができた。
describe("pickEditableFields", () => {
    it("編集画面で触れる項目は通す", () => {
        const body = {
            title: { ja: "題", en: "T" },
            description: { ja: ["説明"], en: ["desc"] },
            location: "北海道",
            category: "風景",
            date: "2026-01-01",
            tags: ["雪"],
            published: true,
            exif: { camera: "X100V" },
        };
        expect(pickEditableFields(body)).toEqual(body);
    });

    it("素性（id / userId / uploadedBy）は受け付けない", () => {
        const out = pickEditableFields({
            id: "別のID", userId: "他人のsub", uploadedBy: "他人", title: "題",
        });
        expect(out).toEqual({ title: "題" });
    });

    it("画像URL（src 系）は受け付けない", () => {
        const out = pickEditableFields({
            src: "https://evil.example.com/x.jpg",
            srcOriginal: "https://evil.example.com/o.jpg",
            thumbSrc: "https://evil.example.com/t.webp",
            location: "パリ",
        });
        expect(out).toEqual({ location: "パリ" });
    });

    it("集計値と種別（likes / commentCount / story / expiresAt）は受け付けない", () => {
        const out = pickEditableFields({
            likes: 9999, commentCount: 9999, story: true,
            expiresAt: "2099-01-01T00:00:00.000Z", published: false,
        });
        expect(out).toEqual({ published: false });
    });

    it("undefined は「触らない」として落とす", () => {
        expect(pickEditableFields({ title: undefined, location: "京都" })).toEqual({ location: "京都" });
    });

    it("空の body は空を返す", () => {
        expect(pickEditableFields({})).toEqual({});
    });
});
