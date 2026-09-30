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

/** 32ビットの混ぜ合わせ（murmur3 の仕上げ）。アプリも同じ式で書く */
export function mix32(x: number): number {
    let h = x >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
}

/** その日の候補の点数。高い方が答えになる */
export function quizScore(day: number, spotId: string): number {
    return mix32(fnv1a(spotId) ^ Math.imul(day, 0x9e3779b1));
}

/**
 * その日の答え。起点から1日ずつ決め、直近の答えを除く。
 * `sorted` は spotId 順・重複なし（同点は spotId の小さい方＝並びに左右されない）
 */
function answerFor(sorted: readonly QuizSpot[], day: number): QuizSpot {
    // ID の混ぜ合わせは1回だけ（日ごとに作り直さない）
    const ids = sorted.map((s) => fnv1a(s.spotId));
    const best = (d: number, skip: ReadonlySet<number>): number => {
        const salt = Math.imul(d, 0x9e3779b1);
        let top = -1;
        let topScore = -1;
        for (let i = 0; i < ids.length; i++) {
            if (skip.has(i)) continue;
            const sc = mix32(ids[i] ^ salt);
            if (sc > topScore) { top = i; topScore = sc; }
        }
        return top;
    };
    const epoch = dayNumber(QUIZ_EPOCH)!;
    if (day < epoch) return sorted[best(day, new Set())];
    const window = Math.min(QUIZ_NO_REPEAT_DAYS, sorted.length - 1);
    const recent: number[] = [];
    let pick = 0;
    for (let d = epoch; d <= day; d++) {
        pick = best(d, new Set(recent));
        recent.push(pick);
        if (recent.length > window) recent.shift();
    }
    return sorted[pick];
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
    const byKey = (a: QuizSpot, b: QuizSpot) =>
        cmp(a.spotId, b.spotId) || cmp(a.image?.url ?? "", b.image?.url ?? "");
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
