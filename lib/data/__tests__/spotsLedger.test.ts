import { describe, it, expect } from "vitest";
import { SPOTS, type Spot } from "../spots";
import { hasAiCheck,
    publishBlockers, reviewBlockers, visibleSpots, sourcesFor, SOURCED_FIELDS,
} from "../../utils/spotGuide";
import { PREFECTURES as PREFECTURE_TABLE } from "../prefectures";
import { isTimeZoneName, spotTimeZone } from "../../utils/sunTimes";
import { reviewStage, TEXT_FIELDS, TEXT_ARRAY_FIELDS, TEXT_OBJECT_ARRAY_FIELDS } from "../../../scripts/spots-review-stage.mjs";

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

    /**
     * 🔴 **段階ごとの門を全行が通る。**
     *
     * `review`（運営未確認の下書き）は `reviewBlockers`、`published` は
     * `publishBlockers`。2026-09-24 までは全件 `published`＋`verified: true` で
     * 「全件公開可能」だったが、人は1件も確かめていなかった
     * （`lib/data/spots.ts` の `status` の注記）。いまは**確認者の名前が
     * 無い行は published になれない**。
     */
    it("段階ごとの条件を満たしている（満たさない行は理由つきで落とす）", () => {
        // `draft`（ページを作らない下書き）は門を通さなくてよい
        const staged = SPOTS.filter((s) => s.status !== "draft");
        const bad = staged
            .map((s) => [s.slug || "(綴り無し)", s.status === "published" ? publishBlockers(s) : reviewBlockers(s)] as const)
            .filter(([, b]) => b.length > 0)
            .map(([slug, b]) => `${slug}: ${b.join(" / ")}`);
        expect(bad, "ページを建てられない行がある").toEqual([]);
        // 上が空でも `visibleSpots` が空なら意味が無い（台帳が空の場合）。
        // 下書きを建てる設定のときに全件が通ることを見る（門の側の検査）
        expect(visibleSpots(SPOTS, { includeDrafts: true }).length).toBe(staged.length);
        expect(staged.length).toBeGreaterThanOrEqual(MIN_SPOTS);
        // **いま建てるのは公開済みだけ**（`BUILD_DRAFT_SPOTS`）。下書きが1件でも
        // 混ざれば、本番の URL に未確認のページが出る
        const built = visibleSpots(SPOTS);
        expect(built.map((s) => s.slug).sort())
            .toEqual(staged.filter((s) => s.status === "published").map((s) => s.slug).sort());
        expect(built.length, "公開済みが0件＝/spots が空になる").toBeGreaterThan(0);
    });

    /// published は「人の確認（verifiedBy＋verifiedAt）」か「AI 照合の印（aiCheck）」のどちらか。
    /// AI 照合は owner の委任（2026-09-26）で、**委任した人の名前**と出典を必ず持つ
    it("published の行は確認者（verifiedBy）と確認日を対で持つ（または AI 照合の印を持つ）", () => {
        const bad = SPOTS
            .filter((s) => s.status === "published" && !(s.verifiedBy?.trim() && s.verifiedAt?.trim()) && !hasAiCheck(s))
            .map((s) => s.slug);
        expect(bad, "確認者か確認日の無い published がある（AI 照合の印も無い）").toEqual([]);
        const dateOnly = SPOTS.filter((s) => s.verifiedAt && !s.verifiedBy?.trim()).map((s) => s.slug);
        expect(dateOnly, "verifiedAt だけがある（誰が確かめたか分からない）").toEqual([]);
    });

    /**
     * 🔴 **確認者・出典の確認者に AI の名前を書かない。**
     * 「確認した」は人が名乗るもの。機械の名前で埋めれば門はまた自己申告に戻る。
     */
    it("verifiedBy / checkedBy が AI の名前ではない", () => {
        // **値そのものが AI の名前**のときだけ弾く（先頭一致にすると "Ai Sato" や
        // "Bot Lee" のような実在の名前まで拒む）
        const AI_NAME_RE = /^(ai|claude|chatgpt|gpt(-?[\d.]+)?|copilot|assistant|llm|gemini|anthropic|openai|bot)$/i;
        const bad: string[] = [];
        for (const s of SPOTS) {
            if (s.verifiedBy && AI_NAME_RE.test(s.verifiedBy.trim())) bad.push(`${s.slug}.verifiedBy=${s.verifiedBy}`);
            for (const src of s.sources ?? []) {
                if (src.checkedBy && AI_NAME_RE.test(src.checkedBy.trim())) bad.push(`${s.slug}.sources[${src.field}].checkedBy=${src.checkedBy}`);
            }
            // AI 照合の「委任した人」も人の名前（AI が自分に委任したことにしない）
            if (s.aiCheck && AI_NAME_RE.test((s.aiCheck.delegatedBy ?? "").trim())) bad.push(`${s.slug}.aiCheck.delegatedBy=${s.aiCheck.delegatedBy}`);
        }
        expect(bad).toEqual([]);
    });

    /**
     * 🔴 **台帳は `scripts/spots-review-stage.mjs` を掛けても変わらない**（冪等）。
     * これが「`verified: true`・`verifiedAt`・`**強調**` の書き戻しを二度と
     * 入れない」見張り。差分が出たらスクリプトを流す。
     */
    it("下書きの段階に揃っている（spots-review-stage を掛けて差分0）", () => {
        const staged = reviewStage(SPOTS as unknown as Record<string, unknown>[]);
        const changed = SPOTS
            .filter((s, i) => JSON.stringify(s) !== JSON.stringify(staged[i]))
            .map((s) => s.slug);
        expect(changed, "AI が書いた行が下書きに揃っていない（`**` か旧い verified）。node scripts/spots-review-stage.mjs を実行").toEqual([]);
    });

    /**
     * 🔴 **旧い `verified` の鍵を持つ行は無い。** 型から消えた鍵で、古い例を
     * 写すと紛れ込む。**スクリプトでは直さない**（AI の行と区別できない行を
     * 黙って下書きに落とすと人の日付が消える）——鍵を手で消し、確かめたなら
     * `verifiedBy` と `verifiedAt` を書く。
     */
    it("旧い verified の鍵を持つ行は無い（手で消して verifiedBy を書く）", () => {
        const bad = SPOTS
            .filter((s) => Object.prototype.hasOwnProperty.call(s, "verified"))
            .map((s) => s.slug);
        expect(bad, "verified は使わない。鍵を消して、確かめたなら verifiedBy と verifiedAt を書く").toEqual([]);
    });

    it("本文に Markdown の **強調** が残っていない（画面は素の文字列で描く）", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            const r = s as unknown as Record<string, unknown>;
            const texts: string[] = [];
            for (const f of TEXT_FIELDS) if (typeof r[f] === "string") texts.push(r[f] as string);
            for (const f of TEXT_ARRAY_FIELDS) if (Array.isArray(r[f])) texts.push(...(r[f] as string[]));
            for (const f of TEXT_OBJECT_ARRAY_FIELDS) {
                if (Array.isArray(r[f])) texts.push(...(r[f] as { text?: string }[]).map((x) => x?.text ?? ""));
            }
            if (texts.some((t) => t.includes("**"))) bad.push(s.slug);
        }
        expect(bad, "`**` がそのまま画面に出る").toEqual([]);
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

    /**
     * 🔴 **日本語の文章に、別の文字体系が紛れ込んでいない。**
     *
     * 2026-09-24、実際に2件見つかった——`palais-garnier` の
     * 「アルジェリア大理石の **двойного** 階段」と、`sasagawa-nagare` の
     * 「**гроット** のような洞窟」。どちらもキリル文字で、**前者は既に
     * 公開状態の台帳に入っていた**。
     *
     * 人が読めば一目で分かるが、**件数が増えるほど誰も読まなくなる**。
     * JSON として妥当で、`publishBlockers` も通り、型検査も通るので、
     * この形の壊れ方は機械でしか捕まえられない。
     *
     * 通すのは日本語（かな・漢字）・ラテン文字・数字・記号まで。
     * キリル・アラビア・タイ・ハングル・デーヴァナーガリーを弾く。
     */
    const FOREIGN_RE = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0E00-\u0E7F\uAC00-\uD7AF\u0900-\u097F]/;

    it("文章に別の文字体系が紛れていない", () => {
        const hits: string[] = [];
        const walk = (v: unknown, path: string) => {
            if (typeof v === "string") {
                const m = FOREIGN_RE.exec(v);
                if (m) hits.push(`${path}: 「${m[0]}」（${v.slice(Math.max(0, m.index - 12), m.index + 12)}）`);
            } else if (Array.isArray(v)) {
                v.forEach((x, i) => walk(x, `${path}[${i}]`));
            } else if (v && typeof v === "object") {
                for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
            }
        };
        for (const s of SPOTS) walk(s, s.slug);
        expect(hits, "日本語の文章に別の文字体系が混ざっている").toEqual([]);
    });

    /**
     * 🔴 **日本語の語の途中に、英単語が挟まっていない。**
     *
     * 上のキリル文字と同じ壊れ方の、**見つけにくいほう**。2026-09-24 に
     * 「群猿山・**仙human岩**」を書きかけた——キリル文字と違って
     * 読み飛ばしやすく、JSON としても妥当なので、既存の見張りは全部緑だった。
     *
     * 通すのは**大文字の略語**（`LED`・`ND`・`JR`・`GPS`・`CM`・`V字`）。
     * 実データ（2026-09-24・全11件）はこれしかなく、誤検知しない。
     * 弾くのは**小文字が2文字以上**、日本語の文字に挟まれた形。
     */
    const LATIN_WEDGE_RE = /[\u3040-\u30FF\u4E00-\u9FFF][a-z]{2,}[\u3040-\u30FF\u4E00-\u9FFF]/;

    it("日本語の語の途中に英単語が挟まっていない", () => {
        const hits: string[] = [];
        const walk = (v: unknown, path: string) => {
            if (typeof v === "string") {
                const m = LATIN_WEDGE_RE.exec(v);
                if (m) hits.push(`${path}: 「${m[0]}」`);
            } else if (Array.isArray(v)) {
                v.forEach((x, i) => walk(x, `${path}[${i}]`));
            } else if (v && typeof v === "object") {
                for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
            }
        };
        for (const s of SPOTS) walk(s, s.slug);
        expect(hits, "日本語の語の途中に英単語が挟まっている").toEqual([]);
    });

    /**
     * 🔴 **日本語で使わない簡体字が紛れていない。**
     *
     * 上の2つ（キリル文字・英単語）と同じ壊れ方の、**最も見つけにくいもの**。
     * 2026-09-24 に「埼玉県行田市小**针**」と書きかけた——`針` の簡体字で、
     * 漢字なので目でも機械（文字体系の検査）でも素通りする。
     *
     * 全部を機械で判別するのは無理なので、**日本語に同形が無い字だけ**を
     * 挙げる。増えたらここに足す。誤検知しないことは実データ（474件）で
     * 確認済み。
     */
    const SIMPLIFIED = "针现这说门车东马鸟岛关开长书们华丽亿产众优传伤农冲决对时过还进远连边";

    it("日本語で使わない簡体字が混ざっていない", () => {
        const hits: string[] = [];
        const walk = (v: unknown, path: string) => {
            if (typeof v === "string") {
                for (const ch of v) {
                    if (SIMPLIFIED.includes(ch)) hits.push(`${path}: 「${ch}」（${v.slice(0, 30)}）`);
                }
            } else if (Array.isArray(v)) {
                v.forEach((x, i) => walk(x, `${path}[${i}]`));
            } else if (v && typeof v === "object") {
                for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
            }
        };
        for (const s of SPOTS) walk(s, s.slug);
        expect(hits, "簡体字が混ざっている").toEqual([]);
    });

    /**
     * 🔴 **項目の「形」が `Spot` の宣言と合っている。**
     *
     * `lib/data/spots.ts` は `spotsJson as Spot[]` と**キャスト**しているので、
     * **型検査は台帳の中身を一切見ない**。文字列を書くべき所に配列を、
     * 配列を書くべき所に文字列を入れても `tsc` は緑のまま通る。
     *
     * 2026-09-24、実際に踏んだ——`kamakurakokomae-crossing` の
     * `safetyNotes` を**文字列**で書いた（正しくは `string[]`）。
     * 単体テストも型検査も lint も緑で、**`next build` だけが落ちた**:
     *
     *     Error occurred prerendering page "/spots/kamakurakokomae-crossing"
     *     TypeError: a.safetyNotes.map is not a function
     *
     * CLAUDE.md の「`vitest` だけでは落ちないと言えない」の実例。
     * ビルドは10分かかるので、**同じ間違いを数秒で捕まえる**ためにここで見る。
     */
    const SHAPE: Record<string, "string" | "number" | "boolean" | "array" | "object"> = {
        spotId: "string", slug: "string", name: "string", nameEn: "string",
        reading: "string", address: "string", category: "string",
        summary: "string", description: "string", status: "string",
        officialWebsiteUrl: "string", verifiedAt: "string", timeZone: "string",
        createdAt: "string", updatedAt: "string",
        verifiedBy: "string", draftedAt: "string", draftedBy: "string",
        aliases: "array", highlights: "array", compositionTips: "array",
        seasonalGuide: "array", timeOfDayGuide: "array",
        safetyNotes: "array", sources: "array",
        region: "object", coords: "object", access: "object",
        parking: "object", coverImage: "object",
    };

    const kindOf = (v: unknown) =>
        Array.isArray(v) ? "array" : v === null ? "null" : typeof v;

    it("項目の形が Spot の宣言と合っている（キャストで型検査が効かないため）", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            for (const [k, want] of Object.entries(SHAPE)) {
                const v = (s as unknown as Record<string, unknown>)[k];
                if (v === undefined) continue;
                const got = kindOf(v);
                if (got !== want) bad.push(`${s.slug}.${k}: ${want} のはずが ${got}`);
            }
        }
        expect(bad, "台帳の項目の形が宣言と違う").toEqual([]);
    });

    /**
     * 時刻帯（2026-10-07）。`timeZone` は IANA 名として読めること、**国の表で時刻帯が決まらない国**
     * （アメリカ・カナダ・オーストラリアなど複数の時刻帯の国、表に無い国）の公開行は `timeZone` を書くこと。
     * 書かないと光の時刻の節が黙って消える
     */
    it("時刻帯: timeZone は IANA 名で、国から決まらない公開行は timeZone を持つ", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            if (s.timeZone !== undefined && !isTimeZoneName(s.timeZone)) bad.push(`${s.slug}: timeZone "${s.timeZone}" が読めない`);
            if (s.status === "published" && s.coords && !spotTimeZone(s.timeZone, s.region?.country)) {
                bad.push(`${s.slug}: 国「${s.region?.country}」から時刻帯が決まらない——timeZone を書く`);
            }
        }
        expect(bad).toEqual([]);
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
    /**
     * **作例のレビュー（2026-10-03）で直した座標。** 根拠（Wikidata の P625・国土地理院の地名／住所検索）を
     * 小数2桁に丸めた値。直す前は丸めの範囲を外れていた（瀬戸大橋記念公園は約2.4km 沖）。
     * 石舞台古墳は Wikidata の P625 が約5km 南にずれているので、国土地理院の値（34.46685,135.82644）
     */
    it.each([
        ["amanohashidate", 35.59, 135.19],      // Wikidata Q11387301（傘松公園）35.58694,135.19472
        ["daisekirinzan", 26.86, 128.26],       // Wikidata Q55434454 26.86194,128.25514
        ["nihonmatsu-castle", 37.6, 140.43],    // 国土地理院「霞ヶ城公園」37.59905,140.42931・郭内3-232 37.60118,140.42879
        ["ishibutai-kofun", 34.47, 135.83],     // 国土地理院「石舞台古墳」34.46685,135.82644
        ["takamatsu-kitahama", 34.35, 134.06],  // Wikidata Q11402357 34.35103,134.05653・国土地理院 北浜町4-14
        ["shimabara-yusui", 32.78, 130.37],     // 国土地理院 島原市新町2-125 32.78441,130.37058
        ["seto-ohashi-park", 34.35, 133.83],    // Wikidata Q11566601 34.35267,133.82603・国土地理院 番の州緑町6
        ["shirotori-garden", 35.13, 136.9],     // Wikidata Q11580565 35.12588,136.90090・国土地理院 熱田西町2-5
    ])("作例のレビューで直した座標: %s", (slug, lat, lng) => {
        expect(SPOTS.find((s) => s.slug === slug)?.coords).toEqual({ lat, lng });
    });

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

    /**
     * 出典が要る項目は、書いてあるなら出典もある。
     *
     * `published` は**確認者つき**（`sourcesFor` が数える形）。`review` は
     * 候補（url と日付）でよい——下書きの段階では画面に出さないが、
     * 「出典の当ても無いまま書いた駐車場」は下書きにも置かない。
     */
    it("出典が要る項目は、書いてあるなら出典もある", () => {
        const bad: string[] = [];
        for (const s of SPOTS) {
            for (const f of SOURCED_FIELDS) {
                const v = (s as unknown as Record<string, unknown>)[f];
                if (v === undefined) continue;
                const has = s.status === "published"
                    ? sourcesFor(s, f).length > 0
                    : (s.sources ?? []).some((x) => x.field === f && x.url && x.checkedAt);
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
        let seen = 0;
        for (const s of SPOTS) {
            check(`${s.slug}.verifiedAt`, s.verifiedAt);
            check(`${s.slug}.draftedAt`, s.draftedAt);
            if (s.verifiedAt || s.draftedAt) seen += 1;
            for (const src of s.sources ?? []) check(`${s.slug}.sources[${src.field}]`, src.checkedAt);
        }
        expect(bad).toEqual([]);
        // 日付を1つも持たない台帳なら上は空回り（verifiedAt が全件から消えたあとの形）
        expect(seen, "確認日も下書きの日付も無い").toBeGreaterThan(0);
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
     * 🔴 **どの県も10件以上ある**（owner の目標・2026-09-24）。
     *
     * 1件だけの県は、その1件が季節限定（藤・芝桜・雪）だったときに
     * 年の大半で「その県には何も無い」ページになる。まず全県2件以上にし、
     * 同じ日に**全県10件以上**まで積んだ（474件）。
     *
     * 10件あれば `/spots/area/<県>` が「季節・種別で選べるページ」になり、
     * `MIN_INDEXABLE_AREA`（2件）も余裕をもって満たす。
     *
     * **減らしたい日が来たらこの数を下げること。** そのとき「減らした」と
     * 意識することが、上の `MIN_SPOTS` と同じくこのテストの目的。
     */
    const MIN_PER_PREFECTURE = 10;

    it("どの都道府県も10件以上ある", () => {
        const count = new Map<string, number>();
        for (const p of jpPrefectures()) count.set(p, (count.get(p) ?? 0) + 1);
        const thin = PREFECTURES
            .filter((p) => (count.get(p) ?? 0) < MIN_PER_PREFECTURE)
            .map((p) => `${p}: ${count.get(p) ?? 0}件`);
        expect(thin, `この都道府県が${MIN_PER_PREFECTURE}件に届いていない`).toEqual([]);
    });

    it("知らない都道府県名を書いていない（綴りの揺れを止める）", () => {
        const known = new Set<string>(PREFECTURES);
        const bad = [...new Set(jpPrefectures())].filter((p) => !known.has(p));
        expect(bad, "47の一覧に無い都道府県名がある").toEqual([]);
    });

    /**
     * 🔴 **`region.country` に都道府県名が入っていないこと。**
     *
     * 2026-09-24、`tsubaki-jinja` を書くときに `country` を「三重県」と
     * 打った。**`publishBlockers` は「国が空でないこと」しか見ない**ので通り、
     * 型検査も `string` なので通り、上の「知らない都道府県名」の検査も
     * `prefecture` しか見ないので通る——**画面には「三重県 三重県 鈴鹿市」と
     * 出るまで誰も気づかない**。
     *
     * 国名は件数が少なく、増えるのも稀なので、**一覧に無い値は必ず疑う**。
     * 新しい国を足すときはこの一覧に1行足すこと。
     */
    const KNOWN_COUNTRIES = new Set(["日本", "フランス", "スペイン", "フィンランド", "イタリア", "バチカン市国", "スイス", "オーストリア", "チェコ", "ドイツ", "イギリス", "ポルトガル", "クロアチア", "オランダ", "ベルギー", "ギリシャ",
        // 2026-10-07 海外の撮影スポットを足したときの国（香港・マカオは `placeName.ts`・`sunTimes.ts` の表と同じく国の欄に書く）
        "アイスランド", "ノルウェー", "スウェーデン", "デンマーク", "アイルランド", "ポーランド", "ハンガリー", "スロベニア",
        "アメリカ", "カナダ", "メキシコ", "ペルー", "アルゼンチン", "オーストラリア", "ニュージーランド",
        "韓国", "台湾", "中国", "香港", "マカオ", "タイ", "ベトナム", "シンガポール", "マレーシア", "インドネシア", "インド", "スリランカ",
        "トルコ", "ヨルダン", "アラブ首長国連邦", "イラン", "エジプト", "モロッコ", "ジンバブエ"]);

    it("国名が一覧にある（都道府県名を国の欄に書いていない）", () => {
        const bad = SPOTS
            .filter((s: Spot) => {
                const c = s.region?.country?.trim();
                return Boolean(c) && !KNOWN_COUNTRIES.has(c as string);
            })
            .map((s) => `${s.slug}: ${s.region?.country}`);
        expect(bad, "一覧に無い国名がある（都道府県名を書いていないか確かめる）").toEqual([]);
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
