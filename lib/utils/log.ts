// lib/utils/log.ts
// 環境に応じたログレベル制御

type LogLevel = "debug" | "info" | "warn" | "error";

// 環境変数からログレベルを取得（デフォルト: 開発環境はdebug、本番環境はwarn）
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL?.toLowerCase();
  if (envLevel === "debug" || envLevel === "info" || envLevel === "warn" || envLevel === "error") {
    return envLevel;
  }
  
  // 環境変数が設定されていない場合は、NODE_ENVに基づいて決定
  const isProd = process.env.NODE_ENV === "production";
  return isProd ? "warn" : "debug";
};

const currentLogLevel = getLogLevel();

// ログレベルの優先順位
const logLevelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ログを出力すべきかチェック
const shouldLog = (level: LogLevel): boolean => {
  return logLevelPriority[level] >= logLevelPriority[currentLogLevel];
};

// ログプレフィックスを生成（開発環境のみ）
const getPrefix = (level: LogLevel): string => {
  if (process.env.NODE_ENV === "production") {
    return "";
  }
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}]`;
};

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) {
      const prefix = getPrefix("debug");
      if (prefix) {
        console.log(prefix, ...args);
      } else {
        console.log(...args);
      }
    }
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) {
      const prefix = getPrefix("info");
      if (prefix) {
        console.log(prefix, ...args);
      } else {
        console.log(...args);
      }
    }
  },
  warn: (...args: unknown[]) => {
    if (shouldLog("warn")) {
      const prefix = getPrefix("warn");
      if (prefix) {
        console.warn(prefix, ...args);
      } else {
        console.warn(...args);
      }
    }
  },
  // errorは常に出力（障害調査用）
  error: (...args: unknown[]) => {
    if (shouldLog("error")) {
      const prefix = getPrefix("error");
      if (prefix) {
        console.error(prefix, ...args);
      } else {
        console.error(...args);
      }
    }
  },
};

