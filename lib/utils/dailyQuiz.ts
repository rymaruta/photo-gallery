// lib/utils/dailyQuiz.ts
//
// **今日の一問「この写真はどこ？」の出題**（純関数・サーバーでもブラウザでも同じ答え）。
//
// owner（2026-09-30）「毎日開く理由を作りたい」への答えの1つ。撮影スポットの写真を1枚見せ、
// 4つの中から場所を当てる。答えたらそのスポットのガイドへ。
//
// ## 決まりごと
//
//   - **日付（日本時間の暦日）で全員同じ問題。** 出題はビルド時に日ごとのファイル
//     （`/app/data/quiz/<YYYY-MM-DD>.json`）に書き出し、Web もアプリもそれを読む
//     ——同じ規則を2か所に書かない（片方だけ直したときに問題が割れる）
//   - 答えの候補は**公開済みで、owner が写真を確かめたスポット**（アプリの索引の `image` と同じ条件）
//   - 答えは**日付と ID の混ぜ合わせ（点数）がいちばん高い候補**。直近 30 日の答えは除く
//     （起点 `QUIZ_EPOCH` から1日ずつ決める）。「並べて日数で割った余り」にしないのは、
//     それだと**候補が1件増減しただけで全日の答えがずれる**から——スポットを公開した回の
//     デプロイで、朝に答えた人の問題が昼に別物になる（レビュー c82420bf で実測・61日中61日）。
//     点数方式なら、変わるのは足した1件が勝った日（と、そこから除外の窓が玉突きした日）だけ
//   - 🟡 **写真の URL と出典に答えが出ている**（`/images/spots/<slug>.jpg`・Commons のファイル名）。
//     割り切った: 順位も記録も無い1人の遊びで、隠すには写真を別名で複製するか、答えるまで
//     出典（CC の表示条件）を伏せるかになる。どちらも得より損が大きい
//   - 選択肢のほか3つは**同じ県（海外は同じ国）**から。足りなければ同じ国、それでも足りなければ全体
//     ——県が違うと写真を見なくても地名で当たってしまう
//   - 選ぶ順・並べる順は日付と ID の混ぜ合わせ（FNV-1a）で決める＝乱数を使わない
//   - **順位・連続記録・参加人数は出さない**（数えていない・競争の要素は足さない）

export type QuizRegion = { country?: string; prefecture?: string; city?: string };

export type QuizImage = {
    url: string;
    author: string;
    license: string;
    licenseUrl?: string;
    pageUrl: string;
};

/** 出題の材料（アプリの索引の1行のうち、要るところだけ） */
export type QuizSpot = {
    spotId: string;
    slug: string;
    name: string;
    region: QuizRegion;
    image: QuizImage;
};

export type QuizChoice = { spotId: string; slug: string; name: string; region: QuizRegion };

/** 日ごとのファイルの中身 */
export type DailyQuiz = {
    /** 日本時間の暦日 "YYYY-MM-DD" */
    date: string;
    /** 答えのスポットの写真（作者とライセンスは必ず一緒に出す） */
    photo: QuizImage;
    /** 4つの選択肢（並べる順もこのまま） */
    choices: QuizChoice[];
    /** 正解の `spotId` */
    answer: string;
};

/** 出題の日付の時刻帯。**全員が同じ日に同じ問題**を見るので1つに決める（サイトの主な読み手） */
export const QUIZ_TIME_ZONE = "Asia/Tokyo";

