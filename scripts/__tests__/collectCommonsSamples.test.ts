import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
    parseCommonsPages, plainDate, nameTerms, scoreCandidate, autoEligible, pickSamples, toSample,
    clampRadius, searchCenters, mergeCandidates, buildSamplesFile, formatCandidatesFile, trimCandidates, KEEP_CANDIDATES,
    CANDIDATES_PATH, SAMPLES_PATH, LEDGER_PATH, MAX_SAMPLES, MIN_INTERVAL_MS, USER_AGENT,
} from "../collect-commons-samples.mjs";
import { isAllowedLicense } from "../fetch-spot-images.mjs";

/**
 * **撮影地の作例を Commons から集める道具**（`scripts/collect-commons-samples.mjs`）の判定を、
 * 固定データで縛る。通信する部分は試さない（Wikimedia の API は CI から叩かない）。
 */

/** Commons の API（formatversion=2）の1ページ分 */
function page(title: string, over: { license?: string; artist?: string; mime?: string; w?: number; h?: number; date?: string; desc?: string; dist?: number; restrictions?: string; licenseUrl?: string } = {}) {
    const name = title.replace(/^File:/, "").replace(/ /g, "_");
    return {
        pageid: Math.floor(Math.random() * 1e9),
        title,
        coordinates: over.dist === undefined ? undefined : [{ lat: 35, lon: 135, dist: over.dist }],
        imageinfo: [{
            url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
            thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/1280px-${name}`,
            thumbwidth: 1280, thumbheight: 853,
            width: over.w ?? 4000, height: over.h ?? 2667,
            mime: over.mime ?? "image/jpeg",
            descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
            extmetadata: {
                LicenseShortName: { value: over.license ?? "CC BY-SA 4.0" },
                LicenseUrl: { value: over.licenseUrl ?? "https://creativecommons.org/licenses/by-sa/4.0" },
                Artist: { value: over.artist ?? '<a href="//commons.wikimedia.org/wiki/User:X" title="User:X">撮った人</a>' },
                ...(over.date ? { DateTimeOriginal: { value: over.date } } : {}),
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
