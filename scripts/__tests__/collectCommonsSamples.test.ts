import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
    parseCommonsPages, plainDate, nameTerms, scoreCandidate, autoEligible, pickSamples, toSample,
    clampRadius, searchCenters, mergeCandidates, buildSamplesFile, formatCandidatesFile, trimCandidates, KEEP_CANDIDATES,
    geosearchParams, EXTMETA, readJson, writeFileAtomic, safeWikidataCoords, forCandidatesFile,
    CANDIDATES_PATH, SAMPLES_PATH, LEDGER_PATH, MAX_SAMPLES, MIN_INTERVAL_MS, USER_AGENT,
    isPublicDomainRow, filesMissingPdBasis, pdTemplatesParams, applyPdBasis, carryPdBasis, refreshPdBasis,
} from "../collect-commons-samples.mjs";
import { isAllowedLicense, stripHtml } from "../fetch-spot-images.mjs";
import os from "node:os";
import path from "node:path";

/**
 * **撮影地の作例を Commons から集める道具**（`scripts/collect-commons-samples.mjs`）の判定を、
 * 固定データで縛る。通信する部分は試さない（Wikimedia の API は CI から叩かない）。
 */

/** Commons の API（formatversion=2）の1ページ分 */
function page(title: string, over: { license?: string; artist?: string; mime?: string; w?: number; h?: number; date?: string; desc?: string; dist?: number; restrictions?: string; licenseUrl?: string; attribution?: string; credit?: string; code?: string; categories?: string; thumb?: boolean } = {}) {
    const name = title.replace(/^File:/, "").replace(/ /g, "_");
    return {
        pageid: Math.floor(Math.random() * 1e9),
        title,
        coordinates: over.dist === undefined ? undefined : [{ lat: 35, lon: 135, dist: over.dist }],
        imageinfo: [{
            url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
            // 元が 1280px 以下だと API は元画像の URL を返す（thumb: false で再現）
            thumburl: over.thumb === false ? `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}` : `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/1280px-${name}`,
            thumbwidth: over.thumb === false ? over.w : 1280, thumbheight: over.thumb === false ? over.h : 853,
            width: over.w ?? 4000, height: over.h ?? 2667,
            mime: over.mime ?? "image/jpeg",
            descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
            extmetadata: {
                LicenseShortName: { value: over.license ?? "CC BY-SA 4.0" },
                LicenseUrl: { value: over.licenseUrl ?? "https://creativecommons.org/licenses/by-sa/4.0" },
                Artist: { value: over.artist ?? '<a href="//commons.wikimedia.org/wiki/User:X" title="User:X">撮った人</a>' },
                ...(over.date ? { DateTimeOriginal: { value: over.date } } : {}),
                ...(over.attribution !== undefined ? { Attribution: { value: over.attribution } } : {}),
                ...(over.credit !== undefined ? { Credit: { value: over.credit } } : {}),
                ...(over.code !== undefined ? { License: { value: over.code } } : {}),
                ...(over.categories !== undefined ? { Categories: { value: over.categories } } : {}),
                ...(over.desc ? { ImageDescription: { value: over.desc } } : {}),
                ...(over.restrictions ? { Restrictions: { value: over.restrictions } } : {}),
            },
        }],
    };
}

const KINKAKU = {
    spotId: "sp_31047ba6ec8d", slug: "kinkakuji", name: "鹿苑寺（金閣寺）",
    aliases: ["金閣寺", "金閣", "鏡湖池"], coords: { lat: 35.04, lng: 135.73 }, status: "published",
};

