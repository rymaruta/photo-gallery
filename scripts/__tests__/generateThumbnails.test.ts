import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { keyFromSrc, thumbKeyFor, derivativeKey, shouldProcess, needsThumb, needsMeta, needsDerivatives, needsExtraImage, needsExtraImages, EXTRA_IMAGE_FIELDS, buildMetaFields, hexFromChannel, isMissingObject, exitCodeFor } = require("../generate-thumbnails.js");

describe("keyFromSrc", () => {
    it("CloudFront URL から S3 キーを取り出す", () => {
        expect(keyFromSrc("https://d1s3dwwzgxf5ni.cloudfront.net/uploads/abc.jpg")).toBe("uploads/abc.jpg");
    });

    it("S3 直 URL でもパスがキーになる", () => {
        expect(keyFromSrc("https://bucket.s3.ap-northeast-1.amazonaws.com/uploads/x.png")).toBe("uploads/x.png");
    });

    it("URL エンコードを復号する", () => {
        expect(keyFromSrc("https://cdn.example.com/uploads/%E5%86%99%E7%9C%9F.jpg")).toBe("uploads/写真.jpg");
    });

    it("URL でない文字列は null", () => {
        expect(keyFromSrc("not-a-url")).toBeNull();
    });
});

describe("thumbKeyFor", () => {
    it("拡張子を webp に差し替えて _thumb を付ける", () => {
        expect(thumbKeyFor("uploads/abc.jpg")).toBe("uploads/abc_thumb.webp");
    });

    it("ディレクトリなしのキーにも対応する", () => {
        expect(thumbKeyFor("photo.png")).toBe("photo_thumb.webp");
    });

    it("拡張子がないキーにも対応する", () => {
        expect(thumbKeyFor("uploads/noext")).toBe("uploads/noext_thumb.webp");
    });

    it("深い階層でもディレクトリを維持する", () => {
        expect(thumbKeyFor("a/b/c.jpeg")).toBe("a/b/c_thumb.webp");
    });
});

