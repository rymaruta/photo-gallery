// lib/utils/api.ts
// API リクエストユーティリティ
// NEXT_PUBLIC_API_BASE_URL が設定されている場合は Lambda、未設定の場合はローカル API Routes を使用

import { getCurrentSession } from "../auth/cognito";

function getBaseUrl(): string {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    const useLocalApi = process.env.NEXT_PUBLIC_USE_LOCAL_API === "true";

    if (apiBaseUrl && !useLocalApi) {
        return apiBaseUrl.replace(/\/$/, "");
    }
    return "/api";
}

function getUserApiBaseUrl(): string {
    // ローカルAPIを使う指定は管理APIと同じく効かせる。
    // 以前はここだけ見ていなかったので、NEXT_PUBLIC_USE_LOCAL_API=true でも
    // userFetch だけが .env.local に残っている本番のユーザーAPIを叩いていた。
    // ストーリー投稿・プロフィール更新・**退会**まで本番に飛ぶ。
    if (process.env.NEXT_PUBLIC_USE_LOCAL_API === "true") return "/api";
    const userApiBaseUrl = process.env.NEXT_PUBLIC_USER_API_BASE_URL;
    if (userApiBaseUrl) {
        return userApiBaseUrl.replace(/\/$/, "");
    }
    // フォールバック: 管理者APIと同じ（ローカル開発用）
    return getBaseUrl();
}

/**
 * API の打ち切り（ミリ秒）。
 *
 * **打ち切りが1つも無かった。** 応答が返らない回線（電波が弱い・トンネル・
 * 相手が詰まっている）では、`fetch` は失敗もせずに待ち続ける。実測で
 * 出ていた症状: ストーリーの投稿が返らず**全画面の下書きから出られない**
 * （投稿ボタンもキャンセルも `disabled`）／フォローが「フォロー中」の見た目の
 * まま固まる／通知の取得が60秒ごとに積み上がる（4本が同時に開いたまま）。
 *
 * API Gateway 自身は29秒で切るので、それより手前で諦める。
 * **S3 への PUT はこの経路を通らない**（presign した URL へ素の `fetch`）ので、
 * 大きな写真のアップロードが途中で切られることはない。
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * 打ち切りを個別に伸ばせるようにする。**退会だけは20秒では足りない**
 * ——サーバー側は既定6秒から29秒に広げてあり（`api-user/serverless.yml`）、
 * 残り6秒になるまで使い切る設計（`account.ts` の `CLEANUP_RESERVE_MS`）＝
 * 最長23秒かかる。クライアントが20秒で降りると、サーバーは走り続けて
 * 写真・S3・プロフィールを消すのに `cognitoDeleteAccount` に**進まない**
 * ——「写真だけ消えてログインできるアカウントが残る」という、
 * `app/auth/context.tsx` が名指しで避けている状態そのものになる。
 */
export type ApiRequestInit = RequestInit & { timeoutMs?: number };

/**
 * 時間切れの中断を足した `RequestInit` を作る。呼び出し側が渡した
 * `signal`（画面を離れたときの後片付け・追い越しの破棄）も生かす。
 *
 * 中断の理由は `TimeoutError` にする——`AbortError` にすると、
 * 「自分で畳んだ」経路（`usePhotos` など `AbortError` を無視する実装がある）と
 * 区別できず、**時間切れが黙って捨てられる**。
 */
/**
 * トークンの取得（`getCurrentSession`）にも打ち切りを掛ける。
 *
 * **`fetch` に打ち切りを入れただけでは足りなかった。** `userFetch` /
 * `authenticatedFetch` は `await getCurrentSession()` の**後**に `fetch` を
 * 呼ぶ。`amazon-cognito-identity-js` の `getSession` は期限切れトークンで
 * Cognito へ通信し、そのコールバックには時間切れが無い（ライブラリ側にも
 * こちら側にも）。返らなければ `fetch` に到達すらしないので、
 * 「返らない回線で固まる」がこの入口に残っていた（レビュー指摘）。
 */
