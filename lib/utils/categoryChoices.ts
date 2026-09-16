// lib/utils/categoryChoices.ts
// 投稿・編集画面でカテゴリを「選ぶ」ための決まった語彙。
// `slugify` だけに依存する（画面からも テストからも読める）。

import { slugify } from "./collections";

/**
 * **カテゴリの決まった選択肢**（owner の「風景、建築、人物、動物など
 * 狭めた選択肢にしたい」）。
 *
 * **自由入力は残す**（owner の判断）。これは「打たなくて済む道」であって、
 * 打てなくする仕組みではない——一覧に無い語を打てば今までどおり保存できる。
 *
 * **並びは「よく使う順 → 語彙として要る順」**。実データ（公開30枚）の内訳:
 *
 *     風景 16 ／ 建築 6 ／ 自然 5 ／ 街 1 ／ 動物 1 ／ ご飯 1
 *
 * `人物` と `食べ物` は owner の指示で足した（`ご飯` は `食べ物` へ寄る）。
 *
 * **写真・イラスト・デザインは入れない。** `CATEGORY_ALIASES` には在るが
 * 「何を撮ったか」ではなく**媒体**の名前で、実データでは0枚。
 * 選択肢に混ぜると「風景の写真」を『写真』に入れる人が出る。
 *
 * ⚠️ **ここに足す語は `CATEGORY_ALIASES` にも足すこと。** 足さないと
 * 日本語のままスラッグになり（`/category/◯◯`）、別の綴りで書かれた
 * 同じものと**別ページに割れる**。`categoryChoices.test.ts` が見張る。
 */
export const CATEGORY_CHOICES: readonly string[] = [
    "風景", "建築", "自然", "街", "人物", "動物", "食べ物",
] as const;

/**
 * いま入っている値が、その選択肢か。
 *
 * **綴りではなくスラッグで見る。** 保存されている値は `風景` とは限らない
 * ——実データは `landscape` 12枚・`風景` 4枚・`建物` 1枚と割れていて、
 * 綴りで比べると **英語で保存された16枚のチップが光らない**（押し直すと
 * 同じカテゴリなのに日本語で保存し直され、割れ方が増える）。
 * 集約ページが束ねるのと同じ規則（`slugify(_, "category")`）で見る。
 */
export function isChosenCategory(current: string, choice: string): boolean {
    const a = slugify(current ?? "", "category");
    if (!a) return false;
    return a === slugify(choice, "category");
}

/**
 * チップを押したあとのカテゴリ。
 *
 * **押し直すと外れる**（タグのチップ `toggleTag` と同じ約束）。カテゴリは
 * 1つしか持てないので、別のチップを押せば**置き換わる**。
 * 「指定なし」のチップを置かずに済ませるための形——外す道が無いと、
 * 一度付けたカテゴリを消すのに入力欄を手で空にすることになる。
 */
export function toggleCategory(current: string, choice: string): string {
    return isChosenCategory(current, choice) ? "" : choice;
}
