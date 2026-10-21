import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { hashNonce } from "../../appleIdToken";

/** テスト用の「Apple の」鍵と ID トークン（本物の Apple の鍵は使わない） */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

export const KID = "TESTKID1";
export const BUNDLE = "com.journeyphoto.JourneyPhoto";
export const RAW_NONCE = "raw-nonce-0123456789abcdef";
export const NOW = Date.UTC(2026, 9, 21, 3, 0, 0);

export const appleKeys = async () => [{ ...(publicKey.export({ format: "jwk" }) as object), kid: KID, alg: "RS256" }];

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

export function appleToken(
    claims: Record<string, unknown> = {},
    opts: { kid?: string; alg?: string; key?: KeyObject; header?: Record<string, unknown> } = {},
): string {
    const header = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? KID, ...opts.header });
    const payload = b64({
        iss: "https://appleid.apple.com",
        aud: BUNDLE,
        exp: Math.floor(NOW / 1000) + 600,
        iat: Math.floor(NOW / 1000),
        sub: "001234.abcdef0123456789.0123",
        nonce: hashNonce(RAW_NONCE),
        email: "taro@example.com",
        email_verified: "true",
        ...claims,
    });
    const sig = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), opts.key ?? privateKey);
    return `${header}.${payload}.${sig.toString("base64url")}`;
}

export const otherKey = other.privateKey;