async function sessionWithTimeout(ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            getCurrentSession(),
            new Promise<never>((_res, rej) => {
                timer = setTimeout(
                    () => rej(new DOMException(`応答がありません（${Math.round(ms / 1000)}秒）`, "TimeoutError")),
                    ms,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function withTimeout(options?: ApiRequestInit): { init: RequestInit; done: () => void } {
    const ms = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new DOMException(`応答がありません（${Math.round(ms / 1000)}秒）`, "TimeoutError")),
        ms,
    );
    const caller = options?.signal;
    const relay = () => controller.abort(caller?.reason);
    if (caller) {
        if (caller.aborted) controller.abort(caller.reason);
        else caller.addEventListener("abort", relay, { once: true });
    }
    const rest = { ...options };
    delete rest.timeoutMs;   // 素の `fetch` に知らない項目を渡さない
    return {
        init: { ...rest, signal: controller.signal },
        done: () => {
            clearTimeout(timer);
            caller?.removeEventListener("abort", relay);
        },
    };
}

/**
 * 打ち切り付きで投げる。
 *
 * **本文を読み終わるまで見張る。** `fetch` が返るのは**ヘッダが来た時点**で、
 * そこでタイマーを片付けると `await res.json()` が無防備になる——ヘッダだけ
 * 来て本文が止まる回線（電波が弱いときの典型）では従来どおり永久に待つ
 * （レビューが実測: 27秒経ってもトーストが出ない）。
 * 失敗したときだけその場で片付け、成功したら**タイマーは時間切れまで残す**。
 * 本文を読み終わったあとの中断は何も起こさない（済んだ `fetch` への
 * `abort` は無害）ので、これで「本文が止まったら諦める」が効く。
 */
async function fetchWithTimeout(url: string, options?: ApiRequestInit): Promise<Response> {
    const { init, done } = withTimeout(options);
    try {
        return await fetch(url, init);
    } catch (e) {
        done();
        throw e;
    }
}

/**
 * 認証不要のリクエスト（写真一覧取得など）
 */
export async function publicFetch(path: string, options?: ApiRequestInit): Promise<Response> {
    const base = getBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    return fetchWithTimeout(url, options);
}

/**
 * Cognito JWT トークン付きのリクエスト（アップロード・削除など管理者操作）
 */
export async function authenticatedFetch(path: string, options?: ApiRequestInit): Promise<Response> {
    const base = getBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

    // Cognito セッションから JWT トークンを取得（ここにも打ち切りが要る）
    const session = await sessionWithTimeout(options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const token = session?.getIdToken()?.getJwtToken();

    if (!token) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    return fetchWithTimeout(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    });
}

/**
 * 一般ユーザーAPI向け認証付きリクエスト（アップロードのみ）
 */
export async function userFetch(path: string, options?: ApiRequestInit): Promise<Response> {
    const base = getUserApiBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

    const session = await sessionWithTimeout(options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const token = session?.getIdToken()?.getJwtToken();

    if (!token) {
        throw new Error(AUTH_REQUIRED_MESSAGE);
    }

    return fetchWithTimeout(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    });
}

/**
 * 一般ユーザーAPI向けの認証不要リクエスト（ユーザー検索・公開プロフィールなど）。
 *
 * publicFetch は管理APIを向いているため、ユーザーAPI にしか無いエンドポイントは
 * こちらを使う（間違えると 404 になり、その失敗は握り潰されて表示が空になる）。
 */
export async function userPublicFetch(path: string, options?: ApiRequestInit): Promise<Response> {
    const base = getUserApiBaseUrl();
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    return fetchWithTimeout(url, options);
}

/**
 * API のエラー応答から、利用者に見せる一文を取り出す。
 *
 * このAPIは日本語の理由を `{ error: "..." }` で返す
 * （例: 「アップロード上限（100枚）に達しています」「そのユーザー名は既に使われています」）。
 * ところが呼び出し側の多くは本文を捨てて「保存に失敗しました」とだけ出すか、
 * 生のJSONを80文字で切って出していた。前者は原因が分からず何度も同じ操作を
 * 繰り返すことになり、後者はクラッシュログのように見える。
 *
 * 読めなければ渡された既定文に落とす。
 */
/**
 * トークンが取れないときに userFetch / userPublicFetch が投げるエラーの文言。
 * 呼び出し側の catch はこれと比較して「通信の失敗」と「未ログイン」を
 * 見分ける（文字列の重複比較を散らばらせない）。
 */
export const AUTH_REQUIRED_MESSAGE = "認証が必要です。ログインしてください。";

/** 期限切れトークンで API Gateway が返す 401 定型に対する置き換え文言 */
export const SESSION_EXPIRED_MESSAGE = "セッションの有効期限が切れています。ログインし直してください";

/**
 * 「消そうとしたものが既に無い」＝目的は達成、と読める 404 か。
 *
 * **サーバーが返した 404 だけ**を成功として扱う。ベースURLの設定ミスで
 * API Gateway が返す 404（ルートが無い）まで飲むと、削除できていないのに
 * 「削除しました」と出る——このファイルの getUserApiBaseUrl のコメントが
 * 警告している踏み方そのもの。うちの API は理由を必ず日本語の
 * `{ error: ... }` で返す（api-user/src/http.ts の jsonError）ので、
 * それを目印にする。API Gateway は `{ message: "Not Found" }`。
 */
export async function isGoneResponse(res: Response): Promise<boolean> {
    if (res.status !== 404) return false;
    try {
        const data = await res.clone().json() as { error?: unknown };
        return typeof data.error === "string" && data.error.length > 0;
    } catch {
        return false;   // JSON でない＝うちの API の応答ではない
    }
}

export async function readApiError(res: Response, fallback: string): Promise<string> {
    let ours = "";
    try {
        const data = await res.json() as { error?: unknown; message?: unknown };
        // **うちの API は必ず `{ error }` で返す**（api-user/src/http.ts の
        // jsonError）。`message` しか無い応答は API Gateway 由来＝英語の定型で、
        // これを見分ける目印に使える（isGoneResponse も同じ論法）。
        ours = typeof data.error === "string" ? data.error : "";
    } catch { /* JSON でなければ既定文 */ }
    // API Gateway の JWT オーソライザは期限切れトークンに
    // {"message":"Unauthorized"} を返す。英語の定型を生で出さず、
    // 何が起きたか（再ログインで直る）が伝わる文言に置き換える。
    // 自前の API が返す日本語の error（「認証が必要です」等）はそのまま通す。
    if (res.status === 401 && !ours) return SESSION_EXPIRED_MESSAGE;
    // **401 以外も同じ扱いにする。** `message` をどのステータスでも通していた
    // ので、Lambda がタイムアウトすると「Internal Server Error」が、
    // オーソライザが弾くと「Forbidden」がそのままトーストに出ていた
    // （401 だけ置き換えても、他が素通しでは同じこと）。
    return ours || fallback;
}
