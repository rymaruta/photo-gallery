import type { Photo } from "../data/photos";
import { tagKey } from "./collections";

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
/**
 * ⚠️ **タグはここに無い。** 候補は「自分が過去に使った値」ではなく
 * **決まった選択肢**（`lib/utils/tagChoices.ts` の `TAG_CHOICES`）になった
 * ——実データ59種のうち44種が1枚だけで、中身は地名と一回きりの名詞だった。
 * 撮影地とカテゴリは今までどおり（撮影地こそ地名の行き先）。
 */
export type OwnValues = { locations: string[]; categories: string[] };

/** 件数の多い順 → 同数なら文字順（毎回同じ並びにする） */
function byFrequency(counts: Map<string, number>): string[] {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([v]) => v);
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
    const parts = splitTags(current);
    // **同じタグかどうかは `tagKey` で見る。** 完全一致だと、`fuji` と
    // 書いてある欄に候補の `Fuji` を押すと `"fuji, Fuji"` になり、
    // 1枚の写真に同じタグが2つ付く（絞り込みは畳むが、写真のタグ欄には
    // 2つ並ぶ）。実測で `#旅` と `旅` も同じ形だった
    const key = tagKey(add);
    if (parts.some((t) => tagKey(t) === key)) return current;
    return joinTags([...parts, add]);
}

/**
 * **タグ欄の区切り。** 半角のカンマだけにしない。
 *
 * iPhone のかなキーボードでいちばん自然に打てる区切りは「、」で、
 * 半角の `,` は記号の面へ切り替えないと出ない。区切りを `,` だけに
 * していた頃は「桜、紅葉」が**1つのタグ**として保存され
 * （`/tag/桜、紅葉` という1枚だけのページができる）、打った瞬間に
 * 候補チップも全部消えていた（「桜、」全体を打ちかけと読むため）。
 * 全角の「，」と半角の「､」も同じ扱いにする。空白では区切らない
 * （`New York` のように語の中に空白を持つタグがありうる）。
 */
export const TAG_SEPARATOR = /[,，、､]/;

/** タグ欄の文字列をタグに分ける（前後の空白を落とし、空は捨てる） */
export function splitTags(input: string): string[] {
    return input.split(TAG_SEPARATOR).map((t) => t.trim()).filter(Boolean);
}

/**
 * タグの欄の文字列を組み直す。**末尾に区切りを残す。**
 *
 * 残さないと、**チップを押した直後に打つと前のタグに繋がる**
 * ——`[sauna]` を押して `hokkaido` と打つと `"saunahokkaido"` という
 * **1つの嘘のタグ**が保存される。欄はカンマ区切りなのに、区切りを入れる
 * 仕事だけ利用者に残していた。
 *
 * これは `8774ccd2`（打ちかけの欠片がタグとして保存される）と同じ型の
 * 裏返し——**チップの目的は「打つから表記が割れる」を減らすこと**なのに、
 * 押すたびに新しい綴りを作れる形だった。実データの owner は1枚に
 * 中央値3タグ・最大8タグを日英で付けており、**59種のうち49種はチップに
 * 出ない**（上位10種だけ）ので、押す→打つ→押す、が主動線になる。
 *
 * 空になったら区切りも残さない（`", "` だけの欄を作らない）。
 * 末尾の区切りは保存に響かない——サーバーの `sanitizeTags` は空を落とし、
 * 編集画面の `dirty` は配列に直してから比べる（どちらも確かめた）。
 */
function joinTags(parts: readonly string[]): string {
    const kept = parts.map((t) => t.trim()).filter(Boolean);
    return kept.length === 0 ? "" : `${kept.join(", ")}, `;
}

/** いまの欄にそのタグが入っているか（大小・`#`・日英の別名は畳んで見る） */
export function hasTag(current: string, tag: string): boolean {
    // `tagKey` は中で trim するので、ここでは trim しない
    const key = tagKey(tag);
    if (!key) return false;
    return splitTags(current).some((t) => tagKey(t) === key);
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
    // 外したあとも同じ形（末尾に区切り）。**押す→打つ が主動線**なので、
    // 足すときだけ揃えても半分にしかならない
    return joinTags(splitTags(current).filter((x) => tagKey(x) !== key));
}

