import type { Photo } from "../data/photos";

/**
 * 自分がこれまでに使った撮影地・カテゴリ・タグを、よく使う順に集める。
 *
 * **入力の助けが無いせいで、同じ場所が別々の名前に散っていた。**
 * 実データには「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」
 * 「フランス ヴェルサイユ」が並んでいて、集約ページ（/location/…）も
 * 関連写真の導線も別々の入れ物に分かれる。SEO-1 で集約側は緩い一致に
 * 寄せたが、それは症状への対処で、**元は「前に何と書いたか」を思い出す
 * 手段が無いこと**にある。
 *
 * 候補は「自分の過去の値」だけ。他人の値は混ぜない
 * （公開プロフィールから他人の撮影地の一覧が読めるのと同じことになる）。
 */
export type OwnValues = { locations: string[]; categories: string[]; tags: string[] };

/** 件数の多い順 → 同数なら文字順（毎回同じ並びにする） */
function byFrequency(counts: Map<string, number>): string[] {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([v]) => v);
}

export function collectOwnValues(photos: readonly Photo[] | null | undefined, limit = 30): OwnValues {
    const loc = new Map<string, number>();
    const cat = new Map<string, number>();
    const tag = new Map<string, number>();
    const bump = (m: Map<string, number>, raw: unknown) => {
        if (typeof raw !== "string") return;
        const v = raw.trim();
        if (!v) return;
        m.set(v, (m.get(v) ?? 0) + 1);
    };
    for (const p of photos ?? []) {
        // 下書きも数える。まだ公開していない写真でも「前に何と書いたか」は
        // 思い出したい（公開状態は候補の有無と関係ない）。
        bump(loc, p.location);
        bump(cat, p.category);
        for (const t of p.tags ?? []) bump(tag, t);
    }
    return {
        locations: byFrequency(loc).slice(0, limit),
        categories: byFrequency(cat).slice(0, limit),
        tags: byFrequency(tag).slice(0, limit),
    };
}

/**
 * カンマ区切りのタグ欄に1つ足す（既にあれば何もしない）。
 *
 * タグ欄は datalist が使えない——datalist は**欄全体**を選んだ値で
 * 置き換えるので、「自然, 山」と書いている途中に候補を選ぶと
 * 既に入れた分が消える。押して足すチップ側の実装をここに置く。
 */
export function appendTag(current: string, tag: string): string {
    const add = tag.trim();
    if (!add) return current;
    const parts = current.split(",").map((t) => t.trim()).filter(Boolean);
    if (parts.includes(add)) return current;
    return [...parts, add].join(", ");
}
