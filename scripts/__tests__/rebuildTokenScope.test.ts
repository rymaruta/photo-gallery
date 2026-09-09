import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

// IAM-2 の半分: GitHub の**書き込み**トークンが provider.environment にあった。
//
// serverless の `provider.environment` は**サービス内の全関数**に配られる。
// つまり REBUILD_DISPATCH_TOKEN は、未認証で呼べる getPhotos や getComments を
// 含む全 Lambda の環境変数に入っていた。環境変数は `lambda:GetFunctionConfiguration`
// （読み取り権だけ）で読めるので、AWS の読み取り → リポジトリへの書き込み →
// デプロイ鍵、と輪が閉じる。実際に再ビルドを頼むのは5つの関数だけ。
//
// ここで固定するのは両方向:
//   1. provider には無い（＝全関数に配られていない）
//   2. **rebuild.ts に届く関数には配られている** ——こちらが本題。
//      配り忘れると `requestSiteRebuild` は警告1行を出して false を返すだけで、
//      削除は成功したように見えたまま**静的ページが公開のまま残る**
//      （台帳 LEFT-1 と同じ壊れ方）。静かなので気づけない。
const ROOT = join(__dirname, "..", "..");
const TOKEN = "REBUILD_DISPATCH_TOKEN";

/** `handler: src/foo.bar` から src/foo.ts をたどり、rebuild.ts に届くか */
function reachesRebuild(serviceDir: string, handler: string): boolean {
    const entry = resolve(ROOT, serviceDir, handler.replace(/\.[^./]+$/, "") + ".ts");
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
        const file = stack.pop()!;
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        if (/[/\\]rebuild\.ts$/.test(file)) return true;
        const src = readFileSync(file, "utf8");
        // 静的 import と、動的 import（rebuild.ts は dynamodb を await import する）
        for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
            stack.push(resolve(dirname(file), m[1].replace(/\.js$/, "") + ".ts"));
        }
    }
    return false;
}

/**
 * `handler: src/foo.bar` の `bar` の**本文だけ**を切り出す。
 *
 * ファイル単位で見ると、同じファイルに居るだけの関数まで「依頼を呼ぶ」に
 * 見える（`src/upload.ts` には savePhoto と presignedUrl が同居している）。
 * 免除してよいかはその関数自身の中身で決まるので、export 単位で見る。
 */