/** 32ビットの FNV-1a（並べ方を決めるだけ。暗号ではない） */
export function fnv1a(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/** "YYYY-MM-DD" → 紀元（1970-01-01）からの日数。形が違えば null */
export function dayNumber(ymd: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    // 0〜99年は `Date.UTC` が 1900 年代に読み替えるので、紀元より前はまとめて弾く
    if (Number(m[1]) < 1970) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const back = new Date(ms);
    // 2月30日のような存在しない日を弾く
    if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
    return Math.round(ms / 86_400_000);
}

/** 答えを1日ずつ決め始める日。これより前の日付は除外なしで選ぶ */
export const QUIZ_EPOCH = "2026-09-01";
/** 同じ答えを出さない日数（候補がそれより少なければ「候補数 − 1」日） */
export const QUIZ_NO_REPEAT_DAYS = 30;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 32ビットの混ぜ合わせ（murmur3 の仕上げ）。
 * **アプリはこの式を持たない**——日ごとのファイルを読むだけ（冒頭の「規則を2か所に書かない」）
 */
export function mix32(x: number): number {
    let h = x >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}

/** ID の混ぜ合わせ（`fnv1a(spotId)`）と日から点数。答えの選び方と試験が同じ式を使う */
function scoreOf(idHash: number, day: number): number {
    return mix32(idHash ^ Math.imul(day, 0x9e3779b1));
}

/** その日の候補の点数。高い方が答えになる */
export function quizScore(day: number, spotId: string): number {
    return scoreOf(fnv1a(spotId), day);
}

/**
 * 起点からの答えの控え（候補の顔ぶれごと・最後の1組だけ）。
 * 起点から数え直すと費用が「起点からの日数 × 候補数」で**年々伸びる**うえ、ビルドは
 * 同じ 61 日を2回（`generateStaticParams` と `GET`）聞く。控えがあれば数え直しは
 * 顔ぶれが変わったときの1回だけ（5年後・5,000件でも数百万回の掛け算で済む）
 */
let chainMemo: { key: string; picks: number[] } | null = null;

/**
 * その日の答え。起点から1日ずつ決め、直近の答えを除く。
 * `sorted` は spotId 順・重複なし（同点は spotId の小さい方＝並びに左右されない）。
 * ⚠️ 候補が `QUIZ_NO_REPEAT_DAYS + 1` 件以下だと除外が全部を覆って**決まった輪**になり、
 * 1件の増減で先の日が軒並み変わる。「変わるのは1〜2日」は本番の数百件が前提
 */
function answerFor(sorted: readonly QuizSpot[], day: number): QuizSpot {
    const ids = sorted.map((s) => fnv1a(s.spotId));
    const best = (d: number, skip: ReadonlySet<number>): number => {
        let top = -1;
        let topScore = -1;
        for (let i = 0; i < ids.length; i++) {
            if (skip.has(i)) continue;
            const sc = scoreOf(ids[i], d);
            if (sc > topScore) { top = i; topScore = sc; }
        }
        return top;
    };
    const epoch = dayNumber(QUIZ_EPOCH)!;
    if (day < epoch) return sorted[best(day, new Set())];

    const key = JSON.stringify(sorted.map((s) => s.spotId));
    if (chainMemo?.key !== key) chainMemo = { key, picks: [] };
    const picks = chainMemo.picks;
    const window = Math.min(QUIZ_NO_REPEAT_DAYS, sorted.length - 1);
    // 控えの続きから伸ばす（除外はいつも「直前 window 日」なので控えから作り直せる）
    for (let d = epoch + picks.length; d <= day; d++) {
        picks.push(best(d, new Set(picks.slice(Math.max(0, picks.length - window)))));
    }
    return sorted[picks[day - epoch]];
}

/** 選択肢をどの範囲から取るか（同じ県 → 同じ国 → 全体） */
function areaKey(r: QuizRegion, level: "prefecture" | "country"): string {
    const country = r.country?.trim() || "日本";
    if (level === "country") return country;
    return `${country}/${r.prefecture?.trim() || ""}`;
}

const toChoice = (s: QuizSpot): QuizChoice => ({ spotId: s.spotId, slug: s.slug, name: s.name, region: s.region });

/**
 * その日の一問。候補が4件に満たなければ null（出さない）。
 * `pool` の並びに左右されない（中で `spotId` の順に並べ直す）
 */
export function buildDailyQuiz(pool: readonly QuizSpot[], ymd: string): DailyQuiz | null {
    const day = dayNumber(ymd);
    if (day === null) return null;
    // 同じ ID が2度あっても1つに。**どちらを残すかも並びに左右されない**（写真の URL の順で先勝ち）
    // 最後は行まるごとの文字列で比べる（ID も写真も同じで名前だけ違う2行でも、並びで答えが変わらない）
    const byKey = (a: QuizSpot, b: QuizSpot) =>
        cmp(a.spotId, b.spotId) || cmp(a.image?.url ?? "", b.image?.url ?? "") || cmp(JSON.stringify(a), JSON.stringify(b));
    const sorted = [...pool].filter((s) => s.image?.url).sort(byKey)
        .filter((s, i, arr) => i === 0 || arr[i - 1].spotId !== s.spotId);
    if (sorted.length < 4) return null;
    const answer = answerFor(sorted, day);

    // 名前が同じものは選択肢に並べない（見分けがつかない）
    const others = sorted.filter((s) => s.spotId !== answer.spotId && s.name !== answer.name);
    const picked: QuizSpot[] = [];
    const take = (list: QuizSpot[]) => {
        const ranked = [...list]
            .sort((a, b) => fnv1a(`${ymd}|${a.spotId}`) - fnv1a(`${ymd}|${b.spotId}`) || cmp(a.spotId, b.spotId));
        for (const s of ranked) {
            if (picked.length >= 3) break;
            // 1つ入れるたびに確かめる（同じ呼び出しの中で同名が2つ入らないように）
            if (picked.some((p) => p.spotId === s.spotId || p.name === s.name)) continue;
            picked.push(s);
        }
    };
    take(others.filter((s) => areaKey(s.region, "prefecture") === areaKey(answer.region, "prefecture")));
    if (picked.length < 3) take(others.filter((s) => areaKey(s.region, "country") === areaKey(answer.region, "country")));
    if (picked.length < 3) take(others);
    if (picked.length < 3) return null;

    const choices = [answer, ...picked]
        .sort((a, b) => fnv1a(`${ymd}:${a.spotId}`) - fnv1a(`${ymd}:${b.spotId}`) || cmp(a.spotId, b.spotId))
        .map(toChoice);
    return { date: ymd, photo: answer.image, choices, answer: answer.spotId };
}

/** `from` から `days` 日ぶんの暦日（"YYYY-MM-DD"・両端を含む） */
export function datesFrom(fromYmd: string, days: number): string[] {
    const start = dayNumber(fromYmd);
    if (start === null || days <= 0) return [];
    return Array.from({ length: days }, (_, i) => new Date((start + i) * 86_400_000).toISOString().slice(0, 10));
}

/** 地域の短い言い方（「山形県 尾花沢市」・海外は国から）。答えのあとに出す */
export function regionLine(r: QuizRegion): string {
    const parts = r.country && r.country !== "日本" ? [r.country, r.prefecture, r.city] : [r.prefecture, r.city];
    return parts.filter((x): x is string => !!x && !!x.trim()).join(" ");
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isHttps = (v: unknown): v is string => isStr(v) && /^https:\/\//.test(v);

/**
 * 日ごとのファイルを画面の形へ。**頼んだ日付と違う・選択肢が4つでない・正解が選択肢に無い・
 * 写真が https でない**なら `null`（その日は「まだありません」）。
 * 作者とライセンスが無い写真は出さない（CC の表示条件を満たせない）
 */
export function parseDailyQuiz(json: unknown, ymd: string): DailyQuiz | null {
    if (!json || typeof json !== "object") return null;
    const o = json as Record<string, unknown>;
    if (o.date !== ymd || !isStr(o.answer)) return null;
    const p = o.photo as Record<string, unknown> | undefined;
    if (!p || !isHttps(p.url) || !isStr(p.author) || !isStr(p.license) || !isHttps(p.pageUrl)) return null;
    if (!Array.isArray(o.choices) || o.choices.length !== 4) return null;
    const choices: QuizChoice[] = [];
    for (const c of o.choices as unknown[]) {
        const x = c as Record<string, unknown> | null;
        if (!x || !isStr(x.spotId) || !isStr(x.slug) || !isStr(x.name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.slug)) return null;
        const r = (x.region && typeof x.region === "object" ? x.region : {}) as Record<string, unknown>;
        const region: QuizRegion = {};
        for (const k of ["country", "prefecture", "city"] as const) if (isStr(r[k])) region[k] = r[k] as string;
        choices.push({ spotId: x.spotId, slug: x.slug, name: x.name, region });
    }
    if (new Set(choices.map((c) => c.spotId)).size !== 4 || !choices.some((c) => c.spotId === o.answer)) return null;
    const photo: QuizImage = {
        url: p.url, author: p.author, license: p.license, pageUrl: p.pageUrl,
        // ライセンスの文面は `http://creativecommons.org/…` の行がある（写真の台帳で 157 件）。
        // 捨てるとその日だけライセンスがリンクでなくなる（CC の表示条件）——ガイドは同じ値をリンクで出している
        ...(isStr(p.licenseUrl) && /^https?:\/\//.test(p.licenseUrl) ? { licenseUrl: p.licenseUrl } : {}),
    };
    return { date: ymd, photo, choices, answer: o.answer };
}

/** 端末に残す「その日に選んだもの」の鍵 */
export function quizStorageKey(ymd: string): string {
    return `journey-photo:quiz:${ymd}`;
}
