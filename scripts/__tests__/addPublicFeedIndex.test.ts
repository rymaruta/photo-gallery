import { describe, it, expect } from "vitest";
import { indexState, createIndexInput, isPublicPhoto, INDEX_NAME, PUBLIC_FEED_KEY } from "../add-public-feed-index.js";

// 公開一覧用 GSI の移行スクリプト（`add-story-index.js` の写真版）。
//
// **AWS には触れないので、判断の部分だけを直接呼ぶ。**
// 索引の状態の読み取り・UpdateTable に渡す指定・「どれが公開写真か」の3つが
// このスクリプトの中身で、残りは SDK の呼び出し。
//
// ここを間違えると起きること:
//   - `isPublicPhoto` が緩い  → 下書きやストーリーが一覧に出る
//   - `isPublicPhoto` が厳しい → 既存の写真が索引に載らず、読む側を
//     切り替えた瞬間に一覧から消える
//   - キーの組が違う          → 載る行と並びが変わる

describe("indexState: 索引の状態を読む", () => {
    it("索引が無ければ missing", () => {
        expect(indexState({ Table: { GlobalSecondaryIndexes: [] } })).toBe("missing");
    });

    it("GlobalSecondaryIndexes が無くても落ちない（missing）", () => {
        expect(indexState({ Table: {} })).toBe("missing");
        expect(indexState(undefined)).toBe("missing");
    });

    it("ACTIVE なら active", () => {
        expect(indexState({ Table: { GlobalSecondaryIndexes: [{ IndexName: INDEX_NAME, IndexStatus: "ACTIVE" }] } }))
            .toBe("active");
    });

    // **作成中を active と読むと、まだ空の索引を引きに行く**（一覧が空になる）
    it("CREATING は active ではない", () => {
        expect(indexState({ Table: { GlobalSecondaryIndexes: [{ IndexName: INDEX_NAME, IndexStatus: "CREATING" }] } }))
            .toBe("creating");
    });

    // 別の索引（storyFeed 側）を自分のものと取り違えない
    it("名前が違う索引は数えない", () => {
        expect(indexState({ Table: { GlobalSecondaryIndexes: [{ IndexName: "storyFeed-expiresAt-index", IndexStatus: "ACTIVE" }] } }))
            .toBe("missing");
    });
});

describe("createIndexInput: UpdateTable に渡す指定", () => {
    const input = createIndexInput("photos-test") as {
        TableName: string;
        AttributeDefinitions: { AttributeName: string; AttributeType: string }[];
        GlobalSecondaryIndexUpdates: { Create: {
            IndexName: string;
            KeySchema: { AttributeName: string; KeyType: string }[];
            Projection: { ProjectionType: string };
        } }[];
    };

    it("テーブル名を渡す", () => {
        expect(input.TableName).toBe("photos-test");
    });

    it("キーの組は publicFeed(HASH) / createdAt(RANGE)", () => {
        expect(input.GlobalSecondaryIndexUpdates[0].Create.KeySchema).toEqual([
            { AttributeName: "publicFeed", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" },
        ]);
    });

    // 属性定義が無いと CreateTable / UpdateTable 自体が通らない
    it("キーに使う属性の型を宣言している", () => {
        expect(input.AttributeDefinitions).toEqual(
            expect.arrayContaining([
                { AttributeName: "publicFeed", AttributeType: "S" },
                { AttributeName: "createdAt", AttributeType: "S" },
            ]),
        );
    });

    // KEYS_ONLY にすると行ごとに本体を引き直すことになり、Scan をやめた意味が薄れる
    it("射影は ALL", () => {
        expect(input.GlobalSecondaryIndexUpdates[0].Create.Projection.ProjectionType).toBe("ALL");
    });

    it("索引名がコード側の定数と同じ", () => {
        expect(input.GlobalSecondaryIndexUpdates[0].Create.IndexName).toBe(INDEX_NAME);
    });
});

describe("isPublicPhoto: 印を付ける対象", () => {
    const photo = { id: "p1", src: "https://cdn/x.jpg", createdAt: "2026-01-01T00:00:00.000Z" };

    it("公開中の写真は対象", () => {
        expect(isPublicPhoto({ ...photo, published: true })).toBe(true);
    });

    // **未指定は公開。** このリポジトリはどこも `!== false` で揃っている
    it("published を持たない古い行も対象（未指定は公開）", () => {
        expect(isPublicPhoto(photo)).toBe(true);
    });

    it("下書きは対象外（印を付けると一覧に出る）", () => {
        expect(isPublicPhoto({ ...photo, published: false })).toBe(false);
    });

    // ストーリーは published:false で保存されるが、二重の守りにする
    it("ストーリーは対象外", () => {
        expect(isPublicPhoto({ ...photo, published: true, story: true })).toBe(false);
    });

    // このテーブルには写真以外（いいね・フォローのマーカー、コメント文書、
    // 通知、rebuild のロック行）が同居している。写真は必ず src を持つ
    it("src を持たない行は対象外（マーカー・文書・ロック行）", () => {
        expect(isPublicPhoto({ id: "like#p1#u1", published: true })).toBe(false);
        expect(isPublicPhoto({ id: "rebuild#lock" })).toBe(false);
    });

    it("null / 文字列を渡しても落ちない", () => {
        expect(isPublicPhoto(null)).toBe(false);
        expect(isPublicPhoto("photo")).toBe(false);
    });
});

describe("印の値", () => {
    // ずれると、埋め戻した行が索引の別の場所に入って一覧に出ない
    it("api / api-user の publicFeed.ts と同じ", () => {
        const src = require("node:fs").readFileSync(
            require("node:path").join(__dirname, "..", "..", "api-user", "src", "publicFeed.ts"), "utf8");
        const m = /export const PUBLIC_FEED_KEY = "([^"]*)"/.exec(src);
        expect(m, "publicFeed.ts から値を読めない").not.toBeNull();
        expect(PUBLIC_FEED_KEY).toBe(m![1]);
    });
});
