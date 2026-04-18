/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        bg: {
          DEFAULT: "#0b0d10",
          surface: "#12151a",
          elev: "#1a1f26",
          border: "#2b3139",
        },
        fg: {
          DEFAULT: "#e6edf3",
          dim: "#7d8590",
          muted: "#484f58",
        },
        accent: "#58a6ff",
        ok: "#3fb950",
        warn: "#d29922",
        danger: "#f85149",
      },
    },
  },
  plugins: [],
};
