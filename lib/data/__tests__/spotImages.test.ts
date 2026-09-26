import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import type { Spot } from "../spots";
import { cleanAuthor, coverLicenseOf, shownSpotImage, spotCoverImage, type SpotImage } from "../spotImages";

// 実際の台帳から、AI 照合で写真も照らした公開済みの行を土台にする
const ledger = rawLedger as unknown as Spot[];
const base = ledger.find((s) => s.slug === "himeji-castle")!;

const IMAGE: SpotImage = {
    wikidata: "Q1", file: "File:X.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg",
    author: "Someone", license: "CC BY-SA 4.0",
    method: "wikidata-P18", fetchedAt: "2026-09-26", reviewedBy: null,
    local: { src: "/images/spots/himeji-castle.jpg", width: 960, height: 640 },
};
const images = (image: Partial<SpotImage> = {}) => ({ [base.slug]: { ...IMAGE, ...image } });

describe("スポットの写真（Commons）", () => {
    it("土台の行は、AI 照合で写真も照らした公開済みの行", () => {
        expect(base.status).toBe("published");
        expect(base.aiCheck?.imageChecked).toBe(true);
    });

    it("代表写真は、サイトに置いた縮小版から組み立て、出典のページと表示の文を持つ", () => {
        const cover = spotCoverImage(base, images());
        expect(cover).toMatchObject({
            src: "/images/spots/himeji-castle.jpg",
            license: "cc-by-sa",
            credit: "Someone",
            sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg",
            verifiedPlace: true,
            checkedAt: base.aiCheck!.checkedAt,
        });
        expect(cover).toMatchObject({ licenseLabel: "CC BY-SA 4.0" });
        expect(cover!.aspectRatio).toBeCloseTo(1.5);
    });

    it("サイトに置いていない写真は使わない（外部へのホットリンクはしない）", () => {
        expect(spotCoverImage(base, images({ local: undefined }))).toBeUndefined();
    });

    it("下書き・写真を照らしていない・座標がずれている行には出さない", () => {
        expect(shownSpotImage({ ...base, status: "review" }, images())).toBeUndefined();
        expect(shownSpotImage({ ...base, aiCheck: { ...base.aiCheck!, imageChecked: false } }, images())).toBeUndefined();
        expect(shownSpotImage(base, images({ coordsMismatch: true }))).toBeUndefined();
        // 人が確かめた写真なら、AI 照合の印が無くても出す
        expect(shownSpotImage({ ...base, aiCheck: { ...base.aiCheck!, imageChecked: false } }, images({ reviewedBy: "rymaruta" }))).toBeDefined();
    });

    it("台帳が自前の代表写真を持てば、そちらを優先する", () => {
        const own = { src: "/images/own.jpg", alt: "a", credit: "c", license: "owner" as const, checkedAt: "2026-09-26", verifiedPlace: true };
        expect(spotCoverImage({ ...base, coverImage: own }, images())).toBe(own);
    });

    it("ライセンスの読み替え。NC・ND・読めないものは使わない", () => {
        expect(coverLicenseOf("CC0")).toBe("cc0");
        expect(coverLicenseOf("Public domain")).toBe("public-domain");
        expect(coverLicenseOf("CC BY-SA 3.0")).toBe("cc-by-sa");
        expect(coverLicenseOf("CC BY 2.5")).toBe("cc-by");
        expect(coverLicenseOf("CC BY-NC 2.0")).toBeUndefined();
        expect(coverLicenseOf("CC BY-ND 4.0")).toBeUndefined();
        expect(coverLicenseOf("GFDL")).toBeUndefined();
        // NC・ND は順番や区切りが揺れても通さない（レビューで見つかった抜け）
        expect(coverLicenseOf("CC BY-SA-NC 2.0")).toBeUndefined();
        expect(coverLicenseOf("CC BY NC 2.0")).toBeUndefined();
        expect(coverLicenseOf("CC BY-NC-SA 2.0")).toBeUndefined();
        expect(coverLicenseOf("CC BY-SA 2.0 de")).toBe("cc-by-sa");
        expect(coverLicenseOf("PD-self")).toBe("public-domain");
        expect(coverLicenseOf("Pdf")).toBeUndefined();
        expect(spotCoverImage(base, images({ license: "CC BY-NC 2.0" }))).toBeUndefined();
    });
});

describe("作者の表記", () => {
    it("Wiki の「( talk )」だけ落とし、作者の求める表記は残す", () => {
        expect(cleanAuthor("Sakaori ( talk )")).toBe("Sakaori");
        expect(cleanAuthor("Ans~jawiki at Japanese Wikipedia")).toBe("Ans~jawiki at Japanese Wikipedia");
    });

    it("ライセンスの文面の URL は https にそろえる", () => {
        const cover = spotCoverImage(base, images({ licenseUrl: "http://creativecommons.org/licenses/by-sa/3.0/" }));
        expect(cover!.licenseUrl).toBe("https://creativecommons.org/licenses/by-sa/3.0/");
    });
});
