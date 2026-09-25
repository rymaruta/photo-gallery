import http2 from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

/**
 * APNs（Apple のプッシュ通知）へ送る。
 *
 * **設定が無ければ黙って送らない。** 鍵を入れていない環境（staging・
 * 手元）で通知そのものを止めないため——`pushNotification` は元から
 * 「失敗しても本体は成功」の作り。`CLOUDFRONT_DISTRIBUTION_ID` や
 * `REBUILD_DISPATCH_TOKEN` と同じ扱い（未設定でも本筋は通す）。
 *
 * **文面はここで作らない。** `loc-key` を送り、日本語と英語の出し分けは
 * 端末の `Localizable.strings` に任せる——サーバーは相手の言語を知らない。
 * 文面を作って送ると、英語の端末にも日本語が届く。
 *
 * **鍵は「送る関数」にだけ配る**（`serverless.yml` の IAM-2 の注記）。
 * 環境変数は読み取り権を持つ人に見えるので、provider には置かない。
 */
const KEY_ID = process.env.APNS_KEY_ID ?? "";
const TEAM_ID = process.env.APNS_TEAM_ID ?? "";
/** `.p8` の中身。改行は `\n` のまま渡ってくることがある */
const PRIVATE_KEY = (process.env.APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
/** 送り先のアプリ（Bundle ID） */
const TOPIC = process.env.APNS_TOPIC ?? "";
/**
 * 送り先。`api.push.apple.com`（TestFlight と App Store）か
 * `api.sandbox.push.apple.com`（Xcode から直接入れたビルド）。
 *
 * 🔴 **既定値を置かない。** 以前は `|| "api.push.apple.com"` と書いていたが、
 * それは CLAUDE ルールの「本番値のフォールバックは置かない。未設定なら
 * 止める」に反するうえ、**壊れ方が「動かない」ではなく「データを壊す」**側
 * だった:
 *
 *   1. 鍵・Key ID・Team ID・Topic は入っていて `APNS_HOST` だけ空
 *      （手でデプロイして旗を1つ忘れた回。`serverless.yml` の既定は `''`）
 *   2. `apnsConfigured()` が host を見ていないので「設定済み」と判定し、
 *      **staging から本番の APNs を向く**
 *   3. sandbox のトークンを本番 APNs に送ると 400 `BadDeviceToken`
 *   4. `isDeadToken` がそれを「死んだ宛先」と読み、`forgetTokens` が
 *      **DynamoDB からトークンを消す**
 *
 * 利用者が再インストールするまで二度と通知が届かない。**未設定なら
 * 送らない側に倒す**（通知は積まれるので、アプリを開けば読める）。
 */
const HOST = process.env.APNS_HOST ?? "";

/** 設定が揃っているか。揃っていなければ送信そのものを飛ばす */
export function apnsConfigured(): boolean {
    return !!(KEY_ID && TEAM_ID && PRIVATE_KEY && TOPIC && HOST);
}

/**
 * 署名（JWT）は使い回す。
 *
 * APNs は**1時間以内に作り直す**ことを求め、**20分より短い間隔で作り直すと
 * 断る**（`TooManyProviderTokenUpdates`）。50分で作り直せば両方を満たす。
 */
const TOKEN_TTL_MS = 50 * 60 * 1000;
let cachedToken: { value: string; at: number } | null = null;

function base64url(input: Buffer | string): string {
    return Buffer.from(input).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function providerToken(now = Date.now()): string {
    if (cachedToken && now - cachedToken.at < TOKEN_TTL_MS) return cachedToken.value;
    const header = base64url(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
    const payload = base64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(now / 1000) }));
    // **ES256 の署名は R||S の生の形**（`ieee-p1363`）。既定の DER で送ると
    // APNs は 403 `InvalidProviderToken` を返す——「鍵が違う」に見えて
    // 実際は形式違い、といういちばん分かりにくい落ち方をする
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
        key: createPrivateKey(PRIVATE_KEY),
        dsaEncoding: "ieee-p1363",
    });
    const value = `${header}.${payload}.${base64url(signature)}`;
    cachedToken = { value, at: now };
    return value;
}