describe("ライセンスの選別", () => {
    it("🔴 NC（商用不可）・ND（改変不可）・GFDL だけ・空は落とし、落とした数と名前を数える", () => {
        const { candidates, rejected, rejectedLicenses } = parseCommonsPages([
            page("File:A.jpg", { license: "CC BY-SA 4.0" }),
            page("File:B.jpg", { license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0" }),
            page("File:C.jpg", { license: "CC0", licenseUrl: "" }),
            page("File:D.jpg", { license: "Public domain", licenseUrl: "", artist: "" }),
            page("File:E.jpg", { license: "CC BY-NC 2.0" }),
            page("File:F.jpg", { license: "CC BY-ND 4.0" }),
            page("File:G.jpg", { license: "CC BY-NC-SA 2.0" }),
            page("File:H.jpg", { license: "GFDL" }),
            page("File:I.jpg", { license: "" }),
        ]);
        expect(candidates.map((c) => c.file)).toEqual(["File:A.jpg", "File:B.jpg", "File:C.jpg", "File:D.jpg"]);
        expect(rejected.license).toBe(5);
        expect(rejectedLicenses).toEqual({ "CC BY-NC 2.0": 1, "CC BY-ND 4.0": 1, "CC BY-NC-SA 2.0": 1, GFDL: 1, "(空)": 1 });
        // 判定はスポットの代表写真と同じ関数（同じ規則を2つ持たない）
        for (const c of candidates) expect(isAllowedLicense(c.license)).toBe(true);
    });

    it("CC BY 系で作者が空なら落とす（作者の表示が使う条件）。パブリックドメインは「作者不明」", () => {
        const { candidates, rejected } = parseCommonsPages([
            page("File:A.jpg", { license: "CC BY 4.0", artist: "" }),
            page("File:B.jpg", { license: "Public domain", artist: "", licenseUrl: "" }),
        ]);
        expect(rejected.noAuthor).toBe(1);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].author).toBe("作者不明");
    });

    it("写真でないもの（SVG・TIFF・動画）は落とす", () => {
        const { candidates, rejected } = parseCommonsPages([
            page("File:A.svg", { mime: "image/svg+xml" }),
            page("File:B.tif", { mime: "image/tiff" }),
            page("File:C.webm", { mime: "video/webm" }),
            page("File:D.jpg"),
        ]);
        expect(rejected.notPhoto).toBe(3);
        expect(candidates.map((c) => c.file)).toEqual(["File:D.jpg"]);
    });
});

describe("作者名（レビュー #272 の 1）", () => {
    it("Attribution（作者が求める表記）→ Artist の順。Credit には頼らない", () => {
        const [a] = parseCommonsPages([page("File:A.jpg", { attribution: "Taro Yamada / Wikimedia Commons", artist: "tyamada" })]).candidates;
        expect(a.author).toBe("Taro Yamada / Wikimedia Commons");
        const [b] = parseCommonsPages([page("File:B.jpg", { attribution: "", artist: "tyamada" })]).candidates;
        expect(b.author).toBe("tyamada");
        // Artist が空で Credit だけ（「投稿者自身による著作物」）のものは、CC BY 系なら捨てる
        const r = parseCommonsPages([page("File:C.jpg", { artist: "", credit: "投稿者自身による著作物" })]);
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected.noAuthor).toBe(1);
        expect(EXTMETA).toContain("Attribution");
        expect(EXTMETA).not.toContain("Credit");
    });

    it.each([
        "コンピュータが読み取れる情報は提供されていませんが、 Yearofthedragon だと推定されます（著作権の主張に基づく）",
        "Own work", "投稿者自身による著作物", "Unknown author", "不明 Unknown author", "作者不明",
        "I would appreciate being notified if you use my work outside Wikimedia.",
        "takami torao ( Koiroha ( talk ) 15:33, 9 December 2009 (UTC))",
        "This Photo was taken by Someone . Feel free to use my photos, but please mention me as the author.",
    ])("🔴 決まり文句・お願い文の作者（%s）は CC BY 系なら捨てる", (artist) => {
        const r = parseCommonsPages([page("File:A.jpg", { artist })]);
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected.noAuthor).toBe(1);
    });

    it("決まり文句の作者でもパブリックドメインなら「作者不明」として残す。飾り（( talk )・Taken with …）は落とす", () => {
        const [pd] = parseCommonsPages([page("File:A.jpg", { license: "Public domain", licenseUrl: "", artist: "Unknown author" })]).candidates;
        expect(pd.author).toBe("作者不明");
        const [q] = parseCommonsPages([page("File:B.jpg", { artist: "photo: Qurren ( talk ) Taken with Canon IXY 10S (Digital IXUS 210)" })]).candidates;
        expect(q.author).toBe("Qurren");
    });

    it("英語で取る（日本語にすると作者の欄に決まり文句が付く）", () => {
        expect(geosearchParams({ lat: 35, lng: 135 }, 500).iiextmetadatalanguage).toBe("en");
        expect(geosearchParams({ lat: 35, lng: 135 }, 500).iiextmetadatafilter.split("|")).toEqual(EXTMETA);
    });
});

