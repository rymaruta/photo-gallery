import { describe, it, expect, vi } from "vitest";
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
            date: "2026-01-01T00:00:00.000Z",
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


// ここは api-user/src/photoUpdate.ts と**同じ道**の別実装。
// どちらのホストもクライアントのバンドルに入っているので利用者はどちらでも
// 叩ける——つまり緩い方が実際の仕様になる。
// 値を素通ししていた頃にできたこと:
//   - exif に GPS を入れると保存され、公開の GET /photos で配られ、
//     静的HTMLにも焼き込まれた（sanitizeExif は GPS を明示的に落とす）
//   - タグを数千件、タイトルを深くネストしたオブジェクト、なども通った
describe("pickEditableFields: 値も整える", () => {
    it("exif の GPS は保存しない", () => {
        const out = pickEditableFields({
            exif: { camera: "X100V", gpsLatitude: "35.6812", gpsLongitude: "139.7671" },
        });
        expect(out.exif).toEqual({ camera: "X100V" });
    });

    it("exif の文字列は100文字までに切る", () => {
        const out = pickEditableFields({ exif: { camera: "x".repeat(500) } });
        expect((out.exif as { camera: string }).camera.length).toBe(100);
    });

    it("タグは件数と長さの上限で切る", () => {
        const out = pickEditableFields({ tags: Array.from({ length: 5000 }, (_, i) => `t${i}`) });
        expect((out.tags as string[]).length).toBe(30);
    });

    it("タグの重複と空文字は落とす", () => {
        const out = pickEditableFields({ tags: ["雪", "雪", "  ", "", 123, "山"] });
        expect(out.tags).toEqual(["雪", "山"]);
    });

    it("タイトルが想定外の形なら undefined（保存時に触らない扱い）", () => {
        expect(pickEditableFields({ title: { ja: { nested: "deep" } } }).title).toBeUndefined();
        expect(pickEditableFields({ title: [1, 2, 3] }).title).toBeUndefined();
    });

    it("撮影日を検証し、あり得ない値は落とす", () => {
        // 日付だけの値は日付のまま（0時を捏造しない。api-user 側と対）
        expect(pickEditableFields({ date: "2026-01-01" }).date).toBe("2026-01-01");
        expect(pickEditableFields({ date: "2026-01-01T07:32:00.000Z" }).date).toBe("2026-01-01T07:32:00.000Z");
        // カメラの日付未設定（1980年など）や未来日は誤検出として捨てる
        expect(pickEditableFields({ date: "1980-01-01" }).date).toBeUndefined();
        expect(pickEditableFields({ date: "なにか" }).date).toBeUndefined();
    });

    // sanitize.ts は api-user 側と**対の複製**。境界の検証を片側だけに
    // 置くと、もう片方だけ変えたドリフトに気づけない（api-user 側の
    // sanitize.test.ts と同じ検証をこちらにも置く）
    it("日付だけの未来境界: 昨日は通り、明後日は弾く", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
        try {
            const d = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
            expect(pickEditableFields({ date: d(-1) }).date).toBe(d(-1));
            expect(pickEditableFields({ date: d(2) }).date).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it("published は真偽値だけ受け付ける", () => {
        expect(pickEditableFields({ published: false }).published).toBe(false);
        expect("published" in pickEditableFields({ published: "false" })).toBe(false);
        expect("published" in pickEditableFields({ published: 1 })).toBe(false);
    });

    it("説明の段落数と長さも上限で切る", () => {
        const out = pickEditableFields({ description: { ja: Array.from({ length: 200 }, () => "行") } });
        expect((out.description as { ja: string[] }).ja.length).toBe(50);
    });
});