describe("shouldProcess / needsThumb / needsMeta", () => {
    const src = "https://cdn.example.com/uploads/p1.jpg";
    const thumbSrc = "https://cdn.example.com/uploads/p1_thumb.webp";
    const derivatives = { thumbAvif: "https://cdn/x_thumb.avif", thumbSm: "https://cdn/x_thumb_sm.webp", thumbSmAvif: "https://cdn/x_thumb_sm.avif", srcAvif: "https://cdn/x_lg.avif" };
    const fullMeta = { dominantColor: "#123456", width: 4000, height: 3000, aspectRatio: 1.3333, blurDataURL: "data:image/webp;base64,UklGRAAA", ...derivatives };

    it("thumbSrc もメタも無い写真は対象（thumb+meta）", () => {
        const p = { id: "p1", src };
        expect(needsThumb(p)).toBe(true);
        expect(needsMeta(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    // 派生画像は max-age=31536000 で公開バケットに焼かれる一方、ストーリーの
    // 削除・期限切れ処理は原本しか消していなかった。24時間で消えるはずの
    // ストーリーの複製が公開URLで永久に残るため、そもそも作らない。
    it("ストーリーは対象外（24時間で消えるものの複製を作らない）", () => {
        const p = { id: "story-1", src, story: true, published: false };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(false);
        expect(needsDerivatives(p)).toBe(false);
        expect(shouldProcess(p)).toBe(false);
    });

    it("下書き（published:false）は対象外（公開前に取得できてしまう）", () => {
        const p = { id: "p1", src, published: false };
        expect(shouldProcess(p)).toBe(false);
    });

    it("published が未設定の写真は従来どおり対象（公開扱い）", () => {
        expect(shouldProcess({ id: "p1", src })).toBe(true);
        expect(shouldProcess({ id: "p1", src, published: true })).toBe(true);
    });

    it("thumbSrc があってもメタが欠けていればメタのみ対象", () => {
        const p = { id: "p1", src, thumbSrc };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("一部メタだけ欠けていても対象（dominantColor 欠落）", () => {
        const p = { id: "p1", src, thumbSrc, width: 4000, height: 3000, aspectRatio: 1.3333 };
        expect(needsMeta(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("thumbSrc とメタと派生が全て揃っていればスキップ（冪等）", () => {
        const p = { id: "p1", src, thumbSrc, ...fullMeta };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(false);
        expect(needsDerivatives(p)).toBe(false);
        expect(shouldProcess(p)).toBe(false);
    });

    it("派生（AVIF/256）だけ欠けていても対象", () => {
        const p = { id: "p1", src, thumbSrc, ...fullMeta, thumbAvif: "" };
        expect(needsThumb(p)).toBe(false);
        expect(needsMeta(p)).toBe(false);
        expect(needsDerivatives(p)).toBe(true);
        expect(shouldProcess(p)).toBe(true);
    });

    it("空文字のメタは未補完として扱う", () => {
        const p = { id: "p1", src, thumbSrc, ...fullMeta, dominantColor: "" };
        expect(needsMeta(p)).toBe(true);
    });

    it("src を持たない item（like#/go# マーカー等）はスキップ", () => {
        expect(shouldProcess({ id: "like#p1#u1" })).toBe(false);
        expect(shouldProcess(null)).toBe(false);
    });

    it("動画・GIF はスキップ", () => {
        for (const ext of ["mp4", "webm", "mov", "gif"]) {
            expect(shouldProcess({ id: "v1", src: `https://cdn.example.com/uploads/v1.${ext}` })).toBe(false);
        }
    });

    it("大文字拡張子の動画もスキップ", () => {
        expect(shouldProcess({ id: "v1", src: "https://cdn.example.com/uploads/V1.MP4" })).toBe(false);
    });

    it("URL として不正な src はスキップ", () => {
        expect(shouldProcess({ id: "p1", src: "broken" })).toBe(false);
    });
});

describe("derivativeKey", () => {
    it("接尾辞と拡張子を付けた派生キーを作る", () => {
        expect(derivativeKey("uploads/x.jpg", "_thumb", "avif")).toBe("uploads/x_thumb.avif");
        expect(derivativeKey("uploads/x.jpg", "_thumb_sm", "webp")).toBe("uploads/x_thumb_sm.webp");
        expect(derivativeKey("uploads/x.jpg", "_lg", "avif")).toBe("uploads/x_lg.avif");
        expect(derivativeKey("a/b/c.jpeg", "_thumb_sm", "avif")).toBe("a/b/c_thumb_sm.avif");
    });
    it("thumbKeyFor は _thumb.webp（派生と整合）", () => {
        expect(thumbKeyFor("uploads/x.jpg")).toBe("uploads/x_thumb.webp");
    });
});

describe("buildMetaFields", () => {
    it("寸法・アスペクト比・支配色を組み立てる", () => {
        const m = buildMetaFields({ width: 4000, height: 3000, dominant: { r: 18, g: 52, b: 86 } });
        expect(m).toEqual({ width: 4000, height: 3000, aspectRatio: 1.3333, dominantColor: "#123456" });
    });

    it("EXIF orientation 6（90度回転）で幅・高さを入れ替える", () => {
        const m = buildMetaFields({ width: 4000, height: 3000, orientation: 6, dominant: { r: 0, g: 0, b: 0 } });
        expect(m.width).toBe(3000);
        expect(m.height).toBe(4000);
        expect(m.aspectRatio).toBe(0.75);
    });

    it("orientation 1-4 は入れ替えない", () => {
        const m = buildMetaFields({ width: 4000, height: 3000, orientation: 1, dominant: { r: 255, g: 255, b: 255 } });
        expect(m.width).toBe(4000);
        expect(m.dominantColor).toBe("#ffffff");
    });

    it("寸法が無ければ aspectRatio は付けない", () => {
        expect(buildMetaFields({ dominant: { r: 1, g: 2, b: 3 } })).toEqual({ dominantColor: "#010203" });
        expect(buildMetaFields({})).toEqual({});
    });
});

describe("hexFromChannel", () => {
    it("0-255 を 2 桁 16 進に丸める", () => {
        expect(hexFromChannel(0)).toBe("00");
        expect(hexFromChannel(255)).toBe("ff");
        expect(hexFromChannel(9)).toBe("09");
        expect(hexFromChannel(127.6)).toBe("80");
    });

    it("範囲外はクランプする", () => {
        expect(hexFromChannel(-5)).toBe("00");
        expect(hexFromChannel(300)).toBe("ff");
        expect(hexFromChannel(undefined)).toBe("00");
    });
});

// 撮影日の補完はこのスクリプトから消えた。復元には EXIF 付きの元画像
// （srcOriginal）が要るが、**今のどの保存経路も srcOriginal を書いていない**
// ——アップロードは EXIF を落としてから上げるので原本が S3 に存在しない。
// ここには「srcOriginal を持つ写真」を渡すテストが3本あったが、その入力は
// 実データに存在せず、補完対象は永久に0件だった（＝一度も動いていない
// 分岐を測っていた）。撮影日は今アップロード時にブラウザが送っている。

// このジョブの終了コードは、本番デプロイが進むかどうかを決める。
// deploy.yml はこのステップの後に build と S3 反映を置いていて、
// 削除のたびに走る site-rebuild（消えたページを S3 から消す唯一の経路）も
// 同じ道を通る。ここを塞ぐと「消したはずの内容が公開されたまま、
// 直すデプロイも打てない」になる。
describe("exitCodeFor: 人が見に行くべきかの合図", () => {
    const run = (o: Partial<Record<"targets" | "ok" | "skipped" | "missing" | "failed", number>>) =>
        exitCodeFor({ targets: 0, ok: 0, skipped: 0, missing: 0, failed: 0, ...o });

    it("原本が消えた行しか残っていなければ 0", () => {
        // 退会処理は S3 を先に消して DynamoDB を後で消すので、途中で切れると
        // 「実体は無いが行は残る」が残る。一度うまく回ったあとの定常状態は
        // 「その行だけが対象」——ここを 1 にすると毎回赤くなる。
        expect(run({ targets: 3, missing: 3 })).toBe(0);
    });

    it("スキップだけなら 0（撮影日が EXIF に無い写真）", () => {
        expect(run({ targets: 4, skipped: 4 })).toBe(0);
    });

    it("対象が無ければ 0", () => {
        expect(run({ targets: 0 })).toBe(0);
    });

    it("全部成功なら 0", () => {
        expect(run({ targets: 3, ok: 3 })).toBe(0);
    });

    it("直しようのある失敗が1件でもあれば 1（人が見る）", () => {
        expect(run({ targets: 4, ok: 3, failed: 1 })).toBe(1);
        expect(run({ targets: 3, failed: 3 })).toBe(1);
    });
});

describe("isMissingObject: 原本が無いエラーの見分け", () => {
    it("NoSuchKey", () => {
        expect(isMissingObject(Object.assign(new Error("x"), { name: "NoSuchKey" }))).toBe(true);
    });
    it("NotFound", () => {
        expect(isMissingObject(Object.assign(new Error("x"), { name: "NotFound" }))).toBe(true);
    });
    it("HTTP 404", () => {
        expect(isMissingObject({ $metadata: { httpStatusCode: 404 } })).toBe(true);
    });
    it("スロットリングは別（直しようがある＝失敗として数える）", () => {
        expect(isMissingObject(Object.assign(new Error("x"), { name: "ThrottlingException" }))).toBe(false);
    });
    it("資格情報切れも別", () => {
        expect(isMissingObject(Object.assign(new Error("x"), { name: "ExpiredTokenException" }))).toBe(false);
    });
    it("null / undefined でも壊れない", () => {
        expect(isMissingObject(undefined)).toBe(false);
        expect(isMissingObject(null)).toBe(false);
    });
});

// 保存する画像URLに CloudFront の既定ドメインを焼き込んでいた。
// 実測で30件中11件が d1s3dwwzgxf5ni.cloudfront.net、19件が journey-photo.com。
// 同じ画像が2つのホスト名で配信され、サイトマップが両方を <image:loc> に
// 載せるのでインデックスが2ホストに割れる。訪問者にも DNS+TLS が1往復増える。
describe("保存する画像URLの土台", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { keyFromSrc } = require("../generate-thumbnails.js");

    it("読み取りはホスト名に依存しない（既存データとの互換）", () => {
        // だから土台を差し替えても、保存済みのURLは今までどおり辿れる
        expect(keyFromSrc("https://d1s3dwwzgxf5ni.cloudfront.net/uploads/u1/a.jpg"))
            .toBe("uploads/u1/a.jpg");
        expect(keyFromSrc("https://journey-photo.com/uploads/u1/a.jpg"))
            .toBe("uploads/u1/a.jpg");
    });

    it("パーセントエンコードされていても同じキーになる", () => {
        expect(keyFromSrc("https://journey-photo.com/up%6Coads/u1/a.jpg"))
            .toBe("uploads/u1/a.jpg");
    });

    it("スクリプトは PUBLIC_BASE_URL を優先する（ワークフローが siteUrl を渡す）", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeFs = require("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodePath = require("path");
        const src = nodeFs.readFileSync(
            nodePath.join(__dirname, "..", "generate-thumbnails.js"), "utf8");
        expect(src).toContain("process.env.PUBLIC_BASE_URL || requireEnv(\"CLOUDFRONT_URL\")");
    });
});

// **1投稿に複数枚。** 2枚目以降（`extraImages`）にも表紙と同じ派生が要る。
// 抜けると「AVIF を出す端末で1枚目だけ軽い」「一覧のサムネが原本」という
// 気づきにくい形になる（画面は正しく出るので誰も気づけない）。
describe("2枚目以降（extraImages）の派生", () => {
    const CDN = "https://cdn.test";
    /** 表紙は全部埋まっている写真 */
    const done = {
        src: `${CDN}/uploads/u1/a.jpg`, thumbSrc: "x", dominantColor: "#111111",
        width: 1, height: 1, aspectRatio: 1, blurDataURL: "d",
        thumbAvif: "x", thumbSm: "x", thumbSmAvif: "x", srcAvif: "x",
    };
    /** 全部埋まった2枚目 */
    const filled = Object.fromEntries([
        ["src", `${CDN}/uploads/u1/b.jpg`],
        ...EXTRA_IMAGE_FIELDS.map((f: string) => [f, f === "width" || f === "height" ? 1 : "x"]),
    ]);

    it("2枚目が空なら処理対象になる", () => {
        expect(shouldProcess({ ...done, extraImages: [{ src: `${CDN}/uploads/u1/b.jpg` }] })).toBe(true);
    });

    it("2枚目まで全部埋まっていれば処理しない", () => {
        expect(shouldProcess({ ...done, extraImages: [filled] })).toBe(false);
    });

    it("埋める項目のどれが空でも、埋めに行く", () => {
        // `it.each` にせず1本にまとめる（require 越しの配列は型が付かないので
        // コールバックの引数が implicit any になる）。落ちた項目は名前で分かる
        for (const field of EXTRA_IMAGE_FIELDS as string[]) {
            const img: Record<string, unknown> = { ...filled };
            delete img[field];
            expect(needsExtraImage(img), `${field} を見ていない`).toBe(true);
        }
    });

    it("🔴 下書きとストーリーには作らない（公開前・期限切れ後に取得できてしまう）", () => {
        const extra = [{ src: `${CDN}/uploads/u1/b.jpg` }];
        expect(needsExtraImages({ ...done, extraImages: extra })).toBe(true);
        expect(needsExtraImages({ ...done, published: false, extraImages: extra })).toBe(false);
        expect(needsExtraImages({ ...done, story: true, extraImages: extra })).toBe(false);
    });

    it("動画・GIF は2枚目でも飛ばす", () => {
        for (const ext of ["mp4", "webm", "mov", "gif"]) {
            expect(needsExtraImage({ src: `${CDN}/uploads/u1/b.${ext}` }), ext).toBe(false);
        }
    });

    it("src が無い・URL でない要素は飛ばす（落ちない）", () => {
        expect(needsExtraImage(null)).toBe(false);
        expect(needsExtraImage({})).toBe(false);
        expect(needsExtraImage({ src: 5 })).toBe(false);
        expect(needsExtraImage({ src: "not-a-url" })).toBe(false);
        expect(needsExtraImages({ ...done, extraImages: "x" })).toBe(false);
        expect(needsExtraImages({ ...done, extraImages: [null, {}] })).toBe(false);
    });

    // **項目の一覧が2か所にある。** ここと `api-user/src/photoImages.ts` の
    // `PhotoImage`。片方だけ増やすと、作っても読む側がいない／読む側が
    // いるのに作られない、のどちらかになる
    it("PhotoImage が持つ項目と、埋める項目が一致する", async () => {
        const src = await import("node:fs").then((fs) =>
            fs.readFileSync("api-user/src/photoImages.ts", "utf8"));
        const body = src.slice(src.indexOf("export type PhotoImage = {"));
        const typeFields = Array.from(
            body.slice(0, body.indexOf("};")).matchAll(/^\s{4}(\w+)\??:/gm)
        ).map((m) => m[1]).filter((f) => f !== "src");
        expect(typeFields.length, "型を読めていない").toBeGreaterThan(5);
        expect([...EXTRA_IMAGE_FIELDS].sort()).toEqual([...typeFields].sort());
    });
});