describe("人物・PD-US・縮小版（レビュー #272 の 7・人物）", () => {
    it("🔴 アメリカだけのパブリックドメイン（PD-US）は捨てる", () => {
        const r = parseCommonsPages([page("File:A.jpg", { license: "Public domain", licenseUrl: "", code: "pd-us-expired" })]);
        expect(r.candidates).toHaveLength(0);
        expect(r.rejectedLicenses).toEqual({ "PD-US": 1 });
    });

    it("人物の権利の印（Restrictions・カテゴリ）があれば候補に印を付け、自動では採らない", () => {
        const [c] = parseCommonsPages([page("File:金閣寺 1.jpg", { categories: "Kinkaku-ji|Personality rights warning" })]).candidates;
        expect(c.personality).toBe(true);
        expect(autoEligible({ ...c, ...scoreCandidate(KINKAKU, c) })).toBe(false);
        expect(toSample({ ...c, score: 1, reasons: [], named: true }).personality).toBe(true);
    });

    it("人や催しが主役の写真（Festival・Rallye・ポートレート）は自動で採らない。撮影地が祭りなら採る", () => {
        const fest = parseCommonsPages([page("File:金閣寺 Festival 2019.jpg")]).candidates[0];
        expect(autoEligible({ ...fest, ...scoreCandidate(KINKAKU, fest) })).toBe(false);
        const kunchi = { spotId: "sp_k", slug: "nagasaki-kunchi", name: "長崎くんち", category: "祭り", aliases: [], status: "published" };
        const k = parseCommonsPages([page("File:長崎くんち Festival.jpg")]).candidates[0];
        expect(autoEligible({ ...k, ...scoreCandidate(kunchi, k) })).toBe(true);
    });

    it("🔴 元が 1280px 以下で API が元画像の URL を返しても、元より小さい標準の幅（960）の縮小版にする", () => {
        const [c] = parseCommonsPages([page("File:Small.jpg", { w: 1200, h: 800, thumb: false })]).candidates;
        expect(c.thumbUrl).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Small.jpg/960px-Small.jpg");
        expect([c.thumbWidth, c.thumbHeight]).toEqual([960, 640]);
        expect(c.width).toBe(1200);
    });
});

describe("ファイルの読み書き・HTML・Wikidata（レビュー #272 の 2・9）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samples-"));

    it("無いときだけ既定値。壊れた JSON は止める（黙って空から始めて上書きしない）", () => {
        expect(readJson(path.join(dir, "none.json"), { a: 1 })).toEqual({ a: 1 });
        const bad = path.join(dir, "bad.json");
        fs.writeFileSync(bad, "{ broken");
        expect(() => readJson(bad, {})).toThrow(/JSON として読めません/);
        expect(() => readJson(dir, {})).toThrow(/読めません/); // ディレクトリ＝読めない
    });

    it("書き込みは一時ファイル → rename（一時ファイルが残らない）", () => {
        const p = path.join(dir, "out.json");
        writeFileAtomic(p, "{\"x\":1}\n");
        expect(JSON.parse(fs.readFileSync(p, "utf8"))).toEqual({ x: 1 });
        expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    });

    it("数字の実体参照を読み、二重にはほどかない", () => {
        expect(stripHtml("&#26481;&#x4EAC; Tower")).toBe("東京 Tower");
        expect(stripHtml("a &amp;lt;b&amp;gt;")).toBe("a &lt;b&gt;");
        expect(stripHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
    });

    it("Wikidata の段が落ちても全体を止めない（空の対応で続ける）", async () => {
        const out = await safeWikidataCoords(["Q1"], async () => { throw new Error("429"); });
        expect(out.size).toBe(0);
        expect((await safeWikidataCoords([], async () => { throw new Error("x"); })).size).toBe(0);
    });

    it("候補ファイルには説明・種類を残さない（レビュー #272 の 8・次の収集から効く）", () => {
        const [c] = parseCommonsPages([page("File:A.jpg", { desc: "長い説明" })]).candidates;
        expect(c.description).toBe("長い説明");
        const kept = forCandidatesFile(c);
        expect(kept).not.toHaveProperty("description");
        expect(kept).not.toHaveProperty("mime");
        expect(kept.file).toBe("File:A.jpg");
    });
});

