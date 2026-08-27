import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Node / Lambda の CommonJS では require を許可。_ 始まりの変数は未使用でも許可
  {
    files: ["api/**/*.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled Lambda bundles (esbuild output)
    "api-user/dist/**",
    "api-user/node_modules/**",
    // レビューや変異テストの一時置き場。中身は本物のソースのコピーなので、
    // 拾うと lint も vitest も二重になる（vitest.config.ts にも同じ除外あり）。
    "**/__ztmp/**",
  ]),
]);

export default eslintConfig;
