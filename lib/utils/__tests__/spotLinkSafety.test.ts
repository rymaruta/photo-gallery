import { describe, it, expect } from "vitest";
import { suggestSpotLinks, selectApplicableLinks, type ConfirmedSpotLink } from "../spots";
import type { Photo } from "../../data/photos";
import type { Spot } from "../../data/spots";

/**
 * **写真とスポットを結び付けるのは、人が決めたときだけ。**
 *
 * 以前は「撮影地の名前が台帳と1件だけ一致した」写真を `confirmed` と呼び、
 * `scripts/link-photos-to-spots.ts --apply` が**本番の写真にそのまま
 * `spotId` を書いていた**。名前の一致は撮影の証拠にならない:
 *
 *   - 富士山は20km 先からでも撮れる（被写体の地点 ≠ 撮影の地点）
 *   - 同じ名前の神社・公園・駅が各地にある（台帳に1件しか無くても、
 *     **台帳が未完成なだけ**かもしれない）
 *   - 「京都」のような広い地域名が撮影地に入っている
 *
 * ここは「機械は候補までしか出さない」「書けるのは人の承認だけ」の2つを見る。
 */
const spot = (id: string, name: string, extra: Partial<Spot> = {}): Spot =>
    ({ spotId: id, name, ...extra } as Spot);
const photo = (id: string, location: string, extra: Partial<Photo> = {}): Photo =>
    ({ id, src: `/uploads/${id}.jpg`, location, ...extra } as Photo);

const ok = (photoId: string, spotId: string): ConfirmedSpotLink => ({
    photoId, spotId, confirmedBy: "rymaruta", confirmedAt: "2026-09-22T00:00:00Z",
    evidence: "写真に社殿が写っている",
});
const reasons = (r: { reason: string }[]) => r.map((x) => x.reason).join(" / ");

describe("機械は候補までしか出さない", () => {
    it("名前が1件だけ一致しても confirmed にはしない", () => {
        const s = suggestSpotLinks([photo("p1", "高屋神社")], [spot("sp_1", "高屋神社")]);
        expect(s[0].verdict, "名前の一致を確定として扱っている").toBe("review");
        expect(s[0].spotId).toBe("sp_1");
    });

    it("同じ名前が2件あれば曖昧（同名異所を機械が選ばない）", () => {
        const s = suggestSpotLinks([photo("p1", "大手町")],
            [spot("sp_1", "大手町"), spot("sp_2", "大手町")]);
        expect(s[0].verdict).toBe("ambiguous");
        expect(s[0].spotId, "どちらかを選んではいけない").toBeUndefined();
    });

    it("座標が大きく離れていれば曖昧", () => {
        const s = suggestSpotLinks(
            [photo("p1", "清水寺", { coords: { lat: 43.06, lng: 141.35 } })],
            [spot("sp_1", "清水寺", { coords: { lat: 34.99, lng: 135.78 } })]);
        expect(s[0].verdict).toBe("ambiguous");
    });

    it("台帳に無い名前は対象外", () => {
        const s = suggestSpotLinks([photo("p1", "どこか")], [spot("sp_1", "高屋神社")]);
        expect(s[0].verdict).toBe("unmatched");
    });

    it("既に紐づいている写真は候補にしない", () => {
        const s = suggestSpotLinks([photo("p1", "高屋神社", { spotId: "sp_9" } as Partial<Photo>)],
            [spot("sp_1", "高屋神社")]);
        expect(s).toEqual([]);
    });
});