describe("作者・日時・位置", () => {
    it("作者の欄（HTML）を平文にする", () => {
        const [c] = parseCommonsPages([page("File:A.jpg", {
            artist: '<bdi><a href="https://www.flickr.com/people/x">Jonathan&nbsp;Leung</a> from Manchester &amp; <b>UK</b></bdi>',
        })]).candidates;
        expect(c.author).toBe("Jonathan Leung from Manchester & UK");
    });

    it("撮影日時: 前置きを落とし、アップロード日は撮影日と扱わない", () => {
        expect(plainDate("撮影日：2013年4月1日, 11:03")).toBe("2013年4月1日, 11:03");
        expect(plainDate('<time class="dtstart" datetime="2014-03-17">2014-03-17 15:46:26</time>')).toBe("2014-03-17 15:46:26");
        expect(plainDate("2009年11月15日 (当初のアップロード日)")).toBeUndefined();
        expect(plainDate("Uploaded on 2009-11-15")).toBeUndefined();
        expect(plainDate("")).toBeUndefined();
    });

    it("🔴 写真そのものの撮影位置は持たない（探した中心からの距離だけ）", () => {
        const [c] = parseCommonsPages([page("File:A.jpg", { dist: 123.4 })]).candidates;
        expect(c.distanceM).toBe(123);
        const json = JSON.stringify(c);
        expect(json).not.toMatch(/"lat"|"lon"|"lng"|GPS/i);
        expect(JSON.stringify(toSample({ ...c, score: 1, reasons: [], named: true }))).not.toMatch(/"lat"|"lon"|"lng"|distance/i);
    });
});

describe("代表になりそうな写真を選ぶ規則", () => {
    const parsed = (title: string, over = {}) => {
        const c = parseCommonsPages([page(title, over)]).candidates[0];
        return { ...c, ...scoreCandidate(KINKAKU, c) };
    };

    it("名前の語: 括弧書きの中・別名（3文字以上）・slug を使う。2文字の別名は広すぎるので使わない", () => {
        const t = nameTerms({ ...KINKAKU, aliases: ["金閣寺", "金閣", "鏡湖池"] });
        expect(t.main).toEqual(expect.arrayContaining(["鹿苑寺", "金閣寺"]));
        expect(t.alias).toEqual(["鏡湖池"]);
        expect(t.roman).toEqual(["kinkakuji"]);
        const t2 = nameTerms({ slug: "togetsukyo", name: "嵐山 渡月橋", aliases: ["渡月橋", "桂川"] });
        expect(t2.main).toEqual(expect.arrayContaining(["嵐山渡月橋", "渡月橋"]));
        expect(t2.alias).toEqual([]);
    });

    it("名前が入る・横長・高解像度・撮影日時ありが上に来る。地図や看板は下がる", () => {
        const good = parsed("File:Kinkaku-ji 金閣寺 (1).jpg", { date: "2012-10-03 16:36" });
        const plain = parsed("File:IMG 0001.jpg");
        const sign = parsed("File:金閣寺 案内板.jpg");
        expect(good.named).toBe(true);
        expect(good.reasons).toEqual(expect.arrayContaining(["名前", "英字名", "横長", "高解像度", "撮影日時"]));
        expect(plain.named).toBe(false);
        expect(sign.score).toBeLessThan(good.score);
        // 説明に名前が入っていても当たる
        expect(parsed("File:IMG 0002.jpg", { desc: "<p>鹿苑寺の舎利殿</p>" }).named).toBe(true);
    });

    it("🔴 名前が当たらない・小さい・パノラマ・注意書きつき（人物など）は自動では採らない", () => {
        expect(autoEligible(parsed("File:IMG 0001.jpg"))).toBe(false);
        expect(autoEligible(parsed("File:金閣寺 small.jpg", { w: 800, h: 533 }))).toBe(false);
        expect(autoEligible(parsed("File:金閣寺 pano.jpg", { w: 6000, h: 1500 }))).toBe(false);
        expect(autoEligible(parsed("File:金閣寺 people.jpg", { restrictions: "personality" }))).toBe(false);
        expect(autoEligible(parsed("File:金閣寺 ok.jpg"))).toBe(true);
    });

    it("slug の語が全部入れば英字名の一致（一般語は除く）。縦長は下がるが採れる・向かない語は採らない", () => {
        const bamboo = { spotId: "sp_x", slug: "arashiyama-bamboo-grove", name: "嵐山 竹林の小径", aliases: [], status: "published" };
        const c = parseCommonsPages([page("File:Arashiyama, Chikurin-no-michi (Bamboo Grove Road) -1.jpg", { w: 2667, h: 4000 })]).candidates[0];
        const r = { ...c, ...scoreCandidate(bamboo, c) };
        expect(r.reasons).toEqual(expect.arrayContaining(["英字名", "縦長"]));
        expect(autoEligible(r)).toBe(true);
        const inari = { spotId: "sp_y", slug: "fushimi-inari-taisha", name: "伏見稲荷大社", aliases: [], status: "published" };
        const g = parseCommonsPages([page("File:Fushimi Inari Grand Shrine 1.jpg")]).candidates[0];
        expect(scoreCandidate(inari, g).named).toBe(true);
        // 一般語（taisha）だけでは当たらない
        const t = parseCommonsPages([page("File:Some taisha.jpg")]).candidates[0];
        expect(scoreCandidate(inari, t).named).toBe(false);
        const food = parsed("File:金閣寺 lunch.jpg");
        expect(food.named).toBe(true);
        expect(autoEligible(food)).toBe(false);
    });

    it("最大6枚・同じ作者は2枚まで・点数が同じなら近い順（毎回同じ結果）", () => {
        const list = [
            ...[1, 2, 3, 4].map((i) => parsed(`File:金閣寺 a${i}.jpg`, { artist: "A", dist: i * 10 })),
            ...[1, 2, 3, 4, 5, 6].map((i) => parsed(`File:金閣寺 b${i}.jpg`, { artist: `B${i}`, dist: 100 + i })),
        ];
        const picked = pickSamples(list);
        expect(picked).toHaveLength(MAX_SAMPLES);
        expect(picked.filter((c) => c.author === "A")).toHaveLength(2);
        expect(picked.map((c) => c.file)).toEqual(pickSamples([...list].reverse()).map((c) => c.file));
        expect(picked[0].file).toBe("File:金閣寺 a1.jpg");
    });
});

