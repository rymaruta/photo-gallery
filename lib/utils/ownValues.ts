import type { Photo } from "../data/photos";
import { tagKey } from "./collections";
import { photoTimeKey } from "./photoOrder";

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

/**
 * タグの候補だけは、**同じタグを1つのチップに畳む**。
 *
 * 比べ方は画面の絞り込みと同じ `tagKey`（大小・`#`・記号を無視した
 * スラッグ）。完全一致で数えていたので、実測で `["fuji", "#旅", "Fuji",
 * "旅"]` ——**同じタグのチップが2つ**並び、押すと両方が写真に付いた。
 * ギャラリー側は `dca777a` / `e731478` で畳んだので、ここだけ残っていた。
 *
 * 代表の表記は `e731478` と同じ規則: **いちばん多く使った生表記**、
 * 同数なら文字順（毎回同じ並びにするため）。
 * 数えるのは**写真1枚につき1回**——`["旅", "#旅"]` を持つ1枚で「2回使った」
 * ことにはならない（`e541b23` で件数側に入れたのと同じ守り）。
 */
function collectTags(photos: readonly Photo[], limit: number): string[] {
    const groups = new Map<string, { total: number; last: string; raws: Map<string, number> }>();
    for (const p of photos) {
        const seen = new Set<string>();
        for (const raw of p.tags ?? []) {
            if (typeof raw !== "string") continue;
            const v = raw.trim();
            if (!v) continue;
            const key = tagKey(v);
            const g = groups.get(key) ?? { total: 0, last: "", raws: new Map<string, number>() };
            // **表記の票は、畳む前に必ず数える。** `seen` の後ろに置くと、
            // 1枚の中で2通り書いた片方（先に見た方）の票だけが入り、
            // **同じ写真集合でもタグ配列の並び順で代表表記が変わる**
            // （実測: `["Fuji","fuji"]` と `["fuji","Fuji"]` で結果が
            // `Fuji` / `fuji` に割れた）
            g.raws.set(v, (g.raws.get(v) ?? 0) + 1);
            // 使った回数（＝並び順）は写真1枚につき1回だけ
            if (!seen.has(key)) {
                seen.add(key);
                g.total += 1;
            }
            // **そのタグを最後に使ったのはいつか。** 同数のときの決着に使う
            // （下の説明を参照）。キーの作り方は `photoOrder` に合わせる
            // ——並びの規則をこのファイルで作り直さない
            const t = photoTimeKey(p);
            if (t > g.last) g.last = t;
            groups.set(key, g);
        }
    }
    const label = (g: { raws: Map<string, number> }) =>
        [...g.raws.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    // **同数のときは「最後に使った順」。**
    //
    // 実データで数えたら **62種のうち46種が1枚にしか付いていない**ので、
    // ほとんどのタグが `total === 1` で並び、決着は文字順だけだった。
    // `localeCompare` は**日本語をラテン文字の後ろに置く**（実測
    // `apple < zebra < 白鳥 < 苔`）ので、上限30で切ると
    // **日本語のタグから落ちる**——実測で隠れた29種のうち10種が日本語、
    // 出ていた日本語は2種だけだった。このサイトの弱点は
    // 「索引に載るタグ8種のうち日本語は1種」なのに、**候補の出し方が
    // それを強めていた**。
    //
    // 旅から帰って続けて上げるときに欲しいのは「昨日使ったタグ」なので、
    // 同数なら新しい順にする。文字順は**最後の砦**として残す
    // （毎回同じ並びにするため）。**回数が先なのは変えない**
    // ——よく使うタグが上に来る性質は正しい。
    return [...groups.values()]
        .map((g) => ({ total: g.total, last: g.last, name: label(g) }))
        .sort((a, b) => b.total - a.total
            || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)
            || a.name.localeCompare(b.name))
        .map((g) => g.name)
        .slice(0, limit);
}

export function collectOwnValues(photos: readonly Photo[] | null | undefined, limit = 30): OwnValues {
    const loc = new Map<string, number>();
    const cat = new Map<string, number>();
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
    }
    return {
        locations: byFrequency(loc).slice(0, limit),
        categories: byFrequency(cat).slice(0, limit),
        tags: collectTags(photos ?? [], limit),
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
    // **同じタグかどうかは `tagKey` で見る。** 完全一致だと、`fuji` と
    // 書いてある欄に候補の `Fuji` を押すと `"fuji, Fuji"` になり、
    // 1枚の写真に同じタグが2つ付く（絞り込みは畳むが、写真のタグ欄には
    // 2つ並ぶ）。実測で `#旅` と `旅` も同じ形だった
    const key = tagKey(add);
    if (parts.some((t) => tagKey(t) === key)) return current;
    return [...parts, add].join(", ");
}

/** いまの欄にそのタグが入っているか（大小・`#`・日英の別名は畳んで見る） */
export function hasTag(current: string, tag: string): boolean {
    // `tagKey` は中で trim するので、ここでは trim しない
    const key = tagKey(tag);
    if (!key) return false;
    return current.split(",").some((t) => tagKey(t.trim()) === key);
}

/**
 * 候補チップの押下。**入っていれば外す、入っていなければ足す。**
 *
 * もとは足すだけだったので、**既に付いているタグのチップを押しても
 * 何も起きなかった**（見た目も変わらないので、押せていないのか
 * 効かないのかも分からない）。このリポジトリは同じ場面を
 * 一覧の絞り込み（`FilterBar` のタグチップ）で**押し直して外す**形に
 * してあり、投稿・編集の候補チップだけ古いままだった。
 * `StoryViewer` の「0件のときは出さない——押しても何も無いボタンを
 * 常に置かない」と同じ考え方。
 *
 * 足す側は `appendTag` に任せる（何も変わらない回に**元の文字列を
 * そのまま返す**——空白の入れ方を勝手に直さない、という性質がある）。
 * **空のタグのガードはここに置かない**——`hasTag` が必ず false を返して
 * `appendTag` に流れ、あちらのガードが受ける。ここにも書くと
 * **二重の守りになって、片方を壊しても誰も気づけない**
 * （`bf3df612`「二重の守りは1本にする」。実際、変異で素通りして分かった）。
 *
 * ⚠️ **外して戻すと、2つ変わる**（承知のうえで残す）:
 *   - **並びが末尾へ移る。** 編集画面は「触っていない項目は送らない」ので、
 *     元に戻したつもりでも「未保存の変更」になり、保存すると**並びだけ
 *     違う**内容が送られる（サーバーは変更と見て静的サイトの再ビルドを頼む）。
 *     直すには画面とサーバーの比較を両方「集合として比べる」に変えることになり、
 *     対の実装がずれる方が危ない
 *   - **綴りが候補の代表表記になる。** `風景` の写真で候補「landscape」を
 *     押し直すと `landscape` になる。押した本人が選んだ綴りではあるが、
 *     日本語のタグが検索面積に効くという方針とは逆に倒れうる
 */
export function toggleTag(current: string, tag: string): string {
    const t = tag.trim();
    if (!hasTag(current, t)) return appendTag(current, t);
    const key = tagKey(t);
    return current
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => tagKey(x) !== key)
        .join(", ");
}
