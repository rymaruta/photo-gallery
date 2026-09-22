import { describe, it, expect } from "vitest";
import { linkStates, isUsableConfirmation, LINK_CONFLICT_KM,
    type SpotLinkConfirmation } from "../spots";
import { writableLinks } from "../../../scripts/link-photos-to-spots";
import type { Photo } from "../../data/photos";
import type { Spot } from "../../data/spots";

/**
 * 写真とスポットの紐付け（owner の指示書 6・最重要）。
 *
 * 🔴 **名称一致は証拠ではない。** ここで見張るのは1つ:
 * **意図しない `spotId` が書き込まれないこと**。
 *
 * 指示書が挙げた10の場合を、すべて「書き込み対象にならない」で確かめる。
 * 本番データは触らない（この表は手元の作り物）。
 */

const photo = (over: Partial<Photo> & { id: string }): Photo =>
    ({ src: `/uploads/${over.id}.jpg`, ...over }) as Photo;

const spot = (over: Partial<Spot> & { spotId: string; name: string }): Spot =>
    ({ slug: over.name, createdAt: "2026-01-01T00:00:00Z", ...over }) as Spot;

const confirmation = (over: Partial<SpotLinkConfirmation> & { photoId: string; spotId: string }):
    SpotLinkConfirmation => ({
        confirmedBy: "owner", confirmedAt: "2026-09-22T00:00:00Z",
        evidence: "現地で撮影したことを本人が確認", ...over,
    });

/** その写真が書き込み対象になるか（唯一の関心事） */
const writable = (photos: Photo[], spots: Spot[], confs: unknown[] = []) =>
    writableLinks(linkStates(photos, spots, confs)).map((s) => s.photoId);

describe("名称一致だけでは書き込まない（指示書 6）", () => {
    const takaya = spot({ spotId: "sp_takaya", name: "高屋神社",
        coords: { lat: 34.13, lng: 133.65 } });

    it("名称だけが一致する写真は『候補』止まりで、書き込まれない", () => {
        const photos = [photo({ id: "p1", location: "高屋神社" })];
        const states = linkStates(photos, [takaya]);
        expect(states[0].verdict).toBe("candidate");
        expect(states[0].verdict).not.toBe("confirmed");
        expect(writable(photos, [takaya])).toEqual([]);
    });

    /// 🔴 **同名異所。** 「同じ名称の神社や公園」（指示書の言葉）
    it("同名異所は曖昧として止め、書き込まれない", () => {
        const another = spot({ spotId: "sp_takaya2", name: "高屋神社",
            coords: { lat: 35.9, lng: 139.6 } });
        const photos = [photo({ id: "p1", location: "高屋神社" })];
        expect(linkStates(photos, [takaya, another])[0].verdict).toBe("ambiguous");
        expect(writable(photos, [takaya, another])).toEqual([]);
    });

    /// 🔴 **撮影位置と被写体の位置が違う。** 「富士山を離れた場所から
    /// 撮影した写真と富士山そのものの地点」（指示書の言葉）
    it("撮影位置が遠い写真は曖昧として止め、書き込まれない", () => {
        const fuji = spot({ spotId: "sp_fuji", name: "富士山", coords: { lat: 35.36, lng: 138.73 } });
        const far = photo({ id: "p1", location: "富士山",
            coords: { lat: 35.36 + LINK_CONFLICT_KM / 100, lng: 138.73 } });
        expect(linkStates([far], [fuji])[0].verdict).toBe("ambiguous");
        expect(writable([far], [fuji])).toEqual([]);
    });

    /// **座標が近くても格上げしない**（被写体と撮影位置は別）
    it("座標が近くても『確認済み』にはならない", () => {
        const near = photo({ id: "p1", location: "高屋神社", coords: { lat: 34.14, lng: 133.66 } });
        expect(linkStates([near], [takaya])[0].verdict).toBe("candidate");
        expect(writable([near], [takaya])).toEqual([]);
    });

    it("座標が無い写真も候補止まり", () => {
        const photos = [photo({ id: "p1", location: "高屋神社" })];
        expect(linkStates(photos, [takaya])[0].reason).toContain("座標が無い");
        expect(writable(photos, [takaya])).toEqual([]);
    });

    /// 🔴 **広い地域名。** 台帳に無ければ当然だが、**在っても候補止まり**
    it("広い地域名だけの写真は書き込まれない", () => {
        const region = spot({ spotId: "sp_paris", name: "パリ" });
        const photos = [photo({ id: "p1", location: "パリ" })];
        expect(writable(photos, [region])).toEqual([]);
        // 台帳に無ければ未紐付け
        expect(linkStates(photos, [takaya])[0].verdict).toBe("unlinked");
    });

    it("撮影地が空の写真は未紐付け", () => {
        expect(linkStates([photo({ id: "p1" })], [takaya])[0].verdict).toBe("unlinked");
    });
});

