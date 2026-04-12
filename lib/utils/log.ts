// lib/utils/log.ts
// 環境に応じたログ出力ユーティリティ
// 本番環境では warn/error のみ出力し、info/debug は silent

const isProd = process.env.NODE_ENV === "production";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LogArgs = any[];

export const log = {
    debug: (...args: LogArgs): void => {
        if (!isProd) console.debug("[debug]", ...args);
    },
    info: (...args: LogArgs): void => {
        if (!isProd) console.info("[info]", ...args);
    },
    warn: (...args: LogArgs): void => {
        console.warn("[warn]", ...args);
    },
    error: (...args: LogArgs): void => {
        console.error("[error]", ...args);
    },
};
