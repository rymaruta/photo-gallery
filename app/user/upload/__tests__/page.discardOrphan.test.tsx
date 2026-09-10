import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 投稿は「S3 に上げる → DynamoDB に書く」の2段。保存に失敗した項目を
// そのまま捨てると**実体だけが S3 に残る**。どの削除経路も DynamoDB の
// 項目からキーを引くので、項目の無いオブジェクトには誰も手が届かない
// ——退会しても、写真を消しても残り続ける（原本は GPS 入りのまま
// 公開URLで取れる）。捨てるときに DELETE /upload/discard を叩く。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("from=share"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 「読めた／読めなかった」を分ける口。既存のモックから組み立てる
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),        // サムネは作らない（本体のキーだけを見る）
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

const UploadPage = (await import("../page")).default;
const imageUtils = await import("../../../../lib/utils/image");

const KEY = "uploads/me/abc.jpg";
const PUBLIC_URL = `https://cdn.example.com/${KEY}`;

/** 保存だけ失敗させる。presign と S3 の PUT は成功させる */
function apiThatFailsSave() {
    return (url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
            });
        }
        if (url === "/upload/save") {
            return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "保存できませんでした" }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    };
}

const discardCalls = () => mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/discard");

beforeEach(() => {
    // **画像まわりのモックは毎回ここで戻す。** describe ごとの afterEach に
    // 置いていると、後ろに describe を足した人が順序に依存して嵌まる
    vi.mocked(imageUtils.toUploadSafeFile).mockImplementation(async (f: File) => f);
    vi.mocked(imageUtils.createThumbnail).mockResolvedValue(null as never);
    mockUserFetch.mockReset().mockImplementation(apiThatFailsSave());
    mockReadSharedPayload.mockReset().mockResolvedValue({
        files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], title: "", text: "", t: Date.now(),
    });
    // S3 への PUT は素の fetch
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 共有シート経由の1枚を、保存失敗まで進める */
async function uploadAndFail() {
    render(<UploadPage />);
    const publish = await screen.findByRole("button", { name: /枚を公開/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
    // S3 には上がったが保存で落ちた状態
    await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
}

describe("保存に失敗した項目を捨てるとき", () => {
    it("S3 に上がったキーを消しに行く（孤児を残さない）", async () => {
        await uploadAndFail();
        expect(discardCalls()).toHaveLength(0);   // 捨てるまでは消さない

        await userEvent.click(await screen.findByRole("button", { name: "削除" }));

        await waitFor(() => expect(discardCalls()).toHaveLength(1));
        const [, init] = discardCalls()[0] as [string, { method: string; body: string }];
        expect(init.method).toBe("DELETE");
        expect(JSON.parse(init.body)).toEqual({ key: KEY });
    });

    // 連打しても DELETE は1回。updater の中で `prev` を見ているので、
    // 2回目は項目が見つからず投げない（この性質があるので、副作用を
    // updater の外に出す「規約どおりの直し方」は逆効果になる）。
    it("削除を連打しても DELETE は1回", async () => {
        await uploadAndFail();
        const btn = await screen.findByRole("button", { name: "削除" });
        await userEvent.click(btn);
        await userEvent.click(btn).catch(() => { /* 消えていれば押せない */ });

        await waitFor(() => expect(discardCalls().length).toBeGreaterThan(0));
        await new Promise((r) => setTimeout(r, 30));
        expect(discardCalls()).toHaveLength(1);
    });

    it("保存まで通った項目のキーは消さない（写真が使っている）", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));

        await userEvent.click(await screen.findByRole("button", { name: "削除" }));
        await new Promise((r) => setTimeout(r, 20));
        expect(discardCalls()).toHaveLength(0);
    });
});

