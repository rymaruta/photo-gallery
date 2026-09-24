import { describe, it, expect } from "vitest";
import { SPOTS, type Spot } from "../spots";
import { publishBlockers, publishableSpots, SOURCED_FIELDS } from "../../utils/spotGuide";

/**
 * 🔴 **`content/spots.json` の中身そのものを見る。**
 *
 * `spotGuide.test.ts` は**判定の関数**を作り物のデータで確かめている。
 * こちらは**実際に配られる台帳**を見る——関数が正しくても、台帳が空なら
 * `/spots/*` は1ページも建たない（2026-09-24 まで実際に `[]` だった）。
 *
 * この形は `sitemapIndexPages.test.ts` が「綴りで見るテストと、実際に
 * 呼んで出た URL を見るテストの両方が要る」と書いたのと同じ理由。
 *
 * ## 「空回り」を最初に落とす
 *
 * 下の `for` はどれも台帳を舐める。**台帳が空なら全部緑になる**ので、
 * 件数の下限を先に固定する。台帳を減らしたい日が来たらこの数を下げる——
 * そのとき「減らした」と意識することがこのテストの目的。
 */
const MIN_SPOTS = 20;

/** URL に出る綴り。ASCII の小文字・数字・ハイフンだけ */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 台帳の鍵。`sp_` ＋ 12桁の16進（`lib/data/spots.ts` の docstring） */
const SPOT_ID_RE = /^sp_[0-9a-f]{12}$/;