function handlerBody(serviceDir: string, handler: string): string {
    const [file, name] = [handler.replace(/\.[^./]+$/, ""), handler.split(".").pop()!];
    const path = resolve(ROOT, serviceDir, file + ".ts");
    if (!existsSync(path)) return "";
    const src = readFileSync(path, "utf8");
    const start = new RegExp(`^export (?:const|function|async function) ${name}\\b`, "m").exec(src);
    if (!start) return "";
    const rest = src.slice(start.index + start[0].length);
    // 次の**トップレベルの宣言**まで（export に限らない——`savePhoto` の直前に
    // 非 export の補助関数が居ると、そこまで飲み込んで誤検知する）
    const next = /^(?:export )?(?:const|function|async function|type|interface) /m.exec(rest);
    const body = rest.slice(0, next ? next.index : rest.length);
    // **コメントを先に潰す。** 切り出した範囲には次の関数の JSDoc が必ず入る
    // （宣言の手前で切るため）。実測: `presignedUrl` は152行のうち89行が
    // コメントで、そこには `requestRebuildForNewPhoto` の説明が丸ごと入る。
    // 潰さないと、**経緯を1行書いただけで無関係に落ちる**——このリポジトリは
    // 同じ形を一度踏んで「コメントを先に潰す」を教訓に書いている
    // （scripts/audit-text-contrast.mjs）。倒れる先は安全側（誤検知）だが、
    // 誤検知で落ちる守りは やがて外されるので、ここで閉じておく。
    return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const services = [
    // savePhoto は「公開したら静的ページを作ってもらう」ために頼む。
    // presignedUrl / discardUpload は**自分では頼まない**が、savePhoto と同じ
    // src/upload.ts に居るのでここの辿り方（ファイル単位）では届いてしまう。
    // 厳密に1つにするなら savePhoto を別ファイルへ切り出す（未着手）。
    {
        name: "api-user", dir: "api-user",
        expected: ["presignedUrl", "savePhoto", "discardUpload", "updatePhotoVisibility", "deleteMyPhoto", "deleteAccount"],
        // timeout を広げなくてよい例外（自分では `requestSiteRebuild` を呼ばず、
        // savePhoto と同じファイルに居るだけ）
        notDispatching: ["presignedUrl", "discardUpload"],
    },
    { name: "api", dir: "api", expected: ["updatePhoto", "deletePhoto"], notDispatching: [] },
];

describe.each(services)("$name: 再ビルドのトークンは使う関数にだけ配る", ({ dir, expected, notDispatching }) => {
    const yml = readFileSync(join(ROOT, dir, "serverless.yml"), "utf8");
    const provider = yml.split(/\nfunctions:\n/)[0];
    const fnSection = yml.split(/\nfunctions:\n/)[1].split(/\n(?=[a-zA-Z#])/)[0];

    /** 関数名 → { handler, トークンを持つか } */
    const fns = new Map<string, { handler: string; hasToken: boolean; timeout: number }>();
    for (const part of ("\n" + fnSection).split(/\n(?=  \w+:\n)/)) {
        const m = /^\n?  (\w+):/.exec(part);
        if (!m) continue;
        const body = part.replace(/^\s*#.*$/gm, "");
        const h = /^\s{4}handler:\s*(\S+)\s*$/m.exec(body);
        if (!h) continue;
        const to = /^\s{4}timeout:\s*(\d+)\s*$/m.exec(body);
        fns.set(m[1], { handler: h[1], hasToken: body.includes(TOKEN), timeout: to ? Number(to[1]) : 6 });
    }

    it("provider.environment には置かない（全関数に配られる）", () => {
        expect(provider).not.toContain(TOKEN);
    });

    it("トークンを持つ関数は、洗い出した一覧と一致する", () => {
        const have = [...fns].filter(([, v]) => v.hasToken).map(([n]) => n);
        expect(have.sort()).toEqual([...expected].sort());
    });

    // **実際に頼む関数は、既定の 6 秒では足りない。** `requestSiteRebuild` は
    // DynamoDB への予算の加算＋GitHub への fetch（最大3秒）を含むので、
    // 6 秒のままだと GitHub が遅いだけで Lambda が殺され、**データはもう
    // 書けているのに 500 が返る**（削除なら「消したのに失敗と出る」、
    // 投稿なら「保存できませんでした」と出て画面が実体を捨てにいく）。
    // 予算を解放する処理にも届かないので、月の枠が1本ずつ減り続ける。
    //
    // **「広げる関数の一覧」ではなく「広げなくてよい例外の一覧」で書く。**
    // 最初は前者で書いたが、**減らす方向を誰も見ていなかった**——新しく依頼を
    // 出す関数を足すと `expected`（依存を辿るので自動）には必ず載るのに、
    // こちらの一覧に足し忘れても静かに緑で、その関数は 6 秒のまま本番に出る。
    // 「複製した規則は静かにずれる」を、それを防ぐと書いたテストで作っていた。
    // 例外側で書けば既定が「守られている」に倒れ、一覧は実質1つになる。
    //
    // 例外の2つは `savePhoto` と同じ `src/upload.ts` に居るだけで、自分では
    // 頼まない（広げると塞がった1本が同時実行の枠を長く掴む）。ここを
    // 空にできるのは `savePhoto` を別ファイルへ切り出したとき（`api` 側は
    // `photosMutate.ts` として既にそうしてある）。
    it("依頼を出しうる関数は timeout を広げてある", () => {
        const narrow = expected
            .filter((n) => !notDispatching.includes(n))
            .filter((n) => (fns.get(n)?.timeout ?? 6) < 15);
        expect(narrow, "6秒だと GitHub が遅いだけで 500 になる").toEqual([]);
    });

    // **免除は「本当に呼んでいない」ことを機械で確かめる。**
    // 一覧である以上、書き足せば何でも免除できてしまう（実際、`savePhoto` を
    // 足す変異が素通りした）。そこで免除した関数については、**その export の
    // 本文**を切り出して依頼の呼び出しが無いことを見る。これで
    // 「頼む関数をうっかり免除する」は落ちる。
    it("timeout の例外は、実在してトークンを持ち、依頼を呼ばない関数だけ", () => {
        for (const name of notDispatching) {
            expect(expected, `${name} はもう対象外`).toContain(name);
            expect(fns.has(name), `${name} が serverless.yml に無い`).toBe(true);
            const body = handlerBody(dir, fns.get(name)!.handler);
            expect(body, `${name} の本文を切り出せない`).not.toBe("");
            expect(body, `${name} は依頼を呼んでいる。免除できない`)
                .not.toMatch(/requestSiteRebuild|requestRebuildForNewPhoto/);
        }
    });

    // 本題。ソースを辿って「実際に rebuild.ts に届く関数」と突き合わせる。
    it("rebuild.ts に届く関数と、トークンを配った関数が一致する", () => {
        const reaches = [...fns].filter(([, v]) => reachesRebuild(dir, v.handler)).map(([n]) => n);
        // たどれていない（＝正規表現が壊れている）のを緑にしない
        expect(reaches.length).toBeGreaterThan(0);
        expect(reaches.sort()).toEqual([...expected].sort());
    });
});