// **応答が失われた PUT。** モバイル回線で、本文は上がりきったのに応答が
// 返らないことがある。`fetch` が reject するので、キーを控える前に落ちて
// いた——再試行は presign を取り直して**別のキー**へ上げ直すので、前の
// 実体は DynamoDB に行が無く、写真削除・退会・discard のどの経路からも
// 辿れない。**再試行のたびに1つずつ増える。**
describe("S3 への PUT が応答を返さなかったとき", () => {
    /** 本体の PUT だけ reject させる */
    const putRejects = () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    it("上げたかもしれない実体を消しに行く", async () => {
        putRejects();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        await waitFor(() => expect(discardCalls()).toHaveLength(1));
        const [, init] = discardCalls()[0] as [string, { method: string; body: string }];
        expect(init.method).toBe("DELETE");
        expect(JSON.parse(init.body), "控える前に落ちて、キーが残っていない").toEqual({ key: KEY });
    });

    // **このテストが見ているのは「成功したら DELETE を1本も投げない」**。
    // 「使っているものを消さない」を見ているのは次の
    // 「保存で落ちただけなら消さない」の方（あちらは catch を踏む）。
    // 名前と中身がずれていたので合わせた
    it("最後まで通ったときは DELETE を1本も投げない", async () => {
        // 既定のモックは保存も含めて成功する
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: PUBLIC_URL, key: KEY }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
        await new Promise((r) => setTimeout(r, 20));
        expect(discardCalls(), "使っている実体を消した").toHaveLength(0);
    });

    // 保存で落ちた場合は、PUT は通っている＝実体は「使うつもりのもの」。
    // ここで消してしまうと、再試行が**実体の無いキー**で保存してしまう
    it("保存で落ちただけなら消さない（再試行で使い回す）", async () => {
        await uploadAndFail();
        expect(discardCalls(), "PUT は通っているのに消している").toHaveLength(0);
    });
});

// サムネは別キー。**失敗しても本体の保存は続く**ので、上の catch には
// 来ない。控えたまま進むと、本体が保存できても**その 512px WebP だけが
// 誰にも辿れず残る**（写真を消しても、退会しても消えない）。
describe("サムネの PUT だけ失敗したとき", () => {
    const THUMB_KEY = "uploads/me/abc_thumb.webp";

    // **戻す。** グローバルの beforeEach は mockUserFetch しか reset せず、
    // vitest 側にも restoreMocks が無い。この describe の後ろにテストを足した
    // 人が「サムネが勝手に作られる」で嵌まる
    afterEach(() => { vi.mocked(imageUtils.createThumbnail).mockResolvedValue(null as never); });

    beforeEach(() => {
        vi.mocked(imageUtils.createThumbnail).mockResolvedValue(
            new File(["t"], "abc_thumb.webp", { type: "image/webp" }) as never,
        );
        // presign は本体 → サムネの順で呼ばれる。別のキーを返す
        let n = 0;
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                n += 1;
                return n === 1
                    ? Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3.example/put-main", publicUrl: PUBLIC_URL, key: KEY }) })
                    : Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3.example/put-thumb", publicUrl: `https://cdn.example.com/${THUMB_KEY}`, key: THUMB_KEY }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        // 本体の PUT は通し、サムネの PUT だけ落とす
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (String(url).includes("put-thumb")) throw new TypeError("Failed to fetch");
            return { ok: true, status: 200 };
        }));
    });

    // **逆向きも見る。** サムネが上がったのに控えを外し忘れると、保存で
    // 落ちたときの後始末が**使えるサムネまで消す**。再試行は
    // `uploaded.thumbUrl` をそのまま使うので、実体の無い URL を保存して
    // 一覧に割れた画像が並ぶ（本人にも直せない）
    it("サムネが上がっていれば、保存で落ちても消さない", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
        const orig = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            if (url === "/upload/save") {
                return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "保存できませんでした" }) });
            }
            return orig(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
        await new Promise((r) => setTimeout(r, 20));
        expect(discardCalls(), "再試行で使うサムネを消した").toHaveLength(0);
    });

    // **`!ok` は投げない。** 本体の PUT は `!ok` で throw して外側の catch が
    // 消すが、サムネは「無しで続行」なので投げず、`else` が無かったせいで
    // 403（署名切れ）や 5xx で上がった実体が誰にも辿れず残っていた
    it("S3 が断った（!ok）ときも、サムネのキーを消しに行く", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (String(url).includes("put-thumb")) return { ok: false, status: 403 };
            return { ok: true, status: 200 };
        }));

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
        await waitFor(() => expect(discardCalls(), "!ok で上がった実体が残っている").toHaveLength(1));
        expect(JSON.parse((discardCalls()[0] as [string, { body: string }])[1].body)).toEqual({ key: THUMB_KEY });
    });

    it("サムネのキーを消しに行き、本体の保存は続ける", async () => {
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        // 本体は保存まで進む
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));
        // サムネだけ消す
        await waitFor(() => expect(discardCalls()).toHaveLength(1));
        expect(JSON.parse((discardCalls()[0] as [string, { body: string }])[1].body),
            "サムネのキーが控えられていない").toEqual({ key: THUMB_KEY });
    });
});

