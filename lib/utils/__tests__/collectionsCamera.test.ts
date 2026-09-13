import { describe, it, expect } from "vitest";
import {
    collectEntries, photosInCollection, collectionPath, labelForSlug,
    collectionCopy, isIndexableCollection, slugify,
} from "../collections";
import type { Photo } from "@/lib/data/photos";

// **機材（カメラ）の集約ページ。**
//
// 数えて分かったこと（公開30枚・2026-09-12 に本体の関数で実測）:
//   タグ 59種→8ページ / 撮影地 14種→7ページ（2枚以上）/
//   カテゴリ 6種→3ページ / 機材 4種→2ページ
// 機材は SONY の2機種だけで公開30枚のうち24枚を覆う。
// （この行は一度「撮影地 14種→0ページ」と書いていたが、素朴な集計で数えて
//   `photosInCollection` の緩い一致を通していなかった＝誤り）
//
// **既存の機械に鍵を1つ挿すだけ**にした（`CollectionType` に "camera"）。
// ここで固定するのは「鍵が正しく挿さっているか」——値の取り出し・URL・文言。

const photo = (id: string, camera?: string, published = true): Photo =>
    ({ id, src: `https://cdn/${id}.jpg`, published, ...(camera ? { exif: { camera } } : {}) }) as unknown as Photo;

describe("機材で束ねる", () => {
    it("同じ機種の写真がまとまる", () => {
        const photos = [photo("a", "SONY ILCE-7M3"), photo("b", "SONY ILCE-7M3"), photo("c", "Apple iPhone 14 Pro")];
        const entries = collectEntries(photos, "camera");
        expect(entries.map((e) => [e.label, e.count])).toEqual([
            ["SONY ILCE-7M3", 2],
            ["Apple iPhone 14 Pro", 1],
        ]);
    });

    // **本題。** 保存済みの値には二重のメーカー名が残っている（実データに
    // "Hasselblad Hasselblad X2D II 100C"）。畳まないと**同じ機種が2つに割れ**、
    // 片方は永久に1枚のまま noindex になる
    it("二重のメーカー名は畳んでから束ねる", () => {
        const photos = [
            photo("a", "Hasselblad Hasselblad X2D II 100C"),
            photo("b", "Hasselblad X2D II 100C"),
        ];
        const entries = collectEntries(photos, "camera");
        expect(entries.length, "同じ機種が2つに割れている").toBe(1);
        expect(entries[0].count).toBe(2);
        expect(entries[0].label).toBe("Hasselblad X2D II 100C");
    });

    it("機材の無い写真は数えない", () => {
        expect(collectEntries([photo("a"), photo("b", "SONY ILCE-7M3")], "camera")).toHaveLength(1);
    });

    // 下書きは集約に出さない（他の種類と同じ）
    it("下書きは数えない", () => {
        const photos = [photo("a", "SONY ILCE-7M3"), photo("b", "SONY ILCE-7M3", false)];
        expect(collectEntries(photos, "camera")[0].count).toBe(1);
    });

    it("スラッグから写真を引ける", () => {
        const photos = [photo("a", "SONY ILCE-7M3"), photo("b", "Apple iPhone 14 Pro")];
        const slug = slugify("SONY ILCE-7M3");
        expect(photosInCollection(photos, "camera", slug).map((p) => p.id)).toEqual(["a"]);
        expect(labelForSlug(photos, "camera", slug)).toBe("SONY ILCE-7M3");
    });
});

describe("機材ページの URL と文言", () => {
    it("URL は /camera/<スラッグ>", () => {
        expect(collectionPath("camera", "sony-ilce-7m3")).toBe("/camera/sony-ilce-7m3");
    });

    it("見出しと説明が機材向けの文になる", () => {
        const copy = collectionCopy("camera", "SONY ILCE-7M3", 12);
        expect(copy.heading).toBe("SONY ILCE-7M3 で撮った写真");
        expect(copy.breadcrumb).toBe("カメラ: SONY ILCE-7M3");
        // 機材名で検索する人に向けた文。作例と設定を名指しする
        expect(copy.description).toContain("SONY ILCE-7M3");
        expect(copy.description).toContain("絞り");
        expect(copy.title).toContain("12枚");
    });

    // 他の種類の文言を巻き込んでいないこと（分岐の取り違え）
    it("撮影地・カテゴリの文言に化けていない", () => {
        const copy = collectionCopy("camera", "SONY ILCE-7M3", 3);
        expect(copy.heading).not.toBe("SONY ILCE-7M3の写真");
        expect(copy.description).not.toContain("旅の参考");
    });
});

describe("索引に載せる条件は他の種類と同じ", () => {
    it("3枚以上で載る", () => {
        expect(isIndexableCollection(2, "camera")).toBe(false);
        expect(isIndexableCollection(3, "camera")).toBe(true);
    });
});
