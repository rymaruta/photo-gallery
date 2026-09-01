import { describe, it, expect } from "vitest";
import { userFacingUploadError, UPLOAD_FAILED_MESSAGE } from "../errorText";

// `err.message` をそのまま描画していたので、画面に「S3 403」や
// オフライン時の "Failed to fetch" が出ていた。StoriesBar は同じ理由で
// 先に直してあり、コメントに「save 500 が利用者に見えていた」と書いてある。
describe("userFacingUploadError", () => {
    it("英語の技術文字列は出さない", () => {
        expect(userFacingUploadError(new Error("Failed to fetch"))).toBe(UPLOAD_FAILED_MESSAGE);
        expect(userFacingUploadError(new Error("S3 403"))).toBe(UPLOAD_FAILED_MESSAGE);
        expect(userFacingUploadError(new Error("NetworkError when attempting to fetch resource."))).toBe(UPLOAD_FAILED_MESSAGE);
    });

    // サーバーが日本語で返した理由（readApiError 経由）は捨てない。
    // 「写真は100枚までです」のような、押し直しても直らないものが含まれる
    it("日本語の理由はそのまま出す", () => {
        expect(userFacingUploadError(new Error("写真は100枚までです"))).toBe("写真は100枚までです");
        expect(userFacingUploadError(new Error("対応していない形式です（JPEG・PNG）")))
            .toBe("対応していない形式です（JPEG・PNG）");
    });

    it("Error でないもの・空も既定文にする", () => {
        expect(userFacingUploadError("boom")).toBe(UPLOAD_FAILED_MESSAGE);
        expect(userFacingUploadError(new Error(""))).toBe(UPLOAD_FAILED_MESSAGE);
        expect(userFacingUploadError(undefined)).toBe(UPLOAD_FAILED_MESSAGE);
    });
});
