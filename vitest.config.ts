import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        // レビューや変異テストの一時置き場を拾わない。
        // 中身は本物のソースのコピーなので、放っておくと**同じテストを
        // 二重に走らせて件数まで狂わせる**（実際に 1,503 と数えていた回が
        // 1,582 に膨れていた）。.gitignore だけでは vitest は止まらない。
        exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/__ztmp/**"],
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "."),
        },
    },
});
