import { describe, it, expect } from "vitest";
import { personEntity } from "../personEntity";
import { personNodeId } from "../personId";
import { generatePhotoStructuredData, siteConfig } from "../seo";
import type { Photo } from "../../data/photos";

/**
 * **「この31ページが指しているのは1人だ」と機械に言い切る。**
 *
 * この人の `Person` は2か所から出る——`/users/<id>`（`personEntity`）と、
 * 写真ページ30枚の `creator` / `author`（`seo.ts`）。**どちらも名前と
 * `url` は同じだが `@id` が無く、別々の無名の節点**だった（実ビルドで確認）。
 * 同じ実体かどうかは受け取る側の推測に委ねられる。
 *
 * **2つのモジュールは互いを import できない**（`personEntity.ts` が
 * `seo.ts` の `siteConfig` を読むので輪になる）ので、規則は
 * `personId.ts`（何も import しない）に置き、**ここで突き合わせる**。
 */

const UID = "67d49a68-80f1-7083-b0e0-c767886ef868";
const NAME = "丸田 竜平";
const PROFILE_URL = `${siteConfig.url}/users/${UID}`;

const photoPerson = () => {
    const d = generatePhotoStructuredData({
        id: "p1", src: "https://cdn/1.jpg", userId: UID, displayName: NAME,
    } as unknown as Photo) as Record<string, unknown>;
    return d;
};

describe("写真ページの人と、プロフィールの人は同じ節点", () => {
    it("両方が同じ @id を名乗る", () => {
        const d = photoPerson();
        const creator = d.creator as Record<string, unknown>;
        const author = d.author as Record<string, unknown>;
        const profile = personEntity({ id: UID, displayName: NAME });

        expect(creator["@id"], "写真ページの creator に @id が無い").toBeTruthy();
        expect(creator["@id"]).toBe(profile["@id"]);
        expect(author["@id"]).toBe(profile["@id"]);
    });

    // **ページの URL をそのまま使わない。** それは ProfilePage（ページ）の
    // 識別子で、人ではない。同じ値を両方に付けると「ページ＝人」になる
    it("@id はプロフィールの URL そのものではない", () => {
        const profile = personEntity({ id: UID, displayName: NAME });
        expect(profile["@id"]).not.toBe(PROFILE_URL);
        expect(String(profile["@id"]).startsWith(PROFILE_URL)).toBe(true);
        expect(profile.url, "url は今までどおりページを指す").toBe(PROFILE_URL);
    });

    it("personNodeId は断片を足す", () => {
        expect(personNodeId("https://example.com/users/x")).toBe("https://example.com/users/x#person");
    });

    // 別の人なら別の節点（全員が同じ @id を名乗ると全部1人になる）
    it("別の人は別の @id", () => {
        const a = personEntity({ id: "aaa", displayName: "甲" });
        const b = personEntity({ id: "bbb", displayName: "乙" });
        expect(a["@id"]).not.toBe(b["@id"]);
    });

    // 投稿者が分からない写真では url も @id も出さない（誰とも結べない）
    it("userId が無ければ @id も url も出さない", () => {
        const d = generatePhotoStructuredData({
            id: "p1", src: "https://cdn/1.jpg", displayName: NAME,
        } as unknown as Photo) as Record<string, unknown>;
        const creator = d.creator as Record<string, unknown>;
        expect(creator.name).toBe(NAME);
        expect(creator["@id"]).toBeUndefined();
        expect(creator.url).toBeUndefined();
    });
});

/**
 * **人の画像に、その人が撮った風景写真を入れていた。**
 *
 * 出していたのは「最後に上げた写真」で、実ビルドでは白鳥の湖だった。
 * `Person.image` は「その人の画像」＝顔写真・アバターを指す語なので、
 * **丸田竜平とはこういう見た目だ**と申告することになる。
 * 正しい材料（アバター）は**在るかどうかをビルド時に知る手段が無い**
 * ので、出さない方に倒した。
 */
describe("人の構造化データに画像を入れない", () => {
    it("Person に image を出さない", () => {
        const profile = personEntity({ id: UID, displayName: NAME });
        expect(profile.image, "人の画像として何かを申告している").toBeUndefined();
    });

    it("写真ページの creator / author にも image は無い", () => {
        const d = photoPerson();
        expect((d.creator as Record<string, unknown>).image).toBeUndefined();
        expect((d.author as Record<string, unknown>).image).toBeUndefined();
    });
});
