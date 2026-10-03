import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    parseCommonsPages, scoreCandidate, autoEligible, pickSamples, mergeCandidates, buildSamplesFile, forCandidatesFile,
    collectSpotCandidates, fetchFilePages, queryAllPages, geosearchParams, imageinfoParams, categoryParams, depictsParams,
    fileTitlesParams, EXCLUDED_PATH, CANDIDATES_PATH, MAX_SAMPLES,
} from "../collect-commons-samples.mjs";
import {
    exclusionReasons, RULE, fileKey, excludedKeySet, isExcluded, readExcluded, withoutExcluded, parseWikidataEntity,
    shotHour, SOURCE_BONUS, EXCLUDE_PREFIX,
} from "../lib/commonsSampleRules.mjs";

/**
 * **作例を選ぶ精度**（2026-10-03・owner「次から見つける時は精度高くしたい」）。
 *   1. 人の目で外した写真（content/spot-samples-excluded.json）は二度と選ばない
 *   2. 題・カテゴリ・説明で 駅・料理・室内・看板・石碑だけ・人物・夜 を外す（撮影地の名前で例外）
 *   3. 撮影地の Wikidata 項目: P18 > P373 の中 > 半径検索。P180 が撮影地と一致するものも上げる
 * 通信する部分は `call` を模擬して試す（Wikimedia の API は CI から叩かない）。
 */

