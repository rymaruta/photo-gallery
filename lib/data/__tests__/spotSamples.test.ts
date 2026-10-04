import { describe, it, expect } from "vitest";
import rawLedger from "../../../content/spots.json";
import rawSamples from "../../../content/spot-samples.json";
import type { Spot } from "../spots";
import {
    toSpotSample, spotSamples, sampleLicenseKind, sampleImageObject, titleFromFile, PUBLIC_DOMAIN_MARK_URL, MAX_SHOWN_SAMPLES,
    type SpotSampleRecord, type SpotSamplesFile,
} from "../spotSamples";
import { isPublished } from "../../utils/spotGuide";
import {
    cleanCommonsAuthor, isPlaceholderAuthor, isUsOnlyPublicDomain, EVENT_OR_PERSON, isEventSpot, hasPdBasis, pdBasisOf, photoLicenseOf,
} from "../../utils/commonsAttribution.mjs";
import { spotStructuredData } from "../spotSeo";
import { commonsThumbAt, commonsSrcSet } from "../../utils/commonsThumb";

/**
 * **撮影地の作例（`content/spot-samples.json`）の読み込み。**
 *
 * 画面とアプリに渡る1枚は、必ず作者・ライセンス・出典（Commons のページ）を持つ。
 * 欠けた1枚・使えないライセンスの1枚は、ここで落ちる（画面が表示を忘れる余地を作らない）。
 */

const REC: SpotSampleRecord = {
    file: "File:A.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/1280px-A.jpg",
    width: 1280, height: 853,
    author: "撮った人",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    dateTimeOriginal: "2014-03-17 15:46:26",
    pickedBy: "auto",
};

/** 本物の台帳の公開済みの1件（公開の門 `isPublished` を作り物で通す手間を省く） */
const SPOT = (rawLedger as unknown as Spot[]).find((s) => s.slug === "kinkakuji")!;

