import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { loadAllPhotos } from "../photos";

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
        if (!existsSync(JSON_PATH)) return; // ビルド前は生成されていない
        const raw = readFileSync(JSON_PATH, "utf-8");
        expect(raw).not.toContain(`"${field}"`);
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