describe("書けるのは人が承認したものだけ", () => {
    const spots = [spot("sp_1", "高屋神社")];

    it("承認があれば書ける", () => {
        const photos = [photo("p1", "高屋神社")];
        const { apply, rejected } = selectApplicableLinks(photos, spots, [ok("p1", "sp_1")]);
        expect(apply.map((a) => a.photoId)).toEqual(["p1"]);
        expect(rejected).toEqual([]);
    });

    it("**承認が無ければ1件も書かない**（候補があっても）", () => {
        const photos = [photo("p1", "高屋神社")];
        expect(suggestSpotLinks(photos, spots)[0].verdict, "候補としては挙がる").toBe("review");
        const { apply } = selectApplicableLinks(photos, spots, []);
        expect(apply, "承認が無いのに書こうとしている").toEqual([]);
    });

    it("誰が・いつ・何を根拠に、のどれかが欠けたら断る", () => {
        const photos = [photo("p1", "高屋神社")];
        for (const [field, label] of [["confirmedBy", "確認した人"], ["confirmedAt", "確認した日時"], ["evidence", "判定の根拠"]] as const) {
            const bad = { ...ok("p1", "sp_1"), [field]: "  " };
            const { apply, rejected } = selectApplicableLinks(photos, spots, [bad]);
            expect(apply, `${field} が空なのに書こうとしている`).toEqual([]);
            expect(reasons(rejected)).toContain(label);
        }
    });

    it("同名異所は、承認があっても書かない（いまは曖昧な候補だから）", () => {
        const photos = [photo("p1", "大手町")];
        const two = [spot("sp_1", "大手町"), spot("sp_2", "大手町")];
        const { apply, rejected } = selectApplicableLinks(photos, two, [ok("p1", "sp_1")]);
        expect(apply, "承認を根拠に曖昧なものを書いている").toEqual([]);
        expect(reasons(rejected)).toContain("曖昧");
    });

    it("承認したあとに撮影地が書き換わっていたら書かない", () => {
        // 「高屋神社」で承認したのに、いまの撮影地は別の場所
        const photos = [photo("p1", "別の神社")];
        const { apply, rejected } = selectApplicableLinks(photos, [...spots, spot("sp_2", "別の神社")], [ok("p1", "sp_1")]);
        expect(apply).toEqual([]);
        expect(reasons(rejected)).toContain("違う");
    });

    it("台帳に無い spotId は書かない", () => {
        const photos = [photo("p1", "高屋神社")];
        const { apply, rejected } = selectApplicableLinks(photos, spots, [ok("p1", "sp_存在しない")]);
        expect(apply).toEqual([]);
        expect(reasons(rejected)).toContain("台帳に無い");
    });

    it("消された写真は書かない", () => {
        const { apply, rejected } = selectApplicableLinks([], spots, [ok("p_消えた", "sp_1")]);
        expect(apply).toEqual([]);
        expect(reasons(rejected)).toContain("その写真が無い");
    });

    it("既に別の spotId が付いている写真は上書きしない", () => {
        const photos = [photo("p1", "高屋神社", { spotId: "sp_9" } as Partial<Photo>)];
        const { apply, rejected } = selectApplicableLinks(photos, spots, [ok("p1", "sp_1")]);
        expect(apply, "人が直したものを巻き戻している").toEqual([]);
        expect(reasons(rejected)).toContain("既に別の spotId");
    });

    it("同じ先が既に付いていれば、二度書かない（冪等）", () => {
        const photos = [photo("p1", "高屋神社", { spotId: "sp_1" } as Partial<Photo>)];
        const { apply } = selectApplicableLinks(photos, spots, [ok("p1", "sp_1")]);
        expect(apply).toEqual([]);
    });

    it("同じ写真が2回承認されていたら、2件目は断る", () => {
        const photos = [photo("p1", "高屋神社")];
        const { apply, rejected } = selectApplicableLinks(photos, spots, [ok("p1", "sp_1"), ok("p1", "sp_1")]);
        expect(apply).toHaveLength(1);
        expect(reasons(rejected)).toContain("2回");
    });

    it("撮影地が空の写真は書かない（候補にも挙がらない）", () => {
        const photos = [photo("p1", "")];
        const { apply, rejected } = selectApplicableLinks(photos, spots, [ok("p1", "sp_1")]);
        expect(apply).toEqual([]);
        expect(reasons(rejected)).toContain("候補");
    });

    // **非公開の写真も書ける。** `spotId` は「どこで撮ったか」の記録で、
    // 公開・非公開とは別の話。ここで非公開を弾くと、本人が公開した日に
    // 紐付けだけ抜け落ちる
    it("非公開の写真も、承認があれば書ける", () => {
        const photos = [photo("p1", "高屋神社", { published: false } as Partial<Photo>)];
        const { apply } = selectApplicableLinks(photos, spots, [ok("p1", "sp_1")]);
        expect(apply.map((a) => a.photoId)).toEqual(["p1"]);
    });
});