describe("1枚を表示の形へ", () => {
    it("作者・ライセンス・ライセンスの文面・出典・寸法を運ぶ", () => {
        expect(toSpotSample(REC)).toEqual({
            src: REC.thumbUrl, width: 1280, height: 853, title: "A", author: "撮った人",
            license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
            sourceUrl: REC.pageUrl, takenAt: "2014-03-17 15:46:26",
        });
    });

    it("🔴 NC（商用不可）・ND（改変不可）・その他のライセンスは落とす", () => {
        for (const license of ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "CC-BY-NC-ND-3.0", "GFDL", "All rights reserved", ""]) {
            expect(toSpotSample({ ...REC, license }), license).toBeUndefined();
        }
    });

    it("書き方の揺れ（CC-BY-SA-3.0）は許し、CC0・パブリックドメインは文面の URL が無くてもよい", () => {
        expect(sampleLicenseKind("CC-BY-SA-3.0")).toBe("cc-by-sa");
        expect(sampleLicenseKind("CC BY 2.0")).toBe("cc-by");
        expect(toSpotSample({ ...REC, license: "CC-BY-SA-3.0" })?.license).toBe("CC-BY-SA-3.0");
        expect(toSpotSample({ ...REC, license: "CC0", licenseUrl: undefined })).toBeTruthy();
        expect(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "PD-self" })).toBeTruthy();
    });

    it("🔴 作者が空・CC BY 系で文面の URL が無い・出典や画像が Commons でないものは落とす", () => {
        expect(toSpotSample({ ...REC, author: "  " })).toBeUndefined();
        expect(toSpotSample({ ...REC, licenseUrl: undefined })).toBeUndefined();
        expect(toSpotSample({ ...REC, pageUrl: "https://example.com/A.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...REC, thumbUrl: "https://example.com/A.jpg" })).toBeUndefined();
        expect(toSpotSample({ ...REC, width: 0 })).toBeUndefined();
    });

    it("http の URL は https に上げ、作者の「( talk )」は落とす", () => {
        const s = toSpotSample({ ...REC, licenseUrl: "http://creativecommons.org/licenses/by-sa/4.0", author: "663highland ( talk )" })!;
        expect(s.licenseUrl).toBe("https://creativecommons.org/licenses/by-sa/4.0");
        expect(s.author).toBe("663highland");
    });
});

describe("スポットの作例", () => {
    const file: SpotSamplesFile = {
        [SPOT.spotId]: { slug: "s", name: "s", samples: [
            REC,
            { ...REC, file: "File:B.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:B.jpg", license: "CC BY-NC 2.0" },
            { ...REC, file: "File:C.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:C.jpg" },
            REC, // 同じ写真を2度書いても1枚
            ...[1, 2, 3, 4, 5, 6].map((i) => ({ ...REC, file: `File:D${i}.jpg`, pageUrl: `https://commons.wikimedia.org/wiki/File:D${i}.jpg` })),
        ] },
    };

    it("前提: 使うスポットは公開済み", () => {
        expect(SPOT?.status).toBe("published");
        expect(isPublished(SPOT)).toBe(true);
    });

    it("使えない1枚と重複を落とし、最大6枚", () => {
        const out = spotSamples(SPOT, { file });
        expect(out).toHaveLength(6);
        expect(out.map((s) => s.sourceUrl)).not.toContain("https://commons.wikimedia.org/wiki/File:B.jpg");
        expect(new Set(out.map((s) => s.sourceUrl)).size).toBe(6);
    });

    it("代表写真と同じ写真は出さない（exclude）", () => {
        const out = spotSamples(SPOT, { file, exclude: [REC.pageUrl] });
        expect(out.map((s) => s.sourceUrl)).not.toContain(REC.pageUrl);
        expect(out.length).toBeGreaterThan(0);
    });

    it("下書きのスポットには付けない", () => {
        expect(spotSamples({ ...SPOT, status: "review", verifiedBy: undefined, verifiedAt: undefined } as Spot, { file })).toEqual([]);
    });

    it("構造化データの ImageObject は作者・ライセンス・出典・表示の文字を必ず持つ", () => {
        expect(sampleImageObject(toSpotSample(REC)!)).toEqual({
            "@type": "ImageObject",
            name: "A",
            contentUrl: REC.thumbUrl, width: 1280, height: 853,
            creator: { "@type": "Person", name: "撮った人" },
            creditText: "撮った人 / CC BY-SA 4.0 / Wikimedia Commons",
            license: "https://creativecommons.org/licenses/by-sa/4.0",
            acquireLicensePage: REC.pageUrl,
        });
    });
});

describe("レビュー #272 の直し（表示側で守る＝確定ファイルを直さなくても効く）", () => {
    it.each([
        "コンピュータが読み取れる情報は提供されていませんが、 Yearofthedragon だと推定されます（著作権の主張に基づく）",
        "Own work", "投稿者自身による著作物", "Unknown author", "不明 Unknown author",
        "I would appreciate being notified if you use my work outside Wikimedia. More of my work can be found in my personal gallery .",
        "takami torao ( Koiroha ( talk ) 15:33, 9 December 2009 (UTC))",
    ])("🔴 CC BY 系で作者が決まり文句・お願い文（%s）なら出さない", (author) => {
        expect(toSpotSample({ ...REC, author })).toBeUndefined();
    });

    it("パブリックドメイン・CC0 は決まり文句なら「作者不明」。飾り（( talk )・Taken with）は落とす", () => {
        expect(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "PD-self", author: "Unknown author" })?.author).toBe("作者不明");
        expect(toSpotSample({ ...REC, author: "photo: Qurren ( talk ) Taken with Canon IXY 10S (Digital IXUS 210)" })?.author).toBe("Qurren");
        expect(toSpotSample({ ...REC, author: "そらみみ This photo was taken with iPhone 5" })?.author).toBe("そらみみ");
        expect(toSpotSample({ ...REC, author: "User:MatthiasKabel" })?.author).toBe("MatthiasKabel");
    });

    it("🔴 アメリカだけのパブリックドメイン（PD-US）・人物の権利の印は出さない", () => {
        expect(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "pd-us-expired" })).toBeUndefined();
        expect(toSpotSample({ ...REC, license: "PD-US", licenseUrl: undefined })).toBeUndefined();
        expect(toSpotSample({ ...REC, personality: true })).toBeUndefined();
    });

    it("🔴 元画像の URL は標準の幅（元より小さい 960）の縮小版に替える", () => {
        const s = toSpotSample({ ...REC, thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg", width: 1200, height: 800 })!;
        expect(s.src).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/960px-A.jpg");
        expect([s.width, s.height]).toEqual([960, 640]);
        // 小さすぎて縮小版を作れない元画像は出さない
        expect(toSpotSample({ ...REC, thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg", width: 200, height: 150 })).toBeUndefined();
    });

    it("題はファイル名から（File: と拡張子を除く）", () => {
        expect(titleFromFile("File:Kinkaku-ji 金閣寺 (19885297879).jpg")).toBe("Kinkaku-ji 金閣寺 (19885297879)");
        expect(titleFromFile("File:Hondo_of_Kiyomizudera_Temple.JPG")).toBe("Hondo of Kiyomizudera Temple");
    });

    it("人や催しが主役の写真（Festival・Rallye）は出さない。撮影地が祭りなら出す", () => {
        const fest = { ...REC, file: "File:Kyoto Festival 2019.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:F.jpg" };
        const file: SpotSamplesFile = { [SPOT.spotId]: { slug: "s", name: "s", samples: [fest, REC] } };
        expect(spotSamples(SPOT, { file }).map((s) => s.sourceUrl)).toEqual([REC.pageUrl]);
        expect(spotSamples({ ...SPOT, category: "祭り" }, { file })).toHaveLength(2);
        const rally = { ...REC, file: "File:Rallye Japan 2010.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:R.jpg" };
        expect(spotSamples(SPOT, { file: { [SPOT.spotId]: { slug: "s", name: "s", samples: [rally] } } })).toEqual([]);
        // 建物の名前（Festival Hall・concert hall）は催しではない
        const hall = { ...REC, file: "File:Hida-Furukawa Festival Hall in winter.JPG", pageUrl: "https://commons.wikimedia.org/wiki/File:Hall.jpg" };
        expect(spotSamples(SPOT, { file: { [SPOT.spotId]: { slug: "s", name: "s", samples: [hall] } } })).toHaveLength(1);
    });

    it("reviewedOnly は人・目で見て選んだもの（pickedBy が auto 以外）だけ", () => {
        const human = { ...REC, file: "File:H.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:H.jpg", pickedBy: "visual-review" };
        const file: SpotSamplesFile = { [SPOT.spotId]: { slug: "s", name: "s", samples: [REC, human] } };
        expect(spotSamples(SPOT, { file, reviewedOnly: true }).map((s) => s.sourceUrl)).toEqual([human.pageUrl]);
        expect(spotSamples(SPOT, { file })).toHaveLength(2);
    });

    it("構造化データ: 作者不明なら creator を書かない・パブリックドメインは Public Domain Mark", () => {
        const pd = sampleImageObject(toSpotSample({ ...REC, license: "Public domain", licenseUrl: undefined, licenseCode: "PD-self", author: "Unknown author" })!);
        expect(pd).not.toHaveProperty("creator");
        expect(pd.license).toBe(PUBLIC_DOMAIN_MARK_URL);
        expect(sampleImageObject(toSpotSample(REC)!).creator).toEqual({ "@type": "Person", name: "撮った人" });
        // 団体と分かる名前は Organization
        const army = toSpotSample({ ...REC, author: "France. Section photographique des armées (Army Photography Section of France)" })!;
        expect(sampleImageObject(army).creator).toEqual({ "@type": "Organization", name: army.author });
    });
});

describe("パブリックドメインの根拠（レビュー #275 の 1）", () => {
    const PD: SpotSampleRecord = { ...REC, license: "Public domain", licenseUrl: undefined };

    it("🔴 根拠のテンプレートが分からない \"Public domain\" は出さない（PD-US と見分けられない）", () => {
        expect(toSpotSample(PD)).toBeUndefined();
        expect(toSpotSample({ ...PD, licenseCode: "pd" })).toBeUndefined(); // extmetadata の総称
        expect(toSpotSample({ ...PD, licenseCode: "PD-self" })).toBeTruthy();
    });

    it("🔴 アメリカだけの根拠（PD-US-expired・PD-USGov-…）は出さない。PD-user は PD-US ではない", () => {
        for (const code of ["PD-US-expired", "PD-USGov-POTUS", "PD-US", "pd-us-no-notice"]) {
            expect(toSpotSample({ ...PD, licenseCode: code }), code).toBeUndefined();
        }
        expect(isUsOnlyPublicDomain("Public domain", "PD-user")).toBe(false);
        expect(toSpotSample({ ...PD, licenseCode: "PD-user" })).toBeTruthy();
        expect(isUsOnlyPublicDomain("Public domain", "PD-USGov")).toBe(true);
    });

    it("表示の名前に根拠を添える（Public domain (PD-Japan)）。種類の判定は括弧を見ない", () => {
        expect(toSpotSample({ ...PD, licenseCode: "PD-Japan" })?.license).toBe("Public domain (PD-Japan)");
        expect(sampleLicenseKind("Public domain (PD-Japan)")).toBe("public-domain");
        expect(sampleImageObject(toSpotSample({ ...PD, licenseCode: "PD-Japan" })!).license).toBe(PUBLIC_DOMAIN_MARK_URL);
        // CC の表示は変えない
        expect(toSpotSample(REC)?.license).toBe("CC BY-SA 4.0");
    });

    it("根拠はページのテンプレートから選ぶ: 部品は除き、日本でも通る根拠を先に", () => {
        expect(pdBasisOf(["Template:PD-Layout", "Template:PD-self", "Template:Self"])).toBe("PD-self");
        // PD-Japan と PD-US-expired の両方が付く古写真は日本の根拠で使える
        expect(pdBasisOf(["Template:PD-Japan", "Template:PD-Japan/en", "Template:PD-US-expired-text",
            "Template:PD-old-X-expired", "Template:PD-old-auto-expired", "Template:PD-two", "Template:PD-Layout"])).toBe("PD-Japan");
        // アメリカの根拠しか無ければそれを返す（表示で落ちる）
        expect(pdBasisOf(["Template:PD-Layout", "Template:PD-USGov-POTUS", "Template:PD-USGov-POTUS/en"])).toBe("PD-USGov-POTUS");
        // 転送の名前（Pd-old）は PD- にそろえる・根拠が無ければ undefined
        expect(pdBasisOf(["Template:Pd-old", "Template:PD-old-text"])).toBe("PD-old");
        expect(pdBasisOf(["Template:PD-Layout", "Template:Information"])).toBeUndefined();
        expect(pdBasisOf([])).toBeUndefined();
    });

    it("🔴 日本でも通る根拠を先に: PD-Yugoslavia＋PD-US-expired は PD-Yugoslavia（名前の順に関係なく）", () => {
        expect(pdBasisOf(["Template:PD-US-expired", "Template:PD-Yugoslavia"])).toBe("PD-Yugoslavia");
        expect(pdBasisOf(["Template:PD-Yugoslavia", "Template:PD-US-expired"])).toBe("PD-Yugoslavia");
        expect(pdBasisOf(["Template:PD-USGov", "Template:PD-Art"])).toBe("PD-Art");
    });

    it("🔴 CC・GFDL が一緒に付く PD: 写真そのものが CC BY なら CC BY、決められなければ表示しない", () => {
        // 若狭の歌碑（File:Wakasa Kouta.jpg・2026-10-03 に取ったテンプレートの並び）。
        // 歌は PD-Japan、写真は Self＋Cc-by-3.0＋GFDL で、作者の欄は歌の作者（野口雨情）＝決められない
        const wakasa = ["Cc-by-3.0", "Cc-by-layout", "Cc-pd-mark-footer", "City", "Creator", "GFDL", "GNU-Layout",
            "Information", "PD-1996-text", "PD-Japan", "PD-Layout", "PD-old-X-1996", "PD-old-auto-1996", "PD-old-text",
            "PD-old-warning-text", "PD-two", "SDC-PD-old", "Self", "Taken on", "URAA-date"].map((t) => `Template:${t}`);
        expect(photoLicenseOf(wakasa)).toEqual({ kind: "unknown", code: "mixed:PD-Japan,Cc-by-3.0,GFDL" });
        expect(toSpotSample({ ...PD, author: "野口雨情", licenseCode: "mixed:PD-Japan,Cc-by-3.0,GFDL" })).toBeUndefined();
        // 桂浜の龍馬像（Art Photo: 像は PD-Japan、写真は Cc-by-3.0）
        expect(photoLicenseOf(["Art Photo", "Cc-by-3.0", "Cc-by-layout", "Cc-pd-mark-footer", "PD-Japan", "PD-US-expired-text", "PD-two"]))
            .toEqual({ kind: "cc", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", code: "cc-by-3.0" });
        // プラハ城の展示（Self-photographed＋Cc-by-3.0-de）
        expect(photoLicenseOf(["Cc-by-3.0-de", "Cc-by-layout", "Cc-country-flags", "Own photograph", "PD-old", "Pd-old", "Self-photographed"]))
            .toMatchObject({ kind: "cc", license: "CC BY 3.0 de", licenseUrl: "https://creativecommons.org/licenses/by/3.0/de/" });
        // CC0 が付く・写真の印が無いものも決めない
        expect(photoLicenseOf(["Art Photo", "Cc-zero", "PD-old"]).kind).toBe("unknown");
        expect(photoLicenseOf(["Cc-by-sa-4.0", "PD-old"]).kind).toBe("unknown");
        // 部品（Cc-pd-mark-footer・Cc-by-layout）だけなら PD のまま
        expect(photoLicenseOf(["Cc-pd-mark-footer", "PD-old", "PD-Layout"])).toEqual({ kind: "pd", code: "PD-old" });
    });

    it("🔴 リポジトリの確定ファイル: パブリックドメインの行はどれも根拠を持つか、決められない印（mixed:）が付く", () => {
        const rows = Object.values(rawSamples as unknown as SpotSamplesFile).flatMap((e) => e.samples)
            .filter((r) => sampleLicenseKind(r.license) === "public-domain");
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter((r) => !hasPdBasis(r.licenseCode) && !String(r.licenseCode ?? "").startsWith("mixed:")).map((r) => r.file)).toEqual([]);
    });

    it("🔴 リポジトリの確定ファイル: 若狭の歌碑は表示しない・桂浜の龍馬像は CC BY 3.0（撮影者 baggio4ever）", () => {
        const rows = Object.values(rawSamples as unknown as SpotSamplesFile).flatMap((e) => e.samples);
        const wakasa = rows.find((r) => r.file === "File:Wakasa Kouta.jpg");
        if (wakasa) expect(toSpotSample(wakasa)).toBeUndefined();
        const ryoma = rows.filter((r) => /坂本龍馬像[13] Katsura-hama/.test(r.file ?? ""));
        for (const r of ryoma) {
            expect(toSpotSample(r)).toMatchObject({ license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", author: "baggio4ever" });
        }
    });
});

describe("Commons の縮小版の URL", () => {
    it("/1280px- を標準の幅に置き換える。形が違えば作らない", () => {
        expect(commonsThumbAt(REC.thumbUrl, 500)).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg");
        expect(commonsThumbAt("https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg", 500)).toBeUndefined();
        expect(commonsThumbAt("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/400px-A.jpg", 500)).toBeUndefined();
        expect(commonsSrcSet(REC.thumbUrl, 1280)).toBe(
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg 500w, "
            + "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/960px-A.jpg 960w, "
            + `${REC.thumbUrl} 1280w`);
    });
});

describe("リポジトリの確定ファイル", () => {
    const ledger = rawLedger as unknown as Spot[];
    const file = rawSamples as unknown as SpotSamplesFile;

    /**
     * 表示で落ちてよいのは**決めた理由**（作者が名前でない・PD-US・人物の印・人や催しが主役）だけ。
     * URL の欠け・知らないライセンスなど、それ以外の理由で黙って落ちる1枚は無い
     * （確定ファイルは人が手で直すので、書き間違いをここで捕まえる）
     */
    const explained = (r: SpotSampleRecord, spot: Spot) => {
        const author = cleanCommonsAuthor(String(r.author ?? "").replace(/\s*\(\s*talk\s*\)\s*$/i, ""));
        const by = /^cc[-\s]by/i.test(r.license);
        return (by && isPlaceholderAuthor(author)) || isUsOnlyPublicDomain(r.license, r.licenseCode) || r.personality === true
            || String(r.licenseCode ?? "").startsWith("mixed:")
            || (!isEventSpot(spot) && EVENT_OR_PERSON.test(r.file ?? ""));
    };

    it("🔴 書いてある1枚は、決めた理由で落とすもの以外どれも表示の形にできる", () => {
        for (const [spotId, entry] of Object.entries(file)) {
            const spot = ledger.find((s) => s.spotId === spotId)!;
            for (const r of entry.samples) {
                if (explained(r, spot)) continue;
                expect(toSpotSample(r), `${spotId} ${r.file}`).toBeTruthy();
            }
        }
    });

    it("公開済みのスポットで、落とす理由の無い1枚はそのまま出る", () => {
        for (const [spotId, entry] of Object.entries(file)) {
            const spot = ledger.find((s) => s.spotId === spotId)!;
            const expected = Math.min(MAX_SHOWN_SAMPLES, entry.samples.filter((r) => !explained(r, spot)).length);
            expect(spotSamples(spot, { file }).length, spot.slug).toBe(expected);
        }
    });
});

describe("撮影地ページの構造化データへの渡し方（レビュー #275 の 2）", () => {
    it("🔴 構造化データには画面に出す作例を全部渡す（自動で選んだものも）", async () => {
        const fs = await import("node:fs");
        const src = fs.readFileSync(`${__dirname}/../../../app/components/SpotGuidePage.tsx`, "utf8");
        expect(src).toMatch(/const samples = spotSamples\(spot, \{ exclude: \[cover\?\.sourceUrl\] \}\);/);
        expect(src).toMatch(/spotStructuredData\(spot, \{ image: coverUrl, samples \}\)/);
        expect(src).toMatch(/samples=\{samples\}/);
        expect(src).not.toMatch(/reviewedOnly/);
    });

    it("🔴 実データ: 画面に出す作例は全部 ImageObject になり、ライセンス・出典・表示の文字を持つ", () => {
        const ledger = rawLedger as unknown as Spot[];
        let autoCount = 0;
        let checked = 0;
        for (const spotId of Object.keys(rawSamples)) {
            const spot = ledger.find((s) => s.spotId === spotId);
            if (!spot || !isPublished(spot)) continue;
            const shown = spotSamples(spot);
            const data = spotStructuredData(spot, { image: "https://example.com/c.jpg", samples: shown });
            const objects = shown.length > 0 ? (data.image as unknown[]).slice(1) as ReturnType<typeof sampleImageObject>[] : [];
            expect(objects.map((o) => o.contentUrl), spot.slug).toEqual(shown.map((s) => s.src));
            objects.forEach((o, i) => {
                expect(o.license, `${spot.slug} ${o.name}`).toMatch(/^https:\/\//);
                // サイトに置いた写真（環境省・県の観光協会など・2026-10-04）は規約のページと出典の文
                // （`spotSamplesHosted.test.ts`）。ここでは Commons の行を見る
                if (shown[i].source) {
                    expect(o.acquireLicensePage).toMatch(/^https:\/\//);
                    expect(o.creditText).toBeTruthy();
                    return;
                }
                expect(o.acquireLicensePage).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
                expect(o.creditText).toMatch(/ \/ .+ \/ Wikimedia Commons$/);
                checked++;
            });
            const recs = (rawSamples as unknown as SpotSamplesFile)[spotId].samples;
            autoCount += shown.filter((s) => recs.find((r) => r.pageUrl?.replace(/^http:/, "https:") === s.sourceUrl)?.pickedBy === "auto").length;
        }
        expect(checked).toBeGreaterThan(1000);
        expect(autoCount).toBeGreaterThan(0); // 自動で選んだ作例も入っている
    });
});