/** 署名を捨てる（403 を受けたときと、テストから） */
export function resetProviderToken(): void {
    cachedToken = null;
}

/**
 * 作り直してよいか。**「20分より短い間隔で作り直すと断られる」を守る。**
 *
 * `InvalidProviderToken` は期限切れではなく**設定ミス**でも返る
 * （Key ID と鍵の不一致・鍵の失効・Team ID 違い）。その状態で下限が無いと
 * **いいね1回ごとに新しい JWT** を作り、20分の壁に当たって
 * `TooManyProviderTokenUpdates`（429）へ悪化する。直したあとも 429 が
 * 続くぶん、届かない時間が伸びる。
 *
 * 作り直していない（まだ1度も署名していない）ときは素通し。
 */
const RESIGN_FLOOR_MS = 20 * 60 * 1000;
export function canResign(now = Date.now()): boolean {
    return !cachedToken || now - cachedToken.at >= RESIGN_FLOOR_MS;
}

export type PushMessage = {
    /** 端末の `Localizable.strings` の鍵（例: `NOTIF_LIKE`） */
    locKey: string;
    /** 鍵に埋める値（相手の名前など） */
    locArgs: string[];
    /** アプリのバッジに出す未読数 */
    badge?: number;
    /** 押したときの行き先を決めるための付帯情報 */
    data?: Record<string, string>;
};

/** 送信の結果。**無効だった宛先だけ**を返す（呼び出し側が外す） */
export type PushResult = { sent: number; invalid: string[] };

/**
 * 送る中身。**純関数にして、テストから直接見る。**
 * HTTP/2 の向こう側は手元で再現できないので、**形だけは必ず縛る**
 * ——ここを壊すと本番の端末トークンを消すのに、テストは緑のままになる。
 */
export function pushPayload(message: PushMessage): string {
    return JSON.stringify({
        aps: {
            alert: { "loc-key": message.locKey, "loc-args": message.locArgs },
            sound: "default",
            ...(typeof message.badge === "number" ? { badge: message.badge } : {}),
        },
        ...(message.data ?? {}),
    });
}

/** 1通ぶんの HTTP/2 ヘッダ */
export function pushHeaders(jwt: string, token: string, topic = TOPIC) {
    return {
        ":method": "POST",
        ":path": `/3/device/${token}`,
        "authorization": `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        // 10 = すぐ届ける（人の行動に対する通知なので遅らせない）
        "apns-priority": "10",
    };
}

/**
 * その宛先を捨ててよいか。
 *
 * **捨てるのは2つだけ。** 400 の中身は理由で分かれていて、
 * `PayloadTooLarge` のような**こちらの間違い**で宛先を捨てると、
 * 直したあとも誰にも届かない。
 */
export function isDeadToken(status: number, reason?: string): boolean {
    if (status === 410) return true;
    return status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic");
}

/**
 * 署名を捨て直すべき応答か。
 *
 * **403 を放っておくと、温まったコンテナは50分間ずっと同じ JWT で
 * 失敗し続ける**（出るのは warn 1行だけ）。作り直せば次から通る。
 */
export function shouldResignAfter(status: number, reason?: string): boolean {
    return status === 403 && (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken");
}

/**
 * 1人の端末すべてに送る。
 *
 * **本筋を待たせない。** いいねやコメントの応答はこの送信を待つので、
 * 締め切りを置いて、超えたら諦める（通知が届かないだけ）。
 */
const DEADLINE_MS = 2000;

export async function sendPush(
    tokens: readonly string[],
    message: PushMessage,
): Promise<PushResult> {
    if (!apnsConfigured() || tokens.length === 0) return { sent: 0, invalid: [] };

    const body = pushPayload(message);

    let client: http2.ClientHttp2Session | undefined;
    try {
        client = http2.connect(`https://${HOST}`);
        // **繋がらない回を握り潰さない**（`error` を拾わないと落ちる）
        const failed = new Promise<never>((_, reject) => {
            client?.once("error", reject);
        });
        const jwt = providerToken();
        // **タイマーは片付ける。** Lambda は応答後に凍るので実害は薄いが、
        // 残すと1回の送信ごとに2秒のタイマーが積む（テストで待たされる）
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const results = await Promise.race([
            Promise.all(tokens.map((token) => sendOne(client!, jwt, token, body))),
            failed,
            new Promise<null>((resolve) => { deadline = setTimeout(() => resolve(null), DEADLINE_MS); }),
        ]).finally(() => { if (deadline) clearTimeout(deadline); });
        if (!results) {
            console.warn(`sendPush: ${DEADLINE_MS}ms で返らなかったので諦めました`);
            return { sent: 0, invalid: [] };
        }
        return aggregate(results);
    } catch (e) {
        console.error("sendPush error:", e);
        return { sent: 0, invalid: [] };
    } finally {
        // **セッションを跨いで使い回さない。** Lambda は呼び出しの間で
        // 凍るので、生きているつもりの接続が次の回に固まる
        client?.close();
    }
}

