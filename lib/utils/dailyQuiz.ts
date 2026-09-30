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
//   - 答えは候補を `spotId` の順に並べ、**紀元からの日数で1件ずつ進める**。`spotId` は
//     名前と無関係な16進なので、県や種類が続けて並ばない
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
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const back = new Date(ms);
    // 2月30日のような存在しない日を弾く
    if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
    return Math.round(ms / 86_400_000);
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
    // 同じ ID が2度あっても1つに（先勝ち）
    const seen = new Set<string>();
    const sorted = [...pool]
        .filter((s) => s.image?.url && (seen.has(s.spotId) ? false : (seen.add(s.spotId), true)))
        .sort((a, b) => (a.spotId < b.spotId ? -1 : a.spotId > b.spotId ? 1 : 0));
    if (sorted.length < 4) return null;
    const answer = sorted[((day % sorted.length) + sorted.length) % sorted.length];

    // 名前が同じものは選択肢に並べない（見分けがつかない）
    const others = sorted.filter((s) => s.spotId !== answer.spotId && s.name !== answer.name);
    const picked: QuizSpot[] = [];
    const take = (list: QuizSpot[]) => {
        const ranked = [...list]
            .sort((a, b) => fnv1a(`${ymd}|${a.spotId}`) - fnv1a(`${ymd}|${b.spotId}`) || (a.spotId < b.spotId ? -1 : 1));
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
        .sort((a, b) => fnv1a(`${ymd}:${a.spotId}`) - fnv1a(`${ymd}:${b.spotId}`) || (a.spotId < b.spotId ? -1 : 1))
        .map(toChoice);
    return { date: ymd, photo: answer.image, choices, answer: answer.spotId };
}

/** `from` から `days` 日ぶんの暦日（"YYYY-MM-DD"・両端を含む） */
export function datesFrom(fromYmd: string, days: number): string[] {
    const start = dayNumber(fromYmd);
    if (start === null || days <= 0) return [];
    return Array.from({ length: days }, (_, i) => new Date((start + i) * 86_400_000).toISOString().slice(0, 10));
}

/** 地域の短い言い方（「山形県 尾花沢市」・海外は国から） */
export function regionLine(r: QuizRegion): string {
    const parts = r.country && r.country !== "日本" ? [r.country, r.prefecture, r.city] : [r.prefecture, r.city];
    return parts.filter((x): x is string => !!x && !!x.trim()).join(" ");
}