describe("撮影スポット台帳（content/spots.json）", () => {
    it("空ではない（空だと /spots/* が1ページも建たない）", () => {
        expect(SPOTS.length, "台帳が空か、減りすぎている").toBeGreaterThanOrEqual(MIN_SPOTS);
    });

    it("公開の条件を満たしている（満たさない行は理由つきで落とす）", () => {
        const bad = SPOTS
            .map((s) => [s.slug || "(綴り無し)", publishBlockers(s)] as const)
            .filter(([, b]) => b.length > 0)
            .map(([slug, b]) => `${slug}: ${b.join(" / ")}`);
        expect(bad, "公開できない行がある").toEqual([]);
        // 上が空でも `publishableSpots` が空なら意味が無い（台帳が空の場合）
        expect(publishableSpots(SPOTS).length).toBe(SPOTS.length);
    });

    it("鍵が重複していない（spotId も slug も）", () => {
        const ids = SPOTS.map((s) => s.spotId);
        const slugs = SPOTS.map((s) => s.slug);
        expect(new Set(ids).size, "spotId が重複している").toBe(ids.length);
        expect(new Set(slugs).size, "slug が重複している").toBe(slugs.length);
    });

    it("spotId は名前から作られていない（sp_ ＋ 12桁の16進）", () => {
        // 名前を鍵にすると (1) 同名異所を混ぜる (2) 改名で鍵が変わる
        const bad = SPOTS.filter((s) => !SPOT_ID_RE.test(s.spotId)).map((s) => s.spotId);
        expect(bad).toEqual([]);
    });

    it("slug は URL に出せる形（ASCII の小文字・数字・ハイフン）", () => {
        // 撮影地ページ（`/location/<日本語>`）と違い、こちらは台帳が綴りを決める。
        // 日本語のままにすると共有時にパーセント符号化で伸びる
        const bad = SPOTS.filter((s) => !SLUG_RE.test(s.slug)).map((s) => s.slug);
        expect(bad).toEqual([]);
    });

    /**
     * **座標は写真と同じ約1km精度に丸める**（`lib/data/spots.ts` の `coords`）。
     * 台帳の地点は公共の場所だが、精度を写真と揃えておかないと
     * 「写真の座標から住所が割れた」と誤解される。
     */
    it("座標は小数2桁に丸めてある（写真と同じ約1km精度）", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            const c = s.coords;
            if (!c) continue;
            const round = (n: number) => Math.round(n * 100) / 100;
            if (round(c.lat) !== c.lat || round(c.lng) !== c.lng) bad.push(`${s.slug}: ${c.lat},${c.lng}`);
        }
        expect(bad, "丸めていない座標がある").toEqual([]);
    });

    /**
     * 🔴 **出典は「どの項目の裏付けか」まで持つ。**
     *
     * `field` の綴りが間違っていると `sourcesFor` が拾えず、
     * **書いたアクセスが画面に出ない**（`showsField` が false のまま）。
     * 書いた人は「書いたのに出ない」で気づくが、綴り間違いの原因までは
     * すぐ分からないので、ここで名指しする。
     */
    it("出典の field は、実際に書かれている項目を指している", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            for (const src of s.sources ?? []) {
                if ((s as unknown as Record<string, unknown>)[src.field] === undefined) {
                    bad.push(`${s.slug}: sources の field "${src.field}" が本体に無い`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it("出典が要る項目は、書いてあるなら出典もある", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            for (const f of SOURCED_FIELDS) {
                const v = (s as unknown as Record<string, unknown>)[f];
                if (v === undefined) continue;
                const has = (s.sources ?? []).some((x) => x.field === f && x.url && x.checkedAt);
                if (!has) bad.push(`${s.slug}: ${f} に出典が無い（書いても画面に出ない）`);
            }
        }
        expect(bad, "出典の無い項目がある＝書いたのに出ない").toEqual([]);
    });

    it("出典と公式サイトの URL は https", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            if (s.officialWebsiteUrl && !s.officialWebsiteUrl.startsWith("https://")) {
                bad.push(`${s.slug}: officialWebsiteUrl`);
            }
            for (const src of s.sources ?? []) {
                if (!src.url.startsWith("https://")) bad.push(`${s.slug}: sources ${src.field}`);
            }
        }
        expect(bad).toEqual([]);
    });

    /**
     * **代表写真は権利が確認できているものだけ。** いまは1件も持たせていない
     * （転載できる画像が無いので、`usesMapHero` で地図を主役にする）。
     * 足すときは `coverImageProblems` が要求する項目を全部埋めること。
     */
    it("権利の確認できていない代表写真を持っていない", () => {
        const withCover = SPOTS.filter((s) => s.coverImage);
        for (const s of withCover) {
            expect(s.coverImage?.credit?.trim(), `${s.slug}: credit`).toBeTruthy();
            expect(s.coverImage?.checkedAt?.trim(), `${s.slug}: checkedAt`).toBeTruthy();
            expect(s.coverImage?.verifiedPlace, `${s.slug}: verifiedPlace`).toBe(true);
        }
    });

    it("確認日は ISO の日付（未来の日付を書かない）", () => {
        const bad: string[] = [];
        const today = new Date().toISOString().slice(0, 10);
        const check = (label: string, d?: string) => {
            if (!d) return;
            if (!/^\d{4}-\d{2}-\d{2}/.test(d)) { bad.push(`${label}: 形が ISO でない (${d})`); return; }
            if (d.slice(0, 10) > today) bad.push(`${label}: 未来の日付 (${d})`);
        };
        for (const s of SPOTS) {
            check(`${s.slug}.verifiedAt`, s.verifiedAt);
            for (const src of s.sources ?? []) check(`${s.slug}.sources[${src.field}]`, src.checkedAt);
        }
        expect(bad).toEqual([]);
    });

    /**
     * **国が無いと公開できない**（`publishBlockers`）が、都道府県・市区町村は
     * 任意。ただし日本国内の地点で都道府県が空だと、画面の「どこにあるか」が
     * 国名だけになるので、ここで気づけるようにしておく。
     */
    it("日本国内の地点には都道府県が入っている", () => {
        const bad = SPOTS
            .filter((s: Spot) => s.region?.country === "日本" && !s.region?.prefecture?.trim())
            .map((s) => s.slug);
        expect(bad).toEqual([]);
    });
});