/**
 * 欄の**最後の欠片**が「打ちかけ」なら返す（候補と丸ごと同じなら「選び終えた
 * 1つ」なので空）。
 *
 * **この判定を2か所に書かない。** 絞る側（`suggestTags`）と、チップを
 * 押したときに欠片を捨てる側（`dropFragment`）が同じ答えを使う。
 * 別々に書いた版は、**打って絞ってチップを押すと欠片がタグとして残った**
 * （`sau` と打って `sauna` を押すと `"sau, sauna"`）——絞りを入れた目的が
 * 「打つから表記が割れる」を減らすことなのに、**新しい綴りを増やしていた**。
 */
export function typingFragment(all: readonly string[], current: string): string {
    const frag = (current.split(TAG_SEPARATOR).pop() ?? "").trim();
    if (!frag) return "";
    const key = tagKey(frag);
    return all.some((t) => tagKey(t) === key) ? "" : frag;
}

/** 打ちかけの欠片を欄から落とす（チップを押すときに使う） */
export function dropFragment(all: readonly string[], current: string): string {
    if (!typingFragment(all, current)) return current;
    // 最後の区切り（どの区切り文字でも）より前を残す
    let cut = -1;
    for (let i = current.length - 1; i >= 0; i--) {
        if (TAG_SEPARATOR.test(current[i])) { cut = i; break; }
    }
    return cut < 0 ? "" : current.slice(0, cut);
}

/**
 * 候補のタグを、**打ちかけの文字で絞る**。
 *
 * チップの枠は12個だが、owner のタグは**59種**ある
 * （`collectOwnValues(photos).tags` を実際に走らせて数えた。生の異なりは62だが
 *  `tagKey` で `自然/nature`・`風景/landscape`・`建物/architecture` が畳まれる。
 *  **自前で数え直さない**——この数を自分の正規化で出して62と書き、doc を
 *  6か所間違えた）。
 * 何も打たないと上位12種しか選べず、**残り47種（80%）は打つしかない**
 * ——そして打つから表記が割れる（このサイトの弱点は「索引に載るタグ8種のうち
 * 日本語は1種」で、割れはそこを直接悪くする）。
 *
 * 実データでの効き（`collectOwnValues(photos).tags` の59種に、この関数を
 * 実際に走らせて数えた）:
 *
 *     何も打たずに選べる        12 / 59
 *     打ち切る手前で候補に出る  **58 / 59**
 *
 * （「打ち切る手前」で見るのは、全部打てば当然その文字列になるから
 *   ——チップの値打ちは**打ち終わる前に出る**ことにある。届かない1つは
 *   `trees`：`tree` と打った時点で `tree` 自身が候補と丸ごと一致して絞りが
 *   解ける。そのとき出るのは既に使っている `tree` の方で、綴りを増やさない
 *   向きではある。同じ理由で `street` と打つと `streetlight` が隠れる
 *   ——`streetl` まで打てば出る）
 *
 * 見るのは**最後のカンマから後ろ**（`"自然, 山"` と書いている途中なら `山`）。
 * 突き合わせは生の文字と `tagKey` の両方——`風` と打てば `風景` に当たり、
 * `風景` は別名表を通って `landscape` にも当たる（**既に使っている綴りの方を
 * 出す**＝新しい綴りを増やさない）。一致が無ければ空にする。
 *
 * **絞っていないときは、欄に入っているタグを先に出す。** 上位12種の外にある
 * タグを選ぶと、絞りが解けた瞬間にそのチップが視界から消え、
 * **押し直して外せない・選んだ白地も見えない**（実データで59種中47種が該当）。
 */
export function suggestTags(all: readonly string[], current: string, limit = 12): string[] {
    const frag = typingFragment(all, current);
    if (!frag) {
        // **全部出るなら並べ替えない。** 先頭へ寄せるのは「枠に入りきらず
        // 選んだチップが視界から消える」ための仕掛け（実データ59種のうち
        // 47種が枠の外だった）。**決まった選択肢は全部出る**ので、寄せると
        // 押すたびにチップが動くだけになる——並びが動く入力は押し間違える。
        if (all.length <= limit) return [...all];
        const picked = all.filter((t) => hasTag(current, t));
        return [...picked, ...all.filter((t) => !picked.includes(t))].slice(0, limit);
    }
    const raw = frag.toLowerCase().replace(/^#+/, "");
    const key = tagKey(frag);
    return all
        .filter((t) => {
            const r = t.toLowerCase().replace(/^#+/, "");
            // `key` は非空（`frag` が非空なら `tagKey` は最低でも小文字化した
            // 生文字を返す）。`!!key` を足すと**到達しない二重の守り**になる
            return r.includes(raw) || tagKey(t).includes(key);
        })
        .slice(0, limit);
}