describe("人が確認したものだけ書き込む", () => {
    const takaya = spot({ spotId: "sp_takaya", name: "高屋神社" });

    it("記録があれば確認済みになり、書き込み対象になる", () => {
        const photos = [photo({ id: "p1", location: "高屋神社" })];
        const confs = [confirmation({ photoId: "p1", spotId: "sp_takaya" })];
        const states = linkStates(photos, [takaya], confs);
        expect(states[0].verdict).toBe("confirmed");
        // **誰が・いつ・何を根拠に**が読める形で残っている
        expect(states[0].reason).toContain("owner");
        expect(states[0].reason).toContain("2026-09-22");
        expect(states[0].reason).toContain("現地で撮影");
        expect(writable(photos, [takaya], confs)).toEqual(["p1"]);
    });

    /// 🔴 **存在しない spotId。** 記録があっても、指す先が無ければ書かない
    it("台帳に無い spotId を指す記録は書き込まれない", () => {
        const photos = [photo({ id: "p1", location: "高屋神社" })];
        const confs = [confirmation({ photoId: "p1", spotId: "sp_missing" })];
        expect(linkStates(photos, [takaya], confs)[0].verdict).toBe("ambiguous");
        expect(writable(photos, [takaya], confs)).toEqual([]);
    });

    /// 🔴 **非公開写真**
    it("非公開の写真は、記録があっても書き込まれない", () => {
        const photos = [photo({ id: "p1", location: "高屋神社", published: false })];
        const confs = [confirmation({ photoId: "p1", spotId: "sp_takaya" })];
        expect(linkStates(photos, [takaya], confs)[0].verdict).toBe("ambiguous");
        expect(writable(photos, [takaya], confs)).toEqual([]);
    });

    /// 🔴 **削除済みの写真**——一覧に無いものは、記録があっても対象にならない
    it("削除された写真の記録は、対象そのものが出てこない", () => {
        const confs = [confirmation({ photoId: "deleted", spotId: "sp_takaya" })];
        expect(writable([], [takaya], confs)).toEqual([]);
    });

    /// 🔴 **既に spotId を持つ写真は触らない**（人が直したものを巻き戻さない）
    it("既に紐づいている写真は書き込み対象にしない", () => {
        const photos = [photo({ id: "p1", location: "高屋神社", spotId: "sp_other" })];
        const states = linkStates(photos, [takaya]);
        expect(states[0].reason).toContain("既に紐づいている");
        // 書き込みの関門は `spotId` が有るので通してしまわないか——
        // **書き込み側は `attribute_not_exists(spotId)` で拒む**（下の注記）
        expect(states[0].spotId).toBe("sp_other");
    });

    /// **記録の形が壊れていたら、確認済みとして扱わない**
    it("確認者や根拠が空の記録は無いものとして扱う", () => {
        const photos = [photo({ id: "p1", location: "高屋神社" })];
        for (const broken of [
            { photoId: "p1", spotId: "sp_takaya", confirmedBy: "", confirmedAt: "2026-09-22", evidence: "x" },
            { photoId: "p1", spotId: "sp_takaya", confirmedBy: "owner", confirmedAt: "", evidence: "x" },
            { photoId: "p1", spotId: "sp_takaya", confirmedBy: "owner", confirmedAt: "2026-09-22", evidence: "" },
            { photoId: "p1", spotId: "sp_takaya" },
            null, "confirmed", 42,
        ]) {
            expect(isUsableConfirmation(broken)).toBe(false);
            expect(writable(photos, [takaya], [broken])).toEqual([]);
        }
    });
});

describe("書き込みの関門", () => {
    const takaya = spot({ spotId: "sp_takaya", name: "高屋神社" });

    /// 🔴 **判定側が間違っても、ここで止まる**（二重の守り）。
    /// 指示書:「書き込み処理の側で、確認済みの対象以外は拒否してください」
    it("確認済み以外は、判定が何を言っても通さない", () => {
        const fake = [
            { photoId: "p1", location: "x", spotId: "sp_takaya", verdict: "candidate" as const, reason: "" },
            { photoId: "p2", location: "x", spotId: "sp_takaya", verdict: "ambiguous" as const, reason: "" },
            { photoId: "p3", location: "x", verdict: "unlinked" as const, reason: "" },
        ];
        expect(writableLinks(fake)).toEqual([]);
    });

    /// `spotId` の無い「確認済み」も通さない（行き先が無い）
    it("行き先の無い確認済みは通さない", () => {
        expect(writableLinks([
            { photoId: "p1", location: "x", verdict: "confirmed", reason: "" },
        ])).toEqual([]);
    });
});