// **申告した長さと、実際に送る本文は一致していなければならない。**
//
// presign が `ContentLength` を署名するようになったので、1バイトでも
// 違えば S3 が 403 を返す（＝アップロードが全部落ちる）。今の3経路は
// どれも「`file.size` を申告してその `file` をそのまま PUT する」形なので
// ずれようがないが、**間に加工を挟んだ瞬間に壊れる**——加工前の長さを
// 申告して加工後を送る、という書き方が自然に見えてしまうため。
// ここで契約として固定しておく。
describe("presign に申告した長さと、PUT する本文の長さ", () => {
    /** presign 要求に載った fileSize（呼ばれた順） */
    const declared = () => mockUserFetch.mock.calls
        .filter((c) => c[0] === "/upload/presigned-url")
        .map((c) => JSON.parse((c[1] as { body: string }).body).fileSize as number);

    /** 実際に PUT した本文の長さ（呼ばれた順） */
    const sent = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .filter((c) => (c[1] as { method?: string } | undefined)?.method === "PUT")
        .map((c) => ((c[1] as { body: Blob }).body).size);

    afterEach(() => {
        vi.mocked(imageUtils.toUploadSafeFile).mockImplementation(async (f: File) => f);
        vi.mocked(imageUtils.createThumbnail).mockResolvedValue(null as never);
    });

    it("本体もサムネも一致する", async () => {
        // **加工で長さが変わる場面を作る。** 素通しのモックのままだと
        // 「加工前の長さを申告して加工後を送る」を区別できない
        // ——まさにこの変更で壊れる書き方なので、ここで踏ませる
        vi.mocked(imageUtils.toUploadSafeFile).mockResolvedValue(
            new File(["stripped-body-is-a-different-length"], "shared.jpg", { type: "image/jpeg" }) as never,
        );
        vi.mocked(imageUtils.createThumbnail).mockResolvedValue(
            new File(["thumb-body-longer"], "abc_thumb.webp", { type: "image/webp" }) as never,
        );
        let n = 0;
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                n += 1;
                return Promise.resolve({ ok: true, json: async () => ({
                    presignedUrl: `https://s3.example/put-${n}`,
                    publicUrl: PUBLIC_URL, key: KEY, contentType: "image/jpeg",
                }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        await waitFor(() => expect(sent().length).toBeGreaterThanOrEqual(2));
        // **件数も見る。** `declared()` が空だと `[] === []` で無条件に緑になる
        // ——presign のパスを変えた瞬間に、何も検証しないテストになる
        expect(declared(), "presign を2回（本体・サムネ）取っていない").toHaveLength(2);
        expect(declared(), "申告と本文の長さが食い違っている（S3 が 403 を返す）")
            .toEqual(sent().slice(0, 2));
    });
});
