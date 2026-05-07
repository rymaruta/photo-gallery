import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        line: {
          DEFAULT: "#06C755",
          dark: "#04a648",
          bg: "#8CABD8",
          chat: "#7C9DC6",
        },
      },
    },
  },
  plugins: [],
};

export default config;
