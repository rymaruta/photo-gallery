import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { loadAllPhotos, stripPrivateFields } from "../photos";

// photos.json はビルドの入力であり、そのまま
//   - クライアントのJSバンドル（lib/routes.ts・usePhotos・UserProfileClient が import）
//   - 各ページの静的HTML と RSC ペイロード
// に展開される。ここに残った値は全員に配られる。
//
// srcOriginal は EXIF を落とす**前**の原本のURL（GPS が入ったまま）で、
// 30件中11件に入ったまま公開ページに出ていた。
// 「EXIF を落とし座標は約1kmに丸めて公開する」という設計が
// データ経路側で無効化されていた。

const PRIVATE_FIELDS = ["srcOriginal", "key"];
const JSON_PATH = path.join(__dirname, "..", "..", "..", "app", "data", "photos.json");

describe("photos.json に非公開の項目が残っていないこと", () => {
    it.each(PRIVATE_FIELDS)("%s を含まない", (field) => {
        // 以前は「無ければ return」で黙って消えていた。ビルド成果物の無い
        // クリーンな CI では**この検証が何もしないまま緑になる**。
        // 前提が無いなら落とす。
        expect(existsSync(JSON_PATH), `${JSON_PATH} がありません（先に npm run build）`).toBe(true);
        const raw = readFileSync(JSON_PATH, "utf-8");
        expect(raw).not.toContain(`"${field}"`);
    });
});

// 上の describe は実物の photos.json を見ている。そしてそれは
// 「既に綺麗」と確かめた直後なので、`loadAllPhotos` の落とす処理を
// 丸ごと消しても通ってしまう（テスト名が言う「古い汚れた photos.json」を
// 一度も作っていない）。汚れた入力を自分で組んで渡す。
describe("stripPrivateFields", () => {
    const dirty = [{
        id: "p1",
        src: "https://cdn/p1.jpg",
        title: { ja: "海" },
        srcOriginal: "https://cdn/uploads/originals/p1.jpeg",  // EXIF を落とす前（GPS入り）
        key: "uploads/67d49a68-owner-sub/p1.jpg",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }] as any;

    it("古い photos.json に残っていても落とす", () => {
        const out = stripPrivateFields(dirty) as Record<string, unknown>[];
        expect(out[0]).not.toHaveProperty("srcOriginal");
        expect(out[0]).not.toHaveProperty("key");
    });

    it("表示に要る項目は残す", () => {
        const out = stripPrivateFields(dirty) as Record<string, unknown>[];
        expect(out[0].src).toBe("https://cdn/p1.jpg");
        expect(out[0].title).toEqual({ ja: "海" });
    });

    it("入力そのものは書き換えない（呼び出し元が原本を使う）", () => {
        stripPrivateFields(dirty);
        expect(dirty[0]).toHaveProperty("srcOriginal");
    });
});

describe("loadAllPhotos", () => {
    it("古い photos.json が残っていても非公開の項目は返さない", async () => {
        const photos = await loadAllPhotos();
        for (const p of photos) {
            for (const field of PRIVATE_FIELDS) {
                expect(Object.hasOwn(p, field)).toBe(false);
            }
        }
    });

    it("写真そのものは返る（フィルタで空にしていない）", async () => {
        const photos = await loadAllPhotos();
        for (const p of photos) expect(typeof p.src).toBe("string");
    });
});