type OneResult = { token: string; ok: boolean; invalid: boolean };

function sendOne(
    client: http2.ClientHttp2Session,
    jwt: string,
    token: string,
    body: string,
): Promise<OneResult> {
    return new Promise((resolve) => {
        const request = client.request(pushHeaders(jwt, token));
        let status = 0;
        let payload = "";
        request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => { payload += chunk; });
        request.on("error", () => resolve({ token, ok: false, invalid: false }));
        request.on("end", () => {
            const verdict = classifyResponse(token, status, payload);
            // **断られた署名は捨てる。** 放っておくと、この温まった
            // コンテナは50分ずっと同じ JWT で失敗し続ける
            // **下限つきで作り直す**（設定ミスで 403 が続くときに 429 へ
            // 悪化させない。`canResign` の注記を参照）
            if (verdict.resign && canResign()) resetProviderToken();
            if (status !== 200) {
                console.warn(`APNs ${status} ${verdict.reason ?? ""}`.trim());
            }
            resolve({ token: verdict.token, ok: verdict.ok, invalid: verdict.invalid });
        });
        request.end(body);
    });
}

/**
 * 1件の応答から「どう扱うか」を決める。**HTTP/2 を建てずに試せる形**に
 * 切り出してある。
 *
 * 🔴 **ここは宛先を消すかどうかを決める場所。** 切り出した理由は、
 * 切り出す前は `sendPush` を走らせるテストが1本も無く、
 * `isDeadToken(status, reason)` を `status !== 200` に書き換えても
 * **42件とも緑だった**（2026-09-25 に変異で実測）。ネットワーク不通や
 * APNs の 500 で宛先を消す実装に退化しても誰も気づけない状態だった。
 *
 * **無効と判じるのは2つだけ**（`isDeadToken`）。400 の中身は理由で
 * 分かれていて、`PayloadTooLarge` のような**こちらの間違い**で宛先を
 * 捨てると、直したあとも誰にも届かない。
 */
export function classifyResponse(token: string, status: number, payload: string): {
    token: string; ok: boolean; invalid: boolean; resign: boolean; reason?: string;
} {
    const reason = readReason(payload);
    return {
        token,
        ok: status === 200,
        invalid: isDeadToken(status, reason),
        resign: shouldResignAfter(status, reason),
        ...(reason === undefined ? {} : { reason }),
    };
}

/**
 * 送信の結果をまとめる。**`invalid` に入ったものだけが消される**
 * （`notify.ts` の `deliverPush` が `forgetTokens` に渡す）。
 */
export function aggregate(results: readonly { token: string; ok: boolean; invalid: boolean }[]): PushResult {
    return {
        sent: results.filter((r) => r.ok).length,
        invalid: results.filter((r) => r.invalid).map((r) => r.token),
    };
}

function readReason(payload: string): string | undefined {
    if (!payload) return undefined;
    try {
        const parsed = JSON.parse(payload) as { reason?: unknown };
        return typeof parsed.reason === "string" ? parsed.reason : undefined;
    } catch {
        return undefined;
    }
}
