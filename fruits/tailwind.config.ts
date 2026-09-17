import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  purge: {
    enabled: process.env.NODE_ENV === "production",
    content: ["./app/**/*.{js,jsx,ts,tsx}"],
  },
  theme: {
    fontFamily: {
      sans: ["-apple-system", "BlinkMacSystemFont", "sans-serif"],
      serif: ["-apple-system-ui-serif", "ui-serif", "Georgia", "serif"],
      mono: [
        "ui-monospace",
        "SFMono-Regular",
        "ui-monospace",
        "Monaco",
        "Andale Mono",
        "Ubuntu Mono",
        "monospace",
      ],
      hand: ["Indie Flower", "cursive"],
    },
    colors: {
      purple: "#3f2b46",
    },
    extend: {},
  },
  plugins: [],
} satisfies Config;
