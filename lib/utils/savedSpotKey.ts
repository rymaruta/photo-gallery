// lib/utils/savedSpotKey.ts
//
// **「行きたい場所」に入る鍵の形。**
//
// ## なぜ接頭辞なのか
//
// 保存の入れ物（`spots#<uid>`）は**文字列の一覧**で、これまで入っていたのは
// **撮影地のスラッグ**（`パリ` / `yamanakako`）だけだった。ここに公式撮影地
// ガイドのスポットを足すが、**混ぜてはいけない**:
//
//   - 集約ページのスラッグは写真の自由入力から作る。**同じ綴りが偶然できうる**
//   - owner:「**対応関係が不明な項目を勝手に同一スポットとして統合しないで
//     ください**」。混ぜると、同じ文字列というだけで別物が1件に見える
//
// ## 接頭辞の選び方（2回選び直した）
//
// 条件は2つ。**両方を満たすものしか使えない。**
//
//   (1) `slugify` の出力に**絶対に現れない**こと（撮影地の名前が偶然
//       接頭辞に化けない）
//   (2) **URL のパス片にそのまま置ける**こと。外す口は
//       `DELETE /user/spots/{slug}` で、鍵がパスに乗る
//
// 🔴 **最初 `spot:` にして、テストに止められた。** `slugify` は
// **コロンを落とさない**（実測: `"spot:takaya"` → `"spot:takaya"`）＝(1) を
// 満たさない。
//
// 🔴 **次に `spot/` にした。これは (2) を満たさない。** `slugify` は `/` を
// `-` に潰すので (1) は満たすが、鍵がパスに乗るとき `%2F` になる。
// **API Gateway が `%2F` をどう扱うかを、この環境からは確かめられない**
// ——経路を分ける実装だと `{slug}` に当たらず、**保存はできるのに外せない**
// （画面からは直せない）状態になる。確かめられない賭けはしない。
//
// **いま使うのは `SPOT-`。** 根拠は `slugify` が `toLowerCase()` を通ること
// ——出力に**大文字は現れない**（実測: `"SPOT-takaya"` → `"spot-takaya"`）。
// 記号を1つも含まないので (2) の心配も無い。
//
// **この性質はテストが見張る**（`savedSpotKey.test.ts`）——`slugify` が
// 大文字を残すようになれば落ちる。
//
// ## サーバーは1行も変えていない
//
// `api-user/src/savedSpots.ts` が受けるのは「**空でなく `#` を含まない
// 200バイト以内の文字列**」。`SPOT-<slug>` はその形に収まるので、
// **API の変更も Deploy API も要らない**（実際に読んで確かめた）。
//
// ## 既存の保存は1件も触らない
//
// 接頭辞の無いものは今までどおり**撮影地のスラッグ**として読む。
// owner:「既存の保存済み撮影地を削除しないでください」。

/** 公式スポットの鍵に付ける頭。**`slugify` が作る文字列には現れない**（上の注記） */
export const SPOT_KEY_PREFIX = "SPOT-";

export type SavedKey =
    /** 公式撮影地ガイドのスポット（`/spots/<slug>`） */
    | { kind: "spot"; slug: string }
    /** 撮影地の集約ページ（`/location/<スラッグ>`）。**これまでの形** */
    | { kind: "location"; slug: string };

/** 公式スポットを保存するときの鍵 */
export function spotSavedKey(slug: string): string {
    return `${SPOT_KEY_PREFIX}${slug}`;
}

/**
 * 保存されている1件を読む。
 *
 * **知らない形は「撮影地」に倒す**——これまでの値が全部そちらなので、
 * 読めないものを捨てると**既存の保存が消えたように見える**。
 */
export function parseSavedKey(raw: string): SavedKey {
    const v = (raw ?? "").trim();
    if (v.startsWith(SPOT_KEY_PREFIX)) {
        const slug = v.slice(SPOT_KEY_PREFIX.length);
        // `SPOT-` だけの壊れた値は、撮影地としても読めないので落とす側に倒す
        // ——ただし**ここでは捨てない**（呼ぶ側が見分けられるよう空のスラッグで返す）
        return { kind: "spot", slug };
    }
    return { kind: "location", slug: v };
}

/** 公式スポットの鍵か */
export function isSpotKey(raw: string): boolean {
    return parseSavedKey(raw).kind === "spot";
}

/**
 * 重複を畳む。**同じ種別・同じスラッグのときだけ**。
 *
 * owner:「同じスポットの重複保存を防いでください。ただし、対応関係が不明な
 * 項目を勝手に同一スポットとして統合しないでください」。
 * ——`SPOT-takaya` と `高屋神社` は**別のものとして残す**（同じ場所かどうかを
 * 機械が決められない）。
 */
export function dedupeSavedKeys(keys: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of keys) {
        const p = parseSavedKey(k);
        const id = `${p.kind}:${p.slug}`;
        if (p.slug.length === 0 || seen.has(id)) continue;
        seen.add(id);
        out.push(k);
    }
    return out;
}
