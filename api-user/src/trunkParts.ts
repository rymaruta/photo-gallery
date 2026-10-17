import LEDGER from "./data/trunkParts.json";

/**
 * 旅のトランクの部品の台帳（`data/trunkParts.json`・9種類×12点）。
 *
 * 写しの元は板の `Parts.dc.html`（各行の `['名前', 段, …]` の並び順どおり）。id は `<kind>.<1〜12>`。
 * **iOS の担当も同じファイルを読む**（形は `docs/api-reference.md` の「旅のトランク」）。
 * 2026-10-17 判断: 部品の絵の指定（色・形）はアプリの側に持つ。サーバーが見るのは id・kind・段だけ
 * （名前は人が読むため・ログや確かめに使う）
 */

export const PART_KINDS = ["handle", "corner", "lock", "lining", "tag", "pin", "patch", "charm", "key"] as const;
export type PartKind = (typeof PART_KINDS)[number];
/** 段（0 ふつう・1 めずらしい・2 とてもめずらしい） */
export type Rarity = 0 | 1 | 2;
export type TrunkPart = { id: string; kind: PartKind; rarity: Rarity; name: string };

type Ledger = { version: number; kinds: string[]; rarityWeights: number[]; parts: TrunkPart[] };
const L = LEDGER as unknown as Ledger;

export const TRUNK_PARTS: readonly TrunkPart[] = L.parts;
const BY_ID = new Map(TRUNK_PARTS.map((p) => [p.id, p]));

/** 段ごとの出やすさ（百分率・合計100）。ふつう70・めずらしい25・とてもめずらしい5 */
export const RARITY_WEIGHTS: readonly number[] = L.rarityWeights;

/** 段ごとの部品（台帳の並び順） */
export const PARTS_BY_RARITY: readonly (readonly TrunkPart[])[] = [0, 1, 2].map((r) => TRUNK_PARTS.filter((p) => p.rarity === r));

export const partOf = (id: unknown): TrunkPart | undefined => (typeof id === "string" ? BY_ID.get(id) : undefined);

/**
 * 0〜99 の数から段を決める（0〜69 ふつう・70〜94 めずらしい・95〜99 とてもめずらしい）。
 * 境目は台帳の `rarityWeights` から足して作る
 */
export function rarityOfRoll(roll: number): Rarity {
    let edge = 0;
    for (let r = 0; r < RARITY_WEIGHTS.length; r++) {
        edge += RARITY_WEIGHTS[r];
        if (roll < edge) return r as Rarity;
    }
    return (RARITY_WEIGHTS.length - 1) as Rarity;
}