describe("探し方", () => {
    it("半径は 300〜500m に収める", () => {
        expect(clampRadius(1000)).toBe(500);
        expect(clampRadius(100)).toBe(300);
        expect(clampRadius("400")).toBe(400);
        expect(clampRadius("x")).toBe(500);
    });

    it("中心は台帳の座標＋Wikidata の座標（150m〜3km 離れているときだけ）", () => {
        expect(searchCenters(KINKAKU, undefined)).toEqual([{ lat: 35.04, lng: 135.73, from: "ledger" }]);
        expect(searchCenters(KINKAKU, { lat: 35.0394, lng: 135.7292 })).toHaveLength(1); // 近すぎる（同じ所を2度探さない）
        expect(searchCenters(KINKAKU, { lat: 35.0439, lng: 135.7292 }).map((c) => c.from)).toEqual(["ledger", "wikidata"]);
        expect(searchCenters(KINKAKU, { lat: 35.2, lng: 135.73 })).toHaveLength(1); // 遠すぎる（別の場所）
    });

    it("2つの中心で同じファイルが出たら1つにまとめ、近い方の距離を残す", () => {
        const a = parseCommonsPages([page("File:A.jpg", { dist: 400 })]).candidates;
        const b = parseCommonsPages([page("File:A.jpg", { dist: 50 }), page("File:B.jpg", { dist: 60 })]).candidates;
        const merged = mergeCandidates([a, b]);
        expect(merged.map((c) => [c.file, c.distanceM])).toEqual([["File:A.jpg", 50], ["File:B.jpg", 60]]);
    });

    it("通信は2秒に1回まで・連絡先の分かる User-Agent（CLAUDE.md の約束）", () => {
        expect(MIN_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
        expect(USER_AGENT).toMatch(/journey-photo\.com/);
    });
});

describe("確定ファイルを作る", () => {
    const cand = (file: string, author = "A") => ({ ...parseCommonsPages([page(file, { artist: author })]).candidates[0], score: 10, reasons: [], named: true });

    it("人が選んだ1枚（pickedBy が auto 以外）は消さず先頭に残し、ほかの県の行も残す", () => {
        const human = { ...toSample(cand("File:人が選んだ.jpg")), pickedBy: "rymaruta" };
        const previous = {
            [KINKAKU.spotId]: { slug: "kinkakuji", name: "x", samples: [human, toSample(cand("File:古い自動.jpg"))] },
            sp_other: { slug: "other", name: "y", samples: [toSample(cand("File:O.jpg"))] },
        };
        const out = buildSamplesFile({ spots: { [KINKAKU.spotId]: { candidates: [cand("File:金閣寺1.jpg", "B"), cand("File:金閣寺2.jpg", "C")] } } },
            [KINKAKU], previous);
        expect(out[KINKAKU.spotId].samples.map((s: { file: string }) => s.file)).toEqual(["File:人が選んだ.jpg", "File:金閣寺1.jpg", "File:金閣寺2.jpg"]);
        expect(out.sp_other).toEqual(previous.sp_other);
    });

    it("説明を残していない候補でも、説明で当たった名前を失わずに選び直せる", () => {
        const c0 = parseCommonsPages([page("File:IMG 0002.jpg", { desc: "鹿苑寺の舎利殿" })]).candidates[0];
        const c = forCandidatesFile({ ...c0, ...scoreCandidate(KINKAKU, c0) });
        expect(c.named).toBe(true);
        const out = buildSamplesFile({ spots: { [KINKAKU.spotId]: { candidates: [c] } } }, [KINKAKU], {});
        expect(out[KINKAKU.spotId].samples.map((x: { file: string }) => x.file)).toEqual(["File:IMG 0002.jpg"]);
    });

    it("keep のときは前の確定ファイルのスポットを触らない", () => {
        const previous = { [KINKAKU.spotId]: { slug: "kinkakuji", name: "x", samples: [toSample(cand("File:Old.jpg"))] } };
        const out = buildSamplesFile({ spots: { [KINKAKU.spotId]: { candidates: [cand("File:New.jpg")] } } }, [KINKAKU], previous, true);
        expect(out).toEqual(previous);
    });
});

describe("候補ファイルの書き方", () => {
    it("1候補1行で書き、読み戻すと同じ中身", () => {
        const c = parseCommonsPages([page("File:A.jpg"), page("File:B.jpg")]).candidates;
        const data = { note: "n", radiusM: 500, spots: { sp_b: { slug: "b", candidates: c }, sp_a: { slug: "a", candidates: [] } } };
        const text = formatCandidatesFile(data);
        expect(JSON.parse(text)).toEqual(data);
        expect(text.split("\n").filter((l) => l.includes('"file":"File:'))).toHaveLength(2);
    });

    it("自動で採るものは必ず残し、残りは点数の高い順に KEEP_CANDIDATES 件まで", () => {
        const many = Array.from({ length: 30 }, (_, i) => {
            const c = parseCommonsPages([page(i < 3 ? `File:金閣寺 ${i}.jpg` : `File:IMG ${i}.jpg`, { artist: `A${i}`, dist: i })]).candidates[0];
            return { ...c, ...scoreCandidate(KINKAKU, c) };
        });
        const kept = trimCandidates(many);
        expect(kept).toHaveLength(KEEP_CANDIDATES);
        expect(kept.filter((c) => c.named)).toHaveLength(3);
    });
});

describe("リポジトリに入っている候補・確定ファイル", () => {
    const spots = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as { spotId: string; slug: string; status?: string }[];
    const byId = new Map(spots.map((s) => [s.spotId, s]));
    const samples = JSON.parse(fs.readFileSync(SAMPLES_PATH, "utf8")) as Record<string, { slug: string; samples: Record<string, unknown>[] }>;
    const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8")) as { spots: Record<string, { candidates: Record<string, unknown>[] }> };

    it("確定ファイル: 公開済みのスポットだけ・slug が台帳と一致・最大6枚・許すライセンスだけ・作者と出典あり", () => {
        expect(Object.keys(samples).length).toBeGreaterThan(0);
        for (const [spotId, entry] of Object.entries(samples)) {
            const spot = byId.get(spotId);
            expect(spot, spotId).toBeTruthy();
            expect(spot!.status, spotId).toBe("published");
            expect(entry.slug, spotId).toBe(spot!.slug);
            expect(entry.samples.length, spotId).toBeLessThanOrEqual(MAX_SAMPLES);
            for (const s of entry.samples) {
                // Commons 以外の行（Flickr・サイトに置いた環境省や県の観光協会の写真・2026-10-04）は
                // 収集スクリプトの外で足したもの。決まりは `lib/data/__tests__/spotSamplesFlickr.test.ts`・
                // `spotSamplesHosted.test.ts` が見る
                const source = s.source as { name?: string } | undefined;
                if (source && source.name !== "Wikimedia Commons") {
                    expect(typeof s.pickedBy, `${spotId} ${s.title}`).toBe("string");
                    continue;
                }
                expect(isAllowedLicense(s.license), `${spotId} ${s.file}`).toBe(true);
                expect(String(s.author).trim(), `${spotId} ${s.file}`).not.toBe("");
                expect(s.pageUrl, `${spotId} ${s.file}`).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
                expect(s.thumbUrl, `${spotId} ${s.file}`).toMatch(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//);
                expect(typeof s.pickedBy, `${spotId} ${s.file}`).toBe("string");
            }
        }
    });

    it("🔴 候補ファイルにも NC・ND は入っておらず、写真の撮影位置を持たない", () => {
        for (const [spotId, entry] of Object.entries(candidates.spots)) {
            expect(byId.has(spotId), spotId).toBe(true);
            for (const c of entry.candidates) {
                expect(isAllowedLicense(c.license), `${spotId} ${c.file}`).toBe(true);
                expect(Object.keys(c)).not.toEqual(expect.arrayContaining(["lat"]));
                expect(Object.keys(c)).not.toEqual(expect.arrayContaining(["lng"]));
                expect(Object.keys(c)).not.toEqual(expect.arrayContaining(["coordinates"]));
            }
        }
    });
});

describe("パブリックドメインの根拠を取り直す（レビュー #275 の 1）", () => {
    const pdRow = (file: string, over: Record<string, unknown> = {}) => ({
        file, pageUrl: `https://commons.wikimedia.org/wiki/${file}`, thumbUrl: "https://upload.wikimedia.org/x.jpg",
        width: 1280, height: 853, author: "作者不明", license: "Public domain", dateTimeOriginal: "2010", pickedBy: "auto", ...over,
    });
    const cc = { ...pdRow("File:CC.jpg"), license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0" };
    const file = {
        sp_a: { slug: "a", name: "a", samples: [pdRow("File:Self.jpg"), cc, pdRow("File:Us.jpg")] },
        sp_b: { slug: "b", name: "b", samples: [pdRow("File:Known.jpg", { licenseCode: "PD-Japan" }), pdRow("File:None.jpg")] },
    };

    it("extmetadata の UsageTerms も取る（PD-US の名前が出ていれば集めるときに落とす）", () => {
        expect(EXTMETA).toContain("UsageTerms");
        const { candidates } = parseCommonsPages([
            { ...page("File:U.jpg", { license: "Public domain", licenseUrl: "", code: "pd" }) },
        ].map((p) => ({ ...p, imageinfo: [{ ...p.imageinfo[0], extmetadata: { ...p.imageinfo[0].extmetadata, UsageTerms: { value: "Public domain in the United States" } } }] })));
        expect(candidates).toHaveLength(0);
    });

    it("根拠の分からないパブリックドメインの行だけを聞く（CC・根拠のある行は聞かない）", () => {
        expect(isPublicDomainRow({ license: "Public domain" })).toBe(true);
        expect(isPublicDomainRow({ license: "PD-self" })).toBe(true);
        expect(isPublicDomainRow({ license: "CC BY 4.0" })).toBe(false);
        expect(filesMissingPdBasis(file)).toEqual(["File:Self.jpg", "File:Us.jpg", "File:None.jpg"]);
        expect(pdTemplatesParams(["File:A.jpg", "File:B.jpg"])).toEqual({
            action: "query", titles: "File:A.jpg|File:B.jpg", prop: "templates", tlnamespace: "10", tllimit: "max",
        });
    });

    it("🔴 licenseCode だけを書く。行の数・並び・ほかの項目は変えず、licenseCode は pickedBy の前に置く", () => {
        const tpl = new Map([
            ["File:Self.jpg", ["Template:PD-Layout", "Template:PD-self"]],
            ["File:Us.jpg", ["Template:PD-Layout", "Template:PD-USGov-POTUS"]],
            ["File:None.jpg", ["Template:Information"]],
        ]);
        const r = applyPdBasis(file, tpl);
        expect(r.changed).toBe(2);
        expect(r.missing).toEqual(["File:None.jpg"]);
        const a = r.file.sp_a.samples as Record<string, unknown>[];
        expect(a.map((x) => x.file)).toEqual(["File:Self.jpg", "File:CC.jpg", "File:Us.jpg"]);
        expect(a[0]).toEqual({ ...pdRow("File:Self.jpg"), licenseCode: "PD-self" });
        expect(Object.keys(a[0]).slice(-2)).toEqual(["licenseCode", "pickedBy"]);
        expect(a[1]).toBe(cc);
        expect(a[2].licenseCode).toBe("PD-USGov-POTUS");
        expect(r.file.sp_b.samples[0]).toBe(file.sp_b.samples[0]);
        expect(r.file.sp_b.samples[1]).not.toHaveProperty("licenseCode");
        // 元の確定ファイルは書き換えない
        expect(file.sp_a.samples[0]).not.toHaveProperty("licenseCode");
    });

    it("🔴 写真そのものが CC BY の PD は CC BY に（license・licenseUrl・licenseCode・並びを守る）。決められなければ mixed:", () => {
        const art = { s: { slug: "s", name: "s", samples: [pdRow("File:Art.jpg", { author: "baggio4ever" }), pdRow("File:Mix.jpg"), pdRow("File:Old.jpg", { licenseCode: "PD-Japan" })] } };
        const r = applyPdBasis(art, new Map([
            ["File:Art.jpg", ["Template:Art Photo", "Template:Cc-by-3.0", "Template:PD-Japan"]],
            ["File:Mix.jpg", ["Template:Self", "Template:Cc-by-3.0", "Template:GFDL", "Template:PD-Japan"]],
            ["File:Old.jpg", ["Template:Art Photo", "Template:Cc-by-sa-4.0", "Template:PD-Japan"]],
        ]), { all: true });
        const [a, m, o] = r.file.s.samples as Record<string, unknown>[];
        expect(Object.keys(a)).toEqual(["file", "pageUrl", "thumbUrl", "width", "height", "author", "license", "licenseUrl", "dateTimeOriginal", "licenseCode", "pickedBy"]);
        expect(a).toMatchObject({ license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", licenseCode: "cc-by-3.0", author: "baggio4ever" });
        expect(m.licenseCode).toBe("mixed:PD-Japan,Cc-by-3.0,GFDL");
        expect(m.license).toBe("Public domain");
        // all のときは根拠の付いた行も見直す
        expect(o).toMatchObject({ license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" });
        expect(r.toCc).toEqual(["File:Art.jpg", "File:Old.jpg"]);
        expect(r.undetermined).toEqual(["File:Mix.jpg"]);
        // all でなければ根拠の付いた行は触らない
        expect(applyPdBasis(art, new Map([["File:Old.jpg", ["Template:Art Photo", "Template:Cc-by-sa-4.0"]]])).file.s.samples[2]).toBe(art.s.samples[2]);
        expect(filesMissingPdBasis(art, { all: true })).toEqual(["File:Art.jpg", "File:Mix.jpg", "File:Old.jpg"]);
    });

    it("選び直しのときは前の確定ファイルの根拠を引き継ぎ、残りだけ聞く", async () => {
        const previous = { sp_a: { slug: "a", name: "a", samples: [pdRow("File:Self.jpg", { licenseCode: "PD-self" })] } };
        const carried = carryPdBasis(file, previous);
        expect((carried.sp_a.samples[0] as Record<string, unknown>).licenseCode).toBe("PD-self");
        const asked: string[][] = [];
        const r = await refreshPdBasis(carried, async (files: string[]) => {
            asked.push(files);
            return new Map(files.map((f) => [f, ["Template:PD-old"]]));
        });
        expect(asked).toEqual([["File:Us.jpg", "File:None.jpg"]]);
        expect(r.changed).toBe(2);
        // 聞くものが無ければ通信しない
        const again = await refreshPdBasis(r.file, async () => { throw new Error("呼ばない"); });
        expect(again.changed).toBe(0);
    });
});