function page(title: string, over: { w?: number; h?: number; desc?: string; cats?: string; date?: string; dist?: number; artist?: string } = {}) {
    const name = title.replace(/^File:/, "").replace(/ /g, "_");
    return {
        pageid: [...title].reduce((a, ch) => (a * 31 + ch.codePointAt(0)!) % 1e9, 7),
        title,
        coordinates: over.dist === undefined ? undefined : [{ lat: 35, lon: 135, dist: over.dist }],
        imageinfo: [{
            url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
            thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/1280px-${name}`,
            thumbwidth: 1280, thumbheight: 853,
            width: over.w ?? 4000, height: over.h ?? 2667,
            mime: "image/jpeg",
            descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
            extmetadata: {
                LicenseShortName: { value: "CC BY-SA 4.0" },
                LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
                Artist: { value: over.artist ?? "撮った人" },
                ...(over.date ? { DateTimeOriginal: { value: over.date } } : {}),
                ...(over.desc ? { ImageDescription: { value: over.desc } } : {}),
                ...(over.cats ? { Categories: { value: over.cats } } : {}),
            },
        }],
    };
}

const KINKAKU = {
    spotId: "sp_31047ba6ec8d", slug: "kinkakuji", name: "鹿苑寺（金閣寺）",
    aliases: ["金閣寺", "金閣", "鏡湖池"], coords: { lat: 35.04, lng: 135.73 }, status: "published",
};
const spot = (name: string) => ({ ...KINKAKU, name, aliases: [] });
const rules = (s: { name: string }, c: Record<string, unknown>) => exclusionReasons(s, c).map((x) => x.rule);

describe("1. 人の目で外した写真は二度と選ばない", () => {
    it("ファイル名の揺れ（File: の有無・_ と空白・頭の小文字・NFC）を吸収して引く", () => {
        expect(fileKey("File:Kinkaku_ji 1.jpg")).toBe("Kinkaku ji 1.jpg");
        expect(fileKey("kinkaku ji 1.jpg")).toBe("Kinkaku ji 1.jpg");
        expect(fileKey("ファイル:が.jpg")).toBe("が.jpg");
        const set = excludedKeySet([{ spotId: "sp_a", file: "File:Foo_bar.jpg", reason: "室内" }]);
        expect(isExcluded(set, "sp_a", "File:Foo bar.jpg")).toBe(true);
        // 別のスポットでは外さない（その撮影地に合わないだけのことがある）
        expect(isExcluded(set, "sp_b", "File:Foo bar.jpg")).toBe(false);
    });

    it("候補ファイルから抜いた写しを作る（元は書き換えない）。抜いた後は自動でも選ばれない", () => {
        const c = { ...parseCommonsPages([page("File:金閣寺 1.jpg")]).candidates[0] };
        const scored = { ...c, ...scoreCandidate(KINKAKU, c) };
        const file = { spots: { [KINKAKU.spotId]: { candidates: [scored] } } };
        const set = excludedKeySet([{ spotId: KINKAKU.spotId, file: "File:金閣寺_1.jpg", reason: "人の目" }]);
        const out = withoutExcluded(file, set);
        expect(out.spots[KINKAKU.spotId].candidates).toHaveLength(0);
        expect(file.spots[KINKAKU.spotId].candidates).toHaveLength(1);
        expect(buildSamplesFile(out, [KINKAKU], {})[KINKAKU.spotId]).toBeUndefined();
    });

    it("一覧が無ければ空・壊れていれば止める（黙って空にすると外した写真をまた選ぶ）", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "excl-"));
        expect(readExcluded(path.join(dir, "none.json")).size).toBe(0);
        fs.writeFileSync(path.join(dir, "bad.json"), "[{");
        expect(() => readExcluded(path.join(dir, "bad.json"))).toThrow(/JSON/);
    });

    it("リポジトリの一覧（2026-10-03 に外した分）を全部読み、候補ファイルからは全部抜ける", () => {
        const list = JSON.parse(fs.readFileSync(EXCLUDED_PATH, "utf8"));
        const set = readExcluded(EXCLUDED_PATH);
        expect(list.length).toBeGreaterThanOrEqual(290);
        for (const r of list) expect(isExcluded(set, r.spotId, r.file)).toBe(true);
        const cands = withoutExcluded(JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8")), set);
        for (const [spotId, e] of Object.entries(cands.spots) as [string, { candidates: { file: string }[] }][]) {
            for (const c of e.candidates) expect(isExcluded(set, spotId, c.file)).toBe(false);
        }
    });
});

describe("2. 題・カテゴリ・説明で外す", () => {
    it("駅・車両: 題で当たれば外す。撮影地そのものが駅・鉄道なら外さない", () => {
        expect(rules(KINKAKU, { file: "File:Kyoto Station 2019.jpg" })).toEqual([RULE.station]);
        expect(rules(KINKAKU, { file: "File:嵐電の車両.jpg" })).toEqual([RULE.station]);
        expect(rules(spot("京都駅"), { file: "File:Kyoto Station 2019.jpg" })).toEqual([]);
        expect(rules(spot("嵯峨野トロッコ"), { file: "File:Sagano train.jpg" })).toEqual([]);
    });

    it("駅の細則: 発電所・観測所・三角点は駅ではない／長い題の後ろの「駅」は場所の説明／カテゴリだけなら station の語が要る", () => {
        expect(rules(KINKAKU, { file: "File:Kurobe power station.jpg" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:Triangulation station of Mt X.jpg" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:嵐山の竹林の小径と静かな朝の景色、嵯峨嵐山駅から.jpg" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:A.jpg", categories: "Trains in Kyoto|Kinkaku-ji" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:A.jpg", categories: "Kitano-Hakubaicho Station|Trams in Kyoto" })).toEqual([RULE.station]);
        // 説明の「〜駅から」は主題でないことが多いので見ない
        expect(rules(KINKAKU, { file: "File:A.jpg", description: "金閣寺道バス停から歩いて" })).toEqual([]);
    });

    it("料理・室内: 題・カテゴリ・説明のどれでも外す。撮影地が料理・資料館・洞窟なら外さない", () => {
        expect(rules(KINKAKU, { file: "File:Matcha dessert at Kinkakuji.jpg" })).toEqual([RULE.food]);
        expect(rules(KINKAKU, { file: "File:A.jpg", categories: "Ramen in Kyoto" })).toEqual([RULE.food]);
        const r = exclusionReasons(KINKAKU, { file: "File:IMG 1.jpg", description: "Interior of the main hall" });
        expect(r).toEqual([{ rule: RULE.indoor, match: "Interior", where: "desc" }]);
        expect(rules(spot("秋芳洞"), { file: "File:Akiyoshi-do interior.jpg" })).toEqual([]);
        expect(rules(spot("ラーメン横丁"), { file: "File:Ramen.jpg" })).toEqual([]);
    });

    it("看板・店: 題だけを見る（\"Shops in Kyoto\" のような広いカテゴリでは外さない）。商店街・市場は外さない", () => {
        expect(rules(KINKAKU, { file: "File:Souvenir shop near Kinkakuji.jpg" })).toEqual([RULE.shop]);
        expect(rules(KINKAKU, { file: "File:Café Kinkaku.jpg" })).toEqual([RULE.shop]); // アクセント付きの字も語の字（Python と同じ境目）
        expect(rules(KINKAKU, { file: "File:A.jpg", categories: "Shops in Kyoto" })).toEqual([]);
        expect(rules(spot("錦市場"), { file: "File:Nishiki shop.jpg" })).toEqual([]);
    });

    it("人物・石碑: 舞妓・コスプレ・句碑・扁額は外す。祭り・碑そのものの撮影地と「天然記念物」は外さない", () => {
        expect(rules(KINKAKU, { file: "File:Maiko at Kinkakuji.jpg" })).toEqual([RULE.people]);
        expect(rules(spot("祇園祭"), { file: "File:Maiko at Gion.jpg" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:芭蕉の句碑.jpg" })).toEqual([RULE.monument]);
        expect(rules(KINKAKU, { file: "File:Natural monument stone tablet.jpg" })).toEqual([]);
        expect(rules(spot("ひめゆりの塔 慰霊碑"), { file: "File:慰霊碑.jpg" })).toEqual([]);
        // 「碑\b」は Python の境目: 「碑 前」は当たり、「碑文」は「碑」単独としては当たらない
        expect(rules(KINKAKU, { file: "File:碑 前.jpg" })).toEqual([RULE.monument]);
        expect(rules(KINKAKU, { file: "File:碑文.jpg" })).toEqual([]);
    });

    it("夜: 夜の語＋撮影時刻が昼でない（時刻なしも）なら外す。00:00 ちょうど・from … night・夜景の撮影地は外さない", () => {
        expect(shotHour("2019-04-03 21:10:00")).toBe(21);
        expect(rules(KINKAKU, { file: "File:Kinkakuji at night.jpg", dateTimeOriginal: "2019-04-03 21:10" })).toEqual([RULE.night]);
        expect(rules(KINKAKU, { file: "File:Kinkakuji at night.jpg" })).toEqual([RULE.night]);
        expect(rules(KINKAKU, { file: "File:Kinkakuji at night.jpg", dateTimeOriginal: "2019-04-03 15:10" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:Kinkakuji at night.jpg", dateTimeOriginal: "2019-04-03 00:00:00" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:View from the hill at night.jpg" })).toEqual([]);
        expect(rules(spot("函館山"), { file: "File:Hakodate night view.jpg" })).toEqual([]);
        expect(rules(KINKAKU, { file: "File:IMG 2.jpg", description: "夜の舎利殿" })).toEqual([RULE.night]);
    });

    it("🔴 当たった写真は名前が当たっても自動では採らない（理由は「除外:…」）", () => {
        const [c] = parseCommonsPages([page("File:金閣寺 Interior.jpg")]).candidates;
        const s = { ...c, ...scoreCandidate(KINKAKU, c) };
        expect(s.named).toBe(true);
        expect(s.reasons).toContain(`${EXCLUDE_PREFIX}${RULE.indoor}`);
        expect(autoEligible(s)).toBe(false);
        // カテゴリは Commons の欄から取る
        const [d] = parseCommonsPages([page("File:金閣寺 2.jpg", { cats: "Kinkaku-ji|Food of Kyoto" })]).candidates;
        expect(d.categories).toBe("Kinkaku-ji|Food of Kyoto");
        expect(autoEligible({ ...d, ...scoreCandidate(KINKAKU, d) })).toBe(false);
    });

    it("カテゴリ・説明は候補ファイルに残さないが、それで外れた理由は選び直しでも失わない", () => {
        const [c0] = parseCommonsPages([page("File:金閣寺 3.jpg", { cats: "Kinkaku-ji|Interiors of temples" })]).candidates;
        const kept = forCandidatesFile({ ...c0, ...scoreCandidate(KINKAKU, c0) });
        expect(kept).not.toHaveProperty("categories");
        expect(kept.reasons).toContain(`${EXCLUDE_PREFIX}${RULE.indoor}`);
        expect(buildSamplesFile({ spots: { [KINKAKU.spotId]: { candidates: [kept] } } }, [KINKAKU], {})[KINKAKU.spotId]).toBeUndefined();
    });
});

describe("3. 撮影地の Wikidata 項目からの当て方", () => {
    it("項目から座標（P625）・代表画像（P18）・Commons のカテゴリ（P373）を取る。非推奨の値は使わない", () => {
        const e = { claims: {
            P625: [{ mainsnak: { datavalue: { value: { latitude: 35.0394, longitude: 135.7292 } } } }],
            P18: [{ rank: "deprecated", mainsnak: { datavalue: { value: "Old.jpg" } } },
                { rank: "normal", mainsnak: { datavalue: { value: "Kinkaku-ji_2.jpg" } } }],
            P373: [{ mainsnak: { datavalue: { value: "Kinkaku-ji" } } }],
        } };
        expect(parseWikidataEntity(e)).toEqual({ coords: { lat: 35.0394, lng: 135.7292 }, image: "File:Kinkaku-ji 2.jpg", category: "Kinkaku-ji" });
        expect(parseWikidataEntity({ claims: {} })).toEqual({});
    });

    it("問い合わせの引数: 画像の項目は半径検索と同じ。カテゴリ・P180 の検索・題の名指し", () => {
        const g = geosearchParams({ lat: 35, lng: 135 }, 500);
        const ii = imageinfoParams();
        expect([ii.iiprop, ii.iiextmetadatafilter, ii.iiextmetadatalanguage]).toEqual([g.iiprop, g.iiextmetadatafilter, g.iiextmetadatalanguage]);
        expect(ii.prop).toBe("imageinfo");
        expect(categoryParams("Kinkaku-ji")).toMatchObject({ generator: "categorymembers", gcmtitle: "Category:Kinkaku-ji", gcmtype: "file" });
        expect(depictsParams("Q190167")).toMatchObject({ generator: "search", gsrsearch: "haswbstatement:P180=Q190167", gsrnamespace: "6" });
        expect(fileTitlesParams(["File:A.jpg", "File:B.jpg"]).titles).toBe("File:A.jpg|File:B.jpg");
    });

    it("同じファイルが複数の当て方で見つかれば、どこから見つかったか（via）を全部残す", () => {
        const [a] = parseCommonsPages([page("File:A.jpg", { dist: 300 })]).candidates;
        const [b] = parseCommonsPages([page("File:A.jpg")]).candidates;
        const merged = mergeCandidates([[{ ...a, via: ["geo"] }], [{ ...b, via: ["category"] }], [{ ...b, via: ["depicts"] }]]);
        expect(merged).toHaveLength(1);
        expect(merged[0].via).toEqual(["category", "depicts", "geo"]);
        expect(merged[0].distanceM).toBe(300);
    });

    it("P18 は必ず最上位。カテゴリ・P180 は名前が当たらなくても撮影地の写真として採れる。半径検索だけなら今までどおり", () => {
        const base = parseCommonsPages([page("File:IMG 0001.jpg")]).candidates[0];
        const s = (via: string[]) => ({ ...base, via, ...scoreCandidate(KINKAKU, { ...base, via }) });
        expect(s(["geo"]).named).toBe(false);
        expect(s(["category"]).named).toBe(true);
        expect(s(["depicts"]).named).toBe(true);
        expect(s(["p18"]).score).toBeGreaterThan(s(["category", "depicts"]).score + 4 + 3 + 2);
        expect(s(["category"]).score).toBeGreaterThan(s(["depicts"]).score);
        expect(SOURCE_BONUS.p18).toBeGreaterThan(SOURCE_BONUS.category + SOURCE_BONUS.depicts + 9);
        // それでも外す規則・解像度は当てる（代表画像でも室内や小さい写真は採らない）
        const small = parseCommonsPages([page("File:IMG 0003.jpg", { w: 800, h: 500 })]).candidates[0];
        expect(autoEligible({ ...small, via: ["p18"], ...scoreCandidate(KINKAKU, { ...small, via: ["p18"] }) })).toBe(false);
    });

    it("続きのページは imageinfo の取り残しだけ辿る（generator の次の束へは進まない）", async () => {
        const calls: Record<string, string>[] = [];
        const pages = await queryAllPages(async (p: Record<string, string>) => {
            calls.push(p);
            if (!p.iicontinue) return { query: { pages: [{ pageid: 1, title: "File:A.jpg" }] }, continue: { iicontinue: "x", gcmcontinue: "y", continue: "||" } };
            return { query: { pages: [{ pageid: 1, title: "File:A.jpg", imageinfo: [{}] }] }, continue: { gcmcontinue: "z", continue: "-||" } };
        }, categoryParams("X"), ["gcmcontinue"]);
        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ iicontinue: "x" });
        expect(calls[1]).not.toHaveProperty("gcmcontinue");
        expect(pages).toHaveLength(1);
        expect(pages[0].imageinfo).toHaveLength(1);
    });

    it("P18 の代表画像はまとめて聞き、名前の揺れを吸収して引く（無いファイルは落とす）", async () => {
        const seen: string[] = [];
        const out = await fetchFilePages(["File:Kinkaku-ji 2.jpg", "File:Kinkaku-ji 2.jpg", "File:Gone.jpg"], async (_base: string, p: Record<string, string>) => {
            seen.push(p.titles);
            return { query: { pages: [page("File:Kinkaku-ji 2.jpg"), { title: "File:Gone.jpg", missing: true }] } };
        });
        expect(seen).toEqual(["File:Kinkaku-ji 2.jpg|File:Gone.jpg"]);
        expect([...out.keys()]).toEqual(["Kinkaku-ji 2.jpg"]);
    });
});

describe("1つの撮影地の候補を集める（通信は模擬）", () => {
    /** 要求の種類ごとに返すページを決める模擬の API */
    function fakeApi(byKind: { category?: unknown[]; depicts?: unknown[]; geo?: unknown[] }) {
        const kinds: string[] = [];
        const call = async (_base: string, p: Record<string, string>) => {
            const kind = p.generator === "categorymembers" ? "category" : p.generator === "search" ? "depicts" : p.generator === "geosearch" ? "geo" : "other";
            kinds.push(kind);
            return { query: { pages: (byKind as Record<string, unknown[] | undefined>)[kind] ?? [] } };
        };
        return { call, kinds };
    }
    const facts = { image: "File:Kinkaku-ji 2.jpg", category: "Kinkaku-ji" };
    const opts = { qid: "Q190167", facts, centers: [{ lat: 35.04, lng: 135.73 }], radiusM: 500 };

    it("P18 → カテゴリ → P180 → 半径検索の順に聞き、P18 が先頭・外した写真と室内は採らない", async () => {
        const { call, kinds } = fakeApi({
            category: [page("File:IMG 1.jpg", { artist: "a" }), page("File:Hall interior.jpg", { artist: "b" }), page("File:Dropped.jpg", { artist: "c" })],
            depicts: [page("File:IMG 1.jpg", { artist: "a" }), page("File:IMG 9.jpg", { artist: "d" })],
            geo: [page("File:Konbini.jpg", { dist: 100, artist: "e" }), page("File:金閣寺 夕景.jpg", { dist: 200, artist: "f" })],
        });
        const excluded = excludedKeySet([{ spotId: KINKAKU.spotId, file: "File:Dropped.jpg", reason: "人の目" }]);
        const r = await collectSpotCandidates(KINKAKU, { ...opts, p18Page: page("File:Kinkaku-ji 2.jpg", { artist: "p" }), excluded, call });
        expect(kinds).toEqual(["category", "depicts", "geo"]);
        expect(r.geoSkipped).toBe(false);
        const files = r.scored.map((c: { file: string }) => c.file);
        expect(files).not.toContain("File:Dropped.jpg");
        const picked = pickSamples(r.scored).map((c: { file: string }) => c.file);
        expect(picked[0]).toBe("File:Kinkaku-ji 2.jpg");
        // カテゴリと P180 の両方 → カテゴリだけ → P180 だけ → 名前の当たる半径検索
        expect(picked).toEqual(["File:Kinkaku-ji 2.jpg", "File:IMG 1.jpg", "File:IMG 9.jpg", "File:金閣寺 夕景.jpg"]);
        expect(r.scored.find((c: { file: string }) => c.file === "File:IMG 1.jpg").via).toEqual(["category", "depicts"]);
        expect(r.scored.find((c: { file: string }) => c.file === "File:Hall interior.jpg").reasons).toContain(`${EXCLUDE_PREFIX}${RULE.indoor}`);
        expect(r.found).toBe(1 + 3 + 2 + 2);
    });

    it(`カテゴリ・P180 だけで自動で採れる写真が ${MAX_SAMPLES} 枚そろえば、半径検索は飛ばす（要求を減らす）`, async () => {
        const many = Array.from({ length: 8 }, (_, i) => page(`File:IMG ${i}.jpg`, { artist: `a${i}` }));
        const { call, kinds } = fakeApi({ category: many });
        const r = await collectSpotCandidates(KINKAKU, { ...opts, call });
        expect(kinds).toEqual(["category", "depicts"]);
        expect(r.geoSkipped).toBe(true);
        expect(pickSamples(r.scored)).toHaveLength(MAX_SAMPLES);
    });

    it("Wikidata の項目が無ければ半径検索だけ（今までと同じ）", async () => {
        const { call, kinds } = fakeApi({ geo: [page("File:金閣寺.jpg", { dist: 50 })] });
        const r = await collectSpotCandidates(KINKAKU, { centers: opts.centers, radiusM: 500, call });
        expect(kinds).toEqual(["geo"]);
        expect(r.scored[0].via).toEqual(["geo"]);
    });
});
