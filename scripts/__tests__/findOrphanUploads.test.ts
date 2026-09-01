import { describe, it, expect } from "vitest";

// **孤児を後から掃除する経路がどこにも無かった（ORPHAN-2）。**
// 保存に失敗した項目を残してタブを閉じるだけで実体だけが残り、しかもそれは
// EXIF を落とす前の原本（`srcOriginal`）を含む＝GPS 付きの画像が公開URLで
// 取れる状態のまま溜まる。
//
// キーの導出は `api-user/src/mediaKeys.ts` と**同じ挙動**でなければならない。
// ずれると「参照されているのに孤児」と判定して、生きている写真の実体を消す。
// あちらは TS・こちらは CJS なので複製せざるを得ない——ここで同一性を固定する。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deriveUploadKey, MEDIA_FIELDS, uuidOf } = require("../find-orphan-uploads.js") as {
    deriveUploadKey: (v: unknown) => string;
    MEDIA_FIELDS: string[];
    uuidOf: (key: string) => string;
};
import { deriveUploadKey as tsDerive, MEDIA_FIELDS as TS_FIELDS } from "../../api-user/src/mediaKeys";

describe("キーの導出は api-user と同じ", () => {
    it.each([
        "uploads/u1/a.jpg",
        "https://cdn.example.com/uploads/u1/a.jpg",
        "https://cdn.example.com/up%6Coads/u1/a.jpg",   // デコードして判定する
        "https://cdn.example.com/uploads/../secret.jpg", // .. は扱わない
        "uploads/../x.jpg",
        "profiles/u1",                                   // 別の領域
        "",
        "ただの文字列",
    ])("%s", (input) => {
        expect(deriveUploadKey(input)).toBe(tsDerive(input));
    });

    it("見る項目も同じ（増えた項目を片方だけに足さない）", () => {
        expect(MEDIA_FIELDS).toEqual([...TS_FIELDS]);
    });

    // 原本を見落とすと、GPS 入りの画像が孤児として残り続ける
    it("srcOriginal を見ている", () => {
        expect(MEDIA_FIELDS).toContain("srcOriginal");
    });
});

// **キーの一致だけで判定すると、生きている写真の原本を消す。**
//
// 本番のドライラン（2026-09-01）で孤児34件のうち20件以上が
// `uploads/originals/<uuid>` だった。ところがその UUID の写真ページは実在する
// ——**行が原本を指していないだけ**（`srcOriginal` を持たない古い行がある）。
// 原本は表示に使わないので、消しても画面は壊れず、消したことにも気づけない。
// 同じ UUID の実体が1つでも参照されていれば触らない。
describe("写真の識別子で紐づける", () => {
    it("派生ファイルからも同じ UUID を取り出す", () => {
        const u = "18c7ad60-5600-4020-bbe0-edc84332e9ce";
        expect(uuidOf(`uploads/${u}.jpg`)).toBe(u);
        expect(uuidOf(`uploads/${u}_thumb_sm.webp`)).toBe(u);
        expect(uuidOf(`uploads/originals/${u}.jpeg`)).toBe(u);
        expect(uuidOf(`uploads/${u}_lg.avif`)).toBe(u);
    });

    it("UUID を含まないキーは空（判定から外れる）", () => {
        expect(uuidOf("uploads/cloudfront-test.txt")).toBe("");
        expect(uuidOf("uploads/")).toBe("");
    });

    it("大文字でも同じ識別子として扱う", () => {
        const u = "18C7AD60-5600-4020-BBE0-EDC84332E9CE";
        expect(uuidOf(`uploads/${u}.jpg`)).toBe(u.toLowerCase());
    });
});
