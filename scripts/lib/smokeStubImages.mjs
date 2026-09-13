/**
 * 外部リクエストの遮断。**密閉の目的は「外に出ない」ことで、
 * 「画像を失敗させる」ことではない。**
 *
 * 全部 `abort()` にしていた頃、集約ページの「写真が並ぶ」判定が
 * **必ず落ちた**——画像が失敗すると `Thumb` は `<picture>` ごと消すので、
 * 水和のあとに `<img>` が 0 になる（実測: 静的HTML 9 → 水和1.5秒後 0）。
 * つまりその判定は**この環境では原理的に通らない**もので、
 * 本番のデプロイをそのまま落とす（同じハーネスを使う）。
 *
 * → **画像の要求だけ、種類に合うバイトで返す。** 外へは出ないまま、
 *    「水和後にサムネが消えないか」を本当に見られるようになる。
 *    それ以外（API・フォント・別オリジンのスクリプト）は今までどおり遮断。
 *
 * **控えは 1x1 にしてはいけない。512x512 で持つ。**
 *
 * `naturalWidth` は**素の画素数ではなく、いま選ばれている候補の密度で
 * 割った値**を返す（HTML の仕様）。サムネの `<picture>` は
 * `srcset="..._256.avif 256w, ..._512.avif 512w" sizes="(max-width:640px) 112px, 128px"`
 * ——256w を 112px の枠に出すので密度は約2.29。ここへ 1x1 を返すと
 * `1 / 2.29` が 0 に丸まり、**`complete === true` ・ `naturalWidth === 0`・
 * `error` は一度も飛ばない**という状態になる。
 * `Thumb` の ref（`attach`）はその組み合わせを「壊れた画像」と読むので、
 * **要求は全部 200 で返っているのに `<picture>` ごと消えて `img=0`**。
 *
 *     実測（Chromium・390x844・DPR 1）
 *       srcset に w 記述子（256w を 112px へ）  complete=true  naturalWidth=0
 *       候補1つだけ（密度1）                    complete=true  naturalWidth=1
 *
 * **本番の写真では起きない**（派生は 256/512px 幅なので、割っても 100 以上
 * 残る）。起きるのはこのハーネスの控えだけ＝直すのはここ。
 * 512x512 なら最大の密度（512w を 112px＝4.57）でも 112 残る。
 * 大きさは `scripts/__tests__/e2eStubImages.test.ts` が縛っている。
 */
export const STUB_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAgAAAAIAAQMAAADOtka5AAAAA1BMVEV4eHhEoA7CAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAANklEQVR4"
    +
    "2u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB8G4IAAAFjdVCkAAAAAElFTkSuQmCC",
    "base64",
);
export const STUB_WEBP = Buffer.from(
    "UklGRgYCAABXRUJQVlA4IPoBAABQOgCdASoAAgACP83m8nO/uDQsoAgD8DmJaW7hd2EbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ"
    +
    "99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkP"
    +
    "fbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D3"
    +
    "2ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99"
    +
    "snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfb"
    +
    "JyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32y"
    +
    "ch77ZOQ99snIe+2TkPfbJyHvtk5D32ych6wAAP70kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    "base64",
);
export const STUB_AVIF = Buffer.from(
    "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJp"
    +
    "bG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAAC4AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAAB"
    +
    "AAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSECAAAAABRpc3BlAAAAAAAAAgAAAAIAAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAA"
    +
    "AAEAAQOBAgMAAAA2bWRhdBIACgk4Yj//9pAQ0GkyHxP8mKE4AAWAAQCXvyyKznt/2W/h6xr29vaYSfhVSiA=",
    "base64",
);

/** 要求された画像の種類に合うバイトを選ぶ（拡張子で見る。無ければ PNG） */
export function stubImageFor(url) {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".avif")) return { contentType: "image/avif", body: STUB_AVIF };
    if (path.endsWith(".webp")) return { contentType: "image/webp", body: STUB_WEBP };
    return { contentType: "image/png", body: STUB_PNG };
}
