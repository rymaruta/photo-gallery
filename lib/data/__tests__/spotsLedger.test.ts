import { describe, it, expect } from "vitest";
import { SPOTS, type Spot } from "../spots";
import { publishBlockers, publishableSpots, SOURCED_FIELDS } from "../../utils/spotGuide";
import { PREFECTURES as PREFECTURE_TABLE } from "../prefectures";

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

    /**
     * 🔴 **同じ場所を2回書いていない。**
     *
     * 鍵（`spotId` / `slug`）の重複は上で止まるが、**綴りを変えれば素通りする**。
     * 2026-09-24、実際にこれで7件の重複を作りかけた——`osaka-castle-park`
     * （既にある `osaka-castle`）・`hitsujiyama-shibazakura`（`hitsujiyama-park`）・
     * `nomizo-no-taki`（`kiyosumi-keiryu-hiroba`）・`fukiware-no-taki`
     * （`fukiware-falls`）など。**鍵が違うので既存の見張りは全部緑だった。**
     *
     * 重複が入ると、県の一覧に同じ場所が2回出て、サイトマップにも2本載る
     * ——検索側から見れば中身の重なる薄いページが2枚になる。
     *
     * 見るのは2つ:
     *   1. **名前**（かっこ書きと空白を落とした形）が他と同じでないか
     *   2. **別名**が他のスポットの名前と同じでないか
     *      （`大阪城公園` の別名 `大阪城` が、既存の `大阪城` と衝突する形）
     */
    const coreName = (n: string) =>
        n.replace(/[（(][^）)]*[）)]/g, "").replace(/[\s\u3000]/g, "");

    it("同じ場所を2回書いていない（名前と別名で見る）", () => {
        const byCore = new Map<string, string[]>();
        for (const s of SPOTS) {
            const k = coreName(s.name);
            byCore.set(k, [...(byCore.get(k) ?? []), s.slug]);
        }
        const dupNames = [...byCore.entries()]
            .filter(([, slugs]) => slugs.length > 1)
            .map(([k, slugs]) => `${k}: ${slugs.join(" / ")}`);
        expect(dupNames, "同じ名前のスポットが2件以上ある").toEqual([]);

        const nameOwner = new Map([...byCore].map(([k, slugs]) => [k, slugs[0]]));
        const aliasHits: string[] = [];
        for (const s of SPOTS) {
            for (const a of s.aliases ?? []) {
                const owner = nameOwner.get(coreName(a));
                if (owner && owner !== s.slug) {
                    aliasHits.push(`${s.slug} の別名「${a}」が ${owner} の名前と同じ`);
                }
            }
        }
        expect(aliasHits, "別名が他のスポットの名前と衝突している").toEqual([]);
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
     * 🔴 **日本全国を網羅する**（owner の目標・2026-09-24）。
     *
     * 47都道府県に1件も無い県があると、そこを探している人にとって
     * このサイトは「無い」のと同じ。**足りない県を名指しで返す**
     * ——真偽1つだと、次にどこを埋めればよいか分からない。
     *
     * ⚠️ この一覧は**都道府県名の綴りの正**でもある。`region.prefecture` が
     * 「東京」（「都」抜け）のように揺れると、下の「知らない都道府県名」が
     * 落ちる——揺れたまま通すと、県ごとの集計が静かに割れる。
     */
    /**
     * **綴りの正は `lib/data/prefectures.ts`。** ここで別に並べ直さない
     * ——`/spots/area/<slug>` の行き先を決めているのがあの表なので、
     * 台帳の綴りをそちらに合わせないと、そのスポットは**どの県のページにも
     * 出ないまま静かに消える**。
     */
    const PREFECTURES = PREFECTURE_TABLE.map((p) => p.name);

    const jpPrefectures = () => SPOTS
        .filter((s) => s.region?.country === "日本")
        .map((s) => s.region?.prefecture ?? "");

    /**
     * 🔴 **`/spots/<slug>` と `/spots/area/<x>` は同じ親の下にある。**
     *
     * `output: export` なので `/spots/area` は `out/spots/area/` という
     * **ディレクトリ**になる。`area` という綴りのスポットを台帳に入れると、
     * その個別ページが `out/spots/area.html` を作ろうとして、県ごとの一覧が
     * 丸ごと壊れる（か、ビルドが落ちる）。**台帳の側で止める**。
     */
    it("ルートとぶつかる綴りを使っていない", () => {
        const RESERVED = ["area"];
        const hit = SPOTS.filter((s) => RESERVED.includes(s.slug)).map((s) => s.slug);
        expect(hit, "`/spots/` の下の固定ルートと同じ綴りのスポットがある").toEqual([]);
    });

    it("47都道府県すべてに1件以上ある", () => {
        const have = new Set(jpPrefectures());
        const missing = PREFECTURES.filter((p) => !have.has(p));
        expect(missing, "この都道府県のスポットがまだ無い").toEqual([]);
    });

    /**
     * **どの県も入口が2つ以上ある。**
     *
     * 1件だけの県は、その1件が季節限定（藤・芝桜・雪）だったときに
     * 年の大半で「その県には何も無い」ページになる。47県に1件ずつ置いた
     * 時点では満たせていなかった条件で、2026-09-24 に全県2件以上にした。
     */
    it("どの都道府県も2件以上ある", () => {
        const count = new Map<string, number>();
        for (const p of jpPrefectures()) count.set(p, (count.get(p) ?? 0) + 1);
        const thin = PREFECTURES.filter((p) => (count.get(p) ?? 0) < 2);
        expect(thin, "この都道府県がまだ1件以下").toEqual([]);
    });

    it("知らない都道府県名を書いていない（綴りの揺れを止める）", () => {
        const known = new Set<string>(PREFECTURES);
        const bad = [...new Set(jpPrefectures())].filter((p) => !known.has(p));
        expect(bad, "47の一覧に無い都道府県名がある").toEqual([]);
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
